import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type { Attempt, LearningAction, OptionAtom, QuestionAttempt } from '../src/domain'
import { EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1, isCompleteRevision } from '../src/domain'
import { buildQuestionAttempt } from '../src/engine/attempts/build'
import { canonicalJson, sortSnapshotArrays } from '../src/engine/backup/canonical'
import { ContentRuleError } from '../src/engine/question/plan'
import { affectedAttemptsByKeyChange } from '../src/engine/question/contentError'
import { applyAttempt, rebuild, serializeMemory, type Memory } from '../src/engine/rebuild/rebuild'
import { resolve } from '../src/engine/resolver/resolve'
import { Session } from '../src/engine/session/session'
import { undoAttempt } from '../src/engine/session/undo'
import { DexieRepository } from '../src/store/dexie/dexieRepository'
import type { Repository } from '../src/store/repository'
import { MIN, T0, atom, fakeIds, iso, liveCtx, makeEngine, type Engine } from './helpers/engineFixture'
import { testIds, uniqueDbName } from './helpers/legacyDb'

// Phase 8 — Resolver (03 §4) + soru sürümü kuralları (01 §2.5–2.8) + K01: U-RS-01…08, U-QR-01/02/04/05, I-QA-01/03/04/05/06/07/09/10.

const OPTS = [{ id: 'o-1', text: '1839' }, { id: 'o-2', text: '1856' }, { id: 'o-3', text: '1876' }]

async function withQuestions(count = 1): Promise<Engine & { resolveNow: (atomId: string) => Promise<LearningAction> }> {
  const e = await makeEngine([atom('atm-A', 1), atom('atm-B', 2), atom('atm-C', 3)])
  for (let i = 1; i <= count; i++) {
    await e.repo.createQuestion({ id: `q-${i}`, primaryAtomId: 'atm-A', source: 'kendi', text: `Soru ${i}?`, createdAt: e.clock.now(), options: OPTS, correctOptionId: 'o-1' })
  }
  const resolveNow = async (atomId: string) => {
    const questions = await e.repo.listQuestions()
    const revs = await Promise.all(questions.map((q) => e.repo.listRevisions(q.id)))
    const all = revs.flat()
    return resolve({ atomId, questions, revisionOf: (qid, v) => all.find((r) => r.questionId === qid && r.version === v), attempts: await e.repo.listAttempts(), memory: e.memory, ids: e.ids })
  }
  return Object.assign(e, { resolveNow })
}

async function answer(e: Engine, action: LearningAction & { kind: 'question' }, selected: string, opts: { replayOf?: string; confidence?: 'sure' | 'unsure' | 'guess' } = {}) {
  const rev = (await e.repo.getRevision(action.questionId, action.questionVersion))!
  const input = buildQuestionAttempt(
    { action, revision: rev, initialSelectedOptionId: selected, selectedOptionId: selected, confidence: opts.confidence ?? 'sure', wrongReason: 'unknown', responseTimeMs: 500 },
    { sessionId: 'ses', timestamp: e.clock.now(), memoryHasAtom: e.memory.has(rev.primaryAtomId ?? ""), ...(opts.replayOf ? { replayOfAttemptId: opts.replayOf } : {}) },
  )
  const stored = await e.repo.appendAttempt(input)
  applyAttempt(e.memory, stored, EVIDENCE_POLICY_V1, e.scheduler)
  return stored as QuestionAttempt
}

describe('Resolver (03 §4)', () => {
  it('U-RS-01 — sorusuz atom → hatırlama kartı (T11)', async () => {
    const e = await withQuestions(1)
    expect(await e.resolveNow('atm-B')).toMatchObject({ kind: 'recall', atomId: 'atm-B' })
  })

  it('U-RS-02 — dönüşüm (T20): soru → attempt question → kart → attempt recall → soru', async () => {
    const e = await withQuestions(1)
    const a1 = await e.resolveNow('atm-A')
    expect(a1.kind).toBe('question')
    await answer(e, a1 as never, 'o-1')
    expect((await e.resolveNow('atm-A')).kind).toBe('recall')
    await e.recall('atm-A', 'good')
    expect((await e.resolveNow('atm-A')).kind).toBe('question')
  })

  it('U-RS-03 — en eski soru: hiç çözülmemiş önce; sonra en küçük lastTrySequence; eşitlikte questionId ASC', async () => {
    const e = await withQuestions(3)
    await answer(e, { kind: 'question', questionId: 'q-2', questionVersion: 1, actionId: 'x1' }, 'o-1')
    await e.recall('atm-A', 'good') // dönüşüm için kart araya girer
    await answer(e, { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId: 'x2' }, 'o-1')
    await e.recall('atm-A', 'good')
    expect(await e.resolveNow('atm-A')).toMatchObject({ kind: 'question', questionId: 'q-3' }) // hiç çözülmemiş
    await answer(e, { kind: 'question', questionId: 'q-3', questionVersion: 1, actionId: 'x3' }, 'o-1')
    await e.recall('atm-A', 'good')
    expect(await e.resolveNow('atm-A')).toMatchObject({ kind: 'question', questionId: 'q-2' }) // en küçük sequence (ilk çözülen)
    // eşitlik: hiç çözülmemiş iki soru → questionId ASC
    const f = await withQuestions(2)
    expect(await f.resolveNow('atm-A')).toMatchObject({ questionId: 'q-1' })
  })

  it('U-RS-04 / I-QA-05 — primaryAtom A→B taşındı → A için kart, B için soru (güncel bağ)', async () => {
    const e = await withQuestions(1)
    expect((await e.resolveNow('atm-A')).kind).toBe('question')
    await e.repo.reviseQuestion('q-1', { primaryAtomId: 'atm-B' }, e.clock.now())
    expect(await e.resolveNow('atm-A')).toMatchObject({ kind: 'recall', atomId: 'atm-A' })
    expect(await e.resolveNow('atm-B')).toMatchObject({ kind: 'question', questionId: 'q-1', questionVersion: 2 })
  })

  it('U-RS-05 — Resolver yazmaz: depo ve memory değişmemiş', async () => {
    const e = await withQuestions(2)
    await e.recall('atm-B', 'good')
    const snapBefore = canonicalJson(sortSnapshotArrays(await e.repo.snapshotAll()))
    const memBefore = serializeMemory(e.memory)
    await e.resolveNow('atm-A'); await e.resolveNow('atm-B'); await e.resolveNow('atm-C')
    expect(canonicalJson(sortSnapshotArrays(await e.repo.snapshotAll()))).toBe(snapBefore)
    expect(serializeMemory(e.memory)).toBe(memBefore)
  })

  it('U-RS-06 — yakınlık sequence ile: cihaz saati geriye alınarak yazılan attempt\'larla rotasyon sequence\'a göre doğru devam eder', async () => {
    const e = await withQuestions(3)
    // saat geriye giderek: q-1 (t=+30dk), q-2 (t=+20dk), q-3 (t=+10dk) — sequence sırası 1,2,3; timestamp sırası ters
    e.clock.wallMs = T0 + 30 * MIN
    await answer(e, { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId: 'y1' }, 'o-1')
    await e.recall('atm-A', 'good')
    e.clock.wallMs = T0 + 20 * MIN
    await answer(e, { kind: 'question', questionId: 'q-2', questionVersion: 1, actionId: 'y2' }, 'o-1')
    await e.recall('atm-A', 'good')
    e.clock.wallMs = T0 + 10 * MIN
    await answer(e, { kind: 'question', questionId: 'q-3', questionVersion: 1, actionId: 'y3' }, 'o-1')
    await e.recall('atm-A', 'good')
    // sequence'a göre en eski deneme q-1 → sıradaki q-1 (timestamp'e göre sıralansaydı q-3 gelirdi)
    expect(await e.resolveNow('atm-A')).toMatchObject({ kind: 'question', questionId: 'q-1' })
  })

  it('U-RS-07 — arşivli soru aday değil; geçmişi ve sürümleri durur; arşiv kalkınca yeniden aday', async () => {
    const e = await withQuestions(1)
    const att = await answer(e, { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId: 'z1' }, 'o-1')
    await e.recall('atm-A', 'good')
    await e.repo.archiveQuestion('q-1')
    expect(await e.resolveNow('atm-A')).toMatchObject({ kind: 'recall' })
    expect((await e.repo.listAttempts()).some((a) => a.id === att.id)).toBe(true)
    expect(await e.repo.listRevisions('q-1')).toHaveLength(1)
    await e.repo.updateQuestionMeta('q-1', { archived: false })
    expect(await e.resolveNow('atm-A')).toMatchObject({ kind: 'question', questionId: 'q-1' })
  })

  it('U-RS-08 — sunulan sürüm sabit: v1 sunulur, sunum sırasında v2 (doğru seçenek değişir); cevap v1\'e göre; undo tekrarı da v1', async () => {
    const e = await withQuestions(1)
    const presented = (await e.resolveNow('atm-A')) as LearningAction & { kind: 'question' }
    expect(presented.questionVersion).toBe(1)
    await e.repo.reviseQuestion('q-1', { correctOptionId: 'o-2' }, e.clock.now()) // başka pencerede v2
    expect((await e.repo.getQuestion('q-1'))!.currentVersion).toBe(2)
    const att = await answer(e, presented, 'o-1')
    expect(att).toMatchObject({ questionVersion: 1, correct: true, primaryAtomIdAtAttempt: 'atm-A' })
    const session = new Session(fakeIds('ses'), e.clock, null)
    const token = session.recordAttempt(att, presented)!
    const out = await undoAttempt(session, token, { repo: e.repo, clock: e.clock, ids: e.ids, policy: EVIDENCE_POLICY_V1, config: SCHEDULER_CONFIG_V1 })
    expect(out).not.toBeNull()
    const replay = session.nextItem(await liveCtx(e))
    expect(replay).toMatchObject({ kind: 'replay', action: { kind: 'question', questionId: 'q-1', questionVersion: 1 } })
  })

  it('content_unavailable_legacy güncel sürüm ise soru aday değil → kart (aday sözleşmesi)', async () => {
    const e = await withQuestions(1)
    // güncel sürüm complete: soru; sahte legacy güncel sürüm revisionOf ile simüle edilir
    const questions = await e.repo.listQuestions()
    const legacy = { questionId: 'q-1', version: 1, integrityStatus: 'content_unavailable_legacy' as const, text: null, options: null, correctOptionId: null, primaryAtomId: 'atm-A', createdAt: null, legacyProvenance: { migratedAt: e.clock.now(), fromSchemaVersion: 1, createdAtSource: 'unknown' as const } }
    const r = resolve({ atomId: 'atm-A', questions, revisionOf: () => legacy, attempts: [], memory: e.memory, ids: e.ids })
    expect(r.kind).toBe('recall')
  })
})

describe('Soru sürümü kuralları (01 §2.5–2.8)', () => {
  it('U-QR-01 — text değişir → v2; v1 fiziksel olarak durur ve içeriği değişmemiştir', async () => {
    const e = await withQuestions(1)
    const v1 = (await e.repo.getRevision('q-1', 1))!
    const out = await e.repo.reviseQuestion('q-1', { text: 'Soru 1 (düzeltildi)?' }, e.clock.now())
    expect(out).toMatchObject({ created: true, contextChanged: true })
    expect(out.revision.version).toBe(2)
    expect(await e.repo.getRevision('q-1', 1)).toEqual(v1)
    expect((await e.repo.getQuestion('q-1'))!.currentVersion).toBe(2)
  })

  it('U-QR-02 — eski attempt eski soruyu çözer: getRevision(q, 1) eski metin/seçenek/doğru/ana atom', async () => {
    const e = await withQuestions(1)
    const att = await answer(e, { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId: 'w1' }, 'o-2')
    await e.repo.reviseQuestion('q-1', { text: 'Yeni metin?', correctOptionId: 'o-3', primaryAtomId: 'atm-B' }, e.clock.now())
    const seen = (await e.repo.getRevision(att.questionId, att.questionVersion))!
    expect(seen).toMatchObject({ version: 1, text: 'Soru 1?', correctOptionId: 'o-1', primaryAtomId: 'atm-A' })
    expect(isCompleteRevision(seen) && seen.options).toEqual(OPTS)
    expect(isCompleteRevision(seen) && seen.options.some((o) => o.id === att.selectedOptionId)).toBe(true)
  })

  it('U-QR-04 — seçenek çıkarma/ekleme geçmişi bozmaz: v1 seçenek kümesi aynı; v1 attempt seçeneği v1\'de çözülür, v2\'de olmaması hata değil', async () => {
    const e = await withQuestions(1)
    const att = await answer(e, { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId: 'w1' }, 'o-3')
    const out = await e.repo.reviseQuestion('q-1', { options: [{ id: 'o-1', text: '1839' }, { id: 'o-2', text: '1856' }, { text: '1908' }] }, e.clock.now())
    expect(out.contextChanged).toBe(false) // yalnız seçenekler değişti
    const v1 = (await e.repo.getRevision('q-1', 1))!
    expect(isCompleteRevision(v1) && v1.options).toEqual(OPTS)
    const v2 = out.revision
    expect(v2.options.map((o) => o.id)).toEqual(['o-1', 'o-2', expect.any(String)])
    expect(v2.options.some((o) => o.id === 'o-3')).toBe(false)
    expect(v2.options[2]!.id).not.toBe('o-3')
    expect(isCompleteRevision(v1) && v1.options.some((o) => o.id === att.selectedOptionId)).toBe(true)
  })

  it('U-QR-05 — metadata değişikliği sürüm üretmez: source/trapType/archived → currentVersion ve revision sayısı aynı; semantik fark yoksa reviseQuestion da üretmez', async () => {
    const e = await withQuestions(1)
    await e.repo.updateQuestionMeta('q-1', { source: 'kitap s.217', trapType: 'tarih karışıklığı' })
    expect((await e.repo.getQuestion('q-1'))!).toMatchObject({ currentVersion: 1, source: 'kitap s.217', trapType: 'tarih karışıklığı' })
    expect(await e.repo.listRevisions('q-1')).toHaveLength(1)
    const same = await e.repo.reviseQuestion('q-1', { text: 'Soru 1?', options: OPTS, correctOptionId: 'o-1' }, e.clock.now())
    expect(same.created).toBe(false)
    expect(await e.repo.listRevisions('q-1')).toHaveLength(1)
  })
})

describe('QuestionAtom / OptionAtom tutarlılığı (01 §2.7–2.8, 06 §5)', () => {
  it('I-QA-01 — primary A→B: Question B; QuestionAtom(primary) B; Revision v1 A; eski Attempt snapshot A; Revision v2 B', async () => {
    const e = await withQuestions(1)
    const att = await answer(e, { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId: 'w1' }, 'o-1')
    await e.repo.reviseQuestion('q-1', { primaryAtomId: 'atm-B' }, e.clock.now())
    expect((await e.repo.getQuestion('q-1'))!.primaryAtomId).toBe('atm-B')
    expect((await e.repo.listQuestionAtoms()).filter((x) => x.role === 'primary')).toEqual([{ questionId: 'q-1', atomId: 'atm-B', role: 'primary' }])
    expect((await e.repo.getRevision('q-1', 1))!.primaryAtomId).toBe('atm-A')
    expect((await e.repo.getRevision('q-1', 2))!.primaryAtomId).toBe('atm-B')
    expect(att.primaryAtomIdAtAttempt).toBe('atm-A')
    // REBUILD her iki atomu doğru kurar (I-08 çekirdeği): eski deneme A'ya yazılı kalır
    const r = rebuild(await e.repo.listAttempts(), [], EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
    expect(r.memory.has('atm-A')).toBe(true)
    expect(r.memory.has('atm-B')).toBe(false)
  })

  it('I-QA-03 — değişmez: rastgele düzenleme dizisi sonrası her soru için primaryAtomId = currentRevision.primaryAtomId = QuestionAtom(primary)', async () => {
    const e = await withQuestions(3)
    const atoms = ['atm-A', 'atm-B', 'atm-C']
    let seed = 7
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
    for (let i = 0; i < 30; i++) {
      const q = `q-${1 + Math.floor(rnd() * 3)}`
      const kind = Math.floor(rnd() * 4)
      const patch = kind === 0 ? { primaryAtomId: atoms[Math.floor(rnd() * 3)]! } : kind === 1 ? { text: `metin ${i}` } : kind === 2 ? { correctOptionId: OPTS[Math.floor(rnd() * 3)]!.id } : { options: [...OPTS].reverse() }
      await e.repo.reviseQuestion(q, patch, iso(T0 + i * MIN))
    }
    const qas = await e.repo.listQuestionAtoms()
    for (const q of await e.repo.listQuestions()) {
      const rev = (await e.repo.getRevision(q.id, q.currentVersion))!
      const primary = qas.filter((x) => x.questionId === q.id && x.role === 'primary')
      expect(primary).toHaveLength(1)
      expect(q.primaryAtomId).toBe(rev.primaryAtomId)
      expect(primary[0]!.atomId).toBe(q.primaryAtomId)
    }
  })

  it('I-QA-04 — OptionAtom temizliği: v2\'de çıkarılan seçeneğe bağlı OptionAtom silinir; kalan seçeneklerinki korunur (bağlam korundu)', async () => {
    const e = await withQuestions(1)
    const oas: OptionAtom[] = [
      { questionId: 'q-1', optionId: 'o-2', atomId: 'atm-B', relation: 'common_confusion' },
      { questionId: 'q-1', optionId: 'o-3', atomId: 'atm-C', relation: 'trap' },
    ]
    await e.repo.setOptionAtoms('q-1', oas)
    const out = await e.repo.reviseQuestion('q-1', { options: [{ id: 'o-1', text: '1839' }, { id: 'o-2', text: '1856' }] }, e.clock.now())
    expect(out.contextChanged).toBe(false)
    expect(await e.repo.listOptionAtoms()).toEqual([oas[0]])
  })

  it('I-QA-06 / I-QA-07 — seçenek metni değişince yeni optionId; değişmeyenler aynı; v1 eski id/metin; eski OptionAtom yeni seçeneğe yapışmaz', async () => {
    const e = await withQuestions(1)
    await e.repo.setOptionAtoms('q-1', [
      { questionId: 'q-1', optionId: 'o-2', atomId: 'atm-B', relation: 'common_confusion' },
      { questionId: 'q-1', optionId: 'o-3', atomId: 'atm-C', relation: 'trap' },
    ])
    const out = await e.repo.reviseQuestion('q-1', { options: [{ id: 'o-1', text: '1839' }, { id: 'o-2', text: '1856 (Islahat)' }, { id: 'o-3', text: '1876' }] }, e.clock.now())
    const ids = out.revision.options.map((o) => o.id)
    expect(ids[0]).toBe('o-1')
    expect(ids[1]).not.toBe('o-2') // metni değişti → yeni id
    expect(ids[2]).toBe('o-3')
    const v1 = (await e.repo.getRevision('q-1', 1))!
    expect(isCompleteRevision(v1) && v1.options[1]).toEqual({ id: 'o-2', text: '1856' })
    const oasAfter = await e.repo.listOptionAtoms()
    expect(oasAfter).toEqual([{ questionId: 'q-1', optionId: 'o-3', atomId: 'atm-C', relation: 'trap' }]) // o-2'nin ilişkisi silindi, yeni id'ye taşınmadı
    expect(oasAfter.some((oa) => oa.optionId === ids[1])).toBe(false)
  })

  it('I-QA-09 — bağlam değişince ilişkiler sıfırlanır; yalnız sıra değişince korunur; doğru seçeneğe OptionAtom reddedilir', async () => {
    const e = await withQuestions(1)
    await e.repo.setSecondaryAtoms('q-1', ['atm-C'])
    await e.repo.setOptionAtoms('q-1', [{ questionId: 'q-1', optionId: 'o-2', atomId: 'atm-B', relation: 'common_confusion' }])
    // yalnız seçenek sırası değişti → korunur
    const reorder = await e.repo.reviseQuestion('q-1', { options: [{ id: 'o-3', text: '1876' }, { id: 'o-2', text: '1856' }, { id: 'o-1', text: '1839' }] }, e.clock.now())
    expect(reorder).toMatchObject({ created: true, contextChanged: false })
    expect(await e.repo.listOptionAtoms()).toHaveLength(1)
    expect((await e.repo.listQuestionAtoms()).filter((x) => x.role === 'secondary')).toHaveLength(1)
    // "1839'da ilan edilen?" → "1856'da ilan edilen?": metin + doğru seçenek değişti, id'ler aynı → tümü silinir
    const ctx = await e.repo.reviseQuestion('q-1', { text: '1856\'da ilan edilen?', correctOptionId: 'o-2' }, e.clock.now())
    expect(ctx.contextChanged).toBe(true)
    expect(await e.repo.listOptionAtoms()).toEqual([])
    expect((await e.repo.listQuestionAtoms()).filter((x) => x.role === 'secondary')).toEqual([])
    // doğru seçenekte (o-2) yanlış-şık ilişkisi yazılamaz
    await expect(e.repo.setOptionAtoms('q-1', [{ questionId: 'q-1', optionId: 'o-2', atomId: 'atm-B', relation: 'common_confusion' }])).rejects.toBeInstanceOf(ContentRuleError)
  })

  it('I-QA-10 — K01 cevap anahtarı düzeltmesi: etkilenen Attempt content_error ile void; REBUILD o olaysız; ham correct değişmez; yeni Good yok; "Hayır" → void yok', async () => {
    const e = await withQuestions(1)
    // Attempt v1: seçilen o-2 (B), anahtar o-1 (A) → correct=false
    const att = await answer(e, { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId: 'k1' }, 'o-2')
    expect(att.correct).toBe(false)
    const memWithAttempt = serializeMemory(e.memory)
    // "Hayır": yalnız yeni sürüm
    const noOut = await e.repo.reviseQuestion('q-1', { correctOptionId: 'o-2' }, e.clock.now())
    expect(noOut.created).toBe(true)
    expect(await e.repo.listVoids()).toEqual([])
    // önizleme: etkilenen denemeler (yeni anahtara göre doğruluğu farklı çıkanlar)
    const affected = affectedAttemptsByKeyChange(await e.repo.listAttempts(), await e.repo.listVoids(), 'q-1', 2, 'o-3')
    expect(affected).toEqual([]) // o-3 anahtarında da yanlış → farklı değil
    const affected2 = affectedAttemptsByKeyChange(await e.repo.listAttempts(), await e.repo.listVoids(), 'q-1', 2, 'o-2')
    expect(affected2.map((a) => a.id)).toEqual([att.id]) // o-2 anahtarında doğru olurdu → etkilenen
    // "Evet": yeni sürüm + content_error void'leri tek transaction
    const yes = await e.repo.reviseQuestion('q-1', { correctOptionId: 'o-2', text: 'Islahat hangi yıl?' }, e.clock.now(), { attemptIds: affected2.map((a) => a.id), note: 'q-1 v1: eski anahtar hatalıydı' })
    expect(yes.created).toBe(true)
    const voids = await e.repo.listVoids()
    expect(voids).toHaveLength(1)
    expect(voids[0]).toMatchObject({ targetAttemptId: att.id, reason: 'content_error', note: 'q-1 v1: eski anahtar hatalıydı' })
    expect(voids[0]!.sequence).toBe(2) // Attempt ile aynı sayaç
    const stored = (await e.repo.listAttempts()).find((a) => a.id === att.id) as QuestionAttempt
    expect(stored.correct).toBe(false) // ham alan sessizce değiştirilmez
    const r = rebuild(await e.repo.listAttempts(), voids, EVIDENCE_POLICY_V1, SCHEDULER_CONFIG_V1)
    expect(r.memory.has('atm-A')).toBe(false) // o olaysız
    expect(r.reviewEvents).toEqual([]) // yeni Good üretilmedi
    expect(serializeMemory(r.memory)).not.toBe(memWithAttempt)
    // aynı Attempt ikinci kez void edilemez; transaction bütünüyle reddedilir (yeni sürüm de oluşmaz)
    const versionBefore = (await e.repo.getQuestion('q-1'))!.currentVersion
    await expect(e.repo.reviseQuestion('q-1', { text: 'yine' }, e.clock.now(), { attemptIds: [att.id], note: 'x' })).rejects.toThrow()
    expect((await e.repo.getQuestion('q-1'))!.currentVersion).toBe(versionBefore)
  })
})

describe('Dexie ile aynı kurallar (K01 transaction)', () => {
  const names: string[] = []
  afterEach(async () => { for (const n of names.splice(0)) await Dexie.delete(n) })

  it('I-QA-10 (Dexie) — content_error void\'leri revision ile aynı transaction; ortada hata → hiçbiri', async () => {
    const name = uniqueDbName('k01'); names.push(name)
    let armed = false
    const repo: Repository & { close(): void } = await DexieRepository.open({ name, ids: testIds(), now: () => iso(T0), testHooks: { onReviseStep: (s) => { if (armed && s === 'questionAtom') throw new Error('simülasyon') } } })
    try {
      await repo.putSubject({ id: 'sub-1', name: 'S', sortOrder: 1 }); await repo.putTopic({ id: 'top-1', subjectId: 'sub-1', name: 'T', sortOrder: 1 })
      await repo.putAtom(atom('atm-A', 1))
      await repo.createQuestion({ id: 'q-1', primaryAtomId: 'atm-A', source: 'kendi', text: 'S?', createdAt: iso(T0), options: OPTS, correctOptionId: 'o-1' })
      const rev = (await repo.getRevision('q-1', 1))!
      const memory: Memory = new Map()
      const input = buildQuestionAttempt({ action: { kind: 'question', questionId: 'q-1', questionVersion: 1, actionId: 'a1' }, revision: rev, initialSelectedOptionId: 'o-2', selectedOptionId: 'o-2', confidence: 'sure', wrongReason: 'unknown', responseTimeMs: 1 }, { sessionId: 's', timestamp: iso(T0), memoryHasAtom: memory.has('atm-A') })
      const att = await repo.appendAttempt(input)
      armed = true
      await expect(repo.reviseQuestion('q-1', { correctOptionId: 'o-2' }, iso(T0 + MIN), { attemptIds: [att.id], note: 'n' })).rejects.toThrow('simülasyon')
      expect(await repo.listVoids()).toEqual([])
      expect((await repo.getQuestion('q-1'))!.currentVersion).toBe(1)
      expect(await repo.nextSequence()).toBe(2)
      armed = false
      const out = await repo.reviseQuestion('q-1', { correctOptionId: 'o-2' }, iso(T0 + MIN), { attemptIds: [att.id], note: 'n' })
      expect(out.revision.version).toBe(2)
      const voids = await repo.listVoids()
      expect(voids).toHaveLength(1)
      expect(voids[0]).toMatchObject({ targetAttemptId: att.id, reason: 'content_error', sequence: 2 })
      const all: Attempt[] = await repo.listAttempts()
      expect((all[0] as QuestionAttempt).correct).toBe(false)
    } finally {
      repo.close()
    }
  })
})
