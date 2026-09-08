// 03 §4 — Resolver: seçilen atom hangi somut eylemle gösterilir? Hiçbir şey yazmaz. Sunum kararı GÜNCEL Question.primaryAtomId'ye
// bakar; hafıza güncellemesi ise Attempt snapshot'ına (02 §5.6) — iki farklı soru, iki farklı kaynak.
import type { Attempt, LearningAction, Question, QuestionRevision } from '../../domain'
import { isCompleteRevision } from '../../domain'
import type { IdGenerator } from '../../platform/services'
import { compareCodePoint } from '../backup/canonical'
import type { Memory } from '../rebuild/rebuild'

export interface ResolveInput {
  atomId: string
  questions: readonly Question[]
  revisionOf: (questionId: string, version: number) => QuestionRevision | undefined
  /** void'ler dâhil değil; Resolver void'e bakmaz — void edilmiş Attempt da "gösterilmiştir" ve yakınlığa sayılır (03 §4.3) */
  attempts: readonly Attempt[]
  memory: Memory
  ids: IdGenerator
}

export function resolve(input: ResolveInput): LearningAction {
  const { atomId } = input
  // aday sözleşmesi: güncel primary bu atom, arşivli değil, güncel revision complete (content_unavailable_legacy sunulamaz)
  const own = input.questions.filter((q) => {
    if (q.primaryAtomId !== atomId || q.archived) return false
    const rev = input.revisionOf(q.id, q.currentVersion)
    return !!rev && isCompleteRevision(rev)
  })
  if (own.length === 0) return { kind: 'recall', atomId, actionId: input.ids.newId() } // T11: sorusuz atom her zaman kart

  // T20: aynı atom art arda aynı sunumla gelmez (soru → kart → soru → kart)
  if (input.memory.get(atomId)?.lastAttemptKind === 'question') return { kind: 'recall', atomId, actionId: input.ids.newId() }

  // A19: yakınlık timestamp ile değil sequence ile ölçülür
  const lastTry = new Map<string, number>()
  for (const a of input.attempts) {
    if (a.kind !== 'question') continue
    const prev = lastTry.get(a.questionId)
    if (prev === undefined || a.sequence > prev) lastTry.set(a.questionId, a.sequence)
  }
  own.sort((x, y) => {
    const lx = lastTry.get(x.id)
    const ly = lastTry.get(y.id)
    if (lx === undefined && ly !== undefined) return -1 // hiç çözülmemiş önce
    if (lx !== undefined && ly === undefined) return 1
    if (lx !== undefined && ly !== undefined && lx !== ly) return lx - ly // en eski deneme önce
    return compareCodePoint(x.id, y.id)
  })
  const chosen = own[0]!
  // sunum anında sürüm SABİTLENİR (01 §4.2a); cevap bu revision'a göre değerlendirilir
  return { kind: 'question', questionId: chosen.id, questionVersion: chosen.currentVersion, actionId: input.ids.newId() }
}
