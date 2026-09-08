import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type { Attempt } from '../src/domain'
import { EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1 } from '../src/domain'
import { canonicalJson } from '../src/engine/backup/canonical'
import { rebuild, serializeMemory } from '../src/engine/rebuild/rebuild'
import { DexieRepository } from '../src/store/dexie/dexieRepository'
import { SchemaTooNewError } from '../src/store/repository'
import { legacyFixture, readLegacyV1, seedLegacyV1, testIds, uniqueDbName } from './helpers/legacyDb'

// Phase 2 — schemaVersion 1 → 2 migration (06 §6.2): I-17 (depo kısmı), U-QR-07, U-QR-08, U-QR-09 (API kısmı), U-QR-12, B-26 (rollback kısmı), BL-32.
// REBUILD eşitliği cümleleri Phase 6'da bu fixture ile aynı testlere eklenir.

const NOW = '2026-09-08T12:00:00.000Z'
const names: string[] = []
const open = (name: string, hooks?: { onUpgradeStep?: (s: string) => void }) => DexieRepository.open({ name, ids: testIds(), now: () => NOW, migrationHooks: hooks })

afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

describe('06 §6.2 — migration 1 → 2', () => {
  it('I-17 — v1 DB açılır ve migrate olur; attempts bayt bayt aynı; her sorunun currentVersion exact revision\'ı var; rapor yazılır', async () => {
    const name = uniqueDbName('mig'); names.push(name)
    const fx = legacyFixture()
    await seedLegacyV1(name, fx)
    const before = canonicalJson(fx.attempts)
    const repo = await open(name)
    try {
      expect(await repo.getMeta('schemaVersion')).toBe(2)
      expect(canonicalJson(await repo.listAttempts())).toBe(before)
      const q1 = (await repo.getQuestion('q-1'))!
      const q2 = (await repo.getQuestion('q-2'))!
      expect(q1.currentVersion).toBe(1)
      expect(q2.currentVersion).toBe(3)
      expect(q1 as object).not.toHaveProperty('text')
      expect(q2 as object).not.toHaveProperty('options')
      expect(await repo.getRevision('q-1', 1)).toMatchObject({ integrityStatus: 'complete', text: 'Tanzimat hangi yıl?', correctOptionId: 'o-1', primaryAtomId: 'atm-a' })
      expect(await repo.getRevision('q-2', 3)).toMatchObject({ integrityStatus: 'complete', text: 'Islahat hangi yıl? (v3)', correctOptionId: 'o-2', primaryAtomId: 'atm-b' })
      const report = await repo.getMeta('migrationReport')
      expect(report).toMatchObject({ fromSchemaVersion: 1, toSchemaVersion: 2, exactRevisions: 2, contentUnavailableRevisions: 2 })
      expect(await repo.nextSequence()).toBe(6) // legacy meta.sequence 5 korunur
      // U-QR-07 — current ile aynı sürüm exact kurulur; ek kayıt yok
      expect((await repo.listRevisions('q-1')).map((r) => r.version)).toEqual([1])
      expect((await repo.listRevisions('q-2')).map((r) => r.version)).toEqual([1, 2, 3])
      // Phase 6 cümlesi: REBUILD migration öncesiyle eşit (ham olaylar değişmediği için A4 korunur)
      const memBefore = rebuild(fx.attempts as Attempt[], [], EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
      const memAfter = rebuild(await repo.listAttempts(), await repo.listVoids(), EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
      expect(serializeMemory(memAfter.memory)).toBe(serializeMemory(memBefore.memory))
      expect(memAfter.memory.size).toBe(3)
    } finally {
      repo.close()
    }
  })

  it('U-QR-10 — legacy eksik içerik hafızayı bozmaz: REBUILD migration öncesi ile eşit; Attempt sayısı aynı; primaryAtomIdAtAttempt değişmemiş', async () => {
    const name = uniqueDbName('mig'); names.push(name)
    const fx = legacyFixture()
    await seedLegacyV1(name, fx)
    const before = rebuild(fx.attempts as Attempt[], [], EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
    const repo = await open(name)
    try {
      const attempts = await repo.listAttempts()
      expect(attempts).toHaveLength(fx.attempts.length)
      expect(attempts.map((a) => a.primaryAtomIdAtAttempt)).toEqual((fx.attempts as Attempt[]).map((a) => a.primaryAtomIdAtAttempt))
      const after = rebuild(attempts, await repo.listVoids(), EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
      expect(serializeMemory(after.memory)).toBe(serializeMemory(before.memory))
      // content_unavailable_legacy revision'ları hafıza hesabına girmez; hafıza snapshot atomlarından kurulur (atm-c dâhil)
      expect([...after.memory.keys()].sort()).toEqual(['atm-a', 'atm-b', 'atm-c'])
    } finally {
      repo.close()
    }
  })

  it('U-QR-08 / U-QR-09 — eski sürüm içeriği bilinmiyor: content_unavailable_legacy, içerik null, primaryAtomId yalnız tüm snapshot\'lar aynıysa dolu; güncel metin v1 metni olarak dönmez', async () => {
    const name = uniqueDbName('mig'); names.push(name)
    await seedLegacyV1(name)
    const repo = await open(name)
    try {
      const v1 = (await repo.getRevision('q-2', 1))!
      expect(v1).toMatchObject({ integrityStatus: 'content_unavailable_legacy', text: null, options: null, correctOptionId: null, primaryAtomId: 'atm-c', createdAt: null })
      expect(v1.legacyProvenance).toEqual({ migratedAt: NOW, fromSchemaVersion: 1, createdAtSource: 'unknown' })
      const v2 = (await repo.getRevision('q-2', 2))!
      expect(v2).toMatchObject({ integrityStatus: 'content_unavailable_legacy', primaryAtomId: null })
      // sahte geçmiş yok: hiçbir API güncel metni v1 metni olarak döndürmez
      const revs = await repo.listRevisions('q-2')
      expect(revs.filter((r) => r.text === 'Islahat hangi yıl? (v3)').map((r) => r.version)).toEqual([3])
      // Attempt'ın snapshot'ı değişmemiş
      const att3 = (await repo.listAttempts()).find((a) => a.id === 'att-3')!
      expect(att3.primaryAtomIdAtAttempt).toBe('atm-c')
    } finally {
      repo.close()
    }
  })

  it('U-QR-12 — legacy sürüm tarihi uydurulmaz: v3 → createdAt null + unknown; v1 → soru createdAt (kesin); Question.createdAt korunur; updatedAt null olabilir', async () => {
    const name = uniqueDbName('mig'); names.push(name)
    await seedLegacyV1(name)
    const repo = await open(name)
    try {
      const r3 = (await repo.getRevision('q-2', 3))!
      expect(r3.createdAt).toBeNull()
      expect(r3.legacyProvenance).toEqual({ migratedAt: NOW, fromSchemaVersion: 1, createdAtSource: 'unknown' })
      const r1 = (await repo.getRevision('q-1', 1))!
      expect(r1.createdAt).toBe('2026-09-01T09:00:00.000Z')
      expect(r1.legacyProvenance).toEqual({ migratedAt: NOW, fromSchemaVersion: 1, createdAtSource: 'legacy_created_at' })
      expect((await repo.getQuestion('q-2'))!.createdAt).toBe('2026-09-01T09:00:00.000Z')
      expect((await repo.getQuestion('q-2'))!.updatedAt).toBe('2026-09-03T09:00:00.000Z') // kaynakta güvenilir updatedAt vardı
      expect((await repo.getQuestion('q-1'))!.updatedAt).toBeNull() // yoktu → null; createdAt kopyalanmaz (BL-13)
      // Phase 6 cümlesi: REBUILD ve Attempt'lar değişmez
      const fx = legacyFixture()
      expect(canonicalJson(await repo.listAttempts())).toBe(canonicalJson(fx.attempts))
      const before = rebuild(fx.attempts as Attempt[], [], EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
      const after = rebuild(await repo.listAttempts(), [], EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
      expect(serializeMemory(after.memory)).toBe(serializeMemory(before.memory))
    } finally {
      repo.close()
    }
  })

  it('I-17 / B-26 (rollback kısmı) — migration ortada hata fırlatırsa transaction geri alınır; DB v1 hâlinde ve okunabilir kalır', async () => {
    const name = uniqueDbName('mig'); names.push(name)
    const fx = legacyFixture()
    await seedLegacyV1(name, fx)
    await expect(open(name, { onUpgradeStep: (s) => { if (s === 'question:q-2') throw new Error('simülasyon: migration çöktü') } })).rejects.toThrow()
    const legacy = await readLegacyV1(name)
    expect(legacy.verno).toBe(1)
    expect(canonicalJson(legacy.questions)).toBe(canonicalJson(fx.questions))
    expect(canonicalJson(legacy.attempts)).toBe(canonicalJson(fx.attempts))
    // wipe yok: aynı DB sonra sorunsuz migrate olur
    const repo = await open(name)
    try {
      expect(await repo.getMeta('schemaVersion')).toBe(2)
      expect((await repo.listRevisions('q-2')).map((r) => r.version)).toEqual([1, 2, 3])
    } finally {
      repo.close()
    }
  })

  it('BL-32 / 13 §6.5 — daha yeni şemalı DB açılırsa yazma yok: SchemaTooNewError; DB değişmez', async () => {
    const name = uniqueDbName('newer'); names.push(name)
    const newer = new Dexie(name)
    newer.version(3).stores({ meta: 'key', attempts: 'id, sequence', gelecekTablo: 'id' })
    await newer.open()
    await newer.table('meta').put({ key: 'schemaVersion', value: 3 })
    await newer.table('attempts').put({ id: 'att-1', sequence: 1 })
    newer.close()
    await expect(open(name)).rejects.toBeInstanceOf(SchemaTooNewError)
    const check = new Dexie(name)
    await check.open()
    try {
      expect(check.verno).toBe(3)
      expect(await check.table('attempts').toArray()).toEqual([{ id: 'att-1', sequence: 1 }])
      expect((await check.table('meta').get('schemaVersion')).value).toBe(3)
    } finally {
      check.close()
    }
  })
})
