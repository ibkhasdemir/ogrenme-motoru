// İçerik içe aktarma (BL-38 — spec dışı; sahibi kararıyla 2026-09-08 eklendi). Saf: metin → doğrulanmış plan.
// Yalnız EKLER: mevcut içerik ve öğrenme geçmişi değişmez; birleştirme/senkron değildir (10 non-goal ayrımı korunur).
// Biçim kullanıcıya dönüktür (Türkçe anahtarlar); depolanan değerler domain enum'larıdır. Uygulamada LLM yok: JSON'u kullanıcı
// dışarıda (yapay zekâ sohbeti, tablo, elle) üretir, buraya yapıştırır. Hatalı bir öğe varsa hiçbir şey eklenmez (atomik plan).
import type { Atom, AtomFacet, HookType } from '../../domain'
import { ATOM_FACETS } from '../../domain'

export const CONTENT_IMPORT_FORMAT = 'ogrenme-motoru-icerik/1'
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 5

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

export interface ParsedContent {
  atoms: ImportAtom[]
  questions: ImportQuestion[]
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

export interface ImportPlan {
  atoms: ImportAtom[]
  questions: PlannedQuestion[]
  skippedAtoms: number
  skippedQuestions: number
  errors: string[]
}

export interface ExistingContent {
  atoms: Atom[]
  /** mevcut soruların güncel sürüm metinleri (yalnız içeriği mevcut sürümler) */
  questions: { primaryAtomId: string; text: string; archived: boolean }[]
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

function parseAtom(raw: unknown, path: string, errors: string[]): ImportAtom | null {
  if (!isObj(raw)) { errors.push(`${path}: nesne olmalı`); return null }
  const before = errors.length
  const subjectName = reqStr(raw, 'ders', path, errors)
  const topicName = reqStr(raw, 'konu', path, errors)
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
      if (!isObj(hk)) { errors.push(`${hp}: { "tur": …, "metin": … } nesnesi olmalı`); return }
      const content = reqStr(hk, 'metin', hp, errors)
      let type: HookType = 'logic'
      if (hk.tur !== undefined && hk.tur !== null) {
        const t = typeof hk.tur === 'string' ? hookTypeFromLabel(hk.tur) : null
        if (!t) { errors.push(`${hp}.tur: "${String(hk.tur)}" tanınmadı (mantık, kodlama, absürt, benzetme, hikâye, görsel, uyarı, kişisel)`); return }
        type = t
      }
      if (content) hooks.push({ type, content })
    })
  }

  if (errors.length > before || !subjectName || !topicName || !text || !prompt) return null
  const atom: ImportAtom = { subjectName, topicName, text, prompt, facets, hooks }
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

export function parseContentImport(text: string): ParsedContent {
  const errors: string[] = []
  const atoms: ImportAtom[] = []
  const questions: ImportQuestion[] = []
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch (e) {
    return { atoms, questions, errors: [`JSON okunamadı: ${(e as Error).message}`] }
  }
  if (!isObj(root)) return { atoms, questions, errors: ['Kök bir nesne olmalı: { "atomlar": [...], "sorular": [...] }'] }
  if (root.format !== undefined && root.format !== CONTENT_IMPORT_FORMAT) errors.push(`format: "${String(root.format)}" tanınmadı; beklenen "${CONTENT_IMPORT_FORMAT}"`)
  const rawAtoms = root.atomlar ?? []
  const rawQs = root.sorular ?? []
  if (!Array.isArray(rawAtoms)) errors.push('atomlar: dizi olmalı')
  else rawAtoms.forEach((raw, i) => { const a = parseAtom(raw, `atomlar[${i}]`, errors); if (a) atoms.push(a) })
  if (!Array.isArray(rawQs)) errors.push('sorular: dizi olmalı')
  else rawQs.forEach((raw, i) => { const q = parseQuestion(raw, `sorular[${i}]`, errors); if (q) questions.push(q) })
  if (!errors.length && !atoms.length && !questions.length) errors.push('İçe aktarılacak bir şey yok: "atomlar" ve "sorular" boş')
  return { atoms, questions, errors }
}

/**
 * Plan: aynı metinli (arşivlenmemiş) atom varsa yeniden eklenmez, sorular ona bağlanır; aynı atomda aynı metinli soru varsa eklenmez.
 * Bir sorunun atomu bulunamıyorsa hata (sessiz atlama yok). Hata varsa plan uygulanmaz.
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
    atoms.push(a)
  }

  const existingQ = new Set(existing.questions.filter((q) => !q.archived).map((q) => `${q.primaryAtomId}\n${normText(q.text)}`))
  const seenQ = new Set<string>()
  const questions: PlannedQuestion[] = []
  let skippedQuestions = 0
  for (const q of parsed.questions) {
    let target: AtomTarget | undefined
    if (q.atomId) {
      target = existing.atoms.some((a) => a.id === q.atomId) ? { kind: 'existing', atomId: q.atomId } : undefined
      if (!target) { errors.push(`${q.path}.atomId: "${q.atomId}" bulunamadı`); continue }
    } else {
      target = targets.get(normText(q.atomText ?? ''))
      if (!target) { errors.push(`${q.path}.atom: "${q.atomText}" bulunamadı — bu dosyadaki "atomlar" içinde ya da mevcut içerikte birebir aynı metin olmalı`); continue }
    }
    const key = `${target.kind === 'new' ? `new:${target.index}` : target.atomId}\n${normText(q.text)}`
    if (seenQ.has(key) || (target.kind === 'existing' && existingQ.has(`${target.atomId}\n${normText(q.text)}`))) { skippedQuestions++; continue }
    seenQ.add(key)
    questions.push({ text: q.text, options: q.options, correctIndex: q.correctIndex, source: q.source, atom: target })
  }
  return { atoms, questions, skippedAtoms, skippedQuestions, errors }
}

/** Ekranda özet cümlesi (tek yerde üretilir; test edilir). */
export function summarizePlan(p: ImportPlan): string {
  const parts = [`${p.atoms.length} atom, ${p.questions.length} soru eklenecek`]
  if (p.skippedAtoms || p.skippedQuestions) parts.push(`${p.skippedAtoms} atom, ${p.skippedQuestions} soru zaten var (atlanır)`)
  return parts.join(' · ')
}
