// 06 §6.3 — Kurtarma okuyucusu: veritabanını şema tanımı vermeden, salt-okunur açar (Dexie dynamic mode; version() çağrılmaz,
// migration tetiklenmez, hiçbir şey yazılmaz) ve gördüğü tüm tabloları olduğu gibi döker.
import Dexie from 'dexie'

export interface RecoveryDump {
  kind: 'recovery_dump'
  dbName: string
  observedSchemaVersion: number
  dumpedAt: string
  tables: Record<string, unknown[]>
}

export async function readRecoveryDump(dbName: string, now: string): Promise<RecoveryDump> {
  const db = new Dexie(dbName)
  await db.open()
  try {
    const tables: Record<string, unknown[]> = {}
    for (const t of db.tables) tables[t.name] = await t.toArray()
    const metaRows = (tables['meta'] ?? []) as { key?: string; value?: unknown }[]
    const schemaRow = metaRows.find((r) => r.key === 'schemaVersion')
    const observed = typeof schemaRow?.value === 'number' ? schemaRow.value : db.verno
    return { kind: 'recovery_dump', dbName, observedSchemaVersion: observed, dumpedAt: now, tables }
  } finally {
    db.close()
  }
}

/** 06 §6.3: dosya adı `ogrenme-motoru-recovery-dump-…json`; normal yedek DEĞİLDİR. */
export function recoveryDumpFileName(localStamp: string): string {
  return `ogrenme-motoru-recovery-dump-${localStamp}.json`
}
