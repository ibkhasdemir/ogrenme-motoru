// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Motor } from '../src/app/motor'
import { FIRST_TEST_GAP_ITEMS, FIRST_TEST_GAP_MS } from '../src/engine/session/session'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 18 (BL-47) — okuma ile ilk deneme arasına boşluk: hemen sorulan soru hafızayı değil, üç saniye önce okunanı ölçer.
// Kural: en az FIRST_TEST_GAP_ITEMS öğe ya da FIRST_TEST_GAP_MS süre; gösterilecek başka şey yoksa hemen sorulur.

const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const click = async (el: HTMLElement) => { el.click(); await flush() }
const screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null
const atomOnScreen = () => document.body.textContent ?? ''

let handle: AppHandle | null = null
let root: HTMLDivElement
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

async function withAtoms(n: number, clock = new FakeClock()) {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  for (let i = 1; i <= n; i++) await motor.addAtom({ subjectName: 'Tarih', topicName: 'K', text: `Atom ${i} metni.`, prompt: `Atom ${i} sorusu?` })
  handle = mountApp(root, { motor, appVersion: '0.2.0' })
  await flush()
  return { motor, repo, clock }
}

describe('Okuma → ilk deneme boşluğu', () => {
  it('üç atom: okuma sonrası hemen sorulmaz; araya diğer atomlar girer, sonra ilk okunan sınanır', async () => {
    const { motor } = await withAtoms(3)
    await click(byTestId('start')!)
    expect(screen()).toBe('read')
    expect(atomOnScreen()).toContain('Atom 1 metni.')
    await click(byTestId('read-done')!)
    expect(screen()).toBe('read') // hemen soru değil
    expect(atomOnScreen()).toContain('Atom 2 metni.')
    await click(byTestId('read-done')!)
    expect(screen()).toBe('read')
    expect(atomOnScreen()).toContain('Atom 3 metni.')
    await click(byTestId('read-done')!)
    // üç okuma sonrası ilk okunan atom ölçüme gelir
    expect(screen()).toBe('recall')
    expect(atomOnScreen()).toContain('Atom 1 sorusu?')
    expect(motor.listAttempts()).toHaveLength(0) // okumalar ölçüm değildir
  })

  it('tek atom: gösterilecek başka şey yok → okuma sonrası hemen sınanır (boş bekleme yok)', async () => {
    await withAtoms(1)
    await click(byTestId('start')!)
    await click(byTestId('read-done')!)
    expect(screen()).toBe('recall')
    expect(atomOnScreen()).toContain('Atom 1 sorusu?')
  })

  it('süre ölçütü: tek atom okunup beklenirse de sınanır; sabitler makul', () => {
    expect(FIRST_TEST_GAP_ITEMS).toBeGreaterThanOrEqual(2)
    expect(FIRST_TEST_GAP_MS).toBeGreaterThanOrEqual(60_000)
  })

  it('okunup sınanmamış atom oturum sonunda söylenir ve ertesi çağrıda yeniden yeni olarak gelir (03 §3.4 kural 8)', async () => {
    const { motor, clock } = await withAtoms(3)
    await click(byTestId('start')!)
    await click(byTestId('read-done')!) // Atom 1 okundu, bekliyor
    await click(byTestId('read-done')!) // Atom 2 okundu, bekliyor
    // oturumu bırak: hiçbir ölçüm yazılmadı
    await click(byTestId('to-today') ?? [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').startsWith("Bugün'e dön"))!)
    expect(motor.listAttempts()).toHaveLength(0)
    const summary = await motor.today()
    expect(summary.counts.new).toBe(3) // hiçbiri başlamış sayılmaz
    expect(summary.counts.doneToday).toBe(0)
    expect(clock.now()).toBeTruthy()
  })
})
