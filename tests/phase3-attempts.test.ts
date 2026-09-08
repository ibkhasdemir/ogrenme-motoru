import { beforeEach, describe, expect, it } from 'vitest'
import type { Atom, LearningAction, Subject, Topic } from '../src/domain'
import { AttemptBuildError, buildQuestionAttempt, buildRecallAttempt } from '../src/engine/attempts/build'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { DuplicateAttemptError } from '../src/store/repository'
import { testIds } from './helpers/legacyDb'

// Phase 3 — Attempt olay sistemi (01 §4): I-09, I-10, I-11, I-13, I-20, I-QA-08. (I-04 → Phase 6, I-12 → Phase 4, I-22 → Phase 8b.)

const NOW = '2026-09-08T10:00:00.000Z'
const ctx = { sessionId: 'ses-1', timestamp: NOW, memoryHasAtom: false }
const qAction: LearningAction = { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId: 'act-1' }
const rAction: LearningAction = { kind: 'recall', atomId: 'atm-b', actionId: 'act-2' }

let repo: MemoryRepository
beforeEach(async () => {
  repo = new MemoryRepository(testIds())
  const subject: Subject = { id: 'sub-1', name: 'Tarih', sortOrder: 1 }
  const topic: Topic = { id: 'top-1', subjectId: 'sub-1', name: 'Osmanlı', sortOrder: 1 }
  const atom = (id: string, n: number): Atom => ({ id, topicId: 'top-1', text: `${id} metni`, prompt: `${id}?`, facets: ['date'], sortOrder: n, archived: false, createdAt: NOW })
  await repo.putSubject(subject); await repo.putTopic(topic); await repo.putAtom(atom('atm-a', 1)); await repo.putAtom(atom('atm-b', 2))
  await repo.createQuestion({
    id: 'q-1', primaryAtomId: 'atm-a', source: 'kendi', text: 'Tanzimat hangi yıl?', createdAt: NOW,
    options: [{ id: 'o-1', text: '1839' }, { id: 'o-2', text: '1856' }, { id: 'o-3', text: '1876' }], correctOptionId: 'o-1',
  })
})

describe('Phase 3 — Attempt kurulumu', () => {
  it('I-11 — operation/support otomatik: soru → discriminate/choices; kart çengelli → recall/hook; çengelsiz → recall/none', async () => {
    const rev = (await repo.getRevision('q-1', 1))!
    const q = buildQuestionAttempt({ action: qAction as never, revision: rev, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'sure', responseTimeMs: 4000 }, ctx)
    expect(q).toMatchObject({ operation: 'discriminate', support: 'choices' })
    const withHook = buildRecallAttempt({ action: rAction as never, selfAssessment: 'good', hookShown: true, responseTimeMs: 3000 }, ctx)
    const noHook = buildRecallAttempt({ action: rAction as never, selfAssessment: 'good', hookShown: false, responseTimeMs: 3000 }, ctx)
    expect(withHook).toMatchObject({ operation: 'recall', support: 'hook', confidence: null, atomId: 'atm-b', primaryAtomIdAtAttempt: 'atm-b' })
    expect(noHook).toMatchObject({ operation: 'recall', support: 'none', confidence: null })
  })

  it('I-13 — initial ≠ selected → changedAnswer true; eşitse false; id actionId\'den türetilir', async () => {
    const rev = (await repo.getRevision('q-1', 1))!
    const changed = buildQuestionAttempt({ action: qAction as never, revision: rev, initialSelectedOptionId: 'o-2', selectedOptionId: 'o-1', confidence: 'unsure', responseTimeMs: 8400 }, ctx)
    expect(changed.changedAnswer).toBe(true)
    expect(changed.id).toBe('act-1')
    const same = buildQuestionAttempt({ action: qAction as never, revision: rev, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'sure', responseTimeMs: 100 }, ctx)
    expect(same.changedAnswer).toBe(false)
  })

  it('mode: hafıza durumu yok → new; var → review; pretest bayrağı → pretest (01 §4.1)', async () => {
    const rev = (await repo.getRevision('q-1', 1))!
    const base = { action: qAction as never, revision: rev, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'sure' as const, responseTimeMs: 100 }
    expect(buildQuestionAttempt(base, ctx).mode).toBe('new')
    expect(buildQuestionAttempt(base, { ...ctx, memoryHasAtom: true }).mode).toBe('review')
    expect(buildQuestionAttempt(base, { ...ctx, memoryHasAtom: true, pretest: true }).mode).toBe('pretest')
  })

  it('yanlış cevapta neden zorunlu; doğru cevapta wrongReason null', async () => {
    const rev = (await repo.getRevision('q-1', 1))!
    expect(() => buildQuestionAttempt({ action: qAction as never, revision: rev, initialSelectedOptionId: 'o-2', selectedOptionId: 'o-2', confidence: 'sure', responseTimeMs: 100 }, ctx)).toThrow(AttemptBuildError)
    const wrong = buildQuestionAttempt({ action: qAction as never, revision: rev, initialSelectedOptionId: 'o-2', selectedOptionId: 'o-2', confidence: 'sure', wrongReason: 'confused', responseTimeMs: 100 }, ctx)
    expect(wrong).toMatchObject({ correct: false, wrongReason: 'confused' })
    const right = buildQuestionAttempt({ action: qAction as never, revision: rev, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'guess', wrongReason: 'confused', responseTimeMs: 100 }, ctx)
    expect(right).toMatchObject({ correct: true, wrongReason: null })
  })

  it('I-09 / U-RS-08 çekirdeği — questionVersion = SUNULAN sürüm; kayıt anında currentVersion farklı olsa bile v1\'e göre değerlendirilir', async () => {
    // v1 sunuldu (action.questionVersion = 1); sunum sırasında soru v2 oldu, doğru seçenek değişti
    await repo.reviseQuestion('q-1', { correctOptionId: 'o-2' }, '2026-09-08T10:01:00.000Z')
    expect((await repo.getQuestion('q-1'))!.currentVersion).toBe(2)
    const presented = (await repo.getRevision('q-1', qAction.kind === 'question' ? qAction.questionVersion : 0))!
    const att = buildQuestionAttempt({ action: qAction as never, revision: presented, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'sure', responseTimeMs: 100 }, ctx)
    expect(att.questionVersion).toBe(1)
    expect(att.correct).toBe(true) // v1 anahtarına göre doğru; v2'de yanlış olurdu
    expect(att.primaryAtomIdAtAttempt).toBe('atm-a')
    const stored = await repo.appendAttempt(att)
    expect(stored.kind === 'question' && stored.questionVersion).toBe(1)
  })

  it('I-10 — correct dondurulmuş: attempt sonrası doğru seçenek değişir (yeni revision) → eski attempt.correct değişmez', async () => {
    const rev = (await repo.getRevision('q-1', 1))!
    const att = await repo.appendAttempt(buildQuestionAttempt({ action: qAction as never, revision: rev, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'sure', responseTimeMs: 100 }, ctx))
    await repo.reviseQuestion('q-1', { correctOptionId: 'o-3' }, '2026-09-08T10:01:00.000Z')
    const after = (await repo.listAttempts()).find((a) => a.id === att.id)!
    expect(after.kind === 'question' && after.correct).toBe(true)
    expect(after.kind === 'question' && after.questionVersion).toBe(1)
  })

  it('I-20 — çift dokunma tek Attempt: aynı actionId ile ikinci kayıt reddedilir, sequence tüketilmez', async () => {
    const rev = (await repo.getRevision('q-1', 1))!
    const build = () => buildQuestionAttempt({ action: qAction as never, revision: rev, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'sure', responseTimeMs: 100 }, ctx)
    await repo.appendAttempt(build())
    await expect(repo.appendAttempt(build())).rejects.toBeInstanceOf(DuplicateAttemptError)
    expect(await repo.listAttempts()).toHaveLength(1)
    expect(await repo.nextSequence()).toBe(2)
  })

  it('I-QA-08 — QuestionAttempt revision\'dan kurulur; content_unavailable_legacy güncel sürümse sunum reddedilir, Attempt yazılmaz', async () => {
    const rev = (await repo.getRevision('q-1', 1))!
    const att = buildQuestionAttempt({ action: qAction as never, revision: rev, initialSelectedOptionId: 'o-2', selectedOptionId: 'o-1', confidence: 'sure', responseTimeMs: 100 }, ctx)
    expect(att.primaryAtomIdAtAttempt).toBe(rev.primaryAtomId)
    expect(att.correct).toBe(true)
    const legacy = { questionId: 'q-1', version: 1, integrityStatus: 'content_unavailable_legacy' as const, text: null, options: null, correctOptionId: null, primaryAtomId: 'atm-a', createdAt: null, legacyProvenance: { migratedAt: NOW, fromSchemaVersion: 1, createdAtSource: 'unknown' as const } }
    expect(() => buildQuestionAttempt({ action: qAction as never, revision: legacy, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'sure', responseTimeMs: 100 }, ctx)).toThrow(AttemptBuildError)
    expect(await repo.listAttempts()).toHaveLength(0)
    // revision ile action uyuşmazlığı da reddedilir
    expect(() => buildQuestionAttempt({ action: { ...qAction, questionVersion: 2 } as never, revision: rev, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'sure', responseTimeMs: 100 }, ctx)).toThrow(AttemptBuildError)
  })

  it('replayOfAttemptId yalnız tekrar sunumda yazılır (01 §4.1)', async () => {
    const rev = (await repo.getRevision('q-1', 1))!
    const normal = buildQuestionAttempt({ action: qAction as never, revision: rev, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', confidence: 'sure', responseTimeMs: 100 }, ctx)
    expect(normal).not.toHaveProperty('replayOfAttemptId')
    const replay = buildRecallAttempt({ action: rAction as never, selfAssessment: 'hard', hookShown: false, responseTimeMs: 100 }, { ...ctx, replayOfAttemptId: 'act-1' })
    expect(replay.replayOfAttemptId).toBe('act-1')
  })
})
