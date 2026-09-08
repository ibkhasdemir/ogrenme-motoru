// PWA kabuğu giriş noktası: depo → migration → Motor (REBUILD) → arayüz. Çekirdek platformdan bağımsızdır; kablolama burada (A22).
import './ui/styles.css'
import { Motor } from './app/motor'
import { WebClock } from './platform/web/clock'
import { WebIdGenerator } from './platform/web/ids'
import { DexieRepository } from './store/dexie/dexieRepository'
import { SchemaTooNewError } from './store/repository'
import { mountApp } from './ui/app'
import { h } from './ui/dom'

export const APP_VERSION = '0.2.0'

async function boot(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) return
  const clock = new WebClock()
  const ids = new WebIdGenerator()
  try {
    const repo = await DexieRepository.open({ ids, now: () => clock.now() })
    const motor = await Motor.create({ repo, clock, ids })
    const app = mountApp(root, { motor, appVersion: APP_VERSION })
    document.addEventListener('visibilitychange', () => {
      const visible = document.visibilityState === 'visible'
      app.setVisible(visible)
      if (visible) void motor.checkExternalChanges().then((changed) => { if (changed) void app.render() })
    })
  } catch (e) {
    // 13 §6.2 / §6.5: normal açılış başarısız → yazma kapalı kurtarma ekranı (kurtarma okuyucusu Phase 10'da bağlanır)
    const msg = e instanceof SchemaTooNewError ? 'Bu veritabanı daha yeni bir uygulama sürümüyle oluşturulmuş. Veri korunuyor; bu sürüm yazma yapmaz.' : `Veritabanı açılamadı: ${(e as Error).message}. Veri silinmedi.`
    root.replaceChildren(h('div', { class: 'screen' }, h('h1', { class: 'text-title' }, 'Kurtarma'), h('p', { class: 'text-body' }, msg)))
  }
}

void boot()
