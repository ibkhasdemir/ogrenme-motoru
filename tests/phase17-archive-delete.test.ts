// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Motor } from '../src/app/motor'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 17 (BL-46) — yanlış girilen içeriği temizleme: kaydırıp arşivle, arşivden geri getir,
// kalıcı silme YALNIZ hiç ölçülmemiş ve sorusu olmayan atomda (ham olay asla silinmez, A3).

const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim().startsWith(label))!
const click = async (el: HTMLElement) => { el.click(); await flush() }

let handle: AppHandle | null = null
let root: HTMLDivElement
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

async function seeded() {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
  const atom = await motor.addAtom({ subjectName: 'Tarih', topicName: 'K', text: 'Yanlış girilmiş atom.', prompt: 'Yanlış?', hooks: [{ type: 'logic', content: 'çengel' }] })
  return { repo, motor, atom }
}

async function studied(motor: Motor, atomId: string) {
  const session = motor.startSession(null)
  await motor.next(session)
  const pres = await motor.presentAtom(atomId)
  if (pres.kind !== 'recall') throw new Error('kart bekleniyordu')
  await motor.answerRecall(session, pres, { selfAssessment: 'good', hookShown: false, responseTimeMs: 200 })
}

describe('Motor — arşiv ve kalıcı silme kuralları', () => {
  it('hiç çalışılmamış, sorusuz atom kalıcı silinir; çengelleri de gider', async () => {
    const { repo, motor, atom } = await seeded()
    expect(motor.hasHistory(atom.id)).toBe(false)
    await motor.deleteAtomPermanently(atom.id)
    const c = await motor.content()
    expect(c.atoms).toHaveLength(0)
    expect(c.hooks).toHaveLength(0)
    expect(await repo.listAttempts()).toHaveLength(0)
  })

  it('öğrenme geçmişi olan atom silinemez; arşivlenir ve geri getirilebilir; ham kayıt durur', async () => {
    const { motor, atom } = await seeded()
    await studied(motor, atom.id)
    expect(motor.hasHistory(atom.id)).toBe(true)
    await expect(motor.deleteAtomPermanently(atom.id)).rejects.toThrow(/öğrenme geçmişi var/)
    await motor.archiveAtom(atom.id)
    expect((await motor.content()).atoms[0]!.archived).toBe(true)
    expect((await motor.today()).queue).toHaveLength(0) // kuyruktan çıktı
    expect(motor.listAttempts()).toHaveLength(1) // ham kayıt korunur
    await motor.unarchiveAtom(atom.id)
    expect((await motor.content()).atoms[0]!.archived).toBe(false)
  })

  it('sorusu olan atom önce soruyu ister; bilinmeyen atom hata', async () => {
    const { motor, atom } = await seeded()
    await motor.addQuestion({ primaryAtomId: atom.id, source: 'kendi', text: 'Soru?', options: ['a', 'b'], correctIndex: 0 })
    await expect(motor.deleteAtomPermanently(atom.id)).rejects.toThrow(/sorusu var/)
    await expect(motor.deleteAtomPermanently('yok')).rejects.toThrow(/Atom bulunamadı/)
  })

  it('geri alınmış (void) kayıt da geçmiş sayılır: silme yine reddedilir', async () => {
    const { motor, atom } = await seeded()
    const session = motor.startSession(null)
    await motor.next(session)
    const pres = await motor.presentAtom(atom.id)
    if (pres.kind !== 'recall') throw new Error('kart bekleniyordu')
    const { token } = await motor.answerRecall(session, pres, { selfAssessment: 'again', hookShown: false, responseTimeMs: 100 })
    expect(await motor.undo(session, token!)).toBe(true)
    expect(motor.memory.has(atom.id)).toBe(false) // hafıza etkisi geri alındı
    expect(motor.hasHistory(atom.id)).toBe(true) // ama ham kayıt duruyor
    await expect(motor.deleteAtomPermanently(atom.id)).rejects.toThrow(/öğrenme geçmişi var/)
  })
})

describe('Ekran — kaydırma satırı ve arşiv görünümü', () => {
  it('listede kaydırma eylemi arşivler; Arşiv görünümünde geri getirir', async () => {
    const { motor, atom } = await seeded()
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    document.querySelector<HTMLDetailsElement>('details[data-group]')!.open = true
    expect(document.querySelector('.swipe-row')).not.toBeNull()
    await click(byTestId(`archive-${atom.id}`)!)
    expect(document.body.textContent).toContain('Atom arşivlendi')
    expect(document.querySelectorAll('[data-atom]')).toHaveLength(0)
    await click(byTestId('to-archived')!)
    expect(document.body.textContent).toContain('Yanlış girilmiş atom.')
    await click(byTestId(`unarchive-${atom.id}`)!)
    expect(document.body.textContent).toContain('Atom geri getirildi.')
    expect((await motor.content()).atoms[0]!.archived).toBe(false)
  })

  it('atom ekranı: geçmişi olmayan atomda "Kalıcı sil"; geçmişi olanda gerekçeli açıklama', async () => {
    const { motor, atom } = await seeded()
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    document.querySelector<HTMLDetailsElement>('details[data-group]')!.open = true
    await click(document.querySelector<HTMLElement>(`[data-atom="${atom.id}"]`)!)
    expect(byTestId('delete-atom')).not.toBeNull()
    expect(byTestId('no-delete')).toBeNull()
    await click(byTestId('delete-atom')!)
    expect(document.body.textContent).toContain('kalıcı olarak silindi')
    expect((await motor.content()).atoms).toHaveLength(0)

    // geçmişi olan atom: silme düğmesi yerine gerekçe
    const a2 = await motor.addAtom({ subjectName: 'Tarih', topicName: 'K', text: 'Çalışılmış atom.', prompt: 'Çalışılmış?' })
    await studied(motor, a2.id)
    await handle!.ctx.navigate({ name: 'content', view: { kind: 'list' } }) // zaten içerik ekranındayız; listeyi tazele
    await flush()
    document.querySelector<HTMLDetailsElement>('details[data-group]')!.open = true
    await click(document.querySelector<HTMLElement>(`[data-atom="${a2.id}"]`)!)
    expect(byTestId('delete-atom')).toBeNull()
    expect(byTestId('no-delete')!.textContent).toContain('öğrenme geçmişi var')
  })
})
