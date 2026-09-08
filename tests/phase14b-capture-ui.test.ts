// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Motor } from '../src/app/motor'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { DAY, FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 14b — Kutu ekranları (05 §3): yakalama ölçüm yazmaz; neden sorusu yalnız F01 koşulunda çıkar;
// "Yanlış yaptım" emin sorusu olmadan kaydedilemez.

const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim().startsWith(label))!
const click = async (el: HTMLElement) => { el.click(); await flush() }
const screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null

let handle: AppHandle | null = null
let root: HTMLDivElement
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

async function setup(clock = new FakeClock()) {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  const atom = await motor.addAtom({ subjectName: 'Tarih', topicName: 'K', text: 'Küçük Kaynarca 1774.', prompt: 'Küçük Kaynarca hangi yıl?' })
  handle = mountApp(root, { motor, appVersion: '0.2.0' })
  await flush()
  return { motor, repo, atom, clock }
}

async function studyAtom(motor: Motor, atomId: string) {
  const session = motor.startSession(null)
  await motor.next(session)
  const pres = await motor.presentAtom(atomId)
  if (pres.kind !== 'recall') throw new Error('kart bekleniyordu')
  await motor.answerRecall(session, pres, { selfAssessment: 'good', hookShown: false, responseTimeMs: 400 })
}

describe('Kutu ekranları', () => {
  it('+ Yakala → kutuya at: hiçbir ölçüm yazılmaz; Bugün düğmesinde bekleyen sayısı görünür', async () => {
    const { motor } = await setup()
    await click(byTestId('to-capture')!)
    expect(screen()).toBe('capture')
    const t = byTestId('capture-text') as HTMLTextAreaElement
    t.value = 'Ahmet sordu: Küçük Kaynarca hangi yıl?'
    t.dispatchEvent(new Event('input'))
    const sel = document.querySelector<HTMLSelectElement>('select[aria-label="Nereden"]')!
    sel.value = 'kisi'
    sel.dispatchEvent(new Event('change'))
    await click(byTestId('save-capture')!)
    expect(screen()).toBe('today')
    expect(document.body.textContent).toContain('hiçbir ölçüm yazılmadı')
    expect(motor.listAttempts()).toHaveLength(0)
    expect(byTestId('to-inbox')!.textContent).toBe('Kutu · 1')
    const item = (await motor.listInbox())[0]!
    expect(item).toMatchObject({ status: 'pending' })
    expect(item.provenance?.type).toBe('kisi')
  })

  it('hafıza durumu yoksa neden sorulmaz; Kaydet ölçüm yazmadan işler', async () => {
    const { motor, atom } = await setup()
    await motor.captureInbox({ rawText: 'Bunu bilemedim' })
    await click(byTestId('to-inbox')!)
    expect(screen()).toBe('inbox')
    await click(byText('İşle'))
    await click(document.querySelector<HTMLElement>(`[data-pick-atom="${atom.id}"]`)!)
    expect(byTestId('no-reason')).not.toBeNull()
    expect(byTestId('reason-block')).toBeNull()
    await click(byTestId('save-process')!)
    expect(document.body.textContent).toContain('ölçüm yazılmadı')
    expect(motor.listAttempts()).toHaveLength(0)
    expect((await motor.listInbox()).every((i) => i.status === 'processed')).toBe(true)
  })

  it('hafıza durumu varsa neden çıkar; "Yanlış yaptım" emin cevabı verilmeden kaydedilemez; sonra external again yazılır', async () => {
    const clock = new FakeClock()
    const { motor, atom } = await setup(clock)
    await studyAtom(motor, atom.id)
    clock.advance(DAY)
    await motor.captureInbox({ rawText: 'Denemede yanlış yaptım' })
    await click(byTestId('to-inbox')!)
    await click(byText('İşle'))
    await click(document.querySelector<HTMLElement>(`[data-pick-atom="${atom.id}"]`)!)
    expect(byTestId('reason-block')).not.toBeNull()
    expect((byTestId('save-process') as HTMLButtonElement).disabled).toBe(true) // neden seçilmeden kaydedilemez
    await click(document.querySelector<HTMLElement>('[data-reason="wrong"]')!)
    expect(byTestId('sure-block')).not.toBeNull()
    expect((byTestId('save-process') as HTMLButtonElement).disabled).toBe(true) // "emin miydin?" cevaplanmadan da hayır
    await click(byTestId('sure-yes')!)
    expect((byTestId('save-process') as HTMLButtonElement).disabled).toBe(false)
    await click(byTestId('save-process')!)
    expect(document.body.textContent).toContain('dış başarısızlık kaydedildi')
    const atts = motor.listAttempts()
    expect(atts).toHaveLength(2)
    expect(atts[1]).toMatchObject({ mode: 'external', selfAssessment: 'again', confidenceAtFailure: 'sure', support: null, responseTimeMs: null })
    expect((await motor.listInbox()).filter((i) => i.status === 'pending')).toHaveLength(0)
  })

  it('"Merak ettim" ölçüm yazmaz; At kutudan çıkarır', async () => {
    const clock = new FakeClock()
    const { motor, atom } = await setup(clock)
    await studyAtom(motor, atom.id)
    clock.advance(DAY)
    await motor.captureInbox({ rawText: 'Merak ettim' })
    await motor.captureInbox({ rawText: 'Atılacak' })
    await click(byTestId('to-inbox')!)
    expect(document.querySelectorAll('[data-inbox]')).toHaveLength(2)
    await click(byText('At')) // en yeni öğe
    expect(document.querySelectorAll('[data-inbox]')).toHaveLength(1)
    await click(byText('İşle'))
    await click(document.querySelector<HTMLElement>(`[data-pick-atom="${atom.id}"]`)!)
    await click(document.querySelector<HTMLElement>('[data-reason="curious"]')!)
    await click(byTestId('save-process')!)
    expect(motor.listAttempts()).toHaveLength(1) // yalnız çalışma sırasındaki kayıt
    expect(document.body.textContent).toContain('ölçüm yazılmadı')
  })
})
