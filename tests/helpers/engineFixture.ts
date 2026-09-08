// Motor testleri için ortak fixture: enjekte saat/kimlik, atom üretimi, cevap yardımcıları (08 §0).
import type { Atom, Attempt, LearningAction, MemoryState, QueueConfig, Rating, Subject, Topic } from '../../src/domain'
import { EVIDENCE_POLICY_V1, QUEUE_CONFIG_DEFAULT, SCHEDULER_CONFIG_V1 } from '../../src/domain'
import { buildQuestionAttempt, buildRecallAttempt } from '../../src/engine/attempts/build'
import { todayAttempts, type QueueContext } from '../../src/engine/queue/dailyQueue'
import { applyAttempt, rebuild, type Memory } from '../../src/engine/rebuild/rebuild'
import { createScheduler, type Scheduler } from '../../src/engine/scheduler/adapter'
import type { Clock, IdGenerator } from '../../src/platform/services'
import { MemoryRepository } from '../../src/store/memory/memoryRepository'

export const MIN = 60_000
export const DAY = 86_400_000
export const T0 = Date.parse('2026-09-08T10:00:00.000Z')
export const iso = (ms: number) => new Date(ms).toISOString()

/** Enjekte saat: duvar saati ve monoton saat bağımsız oynatılabilir (U-DS-12). */
export class FakeClock implements Clock {
  wallMs: number
  monoMs: number
  constructor(wallMs = T0, monoMs = 1_000_000) {
    this.wallMs = wallMs
    this.monoMs = monoMs
  }
  now(): string { return iso(this.wallMs) }
  monotonicMs(): number { return this.monoMs }
  /** hem duvar hem monoton saat ilerler */
  advance(ms: number): void { this.wallMs += ms; this.monoMs += ms }
}

export function fakeIds(prefix = 'id'): IdGenerator {
  let n = 0
  return { newId: () => `${prefix}-${++n}` }
}

export const subject: Subject = { id: 'sub-1', name: 'Tarih', sortOrder: 1 }
export const topic: Topic = { id: 'top-1', subjectId: 'sub-1', name: 'Osmanlı', sortOrder: 1 }

export function atom(id: string, sortOrder: number, over: Partial<Atom> = {}): Atom {
  return { id, topicId: 'top-1', text: `${id} metni`, prompt: `${id}?`, facets: ['fact'], sortOrder, archived: false, createdAt: iso(T0 - DAY), ...over }
}

export interface Engine {
  repo: MemoryRepository
  clock: FakeClock
  ids: IdGenerator
  scheduler: Scheduler
  memory: Memory
  atoms: Atom[]
  config: QueueConfig
  ctx(): QueueContext
  /** hatırlama kartı cevabı: Attempt diske → applyAttempt belleğe (06 §5 sıra) */
  recall(atomId: string, self: 'again' | 'hard' | 'good', opts?: { replayOfAttemptId?: string; actionId?: string; pretest?: boolean }): Promise<Attempt>
  rebuildMemory(): Promise<void>
}

export async function makeEngine(atomList: Atom[], config: QueueConfig = QUEUE_CONFIG_DEFAULT, clock = new FakeClock()): Promise<Engine> {
  const ids = fakeIds('act')
  const repo = new MemoryRepository(fakeIds('gen'))
  await repo.putSubject(subject)
  await repo.putTopic(topic)
  for (const a of atomList) await repo.putAtom(a)
  const scheduler = createScheduler(SCHEDULER_CONFIG_V1)
  const memory: Memory = new Map()
  const engine: Engine = {
    repo, clock, ids, scheduler, memory, atoms: atomList, config,
    ctx() {
      return { atoms: this.atoms, topics: [topic], subjects: [subject], memory: this.memory, scheduler, now: clock.now(), config: this.config, todayAttempts: [] }
    },
    async recall(atomId, self, opts = {}) {
      const action: LearningAction = { kind: 'recall', atomId, actionId: opts.actionId ?? ids.newId() }
      const input = buildRecallAttempt({ action, selfAssessment: self, hookShown: false, responseTimeMs: 1000 }, {
        sessionId: 'ses-1', timestamp: clock.now(), memoryHasAtom: this.memory.has(atomId), ...(opts.pretest ? { pretest: true } : {}), ...(opts.replayOfAttemptId ? { replayOfAttemptId: opts.replayOfAttemptId } : {}),
      })
      const stored = await repo.appendAttempt(input)
      applyAttempt(this.memory, stored, EVIDENCE_POLICY_V1, scheduler)
      return stored
    },
    async rebuildMemory() {
      this.memory = rebuild(await repo.listAttempts(), await repo.listVoids(), EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1).memory
    },
  }
  return engine
}

/** ctx'i güncel todayAttempts ile üretir (depodan). */
export async function liveCtx(e: Engine): Promise<QueueContext> {
  const ctx = e.ctx()
  ctx.todayAttempts = todayAttempts(await e.repo.listAttempts(), await e.repo.listVoids(), e.clock.now())
  return ctx
}

/** Belirli bir atomu Review durumuna getirir: Good→Good, ardından due'yu istenen ana kaydırır (yalnız test kurulumu; memory'ye doğrudan yazar). */
export function seedReviewState(e: Engine, atomId: string, dueMs: number, lastReviewMs: number, ratings: Rating[] = [3, 3]): MemoryState {
  let s = e.scheduler.emptyState(atomId, iso(lastReviewMs - 2 * DAY))
  let t = iso(lastReviewMs - 2 * DAY)
  for (const r of ratings) { s = e.scheduler.next(s, t, r); t = s.due }
  const state: MemoryState = { ...s, due: iso(dueMs), lastReview: iso(lastReviewMs), lastAttemptKind: 'recall' }
  e.memory.set(atomId, state)
  return state
}

export function questionActionFor(questionId: string, version: number, actionId: string): LearningAction {
  return { kind: 'question', questionId, questionVersion: version, actionId }
}

export { buildQuestionAttempt }
