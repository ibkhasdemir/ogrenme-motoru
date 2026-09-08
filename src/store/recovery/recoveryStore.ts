// 06 §9 — Local Recovery Snapshot: cihaz içi kurtarma noktası. Cihaz dışı yedek DEĞİLDİR.
import type { RecoveryDb } from './recoveryDb'

export const RECOVERY_REASONS = ['pre_restore', 'pre_import', 'pre_reset', 'pre_migration', 'post_migration', 'daily', 'manual'] as const
export type RecoveryReason = (typeof RECOVERY_REASONS)[number]

export interface RecoveryCounts {
  atoms: number
  questions: number
  attempts: number
  voids: number
}

export interface RecoveryPointRecord {
  id: string
  createdAt: string
  reason: RecoveryReason
  appVersion: string
  schemaVersion: number
  counts: RecoveryCounts
  /** 06 §7 formatındaki tam yedek (string). */
  payload: string
  /** aktif işin ön noktası veya hedef nokta; retention pin'li kaydı silemez. */
  pinnedBy: string | null
}

export type RetentionClass = 'operational' | 'daily'

/** 06 §9: işlem sınıfı en fazla 5, günlük sınıf en fazla 7, toplam 12 (BL-30: v0'da sabit config). */
export interface RetentionLimits {
  operational: number
  daily: number
  total: number
}

export const RETENTION_DEFAULT: RetentionLimits = { operational: 5, daily: 7, total: 12 }

export interface RecoveryStore {
  /** createdAt ASC, id ASC */
  list(): Promise<RecoveryPointRecord[]>
  get(id: string): Promise<RecoveryPointRecord | undefined>
  /** Ekler ve retention uygular. Kota hatasında en eski pin'siz daily silinip bir kez yeniden denenir; yine olmazsa fırlatır. */
  write(record: RecoveryPointRecord): Promise<void>
  pin(id: string, jobId: string): Promise<void>
  unpinJob(jobId: string): Promise<void>
}

export interface DexieRecoveryStoreOptions {
  limits?: RetentionLimits
  /** test kancası: put öncesi çağrılır (kota hatası simülasyonu, B-12/B-32). */
  putHook?: (record: RecoveryPointRecord) => Promise<void>
}

export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; message?: string; inner?: { name?: string } } | undefined
  if (!err) return false
  return err.name === 'QuotaExceededError' || err.inner?.name === 'QuotaExceededError' || /quota/i.test(err.message ?? '')
}

function byCreatedThenId(a: RecoveryPointRecord, b: RecoveryPointRecord): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
}

export class DexieRecoveryStore implements RecoveryStore {
  private readonly limits: RetentionLimits

  constructor(
    private readonly db: RecoveryDb,
    private readonly opts: DexieRecoveryStoreOptions = {},
  ) {
    this.limits = opts.limits ?? RETENTION_DEFAULT
  }

  classOf(reason: RecoveryReason): RetentionClass {
    return reason === 'daily' ? 'daily' : 'operational'
  }

  async list(): Promise<RecoveryPointRecord[]> {
    const all = await this.db.snapshots.toArray()
    return all.sort(byCreatedThenId)
  }

  get(id: string): Promise<RecoveryPointRecord | undefined> {
    return this.db.snapshots.get(id)
  }

  async write(record: RecoveryPointRecord): Promise<void> {
    try {
      await this.putWithRetention(record)
    } catch (e) {
      if (!isQuotaError(e)) throw e
      // 06 §9: kota hatasında en eski pin'siz daily silinip yeniden denenir
      const victim = (await this.list()).find((p) => p.reason === 'daily' && p.pinnedBy === null)
      if (!victim) throw e
      await this.db.snapshots.delete(victim.id)
      await this.putWithRetention(record)
    }
  }

  async pin(id: string, jobId: string): Promise<void> {
    const n = await this.db.snapshots.update(id, { pinnedBy: jobId })
    if (n === 0) throw new Error(`Kurtarma noktası bulunamadı: ${id}`)
  }

  /** İş bitince pinler kalkar ve retention normal uygulanır (06 §9, B-34). */
  async unpinJob(jobId: string): Promise<void> {
    await this.db.transaction('rw', this.db.snapshots, async () => {
      await this.db.snapshots.where('pinnedBy').equals(jobId).modify({ pinnedBy: null })
      await this.applyRetentionTx()
    })
  }

  private async putWithRetention(record: RecoveryPointRecord): Promise<void> {
    await this.db.transaction('rw', this.db.snapshots, async () => {
      if (this.opts.putHook) await this.opts.putHook(record)
      await this.db.snapshots.put(record)
      await this.applyRetentionTx()
    })
  }

  /** Yeni yazılınca aynı sınıfın pin'siz en eskisi silinir (B-28); pin'li kayıt sayısı sınırı geçici olarak aşabilir (B-34). */
  private async applyRetentionTx(): Promise<void> {
    const all = (await this.db.snapshots.toArray()).sort(byCreatedThenId)
    const toDelete: string[] = []
    for (const cls of ['operational', 'daily'] as RetentionClass[]) {
      const items = all.filter((p) => this.classOf(p.reason) === cls)
      const excess = items.length - this.limits[cls]
      if (excess <= 0) continue
      const unpinned = items.filter((p) => p.pinnedBy === null)
      toDelete.push(...unpinned.slice(0, Math.min(excess, unpinned.length)).map((p) => p.id))
    }
    const remaining = all.filter((p) => !toDelete.includes(p.id))
    const totalExcess = remaining.length - this.limits.total
    if (totalExcess > 0) {
      const unpinned = remaining.filter((p) => p.pinnedBy === null)
      toDelete.push(...unpinned.slice(0, Math.min(totalExcess, unpinned.length)).map((p) => p.id))
    }
    if (toDelete.length > 0) await this.db.snapshots.bulkDelete(toDelete)
  }
}
