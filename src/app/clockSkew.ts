// 06 §3.1 — Saat tutarsızlığı (clock skew). Ham timestamp cihaz saatidir; SESSİZ düzeltme yapılmaz. Eşikler (5 dk geride, 1 gün
// ileride) uygulama katmanındadır (BL-24); motor dakika/gün sabiti taşımaz. Kurtarma yolu: kullanıcı kararıyla
// AttemptVoid { reason: clock_skew }; Attempt silinmez.
import type { Attempt, AttemptVoid } from '../domain'
import type { Memory } from '../engine/rebuild/rebuild'

export const SKEW_BEHIND_MS = 5 * 60_000
export const SKEW_AHEAD_MS = 24 * 60 * 60_000

export interface ClockSkewReport {
  /** timestamp > now + 1 gün olan, void edilmemiş Attempt'lar ("İleri tarihli kayıtlar" listesi) */
  futureDated: Attempt[]
  /** sequence sırasında önceki olaydan 5 dakikadan fazla GERİDE kalan olay sayısı */
  behindEvents: number
  /** MemoryState.lastReview şu andan 1 günden fazla ileride olan atom sayısı */
  lastReviewAhead: number
  warning: boolean
}

export function clockSkewReport(attempts: readonly Attempt[], voids: readonly AttemptVoid[], memory: Memory, now: string): ClockSkewReport {
  const nowMs = Date.parse(now)
  const voided = new Set(voids.map((v) => v.targetAttemptId))
  const live = attempts.filter((a) => !voided.has(a.id))
  const futureDated = live.filter((a) => Date.parse(a.timestamp) > nowMs + SKEW_AHEAD_MS)
  // geride kalma kontrolü void edilmiş kayıtları görmez: kullanıcı ileri tarihli kaydı geçersiz kılınca uyarı kalkar
  const events: { sequence: number; timestamp: string }[] = [...live, ...voids].sort((x, y) => x.sequence - y.sequence)
  let behindEvents = 0
  for (let i = 1; i < events.length; i++) {
    if (Date.parse(events[i]!.timestamp) < Date.parse(events[i - 1]!.timestamp) - SKEW_BEHIND_MS) behindEvents++
  }
  let lastReviewAhead = 0
  for (const s of memory.values()) if (s.lastReview && Date.parse(s.lastReview) > nowMs + SKEW_AHEAD_MS) lastReviewAhead++
  return { futureDated, behindEvents, lastReviewAhead, warning: futureDated.length > 0 || behindEvents > 0 || lastReviewAhead > 0 }
}
