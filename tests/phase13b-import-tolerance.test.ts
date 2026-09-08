// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyContentImport } from '../src/app/contentImport'
import { Motor } from '../src/app/motor'
import { CONTENT_IMPORT_FORMAT, parseContentImport, planContentImport, summarizePlan } from '../src/engine/import/contentImport'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 13b (BL-38/BL-39) — telefon bulguları: yapay zekâ çıktısı çitli/açıklamalı geliyor ("metin yapıştırma çalışmadı, dosya çalıştı");
// alt başlık dizini; kullanıcının kendi kodlamaları; İçerik listesinde Ders › Konu grupları; Panodan yapıştır.

const ATOM1 = 'Tanzimat Fermanı 1839\'da ilan edildi.'
const SAMPLE = {
  format: CONTENT_IMPORT_FORMAT,
  atomlar: [
    { ders: 'Tarih', konu: 'Tanzimat Dönemi', atom: ATOM1, soru: 'Tanzimat Fermanı hangi yıl ilan edildi?', tur: 'tarih' },
    { ders: 'Tarih', konu: 'Tanzimat Dönemi', atom: 'Islahat Fermanı 1856\'da ilan edildi.', soru: 'Islahat Fermanı hangi yıl ilan edildi?' },
  ],
  sorular: [
    { atom: ATOM1, soru: 'Tanzimat Fermanı hangi yıl ilan edildi?', secenekler: ['1839', '1856', '1876'], dogru: '1839', kaynak: 'ders notu' },
  ],
}
const text = (v: unknown) => JSON.stringify(v)

describe('Yapıştırma toleransı', () => {
  it('```json çiti, önünde/arkasında açıklama, BOM ve akıllı tırnak → aynı içerik; veri değiştirilmez', () => {
    const clean = parseContentImport(text(SAMPLE))
    expect(clean.errors).toEqual([])
    const fenced = 'İşte JSON:\n```json\n' + text(SAMPLE) + '\n```\nBaşka bir şey ister misin?'
    expect(parseContentImport(fenced)).toEqual(clean)
    expect(parseContentImport('﻿' + text(SAMPLE))).toEqual(clean)
    const smart = text(SAMPLE).replace(/"/g, (_m, i: number) => (i % 2 ? '”' : '“'))
    expect(parseContentImport(smart).errors).toEqual([])
    expect(parseContentImport(smart).atoms).toHaveLength(2)
  })

  it('gerçekten bozuksa anlaşılır hata; içerik hataları (sayısal dogru) toleransla düzeltilmez', () => {
    const e = parseContentImport('Merhaba, JSON yok burada').errors
    expect(e).toHaveLength(1)
    expect(e[0]).toMatch(/JSON okunamadı/)
    expect(e[0]).toMatch(/yalnız JSON kısmını al/)
    expect(parseContentImport('```json\n' + text({ sorular: [{ ...SAMPLE.sorular[0], dogru: 1 }] }) + '\n```').errors[0]).toMatch(/METNİNİ yaz/)
  })
})

describe('Alt başlık ve kodlamalar (BL-39)', () => {
  const withSub = {
    atomlar: [
      { ders: 'Tarih', konu: '18. yy Osmanlı', altbaslik: 'Islahatlar', atom: 'Lale Devri 1718 Pasarofça ile başladı.', soru: 'Lale Devri hangi antlaşmayla başladı?', cengel: 'Pasarofça → Lale açtı' },
      { ders: 'Tarih', konu: '18. yy Osmanlı', alt_baslik: 'Padişahlar', atom: 'III. Ahmet Lale Devri padişahıdır.', soru: 'Lale Devri padişahı kimdir?' },
      { ders: 'Tarih', konu: '18. yy Osmanlı', atom: 'Patrona Halil İsyanı 1730\'da çıktı.', soru: 'Patrona Halil İsyanı hangi yıl?' },
    ],
    cengeller: [
      { atom: 'III. Ahmet Lale Devri padişahıdır.', metin: 'Üç Ahmet, üç lale' },
      { atom: 'III. Ahmet Lale Devri padişahıdır.', tur: 'hikâye', metin: 'üç ahmet, üç lale' },
    ],
  }

  it('altbaslik / alt_baslik konu adına " › " ile eklenir; düz metin cengel → kodlama; cengeller yeni atoma katılır, çift atlanır', () => {
    const p = parseContentImport(text(withSub))
    expect(p.errors).toEqual([])
    expect(p.atoms.map((a) => a.topicName)).toEqual(['18. yy Osmanlı › Islahatlar', '18. yy Osmanlı › Padişahlar', '18. yy Osmanlı'])
    expect(p.atoms[0]!.hooks).toEqual([{ type: 'mnemonic', content: 'Pasarofça → Lale açtı' }])
    expect(p.hooks).toHaveLength(2)
    expect(p.hooks[0]!.type).toBe('mnemonic') // bölüm varsayılanı kodlama
    const plan = planContentImport(p, { atoms: [], questions: [] })
    expect(plan.errors).toEqual([])
    expect(plan.atoms[1]!.hooks).toEqual([{ type: 'mnemonic', content: 'Üç Ahmet, üç lale' }]) // ikincisi aynı metin → atlandı
    expect(plan.hooks).toEqual([])
    expect(plan.skippedHooks).toBe(1)
    expect(summarizePlan(plan)).toBe('3 atom, 0 soru eklenecek · 1 çengel zaten var (atlanır)')
  })

  it('mevcut atoma çengel: plan → hooks; uygulama Motor.addHook ile yazar; aynı metin ikinci kez false; bilinmeyen atom hata', async () => {
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    const atom = await motor.addAtom({ subjectName: 'Tarih', topicName: 'X', text: 'Var olan atom.', prompt: 'Var olan?' })
    const c = await motor.content()
    const plan = planContentImport(parseContentImport(text({ cengeller: [{ atom: 'var olan atom.', tur: 'kodlama', metin: 'VOA' }] })), { atoms: c.atoms, questions: [], hooks: [] })
    expect(plan.hooks).toEqual([{ atomId: atom.id, type: 'mnemonic', content: 'VOA' }])
    expect(summarizePlan(plan)).toBe('0 atom, 0 soru eklenecek · 1 çengel mevcut atomlara eklenecek')
    const out = await applyContentImport(motor, plan, null)
    expect(out).toMatchObject({ atomsAdded: 0, questionsAdded: 0, hooksAdded: 1 })
    expect((await motor.content()).hooks).toMatchObject([{ atomId: atom.id, type: 'mnemonic', content: 'VOA' }])
    expect(await motor.addHook(atom.id, { type: 'logic', content: ' voa ' })).toBe(false)
    expect((await motor.content()).hooks).toHaveLength(1)
    await expect(motor.addHook('yok', { type: 'logic', content: 'x' })).rejects.toThrow(/Atom bulunamadı/)
    const bad = planContentImport(parseContentImport(text({ cengeller: [{ atom: 'Yok.', metin: 'x' }] })), { atoms: c.atoms, questions: [] })
    expect(bad.errors[0]).toMatch(/cengeller\[0\]\.atom: "Yok\." bulunamadı — çengel/)
  })
})

describe('İçerik listesi — Ders › Konu grupları; Panodan yapıştır', () => {
  const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
  const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim() === label)!
  const click = async (el: HTMLElement) => { el.click(); await flush() }
  let handle: AppHandle | null = null
  let root: HTMLDivElement
  beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
  afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

  it('iki konu → iki kapalı grup (başlıkta sayılar); arama → tek açık grup; Panodan yapıştır çitli metni okur → önizleme', async () => {
    const repo = new MemoryRepository(fakeIds('gen'))
    const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
    const clip = { text: '' }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => clip.text, writeText: async (t: string) => { clip.text = t } } })
    try {
      handle = mountApp(root, { motor, appVersion: '0.2.0' })
      await flush()
      await click(byText('İçerik'))
      await click(byTestId('to-import')!)
      clip.text = 'Sonuç:\n```json\n' + text({ atomlar: [
        { ders: 'Tarih', konu: '18. yy Osmanlı', altbaslik: 'Islahatlar', atom: 'A1.', soru: 'A1?' },
        { ders: 'Tarih', konu: '18. yy Osmanlı', altbaslik: 'Islahatlar', atom: 'A2.', soru: 'A2?' },
        { ders: 'Tarih', konu: '18. yy Osmanlı', altbaslik: 'Padişahlar', atom: 'B1.', soru: 'B1?' },
      ] }) + '\n```'
      await click(byTestId('paste-import')!)
      expect(byTestId('import-summary')!.textContent).toBe('3 atom, 0 soru eklenecek')
      await click(byTestId('apply-import')!)
      // BL-39: gruplama ünite düzeyinde; alt başlıklar grubun içinde etiketlenir
      const groups = [...document.querySelectorAll<HTMLDetailsElement>('details[data-group]')]
      expect(groups).toHaveLength(1)
      expect(groups[0]!.querySelector('summary')!.textContent).toBe('Tarih › 18. yy Osmanlı3 atom · 0 soru')
      expect([...groups[0]!.querySelectorAll('[data-sub]')].map((e) => e.textContent)).toEqual(['Islahatlar', 'Padişahlar'])
      expect(document.body.textContent).toContain('3 atom · 1 ünite')
      const search = document.querySelector<HTMLInputElement>('input[type=search]')!
      search.value = 'B1'
      search.dispatchEvent(new Event('input'))
      await flush()
      const open = [...document.querySelectorAll<HTMLDetailsElement>('details[data-group]')]
      expect(open).toHaveLength(1)
      expect(open[0]!.open).toBe(true)
    } finally {
      delete (navigator as unknown as { clipboard?: unknown }).clipboard
    }
  })
})
