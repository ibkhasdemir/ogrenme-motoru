// 06 §7 — Taşınabilir yedek formatı (backupFormatVersion 2). Platformdan bağımsız; motor katmanı (A22).
import type {
  Atom, AtomRelation, Attempt, AttemptVoid, EvidencePolicy, InboxItem, MemoryHook, MemoryState, OptionAtom,
  Question, QuestionAtom, QuestionRevision, QueueConfig, ReviewEvent, SchedulerConfig, Subject, Topic,
} from '../../domain'

export interface EngineRef {
  engine: string
  engineVersion: string
  configVersion: number
}

/** 06 §7 geçmiş kayıt türleri; `at` tek zorunlu zaman anahtarı (BL-02). Policy geçmişi de config_snapshot kullanır. */
export interface ConfigSnapshotRecord {
  kind: 'config_snapshot'
  at: string
  configVersion?: number
  policyVersion?: number
  config?: Record<string, unknown>
  policy?: Record<string, unknown>
}

export interface SchedulerMigrationRecord {
  kind: 'scheduler_migration'
  at: string
  from: EngineRef
  to: EngineRef
  reason: 'scheduler_migration'
}

export type HistoryRecord = ConfigSnapshotRecord | SchedulerMigrationRecord

export interface BackupConfigSection {
  evidencePolicy: EvidencePolicy
  evidencePolicyHistory: HistoryRecord[]
  schedulerConfig: SchedulerConfig
  schedulerConfigHistory: HistoryRecord[]
  queueConfig: QueueConfig
}

export interface BackupContentSection {
  subjects: Subject[]
  topics: Topic[]
  atoms: Atom[]
  hooks: MemoryHook[]
  questions: Question[]
  questionRevisions: QuestionRevision[]
  questionAtoms: QuestionAtom[]
  optionAtoms: OptionAtom[]
  atomRelations: AtomRelation[]
  inbox: InboxItem[]
}

export interface BackupEventsSection {
  attempts: Attempt[]
  voids: AttemptVoid[]
}

/** Depodan `snapshotAll()` ile okunan tam tutarlı kesit: içerik + olaylar + config. Meta girmez (BL-16). */
export interface BackupSnapshot {
  config: BackupConfigSection
  content: BackupContentSection
  events: BackupEventsSection
}

export interface BackupChecksum {
  algorithm: 'sha256'
  value: string
  of: string
}

/** Tek JSON dosyası. `checksum` ve `derived` hash kapsamı dışındadır. */
export interface BackupFile extends BackupSnapshot {
  backupFormatVersion: number
  backupId: string
  createdAt: string
  appVersion: string
  schemaVersion: number
  platform: string
  derived: { memory: MemoryState[]; reviewEvents: ReviewEvent[] } | null
  checksum?: BackupChecksum
}

export const BACKUP_FORMAT_VERSION = 2
export const CHECKSUM_OF = 'canonical(backup without checksum and derived)'
