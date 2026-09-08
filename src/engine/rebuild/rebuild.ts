// 02 §5 — REBUILD: rebuild(attempts, voids, policy, config) → { reviewEvents, memory }. Saf; depoya yazmaz; içerik tablolarına
// dokunmaz (A6/A9 snapshot). Anlık kayıt ve REBUILD aynı applyAttempt'ı çağırır (02 giriş: iki ayrı kod yolu yasak).
import type { Attempt, AttemptVoid, EvidencePolicy, MemoryState, ReviewEvent, SchedulerConfig } from '../../domain'
import { canonicalJson, compareCodePoint } from '../backup/canonical'
import { ratingFor as defaultRatingFor, type RatingFor } from '../evidence/policy'
import { createScheduler, type Scheduler } from '../scheduler/adapter'

export type Memory = Map<string, MemoryState>

export interface RebuildResult {
  reviewEvents: ReviewEvent[]
  memory: Memory
}

export interface RebuildDeps {
  /** BL-22: yalnız test enjeksiyonu için; üretim kodu v1 tablosunu kullanır. */
  ratingFor?: RatingFor
}

/** 02 §5.3 — monoton kırpma: reviewedAt = max(attempt.timestamp, prev.lastReview); Attempt.timestamp değişmez. */
function clampReviewedAt(timestamp: string, prev: MemoryState | undefined): string {
  if (!prev?.lastReview) return timestamp
  return new Date(timestamp).getTime() >= new Date(prev.lastReview).getTime() ? timestamp : prev.lastReview
}

/**
 * 02 §5.2 adım 6a–6j'nin tek attempt için hâli. Void filtresi çağıranda (rebuild 6a / anlık yol void'i hiç ulaştırmaz).
 * Döndürür: ReviewEvent ya da null (pretest — A5).
 */
export function applyAttempt(memory: Memory, attempt: Attempt, policy: EvidencePolicy, scheduler: Scheduler, rating: RatingFor = defaultRatingFor): ReviewEvent | null {
  const r = rating(attempt, policy) // 6b — Attempt'ın kendi alanlarından
  if (r === null) return null // 6c — pretest
  const atomId = attempt.primaryAtomIdAtAttempt // 6d — snapshot (A6), güncel Question'a bakılmaz
  const prev = memory.get(atomId) // 6e
  const reviewedAt = prev ? clampReviewedAt(attempt.timestamp, prev) : attempt.timestamp
  const base = prev ?? scheduler.emptyState(atomId, reviewedAt)
  const next = scheduler.next(base, reviewedAt, r) // 6g — vade yalnız adaptörde yazılır (A15)
  next.lastAttemptKind = attempt.kind // 6h
  if (attempt.kind === 'question') next.lastQuestionId = attempt.questionId
  memory.set(atomId, next) // 6i
  return { attemptId: attempt.id, atomId, rating: r, reviewedAt } // 6j
}

export function rebuild(attempts: readonly Attempt[], voids: readonly AttemptVoid[], policy: EvidencePolicy, config: SchedulerConfig, deps: RebuildDeps = {}): RebuildResult {
  const reviewEvents: ReviewEvent[] = [] // 1
  const memory: Memory = new Map() // 2
  const voided = new Set(voids.map((v) => v.targetAttemptId)) // 3 — aynı hedefe çift void tek kez etkili
  const ordered = [...attempts].sort((a, b) => a.sequence - b.sequence) // 4 — A19: sequence ASC; timestamp'e bakılmaz
  const scheduler = createScheduler(config) // 5
  const rating = deps.ratingFor ?? defaultRatingFor
  for (const attempt of ordered) {
    if (voided.has(attempt.id)) continue // 6a — A3
    const ev = applyAttempt(memory, attempt, policy, scheduler, rating)
    if (ev) reviewEvents.push(ev)
  }
  return { reviewEvents, memory } // 7
}

/** 08 §0: atomId'ye göre sıralı kanonik JSON; determinizm karşılaştırmaları bununla yapılır (bayt bayt eşitlik, A4). */
export function serializeMemory(memory: Memory): string {
  const entries = [...memory.values()].sort((a, b) => compareCodePoint(a.atomId, b.atomId))
  return canonicalJson(entries)
}
