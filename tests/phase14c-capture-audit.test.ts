import { describe, expect, it } from 'vitest'
import { Motor } from '../src/app/motor'
import { prepareBackup } from '../src/app/backup'
import { externalAttemptId } from '../src/engine/capture/capture'
import { validateSnapshotV2 } from '../src/engine/backup/validate'
import { WebCryptoHashService } from '../src/platform/web/hash'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import type { InboxItem } from '../src/domain'
import { DAY, FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 14c — bağımsız denetimde (2026-09-09) bulunan 5 hata için gerileme testleri; hepsi düzeltmeden önce kırmızıydı.

async function fresh(clock = new FakeClock()) {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  return { repo, motor, clock }
}
async function study(motor: Motor, atomId: string) {
  const session = motor.startSession(null)
  await motor.next(session)
  const pres = await motor.presentAtom(atomId)
  if (pres.kind !== 'recall') throw new Error('kart bekleniyordu')
  await motor.answerRecall(session, pres, { selfAssessment: 'good', hookShown: false, responseTimeMs: 300 })
}

describe('Yakalama — denetim düzeltmeleri', () => {
  it('C1: status yazılamadan çökme → ikinci deneme kilitlenmez, aynı Attempt kabul edilir ve öğe işlenir', async () => {
    const clock = new FakeClock()
    const { repo, motor } = await fresh(clock)
    const atom = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Atom.', prompt: 'Atom?' })
    await study(motor, atom.id)
    clock.advance(DAY)
    const item = await motor.captureInbox({ rawText: 'Unuttum' })

    // ilk deneme: Attempt yazılır, status yazımı patlar (çökme benzetimi)
    const realPut = repo.putInbox.bind(repo)
    let boom = true
    repo.putInbox = async (i: InboxItem) => { if (boom && i.status === 'processed') { boom = false; throw new Error('çökme') } return realPut(i) }
    await expect(motor.processInbox({ itemId: item.id, atomId: atom.id, reason: 'forgot' })).rejects.toThrow(/çökme/)
    expect((await repo.listAttempts()).some((a) => a.id === externalAttemptId(item.id))).toBe(true)
    expect((await motor.listInbox())[0]!.status).toBe('pending')

    // ikinci deneme: DuplicateAttemptError yüzünden ölmez; iş tamamlanır, İKİNCİ bir Attempt yazılmaz
    const out = await motor.processInbox({ itemId: item.id, atomId: atom.id, reason: 'forgot' })
    expect(out.attempt!.id).toBe(externalAttemptId(item.id))
    expect(out.item.status).toBe('processed')
    expect((await repo.listAttempts()).filter((a) => a.id === externalAttemptId(item.id))).toHaveLength(2 - 1)
    expect(motor.listAttempts().filter((a) => a.mode === 'external')).toHaveLength(1)
  })

  it('C2: ölçüm yazılmayan yakalama atomu kendi konusunda sıranın başına alır (05 §2 Learning Capture)', async () => {
    const { motor } = await fresh()
    const a1 = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Birinci.', prompt: 'Birinci?' })
    await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'İkinci.', prompt: 'İkinci?' })
    const a3 = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Üçüncü.', prompt: 'Üçüncü?' })
    const before = (await motor.today()).queue.map((q) => q.atomId)
    expect(before[0]).toBe(a1.id)
    const item = await motor.captureInbox({ rawText: 'Bunu öğrenmek istiyorum' })
    await motor.processInbox({ itemId: item.id, atomId: a3.id })
    const after = (await motor.today()).queue.map((q) => q.atomId)
    expect(after[0]).toBe(a3.id) // öne alındı
    // ölçüm yazan yolda sıra değişmez
    const c = await motor.content()
    expect(c.atoms.find((a) => a.id === a1.id)!.sortOrder).toBe(1)
  })

  it('C3: köken tip seçilmese de yazılır; not kaybolmaz ve işlemede atoma geçer', async () => {
    const { motor } = await fresh()
    const atom = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Atom.', prompt: 'Atom?' })
    const item = await motor.captureInbox({ rawText: 'Bu soruyu yedim', note: '2026 AGS deneme 3, soru 34' })
    expect(item.provenance).toMatchObject({ type: 'kendi', note: '2026 AGS deneme 3, soru 34', date: item.capturedAt })
    await motor.processInbox({ itemId: item.id, atomId: atom.id })
    const saved = (await motor.content()).atoms.find((a) => a.id === atom.id)!
    expect(saved.provenance).toMatchObject([{ type: 'kendi', note: '2026 AGS deneme 3, soru 34' }])
  })

  it('C4: yedek doğrulaması — external yalnız RecallAttempt ve yalnız "again" olabilir', async () => {
    const clock = new FakeClock()
    const { repo, motor } = await fresh(clock)
    const atom = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Atom.', prompt: 'Atom?' })
    await study(motor, atom.id)
    clock.advance(DAY)
    const item = await motor.captureInbox({ rawText: 'Unuttum' })
    await motor.processInbox({ itemId: item.id, atomId: atom.id, reason: 'forgot' })
    const file = await prepareBackup({ repo, clock, ids: motor.ids, hash: new WebCryptoHashService(), appVersion: '0.2.0' })
    expect(validateSnapshotV2(file.file).errors).toEqual([])

    const asQuestion = { ...file.file, events: { ...file.file.events, attempts: file.file.events.attempts.map((a) => (a.kind === 'question' ? { ...a, mode: 'external', support: null, responseTimeMs: null } : a)) } }
    const goodExternal = { ...file.file, events: { ...file.file.events, attempts: file.file.events.attempts.map((a) => (a.mode === 'external' ? { ...a, selfAssessment: 'good' } : a)) } }
    expect(validateSnapshotV2(goodExternal as never).errors.join(' ')).toMatch(/external RecallAttempt\.selfAssessment/)
    const qErrors = validateSnapshotV2(asQuestion as never).errors.join(' ')
    if (file.file.events.attempts.some((a) => a.kind === 'question')) expect(qErrors).toMatch(/external mod yalnız RecallAttempt/)
  })

  it('C5: confusable ilişkisi yalnız "Karıştırdım" dalında; merak/arşivli atomda yazılmaz', async () => {
    const clock = new FakeClock()
    const { repo, motor } = await fresh(clock)
    const a = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Karlofça 1699.', prompt: 'Karlofça?' })
    const b = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Pasarofça 1718.', prompt: 'Pasarofça?' })
    await study(motor, a.id)
    clock.advance(DAY)
    const i1 = await motor.captureInbox({ rawText: 'Merak' })
    const o1 = await motor.processInbox({ itemId: i1.id, atomId: a.id, reason: 'curious', confusedWithAtomId: b.id })
    expect(o1.relationAdded).toBe(false)
    expect(await repo.listAtomRelations()).toEqual([])

    await motor.repo.archiveAtom(b.id)
    await motor.refresh()
    const i2 = await motor.captureInbox({ rawText: 'Karıştı' })
    await expect(motor.processInbox({ itemId: i2.id, atomId: a.id, reason: 'confused', confusedWithAtomId: b.id })).rejects.toThrow(/Arşivlenmiş atomla/)
    expect(await repo.listAtomRelations()).toEqual([])
    expect((await motor.listInbox()).find((x) => x.id === i2.id)!.status).toBe('pending') // hata → işlenmedi
  })
})
