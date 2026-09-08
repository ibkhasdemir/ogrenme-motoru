// 06 §8 adım 5b–6 / §8.4 — Normalize edilmiş snapshot ve dry-run REBUILD (bellekte, depoya dokunmaz).
import type { SchedulerConfig } from '../../domain'
import { rebuild, type RebuildResult } from '../rebuild/rebuild'
import { INSTALLED_ENGINE, isCompatible, withResolvedWeights } from '../scheduler/adapter'
import type { BackupSnapshot, HistoryRecord } from './types'

export interface NormalizeResult {
  snapshot: BackupSnapshot
  compatible: boolean
  /** REBUILD ve commit bu config ile yapılır */
  activeConfig: SchedulerConfig
  warnings: string[]
}

const TUNABLE_KEYS: (keyof SchedulerConfig)[] = ['requestRetention', 'maximumInterval', 'enableShortTerm', 'learningSteps', 'relearningSteps', 'weights']

/**
 * 06 §8.4: scheduler uyumluysa normalize kimliktir (paketin config'i aktif kalır; fark varsa uyarı, I-18/B-18).
 * Uyumsuzsa paketin config'i history'ye `config_snapshot` olarak arşivlenir, `scheduler_migration` kaydı eklenir ve aktif
 * config = kurulu uygulamanın gerçekten kullandığı config (kendi configVersion + resolvedWeights) olur (B-19). Ham olaylar ve
 * içerik olduğu gibi kalır; hiçbir zaman kaybolmaz (02 §4.1).
 */
export function normalizeSnapshot(snapshot: BackupSnapshot, installed: SchedulerConfig, now: string): NormalizeResult {
  const pkg = snapshot.config.schedulerConfig
  const warnings: string[] = []
  if (isCompatible(pkg, INSTALLED_ENGINE)) {
    const differs = TUNABLE_KEYS.some((k) => JSON.stringify(pkg[k]) !== JSON.stringify(installed[k])) || pkg.configVersion !== installed.configVersion
    if (differs) warnings.push('Yedeğin zamanlayıcı ayarı kurulu uygulamadan farklı; hafıza durumu paketin ayarıyla yeniden hesaplanacak.')
    return { snapshot, compatible: true, activeConfig: pkg, warnings }
  }
  const active = withResolvedWeights(installed)
  const history: HistoryRecord[] = [
    ...snapshot.config.schedulerConfigHistory,
    { kind: 'config_snapshot', at: now, configVersion: pkg.configVersion, config: { ...pkg } as unknown as Record<string, unknown> },
    {
      kind: 'scheduler_migration',
      at: now,
      from: { engine: pkg.engine, engineVersion: pkg.engineVersion, configVersion: pkg.configVersion },
      to: { engine: active.engine, engineVersion: active.engineVersion, configVersion: active.configVersion },
      reason: 'scheduler_migration',
    },
  ]
  warnings.push(`Farklı zamanlayıcı sürümü (${pkg.engine} ${pkg.engineVersion}, ${pkg.algorithm}): hafıza durumu kurulu motorla yeniden hesaplanacak; ham geçmiş ve içerik olduğu gibi yüklenir.`)
  return {
    snapshot: { ...snapshot, config: { ...snapshot.config, schedulerConfig: active, schedulerConfigHistory: history } },
    compatible: false,
    activeConfig: active,
    warnings,
  }
}

/** 06 §8 adım 6: bellekte REBUILD, normalizedSnapshot'ın aktif config'i ile. Hata → geri yükleme reddedilir. */
export function dryRunRebuild(normalized: BackupSnapshot): RebuildResult {
  return rebuild(normalized.events.attempts, normalized.events.voids, normalized.config.evidencePolicy, normalized.config.schedulerConfig)
}
