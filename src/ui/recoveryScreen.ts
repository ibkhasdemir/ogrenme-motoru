// 06 §6.3, §8.6; 13 §6.2, §6.5 — Kurtarma ekranı: normal açılış başarısız (migration hatası / daha yeni şema) veya acil geri dönüş de
// başarısız (yazma-kilitli). Kurtarma okuyucusuyla yedek / kurtarma dökümü alınır; DB'ye yazılmaz.
import { buildBackup, backupFileName, serializeBackup } from '../engine/backup/build'
import type { BackupSnapshot } from '../engine/backup/types'
import { legacyDumpToFormat1Backup } from '../app/recoveryPoints'
import type { BackupFileService, Clock, HashService, IdGenerator } from '../platform/services'
import { readRecoveryDump, recoveryDumpFileName, type RecoveryDump } from '../store/recovery/recoveryReader'
import { SCHEMA_VERSION } from '../store/repository'
import { button, h } from './dom'

export interface RecoveryScreenDeps {
  dbName: string
  files: BackupFileService
  hash: HashService
  clock: Clock
  ids: IdGenerator
  appVersion: string
  /** acil geri dönüş başarısız: tek dokunuşla aynı noktaya dönüş */
  retryRollback?: () => Promise<boolean>
}

function localStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}

/** Dökümü şemaya göre normal yedeğe çevirir: şema 1 → format-1 dosyası (migrate zinciri okur); şema 2 → format-2; daha yeni → null. */
export async function dumpToBackupText(dump: RecoveryDump, deps: Pick<RecoveryScreenDeps, 'hash' | 'clock' | 'ids' | 'appVersion'>): Promise<{ name: string; content: string } | null> {
  const now = deps.clock.now()
  if (dump.observedSchemaVersion === 1) {
    const file = legacyDumpToFormat1Backup(dump, { backupId: deps.ids.newId(), createdAt: now, appVersion: deps.appVersion })
    return { name: backupFileName(new Date(now), file.backupId), content: JSON.stringify(file) }
  }
  if (dump.observedSchemaVersion === SCHEMA_VERSION) {
    const t = (name: string) => (dump.tables[name] ?? []) as never[]
    const configRows = (dump.tables['config'] ?? []) as { key: string; value: unknown }[]
    const cfg = (key: string) => configRows.find((r) => r.key === key)?.value as never
    const snapshot: BackupSnapshot = {
      config: { evidencePolicy: cfg('evidencePolicy'), evidencePolicyHistory: cfg('evidencePolicyHistory') ?? [], schedulerConfig: cfg('schedulerConfig'), schedulerConfigHistory: cfg('schedulerConfigHistory') ?? [], queueConfig: cfg('queueConfig') },
      content: { subjects: t('subjects'), topics: t('topics'), atoms: t('atoms'), hooks: t('hooks'), questions: t('questions'), questionRevisions: t('questionRevisions'), questionAtoms: t('questionAtoms'), optionAtoms: t('optionAtoms'), atomRelations: t('atomRelations'), inbox: t('inbox') },
      events: { attempts: t('attempts'), voids: t('voids') },
    }
    const backupId = deps.ids.newId()
    const file = await buildBackup(snapshot, { backupId, createdAt: now, appVersion: deps.appVersion, platform: 'pwa' }, deps.hash, SCHEMA_VERSION)
    return { name: backupFileName(new Date(now), backupId), content: serializeBackup(file) }
  }
  return null // daha yeni şema: normalize edilmez, yalnız kurtarma dökümü
}

export function renderRecoveryScreen(message: string, deps: RecoveryScreenDeps): HTMLElement {
  const status = h('div', { class: 'notice', role: 'status', hidden: true })
  const say = (t: string, ok = false) => { status.textContent = t; status.hidden = false; status.className = `notice ${ok ? 'notice-ok' : ''}` }
  const takeBackup = async () => {
    try {
      const dump = await readRecoveryDump(deps.dbName, deps.clock.now())
      const file = await dumpToBackupText(dump, deps)
      if (!file) return say('Bu veritabanı daha yeni bir şemada; normal yedek üretilemez. Kurtarma dökümü al.')
      const r = await deps.files.save({ name: file.name, content: file.content, mime: 'application/json' })
      say(r === 'saved' ? 'Yedek alındı.' : r === 'initiated' ? 'İndirme başlatıldı. Dosyanın kaydedildiğini doğrula.' : r === 'cancelled' ? 'İptal edildi.' : 'Yedek kaydedilemedi.', r === 'saved')
    } catch (e) {
      say(`Yedek alınamadı: ${(e as Error).message}`)
    }
  }
  const takeDump = async () => {
    try {
      const dump = await readRecoveryDump(deps.dbName, deps.clock.now())
      const r = await deps.files.save({ name: recoveryDumpFileName(localStamp(new Date(deps.clock.now()))), content: JSON.stringify(dump), mime: 'application/json' })
      say(r === 'saved' ? 'Kurtarma dökümü alındı. Bu dosya normal yedek değildir.' : r === 'initiated' ? 'İndirme başlatıldı. Bu dosya normal yedek değildir.' : 'Döküm alınamadı.', r === 'saved')
    } catch (e) {
      say(`Döküm alınamadı: ${(e as Error).message}`)
    }
  }
  return h('div', { class: 'screen', 'data-screen': 'recovery' },
    h('h1', { class: 'text-title' }, 'Kurtarma'),
    h('p', { class: 'text-body' }, message),
    h('p', { class: 'text-support' }, 'Bu ekranda uygulama veritabanına yazmaz. Verin silinmedi.'),
    status,
    deps.retryRollback ? button('Kurtarma noktasına dön', async () => { say((await deps.retryRollback!()) ? 'Önceki duruma dönüldü; uygulamayı yeniden aç.' : 'Dönüş başarısız; kurtarma dökümü al.') }, { variant: 'primary', testid: 'retry-rollback' }) : null,
    button('Yedek al', () => void takeBackup(), { testid: 'recovery-backup' }),
    button('Kurtarma dökümü al', () => void takeDump(), { testid: 'recovery-dump' }),
  )
}
