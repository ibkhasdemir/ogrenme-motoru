// 01 §4.6 (K01) — Cevap anahtarı hatası düzeltmesi: yeni revision geçmiş ölçümü onarmaz (REBUILD snapshot'tan okur, A6/A9).
// Kullanıcı "Eski cevap anahtarı hatalı mıydı? → Evet" derse etkilenen Attempt'lar önizlenir ve her biri için
// AttemptVoid { reason: "content_error" } yazılır. Ham `correct` sessizce değiştirilmez; yeni Good ÜRETİLMEZ.
import type { Attempt, AttemptVoid, QuestionAttempt } from '../../domain'

export interface ContentErrorRequest {
  attemptIds: string[]
  note: string
}

/**
 * Etkilenen denemeler: bu sorunun (yeni revision'dan) ÖNCEKİ sürümlerine verilmiş ve doğruluğu yeni anahtara göre farklı
 * çıkan, void edilmemiş QuestionAttempt'lar. Yeni anahtar bir seçenek id'sidir; anlamı korunan seçenekler id'sini koruduğu için
 * eski sürümde karşılaştırma anlamlıdır (01 §2.5 seçenek kimliği kuralı).
 */
export function affectedAttemptsByKeyChange(
  attempts: readonly Attempt[],
  voids: readonly AttemptVoid[],
  questionId: string,
  beforeVersion: number,
  newCorrectOptionId: string,
): QuestionAttempt[] {
  const voided = new Set(voids.map((v) => v.targetAttemptId))
  return attempts.filter((a): a is QuestionAttempt => {
    if (a.kind !== 'question' || a.questionId !== questionId || a.questionVersion > beforeVersion) return false
    if (voided.has(a.id)) return false
    const correctUnderNewKey = a.selectedOptionId === newCorrectOptionId
    return a.correct !== correctUnderNewKey
  })
}
