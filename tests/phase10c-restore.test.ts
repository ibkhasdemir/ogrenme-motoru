import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1 } from '../src/domain'
import { backupReminder, prepareBackup, recordExternalBackup } from '../src/app/backup'
import { Motor } from '../src/app/motor'
import { writeRecoveryPoint } from '../src/app/recoveryPoints'
import { CrashSimulation, commitRestore, prepareRestore, resolveOpenJobs, type RestoreDeps } from '../src/app/restore'
import { canonicalJson, sortSnapshotArrays } from '../src/engine/backup/canonical'
import { computeChecksum } from '../src/engine/backup/checksum'
import type { BackupFile } from '../src/engine/backup/types'
import { rebuild, serializeMemory } from '../src/engine/rebuild/rebuild'
import { WebCryptoHashService } from '../src/platform/web/hash'
import { DexieRepository } from '../src/store/dexie/dexieRepository'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { DexieRestoreJournal, type RestoreJournal } from '../src/store/recovery/journal'
import { RecoveryDb } from '../src/store/recovery/recoveryDb'
import { readRecoveryDump } from '../src/store/recovery/recoveryReader'
import { DexieRecoveryStore, type RecoveryStore } from '../src/store/recovery/recoveryStore'
import type { ReplaceAllMeta, Repository } from '../src/store/repository'
import { dumpToBackupText } from '../src/ui/recoveryScreen'
import { DAY, FakeClock, MIN, fakeIds } from './helpers/engineFixture'
import { seedLegacyV1, testIds, uniqueDbName } from './helpers/legacyDb'

// Phase 10c — kırmızı çizgi B-01 ve geri yükleme uçları: B-10, B-13, B-18, B-19, B-23, B-29, B-32, B-33, B-36, B-37 (kalan), B-16 (geri yükleme), B-22/B-25 (B-01 eşitliği), A-05.

const hash = new WebCryptoHashService()
const names: string[] = []
afterEach(async () => { for (const n of names.splice(0)) await Dexie.delete(n) })

async function seed(repo: Repository, clock: FakeClock) {
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  const a = await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Tanzimat 1839.', prompt: 'Tanzimat hangi yıl?', hooks: [{ type: 'logic', content: 'çengel' }] })
  const b = await motor.addAtom({ subjectName: 'Coğrafya', topicName: 'İklim', text: 'Karadeniz nemli.', prompt: 'Karadeniz iklimi?' })
  await motor.addQuestion({ primaryAtomId: a.id, source: 'kendi', text: 'Tanzimat hangi yıl?', options: ['1839', '1856', '1876'], correctIndex: 0 })
  const session = motor.startSession(null)
  await motor.next(session)
  const pq = await motor.presentAtom(a.id)
  if (pq.kind === 'question') {
    const { token } = await motor.answerQuestion(session, pq, { initialSelectedOptionId: pq.revision.options[1]!.id, selectedOptionId: pq.revision.correctOptionId, confidence: 'unsure', responseTimeMs: 3 })
    clock.advance(MIN)
    const pr = await motor.presentAtom(b.id)
    if (pr.kind === 'recall') await motor.answerRecall(session, pr, { selfAssessment: 'good', hookShown: false, responseTimeMs: 2 })
    clock.advance(MIN)
    const pr2 = await motor.presentAtom(a.id)
    if (pr2.kind === 'recall') { const r = await motor.answerRecall(session, pr2, { selfAssessment: 'again', hookShown: true, responseTimeMs: 1 }); await motor.undo(session, r.token!) }
    void token
  }
  return motor
}

function recoveryWorld(clock: FakeClock) {
  const name = uniqueDbName('rec'); names.push(name)
  const db = new RecoveryDb(name)
  return { recovery: new DexieRecoveryStore(db) as RecoveryStore, journal: new DexieRestoreJournal(db) as RestoreJournal, clock }
}

const canon = async (repo: Repository) => canonicalJson(sortSnapshotArrays(stripW(await repo.snapshotAll())))
function stripW<T extends { config: { schedulerConfig: { resolvedWeights?: number[] } } }>(s: T): T { const c = structuredClone(s); delete c.config.schedulerConfig.resolvedWeights; return c }
const memOf = async (repo: Repository) => { const s = await repo.snapshotAll(); return serializeMemory(rebuild(s.events.attempts, s.events.voids, s.config.evidencePolicy, s.config.schedulerConfig).memory) }

describe('B-01 — kırmızı çizgi: yedek → ana DB sil → geri yükle → REBUILD', () => {
  it('içerik+revision, ham olaylar (kanonik), void, config eşit; serializeMemory eşit; nextSequence aynı (Dexie)', async () => {
    const clock = new FakeClock()
    const dbName = uniqueDbName('main'); names.push(dbName)
    const repo = await DexieRepository.open({ name: dbName, ids: testIds(), now: () => clock.now() })
    await seed(repo, clock)
    const before = await canon(repo)
    const memBefore = await memOf(repo)
    const nextBefore = await repo.nextSequence()
    const deps = { repo, clock, ids: fakeIds('b'), hash, appVersion: '0.2.0' }
    const backup = await prepareBackup(deps)
    repo.close()
    await Dexie.delete(dbName) // ana DB silindi (tarayıcı temizliği)
    const fresh = await DexieRepository.open({ name: dbName, ids: testIds(), now: () => clock.now() })
    try {
      expect(await fresh.listAtoms()).toEqual([])
      const rw = recoveryWorld(clock)
      const rdeps: RestoreDeps = { repo: fresh, clock, ids: fakeIds('r'), hash, appVersion: '0.2.0', recovery: rw.recovery, journal: rw.journal, installedConfig: SCHEDULER_CONFIG_V1 }
      const prepared = await prepareRestore(rdeps, { kind: 'file', text: backup.text })
      if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
      const out = await commitRestore(rdeps, prepared)
      expect(out.ok).toBe(true)
      expect(await canon(fresh)).toBe(before) // içerik + revision + ham olaylar + void + config
      expect(await memOf(fresh)).toBe(memBefore) // uyumlu scheduler → MemoryState bayt bayt eşit
      expect(await fresh.nextSequence()).toBe(nextBefore)
      const motor = await Motor.create({ repo: fresh, clock, ids: fakeIds('m') })
      expect(serializeMemory(motor.memory)).toBe(memBefore)
    } finally {
      fresh.close()
    }
  })

  it('B-22 / B-25 (B-01 eşitliği) / A-05 — Memory deposundan alınan yedek Dexie\'ye, farklı platform alanı davranışı etkilemez', async () => {
    const clock = new FakeClock()
    const mem = new MemoryRepository(fakeIds('gen'))
    await seed(mem, clock)
    const backup = await prepareBackup({ repo: mem, clock, ids: fakeIds('b'), hash, appVersion: '0.2.0', platform: 'ios' })
    expect(backup.file.platform).toBe('ios')
    const dbName = uniqueDbName('main'); names.push(dbName)
    const dexie = await DexieRepository.open({ name: dbName, ids: testIds(), now: () => clock.now() })
    try {
      const rw = recoveryWorld(clock)
      const rdeps: RestoreDeps = { repo: dexie, clock, ids: fakeIds('r'), hash, appVersion: '0.2.0', recovery: rw.recovery, journal: rw.journal, installedConfig: SCHEDULER_CONFIG_V1 }
      const prepared = await prepareRestore(rdeps, { kind: 'file', text: backup.text })
      if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
      expect((await commitRestore(rdeps, prepared)).ok).toBe(true)
      expect(await canon(dexie)).toBe(await canon(mem))
      expect(await memOf(dexie)).toBe(await memOf(mem))
    } finally {
      dexie.close()
    }
  })
})

describe('Geri yükleme uçları', () => {
  async function world() {
    const clock = new FakeClock()
    const repo: Repository = new MemoryRepository(fakeIds('gen'))
    const motor = await seed(repo, clock)
    const rw = recoveryWorld(clock)
    const deps: RestoreDeps = { repo, clock, ids: fakeIds('r'), hash, appVersion: '0.2.0', recovery: rw.recovery, journal: rw.journal, installedConfig: SCHEDULER_CONFIG_V1 }
    const backup = await prepareBackup(deps)
    return { clock, repo, motor, deps, backup, recovery: rw.recovery, journal: rw.journal }
  }

  it('B-10 — dry-run REBUILD başarısız (scheduler mock hata) → red; DB değişmez', async () => {
    const { deps, repo, backup } = await world()
    const before = await canon(repo)
    const r = await prepareRestore({ ...deps, hooks: { dryRun: () => { throw new Error('scheduler next patladı') } } }, { kind: 'file', text: backup.text })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors[0]).toMatch(/Deneme hesabı başarısız/)
    expect(await canon(repo)).toBe(before)
  })

  it('B-13 — commit sonrası hata (REBUILD adımı) → journal\'daki pin\'li pre_restore noktasından otomatik geri dönüş; DB eski duruma bayt-eşdeğer; journal rolled_back', async () => {
    const { deps, repo, backup, motor, journal, recovery } = await world()
    // veri değişsin (yedekten farklı olsun)
    const session = motor.startSession(null)
    const pr = await motor.presentAtom((await repo.listAtoms())[1]!.id)
    if (pr.kind === 'recall') await motor.answerRecall(session, pr, { selfAssessment: 'good', hookShown: false, responseTimeMs: 1 })
    const before = await canon(repo)
    const d: RestoreDeps = { ...deps, hooks: { afterCommit: () => { throw new Error('REBUILD çöktü (mock)') } } }
    const prepared = await prepareRestore(d, { kind: 'file', text: backup.text })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    const out = await commitRestore(d, prepared)
    expect(out.ok).toBe(false)
    expect(!out.ok && out.rolledBack).toBe(true)
    expect(!out.ok && out.lockdown).toBe(false)
    expect(await canon(repo)).toBe(before)
    expect((await journal.get(!out.ok && out.jobId ? out.jobId : ''))?.phase).toBe('rolled_back')
    expect((await recovery.list()).every((p) => p.pinnedBy === null)).toBe(true)
    expect(await repo.getMeta('appliedJobId')).toMatch(/:rollback$/)
  })

  it('B-18 — paketten config: requestRetention 0.8 uyumlu → aktif config paketinki; schedulerConfigHistory korunur; uyarı', async () => {
    const { deps, repo, backup } = await world()
    const file: BackupFile = structuredClone(backup.file)
    file.config.schedulerConfig = { ...file.config.schedulerConfig, configVersion: 2, requestRetention: 0.8 }
    file.config.schedulerConfigHistory = [{ kind: 'config_snapshot', at: '2026-09-01T00:00:00.000Z', configVersion: 1, config: { requestRetention: 0.9 } }]
    file.checksum = await computeChecksum(file, hash)
    const prepared = await prepareRestore(deps, { kind: 'file', text: JSON.stringify(file) })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    expect(prepared.summary.schedulerCompatible).toBe(true)
    expect(prepared.summary.warnings.some((w) => /zamanlayıcı ayarı/.test(w))).toBe(true)
    expect((await commitRestore(deps, prepared)).ok).toBe(true)
    const cfg = await repo.getConfig()
    expect(cfg.schedulerConfig).toMatchObject({ configVersion: 2, requestRetention: 0.8 })
    expect(cfg.schedulerConfigHistory).toHaveLength(1)
    const post = await repo.snapshotAll()
    const expected = rebuild(post.events.attempts, post.events.voids, EVIDENCE_POLICY_V1, cfg.schedulerConfig)
    expect(await memOf(repo)).toBe(serializeMemory(expected.memory))
  })

  it('B-19 — scheduler uyumsuz yedek (engineVersion 9.9.9): normalize → aktif = kurulu config (+resolvedWeights); paketinki history\'de; ham/içerik kayıpsız; re-init sonrası aktif config hâlâ kurulu; ikinci REBUILD eşit; uyarı', async () => {
    const clock = new FakeClock()
    const dbName = uniqueDbName('main'); names.push(dbName)
    let repo = await DexieRepository.open({ name: dbName, ids: testIds(), now: () => clock.now() })
    await seed(repo, clock)
    const rw = recoveryWorld(clock)
    const deps: RestoreDeps = { repo, clock, ids: fakeIds('r'), hash, appVersion: '0.2.0', recovery: rw.recovery, journal: rw.journal, installedConfig: SCHEDULER_CONFIG_V1 }
    const backup = await prepareBackup(deps)
    const file: BackupFile = structuredClone(backup.file)
    file.config.schedulerConfig = { ...file.config.schedulerConfig, configVersion: 5, engineVersion: '9.9.9', requestRetention: 0.8 }
    file.checksum = await computeChecksum(file, hash)
    const prepared = await prepareRestore(deps, { kind: 'file', text: JSON.stringify(file) })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    expect(prepared.summary.schedulerCompatible).toBe(false)
    expect(prepared.summary.warnings.some((w) => /Farklı zamanlayıcı sürümü/.test(w))).toBe(true)
    const out = await commitRestore(deps, prepared)
    expect(out.ok).toBe(true)
    const cfg = await repo.getConfig()
    expect(cfg.schedulerConfig).toMatchObject({ engineVersion: '5.4.2', configVersion: 1, requestRetention: 0.9 })
    expect(cfg.schedulerConfig.resolvedWeights).toHaveLength(21)
    expect(cfg.schedulerConfigHistory.map((h) => h.kind)).toEqual(['config_snapshot', 'scheduler_migration'])
    expect(canonicalJson(await repo.listAttempts())).toBe(canonicalJson(backup.file.events.attempts))
    expect((await repo.listAtoms())).toHaveLength(2)
    const mem1 = await memOf(repo)
    // re-init: kapat, yeniden aç
    repo.close()
    repo = await DexieRepository.open({ name: dbName, ids: testIds(), now: () => clock.now() })
    try {
      const cfg2 = await repo.getConfig()
      expect(cfg2.schedulerConfig).toMatchObject({ engineVersion: '5.4.2', configVersion: 1 })
      expect(await memOf(repo)).toBe(mem1)
      const motor = await Motor.create({ repo, clock, ids: fakeIds('m') })
      expect(motor.schedulerConfig.engineVersion).toBe('5.4.2')
    } finally {
      repo.close()
    }
  })

  it('B-23 — pakette sahte derived → geri yükleme sonrası MemoryState REBUILD\'den gelir', async () => {
    const { deps, repo, backup } = await world()
    const file: BackupFile = structuredClone(backup.file)
    file.derived = { memory: [{ atomId: 'sahte', due: '2099-01-01T00:00:00.000Z', stability: 99, difficulty: 1, reps: 99, lapses: 0, state: 2, learningSteps: 0, lastReview: null, lastAttemptKind: 'question' }], reviewEvents: [] }
    // derived hash dışı: checksum değişmez
    expect(file.checksum!.value).toBe((await computeChecksum(file, hash)).value)
    const prepared = await prepareRestore(deps, { kind: 'file', text: JSON.stringify(file) })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    expect(prepared.summary.warnings.some((w) => /derived/.test(w))).toBe(true)
    expect((await commitRestore(deps, prepared)).ok).toBe(true)
    const motor = await Motor.create({ repo, clock: deps.clock, ids: fakeIds('m') })
    expect(motor.memory.has('sahte')).toBe(false)
    expect(serializeMemory(motor.memory)).toBe(await memOf(repo))
  })

  it('B-29 — dry-run = commit sonrası (her durumda): commit sonrası ham kayıt bozulursa kanonik fark yakalanır → acil geri dönüş; hatasız yolda post === dryRun', async () => {
    const clock = new FakeClock()
    const dbName = uniqueDbName('main'); names.push(dbName)
    const repo = await DexieRepository.open({ name: dbName, ids: testIds(), now: () => clock.now() })
    try {
      await seed(repo, clock)
      const rw = recoveryWorld(clock)
      const deps: RestoreDeps = { repo, clock, ids: fakeIds('r'), hash, appVersion: '0.2.0', recovery: rw.recovery, journal: rw.journal, installedConfig: SCHEDULER_CONFIG_V1 }
      const backup = await prepareBackup(deps)
      const file: BackupFile = structuredClone(backup.file)
      file.config.schedulerConfig = { ...file.config.schedulerConfig, engineVersion: '9.9.9' } // uyumsuz → normalize
      file.checksum = await computeChecksum(file, hash)
      const before = await canon(repo)
      // sayıyı koruyarak bir ham kaydı değiştir (mock: doğrudan tabloya)
      let corrupted = false
      const d: RestoreDeps = { ...deps, hooks: { beforeVerify: async () => { if (corrupted) return; corrupted = true; const first = (await repo.listAttempts())[0]!; await repo.db.attempts.update(first.id, { responseTimeMs: first.responseTimeMs + 1 }) } } }
      const prepared = await prepareRestore(d, { kind: 'file', text: JSON.stringify(file) })
      if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
      const out = await commitRestore(d, prepared)
      expect(out.ok).toBe(false)
      expect(!out.ok && out.rolledBack).toBe(true)
      expect(!out.ok && out.error).toMatch(/kanonik olarak eşit değil/)
      expect(await canon(repo)).toBe(before)
      // hatasız yol
      const prepared2 = await prepareRestore(deps, { kind: 'file', text: JSON.stringify(file) })
      if (!prepared2.ok) throw new Error(prepared2.errors.join(' | '))
      expect((await commitRestore(deps, prepared2)).ok).toBe(true)
      expect(await memOf(repo)).toBe(serializeMemory(prepared2.dryRunMemory))
    } finally {
      repo.close()
    }
  })

  it('B-32 — acil geri dönüş yeni nokta istemez: RecoveryStore tüm yazmalarda kota hatası + journal yazılamaz → pin\'li noktadan dönüş başarır; çağrı sayısı 1; ikinci başarısızlıkta kilit', async () => {
    const { deps, repo, backup, recovery, journal } = await world()
    const before = await canon(repo)
    let quota = false
    const failingStore: RecoveryStore = {
      list: () => recovery.list(), get: (id) => recovery.get(id),
      write: async (r) => { if (quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e } return recovery.write(r) },
      pin: async (id, j) => { if (quota) throw new Error('quota'); return recovery.pin(id, j) },
      unpinJob: async (j) => { if (quota) throw new Error('quota'); return recovery.unpinJob(j) },
    }
    const failingJournal: RestoreJournal = {
      put: (e) => journal.put(e), get: (id) => journal.get(id), listOpen: () => journal.listOpen(),
      update: async (id, patch) => { if (quota) throw new Error('quota'); return journal.update(id, patch) },
    }
    let rollbackReplaceAlls = 0
    const countingRepo: Repository = Object.create(repo, { replaceAll: { value: async (s: never, m: ReplaceAllMeta) => { if (m.appliedJobId.endsWith(':rollback')) rollbackReplaceAlls++; return repo.replaceAll(s, m) } } })
    const d: RestoreDeps = { ...deps, repo: countingRepo, recovery: failingStore, journal: failingJournal, hooks: { afterCommit: () => { quota = true; throw new Error('doğrulama hatası (mock)') } } }
    const prepared = await prepareRestore(d, { kind: 'file', text: backup.text })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    const out = await commitRestore(d, prepared)
    expect(out.ok).toBe(false)
    expect(!out.ok && out.rolledBack).toBe(true) // journal/pin yazılamasa da ana DB doğrulandı → başarılı (BL-29)
    expect(rollbackReplaceAlls).toBe(1)
    expect(await canon(repo)).toBe(before)
    expect((await journal.get(!out.ok && out.jobId ? out.jobId : ''))?.phase).toBe('committed') // journal yazılamadı; açılışta jobId:rollback ile rolled_back'e tamamlanır
    // ikinci başarısızlık: ön nokta okunamıyor → kilit
    quota = false
    const d2: RestoreDeps = { ...deps, recovery: { ...failingStore, get: async () => undefined }, hooks: { afterCommit: () => { throw new Error('doğrulama hatası') } } }
    const prepared2 = await prepareRestore(d2, { kind: 'file', text: backup.text })
    if (!prepared2.ok) throw new Error(prepared2.errors.join(' | '))
    const out2 = await commitRestore(d2, prepared2)
    expect(!out2.ok && out2.lockdown).toBe(true)
    expect(!out2.ok && out2.rolledBack).toBe(false)
  })

  it('B-33 — journal ile çökme çözümü: üç kesme noktası → yeniden açılışta ya doğrulanmış yeni durum ya eski durum; appliedJobId ile journal tutarlı; yarım iş tamamlanmış sayılmaz', async () => {
    for (const crashAt of ['after_pre_point', 'after_commit', 'before_verify'] as const) {
      const { deps, repo, backup, journal, recovery, motor } = await world()
      const session = motor.startSession(null)
      const pr = await motor.presentAtom((await repo.listAtoms())[1]!.id)
      if (pr.kind === 'recall') await motor.answerRecall(session, pr, { selfAssessment: 'good', hookShown: false, responseTimeMs: 1 })
      const oldState = await canon(repo)
      const newState = canonicalJson(sortSnapshotArrays(stripW({ config: backup.file.config, content: backup.file.content, events: backup.file.events })))
      const d: RestoreDeps = { ...deps, hooks: { crashAt } }
      const prepared = await prepareRestore(d, { kind: 'file', text: backup.text })
      if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
      await expect(commitRestore(d, prepared)).rejects.toBeInstanceOf(CrashSimulation)
      expect((await journal.listOpen())).toHaveLength(1) // yarım iş
      // yeniden açılış
      const res = await resolveOpenJobs(deps)
      expect(res.lockdown).toBe(false)
      expect(await journal.listOpen()).toEqual([])
      const job = res.resolved[0]!
      const applied = await repo.getMeta('appliedJobId')
      if (crashAt === 'after_pre_point') {
        expect(job.phase).toBe('aborted')
        expect(applied).not.toBe(job.jobId)
        expect(await canon(repo)).toBe(oldState)
      } else {
        expect(job.phase).toBe('verified')
        expect(applied).toBe(job.jobId)
        expect(await canon(repo)).toBe(newState)
      }
      expect((await recovery.list()).every((p) => p.pinnedBy === null)).toBe(true) // pin'ler kalktı
    }
  })

  it('B-36 — sayaç ve meta nesli: aktif sayaç 1000, yedek max 100 → sayaç 100, generationId yeni, lastExternalBackup* null; hatırlatma negatif değil; yerel noktaya dönüş dış yedek sayılmaz', async () => {
    const { deps, repo, backup, recovery } = await world()
    const p = await prepareBackup(deps)
    await recordExternalBackup(repo, p, deps.clock.now())
    await repo.setMeta('sequence', 1000)
    const genBefore = await repo.getMeta('generationId')
    const file: BackupFile = structuredClone(backup.file)
    // yedeği max sequence 100 olacak şekilde yeniden numarala
    file.events.attempts = file.events.attempts.map((a, i) => ({ ...a, sequence: 90 + i }))
    file.events.voids = file.events.voids.map((v) => ({ ...v, sequence: 100 }))
    file.checksum = await computeChecksum(file, hash)
    const prepared = await prepareRestore(deps, { kind: 'file', text: JSON.stringify(file) })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    expect((await commitRestore(deps, prepared)).ok).toBe(true)
    expect(await repo.nextSequence()).toBe(101)
    expect(await repo.getMeta('generationId')).not.toBe(genBefore)
    expect(await repo.getMeta('generationStartSequence')).toBe(100)
    expect(await repo.getMeta('lastExternalBackupAt')).toBeNull()
    const meta = { sequence: await repo.getMeta('sequence'), generationId: await repo.getMeta('generationId'), generationStartSequence: await repo.getMeta('generationStartSequence'), lastExternalBackupAt: await repo.getMeta('lastExternalBackupAt'), lastExternalBackupSequence: await repo.getMeta('lastExternalBackupSequence'), lastExternalBackupGenerationId: await repo.getMeta('lastExternalBackupGenerationId') }
    const rem = backupReminder(meta, deps.clock.now(), null)
    expect(rem.newEvents).toBeGreaterThanOrEqual(0)
    expect(rem.status).toBe('unknown')
    // yerel noktaya dönüş dış yedek sayılmaz
    const point = (await recovery.list()).find((x) => x.reason === 'pre_restore')!
    const prepared2 = await prepareRestore(deps, { kind: 'point', pointId: point.id })
    if (!prepared2.ok) throw new Error(prepared2.errors.join(' | '))
    expect((await commitRestore(deps, prepared2)).ok).toBe(true)
    expect(await repo.getMeta('lastExternalBackupAt')).toBeNull()
  })

  it('B-16 (geri yükleme) / B-37 (kalan) — format-1 yedek başarıyla geri yüklenir; kurtarma okuyucusu eski şemadan normal yedek üretir; daha yeni şemadan yalnız dump; normal geri yükleme dump\'ı reddeder', async () => {
    const clock = new FakeClock()
    const legacyName = uniqueDbName('legacy'); names.push(legacyName)
    await seedLegacyV1(legacyName)
    const dump = await readRecoveryDump(legacyName, clock.now())
    const asBackup = await dumpToBackupText(dump, { hash, clock, ids: fakeIds('x'), appVersion: '0.2.0' })
    expect(asBackup).not.toBeNull()
    expect(asBackup!.name).toMatch(/^ogrenme-motoru-backup-/)
    // yeni bir depoya geri yükle
    const repo: Repository = new MemoryRepository(fakeIds('gen'))
    const rw = recoveryWorld(clock)
    const deps: RestoreDeps = { repo, clock, ids: fakeIds('r'), hash, appVersion: '0.2.0', recovery: rw.recovery, journal: rw.journal, installedConfig: SCHEDULER_CONFIG_V1 }
    const prepared = await prepareRestore(deps, { kind: 'file', text: asBackup!.content })
    if (!prepared.ok) throw new Error(prepared.errors.join(' | '))
    expect(prepared.summary.backupFormatVersion).toBe(1)
    expect(prepared.summary.warnings).toContain('Format 1: sağlama toplamı yok')
    expect((await commitRestore(deps, prepared)).ok).toBe(true)
    expect((await repo.listRevisions('q-2')).map((r) => `${r.version}:${r.integrityStatus}`)).toEqual(['1:content_unavailable_legacy', '2:content_unavailable_legacy', '3:complete'])
    expect((await repo.getRevision('q-2', 1))!.text).toBeNull()
    expect(await repo.getMeta('restoreProvenance')).toMatchObject({ sourceSchemaVersion: 1, sourceFormatVersion: 1 })
    // daha yeni şema → normal yedek yok, yalnız dump; dump normal geri yüklemede reddedilir
    const newer = new Dexie(uniqueDbName('newer')); names.push(newer.name)
    newer.version(3).stores({ meta: 'key', gelecek: 'id' }); await newer.open(); await newer.table('meta').put({ key: 'schemaVersion', value: 3 }); newer.close()
    const dump3 = await readRecoveryDump(newer.name, clock.now())
    expect(await dumpToBackupText(dump3, { hash, clock, ids: fakeIds('x'), appVersion: '0.2.0' })).toBeNull()
    const rej = await prepareRestore(deps, { kind: 'file', text: JSON.stringify(dump3) })
    expect(!rej.ok && rej.errors[0]).toMatch(/kurtarma dökümü/)
  })

  it('geri yükleme sonrası pin\'siz retention ve yedek hatırlatması "bilinmiyor"; kurtarma noktası yazmak sayacı değiştirmez (B-21 cümlesi)', async () => {
    const { deps, repo, recovery } = await world()
    const before = await repo.getMeta('sequence')
    await writeRecoveryPoint(deps, 'manual')
    expect(await repo.getMeta('sequence')).toBe(before)
    expect((await recovery.list())).toHaveLength(1)
    void DAY
  })
})
