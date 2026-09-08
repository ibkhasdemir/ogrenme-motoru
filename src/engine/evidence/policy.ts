// 02 §1 — EvidencePolicy: ratingFor(attempt, policy) → Rating | null. Saf fonksiyon; yalnız Attempt alanlarına bakar
// (içerik tablolarına bakmaz — A6/A9 snapshot). null = hafıza durumunu değiştirmez (ReviewEvent yok).
import type { Attempt, AttemptInput, EvidencePolicy, Rating } from '../../domain'

export class UnknownPolicyVersionError extends Error {
  constructor(version: number) {
    super(`Bilinmeyen policyVersion: ${version}`)
    this.name = 'UnknownPolicyVersionError'
  }
}

export type RatingFor = (attempt: Attempt | AttemptInput, policy: EvidencePolicy) => Rating | null

/**
 * policyVersion 1 eşleme tablosu (02 §1.2):
 * - pretest → null (A5)
 * - question yanlış → 1 (her güvende; güven analiz için saklanır, A8)
 * - question doğru: guess → 1 (A7: sallayarak doğru = başarısız hatırlama), unsure → 2, sure → 3
 * - recall: again → 1, hard → 2, good → 3
 * Easy (4) hiçbir yoldan üretilmez. wrongReason ve support notu etkilemez.
 */
export const ratingFor: RatingFor = (attempt, policy) => {
  if (policy.policyVersion !== 1) throw new UnknownPolicyVersionError(policy.policyVersion) // sessizce varsayılana düşülmez
  if (attempt.mode === 'pretest') return null
  if (attempt.kind === 'question') {
    if (!attempt.correct) return 1
    switch (attempt.confidence) {
      case 'guess':
        return 1 // 02 §1.2: doğru + guess = Again (A7) — atom yetim kalmaz
      case 'unsure':
        return 2
      case 'sure':
        return 3
    }
  }
  switch (attempt.selfAssessment) {
    case 'again':
      return 1
    case 'hard':
      return 2
    case 'good':
      return 3
  }
}
