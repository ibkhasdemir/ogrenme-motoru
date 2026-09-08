// 06 §2 — Depo sınırı (Repository). Motor doğrudan Dexie/IndexedDB çağırmaz; yalnız bu arayüz (A22).
// Arayüze yalnız gerçekten kullanılan işlemler girer (10 §2). Ham olaylar için update/delete YOK (A3, 11 kural 11).
import type {
  Atom, AtomRelation, Attempt, AttemptInput, AttemptVoid, AttemptVoidInput, InboxItem, MemoryHook,
  OptionAtom, Question, QuestionAtom, QuestionRevision,
} from '../domain'
import type { BackupConfigSection, BackupSnapshot } from '../engine/backup/types'
import type { NewQuestionInput, QuestionPatch, ReviseOutcome } from '../engine/question/plan'

/** Kurulu uygulamanın fiziksel şeması (06 §6). */
export const SCHEMA_VERSION = 2

export interface RestoreProvenance {
  sourceSchemaVersion: number
  sourceFormatVersion: number
  backupId: string
  restoredAt: string
}

/** 06 §3, §10 — cihaz-yerel meta; yedeğe girmez (BL-16). */
export interface MetaRecord {
  sequence: number
  generationId: string
  generationStartSequence: number
  schemaVersion: number
  lastExternalBackupAt: string | null
  lastExternalBackupSequence: number | null
  lastExternalBackupGenerationId: string | null
  appliedJobId: string | null
  restoreProvenance: RestoreProvenance | null
  migrationReport: MigrationReport | null
}

export interface MigrationReport {
  fromSchemaVersion: number
  toSchemaVersion: number
  migratedAt: string
  exactRevisions: number
  contentUnavailableRevisions: number
}

export type MetaKey = keyof MetaRecord

/** 06 §3: geri yükleme yeni bir nesildir; sayaç paketin max sequence'ına kurulur. */
export interface ReplaceAllMeta {
  appliedJobId: string
  generationId: string
  restoreProvenance: RestoreProvenance
}

export class DuplicateAttemptError extends Error {
  constructor(id: string) {
    super(`Attempt zaten var: ${id}`)
    this.name = 'DuplicateAttemptError'
  }
}

export class AlreadyVoidedError extends Error {
  constructor(targetAttemptId: string) {
    super(`Attempt zaten geçersiz kılınmış: ${targetAttemptId}`)
    this.name = 'AlreadyVoidedError'
  }
}

export class UnknownAttemptError extends Error {
  constructor(id: string) {
    super(`Attempt bulunamadı: ${id}`)
    this.name = 'UnknownAttemptError'
  }
}

export class DuplicateRevisionError extends Error {
  constructor(questionId: string, version: number) {
    super(`QuestionRevision zaten var: ${questionId} v${version}`)
    this.name = 'DuplicateRevisionError'
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`Bulunamadı: ${what}`)
    this.name = 'NotFoundError'
  }
}

export class InvalidContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidContentError'
  }
}

/** 13 §6.5 / BL-32: DB kurulu uygulamadan daha yeni şemada → yazma yok, salt-okunur kurtarma yolu. */
export class SchemaTooNewError extends Error {
  constructor(public readonly observed: number, public readonly supported: number) {
    super(`Veritabanı şeması (${observed}) bu uygulamanın desteklediğinden (${supported}) daha yeni`)
    this.name = 'SchemaTooNewError'
  }
}

export interface QuestionMetaPatch {
  source?: string
  trapType?: string
  questionType?: string
  archived?: boolean
}

export interface Repository {
  // --- içerik (06 §2: list*, put* upsert, archive*) ---
  listSubjects(): Promise<Subject[]>
  putSubject(s: Subject): Promise<void>
  listTopics(): Promise<Topic[]>
  putTopic(t: Topic): Promise<void>
  listAtoms(): Promise<Atom[]>
  getAtom(id: string): Promise<Atom | undefined>
  putAtom(a: Atom): Promise<void>
  archiveAtom(id: string): Promise<void>
  listHooks(): Promise<MemoryHook[]>
  putHook(h: MemoryHook): Promise<void>
  listQuestions(): Promise<Question[]>
  getQuestion(id: string): Promise<Question | undefined>
  /** sürüm üretmeyen metadata (01 §2.5: source, trapType, questionType, archived). */
  updateQuestionMeta(id: string, patch: QuestionMetaPatch): Promise<void>
  archiveQuestion(id: string): Promise<void>
  /** 06 §5 "Soru oluşturma": questions + revision v1 + questionAtoms(primary) tek transaction. */
  createQuestion(input: NewQuestionInput): Promise<ReviseOutcome>
  /** 06 §5 "Soru semantik düzenleme": tek transaction; semantik fark yoksa sürüm üretmez. */
  reviseQuestion(questionId: string, patch: QuestionPatch, now: string): Promise<ReviseOutcome>
  listRevisions(questionId: string): Promise<QuestionRevision[]>
  getRevision(questionId: string, version: number): Promise<QuestionRevision | undefined>
  /** yalnız ekler; aynı (questionId, version) ikinci kez → DuplicateRevisionError. */
  appendRevision(rev: QuestionRevision): Promise<void>
  listQuestionAtoms(): Promise<QuestionAtom[]>
  /** "+ Gelişmiş": ikincil atom kümesini güncel sürüm için değiştirir (primary'e dokunmaz). */
  setSecondaryAtoms(questionId: string, atomIds: string[]): Promise<void>
  listOptionAtoms(): Promise<OptionAtom[]>
  /** "+ Gelişmiş": güncel sürüm için OptionAtom kümesini değiştirir; doğru seçenekte ilişki → InvalidContentError (B-27). */
  setOptionAtoms(questionId: string, items: OptionAtom[]): Promise<void>
  listAtomRelations(): Promise<AtomRelation[]>
  listInbox(): Promise<InboxItem[]>

  // --- ham olaylar (06 §2: başka metot yok) ---
  /** sequence ASC */
  listAttempts(): Promise<Attempt[]>
  /** sequence'ı kendi transaction'ında atar (06 §3; BL-15); aynı id → DuplicateAttemptError, sayaç tüketilmez (I-20). */
  appendAttempt(a: AttemptInput): Promise<Attempt>
  listVoids(): Promise<AttemptVoid[]>
  /** hedef yoksa UnknownAttemptError; zaten void ise AlreadyVoidedError (01 §4.6). */
  appendVoid(v: AttemptVoidInput): Promise<AttemptVoid>
  /** salt-okur bakış: bir sonraki sequence (meta.sequence + 1). */
  nextSequence(): Promise<number>

  // --- meta / config ---
  getMeta<K extends MetaKey>(key: K): Promise<MetaRecord[K]>
  setMeta<K extends MetaKey>(key: K, value: MetaRecord[K]): Promise<void>
  getConfig(): Promise<BackupConfigSection>
  putConfig(patch: Partial<BackupConfigSection>): Promise<void>

  // --- yedek / kurtarma (06 §2) ---
  /** tam tutarlı okuma: içerik + olaylar + config. */
  snapshotAll(): Promise<BackupSnapshot>
  /** tek işlemde temizle ve yükle; sayaç = max sequence; yeni nesil; kurtarma deposuna dokunmaz. */
  replaceAll(snapshot: BackupSnapshot, meta: ReplaceAllMeta): Promise<void>
}

// yeniden dışa aktarım: içerik tipleri
import type { Subject, Topic } from '../domain'
export type { Subject, Topic }
