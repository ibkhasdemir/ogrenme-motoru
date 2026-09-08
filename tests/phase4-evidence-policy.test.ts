import { describe, expect, it } from 'vitest'
import type { AttemptMode, Confidence, QuestionAttemptInput, RecallAttemptInput, SelfAssessment, WrongReason } from '../src/domain'
import { ATTEMPT_MODES, CONFIDENCES, EVIDENCE_POLICY_V1, SELF_ASSESSMENTS, WRONG_REASONS } from '../src/domain'
import { UnknownPolicyVersionError, ratingFor } from '../src/engine/evidence/policy'

// Phase 4 — EvidencePolicy (02 §1.2): U-EP-01…10, I-12.

const NOW = '2026-09-08T10:00:00.000Z'
const q = (over: Partial<QuestionAttemptInput>): QuestionAttemptInput => ({
  id: 'a', kind: 'question', timestamp: NOW, sessionId: 's', primaryAtomIdAtAttempt: 'atm-1', mode: 'review', confidence: 'sure',
  operation: 'discriminate', support: 'choices', responseTimeMs: 100, wrongReason: null, questionId: 'q-1', questionVersion: 1,
  initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', changedAnswer: false, correct: true, ...over,
})
const r = (over: Partial<RecallAttemptInput>): RecallAttemptInput => ({
  id: 'b', kind: 'recall', timestamp: NOW, sessionId: 's', primaryAtomIdAtAttempt: 'atm-1', atomId: 'atm-1', mode: 'review', confidence: null,
  operation: 'recall', support: 'none', responseTimeMs: 100, selfAssessment: 'good', ...over,
})
const P = EVIDENCE_POLICY_V1
const NON_PRETEST: AttemptMode[] = ['new', 'review', 'external']

describe('EvidencePolicy v1', () => {
  it('U-EP-01 — yanlış + emin → 1', () => expect(ratingFor(q({ correct: false, confidence: 'sure', wrongReason: 'confused' }), P)).toBe(1))
  it('U-EP-02 — yanlış + salladım → 1', () => expect(ratingFor(q({ correct: false, confidence: 'guess', wrongReason: 'unknown' }), P)).toBe(1))
  it('U-EP-03 — doğru + salladım → 1 (T3 çekirdeği, A7)', () => expect(ratingFor(q({ correct: true, confidence: 'guess' }), P)).toBe(1))
  it('U-EP-04 — doğru + tereddüt → 2', () => expect(ratingFor(q({ correct: true, confidence: 'unsure' }), P)).toBe(2))
  it('U-EP-05 — doğru + emin → 3', () => expect(ratingFor(q({ correct: true, confidence: 'sure' }), P)).toBe(3))
  it('U-EP-06 — recall again/hard/good → 1/2/3', () => {
    expect(ratingFor(r({ selfAssessment: 'again' }), P)).toBe(1)
    expect(ratingFor(r({ selfAssessment: 'hard' }), P)).toBe(2)
    expect(ratingFor(r({ selfAssessment: 'good' }), P)).toBe(3)
  })
  it('U-EP-07 — pretest her kombinasyonda null (T7, A5)', () => {
    for (const c of CONFIDENCES) for (const correct of [true, false]) {
      expect(ratingFor(q({ mode: 'pretest', confidence: c, correct, wrongReason: correct ? null : 'skipped' }), P)).toBeNull()
    }
    for (const s of SELF_ASSESSMENTS) expect(ratingFor(r({ mode: 'pretest', selfAssessment: s }), P)).toBeNull()
  })
  it('U-EP-08 — Easy (4) asla üretilmez; new/review/external aynı tabloyu kullanır', () => {
    const seen = new Set<number | null>()
    for (const mode of ATTEMPT_MODES) {
      for (const c of CONFIDENCES) for (const correct of [true, false]) {
        const v = ratingFor(q({ mode, confidence: c, correct, wrongReason: correct ? null : 'attention' }), P)
        seen.add(v); expect(v).not.toBe(4)
      }
      for (const s of SELF_ASSESSMENTS) { const v = ratingFor(r({ mode, selfAssessment: s }), P); seen.add(v); expect(v).not.toBe(4) }
    }
    expect([...seen].sort()).toEqual([1, 2, 3, null])
    for (const mode of NON_PRETEST) {
      expect(ratingFor(q({ mode, correct: true, confidence: 'sure' }), P)).toBe(3)
      expect(ratingFor(r({ mode, selfAssessment: 'again' }), P)).toBe(1)
    }
  })
  it('U-EP-09 — bilinmeyen policyVersion → hata fırlatır', () => {
    expect(() => ratingFor(q({}), { policyVersion: 99 })).toThrow(UnknownPolicyVersionError)
    expect(() => ratingFor(q({}), { policyVersion: 2 })).toThrow(UnknownPolicyVersionError) // BL-22: üretim kodunda v2 yok
  })
  it('U-EP-10 — wrongReason notu etkilemez: yanlış her nedende 1', () => {
    for (const w of WRONG_REASONS) for (const c of CONFIDENCES) {
      expect(ratingFor(q({ correct: false, confidence: c as Confidence, wrongReason: w as WrongReason }), P)).toBe(1)
    }
  })
  it('support notu etkilemez (02 §1.2): hook ile good = 3, none ile good = 3', () => {
    for (const s of SELF_ASSESSMENTS as readonly SelfAssessment[]) {
      expect(ratingFor(r({ support: 'hook', selfAssessment: s }), P)).toBe(ratingFor(r({ support: 'none', selfAssessment: s }), P))
    }
  })
  it('I-12 — recall attempt: selfAssessment hard → rating 2; confidence null', () => {
    const a = r({ selfAssessment: 'hard' })
    expect(a.confidence).toBeNull()
    expect(ratingFor(a, P)).toBe(2)
  })
})
