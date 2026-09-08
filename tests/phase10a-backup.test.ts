import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type { Attempt, QuestionAttempt } from '../src/domain'
import { EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1 } from '../src/domain'
import { backupReminder, prepareBackup, recordExternalBackup, saveBackup, type BackupDeps } from '../src/app/backup'
import { Motor } from '../src/app/motor'
import { backupFileName, buildBackup } from '../src/engine/backup/build'
import { canonicalJson, sortSnapshotArrays } from '../src/engine/backup/canonical'
import { computeChecksum } from '../src/engine/backup/checksum'
import { dryRunRebuild, normalizeSnapshot } from '../src/engine/backup/dryRun'
import type { BackupFile } from '../src/engine/backup/types'
import { validateBackupFile, validateBackupText } from '../src/engine/backup/validate'
import { rebuild, serializeMemory } from '../src/engine/rebuild/rebuild'
import type { BackupFileService, BackupSaveResult } from '../src/platform/services'
import { WebCryptoHashService } from '../src/platform/web/hash'
import { DexieRepository } from '../src/store/dexie/dexieRepository'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import type { Repository } from '../src/store/repository'
import { DAY, FakeClock, MIN, T0, fakeIds, iso } from './helpers/engineFixture'
import { legacyFixture, testIds, uniqueDbName } from './helpers/legacyDb'

// Phase 10a — taşınabilir yedek (06 §7, §8.2, §8.3, §10, §11; 13 §4): I-06, B-02…B-09, B-16 (migrate+doğrulama), B-17, B-21, B-22, B-25 (tam),
// B-27, B-30, B-31, B-35, B-38, U-SC-11 export cümlesi, A-04 (BackupFileService sahtesi).

const hash = new WebCryptoHashService()

async function seededMotor(clock = new FakeClock()) {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  const a = await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Tanzimat 1839.', prompt: 'Tanzimat hangi yıl?' })
  const b = await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Islahat 1856.', prompt: 'Islahat hangi yıl?' })
  const q = await motor.addQuestion({ primaryAtomId: a.id, source: 'kendi', text: 'Tanzimat hangi yıl?', options: ['1839', '1856', '1876'], correctIndex: 0 })
  const session = motor.startSession(null)
  const read = await motor.next(session)
  if (read.kind !== 'read') throw new Error('read bekleniyordu')
  const pq = await motor.presentAtom(a.id)
  if (pq.kind !== 'question') throw new Error('question bekleniyordu')
  const first = await motor.answerQuestion(session, pq, { initialSelectedOptionId: pq.revision.correctOptionId, selectedOptionId: pq.revision.correctOptionId, confidence: 'sure', responseTimeMs: 100 })
  clock.advance(MIN)
  const pr = await motor.presentAtom(b.id)
  if (pr.kind !== 'recall') throw new Error('recall bekleniyordu')
  await motor.answerRecall(session, pr, { selfAssessment: 'hard', hookShown: false, responseTimeMs: 100 })
  clock.advance(MIN)
  const pr2 = await motor.presentAtom(a.id)
  if (pr2.kind !== 'recall') throw new Error('recall bekleniyordu')
  const third = await motor.answerRecall(session, pr2, { selfAssessment: 'again', hookShown: false, responseTimeMs: 100 })
  await motor.undo(session, third.token!) // 3 attempt + 1 void
  const deps: BackupDeps = { repo, clock, ids: motor.ids, hash, appVersion: '0.2.0' }
  return { repo, motor, clock, deps, a, b, q, first }
}

async function tamper(file: BackupFile, mutate: (f: BackupFile) => void): Promise<BackupFile> {
  const copy = structuredClone(file)
  mutate(copy)
  copy.checksum = await computeChecksum(copy, hash) // "yeniden hesaplanmış fixture": yapısal kural izole edilir
  return copy
}
const errorsOf = (r: Awaited<ReturnType<typeof validateBackupFile>>) => (r.ok ? [] : r.errors)

describe('Yedek üretimi', () => {
  it('U-SC-11 (export) / format: resolvedWeights 21 sayı; derived null; checksum sha256; header alanları', async () => {
    const { deps } = await seededMotor()
    const p = await prepareBackup(deps)
    expect(p.file.backupFormatVersion).toBe(2)
    expect(p.file.schemaVersion).toBe(2)
    expect(p.file.platform).toBe('pwa')
    expect(p.file.config.schedulerConfig.resolvedWeights).toHaveLength(21)
    expect(p.file.config.schedulerConfig.weights).toBeNull()
    expect(p.file.derived).toBeNull()
    expect(p.file.checksum).toMatchObject({ algorithm: 'sha256', of: 'canonical(backup without checksum and derived)' })
    expect(p.file.events.attempts).toHaveLength(3)
    expect(p.file.events.voids).toHaveLength(1)
    expect(p.snapshotSequence).toBe(4)
    expect(p.name).toMatch(/^ogrenme-motoru-backup-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}-[0-9a-z]{1,8}\.json$/) // sahte id'ler 8 karakterden kısa; gerçek UUID → 8 hex
    expect((await validateBackupText(p.text, hash, iso(T0))).ok).toBe(true)
  })

  it('B-02 — aynı saniyede iki yedek → farklı dosya adı ve farklı backupId', async () => {
    const { deps } = await seededMotor()
    const p1 = await prepareBackup(deps)
    const p2 = await prepareBackup(deps)
    expect(p1.file.createdAt).toBe(p2.file.createdAt)
    expect(p1.file.backupId).not.toBe(p2.file.backupId)
    expect(p1.name).not.toBe(p2.name)
    expect(backupFileName(new Date('2026-09-07T15:15:03.042Z'), '8a1c3f9e-0000-4000-8000-000000000000')).toMatch(/^ogrenme-motoru-backup-2026-09-07-\d{6}-042-8a1c3f9e\.json$/)
  })

  it('B-25 (tam) — farklı kayıt sırasıyla iki depo → kanonik JSON ve checksum aynı', async () => {
    const { deps, repo } = await seededMotor()
    const snap = await repo.snapshotAll()
    const reversed = structuredClone(snap)
    reversed.content.atoms.reverse(); reversed.events.attempts.reverse(); reversed.content.questionRevisions.reverse()
    const header = { backupId: 'b-1', createdAt: iso(T0), appVersion: '0.2.0', platform: 'pwa' }
    const f1 = await buildBackup(snap, header, hash, 2)
    const f2 = await buildBackup(reversed, header, hash, 2)
    expect(f2.checksum!.value).toBe(f1.checksum!.value)
    expect(canonicalJson(f2)).toBe(canonicalJson(f1))
    expect(deps.appVersion).toBe('0.2.0')
  })
})

describe('Doğrulama (06 §8.2) — bozuk yedek reddedilir, DB değişmez', () => {
  it('B-03 — olay baytı bozuk → sağlama toplamı uyuşmaz; snapshotAll bayt-eşdeğer kalır', async () => {
    const { deps, repo } = await seededMotor()
    const before = canonicalJson(sortSnapshotArrays(await repo.snapshotAll()))
    const p = await prepareBackup(deps)
    const bad = structuredClone(p.file)
    bad.events.attempts[0]!.responseTimeMs = 999
    const r = await validateBackupFile(bad, hash, iso(T0))
    expect(errorsOf(r)).toEqual(['Sağlama toplamı uyuşmuyor'])
    expect(canonicalJson(sortSnapshotArrays(await repo.snapshotAll()))).toBe(before)
  })

  it('B-03b — başlık bozuk (appVersion / createdAt tek bayt) → checksum red; schemaVersion 99 → matris red', async () => {
    const { deps } = await seededMotor()
    const p = await prepareBackup(deps)
    const h1 = structuredClone(p.file); h1.appVersion = '0.2.1'
    expect(errorsOf(await validateBackupFile(h1, hash, iso(T0)))).toEqual(['Sağlama toplamı uyuşmuyor'])
    const h2 = structuredClone(p.file); h2.createdAt = iso(T0 + 1)
    expect(errorsOf(await validateBackupFile(h2, hash, iso(T0)))).toEqual(['Sağlama toplamı uyuşmuyor'])
    const h3 = structuredClone(p.file); h3.schemaVersion = 99
    expect(errorsOf(await validateBackupFile(h3, hash, iso(T0)))[0]).toMatch(/daha yeni bir veri şeması/)
  })

  it('B-04 / B-09 — tekrarlı sequence, tekrarlı attempt id → red', async () => {
    const { deps } = await seededMotor()
    const p = await prepareBackup(deps)
    const dupSeq = await tamper(p.file, (f) => { f.events.attempts[1]!.sequence = f.events.attempts[0]!.sequence })
    expect(errorsOf(await validateBackupFile(dupSeq, hash, iso(T0))).some((e) => /Tekrarlı sequence/.test(e))).toBe(true)
    const dupId = await tamper(p.file, (f) => { f.events.attempts[1]!.id = f.events.attempts[0]!.id })
    expect(errorsOf(await validateBackupFile(dupId, hash, iso(T0))).some((e) => /Tekrarlı Attempt id/.test(e))).toBe(true)
  })

  it('B-05 — attempt (q, v2) var, revision yok → red', async () => {
    const { deps } = await seededMotor()
    const p = await prepareBackup(deps)
    const bad = await tamper(p.file, (f) => { (f.events.attempts.find((a) => a.kind === 'question') as QuestionAttempt).questionVersion = 2 })
    expect(errorsOf(await validateBackupFile(bad, hash, iso(T0))).some((e) => /QuestionRevision'ı yok/.test(e))).toBe(true)
  })

  it('B-05b / B-05c — sahte legacy revision red; complete\'te null içerik red; legacy primaryAtomId null kabul, çözülmeyen red', async () => {
    const { deps } = await seededMotor()
    const p = await prepareBackup(deps)
    const q = p.file.content.questions[0]!
    const legacy = (primary: string | null, extra: Partial<Record<string, unknown>> = {}) => ({
      questionId: q.id, version: 7, integrityStatus: 'content_unavailable_legacy' as const, text: null, options: null, correctOptionId: null, primaryAtomId: primary, createdAt: null,
      legacyProvenance: { migratedAt: iso(T0), fromSchemaVersion: 1, createdAtSource: 'unknown' as const }, ...extra,
    })
    const okNull = await tamper(p.file, (f) => { f.content.questionRevisions.push(legacy(null) as never) })
    expect((await validateBackupFile(okNull, hash, iso(T0))).ok).toBe(true)
    const badAtom = await tamper(p.file, (f) => { f.content.questionRevisions.push(legacy('atm-yok') as never) })
    expect(errorsOf(await validateBackupFile(badAtom, hash, iso(T0))).some((e) => /legacy revision primaryAtomId çözülmüyor/.test(e))).toBe(true)
    const fakeContent = await tamper(p.file, (f) => { f.content.questionRevisions.push(legacy(null, { text: 'sahte' }) as never) })
    expect(errorsOf(await validateBackupFile(fakeContent, hash, iso(T0))).some((e) => /sahte içerik/.test(e))).toBe(true)
    const noProv = await tamper(p.file, (f) => { const r = legacy(null) as Record<string, unknown>; delete r['legacyProvenance']; f.content.questionRevisions.push(r as never) })
    expect(errorsOf(await validateBackupFile(noProv, hash, iso(T0))).some((e) => /legacyProvenance eksik/.test(e))).toBe(true)
    const createdAtFilled = await tamper(p.file, (f) => { f.content.questionRevisions.push(legacy(null, { createdAt: iso(T0) }) as never) })
    expect(errorsOf(await validateBackupFile(createdAtFilled, hash, iso(T0))).some((e) => /createdAt dolu/.test(e))).toBe(true)
    const completeNull = await tamper(p.file, (f) => { (f.content.questionRevisions[0] as { text: unknown }).text = null })
    expect(errorsOf(await validateBackupFile(completeNull, hash, iso(T0))).some((e) => /complete revision içeriği eksik/.test(e))).toBe(true)
    const completePrimaryNull = await tamper(p.file, (f) => { (f.content.questionRevisions[0] as { primaryAtomId: unknown }).primaryAtomId = null })
    expect((await validateBackupFile(completePrimaryNull, hash, iso(T0))).ok).toBe(false)
  })

  it('B-06 / B-07 / B-08 — bilinmeyen void hedefi; correctOptionId seçeneklerde yok; kopuk Atom.topicId → red', async () => {
    const { deps } = await seededMotor()
    const p = await prepareBackup(deps)
    const v = await tamper(p.file, (f) => { f.events.voids[0]!.targetAttemptId = 'yok' })
    expect(errorsOf(await validateBackupFile(v, hash, iso(T0))).some((e) => /AttemptVoid hedefi bilinmiyor/.test(e))).toBe(true)
    const c = await tamper(p.file, (f) => { (f.content.questionRevisions[0] as { correctOptionId: string }).correctOptionId = 'o-yok' })
    expect(errorsOf(await validateBackupFile(c, hash, iso(T0))).some((e) => /correctOptionId seçeneklerde yok/.test(e))).toBe(true)
    const t = await tamper(p.file, (f) => { f.content.atoms[0]!.topicId = 'top-yok' })
    expect(errorsOf(await validateBackupFile(t, hash, iso(T0))).some((e) => /Atom.topicId çözülmüyor/.test(e))).toBe(true)
  })

  it('B-27 — semantik doğrulama: tekrarlı option id / correct çelişkili / selectedOptionId yok / mükerrer void hedefi / negatif responseTimeMs / bilinmeyen replayOfAttemptId → red', async () => {
    const { deps } = await seededMotor()
    const p = await prepareBackup(deps)
    const cases: [string, (f: BackupFile) => void, RegExp][] = [
      ['dup option', (f) => { const r = f.content.questionRevisions[0] as { options: { id: string }[] }; r.options[1]!.id = r.options[0]!.id }, /tekrarlı option id/],
      ['correct çelişkili', (f) => { (f.events.attempts.find((a) => a.kind === 'question') as QuestionAttempt).correct = false }, /correct revision ile çelişkili/],
      ['selected yok', (f) => { (f.events.attempts.find((a) => a.kind === 'question') as QuestionAttempt).selectedOptionId = 'o-yok' }, /selectedOptionId revision seçeneklerinde yok/],
      ['mükerrer void', (f) => { f.events.voids.push({ ...f.events.voids[0]!, id: 'void-2', sequence: 99 }) }, /Aynı hedefe birden çok void/],
      ['negatif süre', (f) => { f.events.attempts[0]!.responseTimeMs = -1 }, /responseTimeMs/],
      ['replay bilinmeyen', (f) => { (f.events.attempts[0] as Attempt).replayOfAttemptId = 'yok' }, /replayOfAttemptId bilinmeyen/],
    ]
    for (const [name, mutate, re] of cases) {
      const bad = await tamper(p.file, mutate)
      const errs = errorsOf(await validateBackupFile(bad, hash, iso(T0)))
      expect(errs.some((e) => re.test(e)), `${name}: ${errs.join(' | ')}`).toBe(true)
    }
  })

  it('B-17 / B-35 — ileri format red; format 2 + şema 99 (hash doğru) red; format 1 + şema 1 migrate ve kabul', async () => {
    const { deps } = await seededMotor()
    const p = await prepareBackup(deps)
    const f99 = await tamper(p.file, (f) => { f.backupFormatVersion = 99 })
    expect(errorsOf(await validateBackupFile(f99, hash, iso(T0)))[0]).toMatch(/daha yeni bir uygulama sürümü/)
    const s99 = await tamper(p.file, (f) => { f.schemaVersion = 99 })
    expect(errorsOf(await validateBackupFile(s99, hash, iso(T0)))[0]).toMatch(/daha yeni bir veri şeması/)
    const legacy = legacyFormat1File()
    const r = await validateBackupFile(legacy, hash, iso(T0))
    expect(r.ok).toBe(true)
    expect(r.ok && r.path).toBe('migrate')
    expect(r.ok && r.warnings).toContain('Format 1: sağlama toplamı yok')
  })

  it('B-16 — format 1 yedeği: bellekte migrate → exact + content_unavailable_legacy revision\'lar; güncel metin eski sürüme kopyalanmamış', async () => {
    const r = await validateBackupFile(legacyFormat1File(), hash, iso(T0))
    if (!r.ok) throw new Error(r.errors.join(' | '))
    const revs = r.file.content.questionRevisions
    expect(revs.map((x) => `${x.questionId}:${x.version}:${x.integrityStatus}`).sort()).toEqual([
      'q-1:1:complete', 'q-2:1:content_unavailable_legacy', 'q-2:2:content_unavailable_legacy', 'q-2:3:complete',
    ])
    const v1 = revs.find((x) => x.questionId === 'q-2' && x.version === 1)!
    expect(v1).toMatchObject({ text: null, options: null, correctOptionId: null, primaryAtomId: 'atm-c', createdAt: null })
    expect(revs.find((x) => x.questionId === 'q-2' && x.version === 3)).toMatchObject({ createdAt: null, legacyProvenance: { createdAtSource: 'unknown' } })
    expect(r.file.content.questions.find((q) => q.id === 'q-2')).toMatchObject({ currentVersion: 3 })
    expect(r.file.content.questions[0] as object).not.toHaveProperty('text')
    expect(r.file.content.atoms.every((a) => a.prompt === '')).toBe(true) // BL-13
    expect(r.file.backupFormatVersion).toBe(2)
    // dry-run çalışır (geri yükleme cümlesi Phase 10c'de)
    const norm = normalizeSnapshot(r.file, SCHEDULER_CONFIG_V1, iso(T0))
    expect(dryRunRebuild(norm.snapshot).memory.size).toBe(3)
  })

  it('B-31 — checksum migration\'dan önce: hash\'i değiştirilmeden bozulmuş format-2 checksum hatasıyla red (yapısal hataya ulaşmadan); geçerli format-2 kabul', async () => {
    const { deps } = await seededMotor()
    const p = await prepareBackup(deps)
    const bad = structuredClone(p.file)
    bad.events.attempts[0]!.id = bad.events.attempts[1]!.id // yapısal olarak da bozuk (tekrarlı id) ama hash güncellenmedi
    const r = await validateBackupFile(bad, hash, iso(T0))
    expect(errorsOf(r)).toEqual(['Sağlama toplamı uyuşmuyor']) // yalnız checksum hatası; migration/yapısal aşamaya inilmedi
    expect((await validateBackupFile(p.file, hash, iso(T0))).ok).toBe(true)
  })

  it('B-30 — bilinmeyen alan korunur: Attempt\'a x_note + doğru hash → kabul; export\'ta aynen; configVersion tamsayı değil → red (BL-08)', async () => {
    const { deps } = await seededMotor()
    const p = await prepareBackup(deps)
    const withExtra = await tamper(p.file, (f) => { (f.events.attempts[0] as unknown as Record<string, unknown>)['x_note'] = 'ileri sürüm alanı' })
    const r = await validateBackupFile(withExtra, hash, iso(T0))
    expect(r.ok).toBe(true)
    const target = new MemoryRepository(fakeIds('g2'))
    await target.replaceAll(r.ok ? r.file : withExtra, { appliedJobId: 'j', generationId: 'g', restoreProvenance: { sourceSchemaVersion: 2, sourceFormatVersion: 2, backupId: withExtra.backupId, restoredAt: iso(T0) } })
    const exported = await target.snapshotAll()
    expect((exported.events.attempts.find((a) => a.id === withExtra.events.attempts[0]!.id) as unknown as Record<string, unknown>)['x_note']).toBe('ileri sürüm alanı')
    const badCfg = await tamper(p.file, (f) => { (f.config.schedulerConfig as unknown as Record<string, unknown>)['configVersion'] = 'x' })
    expect(errorsOf(await validateBackupFile(badCfg, hash, iso(T0))).some((e) => /configVersion bilinmiyor/.test(e))).toBe(true)
    // BL-08: tamsayı ama farklı configVersion kabul edilir (normalize yolu karar verir)
    const newerCfg = await tamper(p.file, (f) => { f.config.schedulerConfig.configVersion = 7 })
    expect((await validateBackupFile(newerCfg, hash, iso(T0))).ok).toBe(true)
  })
})

describe('Round-trip ve depodan bağımsızlık', () => {
  const names: string[] = []
  afterEach(async () => { for (const n of names.splice(0)) await Dexie.delete(n) })

  it('I-06 — 3 attempt + 1 void → yedek JSON → boş depo → doğrula → normalize → dry-run → replaceAll → REBUILD eşit; attempts/voids eşit; sequence max+1', async () => {
    const { deps, repo } = await seededMotor()
    const p = await prepareBackup(deps)
    const target: Repository = new MemoryRepository(fakeIds('g2'))
    const r = await validateBackupText(p.text, hash, iso(T0))
    if (!r.ok) throw new Error(r.errors.join(' | '))
    const norm = normalizeSnapshot(r.file, SCHEDULER_CONFIG_V1, iso(T0))
    const dry = dryRunRebuild(norm.snapshot)
    await target.replaceAll(norm.snapshot, { appliedJobId: 'job-1', generationId: 'gen-2', restoreProvenance: { sourceSchemaVersion: 2, sourceFormatVersion: 2, backupId: p.file.backupId, restoredAt: iso(T0) } })
    const post = rebuild(await target.listAttempts(), await target.listVoids(), EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
    const source = rebuild(await repo.listAttempts(), await repo.listVoids(), EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
    expect(serializeMemory(post.memory)).toBe(serializeMemory(source.memory))
    expect(serializeMemory(post.memory)).toBe(serializeMemory(dry.memory))
    expect(canonicalJson(await target.listAttempts())).toBe(canonicalJson(await repo.listAttempts()))
    expect(canonicalJson(await target.listVoids())).toBe(canonicalJson(await repo.listVoids()))
    expect(await target.nextSequence()).toBe(5)
    expect(await target.nextSequence()).toBe(await repo.nextSequence())
  })

  it('B-22 — yedek formatı depodan bağımsız: Memory → Dexie ve Dexie → Memory; kanonik snapshot eşit', async () => {
    const { deps, repo } = await seededMotor()
    const p = await prepareBackup(deps)
    const name = uniqueDbName('b22'); names.push(name)
    const dexie = await DexieRepository.open({ name, ids: testIds(), now: () => iso(T0) })
    try {
      const r = await validateBackupText(p.text, hash, iso(T0))
      if (!r.ok) throw new Error(r.errors.join(' | '))
      const meta = { appliedJobId: 'j1', generationId: 'g-d', restoreProvenance: { sourceSchemaVersion: 2, sourceFormatVersion: 2, backupId: p.file.backupId, restoredAt: iso(T0) } }
      await dexie.replaceAll(normalizeSnapshot(r.file, SCHEDULER_CONFIG_V1, iso(T0)).snapshot, meta)
      const fromDexie = canonicalJson(sortSnapshotArrays(stripWeights(await dexie.snapshotAll())))
      expect(fromDexie).toBe(canonicalJson(sortSnapshotArrays(stripWeights(await repo.snapshotAll()))))
      // tersi: Dexie'den yedek → Memory
      const p2 = await prepareBackup({ ...deps, repo: dexie })
      const r2 = await validateBackupText(p2.text, hash, iso(T0))
      if (!r2.ok) throw new Error(r2.errors.join(' | '))
      const mem = new MemoryRepository(fakeIds('g3'))
      await mem.replaceAll(normalizeSnapshot(r2.file, SCHEDULER_CONFIG_V1, iso(T0)).snapshot, { ...meta, generationId: 'g-m' })
      expect(canonicalJson(sortSnapshotArrays(stripWeights(await mem.snapshotAll())))).toBe(fromDexie)
      expect(p2.file.platform).toBe('pwa') // A-05: platform alanı davranışı etkilemez
    } finally {
      dexie.close()
    }
  })
})

/** replaceAll paketin config'ini (resolvedWeights dâhil) yükler; kaynak depoda resolvedWeights yok → karşılaştırma için düşürülür. */
function stripWeights<T extends { config: { schedulerConfig: { resolvedWeights?: number[] } } }>(s: T): T {
  const c = structuredClone(s)
  delete c.config.schedulerConfig.resolvedWeights
  return c
}

describe('Kaydetme sonuçları ve hatırlatma (06 §10, §11)', () => {
  const fakeFiles = (result: BackupSaveResult): BackupFileService & { saved: string[] } => {
    const saved: string[] = []
    return { saved, save: async (f) => { saved.push(f.name); return result }, pick: async () => null }
  }

  it('B-38 / A-04 — saved → işaretçi güncellenir; initiated → yalnız teyitle; cancelled/failed → değişmez; işaretçi snapshot sequence\'ına bağlı', async () => {
    const { deps, repo, motor } = await seededMotor()
    const svc = fakeFiles('saved')
    const out = await saveBackup(deps, svc)
    expect(out.result).toBe('saved'); expect(out.recorded).toBe(true)
    expect(svc.saved[0]).toMatch(/^ogrenme-motoru-backup-/)
    expect(await repo.getMeta('lastExternalBackupSequence')).toBe(4)
    expect(await repo.getMeta('lastExternalBackupAt')).toBe(deps.clock.now())
    expect(await repo.getMeta('lastExternalBackupGenerationId')).toBe(await repo.getMeta('generationId'))
    // initiated: teyit gelmeden işaretçi değişmez; arada yeni olay yazılırsa teyit yine snapshot sequence'ına bağlanır
    await repo.setMeta('lastExternalBackupSequence', 1)
    const init = await saveBackup(deps, fakeFiles('initiated'))
    expect(init.recorded).toBe(false)
    expect(await repo.getMeta('lastExternalBackupSequence')).toBe(1)
    const session = motor.startSession(null)
    const pr = await motor.presentAtom((await repo.listAtoms())[1]!.id)
    if (pr.kind === 'recall') await motor.answerRecall(session, pr, { selfAssessment: 'good', hookShown: false, responseTimeMs: 1 })
    expect(await recordExternalBackup(repo, init.prepared, deps.clock.now())).toBe(true)
    expect(await repo.getMeta('lastExternalBackupSequence')).toBe(4) // kaydetme anı (5) değil
    for (const r of ['cancelled', 'failed'] as const) {
      await repo.setMeta('lastExternalBackupSequence', 2)
      const o = await saveBackup(deps, fakeFiles(r))
      expect(o.recorded).toBe(false)
      expect(await repo.getMeta('lastExternalBackupSequence')).toBe(2)
    }
    // BL-31: nesil değişmişse geç teyit uygulanmaz
    await repo.setMeta('generationId', 'baska-nesil')
    expect(await recordExternalBackup(repo, init.prepared, deps.clock.now())).toBe(false)
  })

  it('B-21 / B-36 — eşik: 250 olay → uyarı; 249 → yok; 7 gün → uyarı; işaretçi yokken nesil başından sayılır; negatif fark asla', () => {
    const base = { sequence: 300, generationId: 'g', generationStartSequence: 0, lastExternalBackupAt: iso(T0), lastExternalBackupSequence: 50, lastExternalBackupGenerationId: 'g' }
    expect(backupReminder(base, iso(T0 + MIN), null).status).toBe('due') // 250 olay
    expect(backupReminder({ ...base, sequence: 299 }, iso(T0 + MIN), null).status).toBe('ok') // 249
    expect(backupReminder({ ...base, sequence: 60 }, iso(T0 + 7 * DAY), null).status).toBe('due') // 7 gün
    expect(backupReminder({ ...base, sequence: 60 }, iso(T0 + 6 * DAY), null).status).toBe('ok')
    // işaretçi yok (hiç yedek / geri yükleme sonrası): nesil başından; "bilinmiyor" hemen, eşikte "due"
    const none = { ...base, lastExternalBackupAt: null, lastExternalBackupSequence: null, lastExternalBackupGenerationId: null, generationStartSequence: 100, sequence: 100 }
    expect(backupReminder(none, iso(T0), null)).toMatchObject({ status: 'unknown', newEvents: 0 })
    expect(backupReminder({ ...none, sequence: 350 }, iso(T0), null)).toMatchObject({ status: 'due', newEvents: 250 })
    expect(backupReminder(none, iso(T0 + 8 * DAY), iso(T0)).status).toBe('due') // ilk Attempt'tan 7 gün
    // işaretçi başka nesle ait → null sayılır; fark negatif olamaz
    const other = { ...base, generationId: 'yeni', sequence: 10, generationStartSequence: 10 }
    expect(backupReminder(other, iso(T0), null)).toMatchObject({ status: 'unknown', newEvents: 0 })
    expect(backupReminder({ ...base, sequence: 40 }, iso(T0), null).newEvents).toBe(0) // sequence < işaretçi → 0
  })
})

/** Format-1 (BL-10 varsayımı) yedek dosyası: legacy fixture'dan. */
function legacyFormat1File(): BackupFile {
  const fx = legacyFixture()
  return {
    backupFormatVersion: 1,
    backupId: 'legacy-1',
    createdAt: '2026-09-05T10:00:00.000Z',
    appVersion: '0.1.0',
    schemaVersion: 1,
    platform: 'pwa',
    config: { evidencePolicy: { policyVersion: 1 }, evidencePolicyHistory: [], schedulerConfig: { ...SCHEDULER_CONFIG_V1 }, schedulerConfigHistory: [], queueConfig: { reviewCap: 25, newPerDay: 10 } },
    content: {
      subjects: fx.subjects as never, topics: fx.topics as never, atoms: fx.atoms as never,
      hooks: [], questions: fx.questions as never, questionRevisions: [], questionAtoms: fx.questions.map((q) => ({ questionId: q.id, atomId: q.primaryAtomId, role: 'primary' as const })),
      optionAtoms: [], atomRelations: [], inbox: [],
    },
    events: { attempts: fx.attempts as never, voids: [] },
    derived: null,
  }
}
