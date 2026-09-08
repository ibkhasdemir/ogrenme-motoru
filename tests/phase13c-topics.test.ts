// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Motor } from '../src/app/motor'
import { applyUnitToPlan, joinTopicPath, parseContentImport, planContentImport, splitTopicPath, unitWarning } from '../src/engine/import/contentImport'
import { serializeMemory } from '../src/engine/rebuild/rebuild'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { IMPORT_PROMPT_TEMPLATE, NOTES_PLACEHOLDER, buildPrompt } from '../src/ui/contentImport'
import { FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 13c (BL-39) — telefon bulgusu 2026-09-08: yapay zekâ üniteyi atlayıp her olayı ayrı "konu" yaptı (115 atom / 37 konu).
// Üç yol: içe aktarmada "Ünite" alanı, uyarı metni, mevcut veriyi düzelten "Konuları düzenle" ekranı (yeniden adlandır / birleştir).

const text = (v: unknown) => JSON.stringify(v)
const flatNotes = (n: number) => ({
  atomlar: Array.from({ length: n }, (_, i) => ({ ders: 'Tarih', konu: `Olay ${i + 1}`, atom: `Olay ${i + 1} gerçekleşti.`, soru: `Olay ${i + 1} ne zaman?` })),
})

describe('Konu yolu yardımcıları', () => {
  it('splitTopicPath / joinTopicPath: ünite değiştirilir, ayraçsız ad alt başlık olur, boş ünite adı korur', () => {
    expect(splitTopicPath('18. yy Osmanlı › Islahatlar')).toEqual({ unit: '18. yy Osmanlı', sub: 'Islahatlar' })
    expect(splitTopicPath('Küçük Kaynarca')).toEqual({ unit: 'Küçük Kaynarca', sub: null })
    expect(joinTopicPath('18. yy Osmanlı', 'Küçük Kaynarca')).toBe('18. yy Osmanlı › Küçük Kaynarca')
    expect(joinTopicPath('19. yy', '18. yy Osmanlı › Islahatlar')).toBe('19. yy › Islahatlar') // ünite değişir, alt başlık kalır
    expect(joinTopicPath('  ', 'Küçük Kaynarca')).toBe('Küçük Kaynarca')
  })
})

describe('İçe aktarmada ünite', () => {
  it('applyUnitToPlan tüm yeni atomların konusunu ünite altına alır; boş ünite planı değiştirmez', () => {
    const plan = planContentImport(parseContentImport(text(flatNotes(3))), { atoms: [], questions: [] })
    const withUnit = applyUnitToPlan(plan, ' 18. yy Osmanlı ')
    expect(withUnit.atoms.map((a) => a.topicName)).toEqual(['18. yy Osmanlı › Olay 1', '18. yy Osmanlı › Olay 2', '18. yy Osmanlı › Olay 3'])
    expect(applyUnitToPlan(plan, '')).toBe(plan)
  })

  it('unitWarning: parçalı dizinde uyarır, toplu dizinde ve küçük dosyada sessiz', () => {
    const parcali = planContentImport(parseContentImport(text(flatNotes(12))), { atoms: [], questions: [] })
    expect(unitWarning(parcali)).toMatch(/12 atom 12 ayrı konuya dağılmış/)
    expect(unitWarning(applyUnitToPlan(parcali, '18. yy Osmanlı'))).toMatch(/12 ayrı konuya/) // ünite verilse de alt başlıklar ayrı konu; uyarı bilgilendirir
    const az = planContentImport(parseContentImport(text(flatNotes(4))), { atoms: [], questions: [] })
    expect(unitWarning(az)).toBeNull()
    const toplu = planContentImport(parseContentImport(text({ atomlar: Array.from({ length: 12 }, (_, i) => ({ ders: 'Tarih', konu: '18. yy Osmanlı', altbaslik: i < 6 ? 'Islahatlar' : 'Savaşlar', atom: `Atom ${i}.`, soru: `Atom ${i}?` })) })), { atoms: [], questions: [] })
    expect(unitWarning(toplu)).toBeNull()
  })
})

describe('Motor.renameTopic — yeniden adlandır ve birleştir', () => {
  async function seeded() {
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    const a = await motor.addAtom({ subjectName: 'Tarih', topicName: 'Küçük Kaynarca', text: 'Küçük Kaynarca 1774.', prompt: 'Küçük Kaynarca hangi yıl?' })
    const b = await motor.addAtom({ subjectName: 'Tarih', topicName: 'Prut Savaşı', text: 'Prut Savaşı 1711.', prompt: 'Prut hangi yıl?' })
    const c = await motor.content()
    return { repo, motor, a, b, tA: c.topics.find((t) => t.name === 'Küçük Kaynarca')!, tB: c.topics.find((t) => t.name === 'Prut Savaşı')! }
  }

  it('yeniden adlandırma: atom aynı konuda kalır, ad değişir; boş ad ve bilinmeyen konu hata', async () => {
    const { motor, a, tA } = await seeded()
    const out = await motor.renameTopic(tA.id, '18. yy Osmanlı › Küçük Kaynarca')
    expect(out).toEqual({ topicId: tA.id, merged: false, movedAtoms: 0 })
    const c = await motor.content()
    expect(c.topics.find((t) => t.id === tA.id)!.name).toBe('18. yy Osmanlı › Küçük Kaynarca')
    expect(c.atoms.find((x) => x.id === a.id)!.topicId).toBe(tA.id)
    await expect(motor.renameTopic(tA.id, '  ')).rejects.toThrow(/boş olamaz/)
    await expect(motor.renameTopic('yok', 'X')).rejects.toThrow(/Konu bulunamadı/)
  })

  it('aynı derste aynı ad → birleştirir: atomlar hedefe taşınır, öğrenme geçmişi ve vadeler değişmez', async () => {
    const { motor, a, b, tA, tB } = await seeded()
    const session = motor.startSession(null)
    await motor.next(session)
    const pres = await motor.presentAtom(a.id)
    if (pres.kind !== 'recall') throw new Error('kart bekleniyordu')
    await motor.answerRecall(session, pres, { selfAssessment: 'good', hookShown: false, responseTimeMs: 100 })
    const before = serializeMemory(motor.memory)
    const attemptsBefore = motor.listAttempts().length

    await motor.renameTopic(tB.id, 'Antlaşmalar')
    const out = await motor.renameTopic(tA.id, 'antlaşmalar') // büyük/küçük harf farkı → aynı konu
    expect(out).toMatchObject({ topicId: tB.id, merged: true, movedAtoms: 1 })
    const c = await motor.content()
    expect(c.atoms.find((x) => x.id === a.id)!.topicId).toBe(tB.id)
    expect(c.atoms.find((x) => x.id === b.id)!.topicId).toBe(tB.id)
    expect(c.topics.filter((t) => t.name === 'Antlaşmalar').length).toBe(2) // kaynak konu boş kaldı, adı hedefe çekildi (eski ad diriltilmez)
    expect(serializeMemory(motor.memory)).toBe(before)
    expect(motor.listAttempts()).toHaveLength(attemptsBefore)
    await motor.refresh()
    expect(serializeMemory(motor.memory)).toBe(before) // REBUILD sonrası da aynı
  })
})

describe('Ekran — Konuları düzenle ve ünite bazlı liste', () => {
  const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
  const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim() === label)!
  const click = async (el: HTMLElement) => { el.click(); await flush() }
  const screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null
  let handle: AppHandle | null = null
  let root: HTMLDivElement
  beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
  afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

  it('37 konu senaryosu: seçilen konular ünite altına taşınır → liste tek ünite grubunda alt başlıklara ayrılır', async () => {
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    for (const konu of ['Küçük Kaynarca', 'Prut Savaşı', 'Mora Seferi']) {
      await motor.addAtom({ subjectName: 'Tarih', topicName: konu, text: `${konu} atomu.`, prompt: `${konu}?` })
    }
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    const before = [...document.querySelectorAll<HTMLDetailsElement>('details[data-group]')]
    expect(before).toHaveLength(3) // önce üç ayrı ünite
    expect(before.every((g) => !g.open)).toBe(true) // birden çok grup → kapalı gelir
    await click(byTestId('to-topics')!)
    expect(screen()).toBe('topics')
    const boxes = [...document.querySelectorAll<HTMLInputElement>('.topic-row input[type=checkbox]')]
    expect(boxes).toHaveLength(3)
    expect((byTestId('move-topics') as HTMLButtonElement).disabled).toBe(true)
    for (const b of boxes) { b.checked = true; b.dispatchEvent(new Event('change')) }
    expect(byTestId('topic-selection')!.textContent).toBe('3 konu seçili')
    expect((byTestId('move-topics') as HTMLButtonElement).disabled).toBe(false)
    const unit = document.querySelector<HTMLInputElement>('input[aria-label="Ünite adı"]')!
    unit.value = '18. yy Osmanlı'
    await click(byTestId('move-topics')!)
    expect(document.body.textContent).toContain('3 konu "18. yy Osmanlı" ünitesinin altına taşındı')
    expect((await motor.content()).topics.map((t) => t.name).sort()).toEqual(['18. yy Osmanlı › Küçük Kaynarca', '18. yy Osmanlı › Mora Seferi', '18. yy Osmanlı › Prut Savaşı'])
    await click(byText('← İçerik'))
    const groups = [...document.querySelectorAll<HTMLDetailsElement>('details[data-group]')]
    expect(groups).toHaveLength(1)
    expect(groups[0]!.querySelector('summary')!.textContent).toBe('Tarih › 18. yy Osmanlı3 atom · 0 soru')
    // alt başlık sırası konu sırasını (yani notun / içe aktarmanın sırasını) korur, alfabetik değil
    expect([...groups[0]!.querySelectorAll('[data-sub]')].map((e) => e.textContent)).toEqual(['Küçük Kaynarca', 'Prut Savaşı', 'Mora Seferi'])
    expect(document.body.textContent).toContain('3 atom · 1 ünite')
  })

  it('içe aktarma ekranında Ünite alanı: önizleme ünite altına alır ve uyarı görünür', async () => {
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    await click(byTestId('to-import')!)
    const ta = byTestId('import-text') as HTMLTextAreaElement
    ta.value = text(flatNotes(12))
    ta.dispatchEvent(new Event('input'))
    await click(byTestId('preview-import')!)
    expect(byTestId('import-unit-warning')!.textContent).toMatch(/12 atom 12 ayrı konuya dağılmış/)
    const unit = byTestId('import-unit') as HTMLInputElement
    unit.value = '18. yy Osmanlı'
    unit.dispatchEvent(new Event('input'))
    await click(byTestId('preview-import')!)
    await click(byTestId('apply-import')!)
    const topics = (await motor.content()).topics.map((t) => t.name)
    expect(topics.every((n) => n.startsWith('18. yy Osmanlı › '))).toBe(true)
    expect(document.querySelectorAll('details[data-group]')).toHaveLength(1)
  })
})

describe('Şablon + not tek parça (telefonda iki kopyala-yapıştır yerine bir tane)', () => {
  it('buildPrompt: not verilince yer tutucunun yerine geçer, boşsa şablon aynen kalır', () => {
    expect(IMPORT_PROMPT_TEMPLATE).toContain(NOTES_PLACEHOLDER)
    const withNotes = buildPrompt('  Lale Devri 1718-1730 arasıdır.  ')
    expect(withNotes).toContain('Lale Devri 1718-1730 arasıdır.')
    expect(withNotes).not.toContain(NOTES_PLACEHOLDER)
    expect(withNotes.startsWith('Aşağıdaki notları')).toBe(true)
    expect(buildPrompt('   ')).toBe(IMPORT_PROMPT_TEMPLATE)
  })

  it('ekran: Ders notu kutusuna yazılan metin "Şablonu kopyala" ile panoya şablonla birlikte gider', async () => {
    const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
    const root = document.createElement('div')
    document.body.appendChild(root)
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    const clip = { text: '' }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { clip.text = t }, readText: async () => clip.text } })
    const handle = mountApp(root, { motor, appVersion: '0.2.0' })
    try {
      await flush()
      const go = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim() === label)!
      go('İçerik').click(); await flush()
      document.querySelector<HTMLElement>('[data-testid="to-import"]')!.click(); await flush()
      const notes = document.querySelector<HTMLTextAreaElement>('[data-testid="import-notes"]')!
      notes.value = 'Patrona Halil İsyanı 1730.'
      notes.dispatchEvent(new Event('input'))
      document.querySelector<HTMLElement>('[data-testid="copy-template"]')!.click(); await flush()
      expect(clip.text).toContain('Patrona Halil İsyanı 1730.')
      expect(clip.text).not.toContain(NOTES_PLACEHOLDER)
      expect(document.body.textContent).toContain('Şablon + notların kopyalandı')
    } finally {
      handle.destroy()
      document.body.replaceChildren()
      delete (navigator as unknown as { clipboard?: unknown }).clipboard
    }
  })
})
