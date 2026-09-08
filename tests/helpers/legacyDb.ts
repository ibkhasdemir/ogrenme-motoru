// Test yardımcısı: schemaVersion 1 (legacy) veritabanı kurulumu (BL-10 varsayımı). Kullanıcı verisi fixture değildir (11 kural 27).
import Dexie from 'dexie'
import { LEGACY_V1_STORES } from '../../src/store/dexie/db'
import type { LegacyQuestionV1 } from '../../src/store/dexie/migration_v1_v2'

export class LegacyV1Db extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(1).stores(LEGACY_V1_STORES)
  }
}

export interface LegacyFixture {
  subjects: unknown[]
  topics: unknown[]
  atoms: unknown[]
  questions: LegacyQuestionV1[]
  attempts: unknown[]
  meta: { key: string; value: unknown }[]
}

export function legacyFixture(): LegacyFixture {
  const t0 = '2026-09-01T09:00:00.000Z'
  const atom = (id: string, sortOrder: number) => ({ id, topicId: 'top-1', text: `${id} metni`, facets: ['fact'], sortOrder, archived: false, createdAt: t0 })
  const opts = [{ id: 'o-1', text: '1839' }, { id: 'o-2', text: '1856' }, { id: 'o-3', text: '1876' }]
  const qAttempt = (id: string, seq: number, questionId: string, questionVersion: number, atomId: string, correct: boolean) => ({
    id, kind: 'question', sequence: seq, timestamp: `2026-09-0${seq}T10:00:00.000Z`, sessionId: 'ses-1', primaryAtomIdAtAttempt: atomId,
    mode: seq === 1 ? 'new' : 'review', confidence: 'sure', operation: 'discriminate', support: 'choices', responseTimeMs: 5000, wrongReason: null,
    questionId, questionVersion, initialSelectedOptionId: 'o-1', selectedOptionId: 'o-1', changedAnswer: false, correct,
  })
  return {
    subjects: [{ id: 'sub-1', name: 'Tarih', sortOrder: 1 }],
    topics: [{ id: 'top-1', subjectId: 'sub-1', name: 'Osmanlı', sortOrder: 1 }],
    atoms: [atom('atm-a', 1), atom('atm-b', 2), atom('atm-c', 3)],
    questions: [
      { id: 'q-1', version: 1, text: 'Tanzimat hangi yıl?', options: opts, correctOptionId: 'o-1', primaryAtomId: 'atm-a', source: 'kendi', archived: false, createdAt: t0 },
      { id: 'q-2', version: 3, text: 'Islahat hangi yıl? (v3)', options: opts, correctOptionId: 'o-2', primaryAtomId: 'atm-b', source: 'kitap', archived: false, createdAt: t0, updatedAt: '2026-09-03T09:00:00.000Z' },
    ],
    attempts: [
      qAttempt('att-1', 1, 'q-1', 1, 'atm-a', true),
      qAttempt('att-2', 2, 'q-2', 3, 'atm-b', true),
      qAttempt('att-3', 3, 'q-2', 1, 'atm-c', false), // v1 içeriği yok → content_unavailable_legacy, primaryAtomId atm-c
      qAttempt('att-4', 4, 'q-2', 2, 'atm-b', true), // v2: iki farklı snapshot atomu → primaryAtomId null
      qAttempt('att-5', 5, 'q-2', 2, 'atm-c', true),
    ],
    meta: [{ key: 'sequence', value: 5 }],
  }
}

export async function seedLegacyV1(name: string, fx: LegacyFixture = legacyFixture()): Promise<void> {
  const db = new LegacyV1Db(name)
  await db.open()
  try {
    await db.table('subjects').bulkAdd(fx.subjects)
    await db.table('topics').bulkAdd(fx.topics)
    await db.table('atoms').bulkAdd(fx.atoms)
    await db.table('questions').bulkAdd(fx.questions)
    await db.table('attempts').bulkAdd(fx.attempts)
    await db.table('meta').bulkAdd(fx.meta)
  } finally {
    db.close()
  }
}

export async function readLegacyV1(name: string): Promise<{ verno: number; questions: unknown[]; attempts: unknown[] }> {
  const db = new LegacyV1Db(name)
  await db.open()
  try {
    return { verno: db.verno, questions: await db.table('questions').toArray(), attempts: await db.table('attempts').toArray() }
  } finally {
    db.close()
  }
}

let counter = 0
export function testIds() {
  let n = 0
  return { newId: () => `id-${++n}` }
}
export function uniqueDbName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${++counter}`
}
