// 06 §7 — Taşınabilir yedek üretimi (format 2). Raw truth hiçbir zaman eksik yazılamaz; checksum HashService ile.
import type { HashService } from '../../platform/services'
import { withResolvedWeights } from '../scheduler/adapter'
import { sortSnapshotArrays } from './canonical'
import { computeChecksum } from './checksum'
import { BACKUP_FORMAT_VERSION, type BackupFile, type BackupSnapshot } from './types'

export interface BackupHeader {
  backupId: string
  createdAt: string
  appVersion: string
  platform: string
}

/** Snapshot'tan tam yedek dosyası: resolvedWeights eklenir (02 §4), diziler kanonik sırada, derived null, checksum hesaplanır. */
export async function buildBackup(snapshot: BackupSnapshot, header: BackupHeader, hash: HashService, schemaVersion: number): Promise<BackupFile> {
  const sorted = sortSnapshotArrays(snapshot)
  const file: BackupFile = {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    backupId: header.backupId,
    createdAt: header.createdAt,
    appVersion: header.appVersion,
    schemaVersion,
    platform: header.platform,
    config: { ...sorted.config, schedulerConfig: withResolvedWeights(sorted.config.schedulerConfig) },
    content: sorted.content,
    events: sorted.events,
    derived: null,
  }
  file.checksum = await computeChecksum(file, hash)
  return file
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file)
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** 06 §7: `ogrenme-motoru-backup-YYYY-MM-DD-HHmmss-SSS-<backupId8>.json` (yerel saat, milisaniye dâhil). */
export function backupFileName(local: Date, backupId: string): string {
  const stamp = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}-${pad(local.getHours())}${pad(local.getMinutes())}${pad(local.getSeconds())}-${pad(local.getMilliseconds(), 3)}`
  return `ogrenme-motoru-backup-${stamp}-${backupId.replace(/-/g, '').slice(0, 8)}.json`
}

export function maxSequence(snapshot: BackupSnapshot): number {
  return Math.max(0, ...snapshot.events.attempts.map((a) => a.sequence), ...snapshot.events.voids.map((v) => v.sequence))
}
