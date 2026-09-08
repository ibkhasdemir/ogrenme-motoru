import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type { Atom, CompleteQuestionRevision, QuestionAttemptInput, RecallAttemptInput, Subject, Topic } from '../src/domain'
import { EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1 } from '../src/domain'
import { canonicalJson, sortSnapshotArrays } from '../src/engine/backup/canonical'
import { ContentRuleError } from '../src/engine/question/plan'
import { rebuild, serializeMemory } from '../src/engine/rebuild/rebuild'
import { DexieRepository } from '../src/store/dexie/dexieRepository'
import { MemoryRepository, type RepositoryTestHooks } from '../src/store/memory/memoryRepository'
import { AlreadyVoidedError, DuplicateAttemptError, DuplicateRevisionError, UnknownAttemptError, type Repository } from '../src/store/repository'
import { testIds, uniqueDbName } from './helpers/legacyDb'

// Phase 2 — Repository sözleşmesi (06 §2, §3, §5); Memory ve Dexie aynı testlerden geçer (A-03 hazırlığı).

const NOW = '2026-09-08T10:00:00.000Z'
const subject: Subject = { id: 'sub-1', name: 'Tarih', sortOrder: 1 }
const topic: Topic = { id: 'top-1', subjectId: 'sub-1', name: 'Osmanlı', sortOrder: 1 }
const atomA: Atom = { id: 'atm-a', topicId: 'top-1', text: 'Tanzimat 1839', prompt: 'Tanzimat hangi yıl?', facets: ['date'], sortOrder: 1, archived: false, createdAt: NOW }
const atomB: Atom = { id: 'atm-b', topicId: 'top-1', text: 'Islahat 1856', prompt: 'Islahat hangi yıl?', facets: ['date'], sortOrder: 2, archived: false, createdAt: NOW }

const qInput = {
  id: 'q-1', primaryAtomId: 'atm-a', source: 'kendi', text: 'Tanzimat Fermanı hangi yıl ilan edildi?',
  options: [{ id: 'o-1', text: '1839' }, { id: 'o-2', text: '1856' }, { id: 'o-3', text: '1876' }], correctOptionId: 'o-1', createdAt: NOW,
}

const qAttempt = (id: string, atomId = 'atm-a'): QuestionAttemptInput => ({
  id, kind: 'question', timestamp: NOW, sessionId: 'ses-1', primaryAtomIdAtAttempt: atomId, mode: 'new', confidence: 'sure',
  operation: 'discriminate', support: 'choices', responseTimeMs: 3000, wrongReason: null, questionId: 'q-1', questionVersion: 1,
  initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', changedAnswer: false, correct: true,
})
const rAttempt = (id: string, atomId = 'atm-b'): RecallAttemptInput => ({
  id, kind: 'recall', timestamp: NOW, sessionId: 'ses-1', primaryAtomIdAtAttempt: atomId, atomId, mode: 'new', confidence: null,
  operation: 'recall', support: 'none', responseTimeMs: 2000, selfAssessment: 'good',
})

async function seed(repo: Repository) {
  await repo.putSubject(subject)
  await repo.putTopic(topic)
  await repo.putAtom(atomA)
  await repo.putAtom(atomB)
}

interface Harness {
  make(hooks?: RepositoryTestHooks): Promise<Repository>
  reopen?(): Promise<Repository>
  cleanup(): Promise<void>
}

function memoryHarness(): Harness {
  return { make: async (hooks) => new MemoryRepository(testIds(), hooks), cleanup: async () => {} }
}

function dexieHarness(): Harness {
  let name = ''
  const opened: DexieRepository[] = []
  return {
    make: async (hooks) => {
      name = uniqueDbName('test-repo')
      const r = await DexieRepository.open({ name, ids: testIds(), now: () => NOW, testHooks: hooks })
      opened.push(r)
      return r
    },
    reopen: async () => {
      for (const r of opened) r.close()
      const r = await DexieRepository.open({ name, ids: testIds(), now: () => NOW })
      opened.push(r)
      return r
    },
    cleanup: async () => {
      for (const r of opened) r.close()
      if (name) await Dexie.delete(name)
    },
  }
}

describe.each([
  ['MemoryRepository', memoryHarness],
  ['DexieRepository', dexieHarness],
])('%s', (_name, makeHarness) => {
  let h: Harness
  afterEach(async () => { await h?.cleanup() })

  it('U-QR-06 — createQuestion → Question(currentVersion 1) + Revision(v1) + QuestionAtom(primary)', async () => {
    h = makeHarness(); const repo = await h.make(); await seed(repo)
    const out = await repo.createQuestion(qInput)
    expect(out.created).toBe(true)
    const q = await repo.getQuestion('q-1')
    expect(q).toMatchObject({ id: 'q-1', currentVersion: 1, primaryAtomId: 'atm-a', source: 'kendi', archived: false, createdAt: NOW, updatedAt: NOW })
    expect(q as object).not.toHaveProperty('text')
    const rev = await repo.getRevision('q-1', 1)
    expect(rev).toMatchObject({ questionId: 'q-1', version: 1, integrityStatus: 'complete', text: qInput.text, correctOptionId: 'o-1', primaryAtomId: 'atm-a', createdAt: NOW })
    expect(rev!.options).toEqual(qInput.options)
    expect((await repo.listQuestionAtoms()).filter((x) => x.questionId === 'q-1')).toEqual([{ questionId: 'q-1', atomId: 'atm-a', role: 'primary' }])
  })

  it('beş zorunlu alan: eksik/geçersiz giriş reddedilir (kaynak boş, tek seçenek, doğru seçenek yok)', async () => {
    h = makeHarness(); const repo = await h.make(); await seed(repo)
    await expect(repo.createQuestion({ ...qInput, source: '  ' })).rejects.toBeInstanceOf(ContentRuleError)
    await expect(repo.createQuestion({ ...qInput, options: [{ id: 'o-1', text: '1839' }] })).rejects.toBeInstanceOf(ContentRuleError)
    await expect(repo.createQuestion({ ...qInput, correctOptionId: 'o-9' })).rejects.toBeInstanceOf(ContentRuleError)
    await expect(repo.createQuestion({ ...qInput, text: '' })).rejects.toBeInstanceOf(ContentRuleError)
    expect(await repo.listQuestions()).toEqual([])
  })

  it('U-QR-03 — appendRevision aynı (questionId, version) ikinci kez → reddedilir; depo API\'sinde revision update/delete yok', async () => {
    h = makeHarness(); const repo = await h.make(); await seed(repo)
    await repo.createQuestion(qInput)
    const rev = (await repo.getRevision('q-1', 1)) as CompleteQuestionRevision
    await expect(repo.appendRevision({ ...rev, text: 'üzerine yazma denemesi' })).rejects.toBeInstanceOf(DuplicateRevisionError)
    expect((await repo.getRevision('q-1', 1))!.text).toBe(qInput.text)
    for (const m of ['updateRevision', 'deleteRevision', 'putRevision', 'updateAttempt', 'deleteAttempt', 'putAttempt', 'deleteVoid', 'updateVoid']) {
      expect((repo as unknown as Record<string, unknown>)[m]).toBeUndefined()
    }
  })

  it('U-QR-11 (API kısmı) — createQuestion/reviseQuestion yalnız complete revision üretir; legacy statüsü uygulama içinden oluşturulamaz', async () => {
    h = makeHarness(); const repo = await h.make(); await seed(repo)
    await repo.createQuestion(qInput)
    await repo.reviseQuestion('q-1', { text: 'Tanzimat Fermanı hangi yılda ilan edilmiştir?' }, '2026-09-09T10:00:00.000Z')
    const revs = await repo.listRevisions('q-1')
    expect(revs).toHaveLength(2)
    for (const r of revs) expect(r.integrityStatus ?? 'complete').toBe('complete')
  })

  it('I-QA-02 — reviseQuestion tek transaction: 3. adımda hata → hiçbir tablo değişmemiş', async () => {
    h = makeHarness()
    const repo = await h.make({ onReviseStep: (step) => { if (step === 'questionAtom' && armed) throw new Error('simülasyon: QuestionAtom yazımı çöktü') } })
    let armed = false
    await seed(repo)
    await repo.createQuestion(qInput)
    armed = true
    await expect(repo.reviseQuestion('q-1', { primaryAtomId: 'atm-b' }, '2026-09-09T10:00:00.000Z')).rejects.toThrow('simülasyon')
    expect((await repo.getQuestion('q-1'))!).toMatchObject({ currentVersion: 1, primaryAtomId: 'atm-a' })
    expect(await repo.getRevision('q-1', 2)).toBeUndefined()
    expect((await repo.listQuestionAtoms()).filter((x) => x.role === 'primary')).toEqual([{ questionId: 'q-1', atomId: 'atm-a', role: 'primary' }])
  })

  it('I-05 — Attempt değişmez: aynı id ikinci appendAttempt reddedilir; dönen nesne dondurulmuş; sayaç tüketilmez (I-20 çekirdeği)', async () => {
    h = makeHarness(); const repo = await h.make(); await seed(repo)
    await repo.createQuestion(qInput)
    const a = await repo.appendAttempt(qAttempt('att-1'))
    expect(Object.isFrozen(a)).toBe(true)
    expect(a.sequence).toBe(1)
    await expect(repo.appendAttempt(qAttempt('att-1'))).rejects.toBeInstanceOf(DuplicateAttemptError)
    expect(await repo.nextSequence()).toBe(2)
    expect((await repo.listAttempts()).map((x) => x.id)).toEqual(['att-1'])
  })

  it('appendVoid — hedef yoksa reddedilir; aynı hedefe ikinci void reddedilir; Attempt ile aynı sayaç (A19)', async () => {
    h = makeHarness(); const repo = await h.make(); await seed(repo)
    await repo.createQuestion(qInput)
    await repo.appendAttempt(qAttempt('att-1'))
    await expect(repo.appendVoid({ id: 'void-x', targetAttemptId: 'yok', timestamp: NOW, reason: 'undo' })).rejects.toBeInstanceOf(UnknownAttemptError)
    const v = await repo.appendVoid({ id: 'void-1', targetAttemptId: 'att-1', timestamp: NOW, reason: 'undo' })
    expect(v.sequence).toBe(2)
    expect(Object.isFrozen(v)).toBe(true)
    await expect(repo.appendVoid({ id: 'void-2', targetAttemptId: 'att-1', timestamp: NOW, reason: 'undo' })).rejects.toBeInstanceOf(AlreadyVoidedError)
    expect(await repo.nextSequence()).toBe(3)
    expect((await repo.listAttempts()).map((x) => x.id)).toEqual(['att-1']) // Attempt silinmedi (A3)
  })

  it('setOptionAtoms — doğru seçenekte yanlış-şık ilişkisi reddedilir (01 §2.8, B-27 çekirdeği)', async () => {
    h = makeHarness(); const repo = await h.make(); await seed(repo)
    await repo.createQuestion(qInput)
    await expect(repo.setOptionAtoms('q-1', [{ questionId: 'q-1', optionId: 'o-1', atomId: 'atm-b', relation: 'common_confusion' }])).rejects.toBeInstanceOf(ContentRuleError)
    await repo.setOptionAtoms('q-1', [{ questionId: 'q-1', optionId: 'o-2', atomId: 'atm-b', relation: 'common_confusion' }])
    expect(await repo.listOptionAtoms()).toEqual([{ questionId: 'q-1', optionId: 'o-2', atomId: 'atm-b', relation: 'common_confusion' }])
  })

  it('snapshotAll / replaceAll — tam kesit; geri yüklemede sayaç = max sequence, yeni nesil, dış yedek işaretçisi null (06 §3, §10)', async () => {
    h = makeHarness(); const repo = await h.make(); await seed(repo)
    await repo.createQuestion(qInput)
    await repo.appendAttempt(qAttempt('att-1'))
    await repo.appendAttempt(rAttempt('att-2'))
    await repo.appendVoid({ id: 'void-1', targetAttemptId: 'att-2', timestamp: NOW, reason: 'undo' })
    await repo.setMeta('lastExternalBackupAt', NOW)
    const snap = await repo.snapshotAll()
    expect(snap.events.attempts.map((a) => a.sequence)).toEqual([1, 2])
    expect(snap.events.voids).toHaveLength(1)
    expect(snap.content.questionRevisions).toHaveLength(1)
    expect(snap.config.schedulerConfig.engineVersion).toBe('5.4.2')
    expect(snap as object).not.toHaveProperty('meta')

    const target = await h.make(); await target.appendAttempt(rAttempt('zz-1', 'atm-b')).catch(() => {}) // boş depo değil; replaceAll temizler
    const gen = await target.getMeta('generationId')
    await target.replaceAll(snap, { appliedJobId: 'job-1', generationId: 'gen-2', restoreProvenance: { sourceSchemaVersion: 2, sourceFormatVersion: 2, backupId: 'b-1', restoredAt: NOW } })
    expect(await target.nextSequence()).toBe(4)
    expect(await target.getMeta('generationId')).toBe('gen-2')
    expect(await target.getMeta('generationId')).not.toBe(gen)
    expect(await target.getMeta('generationStartSequence')).toBe(3)
    expect(await target.getMeta('lastExternalBackupAt')).toBeNull()
    expect(await target.getMeta('appliedJobId')).toBe('job-1')
    const back = await target.snapshotAll()
    expect(canonicalJson(sortSnapshotArrays(back))).toBe(canonicalJson(sortSnapshotArrays(snap)))
  })

  it('I-14 (depo kısmı) — kalıcılık: yaz → yeni depo örneği aç → attempts sequence [1,2]; sayaç devam (3)', async () => {
    h = makeHarness()
    if (!h.reopen) return // yalnız Dexie
    const repo = await h.make(); await seed(repo)
    await repo.createQuestion(qInput)
    await repo.appendAttempt(qAttempt('att-1'))
    await repo.appendAttempt(rAttempt('att-2'))
    const before = rebuild(await repo.listAttempts(), await repo.listVoids(), EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
    const again = await h.reopen()
    expect((await again.listAttempts()).map((a) => a.sequence)).toEqual([1, 2])
    expect(await again.nextSequence()).toBe(3)
    expect((await again.getRevision('q-1', 1))!.text).toBe(qInput.text)
    // Phase 6 cümlesi: REBUILD eşit
    const after = rebuild(await again.listAttempts(), await again.listVoids(), EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
    expect(serializeMemory(after.memory)).toBe(serializeMemory(before.memory))
    expect(after.memory.size).toBe(2)
  })

  it('I-15 — sayaç artışı ile olay yazımı aynı transaction: olay yazılamazsa sayaç geri alınır', async () => {
    h = makeHarness()
    if (!h.reopen) return // Dexie transaction davranışı
    const repo = await h.make({ onAppendAttempt: () => { throw new Error('simülasyon: olay yazılamadı') } })
    await seed(repo)
    await expect(repo.appendAttempt(rAttempt('att-1'))).rejects.toThrow('simülasyon')
    expect(await repo.nextSequence()).toBe(1)
    expect(await repo.listAttempts()).toEqual([])
  })
})
