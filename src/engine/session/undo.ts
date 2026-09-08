// 02 §7 / 03 §6.5 — Geri al: token'daki SABİT hedef için AttemptVoid + tam REBUILD (bellekte) + tek seferlik düzeltme tekrarı.
// Undo bir scheduler kararı değildir; hiçbir due yazmaz.
import type { AttemptVoid, EvidencePolicy, SchedulerConfig } from '../../domain'
import type { Clock, IdGenerator } from '../../platform/services'
import { AlreadyVoidedError, type Repository } from '../../store/repository'
import { rebuild, type RebuildResult } from '../rebuild/rebuild'
import type { Session, UndoToken } from './session'

export interface UndoDeps {
  repo: Repository
  clock: Clock
  ids: IdGenerator
  policy: EvidencePolicy
  config: SchedulerConfig
}

export interface UndoOutcome {
  void: AttemptVoid
  rebuilt: RebuildResult
}

/**
 * 02 §7 adım 1–3: hedef token'dan; token süresi geçmiş / tüketilmiş / hedef zaten void → null, hiçbir şey olmaz
 * (önceki kayda DÜŞÜLMEZ). Başarıda void yazılır, REBUILD yapılır, oturuma tekrar sunum işlenir.
 */
export async function undoAttempt(session: Session, token: UndoToken, deps: UndoDeps): Promise<UndoOutcome | null> {
  if (token.consumed) return null
  if (deps.clock.monotonicMs() > token.expiresAtMono) return null
  let voided: AttemptVoid
  try {
    voided = await deps.repo.appendVoid({
      id: deps.ids.newId(),
      targetAttemptId: token.targetAttemptId,
      timestamp: deps.clock.now(),
      reason: 'undo',
    })
  } catch (e) {
    if (e instanceof AlreadyVoidedError) return null
    throw e
  }
  token.consumed = true
  // tam REBUILD (tek kaydı geri sarmak yerine deterministik yeniden üretim)
  const rebuilt = rebuild(await deps.repo.listAttempts(), await deps.repo.listVoids(), deps.policy, deps.config)
  session.scheduleReplay(token.action, token.targetAttemptId)
  return { void: voided, rebuilt }
}
