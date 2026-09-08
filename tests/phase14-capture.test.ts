import { describe, expect, it } from 'vitest'
import { Motor } from '../src/app/motor'
import { buildExternalRecallAttempt, externalAttemptId, hadMemoryAt, reasonProducesAttempt } from '../src/engine/capture/capture'
import { ratingFor } from '../src/engine/evidence/policy'
import { serializeMemory } from '../src/engine/rebuild/rebuild'
import { prepareBackup } from '../src/app/backup'
import { validateBackupFile, validateSnapshotV2 } from '../src/engine/backup/validate'
import { WebCryptoHashService } from '../src/platform/web/hash'
import { EVIDENCE_POLICY_V1 } from '../src/domain'
import type { AttemptVoid, InboxItem, RecallAttempt } from '../src/domain'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { DAY, FakeClock, MIN, fakeIds } from './helpers/engineFixture'

// Phase 14 (05_LEARNING_CAPTURE; BL-41) — Öğrenme Kutusu: yakalama ölçüm değildir (A17); yalnız hafıza durumu OLAN atomun
// gerçek başarısızlığı external RecallAttempt üretir (05 §2); F01 üç zaman; F02 null alanlar ve tekrar-güvenlik.

async function fresh(clock = new FakeClock()) {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  return { repo, motor, clock }
}

/** atomu bir kez çalış → hafıza durumu oluşsun */
async function study(motor: Motor, atomId: string) {
  const session = motor.startSession(null)
  await motor.next(session)
  const pres = await motor.presentAtom(atomId)
  if (pres.kind !== 'recall') throw new Error('kart bekleniyordu')
  await motor.answerRecall(session, pres, { selfAssessment: 'good', hookShown: false, responseTimeMs: 500 })
}

describe('Yakalama çekirdeği (saf)', () => {
  const item: InboxItem = { id: 'ib-1', rawText: 'Küçük Kaynarca hangi yıl?', capturedAt: '2026-09-08T10:00:00.000Z', status: 'pending' }

  it('merak Attempt üretmez; diğer üç neden üretir', () => {
    expect(reasonProducesAttempt('curious')).toBe(false)
    for (const r of ['forgot', 'wrong', 'confused'] as const) expect(reasonProducesAttempt(r)).toBe(true)
    expect(() => buildExternalRecallAttempt({ item, atomId: 'a1', reason: 'curious', sessionId: 's' })).toThrow(/Merak yakalaması/)
  })

  it('external RecallAttempt: again + external; responseTimeMs ve support null (F02); timestamp = yakalama anı; id kutu öğesinden', () => {
    const a = buildExternalRecallAttempt({ item, atomId: 'a1', reason: 'forgot', sessionId: 's' })
    expect(a).toMatchObject({
      kind: 'recall', mode: 'external', selfAssessment: 'again', confidence: null,
      support: null, responseTimeMs: null, timestamp: item.capturedAt, atomId: 'a1', primaryAtomIdAtAttempt: 'a1',
      sourceInboxItemId: 'ib-1', id: externalAttemptId('ib-1'),
    })
    expect('confidenceAtFailure' in a).toBe(false)
    expect(ratingFor({ ...a, sequence: 1 }, EVIDENCE_POLICY_V1)).toBe(1) // policy yalnız selfAssessment'a bakar
  })

  it('"Yanlış yaptım" → confidenceAtFailure yapılandırılmış alanda (sure/unsure); işlenmiş öğe ikinci kez üretmez', () => {
    expect(buildExternalRecallAttempt({ item, atomId: 'a1', reason: 'wrong', sureAtFailure: true, sessionId: 's' }).confidenceAtFailure).toBe('sure')
    expect(buildExternalRecallAttempt({ item, atomId: 'a1', reason: 'wrong', sureAtFailure: false, sessionId: 's' }).confidenceAtFailure).toBe('unsure')
    expect(buildExternalRecallAttempt({ item, atomId: 'a1', reason: 'confused', sessionId: 's' }).confidenceAtFailure).toBeUndefined()
    expect(() => buildExternalRecallAttempt({ item: { ...item, status: 'processed' }, atomId: 'a1', reason: 'forgot', sessionId: 's' })).toThrow(/zaten işlenmiş/)
  })

  it('hadMemoryAt (F01): başarısızlık anına bakar, işleme anına değil; void edilmiş deneme sayılmaz', () => {
    const base = { kind: 'recall' as const, sessionId: 's', confidence: null, operation: 'recall' as const, support: 'none' as const, responseTimeMs: 10, selfAssessment: 'good' as const }
    const att = [{ ...base, id: 'at-1', sequence: 1, timestamp: '2026-09-08T12:00:00.000Z', primaryAtomIdAtAttempt: 'a1', atomId: 'a1' }] as unknown as RecallAttempt[]
    expect(hadMemoryAt('a1', '2026-09-08T11:00:00.000Z', att, [])).toBe(false) // pazartesi: henüz öğrenilmemiş
    expect(hadMemoryAt('a1', '2026-09-08T13:00:00.000Z', att, [])).toBe(true)
    expect(hadMemoryAt('a2', '2026-09-08T13:00:00.000Z', att, [])).toBe(false)
    const voids = [{ id: 'v1', targetAttemptId: 'at-1', sequence: 2, timestamp: '2026-09-08T12:30:00.000Z', reason: 'user_undo', sessionId: 's' }] as unknown as AttemptVoid[]
    expect(hadMemoryAt('a1', '2026-09-08T13:00:00.000Z', att, voids)).toBe(false)
  })
})

describe('Motor — kutu akışı', () => {
  it('yakala → kutuda pending; düzenlenebilir; atılabilir; hiçbir ham olay yazılmaz', async () => {
    const { motor } = await fresh()
    const item = await motor.captureInbox({ rawText: '  Ahmet sordu: Küçük Kaynarca hangi yıl?  ', provenanceType: 'kisi', note: 'kantinde', context: 'teneffüs' })
    expect(item).toMatchObject({ rawText: 'Ahmet sordu: Küçük Kaynarca hangi yıl?', status: 'pending' })
    expect(item.provenance).toMatchObject({ type: 'kisi', note: 'kantinde', context: 'teneffüs', date: item.capturedAt })
    expect(motor.listAttempts()).toHaveLength(0)
    expect(motor.memory.size).toBe(0)
    const edited = await motor.editInbox(item.id, 'Küçük Kaynarca hangi yıl imzalandı?')
    expect(edited.rawText).toBe('Küçük Kaynarca hangi yıl imzalandı?')
    await expect(motor.captureInbox({ rawText: '   ' })).rejects.toThrow(/boş olamaz/)
    const other = await motor.captureInbox({ rawText: 'Atılacak' })
    await motor.discardInbox(other.id)
    expect((await motor.listInbox()).map((x) => x.status).sort()).toEqual(['discarded', 'pending'])
    expect(motor.listAttempts()).toHaveLength(0)
  })

  it('hafıza durumu YOKSA hiçbir neden Attempt üretmez (A5/A11: sahte başarısızlık yazılmaz); köken atoma işlenir', async () => {
    const { motor } = await fresh()
    const atom = await motor.addAtom({ subjectName: 'Tarih', topicName: 'K', text: 'Küçük Kaynarca 1774.', prompt: 'Küçük Kaynarca hangi yıl?' })
    const item = await motor.captureInbox({ rawText: 'Bunu bilemedim', provenanceType: 'deneme', note: 'AGS deneme 3' })
    expect(motor.askReasonFor(atom.id, item.capturedAt)).toBe(false) // neden sorusu hiç sorulmaz
    const out = await motor.processInbox({ itemId: item.id, atomId: atom.id, reason: 'forgot' })
    expect(out.attempt).toBeNull()
    expect(motor.listAttempts()).toHaveLength(0)
    expect(motor.memory.size).toBe(0)
    expect(out.item.status).toBe('processed')
    const c = await motor.content()
    expect(c.atoms.find((a) => a.id === atom.id)!.provenance).toMatchObject([{ type: 'deneme', note: 'AGS deneme 3' }])
    await expect(motor.processInbox({ itemId: item.id, atomId: atom.id })).rejects.toThrow(/zaten işlenmiş/)
  })

  it('hafıza durumu VARSA "Hatırlayamadım" external again yazar; vade öne çeker; ham kayıt korunur', async () => {
    const clock = new FakeClock()
    const { motor, repo } = await fresh(clock)
    const atom = await motor.addAtom({ subjectName: 'Tarih', topicName: 'K', text: 'Küçük Kaynarca 1774.', prompt: 'Küçük Kaynarca hangi yıl?' })
    await study(motor, atom.id)
    const dueBefore = motor.memory.get(atom.id)!.due
    clock.advance(2 * DAY)
    const item = await motor.captureInbox({ rawText: 'Denemede çıktı, hatırlayamadım' })
    expect(motor.askReasonFor(atom.id, item.capturedAt)).toBe(true)
    const out = await motor.processInbox({ itemId: item.id, atomId: atom.id, reason: 'forgot' })
    expect(out.attempt).toMatchObject({ mode: 'external', selfAssessment: 'again', support: null, responseTimeMs: null, timestamp: item.capturedAt })
    const stored = (await repo.listAttempts()).find((a) => a.id === out.attempt!.id)!
    expect(stored.sequence).toBeGreaterThan(0)
    expect(Date.parse(motor.memory.get(atom.id)!.due)).toBeLessThan(Date.parse(dueBefore) + 365 * DAY)
    expect(motor.memory.get(atom.id)!.lastAttemptKind).toBe('recall')
    // REBUILD sonrası aynı sonuç (türetilmiş durum diske yazılmaz)
    const before = serializeMemory(motor.memory)
    await motor.refresh()
    expect(serializeMemory(motor.memory)).toBe(before)
  })

  it('F01: başarısızlık anında hafıza yoksa, işleme anında olsa bile Attempt yazılmaz', async () => {
    const clock = new FakeClock()
    const { motor } = await fresh(clock)
    const atom = await motor.addAtom({ subjectName: 'Tarih', topicName: 'K', text: 'Prut 1711.', prompt: 'Prut hangi yıl?' })
    const item = await motor.captureInbox({ rawText: 'Pazartesi bilemedim' }) // henüz öğrenilmemişti
    clock.advance(10 * MIN)
    await study(motor, atom.id) // salı öğrenildi
    clock.advance(10 * MIN)
    const attemptsBefore = motor.listAttempts().length
    const out = await motor.processInbox({ itemId: item.id, atomId: atom.id, reason: 'forgot' }) // çarşamba işlendi
    expect(out.attempt).toBeNull()
    expect(motor.listAttempts()).toHaveLength(attemptsBefore)
  })

  it('"Yanlış yaptım" + emin → confidenceAtFailure sure; "Karıştırdım" → confusable ilişkisi (onaylı)', async () => {
    const clock = new FakeClock()
    const { motor, repo } = await fresh(clock)
    const a = await motor.addAtom({ subjectName: 'Tarih', topicName: 'K', text: 'Karlofça 1699.', prompt: 'Karlofça hangi yıl?' })
    const b = await motor.addAtom({ subjectName: 'Tarih', topicName: 'K', text: 'Pasarofça 1718.', prompt: 'Pasarofça hangi yıl?' })
    await study(motor, a.id)
    clock.advance(DAY)
    const i1 = await motor.captureInbox({ rawText: 'Emindim ama yanlışmış' })
    const o1 = await motor.processInbox({ itemId: i1.id, atomId: a.id, reason: 'wrong', sureAtFailure: true })
    expect(o1.attempt!.confidenceAtFailure).toBe('sure')
    const i2 = await motor.captureInbox({ rawText: 'Karlofça ile Pasarofça karıştı' })
    const o2 = await motor.processInbox({ itemId: i2.id, atomId: a.id, reason: 'confused', confusedWithAtomId: b.id })
    expect(o2.relationAdded).toBe(true)
    expect(await repo.listAtomRelations()).toMatchObject([{ fromAtomId: a.id, toAtomId: b.id, type: 'confusable' }])
    expect(o2.attempt).toMatchObject({ mode: 'external', selfAssessment: 'again' })
    expect(o2.attempt!.confidenceAtFailure).toBeUndefined()
  })

  it('external Attempt taşıyan yedek doğrulamayı geçer (null alanlar kabul, başka modda değil)', async () => {
    const clock = new FakeClock()
    const { motor, repo } = await fresh(clock)
    const atom = await motor.addAtom({ subjectName: 'Tarih', topicName: 'K', text: 'Belgrad 1739.', prompt: 'Belgrad hangi yıl?' })
    await study(motor, atom.id)
    clock.advance(DAY)
    const item = await motor.captureInbox({ rawText: 'Unuttum' })
    await motor.processInbox({ itemId: item.id, atomId: atom.id, reason: 'forgot' })
    const hash = new WebCryptoHashService()
    const prepared = await prepareBackup({ repo, clock, ids: motor.ids, hash, appVersion: '0.2.0' })
    const ok = await validateBackupFile(prepared.file, hash, clock.now())
    expect(ok.ok).toBe(true)
    expect(prepared.file.content.inbox).toHaveLength(1) // kutu öğesi yedeğe girer (içerik)
    // aynı null'lar external OLMAYAN bir denemede kabul edilmez
    const snapshotErrors = validateSnapshotV2({
      ...prepared.file,
      events: { ...prepared.file.events, attempts: prepared.file.events.attempts.map((a) => (a.mode === 'external' ? a : { ...a, responseTimeMs: null, support: null })) },
    })
    expect(snapshotErrors.errors.join(' ')).toMatch(/responseTimeMs/)
    expect(snapshotErrors.errors.join(' ')).toMatch(/support/)
    expect(validateSnapshotV2(prepared.file).errors).toEqual([]) // external null'lar temiz geçer
  })
})
