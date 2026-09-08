// 07 S12 "Yedek al" bölümü (Phase 10a). Geri yükleme / kurtarma noktaları / sıfırlama Phase 10c'de eklenir (11 kural 31).
import { backupReminder, prepareBackup, recordExternalBackup, saveBackup, type BackupReminder, type PreparedBackup } from '../app/backup'
import type { BackupFileService, HashService } from '../platform/services'
import type { AppContext } from './app'
import { button, formatDateTr, h } from './dom'

export interface BackupServices {
  files: BackupFileService
  hash: HashService
}

export const BACKUP_NOTE = 'Yedek dosyası telefondan bağımsızdır; tarayıcı verisi silinse bile geri yükler. Kurtarma noktaları ise bu cihazın içindedir ve tarayıcı verisiyle birlikte silinebilir.'

export async function currentReminder(ctx: AppContext): Promise<BackupReminder> {
  const repo = ctx.motor.repo
  const [sequence, generationId, generationStartSequence, lastExternalBackupAt, lastExternalBackupSequence, lastExternalBackupGenerationId] = await Promise.all([
    repo.getMeta('sequence'), repo.getMeta('generationId'), repo.getMeta('generationStartSequence'),
    repo.getMeta('lastExternalBackupAt'), repo.getMeta('lastExternalBackupSequence'), repo.getMeta('lastExternalBackupGenerationId'),
  ])
  const first = ctx.motor.listAttempts()[0]?.timestamp ?? null
  return backupReminder({ sequence, generationId, generationStartSequence, lastExternalBackupAt, lastExternalBackupSequence, lastExternalBackupGenerationId }, ctx.motor.clock.now(), first)
}

/** Bugün ekranı tek satır (06 §10, BL-18): null → "Yedek durumu bilinmiyor · Yedek al"; eşik aşıldıysa sayılar. */
export function reminderLine(r: BackupReminder): string | null {
  if (r.status === 'unknown') return 'Yedek durumu bilinmiyor'
  if (r.status === 'due') return `Son yedek ${r.daysSince} gün önce · ${r.newEvents} yeni kayıt`
  return null
}

/** Phase 10c bu değişkeni kullanarak bekleyen teyidi ekranlar arasında taşır. */
export interface BackupSectionState {
  pendingConfirm: PreparedBackup | null
  lastMessage: string | null
}

export function renderBackupSection(ctx: AppContext, services: BackupServices, state: BackupSectionState, reminder: BackupReminder): HTMLElement {
  const deps = { repo: ctx.motor.repo, clock: ctx.motor.clock, ids: ctx.motor.ids, hash: services.hash, appVersion: ctx.appVersion }
  const status = reminder.lastBackupAt
    ? `Son yedek: ${formatDateTr(reminder.lastBackupAt)} · ${reminder.newEvents} yeni öğrenme olayı o zamandan beri.`
    : `Yedek durumu bilinmiyor · ${reminder.newEvents} öğrenme olayı yedeklenmemiş olabilir.`
  const takeBackup = async () => {
    try {
      const out = await saveBackup(deps, services.files)
      state.pendingConfirm = null
      if (out.result === 'saved') state.lastMessage = `Yedek alındı. (${out.prepared.name})`
      else if (out.result === 'initiated') { state.pendingConfirm = out.prepared; state.lastMessage = `İndirme başlatıldı. Dosyanın kaydedildiğini doğrula. (${out.prepared.name})` }
      else if (out.result === 'cancelled') state.lastMessage = null
      else state.lastMessage = 'Yedek kaydedilemedi. Mevcut verine dokunulmadı; yeniden dene.'
    } catch (e) {
      state.lastMessage = `Yedek alınamadı: ${(e as Error).message}`
    }
    await ctx.render()
  }
  const confirmSaved = async () => {
    if (!state.pendingConfirm) return
    const ok = await recordExternalBackup(ctx.motor.repo, state.pendingConfirm, ctx.motor.clock.now())
    state.lastMessage = ok ? 'Yedek alındı.' : 'Teyit uygulanmadı: veri nesli değişti (geri yükleme/sıfırlama yapıldı). Yeni yedek al.'
    state.pendingConfirm = null
    await ctx.render()
  }
  return h('section', { class: 'card stack', 'data-section': 'backup' },
    h('h2', { class: 'text-section' }, 'Yedek al'),
    h('p', { class: 'text-body', 'data-testid': 'backup-status' }, status),
    state.lastMessage ? h('div', { class: `notice ${state.lastMessage.startsWith('Yedek alındı') ? 'notice-ok' : ''}`, role: 'status', 'data-testid': 'backup-message' }, state.lastMessage) : null,
    button('Yedek al', () => void takeBackup(), { variant: 'primary', testid: 'take-backup' }),
    state.pendingConfirm ? button('Kaydettim', () => void confirmSaved(), { testid: 'confirm-saved' }) : null,
    state.pendingConfirm ? h('p', { class: 'text-support' }, 'Teyit gelmezse yedek durumu "doğrulanmamış" kalır.') : null,
    h('p', { class: 'text-support' }, BACKUP_NOTE),
  )
}

export { prepareBackup }
