// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderServiceWorker } from '../build/swPlugin'
import { Motor } from '../src/app/motor'
import { createUpdateController } from '../src/pwa/register'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { FakeClock, fakeIds } from './helpers/engineFixture'
import { ROOT, stripCommentsAndStrings } from './helpers/scan'

// Phase 11 — E-18 güncelleme çubuğu yeri; A-SW-01 (08'de kimliksiz): SW kaynağında IndexedDB/deleteDatabase/Dexie yok, önbellek adı build kimliği içerir;
// eklenti birimi: yer tutucular doldurulur, manifest tam liste.

const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const click = async (el: HTMLElement) => { el.click(); await flush() }
const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim() === label)!
const screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null

let handle: AppHandle | null = null
let root: HTMLDivElement
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

describe('A-SW-01 — service worker kaynağı', () => {
  const src = readFileSync(join(ROOT, 'public/sw.js'), 'utf8')
  const code = stripCommentsAndStrings(src)

  it('indexedDB / deleteDatabase / Dexie / localStorage yok; kullanıcı verisine dokunmaz', () => {
    expect(/\bindexedDB\b|deleteDatabase|\bDexie\b|localStorage|sessionStorage/.test(code)).toBe(false)
    expect(/importScripts/.test(code)).toBe(false)
  })

  it('önbellek adı build kimliğini içerir; activate yalnız eski motor-shell-* önbelleklerini siler; skipWaiting yalnız mesajla', () => {
    expect(src).toContain('motor-shell-${BUILD_ID}')
    expect(src).toMatch(/startsWith\('motor-shell-'\)/)
    expect((src.match(/skipWaiting\(\)/g) ?? []).length).toBe(1)
    expect(src).toMatch(/SKIP_WAITING/)
    expect(src).toMatch(/cache\.addAll/) // tam ön-önbellek: tek varlık eksikse install başarısız
  })

  it('eklenti: yer tutucular doldurulur; manifest JSON dizisi; şablon değişmişse hata', () => {
    const out = renderServiceWorker(src, ['./index.html', './assets/index-abc.js', './manifest.webmanifest', './icons/icon-192.png'], 'abc123def456')
    expect(out).toContain("const BUILD_ID = 'abc123def456'")
    expect(out).toContain('const PRECACHE = ["./index.html","./assets/index-abc.js","./manifest.webmanifest","./icons/icon-192.png"]')
    expect(out).not.toContain('__PRECACHE__')
    expect(() => renderServiceWorker('const x = 1', [], 'id')).toThrow()
  })
})

describe('E-18 — güncelleme çubuğu yeri', () => {
  it("bekleyen SW varken Bugün'de 'Yeni sürüm hazır · Yenile'; çalışma ekranlarında (S2–S8) görünmez; Yenile'ye basmadan yenilenmez; Veri'de görünür", async () => {
    const clock = new FakeClock()
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
    await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Atom.', prompt: 'Atom?' })
    const updates = createUpdateController()
    let applied = 0
    updates.apply = () => { applied++ }
    handle = mountApp(root, { motor, appVersion: '0.2.0', updates })
    await flush()
    expect(byTestId('update-bar')).toBeNull()
    updates.setPending(true) // yeni SW install tamamlandı (tam ön-önbellek) → waiting
    await flush()
    expect(byTestId('update-bar')!.textContent).toContain('Yeni sürüm hazır')
    expect(applied).toBe(0) // kendiliğinden yenilenme yok
    await click(byTestId('start')!)
    expect(screen()).toBe('read')
    expect(byTestId('update-bar')).toBeNull() // çalışma ekranında yok
    await click(byTestId('read-done')!)
    expect(byTestId('update-bar')).toBeNull()
    await click(byText("Bugün'e dön"))
    expect(byTestId('update-bar')).not.toBeNull()
    await click(byText('Veri'))
    expect(byTestId('update-bar')).not.toBeNull()
    await click(byTestId('update-apply')!)
    expect(applied).toBe(1) // yalnız bu istemci, bir kez
  })
})
