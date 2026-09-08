// PWA kabuğu giriş noktası: ön sonda → (eski şema ise pre_migration noktası) → depo/migration → journal çözümlemesi → post_migration
// noktası → Motor (REBUILD) → arayüz. Çekirdek platformdan bağımsızdır; kablolama burada (A22).
import './ui/styles.css'
import { Motor } from './app/motor'
import { ensureDailyPoint, ensurePostMigrationPoint, writePreMigrationPoint } from './app/recoveryPoints'
import { resolveOpenJobs } from './app/restore'
import { WebBackupFileService } from './platform/web/backupFile'
import { WebClock } from './platform/web/clock'
import { WebCryptoHashService } from './platform/web/hash'
import { WebIdGenerator } from './platform/web/ids'
import { MAIN_DB_NAME } from './store/dexie/db'
import { DexieRepository } from './store/dexie/dexieRepository'
import { DexieRestoreJournal } from './store/recovery/journal'
import { RecoveryDb } from './store/recovery/recoveryDb'
import { readRecoveryDump, recoveryDumpFileName } from './store/recovery/recoveryReader'
import { DexieRecoveryStore } from './store/recovery/recoveryStore'
import { SCHEMA_VERSION, SchemaTooNewError } from './store/repository'
import { mountApp } from './ui/app'
import { renderRecoveryScreen } from './ui/recoveryScreen'
import { createUpdateController, registerServiceWorker } from './pwa/register'

export const APP_VERSION = '0.2.0'

async function boot(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) return
  const clock = new WebClock()
  const ids = new WebIdGenerator()
  const hash = new WebCryptoHashService()
  const files = new WebBackupFileService()
  const recoveryDb = new RecoveryDb()
  const recovery = new DexieRecoveryStore(recoveryDb)
  const journal = new DexieRestoreJournal(recoveryDb)
  const recoveryDeps = { dbName: MAIN_DB_NAME, files, hash, clock, ids, appVersion: APP_VERSION }
  const showRecovery = (message: string) => root.replaceChildren(renderRecoveryScreen(message, recoveryDeps))

  try {
    // 06 §6.1: migration öncesi nokta — eski şema salt-okunur dökümle (mümkünse); alınamazsa transaction rollback birinci savunmadır
    const probe = await DexieRepository.probeInstalledSchema(MAIN_DB_NAME)
    if (probe.exists && (probe.metaSchemaVersion ?? probe.verno) < SCHEMA_VERSION) {
      try {
        const dump = await readRecoveryDump(MAIN_DB_NAME, clock.now())
        await writePreMigrationPoint({ clock, ids, hash, appVersion: APP_VERSION, recovery }, dump)
      } catch (e) {
        console.warn('pre_migration noktası alınamadı; transaction rollback korur', e)
      }
    }
    const repo = await DexieRepository.open({ ids, now: () => clock.now() })
    const baseDeps = { repo, clock, ids, hash, appVersion: APP_VERSION, recovery }
    // 06 §8.5: yarım kalan geri yükleme çözülmeden normal çalışma başlamaz
    const resolution = await resolveOpenJobs({ ...baseDeps, journal, installedConfig: (await repo.getConfig()).schedulerConfig })
    if (resolution.lockdown) {
      repo.close()
      showRecovery('Yarım kalan geri yükleme çözümlenemedi. Verin korunmuş kurtarma noktasındadır; yedek veya kurtarma dökümü al.')
      return
    }
    await ensurePostMigrationPoint(baseDeps).catch((e) => console.warn('post_migration noktası alınamadı', e))
    const motor = await Motor.create({ repo, clock, ids, beforeWrite: () => ensureDailyPoint(baseDeps).then(() => undefined), recoverStorage: () => repo.reopen() })
    const updates = createUpdateController()
    void registerServiceWorker(updates) // 13 §7: arka planda; çekirdek yolu ağ beklemez
    const app = mountApp(root, {
      motor,
      appVersion: APP_VERSION,
      services: { files, hash, recovery, journal },
      updates,
      onRecoveryDump: async () => {
        const dump = await readRecoveryDump(MAIN_DB_NAME, clock.now())
        await files.save({ name: recoveryDumpFileName(new Date().toISOString().replace(/[:.]/g, '-')), content: JSON.stringify(dump), mime: 'application/json' })
      },
    })
    document.addEventListener('visibilitychange', () => {
      const visible = document.visibilityState === 'visible'
      app.setVisible(visible)
      if (!visible) return
      // iOS ana ekran uygulaması sayfayı yeniden yüklemeden sürdürür: yeni sürüm denetimi burada da yapılır (13 §7; en az 60 s arayla)
      void updates.check()
      // 06 §5: dış değişiklik → REBUILD; okuma anomalisi → render hatayı gösterir, bellek/veri değişmez
      void motor.checkExternalChanges().then((changed) => { if (changed) void app.render() }).catch(() => app.render())
    })
  } catch (e) {
    // 13 §6.2 / §6.5: normal açılış başarısız → yazma kapalı kurtarma ekranı (kurtarma okuyucusu ile yedek / döküm)
    const msg = e instanceof SchemaTooNewError
      ? 'Bu veritabanı daha yeni bir uygulama sürümüyle oluşturulmuş. Bu sürüm yazma yapmaz; kurtarma dökümü alabilirsin.'
      : `Veritabanı açılamadı: ${(e as Error).message}. Veri silinmedi; eski şema korunuyor.`
    showRecovery(msg)
  }
}

void boot()
