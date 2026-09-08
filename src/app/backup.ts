// 06 §7, §10, §11; 13 §4 — Yedek alma akışı (uygulama katmanı). Yedek bir dosyadır; birleştirme yok; senkron değil.
import { backupFileName, buildBackup, maxSequence, serializeBackup } from '../engine/backup/build'
import type { BackupFile } from '../engine/backup/types'
import type { BackupFileService, BackupSaveResult, Clock, HashService, IdGenerator } from '../platform/services'
import { SCHEMA_VERSION, type MetaRecord, type Repository } from '../store/repository'

export interface BackupDeps {
  repo: Repository
  clock: Clock
  ids: IdGenerator
  hash: HashService
  appVersion: string
  platform?: string
}

export interface PreparedBackup {
  file: BackupFile
  text: string
  name: string
  /** yedeğin alındığı snapshot'ın max sequence'ı — işaretçi buna bağlanır, kaydetme anına değil (06 §11) */
  snapshotSequence: number
  generationId: string
}

export class BackupIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupIntegrityError'
  }
}

/** 13 §4.4: raw truth eksik yedek üretilemez — olay sayıları snapshotAll ile (ve ikinci okumayla) karşılaştırılır; farklıysa dosya yazılmaz. */
export async function prepareBackup(deps: BackupDeps): Promise<PreparedBackup> {
  const snapshot = await deps.repo.snapshotAll()
  const createdAt = deps.clock.now()
  const backupId = deps.ids.newId()
  const file = await buildBackup(snapshot, { backupId, createdAt, appVersion: deps.appVersion, platform: deps.platform ?? 'pwa' }, deps.hash, SCHEMA_VERSION)
  const attempts = await deps.repo.listAttempts()
  const voids = await deps.repo.listVoids()
  if (file.events.attempts.length !== snapshot.events.attempts.length || file.events.voids.length !== snapshot.events.voids.length) throw new BackupIntegrityError('Yedek olay sayısı snapshot ile uyuşmuyor')
  if (attempts.length < snapshot.events.attempts.length || voids.length < snapshot.events.voids.length) throw new BackupIntegrityError('Depodaki olay sayısı snapshot\'tan az; yedek yazılmadı')
  return {
    file,
    text: serializeBackup(file),
    name: backupFileName(new Date(createdAt), backupId),
    snapshotSequence: maxSequence(snapshot),
    generationId: await deps.repo.getMeta('generationId'),
  }
}

export interface SaveBackupOutcome {
  result: BackupSaveResult
  prepared: PreparedBackup
  /** true ise meta işaretçisi güncellendi ("Yedek alındı") */
  recorded: boolean
}

/** Kaydetme sonucu dört durumdan biri (06 §11): yalnız `saved` işaretçiyi hemen günceller; `initiated` teyit ister. */
export async function saveBackup(deps: BackupDeps, files: BackupFileService): Promise<SaveBackupOutcome> {
  const prepared = await prepareBackup(deps)
  const result = await files.save({ name: prepared.name, content: prepared.text, mime: 'application/json' })
  if (result === 'saved') {
    await recordExternalBackup(deps.repo, prepared, deps.clock.now())
    return { result, prepared, recorded: true }
  }
  return { result, prepared, recorded: false }
}

/** `Kaydettim` teyidi (initiated) veya `saved`: işaretçi snapshot sequence'ına bağlanır. BL-31: nesil değişmişse teyit uygulanmaz. */
export async function recordExternalBackup(repo: Repository, prepared: PreparedBackup, now: string): Promise<boolean> {
  const currentGeneration = await repo.getMeta('generationId')
  if (currentGeneration !== prepared.generationId) return false
  await repo.setMeta('lastExternalBackupAt', now)
  await repo.setMeta('lastExternalBackupSequence', prepared.snapshotSequence)
  await repo.setMeta('lastExternalBackupGenerationId', currentGeneration)
  return true
}

export const REMINDER_DAYS = 7
export const REMINDER_EVENTS = 250
const DAY_MS = 24 * 60 * 60_000

export interface BackupReminder {
  /** unknown: işaretçi yok/başka nesle ait → "Yedek durumu bilinmiyor · Yedek al" (BL-18) */
  status: 'unknown' | 'ok' | 'due'
  daysSince: number | null
  newEvents: number
  lastBackupAt: string | null
}

/** 06 §10 — 7 gün VEYA 250 yeni ham olay; negatif fark asla üretilmez (B-36); kurtarma noktası yazmak sayacı değiştirmez. */
export function backupReminder(meta: Pick<MetaRecord, 'sequence' | 'generationId' | 'generationStartSequence' | 'lastExternalBackupAt' | 'lastExternalBackupSequence' | 'lastExternalBackupGenerationId'>, now: string, firstAttemptAt: string | null): BackupReminder {
  const pointerValid = meta.lastExternalBackupAt !== null && meta.lastExternalBackupSequence !== null && meta.lastExternalBackupGenerationId === meta.generationId
  if (!pointerValid) {
    // hiç yedek yok / geri yükleme sonrası: fark nesil başından
    const newEvents = Math.max(0, meta.sequence - meta.generationStartSequence)
    const daysSince = firstAttemptAt ? Math.floor((Date.parse(now) - Date.parse(firstAttemptAt)) / DAY_MS) : null
    const due = newEvents >= REMINDER_EVENTS || (daysSince !== null && daysSince >= REMINDER_DAYS)
    return { status: due ? 'due' : 'unknown', daysSince, newEvents, lastBackupAt: null }
  }
  const newEvents = Math.max(0, meta.sequence - (meta.lastExternalBackupSequence ?? 0))
  const daysSince = Math.max(0, Math.floor((Date.parse(now) - Date.parse(meta.lastExternalBackupAt!)) / DAY_MS))
  const due = newEvents >= REMINDER_EVENTS || daysSince >= REMINDER_DAYS
  return { status: due ? 'due' : 'ok', daysSince, newEvents, lastBackupAt: meta.lastExternalBackupAt }
}
