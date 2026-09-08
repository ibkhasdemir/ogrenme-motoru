// 01 §4 — Attempt kurulumu (saf). Semantik kaynak REVISION'dır (01 §4.2a): sürüm sunum anında sabitlenir
// (action.questionVersion), doğruluk ve ana atom o revision'dan okunur; baş kayda bakılmaz (BL-14).
import type {
  Confidence, LearningAction, QuestionAttemptInput, QuestionRevision, RecallAttemptInput, SelfAssessment, WrongReason,
} from '../../domain'
import { isCompleteRevision } from '../../domain'

export class AttemptBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttemptBuildError'
  }
}

/** 01 §4.1: Attempt id sunum anındaki actionId'den türetilir (aynı sunuma ikinci kayıt aynı id → depo reddeder, I-20). */
export function attemptIdFromAction(actionId: string): string {
  return actionId
}

export interface CommonAttemptContext {
  sessionId: string
  /** olay zamanı (Clock.now()) */
  timestamp: string
  /** atomun hafıza durumu var mı → mode: review / new (01 §4.1, A11) */
  memoryHasAtom: boolean
  /** kullanıcı/akış açıkça pretest dedi (A5) */
  pretest?: boolean
  /** geri al sonrası tekrar sunumdan doğan Attempt (03 §6.5) */
  replayOfAttemptId?: string
}

export interface QuestionAnswer {
  action: Extract<LearningAction, { kind: 'question' }>
  /** QuestionRevision(action.questionId, action.questionVersion) */
  revision: QuestionRevision
  initialSelectedOptionId: string
  selectedOptionId: string
  confidence: Confidence
  /** yalnız yanlış cevapta zorunlu (07 S6: üç seçenek + geç) */
  wrongReason?: WrongReason
  /** sunumdan güven dokunuşuna kadar (01 §4.1) */
  responseTimeMs: number
}

export function buildQuestionAttempt(answer: QuestionAnswer, ctx: CommonAttemptContext): QuestionAttemptInput {
  const { action, revision } = answer
  if (revision.questionId !== action.questionId || revision.version !== action.questionVersion) {
    throw new AttemptBuildError('Revision, sunulan action ile eşleşmiyor')
  }
  // 01 §4.2a adım 3: content_unavailable_legacy sunulamaz; Attempt yazılmaz (I-QA-08)
  if (!isCompleteRevision(revision)) throw new AttemptBuildError('Bu sürümün içeriği mevcut değil; soru sunulamaz')
  const optionIds = new Set(revision.options.map((o) => o.id))
  if (!optionIds.has(answer.selectedOptionId) || !optionIds.has(answer.initialSelectedOptionId)) {
    throw new AttemptBuildError('Seçenek bu sürümde yok')
  }
  const correct = answer.selectedOptionId === revision.correctOptionId
  if (!correct && !answer.wrongReason) throw new AttemptBuildError('Yanlış cevapta neden zorunlu (07 S6)')
  if (!Number.isInteger(answer.responseTimeMs) || answer.responseTimeMs < 0) throw new AttemptBuildError('responseTimeMs negatif olmayan tamsayı olmalı')
  return {
    id: attemptIdFromAction(action.actionId),
    kind: 'question',
    ...(ctx.replayOfAttemptId ? { replayOfAttemptId: ctx.replayOfAttemptId } : {}),
    timestamp: ctx.timestamp,
    sessionId: ctx.sessionId,
    primaryAtomIdAtAttempt: revision.primaryAtomId, // snapshot (A6) — revision'dan
    mode: ctx.pretest ? 'pretest' : ctx.memoryHasAtom ? 'review' : 'new',
    confidence: answer.confidence,
    operation: 'discriminate', // 01 §4.1: soru → discriminate (A13, otomatik)
    support: 'choices', // 01 §4.1: soru → choices
    responseTimeMs: answer.responseTimeMs,
    wrongReason: correct ? null : answer.wrongReason!,
    questionId: action.questionId,
    questionVersion: action.questionVersion,
    initialSelectedOptionId: answer.initialSelectedOptionId,
    selectedOptionId: answer.selectedOptionId,
    changedAnswer: answer.initialSelectedOptionId !== answer.selectedOptionId,
    correct,
  }
}

export interface RecallAnswer {
  action: Extract<LearningAction, { kind: 'recall' }>
  selfAssessment: SelfAssessment
  /** "Çengeli göster" basıldı → support = hook (01 §4.1) */
  hookShown: boolean
  /** sunumdan "Cevabı aç" dokunuşuna kadar (03 §4.4) */
  responseTimeMs: number
}

export function buildRecallAttempt(answer: RecallAnswer, ctx: CommonAttemptContext): RecallAttemptInput {
  const { action } = answer
  if (!Number.isInteger(answer.responseTimeMs) || answer.responseTimeMs < 0) throw new AttemptBuildError('responseTimeMs negatif olmayan tamsayı olmalı')
  return {
    id: attemptIdFromAction(action.actionId),
    kind: 'recall',
    ...(ctx.replayOfAttemptId ? { replayOfAttemptId: ctx.replayOfAttemptId } : {}),
    timestamp: ctx.timestamp,
    sessionId: ctx.sessionId,
    primaryAtomIdAtAttempt: action.atomId,
    atomId: action.atomId,
    mode: ctx.pretest ? 'pretest' : ctx.memoryHasAtom ? 'review' : 'new',
    confidence: null, // 01 §4.3: öz değerlendirme zaten güven yargısıdır
    operation: 'recall',
    support: answer.hookShown ? 'hook' : 'none',
    responseTimeMs: answer.responseTimeMs,
    selfAssessment: answer.selfAssessment,
  }
}
