import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { SCHEDULER_CONFIG_V1 } from '../src/domain'
import { prepareBackup } from '../src/app/backup'
import { Motor } from '../src/app/motor'
import { ensureDailyPoint, ensurePostMigrationPoint, writePreMigrationPoint, writeRecoveryPoint } from '../src/app/recoveryPoints'
import { commitRestore, prepareRestore, resetAllData, type RestoreDeps } from '../src/app/restore'
import { canonicalJson, sortSnapshotArrays } from '../src/engine/backup/canonical'
import { validateBackupText } from '../src/engine/backup/validate'
import { WebCryptoHashService } from '../src/platform/web/hash'
import { DexieRepository } from '../src/store/dexie/dexieRepository'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { DexieRestoreJournal } from '../src/store/recovery/journal'
import { RecoveryDb } from '../src/store/recovery/recoveryDb'
import { readRecoveryDump } from '../src/store/recovery/recoveryReader'
import { DexieRecoveryStore, type RecoveryPointRecord, type RecoveryStore } from '../src/store/recovery/recoveryStore'
import type { Repository } from '../src/store/repository'
import { DAY, FakeClock, MIN, fakeIds } from './helpers/engineFixture'
import { seedLegacyV1, testIds, uniqueDbName } from './helpers/legacyDb'

// Phase 10b — kurtarma deposu politikası + safeRestore motor orkestrasyonu (UI'sız): B-11, B-12, B-14, B-20, B-24, B-26 (post_migration), B-34 (tam).

const hash = new WebCryptoHashService()
const names: string[] = []
afterEach(async () => { for (const n of names.splice(0)) await Dexie.delete(n) })

async function world(opts: { recovery?: RecoveryStore } = {}) {
  const clock = new FakeClock()
  const ids = fakeIds('id')
  const repo: Repository = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids })
  const a = await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Tanzimat 1839.', prompt: 'Tanzimat hangi yıl?' })
  await motor.addQuestion({ primaryAtomId: a.id, source: 'kendi', text: 'Tanzimat hangi yıl?', options: ['1839', '1856'], correctIndex: 0 })
  const session = motor.startSession(null)
  await motor.next(session)
  const pr = await motor.presentAtom(a.id)
  if (pr.kind === 'question') await motor.answerQuestion(session, pr, { initialSelectedOptionId: pr.revision.correctOptionId, selectedOptionId: pr.revision.correctOptionId, confidence: 'sure', responseTimeMs: 1 })
  const name = uniqueDbName('rec'); names.push(name)
  const db = new RecoveryDb(name)
  const recovery = opts.recovery ?? new DexieRecoveryStore(db)
  const journal = new DexieRestoreJournal(db)
  const deps: RestoreDeps = { repo, clock, ids, hash, appVersion: '0.2.0', recovery, journal, installedConfig: SCHEDULER_CONFIG_V1 }
  return { repo, motor, clock, ids, db, recovery, journal, deps, a }
}

const snapCanon = async (repo: Repository) => canonicalJson(sortSnapshotArrays(await repo.snapshotAll()))

describe('Kurtarma noktaları politikası (06 §9, 13 §3)', () => {
  it('writeRecoveryPoint: payload tam yedek (doğrulanır), sayılar doğru, pin isteğe bağlı', async () => {
    const { deps, recovery } = await world()
    const p = await writeRecoveryPoint(deps, 'manual')
    expect(p).toMatchObject({ reason: 'manual', schemaVersion: 2, counts: { atoms: 1, questions: 1, attempts: 1, voids: 0 }, pinnedBy: null })
    expect((await validateBackupText(p.payload, hash, deps.clock.now())).ok).toBe(true)
    expect((await recovery.list()).map((x) => x.id)).toEqual([p.id])
  })

  it('daily: günün ilk değişikliğinde bir kez; aynı gün ikinci çağrı yazmaz; ertesi gün yeni nokta', async () => {
    const { deps, recovery, clock } = await world()
    expect(await ensureDailyPoint(deps)).toBe(true)
    expect(await ensureDailyPoint(deps)).toBe(false)
    clock.advance(DAY)
    expect(await ensureDailyPoint(deps)).toBe(true)
    expect((await recovery.list()).filter((p) => p.reason === 'daily')).toHaveLength(2)
  })

  it('B-26 (post_migration) — migrate edilmiş DB ilk açılışta post_migration noktası zorunlu; ikinci çağrı tekrar yazmaz; payload doğrulanır', async () => {
    const dbName = uniqueDbName('mig'); names.push(dbName)
    await seedLegacyV1(dbName)
    const clock = new FakeClock()
    const repo = await DexieRepository.open({ name: dbName, ids: testIds(), now: () => clock.now() })
    const recName = uniqueDbName('rec'); names.push(recName)
    const recovery = new DexieRecoveryStore(new RecoveryDb(recName))
    try {
      expect(await repo.getMeta('migrationReport')).not.toBeNull()
      const deps = { repo, clock, ids: fakeIds('id'), hash, appVersion: '0.2.0', recovery }
      expect(await ensurePostMigrationPoint(deps)).toBe(true)
      expect(await ensurePostMigrationPoint(deps)).toBe(false)
      const pts = await recovery.list()
      expect(pts).toHaveLength(1)
      expect(pts[0]).toMatchObject({ reason: 'post_migration', schemaVersion: 2, counts: { atoms: 3, questions: 2, attempts: 5, voids: 0 } })
      expect((await validateBackupText(pts[0]!.payload, hash, clock.now())).ok).toBe(true)
    } finally {
      repo.close()
    }
  })

  it('pre_migration (06 §6.1/§6.3) — eski şema kurtarma okuyucusuyla dökülür, format-1 yedek olarak nokta yazılır; payload migrate yoluyla doğrulanır', async () => {
    const dbName = uniqueDbName('legacy'); names.push(dbName)
    await seedLegacyV1(dbName)
    const clock = new FakeClock()
    const recName = uniqueDbName('rec'); names.push(recName)
    const recovery = new DexieRecoveryStore(new RecoveryDb(recName))
    const dump = await readRecoveryDump(dbName, clock.now())
    const p = await writePreMigrationPoint({ clock, ids: fakeIds('id'), hash, appVersion: '0.2.0', recovery }, dump)
    expect(p).toMatchObject({ reason: 'pre_migration', schemaVersion: 1, counts: { atoms: 3, questions: 2, attempts: 5 } })
    const v = await validateBackupText(p.payload, hash, clock.now())
    expect(v.ok).toBe(true)
    expect(v.ok && v.path).toBe('migrate')
  })
})

describe('Güvenli geri yükleme orkestrasyonu (06 §8)', () => {
  it('B-11 — başarılı geri yükleme öncesi pre_restore noktası; payload eski durumun tam yedeği; journal verified; pin kalkar', async () => {
    const { deps, repo, recovery, journal, motor } = await world()
    const oldState = await snapCanon(repo)
    const backup = await prepareBackup(deps) // kendinden farklı bir hedef: yedek al, sonra veri değişsin
    const session = motor.startSession(null)
    const pr = await motor.presentAtom((await repo.listAtoms())[0]!.id)
    if (pr.kind === 'recall') await motor.answerRecall(session, pr, { selfAssessment: 'good', hookShown: false, responseTimeMs: 1 })
    const changedState = await snapCanon(repo)
    expect(changedState).not.toBe(oldState)
    const prepared = await prepareRestore(deps, { kind: 'file', text: backup.text })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    expect(prepared.summary.counts).toEqual({ atoms: 1, questions: 1, attempts: 1, voids: 0 })
    const out = await commitRestore(deps, prepared)
    expect(out.ok).toBe(true)
    const points = await recovery.list()
    expect(points.map((p) => p.reason)).toEqual(['pre_restore'])
    expect(points[0]!.pinnedBy).toBeNull() // iş bitti → pin kalktı
    expect(points[0]!.counts.attempts).toBe(2) // eski (değişmiş) durumun yedeği
    const payload = await validateBackupText(points[0]!.payload, hash, deps.clock.now())
    expect(payload.ok && canonicalJson(sortSnapshotArrays(stripW({ config: payload.file.config, content: payload.file.content, events: payload.file.events })))).toBe(changedState)
    expect(canonicalJson(sortSnapshotArrays(stripW(await repo.snapshotAll())))).toBe(canonicalJson(sortSnapshotArrays(stripW(prepared.normalized))))
    const j = await journal.get(out.ok ? out.jobId : '')
    expect(j).toMatchObject({ kind: 'restore', phase: 'verified' })
    expect(await repo.getMeta('appliedJobId')).toBe(out.ok ? out.jobId : null)
    expect(await repo.getMeta('lastExternalBackupAt')).toBeNull()
  })

  it('B-12 — pre_restore yazılamazsa (kota) geri yükleme başlamaz; DB değişmez; journal aborted', async () => {
    const { deps, repo, recovery, journal } = await world()
    const before = await snapCanon(repo)
    const backup = await prepareBackup(deps)
    const failing: RecoveryStore = { ...recovery, list: () => recovery.list(), get: (id) => recovery.get(id), pin: (id, j) => recovery.pin(id, j), unpinJob: (j) => recovery.unpinJob(j), write: async () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e } }
    const d = { ...deps, recovery: failing }
    const prepared = await prepareRestore(d, { kind: 'file', text: backup.text })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    const out = await commitRestore(d, prepared)
    expect(out.ok).toBe(false)
    expect(!out.ok && out.stage).toBe('pre_point')
    expect(await snapCanon(repo)).toBe(before)
    expect(await repo.getMeta('appliedJobId')).toBeNull()
    expect((await journal.listOpen())).toEqual([])
    const all = await Promise.all(['id-'].map(() => journal.get(!out.ok && out.jobId ? out.jobId : '')))
    expect(all[0]?.phase).toBe('aborted')
  })

  it('B-20 — replaceAll kurtarma deposuna dokunmaz: commit sonrası kayıt sayısı aynı', async () => {
    const { deps, recovery } = await world()
    await writeRecoveryPoint(deps, 'manual')
    await writeRecoveryPoint(deps, 'daily')
    const backup = await prepareBackup(deps)
    let countAtCommit = -1
    const d: RestoreDeps = { ...deps, hooks: { afterCommit: async () => { countAtCommit = (await recovery.list()).length } } }
    const prepared = await prepareRestore(d, { kind: 'file', text: backup.text })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    const out = await commitRestore(d, prepared)
    expect(out.ok).toBe(true)
    expect(countAtCommit).toBe(3) // manual + daily + pre_restore; replaceAll hiçbirini silmedi
    expect((await recovery.list()).map((p) => p.reason).sort()).toEqual(['daily', 'manual', 'pre_restore'])
  })

  it('B-14 / B-34 — kurtarma noktasından dönüş: yeni pre_restore alınır; hedef ve yeni nokta iş boyunca pin\'li; 5 noktada en eskisine dönülürse budanan p2; iş bitince pinler kalkar', async () => {
    const { deps, recovery, repo, motor, ids, clock } = await world()
    // 5 işlem noktası (p1..p5), p1 en eski
    const points: RecoveryPointRecord[] = []
    for (let i = 0; i < 5; i++) { clock.advance(MIN); points.push(await writeRecoveryPoint(deps, 'manual')) }
    const p1 = points[0]!
    const p2 = points[1]!
    // veri değişsin ki dönüş anlamlı olsun
    const session = motor.startSession(null)
    const pr = await motor.presentAtom((await repo.listAtoms())[0]!.id)
    if (pr.kind === 'recall') await motor.answerRecall(session, pr, { selfAssessment: 'good', hookShown: false, responseTimeMs: 1 })
    let pinnedDuring: string[] = []
    const d: RestoreDeps = { ...deps, ids, hooks: { afterCommit: async () => { pinnedDuring = (await recovery.list()).filter((p) => p.pinnedBy !== null).map((p) => p.id) } } }
    const prepared = await prepareRestore(d, { kind: 'point', pointId: p1.id })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    const out = await commitRestore(d, prepared)
    expect(out.ok).toBe(true)
    const after = await recovery.list()
    const newPre = after.find((p) => p.reason === 'pre_restore')!
    expect(newPre).toBeDefined()
    expect(pinnedDuring.sort()).toEqual([p1.id, newPre.id].sort()) // iş boyunca hedef + yeni ön nokta pin'li
    expect(after.some((p) => p.id === p1.id)).toBe(true) // hedef korundu
    expect(after.some((p) => p.id === p2.id)).toBe(false) // budanan pin'siz en eski: p2
    expect(after.filter((p) => p.reason !== 'daily')).toHaveLength(5) // işlem sınıfı 5
    expect(after.every((p) => p.pinnedBy === null)).toBe(true) // iş bitti → pinler kalktı
    expect((await repo.listAttempts())).toHaveLength(1) // p1'deki durum (2. attempt yok)
  })

  it('B-24 — "Tüm veriyi sıfırla": önce pre_reset noktası; sıfırlama sonrası depo boş; noktadan dönüş veriyi geri getirir', async () => {
    const { deps, repo, recovery, journal } = await world()
    const before = await snapCanon(repo)
    const out = await resetAllData(deps)
    expect(out.ok).toBe(true)
    const pts = await recovery.list()
    expect(pts.map((p) => p.reason)).toEqual(['pre_reset'])
    expect(pts[0]!.pinnedBy).toBeNull()
    expect(await repo.listAtoms()).toEqual([])
    expect(await repo.listAttempts()).toEqual([])
    expect(await repo.nextSequence()).toBe(1)
    expect((await journal.get(out.ok ? out.jobId : ''))).toMatchObject({ kind: 'reset', phase: 'verified' })
    // noktadan dönüş
    const prepared = await prepareRestore(deps, { kind: 'point', pointId: pts[0]!.id })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    const back = await commitRestore(deps, prepared)
    expect(back.ok).toBe(true)
    expect(canonicalJson(sortSnapshotArrays(stripW(await repo.snapshotAll())))).toBe(before)
    expect((await recovery.list()).map((p) => p.reason).sort()).toEqual(['pre_reset', 'pre_restore'])
  })

  it('bozuk yedek aktif veriyi asla değiştirmez: hazırlık reddi → DB ve kurtarma deposu aynen', async () => {
    const { deps, repo, recovery } = await world()
    const before = await snapCanon(repo)
    const r = await prepareRestore(deps, { kind: 'file', text: '{"bozuk": true' })
    expect(r.ok).toBe(false)
    const r2 = await prepareRestore(deps, { kind: 'file', text: JSON.stringify({ kind: 'recovery_dump' }) })
    expect(!r2.ok && r2.errors[0]).toMatch(/kurtarma dökümü/)
    expect(await snapCanon(repo)).toBe(before)
    expect(await recovery.list()).toEqual([])
  })
})

/** replaceAll paketin config'ini resolvedWeights ile yükler; kanonik karşılaştırma için düşürülür. */
function stripW<T extends { config: { schedulerConfig: { resolvedWeights?: number[] } } }>(s: T): T {
  const c = structuredClone(s)
  delete c.config.schedulerConfig.resolvedWeights
  return c
}
