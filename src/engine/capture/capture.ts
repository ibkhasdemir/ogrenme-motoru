// 05_LEARNING_CAPTURE.md — Öğrenme Kutusu çekirdeği (saf). Yakalama ölçüm DEĞİLDİR (A17):
// yalnız hafıza durumu OLAN bir atomun gerçek hatırlama başarısızlığı Attempt üretir (05 §2).
// InboxItem olay değildir (05 §3.2): düzenlenebilir, 'discarded' olabilir, hiçbir projeksiyona girmez.
import type { Attempt, AttemptVoid, Confidence, InboxItem, RecallAttemptInput } from '../../domain'

/** 05 §3.3 adım 4 — "Bu neden geldi?" tek sorusunun cevapları. */
export const CAPTURE_REASONS = ['curious', 'forgot', 'wrong', 'confused'] as const
export type CaptureReason = (typeof CAPTURE_REASONS)[number]

/** Attempt üreten nedenler: merak Attempt üretmez (05 §2 Inquiry). */
export function reasonProducesAttempt(reason: CaptureReason): boolean {
  return reason !== 'curious'
}

export class CaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptureError'
  }
}

/**
 * 05 §5a F01 — üç zaman ayrı: olay/yakalama zamanı ile işleme zamanı karışmaz. External review uygunluğu
 * BAŞARISIZLIĞIN yaşandığı ana bakar: o an atomun hafıza durumu var mıydı? (Pazartesi öğrenilmemiş → salı öğrenilmiş →
 * çarşamba işlenmiş olay review üretmez.) Void edilmiş denemeler sayılmaz (03 §6.5).
 */
export function hadMemoryAt(atomId: string, at: string, attempts: readonly Attempt[], voids: readonly AttemptVoid[]): boolean {
  const voided = new Set(voids.map((v) => v.targetAttemptId))
  const t = Date.parse(at)
  return attempts.some((a) => !voided.has(a.id) && a.primaryAtomIdAtAttempt === atomId && a.mode !== 'pretest' && Date.parse(a.timestamp) <= t)
}

/** Aynı kutu öğesi ikinci kez Attempt üretemez (05 §5a F02, tekrar-güvenli): id kutu öğesinden türetilir. */
export function externalAttemptId(inboxItemId: string): string {
  return `ext-${inboxItemId}`
}

export interface ExternalFailureInput {
  item: InboxItem
  atomId: string
  reason: CaptureReason
  /** yalnız "Yanlış yaptım" yolunda sorulur: "Bundan emin miydin?" (05 §3.3) */
  sureAtFailure?: boolean
  sessionId: string
}

/**
 * 05 §2 + §5a F02 — external RecallAttempt:
 * - `selfAssessment: 'again'` (gerçek hatırlama başarısızlığı), `mode: 'external'`
 * - `timestamp` = yakalama anı (`item.capturedAt`), `sequence` depoda atanır (A19)
 * - `responseTimeMs` ve `support` gözlemlenemez → null; sıfır/`none` uydurulmaz
 * - `confidenceAtFailure` yalnız "Yanlış yaptım" yolunda yazılır (yanlış+emin sınıfı yapılandırılmış alandır, not'a gömülmez)
 */
export function buildExternalRecallAttempt(input: ExternalFailureInput): RecallAttemptInput {
  if (!reasonProducesAttempt(input.reason)) throw new CaptureError('Merak yakalaması Attempt üretmez (05 §2)')
  if (input.item.status !== 'pending') throw new CaptureError(`Kutu öğesi zaten işlenmiş: ${input.item.status}`)
  const confidenceAtFailure: Confidence | undefined = input.reason === 'wrong' ? (input.sureAtFailure ? 'sure' : 'unsure') : undefined
  return {
    id: externalAttemptId(input.item.id),
    kind: 'recall',
    sourceInboxItemId: input.item.id,
    timestamp: input.item.capturedAt,
    sessionId: input.sessionId,
    primaryAtomIdAtAttempt: input.atomId,
    atomId: input.atomId,
    mode: 'external',
    confidence: null,
    operation: 'recall',
    support: null,
    responseTimeMs: null,
    selfAssessment: 'again',
    ...(confidenceAtFailure ? { confidenceAtFailure } : {}),
  }
}
