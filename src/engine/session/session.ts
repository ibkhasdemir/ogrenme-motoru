// 03 §6 — Oturum: yalnız oturum durumu tutar (sessionId, monoton bütçe, answered, pendingReplay). Kuyruk snapshot'ı TUTMAZ;
// her öğe güncel MemoryState ve now ile selectNext'ten seçilir. Geri al = tek seferlik düzeltme tekrarı (§6.5).
import type { Attempt, DailyQueueItem, LearningAction } from '../../domain'
import type { Clock, IdGenerator } from '../../platform/services'
import { selectNext, type QueueContext } from '../queue/dailyQueue'

export type NextItem =
  | { kind: 'end'; reason: 'budget' | 'empty' }
  | { kind: 'replay'; action: LearningAction; replayOfAttemptId: string }
  | { kind: 'item'; item: DailyQueueItem }

/** 03 §6.5 adım 0: cevap kaydında UI'ya verilir; hedef SABİTTİR (kayan "son Attempt" yok, U-UN-08). */
export interface UndoToken {
  targetAttemptId: string
  action: LearningAction
  /** monoton saatle ölçülür (cihaz saati oynatılsa da pencere değişmez) */
  expiresAtMono: number
  consumed: boolean
}

export interface PendingReplay {
  action: LearningAction
  replayOfAttemptId: string
}

/** 03 §6.5: geri al yalnız kayıttan sonraki 30 saniye içinde. */
export const UNDO_WINDOW_MS = 30_000

export class Session {
  readonly sessionId: string
  readonly startedAtMono: number
  readonly budgetMs: number | null
  /** kaydedilen Attempt sayısı; void edilince düşmez (gösterim amaçlı) */
  answered = 0
  /** geçici (transient) — persist edilmez (U-UN-05) */
  pendingReplay: PendingReplay | null = null
  private activeAccumMs = 0
  private activeSinceMono: number | null

  constructor(
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    budgetMs: number | null,
  ) {
    if (budgetMs !== null && (!Number.isFinite(budgetMs) || budgetMs <= 0)) throw new Error('budgetMs pozitif olmalı')
    this.sessionId = ids.newId()
    this.startedAtMono = clock.monotonicMs()
    this.budgetMs = budgetMs
    this.activeSinceMono = this.startedAtMono
  }

  /** uygulama gizlendi → sayaç durur (06 §11 Clock) */
  pause(): void {
    if (this.activeSinceMono === null) return
    this.activeAccumMs += this.clock.monotonicMs() - this.activeSinceMono
    this.activeSinceMono = null
  }

  /** öne geldi → devam */
  resume(): void {
    if (this.activeSinceMono !== null) return
    this.activeSinceMono = this.clock.monotonicMs()
  }

  activeMs(): number {
    return this.activeAccumMs + (this.activeSinceMono === null ? 0 : this.clock.monotonicMs() - this.activeSinceMono)
  }

  budgetExhausted(): boolean {
    return this.budgetMs !== null && this.activeMs() >= this.budgetMs
  }

  /**
   * 03 §6.2 — bütçe kontrolü öğe BAŞINDA; düzeltme tekrarı varsa selectNext atlanır ve tekrar bir kez sunulur (§6.5 adım 3);
   * yoksa güncel MemoryState + now ile selectNext.
   */
  nextItem(ctx: QueueContext): NextItem {
    if (this.budgetExhausted()) return { kind: 'end', reason: 'budget' }
    if (this.pendingReplay) {
      const r = this.pendingReplay
      this.pendingReplay = null
      return { kind: 'replay', action: r.action, replayOfAttemptId: r.replayOfAttemptId }
    }
    const item = selectNext(ctx)
    return item ? { kind: 'item', item } : { kind: 'end', reason: 'empty' }
  }

  /**
   * Cevap diske yazıldıktan sonra çağrılır. Tekrar sunumdan doğan Attempt'a (replayOfAttemptId) token verilmez (BL-04):
   * aynı mantıksal action için "bir kez" tüketilmiştir.
   */
  recordAttempt(attempt: Attempt, action: LearningAction): UndoToken | null {
    this.answered++
    if (attempt.replayOfAttemptId) return null
    return { targetAttemptId: attempt.id, action, expiresAtMono: this.clock.monotonicMs() + UNDO_WINDOW_MS, consumed: false }
  }

  /** undo sonucu: aynı LearningAction yeni actionId ile bir kez yeniden sunulur (BL-04); selectNext atlanır; due yazılmaz. */
  scheduleReplay(action: LearningAction, replayOfAttemptId: string): void {
    this.pendingReplay = { action: { ...action, actionId: this.ids.newId() }, replayOfAttemptId }
  }
}
