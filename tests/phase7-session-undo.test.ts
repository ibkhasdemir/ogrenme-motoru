import { describe, expect, it } from 'vitest'
import type { LearningAction } from '../src/domain'
import { EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1 } from '../src/domain'
import { buildQuestionAttempt } from '../src/engine/attempts/build'
import { buildQueue, reviewQuotaAtoms, selectNext, startedToday } from '../src/engine/queue/dailyQueue'
import { applyAttempt, rebuild, serializeMemory } from '../src/engine/rebuild/rebuild'
import { Session, UNDO_WINDOW_MS } from '../src/engine/session/session'
import { undoAttempt } from '../src/engine/session/undo'
import { DAY, FakeClock, MIN, T0, atom, fakeIds, iso, liveCtx, makeEngine, seedReviewState, type Engine } from './helpers/engineFixture'

// Phase 7 — Dinamik oturum (03 §6): U-DS-01…12; geri al düzeltme tekrarı (03 §6.5, 02 §7): U-UN-01…08.

const undoDeps = (e: Engine) => ({ repo: e.repo, clock: e.clock, ids: e.ids, policy: EVIDENCE_POLICY_V1, config: SCHEDULER_CONFIG_V1 })

/** 20 atomu Learning durumuna getirir: New+Good 11 dk önce → due 1 dk önce (vadeli). */
async function twentyLearningDue(): Promise<Engine> {
  const e = await makeEngine(Array.from({ length: 20 }, (_, i) => atom(`atm-${String(i + 1).padStart(2, '0')}`, i + 1)))
  e.clock.wallMs = T0 - 11 * MIN
  for (let i = 1; i <= 20; i++) await e.recall(`atm-${String(i).padStart(2, '0')}`, 'good')
  e.clock.wallMs = T0
  return e
}

describe('Dinamik oturum seçimi', () => {
  it('U-DS-01 / U-DS-02 — Again sonrası bekletme yok: due +1 dk; saat ilerletilmezse gelmez, ilerletilince hemen uygun; eski liste beklenmez', async () => {
    const e = await twentyLearningDue()
    const first = selectNext(await liveCtx(e))!
    await e.recall(first.atomId, 'again') // Learning + Again → adım 0, due +1 dk
    expect(Date.parse(e.memory.get(first.atomId)!.due) - T0).toBe(1 * MIN)
    // U-DS-02: saat ilerletilmedi → o atom gelmez
    expect(buildQueue(await liveCtx(e)).some((i) => i.atomId === first.atomId)).toBe(false)
    // diğer 19 öğe cevaplanır (Good → Review, vadeleri ileri gider)
    for (let k = 0; k < 19; k++) {
      const item = selectNext(await liveCtx(e))!
      expect(item.atomId).not.toBe(first.atomId)
      await e.recall(item.atomId, 'good')
    }
    // U-DS-01: saat 1 dk ilerletilir → aynı atom, hiçbir listenin bitmesini beklemeden hemen gelir (R en düşük / tek vadeli)
    e.clock.advance(1 * MIN)
    const ctx = await liveCtx(e)
    expect(buildQueue(ctx).some((i) => i.atomId === first.atomId)).toBe(true)
    expect(selectNext(ctx)).toMatchObject({ atomId: first.atomId, reason: 'due' })
  })

  it('U-DS-03 — dinamik seçim reviewCap\'i delmez: cap 3, 30 çağrı → eski backlog\'dan başlanan distinct atom ≤ 3; öğrenme adımıyla geri gelenler sayılmaz', async () => {
    const e = await makeEngine(Array.from({ length: 10 }, (_, i) => atom(`atm-${i}`, i)), { reviewCap: 3, newPerDay: 0 })
    for (let i = 0; i < 10; i++) seedReviewState(e, `atm-${i}`, T0 - (i + 1) * DAY, T0 - (i + 3) * DAY)
    let answers = 0
    for (let n = 0; n < 30; n++) {
      const item = selectNext(await liveCtx(e))
      if (!item) break
      await e.recall(item.atomId, 'again') // Review+Again → Relearning +10 dk; sonra tekrar tekrar gelir (continuation)
      answers++
      e.clock.advance(10 * MIN)
    }
    const today = (await liveCtx(e)).todayAttempts
    const quota = reviewQuotaAtoms(today)
    expect(quota.size).toBeLessThanOrEqual(3)
    expect(quota.size).toBe(3)
    expect(answers).toBeGreaterThan(3) // continuation tavanla kesilmedi
    expect(new Set(today.map((a) => a.primaryAtomIdAtAttempt)).size).toBe(3)
  })

  it('U-DS-04 — dinamik seçim newPerDay\'i delmez: newPerDay 2, vadeli yokken 10 çağrı → başlatılan distinct yeni ≤ 2', async () => {
    const e = await makeEngine(Array.from({ length: 10 }, (_, i) => atom(`atm-${i}`, i)), { reviewCap: 25, newPerDay: 2 })
    for (let n = 0; n < 10; n++) {
      const item = selectNext(await liveCtx(e))
      if (!item) break
      await e.recall(item.atomId, 'good')
    }
    expect(startedToday((await liveCtx(e)).todayAttempts).size).toBe(2)
    expect(selectNext(await liveCtx(e))).toBeNull()
  })

  it('U-DS-05 — kuyruk due yazmaz: 50 selectNext → MemoryState değişmemiş', async () => {
    const e = await twentyLearningDue()
    const before = serializeMemory(e.memory)
    for (let i = 0; i < 50; i++) selectNext(await liveCtx(e))
    expect(serializeMemory(e.memory)).toBe(before)
  })

  it('U-DS-06 — void sonrası yeniden sunum: ilk deneme Again → void + REBUILD → selectNext atomu new olarak döndürür', async () => {
    const e = await makeEngine([atom('atm-1', 1)])
    const session = new Session(fakeIds('ses'), e.clock, null)
    const att = await e.recall('atm-1', 'again')
    const token = session.recordAttempt(att, { kind: 'recall', atomId: 'atm-1', actionId: att.id })!
    const out = await undoAttempt(session, token, undoDeps(e))
    expect(out).not.toBeNull()
    e.memory = out!.rebuilt.memory
    expect(e.memory.has('atm-1')).toBe(false)
    expect(selectNext(await liveCtx(e))).toMatchObject({ atomId: 'atm-1', reason: 'new' })
  })

  it('U-DS-07 — bütçe kontrolü öğe başında: 3 dk; 2:50\'de öğe başlar, 3:20\'de biter → sonraki nextItem "budget"', async () => {
    const e = await makeEngine([atom('atm-1', 1), atom('atm-2', 2)])
    const session = new Session(fakeIds('ses'), e.clock, 3 * MIN)
    e.clock.advance(170_000) // 2:50
    expect(session.nextItem(await liveCtx(e))).toMatchObject({ kind: 'item', item: { atomId: 'atm-1', reason: 'new' } })
    e.clock.advance(30_000) // 3:20 — aktif öğe tamamlanır
    await e.recall('atm-1', 'good')
    expect(session.nextItem(await liveCtx(e))).toEqual({ kind: 'end', reason: 'budget' })
  })

  it('U-DS-08 — oturum snapshot yok: oturum sırasında eklenen atom selectNext ile gelir', async () => {
    const e = await makeEngine([atom('atm-1', 1)])
    const session = new Session(fakeIds('ses'), e.clock, null)
    expect(session.nextItem(await liveCtx(e))).toMatchObject({ kind: 'item', item: { atomId: 'atm-1' } })
    await e.recall('atm-1', 'good') // due +10 dk
    expect(session.nextItem(await liveCtx(e))).toEqual({ kind: 'end', reason: 'empty' })
    const fresh = atom('atm-2', 2)
    await e.repo.putAtom(fresh)
    e.atoms = [...e.atoms, fresh]
    expect(session.nextItem(await liveCtx(e))).toMatchObject({ kind: 'item', item: { atomId: 'atm-2', reason: 'new' } })
  })

  it('U-DS-09 — continuation tavanla kesilmez: reviewCap dolu; bugün new başlatılan atom New+Again → due\'da gelir; quota artmaz', async () => {
    const e = await makeEngine([atom('atm-A', 1), atom('atm-B', 2)], { reviewCap: 1, newPerDay: 5 })
    seedReviewState(e, 'atm-B', T0 - DAY, T0 - 3 * DAY) // eski backlog
    await e.recall('atm-B', 'good') // bugün review → quota = 1 = cap (dolu)
    expect(reviewQuotaAtoms((await liveCtx(e)).todayAttempts).size).toBe(1)
    await e.recall('atm-A', 'again') // bugün new başlatıldı → due +1 dk
    e.clock.advance(1 * MIN)
    const ctx = await liveCtx(e)
    expect(selectNext(ctx)).toMatchObject({ atomId: 'atm-A', reason: 'due' })
    expect(reviewQuotaAtoms(ctx.todayAttempts).size).toBe(1)
    await e.recall('atm-A', 'good') // aynı gün learning review'u (mode review) → quota'ya girmez
    expect(reviewQuotaAtoms((await liveCtx(e)).todayAttempts).size).toBe(1)
  })

  it('U-DS-10 — reviewCap = 0: bugün new başlamış atomun continuation\'ı gelir; eski backlog\'dan hiçbir atom gelmez', async () => {
    const e = await makeEngine([atom('atm-A', 1), atom('atm-B', 2)], { reviewCap: 0, newPerDay: 5 })
    seedReviewState(e, 'atm-B', T0 - DAY, T0 - 3 * DAY) // eski backlog, vadeli
    expect(buildQueue(await liveCtx(e)).map((i) => i.atomId)).toEqual(['atm-A']) // B backlog'dan gelmez; A yeni
    await e.recall('atm-A', 'again')
    e.clock.advance(1 * MIN)
    const q = buildQueue(await liveCtx(e))
    expect(q.map((i) => i.atomId)).toEqual(['atm-A'])
    expect(q[0]!.reason).toBe('due')
  })

  it('U-DS-11 — reviewQuotaAtoms doğru sayılır; buildQueue = (continuation ∪ kalan kota kadar en düşük R backlog) tek sırayla ++ yeni', async () => {
    const e = await makeEngine([atom('atm-A', 1), atom('atm-B', 2), atom('atm-C', 3), atom('atm-N', 4)], { reviewCap: 1, newPerDay: 2 }) // A bugün new → kalan yeni 1
    seedReviewState(e, 'atm-B', T0 - 1 * DAY, T0 - 3 * DAY)
    seedReviewState(e, 'atm-C', T0 - 6 * DAY, T0 - 8 * DAY) // en düşük R
    await e.recall('atm-A', 'again') // bugün new
    e.clock.advance(1 * MIN)
    await e.recall('atm-A', 'good') // aynı gün mode=review → quota'ya GİRMEZ
    const ctx = await liveCtx(e)
    expect(reviewQuotaAtoms(ctx.todayAttempts).size).toBe(0)
    const q = buildQueue(ctx)
    // A'nın due'su +10 dk (henüz değil) → cont boş; backlog'dan kalan kota 1 → en düşük R = C; ++ yeni N
    expect(q.map((i) => i.atomId)).toEqual(['atm-C', 'atm-N'])
    expect(q.map((i) => i.reason)).toEqual(['due', 'new'])
  })

  it('U-DS-12 — bütçe monoton saat: duvar saati ±1 saat oynatılır → bütçe değişmez; gizliyken sayaç durur', async () => {
    const clock = new FakeClock()
    const session = new Session(fakeIds('ses'), clock, 3 * MIN)
    clock.monoMs += 60_000
    expect(session.activeMs()).toBe(60_000)
    clock.wallMs += 60 * MIN // duvar saati ileri
    expect(session.activeMs()).toBe(60_000)
    clock.wallMs -= 120 * MIN // geri
    expect(session.activeMs()).toBe(60_000)
    session.pause()
    clock.monoMs += 5 * MIN // uyku
    expect(session.activeMs()).toBe(60_000)
    session.resume()
    clock.monoMs += 60_000
    expect(session.activeMs()).toBe(120_000)
    expect(session.budgetExhausted()).toBe(false)
    clock.monoMs += 60_000
    expect(session.budgetExhausted()).toBe(true)
  })
})

describe('Geri al = tek seferlik düzeltme tekrarı (03 §6.5)', () => {
  async function withQuestion() {
    const e = await makeEngine([atom('atm-1', 1), atom('atm-2', 2)])
    await e.repo.createQuestion({
      id: 'q-1', primaryAtomId: 'atm-1', source: 'kendi', text: 'Soru?', createdAt: e.clock.now(),
      options: [{ id: 'o-1', text: 'a' }, { id: 'o-2', text: 'b' }], correctOptionId: 'o-1',
    })
    const session = new Session(fakeIds('ses'), e.clock, null)
    const answerQuestion = async (action: LearningAction & { kind: 'question' }, selected: string, replayOf?: string) => {
      const rev = (await e.repo.getRevision(action.questionId, action.questionVersion))!
      const input = buildQuestionAttempt(
        { action, revision: rev, initialSelectedOptionId: selected, selectedOptionId: selected, confidence: 'sure', wrongReason: 'unknown', responseTimeMs: 500 },
        { sessionId: session.sessionId, timestamp: e.clock.now(), memoryHasAtom: e.memory.has('atm-1'), ...(replayOf ? { replayOfAttemptId: replayOf } : {}) },
      )
      const stored = await e.repo.appendAttempt(input)
      applyAttempt(e.memory, stored, EVIDENCE_POLICY_V1, e.scheduler)
      return { stored, token: session.recordAttempt(stored, action) }
    }
    return { e, session, answerQuestion }
  }

  it('U-UN-01 — soru undo → exact tekrar: aynı questionId ve void edilen Attempt\'ın questionVersion\'ı; yeni actionId (BL-04); selectNext atlanır', async () => {
    const { e, session, answerQuestion } = await withQuestion()
    const action: LearningAction = { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId: 'act-q1' }
    const { stored, token } = await answerQuestion(action as never, 'o-2')
    await e.repo.reviseQuestion('q-1', { text: 'Soru (v2)?' }, e.clock.now()) // sunum sırasında v2 oldu
    const out = await undoAttempt(session, token!, undoDeps(e))
    expect(out).not.toBeNull()
    expect(out!.void.targetAttemptId).toBe(stored.id)
    const next = session.nextItem({ ...(await liveCtx(e)), atoms: [] }) // kuyruk boş olsa bile tekrar gelir → selectNext'e bakılmadı
    expect(next.kind).toBe('replay')
    if (next.kind !== 'replay') return
    expect(next.action).toMatchObject({ kind: 'question', questionId: 'q-1', questionVersion: 1 })
    expect(next.action.actionId).not.toBe('act-q1')
    expect(next.replayOfAttemptId).toBe(stored.id)
    expect(session.pendingReplay).toBeNull() // bir kez
  })

  it('U-UN-02 — kart undo → aynı atomun hatırlama kartı yeniden sunulur', async () => {
    const e = await makeEngine([atom('atm-1', 1)])
    const session = new Session(fakeIds('ses'), e.clock, null)
    const att = await e.recall('atm-1', 'good')
    const token = session.recordAttempt(att, { kind: 'recall', atomId: 'atm-1', actionId: att.id })!
    expect(await undoAttempt(session, token, undoDeps(e))).not.toBeNull()
    expect(session.nextItem(await liveCtx(e))).toMatchObject({ kind: 'replay', action: { kind: 'recall', atomId: 'atm-1' }, replayOfAttemptId: att.id })
  })

  it('U-UN-03 — düzeltme tekrarı önce gelir; sonraki cevaptan sonra selectNext normal (düşük R atom gelir)', async () => {
    const e = await makeEngine([atom('atm-1', 1), atom('atm-low', 2)])
    // atm-low gerçek olaylarla Review'a çıkar: 8 gün önce Good→Good → due 6 gün önce (vadeli, R düşük); undo sonrası REBUILD depodan kurulur
    e.clock.wallMs = T0 - 8 * DAY
    await e.recall('atm-low', 'good')
    e.clock.advance(10 * MIN)
    await e.recall('atm-low', 'good')
    e.clock.wallMs = T0
    expect(Date.parse(e.memory.get('atm-low')!.due)).toBeLessThan(T0)
    const session = new Session(fakeIds('ses'), e.clock, null)
    const att = await e.recall('atm-1', 'good')
    const token = session.recordAttempt(att, { kind: 'recall', atomId: 'atm-1', actionId: att.id })!
    const out = await undoAttempt(session, token, undoDeps(e))
    e.memory = out!.rebuilt.memory
    const next = session.nextItem(await liveCtx(e))
    expect(next).toMatchObject({ kind: 'replay', action: { atomId: 'atm-1' } })
    await e.recall('atm-1', 'good', { replayOfAttemptId: att.id, actionId: (next as { action: LearningAction }).action.actionId })
    expect(session.nextItem(await liveCtx(e))).toMatchObject({ kind: 'item', item: { atomId: 'atm-low', reason: 'due' } })
  })

  it('U-UN-04 — tekrar due yazmaz: geri al + tekrar sunum sonrası tüm due değerleri REBUILD sonucuyla aynı; tekrar cevap normal scheduler.next', async () => {
    const e = await makeEngine([atom('atm-1', 1), atom('atm-2', 2)])
    seedReviewState(e, 'atm-2', T0 - DAY, T0 - 3 * DAY)
    await e.rebuildMemory()
    const session = new Session(fakeIds('ses'), e.clock, null)
    const att = await e.recall('atm-1', 'again')
    const token = session.recordAttempt(att, { kind: 'recall', atomId: 'atm-1', actionId: att.id })!
    const out = await undoAttempt(session, token, undoDeps(e))
    e.memory = out!.rebuilt.memory
    session.nextItem(await liveCtx(e)) // tekrar sunumu
    expect(serializeMemory(e.memory)).toBe(serializeMemory(rebuild(await e.repo.listAttempts(), await e.repo.listVoids(), EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1).memory))
    const replayAtt = await e.recall('atm-1', 'good', { replayOfAttemptId: att.id })
    expect(replayAtt.mode).toBe('new') // void sonrası hafıza yok → yeniden new
    expect(Date.parse(e.memory.get('atm-1')!.due) - T0).toBe(10 * MIN) // New+Good pinli çıktı
  })

  it('U-UN-05 — tekrar durumu persist edilmez: uygulama yeniden başlar → pendingReplay yok; void ve REBUILD kalıcı', async () => {
    const e = await makeEngine([atom('atm-1', 1)])
    const session = new Session(fakeIds('ses'), e.clock, null)
    const att = await e.recall('atm-1', 'good')
    const token = session.recordAttempt(att, { kind: 'recall', atomId: 'atm-1', actionId: att.id })!
    await undoAttempt(session, token, undoDeps(e))
    expect(session.pendingReplay).not.toBeNull()
    // yeniden açılış: yeni oturum, depodan REBUILD
    const fresh = new Session(fakeIds('ses2'), e.clock, null)
    await e.rebuildMemory()
    expect(fresh.pendingReplay).toBeNull()
    expect((await e.repo.listVoids()).map((v) => v.targetAttemptId)).toEqual([att.id])
    expect(e.memory.has('atm-1')).toBe(false)
    expect(fresh.nextItem(await liveCtx(e))).toMatchObject({ kind: 'item', item: { atomId: 'atm-1', reason: 'new' } })
  })

  it('U-UN-06 — 30 sn penceresi ve tek kullanım: 31 sn sonra geri al reddedilir (void yok); aynı action için ikinci geri al reddedilir', async () => {
    const e = await makeEngine([atom('atm-1', 1)])
    const session = new Session(fakeIds('ses'), e.clock, null)
    const att = await e.recall('atm-1', 'good')
    const token = session.recordAttempt(att, { kind: 'recall', atomId: 'atm-1', actionId: att.id })!
    expect(token.expiresAtMono - e.clock.monotonicMs()).toBe(UNDO_WINDOW_MS)
    e.clock.advance(31_000)
    expect(await undoAttempt(session, token, undoDeps(e))).toBeNull()
    expect(await e.repo.listVoids()).toEqual([])
    const att2 = await e.recall('atm-1', 'good')
    const token2 = session.recordAttempt(att2, { kind: 'recall', atomId: 'atm-1', actionId: att2.id })!
    expect(await undoAttempt(session, token2, undoDeps(e))).not.toBeNull()
    expect(await undoAttempt(session, token2, undoDeps(e))).toBeNull()
    expect(await e.repo.listVoids()).toHaveLength(1)
  })

  it('U-UN-07 — tekrar bağı: tekrar Attempt replayOfAttemptId = void edilen id; normal Attempt\'ta yok; REBUILD ikisini doğru işler; tekrar cevaba token verilmez', async () => {
    const e = await makeEngine([atom('atm-1', 1)])
    const session = new Session(fakeIds('ses'), e.clock, null)
    const att = await e.recall('atm-1', 'again')
    expect(att).not.toHaveProperty('replayOfAttemptId')
    const token = session.recordAttempt(att, { kind: 'recall', atomId: 'atm-1', actionId: att.id })!
    const out = await undoAttempt(session, token, undoDeps(e))
    e.memory = out!.rebuilt.memory
    const replayItem = session.nextItem(await liveCtx(e)) as { kind: 'replay'; action: LearningAction; replayOfAttemptId: string }
    const replayAtt = await e.recall('atm-1', 'good', { replayOfAttemptId: replayItem.replayOfAttemptId, actionId: replayItem.action.actionId })
    expect(replayAtt.replayOfAttemptId).toBe(att.id)
    expect(session.recordAttempt(replayAtt, replayItem.action)).toBeNull() // BL-04
    const r = rebuild(await e.repo.listAttempts(), await e.repo.listVoids(), EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
    expect(r.reviewEvents.map((ev) => ev.attemptId)).toEqual([replayAtt.id])
    expect(r.reviewEvents[0]!.rating).toBe(3)
    expect(session.answered).toBe(2) // void edilince düşmez
  })

  it('U-UN-08 — undo hedefi sabit: A sonra B; B\'nin token\'ıyla iki undo(B) → yalnız B void, ikinci null; A\'ya düşülmez', async () => {
    const e = await makeEngine([atom('atm-A', 1), atom('atm-B', 2)])
    const session = new Session(fakeIds('ses'), e.clock, null)
    const a = await e.recall('atm-A', 'good')
    session.recordAttempt(a, { kind: 'recall', atomId: 'atm-A', actionId: a.id })
    const b = await e.recall('atm-B', 'good')
    const tokenB = session.recordAttempt(b, { kind: 'recall', atomId: 'atm-B', actionId: b.id })!
    expect(await undoAttempt(session, tokenB, undoDeps(e))).not.toBeNull()
    expect(await undoAttempt(session, tokenB, undoDeps(e))).toBeNull()
    const voids = await e.repo.listVoids()
    expect(voids.map((v) => v.targetAttemptId)).toEqual([b.id])
    expect((await e.repo.listAttempts()).map((x) => x.id)).toEqual([a.id, b.id]) // Attempt silinmez (A3)
  })
})
