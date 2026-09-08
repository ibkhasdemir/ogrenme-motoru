// 06 §7 — Kanonik JSON: anahtarlar özyinelemeli kod noktası sırasında, boşluksuz; her dizi için tanımlı sıralama anahtarı.
// Depo/platformun kayıt döndürme sırası checksum'ı ve round-trip eşitliğini etkilemez (B-25, B-25b).
import type { BackupSnapshot, HistoryRecord } from './types'

/** Locale bağımsız kod noktası karşılaştırması. */
export function compareCodePoint(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i) as number
    const cb = b.codePointAt(j) as number
    if (ca !== cb) return ca < cb ? -1 : 1
    i += ca > 0xffff ? 2 : 1
    j += cb > 0xffff ? 2 : 1
  }
  const ra = a.length - i
  const rb = b.length - j
  return ra === rb ? 0 : ra < rb ? -1 : 1
}

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return JSON.stringify(value)
    case 'object': {
      const obj = value as Record<string, unknown>
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort(compareCodePoint)
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
    }
    default:
      throw new Error(`canonicalJson: desteklenmeyen tip ${typeof value}`)
  }
}

function cmpVals(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1
  return compareCodePoint(String(a ?? ''), String(b ?? ''))
}

function byKeys<T>(keys: (keyof T)[]): (x: T, y: T) => number {
  return (x, y) => {
    for (const k of keys) {
      const c = cmpVals(x[k], y[k])
      if (c !== 0) return c
    }
    return 0
  }
}

function historyVersion(r: HistoryRecord): number {
  if (r.kind === 'config_snapshot') return r.configVersion ?? r.policyVersion ?? 0
  return r.to.configVersion
}

/** 06 §7: (kind, at, sürüm, tam kaydın kanonik JSON'u) — eşit sürüm/eşit zaman bile deterministik. */
export function compareHistory(a: HistoryRecord, b: HistoryRecord): number {
  return (
    compareCodePoint(a.kind, b.kind) ||
    compareCodePoint(a.at, b.at) ||
    cmpVals(historyVersion(a), historyVersion(b)) ||
    compareCodePoint(canonicalJson(a), canonicalJson(b))
  )
}

const sorted = <T>(xs: readonly T[] | undefined, cmp: (a: T, b: T) => number): T[] => [...(xs ?? [])].sort(cmp)

/** Dizileri 06 §7 tablosundaki anahtarlarla sıralanmış yeni bir snapshot döndürür; tanınmayan alanlar aynen korunur (B-30). */
export function sortSnapshotArrays<T extends BackupSnapshot>(s: T): T {
  const c = s.content
  const e = s.events
  const cfg = s.config
  return {
    ...s,
    config: {
      ...cfg,
      evidencePolicyHistory: sorted(cfg.evidencePolicyHistory, compareHistory),
      schedulerConfigHistory: sorted(cfg.schedulerConfigHistory, compareHistory),
    },
    content: {
      ...c,
      subjects: sorted(c.subjects, byKeys(['id'])),
      topics: sorted(c.topics, byKeys(['id'])),
      atoms: sorted(c.atoms, byKeys(['id'])),
      hooks: sorted(c.hooks, byKeys(['id'])),
      questions: sorted(c.questions, byKeys(['id'])),
      inbox: sorted(c.inbox, byKeys(['id'])),
      questionRevisions: sorted(c.questionRevisions, byKeys(['questionId', 'version'])),
      questionAtoms: sorted(c.questionAtoms, byKeys(['questionId', 'role', 'atomId'])),
      optionAtoms: sorted(c.optionAtoms, byKeys(['questionId', 'optionId', 'atomId', 'relation'])),
      atomRelations: sorted(c.atomRelations, byKeys(['fromAtomId', 'type', 'toAtomId'])),
    },
    events: {
      ...e,
      attempts: sorted(e.attempts, byKeys(['sequence', 'id'])),
      voids: sorted(e.voids, byKeys(['sequence', 'id'])),
    },
  }
}
