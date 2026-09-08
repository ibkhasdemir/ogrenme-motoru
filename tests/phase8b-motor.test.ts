import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type { QuestionAttempt } from '../src/domain'
import { EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1 } from '../src/domain'
import { Motor, type Presentation } from '../src/app/motor'
import { computeChecksum } from '../src/engine/backup/checksum'
import { dryRunRebuild, normalizeSnapshot } from '../src/engine/backup/dryRun'
import { BACKUP_FORMAT_VERSION, type BackupFile } from '../src/engine/backup/types'
import { validateBackupFile, validateBackupText } from '../src/engine/backup/validate'
import { ratingFor } from '../src/engine/evidence/policy'
import { rebuild, serializeMemory } from '../src/engine/rebuild/rebuild'
import { WebCryptoHashService } from '../src/platform/web/hash'
import type { HashService } from '../src/platform/services'
import { DexieRepository } from '../src/store/dexie/dexieRepository'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { DAY, FakeClock, MIN, T0, fakeIds, iso } from './helpers/engineFixture'
import { testIds, uniqueDbName } from './helpers/legacyDb'

// Phase 8b — Motor cephesi: I-01, I-02, I-03, I-07, I-08, I-16, I-18, I-21, I-22 (motor kısmı), A-03 (MemoryRepository), A-04 (HashService sahtesi).

async function motorWithQuestion(clock = new FakeClock()) {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  const atomA = await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Tanzimat Fermanı 1839 yılında ilan edildi.', prompt: 'Tanzimat Fermanı hangi yıl ilan edildi?', facets: ['date', 'fact'], hooks: [{ type: 'logic', content: 'On sekiz otuz dokuz' }] })
  const atomB = await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Islahat Fermanı 1856.', prompt: 'Islahat hangi yıl?' })
  const q = await motor.addQuestion({ primaryAtomId: atomA.id, source: 'kendi', text: 'Tanzimat Fermanı hangi yıl ilan edildi?', options: ['1839', '1856', '1876'], correctIndex: 0 })
  return { repo, motor, clock, atomA, atomB, q }
}

/** yeni atom: önce okuma ekranı, "Okudum, sına beni" → soru sunumu */
async function firstQuestion(motor: Motor, session: ReturnType<Motor['startSession']>): Promise<Extract<Presentation, { kind: 'question' }>> {
  const read = await motor.next(session)
  expect(read.kind).toBe('read')
  const p = await motor.presentAtom((read as Extract<Presentation, { kind: 'read' }>).atom.id)
  expect(p.kind).toBe('question')
  return p as Extract<Presentation, { kind: 'question' }>
}

describe('Motor cephesi', () => {
  it('I-01 — doğru + emin → memory.due > now (T2); soru sunumu revision ve atomu taşır; oturum sayacı artar', async () => {
    const { motor, clock } = await motorWithQuestion()
    const session = motor.startSession(null)
    const p = await firstQuestion(motor, session)
    expect(p.revision.options).toHaveLength(3)
    expect(p.hooks).toHaveLength(1)
    const { attempt, token } = await motor.answerQuestion(session, p, { initialSelectedOptionId: p.revision.correctOptionId, selectedOptionId: p.revision.correctOptionId, confidence: 'sure', responseTimeMs: 4000 })
    expect(attempt).toMatchObject({ kind: 'question', mode: 'new', correct: true, operation: 'discriminate', support: 'choices' })
    expect(token).not.toBeNull()
    const mem = motor.memory.get(p.atom.id)!
    expect(Date.parse(mem.due)).toBeGreaterThan(Date.parse(clock.now()))
    expect(mem.lastAttemptKind).toBe('question')
    expect(session.answered).toBe(1)
  })

  it('I-02 — yanlış → Again → due − now ∈ (0, 15 dk]; vade adaptörden gelir', async () => {
    const { motor, clock } = await motorWithQuestion()
    const session = motor.startSession(null)
    const p = await firstQuestion(motor, session)
    const wrong = p.revision.options.find((o) => o.id !== p.revision.correctOptionId)!.id
    const { attempt } = await motor.answerQuestion(session, p, { initialSelectedOptionId: wrong, selectedOptionId: wrong, confidence: 'sure', wrongReason: 'confused', responseTimeMs: 3000 })
    expect(attempt.correct).toBe(false)
    expect(ratingFor(attempt, EVIDENCE_POLICY_V1)).toBe(1)
    const delta = Date.parse(motor.memory.get(p.atom.id)!.due) - Date.parse(clock.now())
    expect(delta).toBeGreaterThan(0)
    expect(delta).toBeLessThanOrEqual(15 * MIN)
  })

  it('I-03 — doğru + salladım → rating 1; memory var (yetim değil) (T3)', async () => {
    const { motor } = await motorWithQuestion()
    const session = motor.startSession(null)
    const p = await firstQuestion(motor, session)
    const { attempt } = await motor.answerQuestion(session, p, { initialSelectedOptionId: p.revision.correctOptionId, selectedOptionId: p.revision.correctOptionId, confidence: 'guess', responseTimeMs: 3000 })
    expect(ratingFor(attempt, EVIDENCE_POLICY_V1)).toBe(1)
    expect(motor.memory.has(p.atom.id)).toBe(true)
    expect(motor.memory.get(p.atom.id)!.state).toBe(1)
  })

  it('I-07 — geri al: void yazılır, Attempt kalır, memory eski hâline döner; aynı hedefe ikinci istek false (önceki kayda düşme yok)', async () => {
    const { motor, repo } = await motorWithQuestion()
    const session = motor.startSession(null)
    const p = await firstQuestion(motor, session)
    const { attempt, token } = await motor.answerQuestion(session, p, { initialSelectedOptionId: p.revision.correctOptionId, selectedOptionId: p.revision.correctOptionId, confidence: 'sure', responseTimeMs: 100 })
    expect(motor.memory.has(p.atom.id)).toBe(true)
    expect(await motor.undo(session, token!)).toBe(true)
    expect((await repo.listVoids()).map((v) => v.targetAttemptId)).toEqual([attempt.id])
    expect((await repo.listAttempts()).map((a) => a.id)).toEqual([attempt.id])
    expect(motor.memory.has(p.atom.id)).toBe(false)
    expect(await motor.undo(session, token!)).toBe(false)
    expect(await repo.listVoids()).toHaveLength(1)
    // düzeltme tekrarı: aynı soru, aynı sürüm, yeni actionId
    const replay = await motor.next(session)
    expect(replay).toMatchObject({ kind: 'question', action: { questionId: p.action.questionId, questionVersion: 1 }, replayOfAttemptId: attempt.id })
    expect((replay as Extract<Presentation, { kind: 'question' }>).action.actionId).not.toBe(p.action.actionId)
  })

  it('I-08 — atom semantik sürüm (A9/A10, T4): primaryAtom değiştirilince yeni revision; eski attempt eski atomu taşır; REBUILD her iki atomu doğru kurar', async () => {
    const { motor, atomA, atomB, q, repo } = await motorWithQuestion()
    const session = motor.startSession(null)
    const p = await firstQuestion(motor, session)
    const { attempt } = await motor.answerQuestion(session, p, { initialSelectedOptionId: p.revision.correctOptionId, selectedOptionId: p.revision.correctOptionId, confidence: 'sure', responseTimeMs: 100 })
    const out = await motor.reviseQuestion(q.question.id, { primaryAtomId: atomB.id })
    expect(out.revision.version).toBe(2)
    expect((await repo.getRevision(q.question.id, 1))!.primaryAtomId).toBe(atomA.id)
    expect(attempt.primaryAtomIdAtAttempt).toBe(atomA.id)
    await motor.refresh()
    expect(motor.memory.has(atomA.id)).toBe(true)
    expect(motor.memory.has(atomB.id)).toBe(false)
    // B artık soruyla sunulur, A kart
    const pB = await motor.presentAtom(atomB.id)
    expect(pB.kind).toBe('question')
    const pA = await motor.presentAtom(atomA.id)
    expect(pA.kind).toBe('recall')
  })

  it('I-16 — isteğe bağlı gelişmiş metadata: 5 alanla kaydolur; OptionAtom/secondary boş; sonradan eklenince sürüm artmaz', async () => {
    const { motor, repo, q, atomB } = await motorWithQuestion()
    expect(await repo.listOptionAtoms()).toEqual([])
    expect((await repo.listQuestionAtoms()).filter((x) => x.role === 'secondary')).toEqual([])
    const rev = q.revision
    await repo.setSecondaryAtoms(q.question.id, [atomB.id])
    await repo.setOptionAtoms(q.question.id, [{ questionId: q.question.id, optionId: rev.options[1]!.id, atomId: atomB.id, relation: 'common_confusion' }])
    expect((await repo.getQuestion(q.question.id))!.currentVersion).toBe(1)
    expect(await repo.listRevisions(q.question.id)).toHaveLength(1)
    // eksik alan reddedilir (T9 çekirdeği)
    await expect(motor.addQuestion({ primaryAtomId: atomB.id, source: '', text: 'x?', options: ['a', 'b'], correctIndex: 0 })).rejects.toThrow()
    await expect(motor.addQuestion({ primaryAtomId: atomB.id, source: 'k', text: 'x?', options: ['a'], correctIndex: 0 })).rejects.toThrow()
  })

  it('I-18 — geri yükleme config farkı: pakette requestRetention 0.8, uyumlu scheduler → REBUILD paketin config\'iyle; dry-run eşit; uyarı döner', async () => {
    const { motor, repo } = await motorWithQuestion()
    const session = motor.startSession(null)
    const p = await firstQuestion(motor, session)
    await motor.answerQuestion(session, p, { initialSelectedOptionId: p.revision.correctOptionId, selectedOptionId: p.revision.correctOptionId, confidence: 'sure', responseTimeMs: 100 })
    const snap = await repo.snapshotAll()
    const pkgConfig = { ...SCHEDULER_CONFIG_V1, configVersion: 2, requestRetention: 0.8 }
    snap.config.schedulerConfig = pkgConfig
    const norm = normalizeSnapshot(snap, SCHEDULER_CONFIG_V1, iso(T0))
    expect(norm.compatible).toBe(true)
    expect(norm.activeConfig).toEqual(pkgConfig) // paketin config'i aktif kalır
    expect(norm.warnings.length).toBeGreaterThan(0)
    expect(norm.snapshot.config.schedulerConfigHistory).toEqual([]) // uyumlu: history'ye arşiv yok
    const dry = dryRunRebuild(norm.snapshot)
    const expected = rebuild(snap.events.attempts, snap.events.voids, EVIDENCE_POLICY_V1, pkgConfig)
    expect(serializeMemory(dry.memory)).toBe(serializeMemory(expected.memory))
    // config gerçekten farkı yarattı mı (kurulu ile aynı olmasın): Learning adımında fark çıkmayabilir → Review durumu için ek kontrol yok; en az dry-run hatasız
    expect(dry.memory.size).toBe(1)
    // uyumsuz motor: normalize aktif = kurulu config + resolvedWeights; history'de config_snapshot + scheduler_migration
    const incompatible = { ...snap, config: { ...snap.config, schedulerConfig: { ...pkgConfig, engineVersion: '9.9.9' } } }
    const n2 = normalizeSnapshot(incompatible, SCHEDULER_CONFIG_V1, iso(T0))
    expect(n2.compatible).toBe(false)
    expect(n2.activeConfig).toMatchObject({ engineVersion: '5.4.2', configVersion: 1 })
    expect(n2.activeConfig.resolvedWeights).toHaveLength(21)
    expect(n2.snapshot.config.schedulerConfigHistory.map((h) => h.kind)).toEqual(['config_snapshot', 'scheduler_migration'])
    expect(n2.snapshot.events.attempts).toEqual(snap.events.attempts) // ham olaylar kayıpsız
  })

  it('I-22 (motor) — saat tutarsızlığı: cihaz saati +30 gün → cevap → saat düzeltilir → uyarı ve ileri tarihli kayıt; geçersiz kıl → clock_skew void; vade gerçek zamana döner; sessiz düzeltme yok', async () => {
    const { motor, clock, repo } = await motorWithQuestion()
    const session = motor.startSession(null)
    const p = await firstQuestion(motor, session)
    await motor.answerQuestion(session, p, { initialSelectedOptionId: p.revision.correctOptionId, selectedOptionId: p.revision.correctOptionId, confidence: 'sure', responseTimeMs: 100 })
    const normalDue = motor.memory.get(p.atom.id)!.due
    clock.wallMs = T0 + 30 * DAY // cihaz saati ileri
    clock.advance(11 * MIN)
    const p2 = (await motor.next(session)) as Extract<Presentation, { kind: 'recall' | 'question' }>
    expect(p2.kind).toBe('recall') // dönüşüm
    const { attempt: skewed } = await motor.answerRecall(session, p2 as Extract<Presentation, { kind: 'recall' }>, { selfAssessment: 'good', hookShown: false, responseTimeMs: 100 })
    expect(Date.parse(skewed.timestamp)).toBeGreaterThan(T0 + 29 * DAY)
    clock.wallMs = T0 + 20 * MIN // saat düzeltildi
    const report = motor.clockSkew()
    expect(report.warning).toBe(true)
    expect(report.futureDated.map((a) => a.id)).toEqual([skewed.id])
    expect(report.lastReviewAhead).toBe(1)
    expect(Date.parse(motor.memory.get(p.atom.id)!.due)).toBeGreaterThan(T0 + 29 * DAY) // sessiz düzeltme yok
    const today = await motor.today()
    expect(today.skew.futureDated).toHaveLength(1)
    // kullanıcı kararı: geçersiz kıl
    await motor.voidClockSkew([skewed.id])
    const voids = await repo.listVoids()
    expect(voids).toHaveLength(1)
    expect(voids[0]).toMatchObject({ targetAttemptId: skewed.id, reason: 'clock_skew' })
    expect((await repo.listAttempts()).map((a) => a.id)).toContain(skewed.id) // Attempt silinmez
    expect(motor.memory.get(p.atom.id)!.due).toBe(normalDue) // kırpma o kaydı görmez, vade normale döndü
    expect(motor.clockSkew().warning).toBe(false)
  })

  it('U-DS-07/12 bağlantısı — Motor.next bütçe bitince end/budget ve dueSoon sayısı döner (03 §6.4)', async () => {
    const { motor, clock } = await motorWithQuestion()
    const session = motor.startSession(3 * MIN)
    const p = await firstQuestion(motor, session)
    await motor.answerQuestion(session, p, { initialSelectedOptionId: p.revision.correctOptionId, selectedOptionId: p.revision.correctOptionId, confidence: 'sure', responseTimeMs: 100 })
    clock.advance(3 * MIN)
    const end = await motor.next(session)
    expect(end).toMatchObject({ kind: 'end', reason: 'budget', dueSoon: 1 }) // 10 dk sonra vadeye düşecek atom
  })

  it('A-03 — motor testleri bellek içi Repository ile çalışır; A-04 — HashService sahtesiyle yedek doğrulama çalışır', async () => {
    const { motor, repo } = await motorWithQuestion()
    const session = motor.startSession(null)
    const p = await firstQuestion(motor, session)
    await motor.answerQuestion(session, p, { initialSelectedOptionId: p.revision.correctOptionId, selectedOptionId: p.revision.correctOptionId, confidence: 'sure', responseTimeMs: 100 })
    const snap = await repo.snapshotAll()
    const fakeHash: HashService = { sha256Hex: async (t) => `fake-${t.length}` }
    const file: BackupFile = { backupFormatVersion: BACKUP_FORMAT_VERSION, backupId: 'b-1', createdAt: iso(T0), appVersion: '0.2.0', schemaVersion: 2, platform: 'pwa', ...snap, derived: null }
    file.checksum = await computeChecksum(file, fakeHash)
    expect(file.checksum.value.startsWith('fake-')).toBe(true)
    const ok = await validateBackupFile(file, fakeHash, iso(T0))
    expect(ok.ok).toBe(true)
    // gerçek Web Crypto ile de
    const real = new WebCryptoHashService()
    const file2 = { ...file }
    file2.checksum = await computeChecksum(file2, real)
    expect((await validateBackupFile(file2, real, iso(T0))).ok).toBe(true)
    // bozuk hash → red; kurtarma dökümü → red; ileri format → red
    const bad = { ...file2, checksum: { ...file2.checksum!, value: '00' } }
    const r1 = await validateBackupFile(bad, real, iso(T0))
    expect(r1.ok).toBe(false)
    expect(!r1.ok && r1.errors[0]).toMatch(/Sağlama toplamı/)
    const r2 = await validateBackupText(JSON.stringify({ kind: 'recovery_dump' }), real, iso(T0))
    expect(!r2.ok && r2.errors[0]).toMatch(/kurtarma dökümü/)
    const r3 = await validateBackupFile({ ...file2, backupFormatVersion: 99 }, real, iso(T0))
    expect(!r3.ok && r3.errors[0]).toMatch(/daha yeni/)
  })

  describe('I-21 — çoklu bağlam değişiklik algılama (Dexie)', () => {
    const names: string[] = []
    afterEach(async () => { for (const n of names.splice(0)) await Dexie.delete(n) })

    it('iki motor aynı DB\'de; biri Attempt yazar; diğeri meta.sequence farkını görür → yükler, REBUILD; MemoryState eşit', async () => {
      const name = uniqueDbName('multi'); names.push(name)
      const clock = new FakeClock()
      const repoA = await DexieRepository.open({ name, ids: testIds(), now: () => clock.now() })
      const repoB = await DexieRepository.open({ name, ids: testIds(), now: () => clock.now() })
      try {
        const motorA = await Motor.create({ repo: repoA, clock, ids: fakeIds('a') })
        const atom = await motorA.addAtom({ subjectName: 'S', topicName: 'T', text: 'Atom.', prompt: 'Atom?' })
        const motorB = await Motor.create({ repo: repoB, clock, ids: fakeIds('b') })
        expect(motorB.memory.size).toBe(0)
        const sessionA = motorA.startSession(null)
        const read = await motorA.next(sessionA)
        expect(read.kind).toBe('read')
        const pres = (await motorA.presentAtom(atom.id)) as Extract<Presentation, { kind: 'recall' }>
        await motorA.answerRecall(sessionA, pres, { selfAssessment: 'good', hookShown: false, responseTimeMs: 100 })
        expect(motorB.memory.size).toBe(0) // henüz görmedi
        expect(await motorB.checkExternalChanges()).toBe(true) // odak kazandı → fark gördü
        expect(serializeMemory(motorB.memory)).toBe(serializeMemory(motorA.memory))
        expect(await motorB.checkExternalChanges()).toBe(false)
        const q = (await repoB.listAttempts())[0] as QuestionAttempt | undefined
        expect(q?.sequence).toBe(1)
      } finally {
        repoA.close(); repoB.close()
      }
    })
  })
})
