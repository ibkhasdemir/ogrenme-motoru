// Motor cephesi (09 Phase 8b) — uygulama katmanı: Repository + PlatformServices arayüzleri üzerinden motoru bir araya getirir.
// Yazma sırası: önce disk (raw), sonra bellek (derived) — 06 §5. Türetilmiş durum diske yazılmaz; açılışta REBUILD (06 §4).
import type {
  Atom, AtomFacet, Attempt, AttemptVoid, CompleteQuestionRevision, Confidence, DailyQueueItem, EvidencePolicy, HookType,
  LearningAction, MemoryHook, OptionAtomRelation, Question, QuestionAttempt, QuestionRevision, QueueConfig, RecallAttempt,
  SchedulerConfig, SelfAssessment, Subject, Topic, WrongReason,
} from '../domain'
import { isCompleteRevision } from '../domain'
import { AttemptBuildError, buildQuestionAttempt, buildRecallAttempt } from '../engine/attempts/build'
import { compareCodePoint } from '../engine/backup/canonical'
import type { ContentErrorRequest } from '../engine/question/contentError'
import type { NewQuestionInput, QuestionPatch, ReviseOutcome } from '../engine/question/plan'
import { buildQueue, todayAttempts, todayCounts, validateQueueConfig, type QueueContext, type TodayCounts } from '../engine/queue/dailyQueue'
import { applyAttempt, rebuild, type Memory } from '../engine/rebuild/rebuild'
import { resolve } from '../engine/resolver/resolve'
import { createScheduler, type Scheduler } from '../engine/scheduler/adapter'
import { Session, type UndoToken } from '../engine/session/session'
import { undoAttempt } from '../engine/session/undo'
import type { Clock, IdGenerator } from '../platform/services'
import type { Repository } from '../store/repository'
import { clockSkewReport, type ClockSkewReport } from './clockSkew'

/** 03 §6.4 — oturum sonunda "N atom 15 dakika içinde yeniden gelecek" (app katmanı sabiti, BL-24). */
export const DUE_SOON_MS = 15 * 60_000

export interface MotorDeps {
  repo: Repository
  clock: Clock
  ids: IdGenerator
  /** her yazmadan önce (günün ilk değişikliğinde daily kurtarma noktası, 06 §9); hatası yazmayı engellemez */
  beforeWrite?: () => Promise<void>
  /** depo okuma anomalisinde (sequence geriledi / olay varken içerik boş) bağlantıyı yenile (ör. Dexie kapat+aç); bir kez denenir */
  recoverStorage?: () => Promise<void>
}

export interface ContentCache {
  subjects: Subject[]
  topics: Topic[]
  atoms: Atom[]
  hooks: MemoryHook[]
  questions: Question[]
}

export type Presentation =
  | { kind: 'end'; reason: 'budget' | 'empty'; dueSoon: number }
  | { kind: 'read'; item: DailyQueueItem; atom: Atom; hooks: MemoryHook[]; topic: Topic | undefined; subject: Subject | undefined }
  | { kind: 'question'; action: Extract<LearningAction, { kind: 'question' }>; question: Question; revision: CompleteQuestionRevision; atom: Atom; hooks: MemoryHook[]; topic: Topic | undefined; subject: Subject | undefined; replayOfAttemptId?: string }
  | { kind: 'recall'; action: Extract<LearningAction, { kind: 'recall' }>; atom: Atom; hooks: MemoryHook[]; topic: Topic | undefined; subject: Subject | undefined; replayOfAttemptId?: string }

export interface QuestionAnswerInput {
  initialSelectedOptionId: string
  selectedOptionId: string
  confidence: Confidence
  wrongReason?: WrongReason
  responseTimeMs: number
}

export interface RecallAnswerInput {
  selfAssessment: SelfAssessment
  hookShown: boolean
  responseTimeMs: number
}

export interface TodaySummary {
  counts: TodayCounts
  queue: DailyQueueItem[]
  dueSoon: number
  skew: ClockSkewReport
}

export interface NewAtomInput {
  subjectName: string
  topicName: string
  text: string
  prompt: string
  facets?: AtomFacet[]
  why?: string
  how?: string
  hooks?: { type: HookType; content: string }[]
}

export interface NewQuestionFormInput {
  primaryAtomId: string
  source: string
  text: string
  options: string[]
  correctIndex: number
  secondaryAtomIds?: string[]
  optionAtoms?: { optionIndex: number; atomId: string; relation: OptionAtomRelation }[]
  trapType?: string
  questionType?: string
}

export class MotorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MotorError'
  }
}

/** A21 / 06 §5: depo bilinen durumdan geriye okunuyor; bellek korunur, hiçbir şey yazılmaz. Kullanıcıya açık mesaj. */
export class StorageReadAnomalyError extends Error {
  constructor(detail: string) {
    super(`Depo geçici olarak okunamadı (${detail}). Verin silinmedi; uygulamayı tamamen kapatıp yeniden aç.`)
    this.name = 'StorageReadAnomalyError'
  }
}

export class Motor {
  memory: Memory = new Map()
  policy!: EvidencePolicy
  schedulerConfig!: SchedulerConfig
  queueConfig!: QueueConfig
  scheduler!: Scheduler
  private attempts: Attempt[] = []
  private voids: AttemptVoid[] = []
  private lastKnownSequence = 0

  private constructor(
    readonly repo: Repository,
    readonly clock: Clock,
    readonly ids: IdGenerator,
    private readonly beforeWriteHook?: () => Promise<void>,
    private readonly recoverStorageHook?: () => Promise<void>,
  ) {}

  static async create(deps: MotorDeps): Promise<Motor> {
    const m = new Motor(deps.repo, deps.clock, deps.ids, deps.beforeWrite, deps.recoverStorage)
    await m.refresh()
    return m
  }

  private async beforeWrite(): Promise<void> {
    if (!this.beforeWriteHook) return
    try {
      await this.beforeWriteHook()
    } catch {
      // kurtarma noktası yazılamaması öğrenme kaydını engellemez (raw truth önce)
    }
  }

  /** Açılış / "Hafızayı yeniden hesapla": config + ham olaylar depodan, tam REBUILD bellekte (A4 her açılışta doğrulanır). */
  async refresh(): Promise<void> {
    const cfg = await this.repo.getConfig()
    this.policy = cfg.evidencePolicy
    this.schedulerConfig = cfg.schedulerConfig
    this.queueConfig = cfg.queueConfig
    this.scheduler = createScheduler(this.schedulerConfig)
    this.attempts = await this.repo.listAttempts()
    this.voids = await this.repo.listVoids()
    this.memory = rebuild(this.attempts, this.voids, this.policy, this.schedulerConfig).memory
    this.lastKnownSequence = (await this.repo.nextSequence()) - 1
  }

  /**
   * 06 §5 çoklu bağlam: meta.sequence bilinenden büyükse olaylar yeniden yüklenir ve REBUILD yapılır (I-21).
   * Aynı depoda sequence geri gitmez (yalnız eklenir). Gerileme = okuma anomalisi (iPhone bulgusu: arka plandan dönüşte IndexedDB
   * boş/eski okundu, ekran 0/0/0 oldu) ya da başka bağlamda geri yükleme. Bellek korunur; depo yeniden açılıp bir kez daha okunur,
   * yine geriyse açık hata — sessizce boş REBUILD yapılmaz (A21).
   */
  async checkExternalChanges(): Promise<boolean> {
    let seq = (await this.repo.nextSequence()) - 1
    if (seq < this.lastKnownSequence) {
      await this.recoverStorage()
      seq = (await this.repo.nextSequence()) - 1
      if (seq < this.lastKnownSequence) throw new StorageReadAnomalyError(`kayıt sırası ${seq} < bilinen ${this.lastKnownSequence}`)
    }
    if (seq === this.lastKnownSequence) return false
    await this.refresh()
    return true
  }

  private async recoverStorage(): Promise<void> {
    if (!this.recoverStorageHook) return
    try {
      await this.recoverStorageHook()
    } catch {
      // yeniden açma başarısızsa ikinci okuma karar verir
    }
  }

  listAttempts(): readonly Attempt[] { return this.attempts }
  listVoids(): readonly AttemptVoid[] { return this.voids }

  /** Attempt atoma bağlıdır ve atom silinmez (yalnız arşivlenir): olay varken atom listesi boş okunamaz → okuma anomalisi (aynı kural). */
  async content(): Promise<ContentCache> {
    let c = await this.readContent()
    if (!c.atoms.length && this.attempts.length) {
      await this.recoverStorage()
      c = await this.readContent()
      if (!c.atoms.length) throw new StorageReadAnomalyError(`${this.attempts.length} öğrenme kaydı var, atom listesi boş okundu`)
    }
    return c
  }

  private async readContent(): Promise<ContentCache> {
    const [subjects, topics, atoms, hooks, questions] = await Promise.all([
      this.repo.listSubjects(), this.repo.listTopics(), this.repo.listAtoms(), this.repo.listHooks(), this.repo.listQuestions(),
    ])
    return { subjects, topics, atoms, hooks, questions }
  }

  async queueContext(now: string = this.clock.now()): Promise<QueueContext> {
    const c = await this.content()
    return {
      atoms: c.atoms, topics: c.topics, subjects: c.subjects, memory: this.memory, scheduler: this.scheduler, now, config: this.queueConfig,
      todayAttempts: todayAttempts(this.attempts, this.voids, now),
    }
  }

  dueSoonCount(ctx: QueueContext): number {
    const nowMs = Date.parse(ctx.now)
    let n = 0
    for (const a of ctx.atoms) {
      if (a.archived || !a.prompt.trim()) continue
      const s = this.memory.get(a.id)
      if (!s) continue
      const due = Date.parse(s.due)
      if (due > nowMs && due <= nowMs + DUE_SOON_MS) n++
    }
    return n
  }

  async today(): Promise<TodaySummary> {
    await this.checkExternalChanges()
    const ctx = await this.queueContext()
    return { counts: todayCounts(ctx), queue: buildQueue(ctx), dueSoon: this.dueSoonCount(ctx), skew: clockSkewReport(this.attempts, this.voids, this.memory, ctx.now) }
  }

  startSession(budgetMs: number | null): Session {
    return new Session(this.ids, this.clock, budgetMs)
  }

  /** 03 §6.2 nextItem: bütçe → tekrar sunumu → selectNext; new → okuma ekranı (A11), due → resolve. */
  async next(session: Session): Promise<Presentation> {
    await this.checkExternalChanges()
    const ctx = await this.queueContext()
    const n = session.nextItem(ctx)
    if (n.kind === 'end') return { kind: 'end', reason: n.reason, dueSoon: this.dueSoonCount(ctx) }
    const c = await this.content()
    if (n.kind === 'replay') return this.present(n.action, c, n.replayOfAttemptId)
    const atom = c.atoms.find((a) => a.id === n.item.atomId)
    if (!atom) throw new MotorError(`Atom bulunamadı: ${n.item.atomId}`)
    if (n.item.reason === 'new') {
      const { topic, subject } = this.place(atom, c)
      return { kind: 'read', item: n.item, atom, hooks: c.hooks.filter((h) => h.atomId === atom.id), topic, subject }
    }
    return this.present(await this.resolveAtom(atom.id, c), c)
  }

  /** "Okudum, sına beni" → ilk deneme sunumu (03 §6.2). */
  async presentAtom(atomId: string): Promise<Presentation> {
    const c = await this.content()
    return this.present(await this.resolveAtom(atomId, c), c)
  }

  private async resolveAtom(atomId: string, c: ContentCache): Promise<LearningAction> {
    const revs = new Map<string, QuestionRevision>()
    const own = c.questions.filter((q) => q.primaryAtomId === atomId && !q.archived)
    for (const q of own) {
      const r = await this.repo.getRevision(q.id, q.currentVersion)
      if (r) revs.set(`${q.id} ${q.currentVersion}`, r)
    }
    return resolve({ atomId, questions: c.questions, revisionOf: (qid, v) => revs.get(`${qid} ${v}`), attempts: this.attempts, memory: this.memory, ids: this.ids })
  }

  private place(atom: Atom, c: ContentCache): { topic: Topic | undefined; subject: Subject | undefined } {
    const topic = c.topics.find((t) => t.id === atom.topicId)
    const subject = topic ? c.subjects.find((s) => s.id === topic.subjectId) : undefined
    return { topic, subject }
  }

  private async present(action: LearningAction, c: ContentCache, replayOfAttemptId?: string): Promise<Presentation> {
    if (action.kind === 'recall') {
      const atom = c.atoms.find((a) => a.id === action.atomId)
      if (!atom) throw new MotorError(`Atom bulunamadı: ${action.atomId}`)
      const { topic, subject } = this.place(atom, c)
      return { kind: 'recall', action, atom, hooks: c.hooks.filter((h) => h.atomId === atom.id), topic, subject, ...(replayOfAttemptId ? { replayOfAttemptId } : {}) }
    }
    const question = c.questions.find((q) => q.id === action.questionId)
    const revision = await this.repo.getRevision(action.questionId, action.questionVersion)
    if (!question || !revision) throw new MotorError(`Soru bulunamadı: ${action.questionId} v${action.questionVersion}`)
    if (!isCompleteRevision(revision)) throw new MotorError('Bu sürümün içeriği mevcut değil; soru sunulamaz (01 §4.2a)')
    const atom = c.atoms.find((a) => a.id === revision.primaryAtomId)
    if (!atom) throw new MotorError(`Atom bulunamadı: ${revision.primaryAtomId}`)
    const { topic, subject } = this.place(atom, c)
    return { kind: 'question', action, question, revision, atom, hooks: c.hooks.filter((h) => h.atomId === atom.id), topic, subject, ...(replayOfAttemptId ? { replayOfAttemptId } : {}) }
  }

  /** 02 §6 anlık akış: Attempt kur → appendAttempt (tek işlem) → applyAttempt (bellek) → undoToken. */
  async answerQuestion(session: Session, p: Extract<Presentation, { kind: 'question' }>, input: QuestionAnswerInput): Promise<{ attempt: QuestionAttempt; token: UndoToken | null }> {
    await this.checkExternalChanges()
    await this.beforeWrite()
    const built = buildQuestionAttempt(
      { action: p.action, revision: p.revision, initialSelectedOptionId: input.initialSelectedOptionId, selectedOptionId: input.selectedOptionId, confidence: input.confidence, ...(input.wrongReason ? { wrongReason: input.wrongReason } : {}), responseTimeMs: input.responseTimeMs },
      { sessionId: session.sessionId, timestamp: this.clock.now(), memoryHasAtom: this.memory.has(p.revision.primaryAtomId), ...(p.replayOfAttemptId ? { replayOfAttemptId: p.replayOfAttemptId } : {}) },
    )
    const stored = (await this.repo.appendAttempt(built)) as QuestionAttempt
    this.commitAttempt(stored)
    return { attempt: stored, token: session.recordAttempt(stored, p.action) }
  }

  async answerRecall(session: Session, p: Extract<Presentation, { kind: 'recall' }>, input: RecallAnswerInput): Promise<{ attempt: RecallAttempt; token: UndoToken | null }> {
    await this.checkExternalChanges()
    await this.beforeWrite()
    const built = buildRecallAttempt(
      { action: p.action, selfAssessment: input.selfAssessment, hookShown: input.hookShown, responseTimeMs: input.responseTimeMs },
      { sessionId: session.sessionId, timestamp: this.clock.now(), memoryHasAtom: this.memory.has(p.action.atomId), ...(p.replayOfAttemptId ? { replayOfAttemptId: p.replayOfAttemptId } : {}) },
    )
    const stored = (await this.repo.appendAttempt(built)) as RecallAttempt
    this.commitAttempt(stored)
    return { attempt: stored, token: session.recordAttempt(stored, p.action) }
  }

  private commitAttempt(stored: Attempt): void {
    applyAttempt(this.memory, stored, this.policy, this.scheduler) // disk sonrası bellek
    this.attempts.push(stored)
    this.lastKnownSequence = Math.max(this.lastKnownSequence, stored.sequence)
  }

  /** 02 §7 / 03 §6.5: sabit hedef; süresi geçmiş/tüketilmiş → false, hiçbir şey olmaz. */
  async undo(session: Session, token: UndoToken): Promise<boolean> {
    const out = await undoAttempt(session, token, { repo: this.repo, clock: this.clock, ids: this.ids, policy: this.policy, config: this.schedulerConfig })
    if (!out) return false
    this.voids.push(out.void)
    this.lastKnownSequence = Math.max(this.lastKnownSequence, out.void.sequence)
    this.memory = out.rebuilt.memory
    return true
  }

  // --- içerik girişi (07 S9, S10) ---

  async addAtom(input: NewAtomInput): Promise<Atom> {
    await this.beforeWrite()
    const text = input.text.trim()
    const prompt = input.prompt.trim()
    if (!text || !prompt) throw new MotorError('Atom metni ve soru yüzü boş olamaz.')
    const subjectName = input.subjectName.trim()
    const topicName = input.topicName.trim()
    if (!subjectName || !topicName) throw new MotorError('Ders ve konu gerekli.')
    const c = await this.content()
    const norm = (s: string) => s.trim().toLocaleLowerCase('tr')
    let subject = c.subjects.find((s) => norm(s.name) === norm(subjectName))
    if (!subject) {
      subject = { id: this.ids.newId(), name: subjectName, sortOrder: Math.max(0, ...c.subjects.map((s) => s.sortOrder)) + 1 }
      await this.repo.putSubject(subject)
    }
    const sid = subject.id
    let topic = c.topics.find((t) => t.subjectId === sid && norm(t.name) === norm(topicName))
    if (!topic) {
      topic = { id: this.ids.newId(), subjectId: sid, name: topicName, sortOrder: Math.max(0, ...c.topics.filter((t) => t.subjectId === sid).map((t) => t.sortOrder)) + 1 }
      await this.repo.putTopic(topic)
    }
    const tid = topic.id
    const atom: Atom = {
      id: this.ids.newId(),
      topicId: tid,
      text,
      prompt,
      facets: input.facets && input.facets.length ? [...new Set(input.facets)] : ['fact'],
      sortOrder: Math.max(0, ...c.atoms.filter((a) => a.topicId === tid).map((a) => a.sortOrder)) + 1,
      archived: false,
      createdAt: this.clock.now(),
      ...(input.why?.trim() ? { why: input.why.trim() } : {}),
      ...(input.how?.trim() ? { how: input.how.trim() } : {}),
    }
    await this.repo.putAtom(atom)
    for (const h of input.hooks ?? []) {
      if (!h.content.trim()) continue
      await this.repo.putHook({ id: this.ids.newId(), atomId: atom.id, type: h.type, content: h.content.trim() })
    }
    return atom
  }

  /** 07 S10: beş zorunlu alan; "+ Gelişmiş" isteğe bağlı. */
  /**
   * Konu adını değiştirir (BL-39: "Ünite › Alt başlık"). Aynı derste aynı adlı konu varsa BİRLEŞTİRİR: atomlar hedefe taşınır,
   * kaynak konu boş kalır (silinmez; içerik listesi atom üzerinden çalıştığı için görünmez). Attempt'ler atoma bağlıdır,
   * öğrenme geçmişi ve vadeler etkilenmez.
   */
  async renameTopic(topicId: string, newName: string): Promise<{ topicId: string; merged: boolean; movedAtoms: number }> {
    await this.beforeWrite()
    const name = newName.trim()
    if (!name) throw new MotorError('Konu adı boş olamaz.')
    const c = await this.content()
    const topic = c.topics.find((t) => t.id === topicId)
    if (!topic) throw new MotorError(`Konu bulunamadı: ${topicId}`)
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')
    const target = c.topics.find((t) => t.id !== topicId && t.subjectId === topic.subjectId && norm(t.name) === norm(name))
    if (!target) {
      if (topic.name === name) return { topicId, merged: false, movedAtoms: 0 }
      await this.repo.putTopic({ ...topic, name })
      return { topicId, merged: false, movedAtoms: 0 }
    }
    const moving = c.atoms.filter((a) => a.topicId === topicId)
    for (const a of moving) await this.repo.putAtom({ ...a, topicId: target.id })
    // kaynak konu boş kalır; adı hedefinkiyle (hedefin yazımıyla) eşitlenir ki sonraki içe aktarma eski adı görüp ayrı grup diriltmesin
    await this.repo.putTopic({ ...topic, name: target.name })
    return { topicId: target.id, merged: true, movedAtoms: moving.length }
  }

  /** Mevcut atoma çengel ekler (içe aktarma "cengeller" bölümü, BL-38). Aynı metinli çengel varsa yeniden eklenmez → false. */
  async addHook(atomId: string, hook: { type: HookType; content: string }): Promise<boolean> {
    await this.beforeWrite()
    const content = hook.content.trim()
    if (!content) throw new MotorError('Çengel metni boş olamaz.')
    const c = await this.content()
    if (!c.atoms.some((a) => a.id === atomId)) throw new MotorError(`Atom bulunamadı: ${atomId}`)
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')
    if (c.hooks.some((h) => h.atomId === atomId && norm(h.content) === norm(content))) return false
    await this.repo.putHook({ id: this.ids.newId(), atomId, type: hook.type, content })
    return true
  }

  async addQuestion(input: NewQuestionFormInput): Promise<ReviseOutcome> {
    await this.beforeWrite()
    const texts = input.options.map((o) => o.trim())
    if (texts.length < 2 || texts.some((t) => !t)) throw new MotorError('Beş alan da gerekli: soru, en az iki seçenek, doğru seçenek, ana atom, kaynak.')
    if (!Number.isInteger(input.correctIndex) || input.correctIndex < 0 || input.correctIndex >= texts.length) throw new MotorError('Doğru seçenek işaretlenmeli.')
    if (!input.text.trim() || !input.source.trim() || !input.primaryAtomId) throw new MotorError('Beş alan da gerekli: soru, en az iki seçenek, doğru seçenek, ana atom, kaynak.')
    const options = texts.map((t) => ({ id: this.ids.newId(), text: t }))
    const qid = this.ids.newId()
    const ni: NewQuestionInput = {
      id: qid,
      primaryAtomId: input.primaryAtomId,
      source: input.source.trim(),
      text: input.text.trim(),
      options,
      correctOptionId: options[input.correctIndex]!.id,
      createdAt: this.clock.now(),
      ...(input.trapType?.trim() ? { trapType: input.trapType.trim() } : {}),
      ...(input.questionType?.trim() ? { questionType: input.questionType.trim() } : {}),
      ...(input.secondaryAtomIds?.length ? { secondaryAtomIds: input.secondaryAtomIds } : {}),
      ...(input.optionAtoms?.length ? { optionAtoms: input.optionAtoms.map((oa) => ({ questionId: qid, optionId: options[oa.optionIndex]!.id, atomId: oa.atomId, relation: oa.relation })) } : {}),
    }
    return this.repo.createQuestion(ni)
  }

  async reviseQuestion(questionId: string, patch: QuestionPatch, contentError?: ContentErrorRequest): Promise<ReviseOutcome> {
    await this.beforeWrite()
    const out = await this.repo.reviseQuestion(questionId, patch, this.clock.now(), contentError)
    if (contentError?.attemptIds.length) await this.refresh() // K01: void'ler yazıldı → REBUILD
    return out
  }

  async setQueueConfig(cfg: QueueConfig): Promise<void> {
    validateQueueConfig(cfg)
    await this.repo.putConfig({ queueConfig: cfg })
    this.queueConfig = cfg
  }

  // --- saat tutarsızlığı (06 §3.1) ---

  clockSkew(now: string = this.clock.now()): ClockSkewReport {
    return clockSkewReport(this.attempts, this.voids, this.memory, now)
  }

  /** kullanıcı kararı: ileri tarihli kayıtlar geçersiz kılınır; Attempt silinmez; REBUILD sonrası kırpma o kayıtları görmez. */
  async voidClockSkew(attemptIds: string[]): Promise<void> {
    for (const id of attemptIds) {
      await this.repo.appendVoid({ id: this.ids.newId(), targetAttemptId: id, timestamp: this.clock.now(), reason: 'clock_skew' })
    }
    await this.refresh()
  }

  /** İçerik ekranı yardımcısı: sonraki vade */
  nextDueOf(atomId: string): string | null {
    return this.memory.get(atomId)?.due ?? null
  }

  sortedAtoms(atoms: readonly Atom[], topics: readonly Topic[], subjects: readonly Subject[]): Atom[] {
    const t = new Map(topics.map((x) => [x.id, x]))
    const s = new Map(subjects.map((x) => [x.id, x]))
    return [...atoms].sort((a, b) => {
      const ta = t.get(a.topicId); const tb = t.get(b.topicId)
      const sa = ta ? s.get(ta.subjectId) : undefined; const sb = tb ? s.get(tb.subjectId) : undefined
      return (sa?.sortOrder ?? 0) - (sb?.sortOrder ?? 0) || (ta?.sortOrder ?? 0) - (tb?.sortOrder ?? 0) || a.sortOrder - b.sortOrder || compareCodePoint(a.id, b.id)
    })
  }
}

export { AttemptBuildError }
