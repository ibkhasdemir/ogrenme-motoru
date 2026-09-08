// İlerleme özeti (BL-42) — SAF sayım. Ham olaylardan (Attempt + AttemptVoid) türetilir; hiçbir şey saklanmaz, hiçbir vade
// etkilenmez, kuyruk sırası değişmez (A20: ne çalışılacağına motor karar verir; bu ekran yalnız okur).
// Uydurulmuş skor/indeks YOKTUR: yalnız sayılan şeyler gösterilir (10 §1 "Mastery Score / kalibrasyon skoru" yasağı korunur).
import type { Atom, Attempt, AttemptVoid, QuestionAttempt, RecallAttempt, Subject, Topic } from '../../domain'

/** Bir denemenin "başarılı" sayılıp sayılmadığı: soru → doğru; kart → hatırladım/zorlandım (again değil). */
export function isSuccess(a: Attempt): boolean {
  return a.kind === 'question' ? (a as QuestionAttempt).correct : (a as RecallAttempt).selfAssessment !== 'again'
}

/** "Emindim ama yanlış" — 01 §4.3 yapılandırılmış alanlarla; en tehlikeli sınıf (yanlış inanç). */
export function isSureButWrong(a: Attempt): boolean {
  if (a.kind === 'question') return !(a as QuestionAttempt).correct && a.confidence === 'sure'
  return (a as RecallAttempt).selfAssessment === 'again' && (a as RecallAttempt).confidenceAtFailure === 'sure'
}

export interface AtomStat {
  atomId: string
  answered: number
  failed: number
  sureButWrong: number
  external: number
  /** en son denemeden bu yana üst üste başarısızlık */
  failStreak: number
  lastAt: string | null
}

export interface TopicStat {
  topicId: string
  label: string
  atoms: number
  studiedAtoms: number
  answered: number
  failed: number
  sureButWrong: number
}

export interface ProgressSummary {
  answered: number
  failed: number
  sureButWrong: number
  activeDays: number
  firstAt: string | null
  lastAt: string | null
}

export interface AnalysisInput {
  attempts: readonly Attempt[]
  voids: readonly AttemptVoid[]
  atoms: readonly Atom[]
  topics: readonly Topic[]
  subjects: readonly Subject[]
  /** pencere sınırı (ISO) — uygulama katmanı hesaplar; motorda gün/dakika sabiti bulunmaz (08 U-SC-14). null/verilmezse tümü. */
  since?: string | null
}

/** Geçersiz kılınan denemeler hiçbir sayıma girmez (03 §6.5: void edilen ölçüm yok sayılır). */
export function liveAttempts(attempts: readonly Attempt[], voids: readonly AttemptVoid[], since?: string | null): Attempt[] {
  const voided = new Set(voids.map((v) => v.targetAttemptId))
  return attempts.filter((a) => !voided.has(a.id) && a.mode !== 'pretest' && (!since || a.timestamp >= since))
}

export function summarize(input: AnalysisInput): ProgressSummary {
  const list = liveAttempts(input.attempts, input.voids, input.since)
  const days = new Set(list.map((a) => a.timestamp.slice(0, 10)))
  return {
    answered: list.length,
    failed: list.filter((a) => !isSuccess(a)).length,
    sureButWrong: list.filter(isSureButWrong).length,
    activeDays: days.size,
    firstAt: list.length ? list.reduce((m, a) => (a.timestamp < m ? a.timestamp : m), list[0]!.timestamp) : null,
    lastAt: list.length ? list.reduce((m, a) => (a.timestamp > m ? a.timestamp : m), list[0]!.timestamp) : null,
  }
}

/** Atom başına sayım; `failStreak` son denemeden geriye doğru kesintisiz başarısızlık sayısıdır. */
export function atomStats(input: AnalysisInput): AtomStat[] {
  const list = liveAttempts(input.attempts, input.voids, input.since)
  const byAtom = new Map<string, Attempt[]>()
  for (const a of list) {
    const arr = byAtom.get(a.primaryAtomIdAtAttempt) ?? []
    arr.push(a)
    byAtom.set(a.primaryAtomIdAtAttempt, arr)
  }
  const out: AtomStat[] = []
  for (const [atomId, arr] of byAtom) {
    arr.sort((x, y) => x.sequence - y.sequence)
    let failStreak = 0
    for (let i = arr.length - 1; i >= 0; i--) {
      if (isSuccess(arr[i]!)) break
      failStreak++
    }
    out.push({
      atomId,
      answered: arr.length,
      failed: arr.filter((a) => !isSuccess(a)).length,
      sureButWrong: arr.filter(isSureButWrong).length,
      external: arr.filter((a) => a.mode === 'external').length,
      failStreak,
      lastAt: arr[arr.length - 1]!.timestamp,
    })
  }
  return out
}

/** Zorlanılan atomlar: önce üst üste başarısızlık, sonra toplam başarısızlık, sonra son deneme (yeni önce). */
export function hardestAtoms(stats: readonly AtomStat[], limit = 10): AtomStat[] {
  return stats.filter((s) => s.failed > 0)
    .sort((a, b) => b.failStreak - a.failStreak || b.failed - a.failed || (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.atomId.localeCompare(b.atomId))
    .slice(0, limit)
}

/** "Emindim ama yanlıştı" listesi — yanlış inanç adayları (01 §4.3). */
export function sureButWrongAtoms(stats: readonly AtomStat[], limit = 10): AtomStat[] {
  return stats.filter((s) => s.sureButWrong > 0)
    .sort((a, b) => b.sureButWrong - a.sureButWrong || (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.atomId.localeCompare(b.atomId))
    .slice(0, limit)
}

/** Konu (Ders › Konu) başına toplam; çalışılmamış atomlar da sayılır ki kapsam görünsün. */
export function topicStats(input: AnalysisInput, stats: readonly AtomStat[]): TopicStat[] {
  const byId = new Map(stats.map((s) => [s.atomId, s]))
  const out = new Map<string, TopicStat>()
  for (const atom of input.atoms) {
    if (atom.archived) continue
    const topic = input.topics.find((t) => t.id === atom.topicId)
    const subject = topic ? input.subjects.find((s) => s.id === topic.subjectId) : undefined
    const label = [subject?.name, topic?.name].filter(Boolean).join(' › ') || 'Konusuz'
    const cur = out.get(atom.topicId) ?? { topicId: atom.topicId, label, atoms: 0, studiedAtoms: 0, answered: 0, failed: 0, sureButWrong: 0 }
    cur.atoms++
    const s = byId.get(atom.id)
    if (s) {
      cur.studiedAtoms++
      cur.answered += s.answered
      cur.failed += s.failed
      cur.sureButWrong += s.sureButWrong
    }
    out.set(atom.topicId, cur)
  }
  return [...out.values()].sort((a, b) => b.failed - a.failed || b.answered - a.answered || a.label.localeCompare(b.label, 'tr'))
}

/** Yüzde metni; payda küçükse sayı gösterilmez (gürültüyü "oran" gibi sunmamak için). */
export const MIN_FOR_RATE = 5
export function successRate(answered: number, failed: number): number | null {
  if (answered < MIN_FOR_RATE) return null
  return Math.round(((answered - failed) / answered) * 100)
}
