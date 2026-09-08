import { describe, expect, it } from 'vitest'
import type { Attempt, Subject, Topic } from '../src/domain'
import { QueueConfigError, buildQueue, eligibleDue, eligibleNew, localDayKey, selectNext, todayCounts, validateQueueConfig } from '../src/engine/queue/dailyQueue'
import { serializeMemory } from '../src/engine/rebuild/rebuild'
import { DAY, MIN, T0, atom, iso, liveCtx, makeEngine, seedReviewState } from './helpers/engineFixture'

// Phase 7 — DailyQueue (03 §3, §7): U-DQ-01…16. selectNext/buildQueue saf; due'ya dokunmaz (A16).

const recallAtt = (id: string, seq: number, atomId: string, mode: Attempt['mode'], ts = iso(T0 - MIN)): Attempt => ({
  id, kind: 'recall', sequence: seq, timestamp: ts, sessionId: 's', primaryAtomIdAtAttempt: atomId, atomId, mode, confidence: null,
  operation: 'recall', support: 'none', responseTimeMs: 100, selfAssessment: 'good',
})

describe('DailyQueue', () => {
  it('U-DQ-01 — vadeli önce, düşük R önce', async () => {
    const e = await makeEngine([atom('atm-1', 1), atom('atm-2', 2)])
    seedReviewState(e, 'atm-1', T0 - 1 * DAY, T0 - 3 * DAY)
    seedReviewState(e, 'atm-2', T0 - 5 * DAY, T0 - 7 * DAY) // daha zayıf
    const q = buildQueue(e.ctx())
    expect(q.map((i) => i.atomId)).toEqual(['atm-2', 'atm-1'])
    expect(q[0]!.retrievability!).toBeLessThan(q[1]!.retrievability!)
    expect(q.every((i) => i.reason === 'due')).toBe(true)
  })

  it('U-DQ-02 — R eşitliğinde due ASC (en eski vade), sonra atomId ASC (BL-21)', async () => {
    const e = await makeEngine([atom('atm-c', 1), atom('atm-a', 2), atom('atm-b', 3)])
    seedReviewState(e, 'atm-c', T0 - 1 * DAY, T0 - 3 * DAY)
    seedReviewState(e, 'atm-a', T0 - 2 * DAY, T0 - 3 * DAY) // aynı R (aynı lastReview/stability), daha eski vade
    seedReviewState(e, 'atm-b', T0 - 2 * DAY, T0 - 3 * DAY) // atm-a ile aynı vade → atomId
    const q = buildQueue(e.ctx())
    expect(new Set(q.map((i) => i.retrievability)).size).toBe(1)
    expect(q.map((i) => i.atomId)).toEqual(['atm-a', 'atm-b', 'atm-c'])
  })

  it('U-DQ-03 — due tam now\'a eşit → vadeli', async () => {
    const e = await makeEngine([atom('atm-1', 1)])
    seedReviewState(e, 'atm-1', T0, T0 - 2 * DAY)
    expect(selectNext(e.ctx())?.atomId).toBe('atm-1')
    seedReviewState(e, 'atm-1', T0 + 1, T0 - 2 * DAY)
    expect(selectNext(e.ctx())).toBeNull()
  })

  it('U-DQ-04 — reviewCap günlük benzersiz tavan: 5 vadeli, cap 2, bugün tekrar yok → buildQueue 2; selectNext ilkini döner', async () => {
    const e = await makeEngine([1, 2, 3, 4, 5].map((n) => atom(`atm-${n}`, n)), { reviewCap: 2, newPerDay: 10 })
    for (let n = 1; n <= 5; n++) seedReviewState(e, `atm-${n}`, T0 - n * DAY, T0 - (n + 2) * DAY)
    const q = buildQueue(e.ctx())
    expect(q).toHaveLength(2)
    expect(q.map((i) => i.atomId)).toEqual(['atm-5', 'atm-4']) // en düşük R'ler
    expect(selectNext(e.ctx())).toEqual(q[0])
  })

  it('U-DQ-04b — tavan bugün başlamış atomu engellemez: cap 2, bugün 2 atom tekrar edilmiş, biri yeniden vadeli → o gelir; üçüncü yeni vadeli gelmez', async () => {
    const e = await makeEngine([atom('atm-1', 1), atom('atm-2', 2), atom('atm-3', 3)], { reviewCap: 2, newPerDay: 10 })
    seedReviewState(e, 'atm-1', T0 - MIN, T0 - 20 * MIN)
    seedReviewState(e, 'atm-2', T0 + DAY, T0 - 20 * MIN) // bugün tekrar edildi, vadesi ileri
    seedReviewState(e, 'atm-3', T0 - 3 * DAY, T0 - 5 * DAY) // eski backlog, vadeli
    const ctx = e.ctx()
    ctx.todayAttempts = [recallAtt('a1', 1, 'atm-1', 'review'), recallAtt('a2', 2, 'atm-2', 'review')] // quota = 2 = cap
    const q = buildQueue(ctx)
    expect(q.map((i) => i.atomId)).toEqual(['atm-1'])
    expect(selectNext(ctx)?.atomId).toBe('atm-1')
  })

  it('U-DQ-05 — tavan due\'yu değiştirmez: buildQueue/selectNext sonrası tüm due değerleri aynı (T14)', async () => {
    const e = await makeEngine([1, 2, 3, 4, 5].map((n) => atom(`atm-${n}`, n)), { reviewCap: 2, newPerDay: 10 })
    for (let n = 1; n <= 5; n++) seedReviewState(e, `atm-${n}`, T0 - n * DAY, T0 - (n + 2) * DAY)
    const before = serializeMemory(e.memory)
    buildQueue(e.ctx()); selectNext(e.ctx()); eligibleDue(e.ctx()); eligibleNew(e.ctx()); todayCounts(e.ctx())
    expect(serializeMemory(e.memory)).toBe(before)
  })

  it('U-DQ-06 — yeni sıra: (subject.sortOrder, topic.sortOrder, atom.sortOrder, atom.id)', async () => {
    const e = await makeEngine([atom('atm-x', 3), atom('atm-y', 1), atom('atm-z', 2), atom('atm-w', 9, { topicId: 'top-0' })])
    const sub0: Subject = { id: 'sub-0', name: 'Coğrafya', sortOrder: 0 }
    const top0: Topic = { id: 'top-0', subjectId: 'sub-0', name: 'İklim', sortOrder: 5 }
    const ctx = e.ctx()
    ctx.subjects = [...ctx.subjects, sub0]
    ctx.topics = [...ctx.topics, top0]
    expect(eligibleNew(ctx).map((i) => i.atomId)).toEqual(['atm-w', 'atm-y', 'atm-z', 'atm-x'])
    expect(eligibleNew(ctx).every((i) => i.reason === 'new' && i.retrievability === null)).toBe(true)
  })

  it('U-DQ-07 — newPerDay: 5 yeni, tavan 2, başlatılan 0 → 2; başlatılan 2 (Attempt geçmişinden) → 0', async () => {
    const e = await makeEngine([1, 2, 3, 4, 5].map((n) => atom(`atm-${n}`, n)), { reviewCap: 25, newPerDay: 2 })
    expect(eligibleNew(e.ctx())).toHaveLength(2)
    const ctx = e.ctx()
    ctx.todayAttempts = [recallAtt('a1', 1, 'atm-1', 'new'), recallAtt('a2', 2, 'atm-2', 'new')]
    expect(eligibleNew(ctx)).toHaveLength(0)
    expect(todayCounts(ctx).new).toBe(0)
  })

  it('U-DQ-08 — pretest yeni sayacına girmez: pretest attempt\'lı atom hâlâ new olarak gelir', async () => {
    const e = await makeEngine([atom('atm-1', 1), atom('atm-2', 2)], { reviewCap: 25, newPerDay: 1 })
    const ctx = e.ctx()
    ctx.todayAttempts = [recallAtt('a1', 1, 'atm-1', 'pretest')]
    expect(eligibleNew(ctx).map((i) => i.atomId)).toEqual(['atm-1']) // kota tüketilmedi, atm-1 başlanmamış
  })

  it('U-DQ-09 — arşivli atom kuyrukta yok; MemoryState korunur', async () => {
    const e = await makeEngine([atom('atm-1', 1, { archived: true }), atom('atm-2', 2)])
    seedReviewState(e, 'atm-1', T0 - DAY, T0 - 3 * DAY)
    expect(buildQueue(e.ctx()).map((i) => i.atomId)).toEqual(['atm-2'])
    expect(e.memory.has('atm-1')).toBe(true)
  })

  it('U-DQ-10 / U-DQ-11 — saf fonksiyon: iki çağrı aynı dizi; selectNext = buildQueue[0]', async () => {
    const e = await makeEngine([atom('atm-1', 1), atom('atm-2', 2), atom('atm-3', 3)])
    seedReviewState(e, 'atm-2', T0 - DAY, T0 - 3 * DAY)
    expect(buildQueue(e.ctx())).toEqual(buildQueue(e.ctx()))
    expect(selectNext(e.ctx())).toEqual(buildQueue(e.ctx())[0])
    expect(selectNext(e.ctx())?.atomId).toBe('atm-2')
  })

  it('U-DQ-12 — yeni yalnız vadeli yokken: 1 vadeli + 3 yeni → vadeli; vadesi ileri gidince → yeni', async () => {
    const e = await makeEngine([atom('atm-d', 1), atom('atm-1', 2), atom('atm-2', 3), atom('atm-3', 4)])
    seedReviewState(e, 'atm-d', T0 - DAY, T0 - 3 * DAY)
    expect(selectNext(e.ctx())).toMatchObject({ atomId: 'atm-d', reason: 'due' })
    seedReviewState(e, 'atm-d', T0 + 2 * DAY, T0) // cevaplandı, vadesi ileri
    expect(selectNext(e.ctx())).toMatchObject({ atomId: 'atm-1', reason: 'new' })
  })

  it('U-DQ-13 — karşı örnek: continuation öncelik almaz; A (bugün çalışılmış, R yüksek) ve B (eski backlog, R düşük) → ilk B, A ikinci, A kotadan kesilmemiş', async () => {
    const e = await makeEngine([atom('atm-A', 1), atom('atm-B', 2)], { reviewCap: 1, newPerDay: 0 })
    const a = seedReviewState(e, 'atm-A', T0 - MIN, T0 - 2 * DAY)
    e.memory.set('atm-A', { ...a, stability: 30 }) // R yüksek
    const b = seedReviewState(e, 'atm-B', T0 - 5 * DAY, T0 - 12 * DAY)
    e.memory.set('atm-B', { ...b, stability: 1 }) // R düşük
    const ctx = e.ctx()
    ctx.todayAttempts = [recallAtt('a1', 1, 'atm-A', 'review')] // quota = 1 = cap → backlog'dan yalnız 0 kalan? Hayır: A quota'da, B backlog → remaining = 0!
    // quota A'yı sayar (eski backlog'dan bugün açıldı) → kalan kota 0 → B gelmez. Karşı örnek kota VARKEN kurulur:
    ctx.config = { reviewCap: 2, newPerDay: 0 }
    const q = buildQueue(ctx)
    expect(q.map((i) => i.atomId)).toEqual(['atm-B', 'atm-A'])
    expect(selectNext(ctx)?.atomId).toBe('atm-B')
    expect(q[0]!.retrievability!).toBeLessThan(q[1]!.retrievability!)
  })

  it('U-DQ-14 — negatif kota yok: 8 yeni başlatıldı, newPerDay 5\'e indirildi → kalan 0; ayarlar negatif/sonsuz/ondalık değeri reddeder', async () => {
    const e = await makeEngine([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => atom(`atm-${n}`, n)), { reviewCap: 25, newPerDay: 5 })
    const ctx = e.ctx()
    ctx.todayAttempts = Array.from({ length: 8 }, (_, i) => recallAtt(`a${i}`, i + 1, `atm-${i + 1}`, 'new'))
    expect(eligibleNew(ctx)).toEqual([])
    expect(todayCounts(ctx).new).toBe(0)
    for (const bad of [{ reviewCap: -1, newPerDay: 5 }, { reviewCap: 2, newPerDay: 1.5 }, { reviewCap: Infinity, newPerDay: 1 }, { reviewCap: 2, newPerDay: Number.NaN }]) {
      expect(() => validateQueueConfig(bad)).toThrow(QueueConfigError)
    }
    expect(() => validateQueueConfig({ reviewCap: 0, newPerDay: 0 })).not.toThrow()
  })

  it('U-DQ-15 — gece yarısı continuation: 23:59 New+Again (due 00:00), saat 00:09 → startedToday boş; atom Learning olduğu için reviewCap 0\'da bile uygun', async () => {
    // yerel gün sınırını bul (TZ bağımsız): localDayKey değişen ilk dakika
    let boundary = T0
    while (localDayKey(iso(boundary)) === localDayKey(iso(boundary + MIN))) boundary += MIN
    boundary += MIN // yeni günün ilk dakikası (00:00)
    const e = await makeEngine([atom('atm-1', 1)], { reviewCap: 0, newPerDay: 10 })
    e.clock.wallMs = boundary - MIN // 23:59
    await e.recall('atm-1', 'again') // New + Again → due +1 dk = 00:00
    e.clock.wallMs = boundary + 9 * MIN // 00:09
    const ctx = await liveCtx(e)
    expect(ctx.todayAttempts).toEqual([]) // önceki güne ait
    expect(e.memory.get('atm-1')!.state).toBe(1)
    expect(selectNext(ctx)).toMatchObject({ atomId: 'atm-1', reason: 'due' })
  })

  it('U-DQ-16 — prompt\'suz atom kuyruğa girmez; prompt doldurulunca girer (01 §2.3)', async () => {
    const e = await makeEngine([atom('atm-1', 1, { prompt: '' }), atom('atm-2', 2, { prompt: '   ' })])
    expect(eligibleNew(e.ctx())).toEqual([])
    seedReviewState(e, 'atm-1', T0 - DAY, T0 - 3 * DAY)
    expect(eligibleDue(e.ctx())).toEqual([])
    expect(todayCounts(e.ctx())).toMatchObject({ review: 0, new: 0, queueLength: 0 })
    e.atoms = [atom('atm-1', 1, { prompt: 'Soru yüzü?' }), atom('atm-2', 2, { prompt: '   ' })]
    expect(eligibleDue(e.ctx()).map((i) => i.atomId)).toEqual(['atm-1'])
  })

  it('03 §7 — Bugün sayıları: tekrar (tavansız), yeni, bugün yapılan, Başla · N', async () => {
    const e = await makeEngine([1, 2, 3, 4].map((n) => atom(`atm-${n}`, n)), { reviewCap: 1, newPerDay: 1 })
    seedReviewState(e, 'atm-1', T0 - DAY, T0 - 3 * DAY)
    seedReviewState(e, 'atm-2', T0 - DAY, T0 - 3 * DAY)
    const ctx = e.ctx()
    ctx.todayAttempts = [recallAtt('a1', 1, 'atm-3', 'new')] // atm-3 bugün başlatıldı
    seedReviewState(e, 'atm-3', T0 + DAY, T0 - MIN)
    expect(todayCounts(ctx)).toEqual({ review: 2, new: 0, doneToday: 1, queueLength: 1 })
  })
})
