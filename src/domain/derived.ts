// 01_DOMAIN_MODEL.md §6 — Türetilmiş (silinip yeniden üretilebilir, A4).
import type { AttemptKind, MemoryStateCode, Rating } from './enums'

/** 01 §6.1 / 02 §2 */
export interface ReviewEvent {
  attemptId: string
  atomId: string
  rating: Rating
  /** atom başına monoton kırpılmış zaman (02 §5.3). */
  reviewedAt: string
}

/** 01 §6.2 — FSRS alanlarını yalnız scheduler adaptörü yazar (A15); lastAttemptKind/lastQuestionId applyAttempt yazar (02 §5.2 6h; BL-23). */
export interface MemoryState {
  atomId: string
  due: string
  stability: number
  difficulty: number
  reps: number
  lapses: number
  state: MemoryStateCode
  learningSteps: number
  lastReview: string | null
  lastAttemptKind: AttemptKind
  lastQuestionId?: string
}

/** 01 §6.3 */
export interface DailyQueueItem {
  atomId: string
  reason: 'due' | 'new'
  retrievability: number | null
}

/** 01 §6.4 — questionVersion sunum anında sabitlenir; actionId kayıt kimliğinin kaynağıdır. */
export type LearningAction =
  | { kind: 'question'; questionId: string; questionVersion: number; actionId: string }
  | { kind: 'recall'; atomId: string; actionId: string }
