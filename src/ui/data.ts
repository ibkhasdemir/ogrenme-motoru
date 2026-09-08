// 07 S12 Veri / Ayarlar — dört bölüm: Yedek al · Yedekten geri yükle · Kurtarma noktaları · Motor (+ Tüm veriyi sıfırla, iki onay).
// Yıkıcı yollar yalnız kurtarma servisleri (RecoveryStore + RestoreJournal) bağlıyken görünür (11 kural 31).
import type { AiSettingsStore } from '../app/aiSettings'
import { SCHEMA_VERSION } from '../store/repository'
import type { AppContext } from './app'
import { currentReminder, renderBackupSection, type BackupSectionState, type BackupServices } from './dataBackup'
import { renderAiSection, type AiSectionState } from './dataAi'
import { renderResetControls, renderRestoreSections, type RestoreServices, type RestoreUiState } from './dataRestore'
import { button, field, formatDateTimeTr, h, input } from './dom'

export interface DataScreenDeps {
  services?: BackupServices
  backupState: BackupSectionState
  restoreState: { restore: RestoreUiState }
  /** BL-44: yapay zekâ ayarları (anahtar cihazda); depo verilmezse bölüm çıkmaz */
  ai?: { store: AiSettingsStore; state: AiSectionState }
}

function hasRestore(s: BackupServices | undefined): s is RestoreServices {
  return !!s && 'recovery' in s && 'journal' in s && !!(s as RestoreServices).recovery && !!(s as RestoreServices).journal
}

export async function renderData(ctx: AppContext, d: DataScreenDeps): Promise<HTMLElement> {
  const m = ctx.motor
  const cfg = m.schedulerConfig
  const skew = m.clockSkew()
  const reviewCapIn = input({ type: 'number', min: 0, step: 1, value: String(m.queueConfig.reviewCap), 'aria-label': 'Günlük tekrar tavanı', inputmode: 'numeric' })
  const newPerDayIn = input({ type: 'number', min: 0, step: 1, value: String(m.queueConfig.newPerDay), 'aria-label': 'Günlük yeni tavanı', inputmode: 'numeric' })
  const saveCaps = async () => {
    try {
      await m.setQueueConfig({ reviewCap: Number(reviewCapIn.value), newPerDay: Number(newPerDayIn.value) })
      ctx.notice('Kuyruk tavanları kaydedildi; yalnız görünürlüğü etkiler, vadeler değişmez.', 'ok')
    } catch (e) {
      ctx.notice(`Tavan kaydedilmedi: ${(e as Error).message}`, 'error')
    }
    await ctx.render()
  }
  const backupSection = d.services ? renderBackupSection(ctx, d.services, d.backupState, await currentReminder(ctx)) : null
  const restoreSections = hasRestore(d.services) ? renderRestoreSections(ctx, d.services, d.restoreState, await d.services.recovery.list()) : []
  const resetControls = hasRestore(d.services) ? renderResetControls(ctx, d.services, d.restoreState) : null
  return h('div', { class: 'screen', 'data-screen': 'data' },
    h('div', { class: 'row' }, button('← Bugün', () => void ctx.navigate({ name: 'today' }), { variant: 'quiet', class: 'btn-inline' }), h('h1', { class: 'text-title' }, 'Veri')),
    backupSection,
    ...restoreSections,
    d.ai ? renderAiSection(ctx, d.ai.store, d.ai.state) : null,
    h('section', { class: 'card stack', 'data-section': 'motor' },
      h('h2', { class: 'text-section' }, 'Motor'),
      button('Hafızayı yeniden hesapla', async () => { await m.refresh(); ctx.notice('Hafıza durumu öğrenme geçmişinden yeniden hesaplandı.', 'ok'); await ctx.render() }, { testid: 'rebuild' }),
      field('Günlük tekrar (reviewCap)', reviewCapIn),
      field('Günlük yeni (newPerDay)', newPerDayIn),
      button('Tavanları kaydet', () => void saveCaps(), { class: 'btn-inline', testid: 'save-caps' }),
      h('p', { class: 'version-line', 'data-testid': 'version-line' }, `uygulama ${ctx.appVersion} · şema ${SCHEMA_VERSION} · ${cfg.engine} ${cfg.engineVersion} · ${cfg.algorithm} · hedef hatırlama ${cfg.requestRetention.toFixed(2)} · fuzz ${cfg.enableFuzz ? 'açık' : 'kapalı'} · policy v${m.policy.policyVersion}`),
      resetControls,
    ),
    skew.futureDated.length
      ? h('section', { class: 'card stack', 'data-section': 'skew' },
        h('h2', { class: 'text-section' }, 'İleri tarihli kayıtlar'),
        h('p', { class: 'text-support' }, 'Cihaz saati ileri alınmışken yazılmış kayıtlar. Geçersiz kılma ham kaydı silmez; hafıza hesabı o kayıtları görmez.'),
        h('ul', { class: 'stack' }, skew.futureDated.map((a) => h('li', { class: 'text-body' }, `${formatDateTimeTr(a.timestamp)} · ${a.kind === 'question' ? 'soru' : 'kart'}`))),
        button('Bu kayıtları geçersiz kıl', async () => { await m.voidClockSkew(skew.futureDated.map((a) => a.id)); ctx.notice(`${skew.futureDated.length} kayıt geçersiz kılındı; vadeler yeniden hesaplandı.`, 'ok'); await ctx.render() }, { variant: 'danger', testid: 'void-skew' }),
      )
      : null,
  )
}
