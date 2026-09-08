// 06 §9 — Kurtarma noktaları ayrı veritabanındadır (`ogrenme-motoru-recovery`); ana DB'nin replaceAll'u buna dokunmaz.
// 06 §8.5 — RestoreJournal da bu depodadır (ana DB'den ayrı).
import Dexie, { type Table } from 'dexie'
import type { RecoveryPointRecord } from './recoveryStore'
import type { RestoreJournalEntry } from './journal'

export const RECOVERY_DB_NAME = 'ogrenme-motoru-recovery'

export class RecoveryDb extends Dexie {
  snapshots!: Table<RecoveryPointRecord, string>
  journal!: Table<RestoreJournalEntry, string>

  constructor(name: string = RECOVERY_DB_NAME) {
    super(name)
    this.version(1).stores({
      snapshots: 'id, createdAt, reason, pinnedBy',
      journal: 'jobId, phase',
    })
  }
}
