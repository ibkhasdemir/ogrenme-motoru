import { describe, expect, it } from 'vitest'
import type { Atom, Attempt, AttemptVoid, Confidence, LearningAction, QuestionAttempt, RecallAttempt, SelfAssessment } from '../src/domain'
import { EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1 } from '../src/domain'
import { buildQuestionAttempt } from '../src/engine/attempts/build'
import { canonicalJson } from '../src/engine/backup/canonical'
import { applyAttempt, rebuild, serializeMemory, type Memory } from '../src/engine/rebuild/rebuild'
import { createScheduler } from '../src/engine/scheduler/adapter'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { testIds } from './helpers/legacyDb'

// Phase 6 — REBUILD (02 §5): U-RB-01…12, I-04 (Phase 3'ten), I-14/I-17/U-QR-12 REBUILD cümleleri (ilgili dosyalarda).

const P = EVIDENCE_POLICY_V1
const C = SCHEDULER_CONFIG_V1
const T0 = Date.parse('2026-09-08T10:00:00.000Z')
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()
const MIN = 60_000
const DAY = 86_400_000

const qa = (id: string, seq: number, ts: string, atomId: string, correct: boolean, confidence: Confidence, mode: QuestionAttempt['mode'] = 'review'): QuestionAttempt => ({
  id, kind: 'question', sequence: seq, timestamp: ts, sessionId: 's', primaryAtomIdAtAttempt: atomId, mode, confidence,
  operation: 'discriminate', support: 'choices', responseTimeMs: 100, wrongReason: correct ? null : 'unknown',
  questionId: 'q-1', questionVersion: 1, initialSelectedOptionId: 'o-1', selectedOptionId: correct ? 'o-1' : 'o-2', changedAnswer: false, correct,
})
const ra = (id: string, seq: number, ts: string, atomId: string, selfAssessment: SelfAssessment, mode: RecallAttempt['mode'] = 'review'): RecallAttempt => ({
  id, kind: 'recall', sequence: seq, timestamp: ts, sessionId: 's', primaryAtomIdAtAttempt: atomId, atomId, mode, confidence: null,
  operation: 'recall', support: 'none', responseTimeMs: 100, selfAssessment,
})
const vd = (id: string, seq: number, target: string): AttemptVoid => ({ id, targetAttemptId: target, sequence: seq, timestamp: iso(seq * MIN), reason: 'undo' })

function sixAttempts(): Attempt[] {
  return [
    qa('a1', 1, iso(0), 'atm-1', true, 'sure', 'new'),
    ra('a2', 2, iso(2 * MIN), 'atm-2', 'again', 'new'),
    qa('a3', 3, iso(20 * MIN), 'atm-1', false, 'sure'),
    ra('a4', 4, iso(1 * DAY), 'atm-2', 'good'),
    qa('a5', 5, iso(2 * DAY), 'atm-1', true, 'unsure'),
    qa('a6', 6, iso(3 * DAY + 5 * MIN), 'atm-3', true, 'guess', 'new'),
  ]
}

describe('REBUILD', () => {
  it('U-RB-01 — determinizm: aynı girdiyle iki REBUILD serializeMemory eşit (T5)', () => {
    const a = rebuild(sixAttempts(), [], P, C)
    const b = rebuild(sixAttempts(), [], P, C)
    expect(serializeMemory(b.memory)).toBe(serializeMemory(a.memory))
    expect(a.memory.size).toBe(3)
    expect(a.reviewEvents).toHaveLength(6)
    expect(serializeMemory(a.memory)).toMatch(/^\[\{"atomId":"atm-1"/)
  })

  it('U-RB-02 — anlık yol = REBUILD: applyAttempt sırayla → rebuild ile eşit (T5)', () => {
    const scheduler = createScheduler(C)
    const memory: Memory = new Map()
    const events = sixAttempts().map((a) => applyAttempt(memory, a, P, scheduler)).filter((e) => e !== null)
    const r = rebuild(sixAttempts(), [], P, C)
    expect(serializeMemory(memory)).toBe(serializeMemory(r.memory))
    expect(canonicalJson(events)).toBe(canonicalJson(r.reviewEvents))
  })

  it('U-RB-03 — sequence sırası, timestamp değil: aynı timestamp\'li 2 attempt ters verilir → sonuç aynı; rating sırası [1,3] (T13)', () => {
    const t = iso(0)
    const first = qa('a1', 1, t, 'atm-1', false, 'sure', 'new') // Again
    const second = qa('a2', 2, t, 'atm-1', true, 'sure') // Good
    const inOrder = rebuild([first, second], [], P, C)
    const reversed = rebuild([second, first], [], P, C)
    expect(serializeMemory(reversed.memory)).toBe(serializeMemory(inOrder.memory))
    expect(reversed.reviewEvents.map((e) => e.rating)).toEqual([1, 3])
    expect(reversed.reviewEvents.map((e) => e.attemptId)).toEqual(['a1', 'a2'])
  })

  it('U-RB-04 — void filtresi: 1 attempt + void → memory boş, reviewEvents boş (T12)', () => {
    const r = rebuild([qa('a1', 1, iso(0), 'atm-1', true, 'sure', 'new')], [vd('v1', 2, 'a1')], P, C)
    expect(r.memory.size).toBe(0)
    expect(r.reviewEvents).toEqual([])
  })

  it('U-RB-05 — çift void: aynı hedefe 2 void → tek kez etkili; diğer attempt etkilenmez', () => {
    const atts = [qa('a1', 1, iso(0), 'atm-1', true, 'sure', 'new'), qa('a2', 2, iso(MIN), 'atm-2', true, 'sure', 'new')]
    const r = rebuild(atts, [vd('v1', 3, 'a1'), vd('v2', 4, 'a1')], P, C)
    expect([...r.memory.keys()]).toEqual(['atm-2'])
    expect(r.reviewEvents.map((e) => e.attemptId)).toEqual(['a2'])
  })

  it('U-RB-06 — pretest atlanır: reviewEvents boş, memory boş (T7)', () => {
    const r = rebuild([qa('a1', 1, iso(0), 'atm-1', true, 'sure', 'pretest'), ra('a2', 2, iso(MIN), 'atm-1', 'good', 'pretest')], [], P, C)
    expect(r.memory.size).toBe(0)
    expect(r.reviewEvents).toEqual([])
  })

  it('U-RB-07 — snapshot atomu: primaryAtomIdAtAttempt = A iken güncel soru B\'ye taşınmış olsa da memory[A] var, memory[B] yok (T4)', () => {
    const r = rebuild([qa('a1', 1, iso(0), 'atm-A', true, 'sure', 'new')], [], P, C)
    expect(r.memory.has('atm-A')).toBe(true)
    expect(r.memory.has('atm-B')).toBe(false)
    expect(r.reviewEvents[0]!.atomId).toBe('atm-A')
  })

  it('U-RB-08 — içerik tablosuz çalışır: yalnız attempts + voids + policy + config', () => {
    expect(rebuild.length).toBeLessThanOrEqual(5)
    const r = rebuild(sixAttempts(), [], P, C)
    expect(r.memory.size).toBe(3)
  })

  it('U-RB-09 — monoton kırpma: timestamp geriye giden 2. attempt → reviewedAt = 1. attempt\'ın lastReview\'u; hata yok', () => {
    const first = qa('a1', 1, iso(10 * MIN), 'atm-1', true, 'sure', 'new')
    const second = qa('a2', 2, iso(0), 'atm-1', true, 'sure') // cihaz saati geri alınmış
    const r = rebuild([first, second], [], P, C)
    expect(r.reviewEvents[1]!.reviewedAt).toBe(iso(10 * MIN))
    expect(r.reviewEvents[0]!.reviewedAt).toBe(iso(10 * MIN))
    expect(second.timestamp).toBe(iso(0)) // Attempt.timestamp değişmez
    expect(r.memory.get('atm-1')!.lastReview).toBe(iso(10 * MIN))
  })

  it('U-RB-10 — policy değişimi: v1 vs (test enjeksiyonu) sahte v2 → memory farklı; attempts JSON değişmemiş (T6, BL-22)', () => {
    const atts = sixAttempts()
    const before = canonicalJson(atts)
    const v1 = rebuild(atts, [], P, C)
    const fakeV2 = rebuild(atts, [], { policyVersion: 2 }, C, { ratingFor: (a, pol) => (pol.policyVersion === 2 ? (a.mode === 'pretest' ? null : 3) : null) })
    expect(serializeMemory(fakeV2.memory)).not.toBe(serializeMemory(v1.memory))
    expect(canonicalJson(atts)).toBe(before)
    expect(() => rebuild(atts, [], { policyVersion: 2 }, C)).toThrow() // üretim ratingFor v2 bilmez (U-EP-09)
  })

  it('U-RB-11 — config değişimi: requestRetention 0.9 vs 0.8 → memory farklı; attempts değişmemiş (T6)', () => {
    const atts = [qa('a1', 1, iso(0), 'atm-1', true, 'sure', 'new'), qa('a2', 2, iso(10 * MIN), 'atm-1', true, 'sure'), qa('a3', 3, iso(3 * DAY), 'atm-1', true, 'sure')]
    const before = canonicalJson(atts)
    const a = rebuild(atts, [], P, C)
    const b = rebuild(atts, [], P, { ...C, configVersion: 2, requestRetention: 0.8 })
    expect(serializeMemory(b.memory)).not.toBe(serializeMemory(a.memory))
    expect(canonicalJson(atts)).toBe(before)
  })

  it('U-RB-12 — lastAttemptKind: son attempt recall → recall; soru → question + lastQuestionId', () => {
    const r = rebuild([qa('a1', 1, iso(0), 'atm-1', true, 'sure', 'new'), ra('a2', 2, iso(MIN), 'atm-1', 'good')], [], P, C)
    expect(r.memory.get('atm-1')!.lastAttemptKind).toBe('recall')
    expect(r.memory.get('atm-1')!.lastQuestionId).toBe('q-1') // recall soruyu değiştirmez
    const q = rebuild([ra('a1', 1, iso(0), 'atm-1', 'good', 'new'), qa('a2', 2, iso(MIN), 'atm-1', true, 'sure')], [], P, C)
    expect(q.memory.get('atm-1')!).toMatchObject({ lastAttemptKind: 'question', lastQuestionId: 'q-1' })
  })

  it('I-04 — mode (A11): ilk attempt new, ikinci review (hafıza applyAttempt ile oluştu); pretest pretest', async () => {
    const repo = new MemoryRepository(testIds())
    const NOW = iso(0)
    const atom: Atom = { id: 'atm-a', topicId: 'top-1', text: 'A', prompt: 'A?', facets: ['fact'], sortOrder: 1, archived: false, createdAt: NOW }
    await repo.putSubject({ id: 'sub-1', name: 'S', sortOrder: 1 }); await repo.putTopic({ id: 'top-1', subjectId: 'sub-1', name: 'T', sortOrder: 1 }); await repo.putAtom(atom)
    await repo.createQuestion({ id: 'q-1', primaryAtomId: 'atm-a', source: 'kendi', text: 'A?', createdAt: NOW, options: [{ id: 'o-1', text: '1' }, { id: 'o-2', text: '2' }], correctOptionId: 'o-1' })
    const rev = (await repo.getRevision('q-1', 1))!
    const scheduler = createScheduler(C)
    const memory: Memory = new Map()
    const answer = (actionId: string, ts: string, pretest = false) => {
      const action: LearningAction = { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId }
      return buildQuestionAttempt({ action: action as never, revision: rev, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'sure', responseTimeMs: 100 }, { sessionId: 's', timestamp: ts, memoryHasAtom: memory.has('atm-a'), pretest })
    }
    const a1 = await repo.appendAttempt(answer('act-1', iso(0)))
    expect(a1.mode).toBe('new')
    applyAttempt(memory, a1, P, scheduler) // önce disk, sonra bellek (06 §5)
    const a2 = await repo.appendAttempt(answer('act-2', iso(11 * MIN)))
    expect(a2.mode).toBe('review')
    applyAttempt(memory, a2, P, scheduler)
    const a3 = await repo.appendAttempt(answer('act-3', iso(12 * MIN), true))
    expect(a3.mode).toBe('pretest')
    expect(applyAttempt(memory, a3, P, scheduler)).toBeNull()
    // anlık yol = REBUILD (depodaki olaylardan)
    const r = rebuild(await repo.listAttempts(), await repo.listVoids(), P, C)
    expect(serializeMemory(r.memory)).toBe(serializeMemory(memory))
  })
})
