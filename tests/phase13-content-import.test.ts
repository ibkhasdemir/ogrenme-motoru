// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ContentImportError, applyContentImport } from '../src/app/contentImport'
import { Motor } from '../src/app/motor'
import { isCompleteRevision } from '../src/domain'
import { CONTENT_IMPORT_FORMAT, facetFromLabel, hookTypeFromLabel, parseContentImport, planContentImport, summarizePlan } from '../src/engine/import/contentImport'
import { WebCryptoHashService } from '../src/platform/web/hash'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { RecoveryDb } from '../src/store/recovery/recoveryDb'
import { DexieRecoveryStore, type RecoveryStore } from '../src/store/recovery/recoveryStore'
import { mountApp, type AppHandle } from '../src/ui/app'
import { IMPORT_PROMPT_TEMPLATE } from '../src/ui/contentImport'
import { FakeClock, fakeIds } from './helpers/engineFixture'
import { uniqueDbName } from './helpers/legacyDb'

// Phase 13 (BL-38, spec dışı; sahibi kararı 2026-09-08) — İçerik içe aktarma: parser, plan (çift/atlama), uygulama (yalnız ekler,
// pre_import noktası), ekran akışı. Uygulamada LLM yok; JSON dışarıda üretilir.

const ATOM1 = 'Tanzimat Fermanı 1839\'da ilan edildi.'
const ATOM2 = 'Islahat Fermanı 1856\'da ilan edildi.'
const SAMPLE = {
  format: CONTENT_IMPORT_FORMAT,
  atomlar: [
    { ders: 'Tarih', konu: 'Tanzimat Dönemi', atom: ATOM1, soru: 'Tanzimat Fermanı hangi yıl ilan edildi?', tur: 'tarih', cengel: { tur: 'Kodlama', metin: '18-39' }, neden: 'Batılılaşma' },
    { ders: 'Tarih', konu: 'Tanzimat Dönemi', atom: ATOM2, soru: 'Islahat Fermanı hangi yıl ilan edildi?', tur: ['sebep-sonuç', 'Olgu'] },
  ],
  sorular: [
    { atom: ATOM1, soru: 'Tanzimat Fermanı hangi yıl ilan edildi?', secenekler: ['1839', '1856', '1876'], dogru: '1839', kaynak: 'ders notu' },
  ],
}
const text = (v: unknown) => JSON.stringify(v)

describe('parseContentImport — biçim ve hoşgörü', () => {
  it('örnek dosya: 2 atom, 1 soru; Türkçe etiketler enum\'a çevrilir; çengel tek nesne de olur', () => {
    const p = parseContentImport(text(SAMPLE))
    expect(p.errors).toEqual([])
    expect(p.atoms).toHaveLength(2)
    expect(p.atoms[0]).toMatchObject({ subjectName: 'Tarih', topicName: 'Tanzimat Dönemi', text: ATOM1, facets: ['date'], hooks: [{ type: 'mnemonic', content: '18-39' }], why: 'Batılılaşma' })
    expect(p.atoms[1]!.facets).toEqual(['cause_effect', 'fact'])
    expect(p.atoms[1]!.hooks).toEqual([])
    expect(p.questions[0]).toMatchObject({ atomText: ATOM1, text: 'Tanzimat Fermanı hangi yıl ilan edildi?', options: ['1839', '1856', '1876'], correctIndex: 0, source: 'ders notu' })
  })

  it('etiket eşlemesi aksan/büyük harf/boşluk bağımsız; bilinmeyen → null', () => {
    expect(facetFromLabel('MEKÂN')).toBe('spatial')
    expect(facetFromLabel('Sebep Sonuç')).toBe('cause_effect')
    expect(facetFromLabel('cause_effect')).toBe('cause_effect')
    expect(hookTypeFromLabel('hikaye')).toBe('story')
    expect(hookTypeFromLabel('Absürt imge')).toBe('absurd')
    expect(hookTypeFromLabel('logic')).toBe('logic')
    expect(facetFromLabel('xyz')).toBeNull()
    expect(hookTypeFromLabel('xyz')).toBeNull()
  })

  it('hatalar yol adıyla: bozuk JSON, yanlış format, eksik alan, sayısal dogru, seçenekte olmayan dogru, 1 ya da 6 seçenek, eksik kaynak', () => {
    expect(parseContentImport('{').errors[0]).toMatch(/JSON okunamadı/)
    expect(parseContentImport('[]').errors[0]).toMatch(/Kök bir nesne/)
    expect(parseContentImport(text({ format: 'baska/9', atomlar: SAMPLE.atomlar })).errors[0]).toMatch(/format: "baska\/9" tanınmadı/)
    const missing = parseContentImport(text({ atomlar: [{ ders: 'Tarih', konu: 'X', atom: 'A.' }] }))
    expect(missing.errors).toEqual(['atomlar[0].soru: zorunlu, boş olamaz'])
    expect(missing.atoms).toHaveLength(0)
    const q = (patch: Record<string, unknown>) => parseContentImport(text({ sorular: [{ ...SAMPLE.sorular[0], ...patch }] })).errors
    expect(q({ dogru: 0 })[0]).toMatch(/sorular\[0\]\.dogru: doğru seçeneğin METNİNİ yaz/)
    expect(q({ dogru: '1900' })[0]).toMatch(/"1900" seçenekler arasında yok/)
    expect(q({ secenekler: ['1839'] })[0]).toMatch(/1 seçenek; 2–5 olmalı/)
    expect(q({ secenekler: ['1', '2', '3', '4', '5', '6'], dogru: '1' })[0]).toMatch(/6 seçenek/)
    expect(q({ secenekler: ['1839', '1839'] })[0]).toMatch(/birbirinden farklı/)
    expect(q({ kaynak: '' })[0]).toMatch(/sorular\[0\]\.kaynak: zorunlu/)
    expect(q({ atom: undefined })[0]).toMatch(/sorular\[0\]\.atom: zorunlu/)
    expect(parseContentImport(text({ atomlar: [], sorular: [] })).errors[0]).toMatch(/İçe aktarılacak bir şey yok/)
    expect(parseContentImport(text({ atomlar: [{ ...SAMPLE.atomlar[0], tur: 'renk' }] })).errors[0]).toMatch(/tur: "renk" tanınmadı/)
    expect(parseContentImport(text({ atomlar: [{ ...SAMPLE.atomlar[0], cengel: { tur: 'şaka', metin: 'x' } }] })).errors[0]).toMatch(/cengel\[0\]\.tur: "şaka" tanınmadı/)
  })
})

describe('planContentImport — çiftler ve bağlama', () => {
  const existingAtom = { id: 'atm-1', topicId: 't1', text: ' tanzimat fermanı 1839\'da ilan edildi. ', prompt: 'Soru?', facets: ['fact' as const], sortOrder: 1, archived: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: null }

  it('mevcut atomla aynı metin (büyük/küçük, boşluk farkı) → atlanır, soru mevcut atoma bağlanır; yeni atom → new hedef', () => {
    const plan = planContentImport(parseContentImport(text(SAMPLE)), { atoms: [existingAtom], questions: [] })
    expect(plan.errors).toEqual([])
    expect(plan.atoms.map((a) => a.text)).toEqual([ATOM2])
    expect(plan.skippedAtoms).toBe(1)
    expect(plan.questions[0]!.atom).toEqual({ kind: 'existing', atomId: 'atm-1' })
    expect(summarizePlan(plan)).toBe('1 atom, 1 soru eklenecek · 1 atom, 0 soru zaten var (atlanır)')
  })

  it('dosya içi çift atom bir kez eklenir; mevcut aynı soru atlanır; bilinmeyen atom referansı hata', () => {
    const dup = { ...SAMPLE, atomlar: [...SAMPLE.atomlar, { ...SAMPLE.atomlar[0]! }], sorular: [...SAMPLE.sorular, { ...SAMPLE.sorular[0]!, atom: 'Yok böyle atom.' }] }
    const plan = planContentImport(parseContentImport(text(dup)), { atoms: [existingAtom], questions: [{ primaryAtomId: 'atm-1', text: 'tanzimat fermanı hangi yıl ilan edildi?', archived: false }] })
    expect(plan.atoms.map((a) => a.text)).toEqual([ATOM2])
    expect(plan.skippedAtoms).toBe(2)
    expect(plan.questions).toHaveLength(0)
    expect(plan.skippedQuestions).toBe(1)
    expect(plan.errors).toEqual(['sorular[1].atom: "Yok böyle atom." bulunamadı — bu dosyadaki "atomlar" içinde ya da mevcut içerikte birebir aynı metin olmalı'])
  })
})

describe('applyContentImport — yalnız ekler; pre_import noktası; hata → hiçbir şey', () => {
  async function fresh() {
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    return { repo, motor }
  }
  const planFor = async (motor: Motor, raw: unknown) => {
    const c = await motor.content()
    return planContentImport(parseContentImport(text(raw)), { atoms: c.atoms, questions: [] })
  }

  it('atomlar ders/konu/tür/çengel ile, soru doğru seçenek ve kaynakla oluşur; ikinci kez aynı dosya → eklenecek yok', async () => {
    const { repo, motor } = await fresh()
    const out = await applyContentImport(motor, await planFor(motor, SAMPLE), null)
    expect(out).toEqual({ atomsAdded: 2, questionsAdded: 1, recoveryPointId: null })
    const c = await motor.content()
    expect(c.subjects.map((s) => s.name)).toEqual(['Tarih'])
    expect(c.topics.map((t) => t.name)).toEqual(['Tanzimat Dönemi'])
    const a1 = c.atoms.find((a) => a.text === ATOM1)!
    expect(a1).toMatchObject({ facets: ['date'], why: 'Batılılaşma' })
    expect(c.hooks.filter((h) => h.atomId === a1.id)).toMatchObject([{ type: 'mnemonic', content: '18-39' }])
    expect(c.questions).toHaveLength(1)
    const q = c.questions[0]!
    expect(q).toMatchObject({ primaryAtomId: a1.id, source: 'ders notu' })
    const rev = (await repo.getRevision(q.id, q.currentVersion))!
    if (!isCompleteRevision(rev)) throw new Error('sürüm içeriği eksik')
    expect(rev.options.map((o) => o.text)).toEqual(['1839', '1856', '1876'])
    expect(rev.options.find((o) => o.id === rev.correctOptionId)?.text).toBe('1839')
    // aynı dosya tekrar: plan boş → uygulanmaz
    const c2 = await motor.content()
    const plan2 = planContentImport(parseContentImport(text(SAMPLE)), { atoms: c2.atoms, questions: [{ primaryAtomId: q.primaryAtomId, text: rev.text, archived: false }] })
    expect(plan2).toMatchObject({ atoms: [], questions: [], skippedAtoms: 2, skippedQuestions: 1 })
    await expect(applyContentImport(motor, plan2, null)).rejects.toThrow(/Eklenecek yeni içerik yok/)
    expect((await motor.content()).atoms).toHaveLength(2)
  })

  it('planda hata varsa hiçbir şey eklenmez', async () => {
    const { motor } = await fresh()
    const bad = { ...SAMPLE, sorular: [{ ...SAMPLE.sorular[0]!, dogru: '1900' }] }
    const plan = await planFor(motor, bad)
    expect(plan.errors).toHaveLength(1)
    await expect(applyContentImport(motor, plan, null)).rejects.toBeInstanceOf(ContentImportError)
    expect((await motor.content()).atoms).toHaveLength(0)
  })

  it('kurtarma bağlıysa önce pre_import noktası (içe aktarma ÖNCESİ sayımlarla); nokta yazılamazsa içe aktarma başlamaz', async () => {
    const { repo, motor } = await fresh()
    await motor.addAtom({ subjectName: 'Tarih', topicName: 'X', text: 'Var olan atom.', prompt: 'Var olan?' })
    const hash = new WebCryptoHashService()
    const recovery = new DexieRecoveryStore(new RecoveryDb(uniqueDbName('imp-rec')))
    const deps = { repo, clock: motor.clock, ids: motor.ids, hash, appVersion: '0.2.0', recovery }
    const out = await applyContentImport(motor, await planFor(motor, SAMPLE), deps)
    expect(out.atomsAdded).toBe(2)
    const points = await recovery.list()
    expect(points.map((p) => p.reason)).toEqual(['pre_import'])
    expect(points[0]!.id).toBe(out.recoveryPointId)
    expect(points[0]!.counts.atoms).toBe(1) // içe aktarma öncesi durum
    expect((await motor.content()).atoms).toHaveLength(3)

    const failing: RecoveryStore = { list: async () => [], get: async () => undefined, write: async () => { throw new Error('kota dolu') }, pin: async () => undefined, unpinJob: async () => undefined }
    const more = { ...SAMPLE, atomlar: [{ ...SAMPLE.atomlar[0]!, atom: 'Üçüncü atom.', soru: 'Üçüncü?' }], sorular: [] }
    await expect(applyContentImport(motor, await planFor(motor, more), { ...deps, recovery: failing })).rejects.toThrow(/kota dolu/)
    expect((await motor.content()).atoms).toHaveLength(3)
  })
})

describe('Ekran — İçerik → İçe aktar → yapıştır → Önizle → Ekle', () => {
  const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
  const screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null
  const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim() === label)!
  const click = async (el: HTMLElement) => { el.click(); await flush() }
  const paste = async (s: string) => { const ta = byTestId('import-text') as HTMLTextAreaElement; ta.value = s; ta.dispatchEvent(new Event('input')); await flush() }
  let handle: AppHandle | null = null
  let root: HTMLDivElement
  beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
  afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

  it('akış: özet metni, Ekle etkin, sonra İçerik listesinde atomlar; hatalı JSON → hata listesi, Ekle kapalı; şablon biçimi içerir', async () => {
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    expect(screen()).toBe('content')
    await click(byTestId('to-import')!)
    expect(screen()).toBe('import')
    expect(byTestId('import-template')!.textContent).toContain(CONTENT_IMPORT_FORMAT)
    expect(IMPORT_PROMPT_TEMPLATE).toContain('"dogru": "1839"')
    expect((byTestId('apply-import') as HTMLButtonElement).disabled).toBe(true)

    await paste('{ bozuk')
    await click(byTestId('preview-import')!)
    expect(byTestId('import-errors')!.textContent).toContain('JSON okunamadı')
    expect((byTestId('apply-import') as HTMLButtonElement).disabled).toBe(true)

    await paste(text(SAMPLE))
    await click(byTestId('preview-import')!)
    expect(byTestId('import-summary')!.textContent).toBe('2 atom, 1 soru eklenecek')
    expect((byTestId('apply-import') as HTMLButtonElement).disabled).toBe(false)
    await click(byTestId('apply-import')!)
    expect(screen()).toBe('content')
    expect(document.body.textContent).toContain('2 atom, 1 soru eklendi.')
    expect(document.body.textContent).toContain(ATOM1)
    expect(document.body.textContent).toContain(ATOM2)
    expect((await motor.content()).questions).toHaveLength(1)
  })
})
