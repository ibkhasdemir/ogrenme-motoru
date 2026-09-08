// İçerik içe aktarma (BL-38 — spec dışı; sahibi kararıyla 2026-09-08 eklendi). Saf: metin → doğrulanmış plan.
// Yalnız EKLER: mevcut içerik ve öğrenme geçmişi değişmez; birleştirme/senkron değildir (10 non-goal ayrımı korunur).
// Biçim kullanıcıya dönüktür (Türkçe anahtarlar); depolanan değerler domain enum'larıdır. Uygulamada LLM yok: JSON'u kullanıcı
// dışarıda (yapay zekâ sohbeti, tablo, elle) üretir, buraya yapıştırır. Hatalı bir öğe varsa hiçbir şey eklenmez (atomik plan).
import type { Atom, AtomFacet, HookType } from '../../domain'
import { ATOM_FACETS } from '../../domain'

export const CONTENT_IMPORT_FORMAT = 'ogrenme-motoru-icerik/1'
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 5
/** Konu adı içinde alt başlık ayracı: "18. yy Osmanlı › Islahatlar" (veri modeli 2 seviye; 3. seviye ad içinde taşınır, BL-39) */
export const TOPIC_SEPARATOR = ' › '

export interface ImportAtom {
  subjectName: string
  topicName: string
  text: string
  prompt: string
  facets: AtomFacet[]
  why?: string
  how?: string
  hooks: { type: HookType; content: string }[]
}

export interface ImportQuestion {
  /** atom metniyle referans (bu dosyadaki "atomlar" ya da mevcut içerik) — `atomId` verilmemişse zorunlu */
  atomText: string | null
  atomId: string | null
  text: string
  options: string[]
  correctIndex: number
  source: string
  path: string
}

/** "cengeller" / "kodlamalar" bölümü: mevcut ya da bu dosyadaki bir atoma çengel ekler (kullanıcının kendi kodlamaları) */
export interface ImportHook {
  atomText: string | null
  atomId: string | null
  type: HookType
  content: string
  path: string
}

export interface ParsedContent {
  atoms: ImportAtom[]
  questions: ImportQuestion[]
  hooks: ImportHook[]
  errors: string[]
}

export type AtomTarget = { kind: 'new'; index: number } | { kind: 'existing'; atomId: string }

export interface PlannedQuestion {
  text: string
  options: string[]
  correctIndex: number
  source: string
  atom: AtomTarget
}

/** yalnız MEVCUT atomlara eklenecek çengeller; yeni atomlarınkiler plan aşamasında atomun `hooks` listesine katılır */
export interface PlannedHook {
  atomId: string
  type: HookType
  content: string
}

export interface ImportPlan {
  atoms: ImportAtom[]
  questions: PlannedQuestion[]
  hooks: PlannedHook[]
  skippedAtoms: number
  skippedQuestions: number
  skippedHooks: number
  errors: string[]
}

export interface ExistingContent {
  atoms: Atom[]
  /** mevcut soruların güncel sürüm metinleri (yalnız içeriği mevcut sürümler) */
  questions: { primaryAtomId: string; text: string; archived: boolean }[]
  /** mevcut çengeller (çift kontrolü) — verilmezse boş sayılır */
  hooks?: { atomId: string; content: string }[]
}

/** Türkçe etiket ↔ enum eşlemesi; büyük/küçük harf, aksan, boşluk, tire, alt çizgi görmezden gelinir. */
const FACET_ALIASES: Record<AtomFacet, string[]> = {
  fact: ['fact', 'olgu', 'bilgi'],
  date: ['date', 'tarih'],
  chronology: ['chronology', 'kronoloji', 'sıralama'],
  definition: ['definition', 'tanım'],
  cause_effect: ['cause_effect', 'sebep-sonuç', 'neden-sonuç'],
  process: ['process', 'süreç'],
  comparison: ['comparison', 'karşılaştırma'],
  spatial: ['spatial', 'mekân', 'coğrafya', 'harita'],
  rule: ['rule', 'kural'],
  exception: ['exception', 'istisna'],
}

const HOOK_ALIASES: Record<HookType, string[]> = {
  logic: ['logic', 'mantık'],
  mnemonic: ['mnemonic', 'kodlama', 'hafıza tekniği'],
  absurd: ['absurd', 'absürt', 'absürt imge', 'saçma'],
  analogy: ['analogy', 'benzetme', 'analoji'],
  story: ['story', 'hikâye', 'öykü'],
  visual: ['visual', 'görsel'],
  warning: ['warning', 'uyarı', 'tuzak'],
  personal: ['personal', 'kişisel', 'kişisel bağ'],
}

export function foldTr(s: string): string {
  return s.trim().toLocaleLowerCase('tr')
    .replace(/[ıî]/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
    .replace(/[üû]/g, 'u').replace(/ö/g, 'o').replace(/â/g, 'a')
    .replace(/[\s_-]+/g, '')
}

/** eşleşme anahtarı: kırpılmış, tek boşluk, Türkçe küçük harf */
export function normText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')
}

function lookup<T extends string>(aliases: Record<T, string[]>, value: string): T | null {
  const f = foldTr(value)
  for (const key of Object.keys(aliases) as T[]) {
    if (aliases[key].some((a) => foldTr(a) === f)) return key
  }
  return null
}

export function facetFromLabel(v: string): AtomFacet | null { return lookup(FACET_ALIASES, v) }
export function hookTypeFromLabel(v: string): HookType | null { return lookup(HOOK_ALIASES, v) }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Yapay zekâ çıktısı çoğu zaman "saf JSON" değildir: ```json çitleri, önünde/arkasında açıklama cümlesi, BOM, akıllı tırnak.
 * Önce olduğu gibi denenir; olmazsa çit ve çevre metin atılır (ilk `{` … son `}`), yine olmazsa akıllı tırnaklar düz tırnağa çevrilir.
 * Başarılıysa ayrıştırılmış değer, değilse ilk hata mesajı döner. Veri "düzeltilmez"; yalnız sarmalayıcı temizlenir.
 */
export function parseLooseJson(text: string): { value: unknown } | { error: string } {
  const attempts: string[] = []
  const raw = text.replace(/^﻿/, '')
  attempts.push(raw)
  const unfenced = raw.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '')
  const first = unfenced.indexOf('{')
  const last = unfenced.lastIndexOf('}')
  if (first >= 0 && last > first) attempts.push(unfenced.slice(first, last + 1))
  const squoted = attempts[attempts.length - 1]!.replace(/[“”„«»]/g, '"').replace(/[‘’]/g, "'")
  attempts.push(squoted)
  let firstError = ''
  for (const a of attempts) {
    try {
      return { value: JSON.parse(a) }
    } catch (e) {
      if (!firstError) firstError = (e as Error).message
    }
  }
  return { error: firstError || 'boş' }
}

function optStr(o: Obj, key: string, path: string, errors: string[]): string | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') { errors.push(`${path}.${key}: metin olmalı`); return undefined }
  const t = v.trim()
  return t ? t : undefined
}

function reqStr(o: Obj, key: string, path: string, errors: string[]): string | null {
  const v = o[key]
  if (typeof v !== 'string' || !v.trim()) { errors.push(`${path}.${key}: zorunlu, boş olamaz`); return null }
  return v.trim()
}

function strList(v: unknown): string[] | null {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[]
  return null
}

function parseHookType(v: unknown, path: string, errors: string[]): HookType | null {
  if (v === undefined || v === null) return 'logic'
  const t = typeof v === 'string' ? hookTypeFromLabel(v) : null
  if (!t) { errors.push(`${path}.tur: "${String(v)}" tanınmadı (mantık, kodlama, absürt, benzetme, hikâye, görsel, uyarı, kişisel)`); return null }
  return t
}

function parseAtom(raw: unknown, path: string, errors: string[]): ImportAtom | null {
  if (!isObj(raw)) { errors.push(`${path}: nesne olmalı`); return null }
  const before = errors.length
  const subjectName = reqStr(raw, 'ders', path, errors)
  const konu = reqStr(raw, 'konu', path, errors)
  const altbaslik = optStr(raw, 'altbaslik', path, errors) ?? optStr(raw, 'altBaslik', path, errors) ?? optStr(raw, 'alt_baslik', path, errors)
  const text = reqStr(raw, 'atom', path, errors)
  const prompt = reqStr(raw, 'soru', path, errors)
  const why = optStr(raw, 'neden', path, errors)
  const how = optStr(raw, 'nasil', path, errors) ?? optStr(raw, 'nasıl', path, errors)

  const facets: AtomFacet[] = []
  if (raw.tur !== undefined && raw.tur !== null) {
    const list = strList(raw.tur)
    if (!list) errors.push(`${path}.tur: metin ya da metin dizisi olmalı (${ATOM_FACETS.join(', ')})`)
    else for (const t of list) {
      const f = facetFromLabel(t)
      if (!f) errors.push(`${path}.tur: "${t}" tanınmadı (olgu, tarih, kronoloji, tanım, sebep-sonuç, süreç, karşılaştırma, mekân, kural, istisna)`)
      else if (!facets.includes(f)) facets.push(f)
    }
  }

  const hooks: ImportAtom['hooks'] = []
  if (raw.cengel !== undefined && raw.cengel !== null) {
    const list = Array.isArray(raw.cengel) ? raw.cengel : [raw.cengel]
    list.forEach((hk, i) => {
      const hp = `${path}.cengel[${i}]`
      if (typeof hk === 'string') { if (hk.trim()) hooks.push({ type: 'mnemonic', content: hk.trim() }); return } // düz metin → kodlama
      if (!isObj(hk)) { errors.push(`${hp}: { "tur": …, "metin": … } nesnesi olmalı`); return }
      const content = reqStr(hk, 'metin', hp, errors)
      const type = parseHookType(hk.tur, hp, errors)
      if (content && type) hooks.push({ type, content })
    })
  }

  if (errors.length > before || !subjectName || !konu || !text || !prompt) return null
  const atom: ImportAtom = { subjectName, topicName: altbaslik ? `${konu}${TOPIC_SEPARATOR}${altbaslik}` : konu, text, prompt, facets, hooks }
  if (why) atom.why = why
  if (how) atom.how = how
  return atom
}

function parseQuestion(raw: unknown, path: string, errors: string[]): ImportQuestion | null {
  if (!isObj(raw)) { errors.push(`${path}: nesne olmalı`); return null }
  const before = errors.length
  const atomText = optStr(raw, 'atom', path, errors) ?? null
  const atomId = optStr(raw, 'atomId', path, errors) ?? null
  if (!atomText && !atomId) errors.push(`${path}.atom: zorunlu — sorunun bağlı olduğu atomun metni (birebir)`)
  const text = reqStr(raw, 'soru', path, errors)
  const source = reqStr(raw, 'kaynak', path, errors)

  let options: string[] = []
  const rawOpts = raw.secenekler
  if (!Array.isArray(rawOpts) || !rawOpts.every((o) => typeof o === 'string' && o.trim())) {
    errors.push(`${path}.secenekler: ${MIN_OPTIONS}–${MAX_OPTIONS} adet boş olmayan metin dizisi olmalı`)
  } else {
    options = (rawOpts as string[]).map((o) => o.trim())
    if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) errors.push(`${path}.secenekler: ${options.length} seçenek; ${MIN_OPTIONS}–${MAX_OPTIONS} olmalı`)
    if (new Set(options.map(normText)).size !== options.length) errors.push(`${path}.secenekler: seçenekler birbirinden farklı olmalı`)
  }

  let correctIndex = -1
  const dogru = raw.dogru
  if (typeof dogru === 'number') errors.push(`${path}.dogru: doğru seçeneğin METNİNİ yaz (sayı değil; 0/1 tabanı belirsizliği yanlış cevabı doğru işaretler)`)
  else if (typeof dogru !== 'string' || !dogru.trim()) errors.push(`${path}.dogru: zorunlu — doğru seçeneğin metni`)
  else if (options.length) {
    correctIndex = options.findIndex((o) => normText(o) === normText(dogru))
    if (correctIndex < 0) errors.push(`${path}.dogru: "${dogru.trim()}" seçenekler arasında yok`)
  }

  if (errors.length > before || !text || !source || correctIndex < 0) return null
  return { atomText, atomId, text, options, correctIndex, source, path }
}

function parseHook(raw: unknown, path: string, errors: string[]): ImportHook | null {
  if (!isObj(raw)) { errors.push(`${path}: nesne olmalı`); return null }
  const before = errors.length
  const atomText = optStr(raw, 'atom', path, errors) ?? null
  const atomId = optStr(raw, 'atomId', path, errors) ?? null
  if (!atomText && !atomId) errors.push(`${path}.atom: zorunlu — çengelin bağlı olduğu atomun metni (birebir)`)
  const content = reqStr(raw, 'metin', path, errors)
  const type = raw.tur === undefined || raw.tur === null ? 'mnemonic' : parseHookType(raw.tur, path, errors) // bölümün varsayılanı kodlama
  if (errors.length > before || !content || !type) return null
  return { atomText, atomId, type, content, path }
}

export function parseContentImport(text: string): ParsedContent {
  const errors: string[] = []
  const atoms: ImportAtom[] = []
  const questions: ImportQuestion[] = []
  const hooks: ImportHook[] = []
  const parsed = parseLooseJson(text)
  if ('error' in parsed) return { atoms, questions, hooks, errors: [`JSON okunamadı: ${parsed.error}. Metin bir { ile başlayıp } ile bitmeli; yapay zekâ çıktısında JSON dışında açıklama varsa yalnız JSON kısmını al.`] }
  const root = parsed.value
  if (!isObj(root)) return { atoms, questions, hooks, errors: ['Kök bir nesne olmalı: { "atomlar": [...], "sorular": [...] }'] }
  if (root.format !== undefined && root.format !== CONTENT_IMPORT_FORMAT) errors.push(`format: "${String(root.format)}" tanınmadı; beklenen "${CONTENT_IMPORT_FORMAT}"`)
  const rawAtoms = root.atomlar ?? []
  const rawQs = root.sorular ?? []
  const rawHooks = root.cengeller ?? root.kodlamalar ?? []
  if (!Array.isArray(rawAtoms)) errors.push('atomlar: dizi olmalı')
  else rawAtoms.forEach((raw, i) => { const a = parseAtom(raw, `atomlar[${i}]`, errors); if (a) atoms.push(a) })
  if (!Array.isArray(rawQs)) errors.push('sorular: dizi olmalı')
  else rawQs.forEach((raw, i) => { const q = parseQuestion(raw, `sorular[${i}]`, errors); if (q) questions.push(q) })
  if (!Array.isArray(rawHooks)) errors.push('cengeller: dizi olmalı')
  else rawHooks.forEach((raw, i) => { const hk = parseHook(raw, `cengeller[${i}]`, errors); if (hk) hooks.push(hk) })
  if (!errors.length && !atoms.length && !questions.length && !hooks.length) errors.push('İçe aktarılacak bir şey yok: "atomlar", "sorular" ve "cengeller" boş')
  return { atoms, questions, hooks, errors }
}

/**
 * Plan: aynı metinli (arşivlenmemiş) atom varsa yeniden eklenmez, sorular/çengeller ona bağlanır; aynı atomda aynı metinli soru ya da
 * çengel varsa eklenmez. Bir öğenin atomu bulunamıyorsa hata (sessiz atlama yok). Hata varsa plan uygulanmaz.
 */
export function planContentImport(parsed: ParsedContent, existing: ExistingContent): ImportPlan {
  const errors = [...parsed.errors]
  const targets = new Map<string, AtomTarget>()
  for (const a of existing.atoms) if (!a.archived) targets.set(normText(a.text), { kind: 'existing', atomId: a.id })

  const atoms: ImportAtom[] = []
  let skippedAtoms = 0
  for (const a of parsed.atoms) {
    const key = normText(a.text)
    if (targets.has(key)) { skippedAtoms++; continue }
    targets.set(key, { kind: 'new', index: atoms.length })
    atoms.push({ ...a, hooks: [...a.hooks] })
  }

  const resolveTarget = (atomText: string | null, atomId: string | null, path: string, what: string): AtomTarget | null => {
    if (atomId) {
      if (existing.atoms.some((a) => a.id === atomId)) return { kind: 'existing', atomId }
      errors.push(`${path}.atomId: "${atomId}" bulunamadı`)
      return null
    }
    const t = targets.get(normText(atomText ?? ''))
    if (!t) errors.push(`${path}.atom: "${atomText}" bulunamadı — ${what} bu dosyadaki "atomlar" içinde ya da mevcut içerikte birebir aynı metinli bir atoma bağlanmalı`)
    return t ?? null
  }

  const existingQ = new Set(existing.questions.filter((q) => !q.archived).map((q) => `${q.primaryAtomId}\n${normText(q.text)}`))
  const seenQ = new Set<string>()
  const questions: PlannedQuestion[] = []
  let skippedQuestions = 0
  for (const q of parsed.questions) {
    const target = resolveTarget(q.atomText, q.atomId, q.path, 'soru')
    if (!target) continue
    const key = `${target.kind === 'new' ? `new:${target.index}` : target.atomId}\n${normText(q.text)}`
    if (seenQ.has(key) || (target.kind === 'existing' && existingQ.has(`${target.atomId}\n${normText(q.text)}`))) { skippedQuestions++; continue }
    seenQ.add(key)
    questions.push({ text: q.text, options: q.options, correctIndex: q.correctIndex, source: q.source, atom: target })
  }

  const existingH = new Set((existing.hooks ?? []).map((h) => `${h.atomId}\n${normText(h.content)}`))
  const seenH = new Set<string>()
  const hooks: PlannedHook[] = []
  let skippedHooks = 0
  for (const hk of parsed.hooks) {
    const target = resolveTarget(hk.atomText, hk.atomId, hk.path, 'çengel')
    if (!target) continue
    if (target.kind === 'new') {
      const atom = atoms[target.index]!
      if (atom.hooks.some((x) => normText(x.content) === normText(hk.content))) { skippedHooks++; continue }
      atom.hooks.push({ type: hk.type, content: hk.content })
      continue
    }
    const key = `${target.atomId}\n${normText(hk.content)}`
    if (seenH.has(key) || existingH.has(key)) { skippedHooks++; continue }
    seenH.add(key)
    hooks.push({ atomId: target.atomId, type: hk.type, content: hk.content })
  }

  return { atoms, questions, hooks, skippedAtoms, skippedQuestions, skippedHooks, errors }
}

/** Ekranda özet cümlesi (tek yerde üretilir; test edilir). Yeni atomların kendi çengelleri atom sayısına dâhildir. */
export function summarizePlan(p: ImportPlan): string {
  const parts = [`${p.atoms.length} atom, ${p.questions.length} soru eklenecek`]
  if (p.hooks.length) parts.push(`${p.hooks.length} çengel mevcut atomlara eklenecek`)
  const skipped: string[] = []
  if (p.skippedAtoms) skipped.push(`${p.skippedAtoms} atom`)
  if (p.skippedQuestions) skipped.push(`${p.skippedQuestions} soru`)
  if (p.skippedHooks) skipped.push(`${p.skippedHooks} çengel`)
  if (skipped.length) parts.push(`${skipped.join(', ')} zaten var (atlanır)`)
  return parts.join(' · ')
}
