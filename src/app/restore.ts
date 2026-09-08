// 06 §8, §8.4–8.6; 13 §5 — Güvenli geri yükleme (iki aşamalı): hazırlık ana DB'ye dokunmaz; commit tek atomik replaceAll;
// RestoreJournal + pin'li ön nokta; doğrulama; acil geri dönüş TEK deneme. Bozuk yedek aktif veriyi asla değiştirmez.
import type { RecoveryCounts } from '../store/recovery/recoveryStore'
import type { RestoreJournal, RestoreJournalEntry } from '../store/recovery/journal'
import { canonicalJson, sortSnapshotArrays } from '../engine/backup/canonical'
import { dryRunRebuild, normalizeSnapshot } from '../engine/backup/dryRun'
import { maxSequence } from '../engine/backup/build'
import type { BackupSnapshot } from '../engine/backup/types'
import { validateBackupText } from '../engine/backup/validate'
import { rebuild, serializeMemory, type Memory } from '../engine/rebuild/rebuild'
import type { SchedulerConfig } from '../domain'
import { clockSkewReport, type ClockSkewReport } from './clockSkew'
import { writeRecoveryPoint, type RecoveryDeps } from './recoveryPoints'

export interface RestoreDeps extends RecoveryDeps {
  journal: RestoreJournal
  installedConfig: SchedulerConfig
  /** test kancaları: commit sonrası hata enjeksiyonu (B-13, B-29), doğrulama öncesi ham kaydı bozma */
  hooks?: {
    afterCommit?: () => Promise<void> | void
    beforeVerify?: () => Promise<void> | void
  }
}

export type RestoreSource = { kind: 'file'; text: string } | { kind: 'point'; pointId: string }

export interface RestoreSummary {
  createdAt: string
  appVersion: string
  schemaVersion: number
  backupFormatVersion: number
  counts: RecoveryCounts
  warnings: string[]
  schedulerCompatible: boolean
}

export interface PreparedRestore {
  ok: true
  source: RestoreSource
  normalized: BackupSnapshot
  dryRunMemory: Memory
  summary: RestoreSummary
  skew: ClockSkewReport
  backupId: string
  sourceSchemaVersion: number
  sourceFormatVersion: number
}

export interface RestoreRejected {
  ok: false
  errors: string[]
  warnings: string[]
}

export type RestoreOutcome =
  | { ok: true; jobId: string; verified: RecoveryCounts; warnings: string[] }
  | { ok: false; stage: 'pre_point' | 'commit' | 'verify'; error: string; rolledBack: boolean; lockdown: boolean; jobId: string | null }

/** 06 §8 adım 1–8 (dry-run): parse → matris → checksum → migration → yapısal → normalize → dry-run REBUILD → değişmezler → özet. Ana DB'ye dokunulmaz. */
export async function prepareRestore(deps: RestoreDeps, source: RestoreSource): Promise<PreparedRestore | RestoreRejected> {
  let text: string
  if (source.kind === 'file') text = source.text
  else {
    const p = await deps.recovery.get(source.pointId)
    if (!p) return { ok: false, errors: ['Kurtarma noktası bulunamadı'], warnings: [] }
    text = p.payload
  }
  const now = deps.clock.now()
  const v = await validateBackupText(text, deps.hash, now)
  if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings }
  // yalnız taşınabilir kesit (config + content + events); başlık/checksum/derived depoya girmez
  const pure: BackupSnapshot = { config: v.file.config, content: v.file.content, events: v.file.events }
  const norm = normalizeSnapshot(pure, deps.installedConfig, now) // 5b
  let dryRun: Memory
  try {
    dryRun = dryRunRebuild(norm.snapshot).memory // 6
  } catch (e) {
    return { ok: false, errors: [`Deneme hesabı başarısız: ${(e as Error).message}`], warnings: v.warnings }
  }
  const inv = checkInvariants(norm.snapshot) // 7
  if (inv.length) return { ok: false, errors: inv, warnings: v.warnings }
  const warnings = [...v.warnings, ...norm.warnings]
  const skew = clockSkewReport(norm.snapshot.events.attempts, norm.snapshot.events.voids, dryRun, now)
  if (skew.warning) warnings.push(`Cihaz saati tutarsız görünüyor: ${skew.futureDated.length} kayıt ileri tarihli`)
  return {
    ok: true,
    source,
    normalized: norm.snapshot,
    dryRunMemory: dryRun,
    summary: {
      createdAt: v.file.createdAt,
      appVersion: v.file.appVersion,
      schemaVersion: v.file.schemaVersion,
      backupFormatVersion: v.original.backupFormatVersion,
      counts: countsOf(norm.snapshot),
      warnings,
      schedulerCompatible: norm.compatible,
    },
    skew,
    backupId: v.file.backupId,
    sourceSchemaVersion: v.original.schemaVersion,
    sourceFormatVersion: v.original.backupFormatVersion,
  }
}

function countsOf(s: BackupSnapshot): RecoveryCounts {
  return { atoms: s.content.atoms.length, questions: s.content.questions.length, attempts: s.events.attempts.length, voids: s.events.voids.length }
}

/** 06 §8 adım 7: sequence benzersiz, her Question için currentVersion revision'ı var, primary tutarlılığı. */
export function checkInvariants(s: BackupSnapshot): string[] {
  const errors: string[] = []
  const seqs = new Set<number>()
  for (const x of [...s.events.attempts, ...s.events.voids]) {
    if (seqs.has(x.sequence)) errors.push(`Tekrarlı sequence: ${x.sequence}`)
    seqs.add(x.sequence)
  }
  for (const q of s.content.questions) {
    const cur = s.content.questionRevisions.find((r) => r.questionId === q.id && r.version === q.currentVersion)
    if (!cur) errors.push(`Soru ${q.id}: currentVersion revision'ı yok`)
    else if (cur.primaryAtomId !== q.primaryAtomId) errors.push(`Soru ${q.id}: primaryAtomId ≠ currentRevision.primaryAtomId`)
    const primary = s.content.questionAtoms.filter((qa) => qa.questionId === q.id && qa.role === 'primary')
    if (primary.length !== 1 || primary[0]!.atomId !== q.primaryAtomId) errors.push(`Soru ${q.id}: QuestionAtom(primary) eksik veya farklı`)
  }
  return errors
}

/** Karşılaştırma için resolvedWeights normalize edilir: paket taşıyor, depoya aynen yazılıyor → eşit; taşımıyorsa eşitlik yine kanonik. */
function canonicalOf(s: BackupSnapshot): string {
  return canonicalJson(sortSnapshotArrays(s))
}

/** 06 §8 adım 9–16 — kullanıcı onayından sonra. */
export async function commitRestore(deps: RestoreDeps, prepared: PreparedRestore): Promise<RestoreOutcome> {
  const jobId = deps.ids.newId()
  const now = () => deps.clock.now()
  const kind = prepared.source.kind === 'point' ? 'recovery_point_restore' : 'restore'
  await deps.journal.put({ jobId, kind, phase: 'prepared', targetSummary: prepared.summary.counts, prePointId: null, startedAt: now(), updatedAt: now() }) // 9
  // 10 — mevcut durumdan pre_restore noktası; yazılamazsa DURUR (aborted); hedef nokta da pin'lenir
  let prePointId: string
  try {
    if (prepared.source.kind === 'point') await deps.recovery.pin(prepared.source.pointId, jobId)
    prePointId = (await writeRecoveryPoint(deps, 'pre_restore', jobId)).id
    await deps.journal.update(jobId, { prePointId, updatedAt: now() })
  } catch (e) {
    await safe(() => deps.journal.update(jobId, { phase: 'aborted', updatedAt: now() }))
    await safe(() => deps.recovery.unpinJob(jobId))
    return { ok: false, stage: 'pre_point', error: `Kurtarma noktası yazılamadı: ${(e as Error).message}`, rolledBack: false, lockdown: false, jobId }
  }
  // 11 — tek atomik transaction; meta.appliedJobId aynı transaction'da
  try {
    await deps.repo.replaceAll(prepared.normalized, {
      appliedJobId: jobId,
      generationId: deps.ids.newId(),
      restoreProvenance: { sourceSchemaVersion: prepared.sourceSchemaVersion, sourceFormatVersion: prepared.sourceFormatVersion, backupId: prepared.backupId, restoredAt: now() },
    })
  } catch (e) {
    await safe(() => deps.journal.update(jobId, { phase: 'aborted', updatedAt: now() }))
    await safe(() => deps.recovery.unpinJob(jobId))
    return { ok: false, stage: 'commit', error: `Geri yükleme yazılamadı; mevcut verine dokunulmadı: ${(e as Error).message}`, rolledBack: false, lockdown: false, jobId }
  }
  await safe(() => deps.journal.update(jobId, { phase: 'committed', updatedAt: now() })) // 12
  // 13–14 — REBUILD + doğrulama; hata → acil geri dönüş
  try {
    if (deps.hooks?.afterCommit) await deps.hooks.afterCommit()
    await verifyCommitted(deps, prepared.normalized, prepared.dryRunMemory)
  } catch (e) {
    return emergencyRollback(deps, jobId, prePointId, (e as Error).message)
  }
  await safe(() => deps.journal.update(jobId, { phase: 'verified', updatedAt: now() })) // 15
  await safe(() => deps.recovery.unpinJob(jobId))
  return { ok: true, jobId, verified: prepared.summary.counts, warnings: prepared.summary.warnings }
}

/** 06 §8 adım 14: serializeMemory(post) === serializeMemory(dryRun); depodaki ham olaylar/içerik normalizedSnapshot ile kanonik eşit; sayaç = max sequence. */
async function verifyCommitted(deps: RestoreDeps, normalized: BackupSnapshot, dryRunMemory: Memory | null): Promise<void> {
  if (deps.hooks?.beforeVerify) await deps.hooks.beforeVerify()
  const post = await deps.repo.snapshotAll()
  const postMemory = rebuild(post.events.attempts, post.events.voids, post.config.evidencePolicy, post.config.schedulerConfig).memory
  if (dryRunMemory && serializeMemory(postMemory) !== serializeMemory(dryRunMemory)) throw new Error('Doğrulama: hafıza durumu deneme hesabıyla eşleşmiyor')
  if (canonicalOf(post) !== canonicalOf(normalized)) throw new Error('Doğrulama: depodaki veri yedekle kanonik olarak eşit değil')
  const expectedNext = maxSequence(normalized) + 1
  if ((await deps.repo.nextSequence()) !== expectedNext) throw new Error('Doğrulama: sayaç max sequence ile uyuşmuyor')
}

/**
 * 06 §8.6 — Acil geri dönüş ≠ kullanıcı geri yüklemesi: yeni nokta üretmez; journal'daki pin'li ön noktadan TEK deneme;
 * başarısızsa yazma-kilitli kurtarma ekranı (lockdown). Başarı ana DB'nin doğrulanmasıyla ölçülür; journal yazılamazsa bile başarılı (BL-29).
 */
export async function emergencyRollback(deps: RestoreDeps, jobId: string, prePointId: string, reason: string): Promise<RestoreOutcome> {
  try {
    const point = await deps.recovery.get(prePointId)
    if (!point) throw new Error('Ön nokta bulunamadı')
    const v = await validateBackupText(point.payload, deps.hash, deps.clock.now())
    if (!v.ok) throw new Error(`Ön nokta doğrulanamadı: ${v.errors[0]}`)
    const snapshot: BackupSnapshot = { config: v.file.config, content: v.file.content, events: v.file.events }
    await deps.repo.replaceAll(snapshot, {
      appliedJobId: `${jobId}:rollback`,
      generationId: deps.ids.newId(),
      restoreProvenance: { sourceSchemaVersion: v.original.schemaVersion, sourceFormatVersion: v.original.backupFormatVersion, backupId: v.file.backupId, restoredAt: deps.clock.now() },
    })
    await verifyCommitted(deps, snapshot, null)
    await safe(() => deps.journal.update(jobId, { phase: 'rolled_back', updatedAt: deps.clock.now() }))
    await safe(() => deps.recovery.unpinJob(jobId))
    return { ok: false, stage: 'verify', error: reason, rolledBack: true, lockdown: false, jobId }
  } catch (e) {
    return { ok: false, stage: 'verify', error: `${reason}; geri dönüş de başarısız: ${(e as Error).message}`, rolledBack: false, lockdown: true, jobId }
  }
}

/**
 * 06 §8.5 — Açılış çözümlemesi (BL-27): tamamlanmamış iş varsa normal çalışma başlamaz.
 * appliedJobId ≠ jobId → aborted (eski veri yerinde); = jobId → commit olmuş sayılır, REBUILD + değişmezler + sayaç ile doğrulanır (BL-07);
 * = jobId:rollback → rolled_back. Pin'ler kalkar.
 */
export async function resolveOpenJobs(deps: RestoreDeps): Promise<{ resolved: RestoreJournalEntry[]; lockdown: boolean }> {
  const open = await deps.journal.listOpen()
  const resolved: RestoreJournalEntry[] = []
  let lockdown = false
  for (const job of open) {
    const applied = await deps.repo.getMeta('appliedJobId')
    if (applied === `${job.jobId}:rollback`) {
      await deps.journal.update(job.jobId, { phase: 'rolled_back', updatedAt: deps.clock.now() })
    } else if (applied !== job.jobId) {
      await deps.journal.update(job.jobId, { phase: 'aborted', updatedAt: deps.clock.now() })
    } else {
      await deps.journal.update(job.jobId, { phase: 'committed', updatedAt: deps.clock.now() })
      try {
        const post = await deps.repo.snapshotAll()
        rebuild(post.events.attempts, post.events.voids, post.config.evidencePolicy, post.config.schedulerConfig) // hatasız
        const inv = checkInvariants(post)
        if (inv.length) throw new Error(inv[0])
        if ((await deps.repo.nextSequence()) !== maxSequence(post) + 1) throw new Error('Sayaç max sequence ile uyuşmuyor')
        await deps.journal.update(job.jobId, { phase: 'verified', updatedAt: deps.clock.now() })
      } catch (e) {
        if (!job.prePointId) { lockdown = true; continue }
        const out = await emergencyRollback(deps, job.jobId, job.prePointId, (e as Error).message)
        if (out.ok === false && out.lockdown) lockdown = true
      }
    }
    await safe(() => deps.recovery.unpinJob(job.jobId))
    const entry = await deps.journal.get(job.jobId)
    if (entry) resolved.push(entry)
  }
  return { resolved, lockdown }
}

/** 07 S12 "Tüm veriyi sıfırla": iki onay UI'da; burada pre_reset noktası ZORUNLU, journal ile. */
export async function resetAllData(deps: RestoreDeps): Promise<RestoreOutcome> {
  const empty: BackupSnapshot = {
    config: await deps.repo.getConfig(),
    content: { subjects: [], topics: [], atoms: [], hooks: [], questions: [], questionRevisions: [], questionAtoms: [], optionAtoms: [], atomRelations: [], inbox: [] },
    events: { attempts: [], voids: [] },
  }
  const prepared: PreparedRestore = {
    ok: true,
    source: { kind: 'file', text: '' },
    normalized: empty,
    dryRunMemory: new Map(),
    summary: { createdAt: deps.clock.now(), appVersion: deps.appVersion, schemaVersion: 2, backupFormatVersion: 2, counts: countsOf(empty), warnings: [], schedulerCompatible: true },
    skew: { futureDated: [], behindEvents: 0, lastReviewAhead: 0, warning: false },
    backupId: 'reset',
    sourceSchemaVersion: 2,
    sourceFormatVersion: 2,
  }
  return commitRestoreAs(deps, prepared, 'reset')
}

async function commitRestoreAs(deps: RestoreDeps, prepared: PreparedRestore, kind: 'reset'): Promise<RestoreOutcome> {
  const jobId = deps.ids.newId()
  const now = () => deps.clock.now()
  await deps.journal.put({ jobId, kind, phase: 'prepared', targetSummary: prepared.summary.counts, prePointId: null, startedAt: now(), updatedAt: now() })
  let prePointId: string
  try {
    prePointId = (await writeRecoveryPoint(deps, 'pre_reset', jobId)).id
    await deps.journal.update(jobId, { prePointId, updatedAt: now() })
  } catch (e) {
    await safe(() => deps.journal.update(jobId, { phase: 'aborted', updatedAt: now() }))
    return { ok: false, stage: 'pre_point', error: `Kurtarma noktası yazılamadı: ${(e as Error).message}`, rolledBack: false, lockdown: false, jobId }
  }
  try {
    await deps.repo.replaceAll(prepared.normalized, { appliedJobId: jobId, generationId: deps.ids.newId(), restoreProvenance: { sourceSchemaVersion: 2, sourceFormatVersion: 2, backupId: 'reset', restoredAt: now() } })
  } catch (e) {
    await safe(() => deps.journal.update(jobId, { phase: 'aborted', updatedAt: now() }))
    await safe(() => deps.recovery.unpinJob(jobId))
    return { ok: false, stage: 'commit', error: (e as Error).message, rolledBack: false, lockdown: false, jobId }
  }
  await safe(() => deps.journal.update(jobId, { phase: 'committed', updatedAt: now() }))
  try {
    await verifyCommitted(deps, prepared.normalized, prepared.dryRunMemory)
  } catch (e) {
    return emergencyRollback(deps, jobId, prePointId, (e as Error).message)
  }
  await safe(() => deps.journal.update(jobId, { phase: 'verified', updatedAt: now() }))
  await safe(() => deps.recovery.unpinJob(jobId))
  return { ok: true, jobId, verified: prepared.summary.counts, warnings: [] }
}

async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch {
    // journal/pin yazımı başarısız olsa da ana DB'nin durumu belirleyicidir (BL-29)
  }
}
