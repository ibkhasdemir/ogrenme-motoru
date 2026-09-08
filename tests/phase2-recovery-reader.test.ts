import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson } from '../src/engine/backup/canonical'
import { readRecoveryDump, recoveryDumpFileName } from '../src/store/recovery/recoveryReader'
import { legacyFixture, readLegacyV1, seedLegacyV1, uniqueDbName } from './helpers/legacyDb'

// B-37 (Phase 2 kısmı, 06 §6.3): RecoveryReader şema tanımsız açar, DB sürümü/içeriği değişmez, kurtarma dökümü üretir.
// "eski şemadan normal yedek" (migrateBackup) ve "normal geri yükleme dump'ı reddeder" cümleleri Phase 10a/10c'de.

const names: string[] = []
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

describe('RecoveryReader', () => {
  it('eski (v1) şemadan salt-okunur döküm; DB v1 kalır, içerik değişmez', async () => {
    const name = uniqueDbName('rr'); names.push(name)
    const fx = legacyFixture()
    await seedLegacyV1(name, fx)
    const dump = await readRecoveryDump(name, '2026-09-08T12:00:00.000Z')
    expect(dump.kind).toBe('recovery_dump')
    expect(dump.observedSchemaVersion).toBe(1)
    expect(Object.keys(dump.tables).sort()).toEqual(['atomRelations', 'atoms', 'attempts', 'config', 'hooks', 'inbox', 'meta', 'optionAtoms', 'questionAtoms', 'questions', 'subjects', 'topics', 'voids'])
    expect(canonicalJson(dump.tables['attempts'])).toBe(canonicalJson(fx.attempts))
    expect(canonicalJson(dump.tables['questions'])).toBe(canonicalJson(fx.questions))
    const after = await readLegacyV1(name)
    expect(after.verno).toBe(1)
    expect(canonicalJson(after.questions)).toBe(canonicalJson(fx.questions))
  })

  it('daha yeni (bilinmeyen) şemadan döküm: observedSchemaVersion yeni sürüm; tablolar ham; DB değişmez', async () => {
    const name = uniqueDbName('rr-new'); names.push(name)
    const newer = new Dexie(name)
    newer.version(3).stores({ meta: 'key', attempts: 'id, sequence', gelecekTablo: 'id' })
    await newer.open()
    await newer.table('meta').put({ key: 'schemaVersion', value: 3 })
    await newer.table('gelecekTablo').put({ id: 'g-1', x: 1 })
    newer.close()
    const dump = await readRecoveryDump(name, '2026-09-08T12:00:00.000Z')
    expect(dump.observedSchemaVersion).toBe(3)
    expect(dump.tables['gelecekTablo']).toEqual([{ id: 'g-1', x: 1 }])
    const check = new Dexie(name)
    await check.open()
    expect(check.verno).toBe(3)
    check.close()
  })

  it('dosya adı normal yedekten ayrışır', () => {
    expect(recoveryDumpFileName('2026-09-08-120000-000')).toBe('ogrenme-motoru-recovery-dump-2026-09-08-120000-000.json')
  })
})
