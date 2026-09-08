// 06 §8.5 — Kalıcı geri yükleme günlüğü (RestoreJournal). Ana veriyi değiştiren transaction `meta.appliedJobId`'yi
// atomik yazar; journal fazı ayrı yazımdır (açılış çözümlemesi: BL-27).
import type { RecoveryDb } from './recoveryDb'
import type { RecoveryCounts } from './recoveryStore'

export type RestoreJobKind = 'restore' | 'recovery_point_restore' | 'reset'
export type RestoreJobPhase = 'prepared' | 'committed' | 'verified' | 'rolled_back' | 'aborted'

export const OPEN_PHASES: readonly RestoreJobPhase[] = ['prepared', 'committed']

export interface RestoreJournalEntry {
  jobId: string
  kind: RestoreJobKind
  phase: RestoreJobPhase
  targetSummary: RecoveryCounts | null
  prePointId: string | null
  startedAt: string
  updatedAt: string
}

export interface RestoreJournal {
  put(entry: RestoreJournalEntry): Promise<void>
  get(jobId: string): Promise<RestoreJournalEntry | undefined>
  update(jobId: string, patch: Partial<Omit<RestoreJournalEntry, 'jobId'>>): Promise<void>
  /** verified / rolled_back / aborted olmayan işler (açılışta çözümlenir). */
  listOpen(): Promise<RestoreJournalEntry[]>
}

export class DexieRestoreJournal implements RestoreJournal {
  constructor(private readonly db: RecoveryDb) {}

  async put(entry: RestoreJournalEntry): Promise<void> {
    await this.db.journal.put(entry)
  }

  get(jobId: string): Promise<RestoreJournalEntry | undefined> {
    return this.db.journal.get(jobId)
  }

  async update(jobId: string, patch: Partial<Omit<RestoreJournalEntry, 'jobId'>>): Promise<void> {
    const n = await this.db.journal.update(jobId, patch)
    if (n === 0) throw new Error(`Journal kaydı bulunamadı: ${jobId}`)
  }

  async listOpen(): Promise<RestoreJournalEntry[]> {
    const all = await this.db.journal.toArray()
    return all
      .filter((e) => OPEN_PHASES.includes(e.phase))
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
  }
}
