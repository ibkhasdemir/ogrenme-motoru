// 01 §2.5–2.8 — Soru oluşturma ve semantik düzenleme planı (saf fonksiyonlar). Depo katmanı planı tek transaction'da uygular
// (06 §5). Seçenek kimliği yalnız anlam korunuyorsa yaşar; metni değişen seçenek yeni id alır (I-QA-06).
import type {
  CompleteQuestionRevision, OptionAtom, Provenance, Question, QuestionAtom, QuestionOption,
} from '../../domain'
import { OPTION_ATOM_RELATIONS } from '../../domain'

export class ContentRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentRuleError'
  }
}

export interface OptionInput {
  /** verilmezse veya mevcut revision'da yoksa yeni id üretilir. */
  id?: string
  text: string
}

/** 07 S10 — beş zorunlu alan: soru, seçenekler (2–5), doğru seçenek, ana atom, kaynak. */
export interface NewQuestionInput {
  id: string
  primaryAtomId: string
  source: string
  text: string
  /** id'ler çağıran (UI/IdGenerator) tarafından verilir. */
  options: QuestionOption[]
  correctOptionId: string
  createdAt: string
  provenance?: Provenance[]
  trapType?: string
  questionType?: string
  /** "+ Gelişmiş" — isteğe bağlı */
  secondaryAtomIds?: string[]
  optionAtoms?: OptionAtom[]
}

export interface QuestionPatch {
  text?: string
  options?: OptionInput[]
  /** gelen seçenek id'sine (mevcut veya geçici) göre. */
  correctOptionId?: string
  primaryAtomId?: string
}

export interface CurrentQuestionState {
  question: Question
  revision: CompleteQuestionRevision
  secondaryAtomIds: string[]
  optionAtoms: OptionAtom[]
}

export interface ReviseOutcome {
  question: Question
  revision: CompleteQuestionRevision
  /** yeni sürüm üretildi mi */
  created: boolean
  /** text / correctOptionId / primaryAtomId değişti → ilişkiler sıfırlandı (01 §2.8) */
  contextChanged: boolean
}

export interface RevisionPlan {
  question: Question
  /** null: semantik fark yok, sürüm üretilmez */
  newRevision: CompleteQuestionRevision | null
  contextChanged: boolean
  keepSecondaryAtomIds: string[]
  keepOptionAtoms: OptionAtom[]
}

export function validateRevisionContent(text: string, options: QuestionOption[], correctOptionId: string, primaryAtomId: string): void {
  if (!text.trim()) throw new ContentRuleError('Soru metni boş olamaz')
  if (options.length < 2) throw new ContentRuleError('En az iki seçenek gerekli')
  if (options.length > 5) throw new ContentRuleError('En fazla beş seçenek')
  const ids = new Set<string>()
  for (const o of options) {
    if (!o.id) throw new ContentRuleError('Seçenek kimliği boş')
    if (!o.text.trim()) throw new ContentRuleError('Seçenek metni boş olamaz')
    if (ids.has(o.id)) throw new ContentRuleError(`Tekrarlı seçenek kimliği: ${o.id}`)
    ids.add(o.id)
  }
  if (!ids.has(correctOptionId)) throw new ContentRuleError('Doğru seçenek seçenekler arasında değil')
  if (!primaryAtomId) throw new ContentRuleError('Ana atom gerekli')
}

/** 01 §2.8 değişmez: doğru seçenekte yanlış-şık ilişkisi olamaz (B-27); optionId revision'da bulunmalı. */
export function validateOptionAtoms(revision: CompleteQuestionRevision, items: OptionAtom[]): void {
  const ids = new Set(revision.options.map((o) => o.id))
  for (const oa of items) {
    if (oa.questionId !== revision.questionId) throw new ContentRuleError('OptionAtom başka bir soruya ait')
    if (!ids.has(oa.optionId)) throw new ContentRuleError(`OptionAtom seçeneği revision'da yok: ${oa.optionId}`)
    if (oa.optionId === revision.correctOptionId) throw new ContentRuleError('Doğru seçenekte yanlış-şık ilişkisi olamaz (01 §2.8)')
    if (!(OPTION_ATOM_RELATIONS as readonly string[]).includes(oa.relation)) throw new ContentRuleError(`Geçersiz ilişki: ${oa.relation}`)
  }
}

export interface NewQuestionPlan {
  question: Question
  revision: CompleteQuestionRevision
  questionAtoms: QuestionAtom[]
  optionAtoms: OptionAtom[]
}

export function planNewQuestion(input: NewQuestionInput): NewQuestionPlan {
  if (!input.source.trim()) throw new ContentRuleError('Kaynak gerekli')
  validateRevisionContent(input.text, input.options, input.correctOptionId, input.primaryAtomId)
  const question: Question = {
    id: input.id,
    currentVersion: 1,
    primaryAtomId: input.primaryAtomId,
    source: input.source,
    archived: false,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(input.trapType ? { trapType: input.trapType } : {}),
    ...(input.questionType ? { questionType: input.questionType } : {}),
  }
  const revision: CompleteQuestionRevision = {
    questionId: input.id,
    version: 1,
    integrityStatus: 'complete',
    text: input.text,
    options: input.options.map((o) => ({ id: o.id, text: o.text })),
    correctOptionId: input.correctOptionId,
    primaryAtomId: input.primaryAtomId,
    createdAt: input.createdAt,
  }
  const secondary = (input.secondaryAtomIds ?? []).filter((a) => a !== input.primaryAtomId)
  const questionAtoms: QuestionAtom[] = [
    { questionId: input.id, atomId: input.primaryAtomId, role: 'primary' },
    ...secondary.map((atomId) => ({ questionId: input.id, atomId, role: 'secondary' as const })),
  ]
  const optionAtoms = input.optionAtoms ?? []
  validateOptionAtoms(revision, optionAtoms)
  return { question, revision, questionAtoms, optionAtoms }
}

function sameOptions(a: QuestionOption[], b: QuestionOption[]): boolean {
  return a.length === b.length && a.every((o, i) => o.id === b[i]!.id && o.text === b[i]!.text)
}

/**
 * 01 §2.5 sürüm kuralı: text / options (metin, ekleme, çıkarma, sıra) / correctOptionId / primaryAtomId değişirse yeni
 * revision; mevcut revision'a dokunulmaz. Bağlam (text, correct, primary) değişti → tüm OptionAtom ve secondary silinir;
 * korundu → yeni revision'da olmayan optionId'lerin OptionAtom'ları silinir, eski OptionAtom yeni id'ye taşınmaz.
 */
export function planRevision(cur: CurrentQuestionState, patch: QuestionPatch, now: string, newId: () => string): RevisionPlan {
  const curOpts = cur.revision.options
  const curById = new Map(curOpts.map((o) => [o.id, o]))
  const incoming: OptionInput[] = patch.options ?? curOpts.map((o) => ({ id: o.id, text: o.text }))

  const idMap = new Map<string, string>()
  const finalOptions: QuestionOption[] = incoming.map((inc, i) => {
    const incomingKey = inc.id ?? `__new_${i}`
    const existing = inc.id ? curById.get(inc.id) : undefined
    let finalId: string
    if (existing && existing.text === inc.text) finalId = existing.id
    else finalId = newId() // metni/anlamı değişen veya yeni seçenek → yeni id (I-QA-06)
    idMap.set(incomingKey, finalId)
    return { id: finalId, text: inc.text }
  })

  const incomingCorrect = patch.correctOptionId ?? cur.revision.correctOptionId
  const finalCorrect = idMap.get(incomingCorrect) ?? incomingCorrect
  const finalText = patch.text ?? cur.revision.text
  const finalPrimary = patch.primaryAtomId ?? cur.revision.primaryAtomId

  validateRevisionContent(finalText, finalOptions, finalCorrect, finalPrimary)

  const textChanged = finalText !== cur.revision.text
  const correctChanged = finalCorrect !== cur.revision.correctOptionId
  const primaryChanged = finalPrimary !== cur.revision.primaryAtomId
  const optionsChanged = !sameOptions(finalOptions, curOpts)
  const semanticChange = textChanged || correctChanged || primaryChanged || optionsChanged

  if (!semanticChange) {
    return {
      question: cur.question,
      newRevision: null,
      contextChanged: false,
      keepSecondaryAtomIds: cur.secondaryAtomIds,
      keepOptionAtoms: cur.optionAtoms,
    }
  }

  const contextChanged = textChanged || correctChanged || primaryChanged
  const newRevision: CompleteQuestionRevision = {
    questionId: cur.question.id,
    version: cur.question.currentVersion + 1,
    integrityStatus: 'complete',
    text: finalText,
    options: finalOptions,
    correctOptionId: finalCorrect,
    primaryAtomId: finalPrimary,
    createdAt: now,
  }
  const question: Question = {
    ...cur.question,
    currentVersion: newRevision.version,
    primaryAtomId: finalPrimary,
    updatedAt: now,
  }
  const finalIds = new Set(finalOptions.map((o) => o.id))
  const keepOptionAtoms = contextChanged
    ? []
    : cur.optionAtoms.filter((oa) => finalIds.has(oa.optionId) && oa.optionId !== finalCorrect)
  const keepSecondaryAtomIds = contextChanged ? [] : cur.secondaryAtomIds.filter((a) => a !== finalPrimary)
  return { question, newRevision, contextChanged, keepSecondaryAtomIds, keepOptionAtoms }
}
