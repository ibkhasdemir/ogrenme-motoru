// 01_DOMAIN_MODEL.md §4 — Ham olaylar (append-only, A3). Tüm alanlar yazıldıktan sonra değişmez.
import type {
  AttemptKind, AttemptMode, AttemptVoidReason, Confidence, Operation, SelfAssessment, Support, WrongReason,
} from './enums'

/** 01 §4.1 — ortak alanlar. `sequence` depo tarafından atanır (06 §3; BLOCKERS BL-15). */
export interface AttemptBase {
  /** actionId'den türetilir; aynı sunuma ikinci kayıt aynı id'yi alır ve depo reddeder (I-20). */
  id: string
  kind: AttemptKind
  /** yalnız geri al sonrası tekrar sunumdan doğan Attempt'ta: void edilen Attempt'ın id'si (03 §6.5). */
  replayOfAttemptId?: string
  sequence: number
  timestamp: string
  sessionId: string
  /** o anda ölçülen atom (A6) — snapshot. */
  primaryAtomIdAtAttempt: string
  mode: AttemptMode
  confidence: Confidence | null
  operation: Operation
  support: Support
  responseTimeMs: number
}

/** 01 §4.2 */
export interface QuestionAttempt extends AttemptBase {
  kind: 'question'
  confidence: Confidence
  questionId: string
  /** sunum anındaki sürüm (LearningAction.questionVersion, 01 §4.2a; BL-14). */
  questionVersion: number
  initialSelectedOptionId: string
  selectedOptionId: string
  changedAnswer: boolean
  /** cevap anında revision'a göre hesaplanır ve dondurulur. */
  correct: boolean
  /** yalnız yanlış cevapta dolu. */
  wrongReason: WrongReason | null
}

/** 01 §4.3 */
export interface RecallAttempt extends AttemptBase {
  kind: 'recall'
  confidence: null
  /** = primaryAtomIdAtAttempt */
  atomId: string
  selfAssessment: SelfAssessment
  /** yalnız mode = external (v0'da bu akış yok). */
  confidenceAtFailure?: Confidence
}

export type Attempt = QuestionAttempt | RecallAttempt

/** Depoya verilen giriş: sequence depo atar. */
export type QuestionAttemptInput = Omit<QuestionAttempt, 'sequence'>
export type RecallAttemptInput = Omit<RecallAttempt, 'sequence'>
export type AttemptInput = QuestionAttemptInput | RecallAttemptInput

/** 01 §4.6 */
export interface AttemptVoid {
  id: string
  targetAttemptId: string
  sequence: number
  timestamp: string
  reason: AttemptVoidReason
  note?: string
}

export type AttemptVoidInput = Omit<AttemptVoid, 'sequence'>
