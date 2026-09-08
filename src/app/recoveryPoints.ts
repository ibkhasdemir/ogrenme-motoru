// 06 §9, 13 §3 — Kurtarma noktası politikası (uygulama katmanı). Cihaz içi; cihaz dışı yedek DEĞİLDİR.
// Otomatik: yıkıcı işlem öncesi (pre_restore/pre_import/pre_reset — zorunlu), migration öncesi (mümkünse) ve sonrası (zorunlu), günün ilk değişikliği (daily).
import { prepareBackup, type BackupDeps } from './backup'
import { localDayKey } from '../engine/queue/dailyQueue'
import type { BackupFile } from '../engine/backup/types'
import type { RecoveryDump } from '../store/recovery/recoveryReader'
import type { RecoveryPointRecord, RecoveryReason, RecoveryStore } from '../store/recovery/recoveryStore'
import { SCHEMA_VERSION } from '../store/repository'

export interface RecoveryDeps extends BackupDeps {
  recovery: RecoveryStore
}

/** Mevcut durumdan tam yedek payload'ı ile nokta yazar; pinnedBy verilirse retention onu silemez. */
export async function writeRecoveryPoint(deps: RecoveryDeps, reason: RecoveryReason, pinnedBy: string | null = null): Promise<RecoveryPointRecord> {
  const prepared = await prepareBackup(deps)
  const rec: RecoveryPointRecord = {
    id: deps.ids.newId(),
    createdAt: deps.clock.now(),
    reason,
    appVersion: deps.appVersion,
    schemaVersion: SCHEMA_VERSION,
    counts: {
      atoms: prepared.file.content.atoms.length,
      questions: prepared.file.content.questions.length,
      attempts: prepared.file.events.attempts.length,
      voids: prepared.file.events.voids.length,
    },
    payload: prepared.text,
    pinnedBy,
  }
  await deps.recovery.write(rec)
  return rec
}

/** Günün ilk değişikliğinde bir `daily` nokta (yerel gün). Yazıldıysa true. */
export async function ensureDailyPoint(deps: RecoveryDeps): Promise<boolean> {
  const today = localDayKey(deps.clock.now())
  const existing = (await deps.recovery.list()).some((p) => p.reason === 'daily' && localDayKey(p.createdAt) === today)
  if (existing) return false
  await writeRecoveryPoint(deps, 'daily')
  return true
}

/** 06 §6.1: migration başarılı ilk açılışta `post_migration` noktası ZORUNLU (B-26). Rapor yoksa veya nokta zaten varsa yazmaz. */
export async function ensurePostMigrationPoint(deps: RecoveryDeps): Promise<boolean> {
  const report = await deps.repo.getMeta('migrationReport')
  if (!report) return false
  const existing = (await deps.recovery.list()).some((p) => p.reason === 'post_migration' && p.schemaVersion === report.toSchemaVersion && Date.parse(p.createdAt) >= Date.parse(report.migratedAt))
  if (existing) return false
  await writeRecoveryPoint(deps, 'post_migration')
  return true
}

/**
 * 06 §6.1 / §6.3: migration ÖNCESİ nokta — eski şemayı kurtarma okuyucusuyla (şema tanımsız, salt-okunur) döküp
 * format-1 yedek dosyası olarak saklar. Bu payload normal geri yüklemede migrateBackup zinciriyle okunur (B-37).
 */
export function legacyDumpToFormat1Backup(dump: RecoveryDump, header: { backupId: string; createdAt: string; appVersion: string }): BackupFile {
  const t = (name: string) => (dump.tables[name] ?? []) as never[]
  const configRows = (dump.tables['config'] ?? []) as { key: string; value: unknown }[]
  const cfg = (key: string) => configRows.find((r) => r.key === key)?.value
  return {
    backupFormatVersion: 1,
    backupId: header.backupId,
    createdAt: header.createdAt,
    appVersion: header.appVersion,
    schemaVersion: 1,
    platform: 'pwa',
    config: {
      evidencePolicy: (cfg('evidencePolicy') as never) ?? { policyVersion: 1 },
      evidencePolicyHistory: (cfg('evidencePolicyHistory') as never) ?? [],
      schedulerConfig: (cfg('schedulerConfig') as never) ?? { configVersion: 1, engine: 'ts-fsrs', engineVersion: '5.4.2', algorithm: 'FSRS-6', requestRetention: 0.9, maximumInterval: 365, enableFuzz: false, enableShortTerm: true, learningSteps: ['1m', '10m'], relearningSteps: ['10m'], weights: null },
      schedulerConfigHistory: (cfg('schedulerConfigHistory') as never) ?? [],
      queueConfig: (cfg('queueConfig') as never) ?? { reviewCap: 25, newPerDay: 10 },
    },
    content: {
      subjects: t('subjects'), topics: t('topics'), atoms: t('atoms'), hooks: t('hooks'), questions: t('questions'), questionRevisions: [],
      questionAtoms: t('questionAtoms'), optionAtoms: t('optionAtoms'), atomRelations: t('atomRelations'), inbox: t('inbox'),
    },
    events: { attempts: t('attempts'), voids: t('voids') },
    derived: null,
  }
}

export async function writePreMigrationPoint(deps: Omit<RecoveryDeps, 'repo'>, dump: RecoveryDump): Promise<RecoveryPointRecord> {
  const file = legacyDumpToFormat1Backup(dump, { backupId: deps.ids.newId(), createdAt: deps.clock.now(), appVersion: deps.appVersion })
  const rec: RecoveryPointRecord = {
    id: deps.ids.newId(),
    createdAt: deps.clock.now(),
    reason: 'pre_migration',
    appVersion: deps.appVersion,
    schemaVersion: dump.observedSchemaVersion,
    counts: { atoms: file.content.atoms.length, questions: file.content.questions.length, attempts: file.events.attempts.length, voids: file.events.voids.length },
    payload: JSON.stringify(file),
    pinnedBy: null,
  }
  await deps.recovery.write(rec)
  return rec
}
