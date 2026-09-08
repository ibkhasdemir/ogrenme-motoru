// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateImportPlan } from '../src/app/aiImport'
import { LocalAiSettings, maskKey } from '../src/app/aiSettings'
import { Motor } from '../src/app/motor'
import { CONTENT_IMPORT_FORMAT } from '../src/engine/import/contentImport'
import { AiError, type AiService } from '../src/platform/ai'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { buildPrompt } from '../src/ui/contentImport'
import { FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 16 (BL-44 uygulama içi yapay zekâ, BL-45 gezinme) — anahtar cihazda kalır ve yedeğe girmez;
// üretilen içerik ÖNERİDİR (A18): önizlemeden geçmeden yazılmaz. Geri: tarayıcı geçmişi (iOS kaydırma / Android geri).

const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim().startsWith(label))!
const click = async (el: HTMLElement) => { el.click(); await flush() }
const screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null

const SAMPLE = JSON.stringify({
  format: CONTENT_IMPORT_FORMAT,
  atomlar: [{ ders: 'Tarih', konu: '18. yy Osmanlı', altbaslik: 'Islahatlar', atom: 'Lale Devri 1718 başladı.', soru: 'Lale Devri hangi yıl başladı?' }],
  sorular: [{ atom: 'Lale Devri 1718 başladı.', soru: 'Lale Devri hangi yıl başladı?', secenekler: ['1718', '1730'], dogru: '1718', kaynak: 'ders notu' }],
})

function fakeAi(reply: string | Error): AiService & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async complete(req) {
      calls.push(req.prompt)
      if (reply instanceof Error) throw reply
      return reply
    },
  }
}

async function seeded() {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
  return { repo, motor }
}

describe('Yapay zekâ üretimi (uygulama katmanı)', () => {
  it('şablon + not modele gider; dönen JSON plana çevrilir; içerik yazılmaz', async () => {
    const { motor } = await seeded()
    const ai = fakeAi('İşte:\n```json\n' + SAMPLE + '\n```')
    const out = await generateImportPlan(ai, { notes: 'Lale Devri notlarım', unit: '', existing: { atoms: [], questions: [] }, buildPrompt })
    expect(ai.calls[0]).toContain('Lale Devri notlarım')
    expect(ai.calls[0]).toContain(CONTENT_IMPORT_FORMAT)
    expect(out.plan.errors).toEqual([])
    expect(out.plan.atoms).toHaveLength(1)
    expect(out.plan.questions).toHaveLength(1)
    expect((await motor.content()).atoms).toHaveLength(0) // öneri; hiçbir şey eklenmedi
  })

  it('ünite verilirse istem zorunlu kural taşır ve plan ünite altına konur', async () => {
    const ai = fakeAi(SAMPLE)
    const out = await generateImportPlan(ai, { notes: 'not', unit: '19. yy', existing: { atoms: [], questions: [] }, buildPrompt })
    expect(ai.calls[0]).toContain('ZORUNLU')
    expect(out.plan.atoms[0]!.topicName).toBe('19. yy › Islahatlar')
  })

  it('boş not reddedilir; sağlayıcı hatası anlaşılır mesaja çevrilir; bozuk çıktı plan hatası olur', async () => {
    const ok = fakeAi(SAMPLE)
    await expect(generateImportPlan(ok, { notes: '   ', unit: '', existing: { atoms: [], questions: [] }, buildPrompt })).rejects.toThrow(/Önce ders notunu yapıştır/)
    const bad = fakeAi(new AiError('Anahtar reddedildi. Veri ekranından anahtarı kontrol et.', false))
    await expect(generateImportPlan(bad, { notes: 'x', unit: '', existing: { atoms: [], questions: [] }, buildPrompt })).rejects.toThrow(/Anahtar reddedildi/)
    const junk = fakeAi('Merhaba, bugün sana nasıl yardımcı olabilirim?')
    const out = await generateImportPlan(junk, { notes: 'x', unit: '', existing: { atoms: [], questions: [] }, buildPrompt })
    expect(out.plan.errors[0]).toMatch(/JSON okunamadı/)
  })
})

describe('Anahtar deposu', () => {
  afterEach(() => localStorage.clear())

  it('anahtar yalnız cihazda: localStorage; yedek anlık görüntüsünde yer almaz', async () => {
    const { repo, motor } = await seeded()
    await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Atom.', prompt: 'Atom?' })
    const store = new LocalAiSettings()
    store.write({ provider: 'anthropic', apiKey: 'sk-ant-gizli-1234', model: '' })
    expect(store.read()).toMatchObject({ provider: 'anthropic', apiKey: 'sk-ant-gizli-1234' })
    const snapshot = JSON.stringify(await repo.snapshotAll())
    expect(snapshot).not.toContain('sk-ant-gizli-1234')
    expect(maskKey('sk-ant-gizli-1234')).toBe('••••1234')
    store.clear()
    expect(store.read()).toBeNull()
  })

  it('bozuk/eksik kayıt "ayar yok" sayılır', () => {
    localStorage.setItem('motor-ai-config', '{bozuk')
    expect(new LocalAiSettings().read()).toBeNull()
    localStorage.setItem('motor-ai-config', JSON.stringify({ provider: 'yok', apiKey: 'x' }))
    expect(new LocalAiSettings().read()).toBeNull()
    localStorage.setItem('motor-ai-config', JSON.stringify({ provider: 'openai', apiKey: '   ' }))
    expect(new LocalAiSettings().read()).toBeNull()
  })
})

describe('Ekran akışı', () => {
  let handle: AppHandle | null = null
  let root: HTMLDivElement
  beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
  afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren(); localStorage.clear() })

  it('anahtar yoksa üret düğmesi yok, ipucu var; anahtar varsa tek dokunuşla önizleme gelir', async () => {
    const { motor } = await seeded()
    const ai = fakeAi(SAMPLE)
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    await click(byTestId('to-import')!)
    expect(byTestId('ai-generate')).toBeNull()
    expect(byTestId('ai-hint')).not.toBeNull()
    handle.destroy()
    document.body.replaceChildren()

    root = document.createElement('div'); document.body.appendChild(root)
    handle = mountApp(root, { motor, appVersion: '0.2.0', ai: () => ai })
    await flush()
    await click(byText('İçerik'))
    await click(byTestId('to-import')!)
    expect((byTestId('ai-generate') as HTMLButtonElement).disabled).toBe(true) // not boşken kapalı
    const notes = byTestId('import-notes') as HTMLTextAreaElement
    notes.value = 'Lale Devri 1718-1730.'
    notes.dispatchEvent(new Event('input'))
    await flush()
    await click(byTestId('ai-generate')!)
    await flush(30)
    // hata varsa görünür kılalım: özet yoksa hatayı yaz
    expect(byTestId('import-errors')?.textContent ?? byTestId('import-error')?.textContent ?? null).toBeNull()
    expect(byTestId('import-summary')!.textContent).toBe('1 atom, 1 soru eklenecek')
    expect((await motor.content()).atoms).toHaveLength(0) // hâlâ öneri
    await click(byTestId('apply-import')!)
    expect((await motor.content()).atoms).toHaveLength(1) // onaydan sonra
  })

  it('geri: tarayıcı geçmişi ekranı bir önceye alır (iOS kaydırma / Android geri tuşu)', async () => {
    const { motor } = await seeded()
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    expect(screen()).toBe('content')
    await click(byTestId('to-import')!)
    expect(screen()).toBe('import')
    history.back()
    await flush(30)
    expect(screen()).toBe('content')
    history.back()
    await flush(30)
    expect(screen()).toBe('today')
  })

  it('çalışma ekranından geri: oturum bırakılır, yarım cevap kaydedilmez', async () => {
    const { motor } = await seeded()
    await motor.addAtom({ subjectName: 'T', topicName: 'K', text: 'Atom.', prompt: 'Atom?' })
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byTestId('start')!)
    expect(screen()).toBe('read')
    history.back()
    await flush(30)
    expect(screen()).toBe('today')
    expect(motor.listAttempts()).toHaveLength(0)
  })
})
