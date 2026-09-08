// 03 §3 — Günlük kuyruk: "şu an hangi atom" sorusu. Hiçbir şeyi diske yazmaz, `due`'ya dokunmaz (A16). Vadeyi yalnız FSRS yazar (A15).
// Tavanlar Attempt geçmişinden hesaplanır (§3.2); bellekte sayaç tutulmaz → dinamik seçim tavanı delemez.
import type { Atom, Attempt, AttemptVoid, DailyQueueItem, QueueConfig, Subject, Topic } from '../../domain'
import { compareCodePoint } from '../backup/canonical'
import type { Memory } from '../rebuild/rebuild'
import type { Scheduler } from '../scheduler/adapter'

export interface QueueContext {
  atoms: readonly Atom[]
  topics: readonly Topic[]
  subjects: readonly Subject[]
  memory: Memory
  scheduler: Scheduler
  /** UTC duvar saati (Clock.now()) */
  now: string
  config: QueueConfig
  /** yerel günde void edilmemiş Attempt'lar (todayAttempts ile üretilir) */
  todayAttempts: readonly Attempt[]
}

export class QueueConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueueConfigError'
  }
}

/** 03 §3.4 kural 9: sonlu, negatif olmayan tamsayı. */
export function validateQueueConfig(cfg: QueueConfig): void {
  for (const k of ['reviewCap', 'newPerDay'] as const) {
    const v = cfg[k]
    if (!Number.isInteger(v) || v < 0) throw new QueueConfigError(`${k} negatif olmayan sonlu tamsayı olmalı`)
  }
}

/** 01 §2.3: çalışılabilirlik — prompt dolu ve arşivli değil. */
export function studyable(a: Atom): boolean {
  return !a.archived && a.prompt.trim().length > 0
}

/** 03 §3.2: gün sınırı cihazın yerel gece yarısı. */
export function localDayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** Yerel günde void edilmemiş Attempt'lar (03 §3.1). */
export function todayAttempts(attempts: readonly Attempt[], voids: readonly AttemptVoid[], now: string): Attempt[] {
  const voided = new Set(voids.map((v) => v.targetAttemptId))
  const today = localDayKey(now)
  return attempts.filter((a) => !voided.has(a.id) && localDayKey(a.timestamp) === today)
}

/** 03 §3.2: bugün yeni başlatılan distinct atomlar (mode = new). Pretest/external sayılmaz. */
export function startedToday(today: readonly Attempt[]): Set<string> {
  return new Set(today.filter((a) => a.mode === 'new').map((a) => a.primaryAtomIdAtAttempt))
}

/** 03 §3.2: bugün review Attempt'ı olan distinct atomlar. */
export function reviewedToday(today: readonly Attempt[]): Set<string> {
  return new Set(today.filter((a) => a.mode === 'review').map((a) => a.primaryAtomIdAtAttempt))
}

/** 03 §3.2: reviewQuotaAtoms = reviewedToday − startedToday (eski backlog'dan bugün açılanlar). */
export function reviewQuotaAtoms(today: readonly Attempt[]): Set<string> {
  const started = startedToday(today)
  return new Set([...reviewedToday(today)].filter((id) => !started.has(id)))
}

function dueComparator(memory: Memory) {
  // 03 §3.3 / §3.4 kural 6 (BL-21): (R ASC, due ASC, atomId ASC)
  return (x: DailyQueueItem, y: DailyQueueItem): number => {
    const rx = x.retrievability ?? 0
    const ry = y.retrievability ?? 0
    if (rx !== ry) return rx < ry ? -1 : 1
    const dx = memory.get(x.atomId)?.due ?? ''
    const dy = memory.get(y.atomId)?.due ?? ''
    if (dx !== dy) return Date.parse(dx) < Date.parse(dy) ? -1 : 1
    return compareCodePoint(x.atomId, y.atomId)
  }
}

export function eligibleDue(ctx: QueueContext): DailyQueueItem[] {
  validateQueueConfig(ctx.config)
  const active = ctx.atoms.filter(studyable)
  const started = startedToday(ctx.todayAttempts)
  const rvd = reviewedToday(ctx.todayAttempts)
  const quota = reviewQuotaAtoms(ctx.todayAttempts)
  const remainingReview = Math.max(0, ctx.config.reviewCap - quota.size)
  const nowMs = Date.parse(ctx.now)
  const cont: DailyQueueItem[] = []
  const backlog: DailyQueueItem[] = []
  for (const a of active) {
    const s = ctx.memory.get(a.id)
    if (!s || Date.parse(s.due) > nowMs) continue // due <= now milisaniye hassasiyetinde; eşitlik vadeli
    const item: DailyQueueItem = { atomId: a.id, reason: 'due', retrievability: ctx.scheduler.retrievability(s, ctx.now) }
    // continuation: bugün new başlatılmış VEYA bugün review'una başlanmış VEYA FSRS öğrenme adımında (Learning/Relearning)
    if (started.has(a.id) || rvd.has(a.id) || s.state === 1 || s.state === 3) cont.push(item)
    else backlog.push(item)
  }
  const cmp = dueComparator(ctx.memory)
  backlog.sort(cmp)
  const chosen = [...cont, ...backlog.slice(0, remainingReview)] // eski backlog'dan yalnız kalan kota kadar
  chosen.sort(cmp) // tek sıralama: continuation önceliği yoktur
  return chosen
}

function newOrderComparator(ctx: QueueContext) {
  const topics = new Map(ctx.topics.map((t) => [t.id, t]))
  const subjects = new Map(ctx.subjects.map((s) => [s.id, s]))
  const key = (a: Atom) => {
    const t = topics.get(a.topicId)
    const s = t ? subjects.get(t.subjectId) : undefined
    return [s?.sortOrder ?? Number.MAX_SAFE_INTEGER, t?.sortOrder ?? Number.MAX_SAFE_INTEGER, a.sortOrder] as const
  }
  return (x: Atom, y: Atom): number => {
    const kx = key(x)
    const ky = key(y)
    for (let i = 0; i < 3; i++) if (kx[i] !== ky[i]) return kx[i]! < ky[i]! ? -1 : 1
    return compareCodePoint(x.id, y.id)
  }
}

export function eligibleNew(ctx: QueueContext): DailyQueueItem[] {
  validateQueueConfig(ctx.config)
  const started = startedToday(ctx.todayAttempts)
  const remainingNew = Math.max(0, ctx.config.newPerDay - started.size)
  const fresh = ctx.atoms.filter((a) => studyable(a) && !ctx.memory.has(a.id)) // pretest edilmiş atom hâlâ başlanmamıştır
  fresh.sort(newOrderComparator(ctx))
  return fresh.slice(0, remainingNew).map((a) => ({ atomId: a.id, reason: 'new', retrievability: null }))
}

/** 03 §3.5: görüntüleme ve tahmin; oturum bu listeyi sırayla tüketmez. */
export function buildQueue(ctx: QueueContext): DailyQueueItem[] {
  return [...eligibleDue(ctx), ...eligibleNew(ctx)]
}

/** 03 §3.3: tanım gereği buildQueue[0]; aynı yardımcılar, aynı sıra. */
export function selectNext(ctx: QueueContext): DailyQueueItem | null {
  return buildQueue(ctx)[0] ?? null
}

export interface TodayCounts {
  /** due <= now olan aktif atom sayısı (tavan uygulanmadan) */
  review: number
  /** min(başlanmamış çalışılabilir, kalan yeni kotası) */
  new: number
  /** yerel günde void edilmemiş Attempt sayısı */
  doneToday: number
  /** "Başla · N öğe" tahmini */
  queueLength: number
}

/** 03 §7 — Bugün ekranı sayıları (BL-06: tekrar / yeni / bugün yapılan). */
export function todayCounts(ctx: QueueContext): TodayCounts {
  const nowMs = Date.parse(ctx.now)
  const active = ctx.atoms.filter(studyable)
  const review = active.filter((a) => {
    const s = ctx.memory.get(a.id)
    return !!s && Date.parse(s.due) <= nowMs
  }).length
  const remainingNew = Math.max(0, ctx.config.newPerDay - startedToday(ctx.todayAttempts).size)
  const fresh = active.filter((a) => !ctx.memory.has(a.id)).length
  return { review, new: Math.min(fresh, remainingNew), doneToday: ctx.todayAttempts.length, queueLength: buildQueue(ctx).length }
}
