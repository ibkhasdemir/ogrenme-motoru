import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalJson, compareCodePoint, sortSnapshotArrays } from '../src/engine/backup/canonical'
import type { BackupSnapshot, HistoryRecord } from '../src/engine/backup/types'
import { WebCryptoHashService } from '../src/platform/web/hash'
import { DexieRecoveryStore, type RecoveryPointRecord } from '../src/store/recovery/recoveryStore'
import { DexieRestoreJournal } from '../src/store/recovery/journal'
import { RecoveryDb } from '../src/store/recovery/recoveryDb'
import { EVIDENCE_POLICY_V1, QUEUE_CONFIG_DEFAULT, SCHEDULER_CONFIG_V1 } from '../src/domain'

// Phase 1b (09): kanonik JSON + HashService + RecoveryStore + RestoreJournal çekirdeği. Arayüz yok.

function snapshotA(): BackupSnapshot {
  return {
    config: {
      evidencePolicy: EVIDENCE_POLICY_V1,
      evidencePolicyHistory: [],
      schedulerConfig: { ...SCHEDULER_CONFIG_V1, resolvedWeights: [1, 2, 3] },
      schedulerConfigHistory: [],
      queueConfig: QUEUE_CONFIG_DEFAULT,
    },
    content: {
      subjects: [{ id: 'sub-2', name: 'Coğrafya', sortOrder: 2 }, { id: 'sub-1', name: 'Tarih', sortOrder: 1 }],
      topics: [{ id: 'top-1', subjectId: 'sub-1', name: 'Osmanlı', sortOrder: 1 }],
      atoms: [
        { id: 'atm-b', topicId: 'top-1', text: 'B', prompt: 'B?', facets: ['date', 'fact'], sortOrder: 2, archived: false, createdAt: '2026-09-07T09:00:00.000Z' },
        { id: 'atm-a', topicId: 'top-1', text: 'A', prompt: 'A?', facets: ['fact'], sortOrder: 1, archived: false, createdAt: '2026-09-07T09:00:00.000Z' },
      ],
      hooks: [],
      questions: [{ id: 'q-1', currentVersion: 2, primaryAtomId: 'atm-a', source: 'kendi', archived: false, createdAt: '2026-09-07T09:05:00.000Z', updatedAt: '2026-09-08T09:05:00.000Z' }],
      questionRevisions: [
        { questionId: 'q-1', version: 2, integrityStatus: 'complete', text: 'v2', options: [{ id: 'o-1', text: '1839' }, { id: 'o-2', text: '1856' }], correctOptionId: 'o-1', primaryAtomId: 'atm-a', createdAt: '2026-09-08T09:05:00.000Z' },
        { questionId: 'q-1', version: 1, integrityStatus: 'complete', text: 'v1', options: [{ id: 'o-1', text: '1839' }, { id: 'o-2', text: '1856' }], correctOptionId: 'o-1', primaryAtomId: 'atm-a', createdAt: '2026-09-07T09:05:00.000Z' },
      ],
      questionAtoms: [{ questionId: 'q-1', atomId: 'atm-b', role: 'secondary' }, { questionId: 'q-1', atomId: 'atm-a', role: 'primary' }],
      optionAtoms: [{ questionId: 'q-1', optionId: 'o-2', atomId: 'atm-b', relation: 'common_confusion' }],
      atomRelations: [{ fromAtomId: 'atm-b', toAtomId: 'atm-a', type: 'confusable' }, { fromAtomId: 'atm-a', toAtomId: 'atm-b', type: 'confusable' }],
      inbox: [],
    },
    events: {
      attempts: [
        { id: 'att-2', kind: 'recall', sequence: 2, timestamp: '2026-09-07T10:14:40.000Z', sessionId: 's', primaryAtomIdAtAttempt: 'atm-b', atomId: 'atm-b', mode: 'new', confidence: null, operation: 'recall', support: 'none', responseTimeMs: 100, selfAssessment: 'good' },
        { id: 'att-1', kind: 'question', sequence: 1, timestamp: '2026-09-07T10:12:03.120Z', sessionId: 's', primaryAtomIdAtAttempt: 'atm-a', mode: 'new', confidence: 'sure', operation: 'discriminate', support: 'choices', responseTimeMs: 8400, wrongReason: null, questionId: 'q-1', questionVersion: 1, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', changedAnswer: false, correct: true },
      ],
      voids: [],
    },
  }
}

/** Aynı veri, her dizi ters sırada ve nesne anahtarları farklı sırada. */
function snapshotB(): BackupSnapshot {
  const a = snapshotA()
  const rev = <T>(xs: T[]) => [...xs].reverse()
  const reorderKeys = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).reverse()) as T
  return {
    events: { voids: rev(a.events.voids), attempts: rev(a.events.attempts).map(reorderKeys) },
    content: {
      inbox: [], atomRelations: rev(a.content.atomRelations), optionAtoms: rev(a.content.optionAtoms),
      questionAtoms: rev(a.content.questionAtoms), questionRevisions: rev(a.content.questionRevisions).map(reorderKeys),
      questions: a.content.questions.map(reorderKeys), hooks: [], atoms: rev(a.content.atoms).map(reorderKeys),
      topics: a.content.topics, subjects: rev(a.content.subjects),
    },
    config: reorderKeys(a.config),
  }
}

describe('canonical JSON (06 §7)', () => {
  it('B-25 — depo sırasından bağımsız: kanonik JSON ve checksum aynı', async () => {
    const ca = canonicalJson(sortSnapshotArrays(snapshotA()))
    const cb = canonicalJson(sortSnapshotArrays(snapshotB()))
    expect(cb).toBe(ca)
    const hash = new WebCryptoHashService()
    expect(await hash.sha256Hex(cb)).toBe(await hash.sha256Hex(ca))
    expect(await hash.sha256Hex(ca)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('kanonik JSON: anahtarlar özyinelemeli alfabetik, boşluksuz, undefined atılır, dizi sırası korunur', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: 'x', u: undefined } })).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}')
    expect(canonicalJson([{ z: 1, y: null }])).toBe('[{"y":null,"z":1}]')
  })

  it('atom.facets ve revision.options yazıldığı sırayı korur (sıra anlam taşır)', () => {
    const s = sortSnapshotArrays(snapshotA())
    expect(s.content.atoms.find((a) => a.id === 'atm-b')!.facets).toEqual(['date', 'fact'])
    expect(s.content.questionRevisions[0]!.options!.map((o) => o.id)).toEqual(['o-1', 'o-2'])
  })

  it('B-25b — geçmiş kayıtları (kind, at, sürüm, tam kayıt) ile deterministik; kod noktası sırası, locale bağımsız', () => {
    const h: HistoryRecord[] = [
      { kind: 'scheduler_migration', at: '2026-09-08T00:00:00.000Z', from: { engine: 'ts-fsrs', engineVersion: '9.9.9', configVersion: 7 }, to: { engine: 'ts-fsrs', engineVersion: '5.4.2', configVersion: 1 }, reason: 'scheduler_migration' },
      { kind: 'config_snapshot', at: '2026-09-02T00:00:00.000Z', configVersion: 1, config: { x: 2 } },
      { kind: 'config_snapshot', at: '2026-09-01T00:00:00.000Z', configVersion: 1, config: { x: 1 } },
      { kind: 'scheduler_migration', at: '2026-09-08T00:00:00.000Z', from: { engine: 'ts-fsrs', engineVersion: '8.0.0', configVersion: 5 }, to: { engine: 'ts-fsrs', engineVersion: '5.4.2', configVersion: 1 }, reason: 'scheduler_migration' },
    ]
    const a = snapshotA(); a.config.schedulerConfigHistory = h
    const b = snapshotA(); b.config.schedulerConfigHistory = [...h].reverse()
    expect(canonicalJson(sortSnapshotArrays(b))).toBe(canonicalJson(sortSnapshotArrays(a)))
    const sorted = sortSnapshotArrays(a).config.schedulerConfigHistory
    expect(sorted.map((r) => r.kind)).toEqual(['config_snapshot', 'config_snapshot', 'scheduler_migration', 'scheduler_migration'])
    expect((sorted[0] as unknown as { config: { x: number } }).config.x).toBe(1)
    // kod noktası sırası: 'Z' (0x5A) < 'a' (0x61) < 'ı' (0x131) < 'ş' (0x15F); locale karşılaştırması bunu bozardı
    expect(['ş', 'a', 'ı', 'Z'].sort(compareCodePoint)).toEqual(['Z', 'a', 'ı', 'ş'])
  })
})

describe('RecoveryStore (06 §9) — ayrı DB, pin, retention', () => {
  let db: RecoveryDb
  let store: DexieRecoveryStore
  let seq = 0

  const point = (reason: RecoveryPointRecord['reason'], n = ++seq): RecoveryPointRecord => ({
    id: `rp-${String(n).padStart(3, '0')}`,
    createdAt: `2026-09-${String(1 + Math.floor(n / 24)).padStart(2, '0')}T${String(n % 24).padStart(2, '0')}:00:00.000Z`,
    reason,
    appVersion: '0.2.0',
    schemaVersion: 2,
    counts: { atoms: 1, questions: 1, attempts: n, voids: 0 },
    payload: `{"n":${n}}`,
    pinnedBy: null,
  })

  beforeEach(async () => {
    seq = 0
    db = new RecoveryDb(`test-recovery-${Math.random().toString(36).slice(2)}`)
    store = new DexieRecoveryStore(db)
  })
  afterEach(async () => {
    await db.delete()
  })

  it('bir nokta yazılır ve geri okunur (payload aynen)', async () => {
    const p = point('manual')
    await store.write(p)
    const back = await store.get(p.id)
    expect(back).toEqual(p)
    expect((await store.list()).map((x) => x.id)).toEqual([p.id])
  })

  it('B-15 — rolling retention: 6 manuel → 5 kalır (en eski silinir); 8 daily → 7 kalır; toplam ≤ 12', async () => {
    for (let i = 0; i < 6; i++) await store.write(point('manual'))
    let all = await store.list()
    expect(all.filter((p) => p.reason === 'manual').map((p) => p.id)).toEqual(['rp-002', 'rp-003', 'rp-004', 'rp-005', 'rp-006'])
    for (let i = 0; i < 8; i++) await store.write(point('daily'))
    all = await store.list()
    expect(all.filter((p) => p.reason === 'daily')).toHaveLength(7)
    expect(all.filter((p) => p.reason === 'daily').map((p) => p.id)).not.toContain('rp-007')
    expect(all.length).toBeLessThanOrEqual(12)
  })

  it('B-28 — retention sınıfları: 3 pre_restore + 2 manual + 2 post_migration + 9 daily → işlem 5, daily 7, toplam 12', async () => {
    for (const r of ['pre_restore', 'pre_restore', 'pre_restore', 'manual', 'manual', 'post_migration', 'post_migration'] as const) await store.write(point(r))
    for (let i = 0; i < 9; i++) await store.write(point('daily'))
    const all = await store.list()
    const op = all.filter((p) => p.reason !== 'daily')
    const daily = all.filter((p) => p.reason === 'daily')
    expect(op).toHaveLength(5)
    expect(daily).toHaveLength(7)
    expect(all).toHaveLength(12)
    // işlem sınıfında en eski iki pre_restore (rp-001, rp-002) silinmiş olmalı
    expect(op.map((p) => p.id)).toEqual(['rp-003', 'rp-004', 'rp-005', 'rp-006', 'rp-007'])
    // her reason tam bir sınıfta
    for (const r of ['pre_restore', 'pre_import', 'pre_reset', 'pre_migration', 'post_migration', 'manual']) expect(store.classOf(r as RecoveryPointRecord['reason'])).toBe('operational')
    expect(store.classOf('daily')).toBe('daily')
  })

  it('B-34 (pin ilkeli) — pin\'li kayıt retention\'da silinmez; pin kalkınca silinebilir', async () => {
    for (let i = 0; i < 5; i++) await store.write(point('pre_restore')) // rp-001..005
    await store.pin('rp-001', 'job-1')
    expect((await store.get('rp-001'))!.pinnedBy).toBe('job-1')
    await store.write(point('pre_restore')) // rp-006 → budanan pin'siz en eski: rp-002
    let ids = (await store.list()).map((p) => p.id)
    expect(ids).toContain('rp-001')
    expect(ids).not.toContain('rp-002')
    expect(ids).toHaveLength(5) // 6 kayıt − budanan p2; pin'li p1 duruyor
    await store.unpinJob('job-1')
    expect((await store.get('rp-001'))!.pinnedBy).toBeNull()
    await store.write(point('pre_restore')) // rp-007 → pin kalktığı için en eski (rp-001) silinir
    ids = (await store.list()).map((p) => p.id)
    expect(ids).not.toContain('rp-001')
    expect(ids).toHaveLength(5)
  })

  it('kota hatasında en eski pin\'siz daily silinip yeniden denenir; yine olmazsa hata fırlatır', async () => {
    await store.write(point('daily'))
    await store.write(point('daily'))
    let calls = 0
    const failing = new DexieRecoveryStore(db, {
      putHook: async () => {
        calls++
        if (calls <= 1) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e }
      },
    })
    await failing.write(point('manual'))
    const ids = (await store.list()).map((p) => p.id)
    expect(ids).not.toContain('rp-001')
    expect(ids).toContain('rp-003')
    const alwaysFailing = new DexieRecoveryStore(db, {
      putHook: async () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e },
    })
    await expect(alwaysFailing.write(point('manual'))).rejects.toThrow()
  })
})

describe('RestoreJournal (06 §8.5) — RJ-01', () => {
  let db: RecoveryDb
  beforeEach(() => { db = new RecoveryDb(`test-journal-${Math.random().toString(36).slice(2)}`) })
  afterEach(async () => { await db.delete() })

  it('yaz / oku / faz güncelle / açık iş listesi', async () => {
    const j = new DexieRestoreJournal(db)
    await j.put({ jobId: 'job-1', kind: 'restore', phase: 'prepared', targetSummary: { atoms: 1, questions: 1, attempts: 3, voids: 0 }, prePointId: null, startedAt: '2026-09-08T10:00:00.000Z', updatedAt: '2026-09-08T10:00:00.000Z' })
    expect((await j.get('job-1'))!.phase).toBe('prepared')
    await j.update('job-1', { prePointId: 'rp-1', phase: 'committed', updatedAt: '2026-09-08T10:00:01.000Z' })
    const e = await j.get('job-1')
    expect(e!.phase).toBe('committed')
    expect(e!.prePointId).toBe('rp-1')
    expect((await j.listOpen()).map((x) => x.jobId)).toEqual(['job-1'])
    await j.update('job-1', { phase: 'verified', updatedAt: '2026-09-08T10:00:02.000Z' })
    expect(await j.listOpen()).toEqual([])
    await j.put({ jobId: 'job-2', kind: 'reset', phase: 'aborted', targetSummary: null, prePointId: 'rp-2', startedAt: 'x', updatedAt: 'x' })
    expect(await j.listOpen()).toEqual([])
  })
})
