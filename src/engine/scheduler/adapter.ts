// 02 §3 — FSRS Adapter. ts-fsrs'i import eden TEK modül (A-02, A-06). `due` yalnız burada yazılır (A15, 11 kural 13).
// Pin: ts-fsrs 5.4.2 (FSRS-6). Uygulama dakikayı/günü kendi hesaplamaz; scheduler.next'in yazdığı due'yu kullanır (02 §3.1a).
import { createEmptyCard, fsrs, generatorParameters, type Card, type FSRS, type Grade, type State } from 'ts-fsrs'
import type { MemoryState, Rating, SchedulerConfig } from '../../domain'

export interface Scheduler {
  readonly config: SchedulerConfig
  /** New kart (state 0, reps 0). Asla saklanmaz; hemen next() ile kullanılır. */
  emptyState(atomId: string, now: string): MemoryState
  /** vade YALNIZ burada yazılır (A15). lastAttemptKind/lastQuestionId korunur; applyAttempt yazar (02 §5.2 6h). */
  next(state: MemoryState, reviewedAt: string, rating: Rating): MemoryState
  /** 0..1; New kart için 0 */
  retrievability(state: MemoryState, now: string): number
  /** generatorParameters() çıktısındaki tam w listesi (02 §4 resolvedWeights) */
  resolvedWeights(): number[]
}

/** Kurulu motor kimliği (02 §4.1). Pin değişirse 13 §6.4 adımları zorunludur. */
export const INSTALLED_ENGINE = { engine: 'ts-fsrs', engineVersion: '5.4.2', algorithm: 'FSRS-6' } as const

function toParameters(config: SchedulerConfig) {
  return generatorParameters({
    request_retention: config.requestRetention,
    maximum_interval: config.maximumInterval,
    enable_fuzz: config.enableFuzz,
    enable_short_term: config.enableShortTerm,
    learning_steps: config.learningSteps as never,
    relearning_steps: config.relearningSteps as never,
    ...(config.weights ? { w: config.weights } : {}),
  })
}

export function resolveWeights(config: SchedulerConfig): number[] {
  return [...toParameters(config).w]
}

/** Yedek alınırken config'e tam ağırlık listesi eklenir (02 §4, 06 §7). */
export function withResolvedWeights(config: SchedulerConfig): SchedulerConfig {
  return { ...config, resolvedWeights: resolveWeights(config) }
}

export type EngineTriple = Pick<SchedulerConfig, 'engine' | 'engineVersion' | 'algorithm'> & Partial<SchedulerConfig>

/** 02 §4.1: bayt bayt aynı MemoryState garantisi yalnız aynı engine + engineVersion + algorithm ile. */
export function isCompatible(backupConfig: EngineTriple, installed: EngineTriple): boolean {
  return backupConfig.engine === installed.engine && backupConfig.engineVersion === installed.engineVersion && backupConfig.algorithm === installed.algorithm
}

function toCard(s: MemoryState): Card {
  const card: Card = {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    // elapsed_days kütüphane tarafından last_review ile now farkından yeniden hesaplanır; scheduled_days hesaba girmez (02 §3.1)
    elapsed_days: 0,
    scheduled_days: 0,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
    learning_steps: s.learningSteps,
  }
  if (s.reps > 0 && s.lastReview) card.last_review = new Date(s.lastReview)
  return card
}

function fromCard(atomId: string, card: Card, prev: Pick<MemoryState, 'lastAttemptKind' | 'lastQuestionId'>): MemoryState {
  const state: MemoryState = {
    atomId,
    due: card.due.toISOString(), // A15: tek yazma noktası
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as 0 | 1 | 2 | 3,
    learningSteps: card.learning_steps,
    lastReview: card.last_review ? new Date(card.last_review).toISOString() : null,
    lastAttemptKind: prev.lastAttemptKind,
  }
  if (prev.lastQuestionId !== undefined) state.lastQuestionId = prev.lastQuestionId
  return state
}

export function createScheduler(config: SchedulerConfig): Scheduler {
  if (config.enableFuzz) throw new Error('02 §4.2: enableFuzz v0\'da kapalı olmalıdır (determinizm)')
  const params = toParameters(config)
  const f: FSRS = fsrs(params)
  return {
    config,
    emptyState(atomId, now) {
      return fromCard(atomId, createEmptyCard(new Date(now)), { lastAttemptKind: null })
    },
    next(state, reviewedAt, rating) {
      if (rating < 1 || rating > 4) throw new Error(`Geçersiz rating: ${rating}`)
      const { card } = f.next(toCard(state), new Date(reviewedAt), rating as Grade)
      return fromCard(state.atomId, card, state)
    },
    retrievability(state, now) {
      if (state.state === 0) return 0 // 02 §3.1: New kart için anlamsız/0
      const r = f.get_retrievability(toCard(state), new Date(now), false)
      return typeof r === 'number' ? r : Number(r)
    },
    resolvedWeights() {
      return [...params.w]
    },
  }
}
