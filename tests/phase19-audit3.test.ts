// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareBackup } from '../src/app/backup'
import { Motor } from '../src/app/motor'
import { atomStats } from '../src/engine/analysis/stats'
import { validateSnapshotV2 } from '../src/engine/backup/validate'
import { WebCryptoHashService } from '../src/platform/web/hash'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { DAY, FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 19 — üçüncü bağımsız denetimde (2026-09-09) bulunan 7 hata için gerileme testleri.

const flush = async (n = 16) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim().startsWith(label))!
const click = async (el: HTMLElement) => { el.click(); await flush() }
const screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null

let handle: AppHandle | null = null
let root: HTMLDivElement
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

async function twoMotors(clock = new FakeClock()) {
  const repo = new MemoryRepository(fakeIds('gen'))
  const a = await Motor.create({ repo, clock, ids: fakeIds('a') })
  const b = await Motor.create({ repo, clock, ids: fakeIds('b') })
  return { repo, a, b, clock }
}

/** atomu bir kez doğru cevapla (soru ya da kart olarak sunulabilir) */
async function study(motor: Motor, atomId: string) {
  const session = motor.startSession(null)
  await motor.next(session)
  const pres = await motor.presentAtom(atomId)
  if (pres.kind === 'question') {
    await motor.answerQuestion(session, pres, {
      initialSelectedOptionId: pres.revision.correctOptionId, selectedOptionId: pres.revision.correctOptionId,
      confidence: 'sure', responseTimeMs: 200,
    })
    return
  }
  if (pres.kind !== 'recall') throw new Error(`soru ya da kart bekleniyordu: ${pres.kind}`)
  await motor.answerRecall(session, pres, { selfAssessment: 'good', hookShown: false, responseTimeMs: 200 })
}

describe('Kalıcı silme güvenliği', () => {
  it('A1: başka bağlamda yazılan kayıt görülür — bayat listeyle silinmez, yedek doğrulaması bozulmaz', async () => {
    const { repo, a, b } = await twoMotors()
    const atom = await a.addAtom({ subjectName: 'T', topicName: 'K', text: 'Atom.', prompt: 'Atom?' })
    await b.refresh()
    await study(a, atom.id) // A sekmesi cevap yazdı; B'nin belleği bayat
    expect(b.hasHistory(atom.id)).toBe(false) // bayat görünüm
    await expect(b.deleteAtomPermanently(atom.id)).rejects.toThrow(/öğrenme geçmişi var/) // yine de silmez
    const file = await prepareBackup({ repo, clock: a.clock, ids: a.ids, hash: new WebCryptoHashService(), appVersion: '0.2.0' })
    expect(validateSnapshotV2(file.file).errors).toEqual([]) // yetim Attempt yok
  })

  it('A2: ikincil atom / yanlış-şık bağı / karıştırma ilişkisi de silmeyi engeller (yetim referans kalmaz)', async () => {
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    const main = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Ana atom.', prompt: 'Ana?' })
    const second = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'İkincil atom.', prompt: 'İkincil?' })
    const other = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Karışan atom.', prompt: 'Karışan?' })
    await motor.addQuestion({ primaryAtomId: main.id, source: 'kendi', text: 'Soru?', options: ['a', 'b'], correctIndex: 0, secondaryAtomIds: [second.id] })
    await expect(motor.deleteAtomPermanently(second.id)).rejects.toThrow(/ikincil atom/)

    await study(motor, main.id)
    const item = await motor.captureInbox({ rawText: 'karıştı' })
    await motor.processInbox({ itemId: item.id, atomId: main.id, reason: 'confused', confusedWithAtomId: other.id })
    await expect(motor.deleteAtomPermanently(other.id)).rejects.toThrow(/karıştırma ilişkisi/)

    const file = await prepareBackup({ repo, clock: motor.clock, ids: motor.ids, hash: new WebCryptoHashService(), appVersion: '0.2.0' })
    expect(validateSnapshotV2(file.file).errors).toEqual([])
  })
})

describe('Gezinme', () => {
  async function app() {
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Atom.', prompt: 'Atom?' })
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    return { motor }
  }

  it('A3: aynı ekran içinde durum değişince yığın tepesi güncellenir (geri doğru ekrana döner)', async () => {
    const { motor } = await app()
    const atomId = (await motor.content()).atoms[0]!.id
    await click(byText('İçerik'))
    await handle!.ctx.navigate({ name: 'content', view: { kind: 'atom', atomId } }) // aynı ekran türü → replace
    await flush()
    expect(screen()).toBe('content-atom')
    await click(byText('← İçerik'))
    await handle!.ctx.navigate({ name: 'data' })
    await flush()
    history.back()
    await flush(30)
    expect(screen()).toBe('content') // liste (son durum), eski atom ekranı değil
  })

  it('A4: geri sonra ileri doğru ekrana götürür (yığın ikinci kez düşmez)', async () => {
    await app()
    await click(byText('Veri'))
    expect(screen()).toBe('data')
    await handle!.ctx.navigate({ name: 'content', view: { kind: 'list' } })
    await flush()
    expect(screen()).toBe('content')
    history.back()
    await flush(30)
    expect(screen()).toBe('data')
    history.forward()
    await flush(30)
    expect(screen()).toBe('content')
  })

  it('A5: kilit ekranı geri hareketiyle terk edilemez', async () => {
    await app()
    await click(byText('Veri'))
    await handle!.ctx.lockdown('yarım kalan geri yükleme', 'job-1')
    await flush()
    expect(screen()).toBe('lockdown')
    history.back()
    await flush(30)
    expect(screen()).toBe('lockdown')
  })
})

describe('İlerleme sayımı', () => {
  it('A6: streak ve son deneme zaman ekseninde (geçmiş tarihli dış başarısızlık sırayı bozmaz)', async () => {
    const clock = new FakeClock()
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
    const atom = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Atom.', prompt: 'Atom?' })
    const item = await motor.captureInbox({ rawText: 'dışarıda unuttum' }) // 1. gün
    clock.advance(DAY)
    await study(motor, atom.id) // 2. gün: doğru
    clock.advance(DAY)
    await motor.processInbox({ itemId: item.id, atomId: atom.id, reason: 'forgot' }) // 3. gün işlendi, zamanı 1. gün
    const stats = atomStats({ attempts: motor.listAttempts(), voids: motor.listVoids(), atoms: [], topics: [], subjects: [] })
    expect(stats[0]!.failStreak).toBe(0) // zamana göre son deneme başarılı
    expect(stats[0]!.lastAt).toBe(motor.listAttempts().find((a) => a.mode !== 'external')!.timestamp)
  })

  it('A7: arşivlenen atom özetten de listelerden de düşer (bölümler tutarlı)', async () => {
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    const atom = await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Yanlış atom.', prompt: 'Yanlış?' })
    const session = motor.startSession(null)
    await motor.next(session)
    const pres = await motor.presentAtom(atom.id)
    if (pres.kind !== 'recall') throw new Error('kart bekleniyordu')
    await motor.answerRecall(session, pres, { selfAssessment: 'again', hookShown: false, responseTimeMs: 100 })
    await motor.archiveAtom(atom.id)
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İlerleme'))
    expect(document.querySelector('[data-section="summary"]')!.textContent).toContain('Cevaplanan0')
    expect(document.querySelector('[data-section="hardest"]')).toBeNull()
    expect(document.querySelector('[data-section="topics"]')).toBeNull()
    expect(byTestId('lifetime')!.textContent).toBe('Henüz hiç cevap yok.')
  })
})
