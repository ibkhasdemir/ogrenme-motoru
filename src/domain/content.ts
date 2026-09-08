// 01_DOMAIN_MODEL.md §2–§3 — İçerik varlıkları. Kimlikler UUID string; zamanlar ISO 8601 UTC string.
import type {
  AtomFacet, HookType, IntegrityStatus, OptionAtomRelation, ProvenanceType,
  QuestionAtomRole, RelationType,
} from './enums'

/** 01 §2.10 — gömülü köken nesnesi. */
export interface Provenance {
  type: ProvenanceType
  note?: string
  ref?: string | null
  date: string
  context?: string
}

/** 01 §2.1 */
export interface Subject {
  id: string
  name: string
  sortOrder: number
}

/** 01 §2.2 */
export interface Topic {
  id: string
  subjectId: string
  name: string
  sortOrder: number
}

/** 01 §2.3 — öğrenme birimi (A1). `prompt` boş yalnız eski veriden gelebilir; boşsa kuyruğa girmez (BLOCKERS BL-13). */
export interface Atom {
  id: string
  topicId: string
  text: string
  prompt: string
  facets: AtomFacet[]
  sortOrder: number
  archived: boolean
  createdAt: string
  why?: string
  how?: string
  confusedWith?: string
  provenance?: Provenance[]
}

/** 01 §2.4 */
export interface MemoryHook {
  id: string
  atomId: string
  type: HookType
  content: string
}

/** 01 §2.5 — mantıksal soru kimliği; metin/seçenek/doğru bu kayıtta YOKTUR (revision'dadır). `updatedAt` null yalnız migration'dan (BL-13). */
export interface Question {
  id: string
  currentVersion: number
  primaryAtomId: string
  source: string
  archived: boolean
  createdAt: string
  updatedAt: string | null
  provenance?: Provenance[]
  trapType?: string
  questionType?: string
}

/** 01 §2.6 */
export interface QuestionOption {
  id: string
  text: string
}

/** 01 §2.5 / 06 §6.2 — migration kökeni. */
export interface LegacyProvenance {
  migratedAt: string
  fromSchemaVersion: number
  createdAtSource: 'legacy_created_at' | 'unknown'
}

/** 01 §2.5 — tam semantik snapshot; değiştirilemez. `integrityStatus` yoksa complete kabul edilir. */
export interface CompleteQuestionRevision {
  questionId: string
  version: number
  integrityStatus?: 'complete'
  text: string
  options: QuestionOption[]
  correctOptionId: string
  primaryAtomId: string
  /** null yalnız migration'dan gelen ve gerçek sürüm tarihi olmayan revision'larda (createdAtSource = "unknown"). */
  createdAt: string | null
  legacyProvenance?: LegacyProvenance
}

/** 01 §2.5 — eski veri modelinde saklanmamış geçmiş; içerik UYDURULMAZ (A9). Yalnız migration üretir. */
export interface LegacyUnavailableQuestionRevision {
  questionId: string
  version: number
  integrityStatus: 'content_unavailable_legacy'
  text: null
  options: null
  correctOptionId: null
  primaryAtomId: string | null
  createdAt: null
  legacyProvenance: LegacyProvenance
}

export type QuestionRevision = CompleteQuestionRevision | LegacyUnavailableQuestionRevision

export function revisionStatus(r: QuestionRevision): IntegrityStatus {
  return r.integrityStatus ?? 'complete'
}

export function isCompleteRevision(r: QuestionRevision): r is CompleteQuestionRevision {
  return revisionStatus(r) === 'complete'
}

/** 01 §2.7 — güncel sürüme göre soru ↔ atom bağı; her sorunun tam bir primary kaydı vardır. */
export interface QuestionAtom {
  questionId: string
  atomId: string
  role: QuestionAtomRole
}

/** 01 §2.8 — yanlış şıkkın karıştığı atom; güncel sürüme aittir. */
export interface OptionAtom {
  questionId: string
  optionId: string
  atomId: string
  relation: OptionAtomRelation
}

/** 01 §2.9 */
export interface AtomRelation {
  fromAtomId: string
  toAtomId: string
  type: RelationType
}

/** 01 §3.1 — v0 dışı; alan tanımı tutarlılık için. Olay DEĞİLDİR. */
export interface InboxItem {
  id: string
  rawText: string
  capturedAt: string
  status: 'pending' | 'processed' | 'discarded'
  imageRef?: string
  audioRef?: string
  provenance?: Provenance
}
