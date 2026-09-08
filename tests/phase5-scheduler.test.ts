import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createEmptyCard, fsrs, generatorParameters } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { MemoryState, Rating } from '../src/domain'
import { SCHEDULER_CONFIG_V1 } from '../src/domain'
import { INSTALLED_ENGINE, createScheduler, isCompatible, resolveWeights, withResolvedWeights } from '../src/engine/scheduler/adapter'
import { ROOT, listTsFiles, stripCommentsAndStrings } from './helpers/scan'

// Phase 5 — Scheduler adaptörü (02 §3–4): U-SC-01…15 (pinli sözleşme 02 §3.1a; tam hazırlık dizileriyle).

const MIN = 60_000
const DAY = 86_400_000
const NOW = '2026-09-08T10:00:00.000Z'
const ms = (iso: string) => new Date(iso).getTime()
const plus = (iso: string, delta: number) => new Date(ms(iso) + delta).toISOString()
const S = createScheduler(SCHEDULER_CONFIG_V1)

/** Her cevap kendi vadesinde verilir (tam hazırlık dizisi). */
function run(ratings: Rating[], start = NOW): { state: MemoryState; lastReviewedAt: string } {
  let state = S.emptyState('atm-1', start)
  let t = start
  for (const r of ratings) {
    state = S.next(state, t, r)
    t = state.due
  }
  return { state, lastReviewedAt: state.lastReview! }
}

describe('Scheduler adaptörü — pin ve determinizm', () => {
  it('U-SC-01 — config pin: engineVersion === node_modules/ts-fsrs/package.json version; INSTALLED_ENGINE aynı', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules/ts-fsrs/package.json'), 'utf8')) as { version: string }
    expect(SCHEDULER_CONFIG_V1.engineVersion).toBe(pkg.version)
    expect(INSTALLED_ENGINE).toEqual({ engine: 'ts-fsrs', engineVersion: pkg.version, algorithm: 'FSRS-6' })
    const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(root.dependencies['ts-fsrs']).toBe('5.4.2') // ^ veya ~ yok
  })

  it('U-SC-02 — fuzz kapalı: aynı state + reviewedAt + rating → 100 çağrıda aynı due', () => {
    const base = run([3]).state
    const first = S.next(base, base.due, 3).due
    for (let i = 0; i < 100; i++) expect(S.next(base, base.due, 3).due).toBe(first)
    expect(() => createScheduler({ ...SCHEDULER_CONFIG_V1, enableFuzz: true })).toThrow()
  })

  it('U-SC-03 — emptyState: state 0, reps 0, retrievability sonlu (0), lastAttemptKind null', () => {
    const e = S.emptyState('atm-1', NOW)
    expect(e).toMatchObject({ atomId: 'atm-1', state: 0, reps: 0, lapses: 0, learningSteps: 0, lastReview: null, lastAttemptKind: null })
    expect(Number.isFinite(S.retrievability(e, NOW))).toBe(true)
    expect(S.retrievability(e, NOW)).toBe(0)
  })

  it('U-SC-04 — New + Good → Learning, adım 1, due = +10 dk (pinli çıktı)', () => {
    const s = S.next(S.emptyState('atm-1', NOW), NOW, 3)
    expect(s.state).toBe(1)
    expect(s.learningSteps).toBe(1)
    expect(ms(s.due) - ms(NOW)).toBe(10 * MIN)
    expect(s.lastReview).toBe(NOW)
    expect(s.reps).toBe(1)
  })

  it('U-SC-05 — New + Again → Learning, adım 0, due = +1 dk', () => {
    const s = S.next(S.emptyState('atm-1', NOW), NOW, 1)
    expect(s).toMatchObject({ state: 1, learningSteps: 0, lapses: 0 })
    expect(ms(s.due) - ms(NOW)).toBe(1 * MIN)
  })

  it('U-SC-12 — New + Hard → Learning, adım 0, due = +6 dk ((1+10)/2 yuvarlama)', () => {
    const s = S.next(S.emptyState('atm-1', NOW), NOW, 2)
    expect(s).toMatchObject({ state: 1, learningSteps: 0 })
    expect(ms(s.due) - ms(NOW)).toBe(6 * MIN)
  })

  it('U-SC-13a — Learning çıkışı Good→Good (her cevap kendi vadesinde) → Review, due = son review + 2 gün', () => {
    const { state, lastReviewedAt } = run([3, 3])
    expect(state.state).toBe(2)
    expect(ms(state.due) - ms(lastReviewedAt)).toBe(2 * DAY)
  })

  it('U-SC-13b — Again→Good→Good ve Hard→Good→Good → Review, tam 1 gün', () => {
    for (const seq of [[1, 3, 3], [2, 3, 3]] as Rating[][]) {
      const { state, lastReviewedAt } = run(seq)
      expect(state.state).toBe(2)
      expect(ms(state.due) - ms(lastReviewedAt)).toBe(1 * DAY)
    }
  })

  it('U-SC-13c — genel değişmez: her dizide Review\'a geçer, vade ileri gider, değer ham ts-fsrs çıktısıyla birebir', () => {
    const p = generatorParameters({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: false, enable_short_term: true, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] })
    const raw = fsrs(p)
    for (const seq of [[3, 3], [1, 3, 3], [2, 3, 3]] as Rating[][]) {
      const { state, lastReviewedAt } = run(seq)
      let card = createEmptyCard(new Date(NOW))
      let t = new Date(NOW)
      for (const r of seq) { card = raw.next(card, t, r).card; t = card.due }
      expect(state.state).toBe(2)
      expect(ms(state.due)).toBeGreaterThan(ms(lastReviewedAt))
      expect(state.due).toBe(card.due.toISOString())
      expect(state.stability).toBe(card.stability)
      expect(state.difficulty).toBe(card.difficulty)
    }
  })

  it('U-SC-14 — motor due hesaplamaz: src/engine/** (adaptör hariç) içinde due ataması, learning_steps ve dakika/gün sabiti yok', () => {
    const adapter = resolve(ROOT, 'src/engine/scheduler/adapter.ts')
    const hits: string[] = []
    for (const f of listTsFiles('src/engine')) {
      if (resolve(f) === adapter) continue
      const code = stripCommentsAndStrings(readFileSync(f, 'utf8'))
      code.split('\n').forEach((line, i) => {
        if (/(?<![\w.])due\s*[:=](?!=)/.test(line) && !/\bdue\s*:\s*(string|number|Date)\b/.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1} due ataması`)
        if (/learning_steps|relearning_steps/.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1} learning_steps`)
        if (/\b(86_?400_?000|3_?600_?000|60_?000)\b/.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1} zaman sabiti`)
      })
    }
    expect(hits).toEqual([])
    const adapterCode = stripCommentsAndStrings(readFileSync(adapter, 'utf8'))
    expect((adapterCode.match(/\bdue:/g) ?? []).length).toBeGreaterThan(0)
  })

  it('U-SC-15 — gün içi R eşitliği: pinli get_retrievability ilk 24 saatte R = 1; sonra düşer', () => {
    const { state, lastReviewedAt } = run([3, 3])
    expect(S.retrievability(state, plus(lastReviewedAt, 1 * 60 * MIN))).toBe(1)
    expect(S.retrievability(state, plus(lastReviewedAt, 23 * 60 * MIN))).toBe(1)
    expect(S.retrievability(state, plus(lastReviewedAt, 5 * DAY))).toBeLessThan(1)
  })

  it('U-SC-06 — Learning + Again lapse saymaz', () => {
    const { state } = run([1, 1])
    expect(state.state).toBe(1)
    expect(state.lapses).toBe(0)
  })

  it('U-SC-07 — Review + Again → Relearning, lapses 1, due = +10 dk', () => {
    const { state: review } = run([3, 3])
    expect(review.state).toBe(2)
    const s = S.next(review, review.due, 1)
    expect(s).toMatchObject({ state: 3, lapses: 1 })
    expect(ms(s.due) - ms(review.due)).toBe(10 * MIN)
  })

  it('U-SC-08 — Review + Good: state 2 kalır, due ileri gider, değer ham çıktıyla birebir (T2)', () => {
    const { state: review } = run([3, 3])
    const s = S.next(review, review.due, 3)
    expect(s.state).toBe(2)
    expect(ms(s.due)).toBeGreaterThan(ms(review.due))
    const p = generatorParameters({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: false, enable_short_term: true, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] })
    const raw = fsrs(p)
    let card = createEmptyCard(new Date(NOW)); let t = new Date(NOW)
    for (const r of [3, 3, 3] as const) { card = raw.next(card, t, r).card; t = card.due }
    expect(s.due).toBe(card.due.toISOString())
  })

  it('U-SC-09 — retrievability düşer: now+1g vs now+30g', () => {
    const { state, lastReviewedAt } = run([3, 3])
    expect(S.retrievability(state, plus(lastReviewedAt, 30 * DAY))).toBeLessThan(S.retrievability(state, plus(lastReviewedAt, 1 * DAY)))
  })

  it('U-SC-10 — maximumInterval 365: çok yüksek stability → aralık kırpılır (pinli gerçek: Good = 365 + 1 gün; BL-36)', () => {
    const { state } = run([3, 3])
    const huge: MemoryState = { ...state, stability: 100_000 }
    // ts-fsrs 5.4.2: Hard 365'e kırpılır; Good aralığı Hard + 1 zorunluluğuyla 366 olur (Easy 367, v0'da üretilmez).
    // Spec'in "≤ 365 gün" beklentisi pinli kütüphaneyle birebir tutmaz → BLOCKERS BL-36; uygulama aralığa gün eklemez/çıkarmaz.
    const hard = S.next(huge, huge.due, 2)
    const good = S.next(huge, huge.due, 3)
    expect(ms(hard.due) - ms(huge.due)).toBe(365 * DAY)
    expect(ms(good.due) - ms(huge.due)).toBe(366 * DAY)
    expect(ms(good.due) - ms(huge.due)).toBeLessThanOrEqual((SCHEDULER_CONFIG_V1.maximumInterval + 1) * DAY)
  })

  it('U-SC-11 — weights null → resolvedWeights 21 elemanlı sayı listesi (FSRS-6)', () => {
    const w = resolveWeights(SCHEDULER_CONFIG_V1)
    expect(w).toHaveLength(21)
    for (const x of w) expect(typeof x).toBe('number')
    expect(S.resolvedWeights()).toEqual(w)
    const cfg = withResolvedWeights(SCHEDULER_CONFIG_V1)
    expect(cfg.resolvedWeights).toEqual(w)
    expect(cfg.weights).toBeNull()
  })

  it('02 §4.1 — isCompatible: engine + engineVersion + algorithm üçlüsü', () => {
    expect(isCompatible(SCHEDULER_CONFIG_V1, INSTALLED_ENGINE)).toBe(true)
    expect(isCompatible({ ...SCHEDULER_CONFIG_V1, engineVersion: '9.9.9' }, INSTALLED_ENGINE)).toBe(false)
    expect(isCompatible({ ...SCHEDULER_CONFIG_V1, algorithm: 'FSRS-7' }, INSTALLED_ENGINE)).toBe(false)
    expect(isCompatible({ ...SCHEDULER_CONFIG_V1, requestRetention: 0.8 }, INSTALLED_ENGINE)).toBe(true) // uyumlu; config farkı ayrı konu
  })

  it('MemoryState ↔ Card dönüşümü lastAttemptKind/lastQuestionId korur; geçersiz rating hata', () => {
    const s0: MemoryState = { ...S.emptyState('atm-1', NOW), lastAttemptKind: 'recall', lastQuestionId: 'q-9' }
    const s1 = S.next(s0, NOW, 3)
    expect(s1.lastAttemptKind).toBe('recall')
    expect(s1.lastQuestionId).toBe('q-9')
    expect(() => S.next(s0, NOW, 0 as Rating)).toThrow()
  })
})
