// 07 S12 — Yedekten geri yükle · Kurtarma noktaları · Tüm veriyi sıfırla (Phase 10c). Yıkıcı yol yalnız kurtarma noktası çekirdeği
// yeşilken açılır (11 kural 31). Kullanıcı dili teknik değildir.
import { commitRestore, prepareRestore, resetAllData, type PreparedRestore, type RestoreDeps, type RestoreOutcome } from '../app/restore'
import type { RestoreJournal } from '../store/recovery/journal'
import type { RecoveryPointRecord, RecoveryReason, RecoveryStore } from '../store/recovery/recoveryStore'
import type { AppContext } from './app'
import type { BackupServices } from './dataBackup'
import { button, formatDateTimeTr, formatDateTr, h } from './dom'

export interface RestoreServices extends BackupServices {
  recovery: RecoveryStore
  journal: RestoreJournal
}

export type RestoreUiState =
  | { step: 'idle'; message: string | null; error: string | null }
  | { step: 'validating' }
  | { step: 'prepared'; prepared: PreparedRestore; sourceLabel: string }
  | { step: 'running'; text: string }
  | { step: 'done'; counts: { atoms: number; questions: number; attempts: number } }
  | { step: 'reset-confirm-1' }
  | { step: 'reset-confirm-2' }

export const REASON_LABEL: Record<RecoveryReason, string> = {
  pre_restore: 'Geri yükleme öncesi', pre_import: 'İçe aktarma öncesi', pre_reset: 'Sıfırlama öncesi', pre_migration: 'Sürüm geçişi öncesi',
  post_migration: 'Sürüm geçişi sonrası', daily: 'Günlük', manual: 'Elle',
}

export const MSG_INVALID = 'Yedek doğrulanamadı. Mevcut verine dokunulmadı.'
export const MSG_REPLACE = 'Mevcut verin bu yedekle değiştirilecek.'
export const MSG_POINT_NOTE = 'Bu noktalar cihazın içindedir; tarayıcı verisi silinirse kaybolur. Kalıcı koruma için Yedek al.'

export function restoreDeps(ctx: AppContext, s: RestoreServices): RestoreDeps {
  return { repo: ctx.motor.repo, clock: ctx.motor.clock, ids: ctx.motor.ids, hash: s.hash, appVersion: ctx.appVersion, recovery: s.recovery, journal: s.journal, installedConfig: ctx.motor.schedulerConfig }
}

export function renderRestoreSections(ctx: AppContext, s: RestoreServices, state: { restore: RestoreUiState }, points: RecoveryPointRecord[]): HTMLElement[] {
  const set = async (next: RestoreUiState) => { state.restore = next; await ctx.render() }
  const deps = restoreDeps(ctx, s)

  const prepare = async (source: Parameters<typeof prepareRestore>[1], sourceLabel: string) => {
    await set({ step: 'validating' })
    const r = await prepareRestore(deps, source)
    if (!r.ok) return set({ step: 'idle', message: null, error: `${MSG_INVALID} (${r.errors[0] ?? 'bilinmeyen hata'})` })
    await set({ step: 'prepared', prepared: r, sourceLabel })
  }

  const pickFile = async () => {
    const picked = await s.files.pick()
    if (!picked) return
    await prepare({ kind: 'file', text: picked.content }, picked.name)
  }

  const commit = async (prepared: PreparedRestore) => {
    await set({ step: 'running', text: 'Kurtarma noktası alınıyor…' })
    const stepper: RestoreDeps = { ...deps, hooks: { afterCommit: async () => { state.restore = { step: 'running', text: 'Geri yükleniyor…' }; await ctx.render() } } }
    const out = await commitRestore(stepper, prepared)
    await handleOutcome(out)
  }

  const handleOutcome = async (out: RestoreOutcome) => {
    if (out.ok) {
      await ctx.afterDataReplaced()
      return set({ step: 'done', counts: { atoms: out.verified.atoms, questions: out.verified.questions, attempts: out.verified.attempts } })
    }
    if (out.stage === 'pre_point' || out.stage === 'commit') return set({ step: 'idle', message: null, error: `${out.error}. Mevcut verine dokunulmadı.` })
    if (out.rolledBack) { await ctx.afterDataReplaced(); return set({ step: 'idle', message: null, error: 'Geri yükleme tamamlanamadı. Önceki durumuna dönüldü.' }) }
    if (out.lockdown) return ctx.lockdown(out.error, out.jobId)
    return set({ step: 'idle', message: null, error: out.error })
  }

  const restoreBody = (): HTMLElement[] => {
    const st = state.restore
    switch (st.step) {
      case 'validating': return [h('p', { class: 'text-body', role: 'status' }, 'Doğrulanıyor…')]
      case 'running': return [h('p', { class: 'text-body', role: 'status' }, st.text)]
      case 'done': return [
        h('p', { class: 'notice notice-ok', role: 'status', 'data-testid': 'restore-done' }, `Doğrulandı: ${st.counts.atoms} atom, ${st.counts.questions} soru, ${st.counts.attempts.toLocaleString('tr-TR')} öğrenme olayı.`),
        button("Bugün'e dön", async () => { state.restore = { step: 'idle', message: null, error: null }; await ctx.navigate({ name: 'today' }) }, { variant: 'primary' }),
      ]
      case 'prepared': {
        const p = st.prepared
        return [
          h('div', { class: 'stack', 'data-testid': 'restore-summary' },
            h('p', { class: 'text-body' }, `Kaynak: ${st.sourceLabel}`),
            h('p', { class: 'text-body' }, `Yedek tarihi: ${formatDateTimeTr(p.summary.createdAt)} · uygulama ${p.summary.appVersion} · şema ${p.summary.schemaVersion}`),
            h('p', { class: 'text-body' }, `${p.summary.counts.atoms} atom · ${p.summary.counts.questions} soru · ${p.summary.counts.attempts.toLocaleString('tr-TR')} öğrenme olayı`),
            ...p.summary.warnings.map((w) => h('div', { class: 'notice' }, w)),
            h('p', { class: 'text-body' }, MSG_REPLACE),
          ),
          button('Bu yedeğe geri dön', () => void commit(p), { variant: 'primary', testid: 'restore-confirm' }),
          button('Vazgeç', () => void set({ step: 'idle', message: null, error: null }), { variant: 'quiet' }),
        ]
      }
      default: {
        const idle = st.step === 'idle' ? st : null
        const out: HTMLElement[] = []
        if (idle?.error) out.push(h('div', { class: 'notice notice-error', role: 'alert', 'data-testid': 'restore-error' }, idle.error))
        if (idle?.message) out.push(h('div', { class: 'notice notice-ok', role: 'status', 'data-testid': 'restore-message' }, idle.message))
        out.push(button('Dosya seç', () => void pickFile(), { testid: 'restore-pick' }))
        return out
      }
    }
  }

  const restoreSection = h('section', { class: 'card stack', 'data-section': 'restore' },
    h('h2', { class: 'text-section' }, 'Yedekten geri yükle'),
    ...restoreBody(),
  )

  const pointsSection = h('section', { class: 'card stack', 'data-section': 'recovery-points' },
    h('h2', { class: 'text-section' }, 'Kurtarma noktaları'),
    h('p', { class: 'text-support' }, MSG_POINT_NOTE),
    points.length
      ? h('ul', { class: 'stack' }, [...points].reverse().map((p) => h('li', { class: 'list-item', 'data-point': p.id },
        h('span', { class: 'stack' },
          h('span', { class: 'text-body' }, `${formatDateTr(p.createdAt)} · ${REASON_LABEL[p.reason]}`),
          h('span', { class: 'text-meta' }, `${p.counts.atoms} atom · ${p.counts.attempts} öğrenme olayı`),
        ),
        state.restore.step === 'idle' ? button('Bu noktaya dön', () => void prepare({ kind: 'point', pointId: p.id }, `${REASON_LABEL[p.reason]} (${formatDateTimeTr(p.createdAt)})`), { class: 'btn-inline', testid: `restore-point-${p.id}` }) : null,
      )))
      : h('p', { class: 'text-support' }, 'Henüz kurtarma noktası yok.'),
  )

  return [restoreSection, pointsSection]
}

/** Motor bölümünün altında: "Tüm veriyi sıfırla" — yalnız burada, iki onay, öncesinde otomatik pre_reset noktası. */
export function renderResetControls(ctx: AppContext, s: RestoreServices, state: { restore: RestoreUiState }): HTMLElement {
  const set = async (next: RestoreUiState) => { state.restore = next; await ctx.render() }
  const doReset = async () => {
    await set({ step: 'running', text: 'Kurtarma noktası alınıyor…' })
    const out = await resetAllData(restoreDeps(ctx, s))
    if (out.ok) { await ctx.afterDataReplaced(); return set({ step: 'idle', message: 'Tüm veri sıfırlandı. Sıfırlama öncesi kurtarma noktası alındı.', error: null }) }
    if (out.lockdown) return ctx.lockdown(out.error, out.jobId)
    return set({ step: 'idle', message: null, error: `Sıfırlama yapılmadı: ${out.error}` })
  }
  if (state.restore.step === 'reset-confirm-1') {
    return h('div', { class: 'stack' },
      h('p', { class: 'text-body' }, 'Tüm atomlar, sorular ve öğrenme geçmişi bu cihazdan silinecek. Önce otomatik bir kurtarma noktası alınır.'),
      h('div', { class: 'row' }, button('Evet, devam', () => void set({ step: 'reset-confirm-2' }), { variant: 'danger', class: 'btn-inline', testid: 'reset-step-1' }), button('Vazgeç', () => void set({ step: 'idle', message: null, error: null }), { class: 'btn-inline' })),
    )
  }
  if (state.restore.step === 'reset-confirm-2') {
    return h('div', { class: 'stack' },
      h('p', { class: 'text-body' }, 'Son onay: veriyi gerçekten sıfırlamak istiyor musun? Bu işlem kurtarma noktasından geri alınabilir, ama dış yedeğin yoksa önce Yedek al.'),
      h('div', { class: 'row' }, button('Tüm veriyi sıfırla', () => void doReset(), { variant: 'danger', class: 'btn-inline', testid: 'reset-step-2' }), button('Vazgeç', () => void set({ step: 'idle', message: null, error: null }), { class: 'btn-inline' })),
    )
  }
  return button('Tüm veriyi sıfırla', () => void set({ step: 'reset-confirm-1' }), { variant: 'danger', class: 'btn-inline', testid: 'reset' })
}
