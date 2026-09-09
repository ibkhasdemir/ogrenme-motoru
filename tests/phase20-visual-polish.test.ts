// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Motor } from '../src/app/motor'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { applyScreenTransition } from '../src/ui/transition'
import { FakeClock, fakeIds } from './helpers/engineFixture'
import { ROOT } from './helpers/scan'

// BL-50 "premium" görsel tur — geçiş hareketi (14 §14). Kural: hareket YALNIZ gerçek geçişte çalışır.
// İleri gidiş dokunulan noktadan büyür (push), geri gidiş uzaklaşarak gelir (pop), aynı ekranın adımı yumuşak belirir (fade),
// aynı ekranın yeniden çizimi (yazarken/odak korurken) sessizdir. Hareketin ölçüm ya da zamanlama üzerinde etkisi yoktur.

const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const screenEl = () => document.querySelector<HTMLElement>('[data-screen]')!
const screen = () => screenEl().getAttribute('data-screen')
const anim = () => [...screenEl().classList].filter((c) => c.startsWith('screen-'))
const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim().startsWith(label))!
const click = async (el: HTMLElement) => { el.click(); await flush() }
const tapAt = (x: number, y: number) => window.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }))

let handle: AppHandle | null = null
let root: HTMLDivElement
beforeEach(() => { root = document.createElement('div'); root.id = 'app'; document.body.appendChild(root) })
afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren(); vi.restoreAllMocks() })

async function app() {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
  await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Tanzimat Fermanı 1839 yılında ilan edildi.', prompt: 'Tanzimat Fermanı hangi yıl?' })
  handle = mountApp(root, { motor, appVersion: '0.2.0' })
  await flush()
  return { motor }
}

describe('BL-50 — ekran geçişi', () => {
  it('başka bir ekrana gidiş büyüyerek açılır (push)', async () => {
    await app()
    await click(byText('İçerik'))
    expect(screen()).toBe('content')
    expect(anim()).toEqual(['screen-push'])
  })

  it('İçerik içinde bir kademe inmek de büyüyerek açılır (aynı ekran adı, başka kademe)', async () => {
    const { motor } = await app()
    const atomId = (await motor.content()).atoms[0]!.id
    await click(byText('İçerik'))
    await handle!.ctx.navigate({ name: 'content', view: { kind: 'atom', atomId } })
    await flush()
    expect(screen()).toBe('content-atom')
    expect(anim()).toEqual(['screen-push'])
  })

  it('aynı ekranın yeniden çizimi sessizdir (arama yazarken ekran her tuşta yanıp sönmez)', async () => {
    await app()
    await click(byText('İçerik'))
    await handle!.ctx.navigate({ name: 'content', view: { kind: 'list', query: 'tan' } })
    await flush()
    expect(anim()).toEqual([])
    await handle!.render()
    await flush()
    expect(anim()).toEqual([])
  })

  it('geri hareketi uzaklaşarak gelir (pop), ileriye ait büyüme kullanılmaz', async () => {
    await app()
    await click(byText('Veri'))
    expect(anim()).toEqual(['screen-push'])
    history.back()
    await flush(30)
    expect(screen()).toBe('today')
    expect(anim()).toEqual(['screen-pop'])
  })

  it('aynı ekranın bir sonraki adımı yalnız belirir (fade)', async () => {
    await app()
    await click(byText('Başla'))
    expect(screen()).toBe('read')
    await handle!.ctx.navigate({ name: 'end', reason: 'empty', dueSoon: 0, sessionCount: 0, pendingFirstTests: 0 })
    await flush()
    expect(anim()).toEqual(['screen-push'])
    // oturum sonu ekranı kendi içinde tazelenirse (aynı ekran, aynı kademe) hareket yok
    await handle!.render()
    await flush()
    expect(anim()).toEqual([])
  })

  it('büyüme merkezi son dokunulan noktadır; nokta yoksa satır içi değer yazılmaz', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 40, left: 0, top: 40, right: 390, bottom: 800, width: 390, height: 760, toJSON: () => ({}) } as DOMRect)
    await app()
    tapAt(120, 300)
    await click(byText('İçerik'))
    expect(screenEl().style.getPropertyValue('--origin-x')).toBe('120px')
    expect(screenEl().style.getPropertyValue('--origin-y')).toBe('260px') // öğe kutusuna göre (300 - 40)
  })

  it('klavyeyle tetiklenen tık (0,0) merkez sayılmaz; CSS varsayılanı kullanılır', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 40, left: 0, top: 40, right: 390, bottom: 800, width: 390, height: 760, toJSON: () => ({}) } as DOMRect)
    await app()
    tapAt(0, 0)
    await click(byText('İçerik'))
    expect(screenEl().style.getPropertyValue('--origin-x')).toBe('')
  })

  it('animasyon bitince sınıf ve büyüme merkezi düşer (geride kalıcı transform kalmaz)', async () => {
    await app()
    tapAt(100, 200)
    await click(byText('İçerik'))
    const el = screenEl()
    expect(el.classList.contains('screen-push')).toBe(true)
    el.dispatchEvent(new Event('animationend'))
    expect(el.classList.contains('screen-push')).toBe(false)
    expect(el.style.getPropertyValue('--origin-x')).toBe('')
  })

  it('uygulama kapanınca dokunuş dinleyicisi kalmaz', async () => {
    const removed: string[] = []
    const spy = vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string) => { removed.push(type) }) as never)
    await app()
    handle!.destroy(); handle = null
    spy.mockRestore()
    expect(removed).toContain('pointerdown')
  })
})

describe('BL-52 — yapışkan başlık durumu', () => {
  it('sayfa kayınca başlık ayırıcı çizgiyi alır, tepeye dönünce bırakır', async () => {
    await app()
    await click(byText('İçerik'))
    const header = document.querySelector('.screen > .row:first-child')
    expect(header).not.toBeNull()
    expect(header!.classList.contains('is-stuck')).toBe(false)
    const scroller = document.scrollingElement ?? document.documentElement
    scroller.scrollTop = 120
    window.dispatchEvent(new Event('scroll'))
    expect(header!.classList.contains('is-stuck')).toBe(true)
    scroller.scrollTop = 0
    window.dispatchEvent(new Event('scroll'))
    expect(header!.classList.contains('is-stuck')).toBe(false)
  })

  it('uygulama kapanınca kaydırma dinleyicisi kalmaz', async () => {
    const removed: string[] = []
    const spy = vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string) => { removed.push(type) }) as never)
    await app()
    handle!.destroy(); handle = null
    spy.mockRestore()
    expect(removed).toContain('scroll')
  })
})

describe('BL-50 — hareket içeriği asla gizlemez (14 §1: okunabilirlik > süs)', () => {
  const css = readFileSync(join(ROOT, 'src', 'ui', 'styles.css'), 'utf8')

  it('geçiş kuralları animation-fill-mode kullanmaz: animasyon donarsa/başlamazsa ekran tam görünür kalır', () => {
    const lines = css.split(String.fromCharCode(10)).map((l) => l.trim())
    const rules = lines.filter((l) => ['.screen-push {', '.screen-pop {', '.screen-fade {'].some((p) => l.startsWith(p)))
    expect(rules).toHaveLength(3)
    for (const r of rules) for (const fill of ['both', 'backwards', 'forwards']) expect(r).not.toContain(` ${fill};`)
  })

  it('azaltılmış hareket tercihi üç geçişi de kapatır (§14)', () => {
    const block = css.slice(css.indexOf('.screen-push, .screen-pop, .screen-fade'))
    expect(block.slice(0, 80)).toMatch(/animation:\s*none/)
  })

  it('kademeli varış animation-delay KULLANMAZ (gecikme + fill-mode ikilemine düşmemek için)', () => {
    const lines = css.split(String.fromCharCode(10)).map((l) => l.trim())
    const cascade = lines.filter((l) => l.startsWith('.screen-push > *') || l.startsWith('.screen-fade > *'))
    expect(cascade.length).toBeGreaterThanOrEqual(6)
    for (const rule of cascade) {
      expect(rule).not.toContain('animation-delay')
      for (const fill of ['both', 'backwards', 'forwards']) expect(rule).not.toContain(` ${fill};`)
    }
  })

  it('ham hex YALNIZ :root bloklarında (11 kural 38): bileşenler token adı bilir', () => {
    const lines = css.split(String.fromCharCode(10))
    let inRoot = false
    const leaks: string[] = []
    for (const raw of lines) {
      const line = raw.trim()
      if (line.startsWith(':root')) inRoot = true
      else if (inRoot && line === '}') inRoot = false
      if (inRoot || line.startsWith('/*') || line.startsWith('*')) continue
      const HEX = '0123456789abcdefABCDEF'
      for (let i = line.indexOf('#'); i !== -1; i = line.indexOf('#', i + 1)) {
        const three = line.slice(i + 1, i + 4)
        if (three.length === 3 && [...three].every((c) => HEX.includes(c))) { leaks.push(line); break }
      }
    }
    expect(leaks).toEqual([])
  })

  it('BL-53: içeriden KABARCIKLANAN animationend geçişi kesmez (yalnız ekranın kendi animasyonu temizler)', () => {
    const el = document.createElement('div')
    el.className = 'screen'
    const child = document.createElement('p')
    el.appendChild(child)
    document.body.appendChild(el)
    applyScreenTransition(el, 'push')
    expect(el.classList.contains('screen-push')).toBe(true)
    // kademeli varıştaki en hızlı çocuk biter → olay ekrana kabarcıklanır; ekran sınıfını DÜŞÜRMEMELİ,
    // yoksa henüz bitmemiş bütün animasyonlar aynı anda kesilir ve ekran yarı yolda zıplar.
    child.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(el.classList.contains('screen-push')).toBe(true)
    // ekranın kendi animasyonu bitince temizlenir
    el.dispatchEvent(new Event('animationend'))
    expect(el.classList.contains('screen-push')).toBe(false)
    el.remove()
  })

  it('animationend gelmezse sınıf yine de düşer (emniyet ağı)', () => {
    vi.useFakeTimers()
    try {
      const el = document.createElement('div')
      el.className = 'screen'
      applyScreenTransition(el, 'fade')
      expect(el.classList.contains('screen-fade')).toBe(true)
      vi.advanceTimersByTime(2000)
      expect(el.classList.contains('screen-fade')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
