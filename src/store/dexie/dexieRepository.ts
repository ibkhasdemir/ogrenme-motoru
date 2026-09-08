// 06 §2, §5 — DexieRepository: tarayıcı (PWA) gerçekleştirimi. Transaction sınırları 06 §5 tablosuna göre.
import Dexie from 'dexie'
import type {
  Atom, AtomRelation, Attempt, AttemptInput, AttemptVoid, AttemptVoidInput, InboxItem, MemoryHook,
  OptionAtom, Question, QuestionAtom, QuestionRevision, Subject, Topic,
} from '../../domain'
import { isCompleteRevision } from '../../domain'
import type { BackupConfigSection, BackupSnapshot } from '../../engine/backup/types'
import {
  ContentRuleError, planNewQuestion, planRevision, validateOptionAtoms,
  type NewQuestionInput, type QuestionPatch, type ReviseOutcome,
} from '../../engine/question/plan'
import type { ContentErrorRequest } from '../../engine/question/contentError'
import type { IdGenerator } from '../../platform/services'
import { defaultConfig, defaultMeta, type RepositoryTestHooks } from '../memory/memoryRepository'
import {
  AlreadyVoidedError, DuplicateAttemptError, DuplicateRevisionError, NotFoundError, SchemaTooNewError, UnknownAttemptError,
  SCHEMA_VERSION, type MetaKey, type MetaRecord, type QuestionMetaPatch, type ReplaceAllMeta, type Repository,
} from '../repository'
import { MAIN_DB_NAME, MotorDb } from './db'
import type { MigrationHooks } from './migration_v1_v2'

export interface DexieRepositoryOptions {
  name?: string
  ids: IdGenerator
  now: () => string
  migrationHooks?: MigrationHooks
  testHooks?: RepositoryTestHooks
}

const CONFIG_KEYS: (keyof BackupConfigSection)[] = ['evidencePolicy', 'evidencePolicyHistory', 'schedulerConfig', 'schedulerConfigHistory', 'queueConfig']
const META_KEYS: MetaKey[] = ['sequence', 'generationId', 'generationStartSequence', 'schemaVersion', 'lastExternalBackupAt', 'lastExternalBackupSequence', 'lastExternalBackupGenerationId', 'appliedJobId', 'restoreProvenance', 'migrationReport']

export class DexieRepository implements Repository {
  private constructor(
    readonly db: MotorDb,
    private readonly ids: IdGenerator,
    private readonly testHooks: RepositoryTestHooks,
  ) {}

  /**
   * BL-32: Dexie, kurulu DB bildirilen sürümden yüksekse hata vermez, dinamik modda açar ve eksik tabloları ekleyebilir
   * (yazma!). Bu yüzden şema tanımı vermeden salt-okunur ön sonda yapılır; yüksekse MotorDb hiç açılmaz.
   */
  static async probeInstalledSchema(name: string): Promise<{ exists: boolean; verno: number; metaSchemaVersion: number | null }> {
    if (!(await Dexie.exists(name))) return { exists: false, verno: 0, metaSchemaVersion: null }
    const probe = new Dexie(name)
    await probe.open()
    try {
      let metaSchemaVersion: number | null = null
      if (probe.tables.some((t) => t.name === 'meta')) {
        const row = (await probe.table('meta').get('schemaVersion')) as { value?: unknown } | undefined
        if (typeof row?.value === 'number') metaSchemaVersion = row.value
      }
      return { exists: true, verno: Math.floor(probe.verno), metaSchemaVersion }
    } finally {
      probe.close()
    }
  }

  /** Açar, migration'ı çalıştırır (06 §6), daha yeni şemayı reddeder (13 §6.5), eksik meta/config varsayılanlarını yazar. */
  static async open(opts: DexieRepositoryOptions): Promise<DexieRepository> {
    const name = opts.name ?? MAIN_DB_NAME
    const probe = await DexieRepository.probeInstalledSchema(name)
    if (probe.exists && (probe.verno > SCHEMA_VERSION || (probe.metaSchemaVersion ?? 0) > SCHEMA_VERSION)) {
      throw new SchemaTooNewError(Math.max(probe.verno, probe.metaSchemaVersion ?? 0), SCHEMA_VERSION)
    }
    const db = new MotorDb(name, opts.now, opts.migrationHooks ?? {})
    await db.open()
    const repo = new DexieRepository(db, opts.ids, opts.testHooks ?? {})
    await repo.ensureDefaults()
    return repo
  }

  close(): void {
    this.db.close()
  }

  /** Okuma anomalisinde (Motor.recoverStorage) bağlantı yenilenir: kapat + aç. Şema aynı, migration koşmaz, veri değişmez. */
  async reopen(): Promise<void> {
    this.db.close({ disableAutoOpen: false })
    await this.db.open()
  }

  private async ensureDefaults(): Promise<void> {
    await this.db.transaction('rw', this.db.meta, this.db.config, async () => {
      const defaults = defaultMeta(this.ids.newId())
      for (const k of META_KEYS) {
        if (!(await this.db.meta.get(k))) await this.db.meta.put({ key: k, value: defaults[k] })
      }
      const cfg = defaultConfig()
      for (const k of CONFIG_KEYS) {
        if (!(await this.db.config.get(k))) await this.db.config.put({ key: k, value: cfg[k] })
      }
    })
  }

  // --- içerik ---
  listSubjects() { return this.db.subjects.toArray() }
  async putSubject(s: Subject) { await this.db.subjects.put(s) }
  listTopics() { return this.db.topics.toArray() }
  async putTopic(t: Topic) { await this.db.topics.put(t) }
  listAtoms() { return this.db.atoms.toArray() }
  getAtom(id: string) { return this.db.atoms.get(id) }
  async putAtom(a: Atom) { await this.db.atoms.put(a) }
  async archiveAtom(id: string) {
    const n = await this.db.atoms.update(id, { archived: true })
    if (n === 0) throw new NotFoundError(`Atom ${id}`)
  }
  listHooks() { return this.db.hooks.toArray() }
  async putHook(h: MemoryHook) { await this.db.hooks.put(h) }
  listQuestions() { return this.db.questions.toArray() }
  getQuestion(id: string) { return this.db.questions.get(id) }
  async updateQuestionMeta(id: string, patch: QuestionMetaPatch) {
    const n = await this.db.questions.update(id, { ...patch })
    if (n === 0) throw new NotFoundError(`Question ${id}`)
  }
  async archiveQuestion(id: string) { await this.updateQuestionMeta(id, { archived: true }) }

  /** 06 §5 "Soru oluşturma": questions + questionRevisions(v1) + questionAtoms(primary) — tutarlı üçlü. */
  createQuestion(input: NewQuestionInput): Promise<ReviseOutcome> {
    return this.db.transaction('rw', [this.db.atoms, this.db.questions, this.db.questionRevisions, this.db.questionAtoms, this.db.optionAtoms], async () => {
      if (await this.db.questions.get(input.id)) throw new ContentRuleError(`Soru zaten var: ${input.id}`)
      if (!(await this.db.atoms.get(input.primaryAtomId))) throw new NotFoundError(`Atom ${input.primaryAtomId}`)
      const plan = planNewQuestion(input)
      this.testHooks.onReviseStep?.('revision')
      await this.db.questionRevisions.add(plan.revision)
      this.testHooks.onReviseStep?.('question')
      await this.db.questions.add(plan.question)
      this.testHooks.onReviseStep?.('questionAtom')
      await this.db.questionAtoms.bulkAdd(plan.questionAtoms)
      if (plan.optionAtoms.length) await this.db.optionAtoms.bulkAdd(plan.optionAtoms)
      return { question: plan.question, revision: plan.revision, created: true, contextChanged: false }
    })
  }

  /**
   * 06 §5 "Soru semantik düzenleme": tek rw transaction; hiçbir anda Question.primaryAtomId ≠ QuestionAtom(primary) kalmaz.
   * "Cevap anahtarı hata düzeltmesi" (K01): revision ve content_error void'leri birlikte yazılır; yarım kalırsa hiçbiri.
   */
  reviseQuestion(questionId: string, patch: QuestionPatch, now: string, contentError?: ContentErrorRequest): Promise<ReviseOutcome> {
    return this.db.transaction('rw', [this.db.atoms, this.db.questions, this.db.questionRevisions, this.db.questionAtoms, this.db.optionAtoms, this.db.attempts, this.db.voids, this.db.meta], async () => {
      const question = await this.db.questions.get(questionId)
      if (!question) throw new NotFoundError(`Question ${questionId}`)
      const current = await this.db.questionRevisions.get([questionId, question.currentVersion])
      if (!current || !isCompleteRevision(current)) throw new ContentRuleError('Güncel sürüm düzenlenebilir bir içerik taşımıyor')
      if (patch.primaryAtomId && !(await this.db.atoms.get(patch.primaryAtomId))) throw new NotFoundError(`Atom ${patch.primaryAtomId}`)
      const voidTargets = contentError?.attemptIds ?? []
      for (const id of voidTargets) {
        if (!(await this.db.attempts.get(id))) throw new UnknownAttemptError(id)
        if (await this.db.voids.where('targetAttemptId').equals(id).first()) throw new AlreadyVoidedError(id)
      }
      const qas = await this.db.questionAtoms.where('questionId').equals(questionId).toArray()
      const oas = await this.db.optionAtoms.where('questionId').equals(questionId).toArray()
      const plan = planRevision(
        { question, revision: current, secondaryAtomIds: qas.filter((x) => x.role === 'secondary').map((x) => x.atomId), optionAtoms: oas },
        patch, now, () => this.ids.newId(),
      )
      if (!plan.newRevision) return { question, revision: current, created: false, contextChanged: false }
      this.testHooks.onReviseStep?.('revision')
      await this.db.questionRevisions.add(plan.newRevision) // (1) yeni revision
      this.testHooks.onReviseStep?.('question')
      await this.db.questions.put(plan.question) // (2) baş kayıt
      this.testHooks.onReviseStep?.('questionAtom')
      await this.db.questionAtoms.where('questionId').equals(questionId).delete() // (3) primary + secondary
      await this.db.questionAtoms.bulkAdd([
        { questionId, atomId: plan.question.primaryAtomId, role: 'primary' },
        ...plan.keepSecondaryAtomIds.map((atomId) => ({ questionId, atomId, role: 'secondary' as const })),
      ])
      await this.db.optionAtoms.where('questionId').equals(questionId).delete()
      if (plan.keepOptionAtoms.length) await this.db.optionAtoms.bulkAdd(plan.keepOptionAtoms)
      for (const targetAttemptId of voidTargets) {
        const n = await this.bumpSequence()
        await this.db.voids.add({ id: this.ids.newId(), targetAttemptId, sequence: n, timestamp: now, reason: 'content_error', note: contentError!.note })
      }
      return { question: plan.question, revision: plan.newRevision, created: true, contextChanged: plan.contextChanged }
    })
  }

  listRevisions(questionId: string) { return this.db.questionRevisions.where('questionId').equals(questionId).sortBy('version') }
  getRevision(questionId: string, version: number) { return this.db.questionRevisions.get([questionId, version]) }
  async appendRevision(rev: QuestionRevision) {
    await this.db.transaction('rw', this.db.questionRevisions, async () => {
      if (await this.db.questionRevisions.get([rev.questionId, rev.version])) throw new DuplicateRevisionError(rev.questionId, rev.version)
      await this.db.questionRevisions.add(rev)
    })
  }
  listQuestionAtoms() { return this.db.questionAtoms.toArray() }
  setSecondaryAtoms(questionId: string, atomIds: string[]) {
    return this.db.transaction('rw', [this.db.atoms, this.db.questions, this.db.questionAtoms], async () => {
      const q = await this.db.questions.get(questionId)
      if (!q) throw new NotFoundError(`Question ${questionId}`)
      const secondary = [...new Set(atomIds)].filter((a) => a !== q.primaryAtomId)
      for (const a of secondary) if (!(await this.db.atoms.get(a))) throw new NotFoundError(`Atom ${a}`)
      await this.db.questionAtoms.where('questionId').equals(questionId).filter((x) => x.role === 'secondary').delete()
      await this.db.questionAtoms.bulkAdd(secondary.map((atomId) => ({ questionId, atomId, role: 'secondary' as const })))
    })
  }
  listOptionAtoms() { return this.db.optionAtoms.toArray() }
  setOptionAtoms(questionId: string, items: OptionAtom[]) {
    return this.db.transaction('rw', [this.db.atoms, this.db.questions, this.db.questionRevisions, this.db.optionAtoms], async () => {
      const q = await this.db.questions.get(questionId)
      if (!q) throw new NotFoundError(`Question ${questionId}`)
      const rev = await this.db.questionRevisions.get([questionId, q.currentVersion])
      if (!rev || !isCompleteRevision(rev)) throw new ContentRuleError('Güncel sürüm içeriği yok')
      validateOptionAtoms(rev, items)
      for (const oa of items) if (!(await this.db.atoms.get(oa.atomId))) throw new NotFoundError(`Atom ${oa.atomId}`)
      await this.db.optionAtoms.where('questionId').equals(questionId).delete()
      if (items.length) await this.db.optionAtoms.bulkAdd(items)
    })
  }
  listAtomRelations() { return this.db.atomRelations.toArray() }
  listInbox() { return this.db.inbox.toArray() }
  async putInbox(item: InboxItem) { await this.db.inbox.put(item) }
  async putAtomRelation(r: AtomRelation) {
    const all = await this.db.atomRelations.toArray()
    if (all.some((x) => x.fromAtomId === r.fromAtomId && x.toAtomId === r.toAtomId && x.type === r.type)) return
    await this.db.atomRelations.add(r)
  }

  // --- ham olaylar ---
  async listAttempts(): Promise<Attempt[]> {
    return (await this.db.attempts.orderBy('sequence').toArray()).map((a) => Object.freeze(a))
  }

  /** 06 §3: sayaç artışı ve olay yazımı AYNI transaction (I-15); aynı id reddedilir, sayaç tüketilmez (I-20). */
  appendAttempt(a: AttemptInput): Promise<Attempt> {
    return this.db.transaction('rw', [this.db.meta, this.db.attempts], async () => {
      if (await this.db.attempts.get(a.id)) throw new DuplicateAttemptError(a.id)
      const n = await this.bumpSequence()
      this.testHooks.onAppendAttempt?.('afterSequenceWrite')
      const rec = Object.freeze({ ...a, sequence: n }) as Attempt
      await this.db.attempts.add(rec)
      return rec
    })
  }

  async listVoids(): Promise<AttemptVoid[]> {
    return (await this.db.voids.toArray()).sort((a, b) => a.sequence - b.sequence).map((v) => Object.freeze(v))
  }

  appendVoid(v: AttemptVoidInput): Promise<AttemptVoid> {
    return this.db.transaction('rw', [this.db.meta, this.db.attempts, this.db.voids], async () => {
      if (!(await this.db.attempts.get(v.targetAttemptId))) throw new UnknownAttemptError(v.targetAttemptId)
      if (await this.db.voids.where('targetAttemptId').equals(v.targetAttemptId).first()) throw new AlreadyVoidedError(v.targetAttemptId)
      const n = await this.bumpSequence()
      const rec = Object.freeze({ ...v, sequence: n }) as AttemptVoid
      await this.db.voids.add(rec)
      return rec
    })
  }

  async nextSequence(): Promise<number> {
    return ((await this.db.meta.get('sequence'))?.value as number | undefined ?? 0) + 1
  }

  private async bumpSequence(): Promise<number> {
    const cur = ((await this.db.meta.get('sequence'))?.value as number | undefined) ?? 0
    const n = cur + 1
    await this.db.meta.put({ key: 'sequence', value: n })
    return n
  }

  // --- meta / config ---
  async getMeta<K extends MetaKey>(key: K): Promise<MetaRecord[K]> {
    const row = await this.db.meta.get(key)
    return (row ? row.value : null) as MetaRecord[K]
  }
  async setMeta<K extends MetaKey>(key: K, value: MetaRecord[K]) {
    await this.db.meta.put({ key, value })
  }
  async getConfig(): Promise<BackupConfigSection> {
    const rows = await this.db.config.toArray()
    const cfg = defaultConfig()
    for (const r of rows) if ((CONFIG_KEYS as string[]).includes(r.key)) (cfg as unknown as Record<string, unknown>)[r.key] = r.value
    return cfg
  }
  async putConfig(patch: Partial<BackupConfigSection>) {
    await this.db.transaction('rw', this.db.config, async () => {
      for (const k of CONFIG_KEYS) if (patch[k] !== undefined) await this.db.config.put({ key: k, value: patch[k] })
    })
  }

  // --- yedek / kurtarma ---
  private allTables() {
    const d = this.db
    return [d.subjects, d.topics, d.atoms, d.hooks, d.questions, d.questionRevisions, d.questionAtoms, d.optionAtoms, d.atomRelations, d.inbox, d.attempts, d.voids, d.meta, d.config]
  }

  snapshotAll(): Promise<BackupSnapshot> {
    return this.db.transaction('r', this.allTables(), async () => ({
      config: await this.getConfig(),
      content: {
        subjects: await this.db.subjects.toArray(),
        topics: await this.db.topics.toArray(),
        atoms: await this.db.atoms.toArray(),
        hooks: await this.db.hooks.toArray(),
        questions: await this.db.questions.toArray(),
        questionRevisions: await this.db.questionRevisions.toArray(),
        questionAtoms: await this.db.questionAtoms.toArray(),
        optionAtoms: await this.db.optionAtoms.toArray(),
        atomRelations: await this.db.atomRelations.toArray(),
        inbox: await this.db.inbox.toArray(),
      },
      events: {
        attempts: await this.db.attempts.orderBy('sequence').toArray(),
        voids: (await this.db.voids.toArray()).sort((a, b) => a.sequence - b.sequence),
      },
    }))
  }

  /** 06 §8 adım 11: tek atomik transaction; meta.appliedJobId, generationId, generationStartSequence, restoreProvenance aynı transaction'da. */
  replaceAll(s: BackupSnapshot, meta: ReplaceAllMeta): Promise<void> {
    return this.db.transaction('rw', this.allTables(), async () => {
      const d = this.db
      for (const t of [d.subjects, d.topics, d.atoms, d.hooks, d.questions, d.questionRevisions, d.questionAtoms, d.optionAtoms, d.atomRelations, d.inbox, d.attempts, d.voids, d.config]) await t.clear()
      await d.subjects.bulkAdd(s.content.subjects)
      await d.topics.bulkAdd(s.content.topics)
      await d.atoms.bulkAdd(s.content.atoms)
      await d.hooks.bulkAdd(s.content.hooks)
      await d.questions.bulkAdd(s.content.questions)
      await d.questionRevisions.bulkAdd(s.content.questionRevisions)
      await d.questionAtoms.bulkAdd(s.content.questionAtoms)
      await d.optionAtoms.bulkAdd(s.content.optionAtoms)
      await d.atomRelations.bulkAdd(s.content.atomRelations)
      await d.inbox.bulkAdd(s.content.inbox)
      await d.attempts.bulkAdd(s.events.attempts)
      await d.voids.bulkAdd(s.events.voids)
      for (const k of CONFIG_KEYS) await d.config.put({ key: k, value: s.config[k] })
      const maxSeq = Math.max(0, ...s.events.attempts.map((a) => a.sequence), ...s.events.voids.map((v) => v.sequence))
      const metaPatch: Partial<MetaRecord> = {
        sequence: maxSeq,
        generationId: meta.generationId,
        generationStartSequence: maxSeq,
        schemaVersion: SCHEMA_VERSION,
        lastExternalBackupAt: null,
        lastExternalBackupSequence: null,
        lastExternalBackupGenerationId: null,
        appliedJobId: meta.appliedJobId,
        restoreProvenance: meta.restoreProvenance,
      }
      for (const [k, v] of Object.entries(metaPatch)) await d.meta.put({ key: k, value: v })
    })
  }
}
