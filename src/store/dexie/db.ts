// 06 §6 — Dexie şeması. schemaVersion 1 (legacy, BL-10 varsayımı) → 2 (QuestionRevision). Wipe yok; migration transaction'ı
// başarısızsa eski DB olduğu gibi kalır (06 §6.1, 13 §6.2).
import Dexie, { type Table, type Transaction } from 'dexie'
import type {
  Atom, AtomRelation, Attempt, AttemptVoid, InboxItem, MemoryHook, OptionAtom, Question, QuestionAtom, QuestionRevision,
  Subject, Topic,
} from '../../domain'
import { migrateV1ToV2, type MigrationHooks } from './migration_v1_v2'

export const MAIN_DB_NAME = 'ogrenme-motoru'

export interface KeyValueRow {
  key: string
  value: unknown
}

/** schemaVersion 1 — soru tek tabloda `version` alanıyla; eski sürüm metni yok (06 §6.2). */
export const LEGACY_V1_STORES: Record<string, string> = {
  subjects: 'id',
  topics: 'id, subjectId',
  atoms: 'id, topicId',
  hooks: 'id, atomId',
  questions: 'id, primaryAtomId',
  questionAtoms: '[questionId+atomId], questionId, atomId',
  optionAtoms: '[questionId+optionId+atomId], questionId',
  atomRelations: '[fromAtomId+toAtomId+type], fromAtomId, toAtomId',
  inbox: 'id',
  attempts: 'id, sequence, primaryAtomIdAtAttempt',
  voids: 'id, targetAttemptId',
  meta: 'key',
  config: 'key',
}

/** schemaVersion 2 — questionRevisions eklendi; questions'ta currentVersion/updatedAt (içerik alanları kaldırıldı). */
export const V2_STORES: Record<string, string> = {
  ...LEGACY_V1_STORES,
  questionRevisions: '[questionId+version], questionId',
}

export class MotorDb extends Dexie {
  subjects!: Table<Subject, string>
  topics!: Table<Topic, string>
  atoms!: Table<Atom, string>
  hooks!: Table<MemoryHook, string>
  questions!: Table<Question, string>
  questionRevisions!: Table<QuestionRevision, [string, number]>
  questionAtoms!: Table<QuestionAtom, [string, string]>
  optionAtoms!: Table<OptionAtom, [string, string, string]>
  atomRelations!: Table<AtomRelation, [string, string, string]>
  inbox!: Table<InboxItem, string>
  attempts!: Table<Attempt, string>
  voids!: Table<AttemptVoid, string>
  meta!: Table<KeyValueRow, string>
  config!: Table<KeyValueRow, string>

  constructor(name: string, now: () => string, migrationHooks: MigrationHooks = {}) {
    super(name)
    this.version(1).stores(LEGACY_V1_STORES)
    this.version(2)
      .stores(V2_STORES)
      .upgrade((tx: Transaction) => migrateV1ToV2(tx, now(), migrationHooks))
  }
}
