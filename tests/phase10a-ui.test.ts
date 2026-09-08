// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Motor } from '../src/app/motor'
import type { BackupFileService, BackupSaveResult } from '../src/platform/services'
import { WebCryptoHashService } from '../src/platform/web/hash'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 10a — E-10: Yedek al → dosya adı deseni; "Yedek alındı." (sahte BackupFileService `saved`, BL-33). Bugün'de yedek durumu satırı (BL-18).

const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const text = () => document.body.textContent ?? ''
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const click = async (el: HTMLElement) => { el.click(); await flush() }
const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim() === label)!

let handle: AppHandle | null = null
let root: HTMLDivElement
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

function fakeFiles(result: BackupSaveResult): BackupFileService & { saved: string[] } {
  const saved: string[] = []
  return { saved, save: async (f) => { saved.push(f.name); return result }, pick: async () => null }
}

async function setup(result: BackupSaveResult) {
  const clock = new FakeClock()
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Tanzimat 1839.', prompt: 'Tanzimat hangi yıl?' })
  const files = fakeFiles(result)
  handle = mountApp(root, { motor, appVersion: '0.2.0', services: { files, hash: new WebCryptoHashService() } })
  await flush()
  return { motor, repo, files }
}

describe('E-10 — yedek dosyası', () => {
  it('Bugün\'de "Yedek durumu bilinmiyor · Yedek al"; Veri → Yedek al → indirme adı deseni ve "Yedek alındı."; işaretçi güncellenir', async () => {
    const { repo, files } = await setup('saved')
    expect(byTestId('backup-reminder')!.textContent).toContain('Yedek durumu bilinmiyor')
    await click(byText('Veri'))
    expect(text()).toContain('Yedek al')
    await click(byTestId('take-backup')!)
    expect(files.saved).toHaveLength(1)
    expect(files.saved[0]).toMatch(/^ogrenme-motoru-backup-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}-[0-9a-z]{1,8}\.json$/)
    expect(byTestId('backup-message')!.textContent).toContain('Yedek alındı.')
    expect(await repo.getMeta('lastExternalBackupAt')).not.toBeNull()
    await click(byText('← Bugün'))
    expect(byTestId('backup-reminder')).toBeNull() // işaretçi var, eşik aşılmadı
  })

  it('E-21 (kısmi) — initiated → "İndirme başlatıldı. Dosyanın kaydedildiğini doğrula." + Kaydettim; teyit işaretçiyi günceller', async () => {
    const { repo } = await setup('initiated')
    await click(byText('Veri'))
    await click(byTestId('take-backup')!)
    expect(byTestId('backup-message')!.textContent).toContain('İndirme başlatıldı. Dosyanın kaydedildiğini doğrula.')
    expect(await repo.getMeta('lastExternalBackupAt')).toBeNull()
    await click(byTestId('confirm-saved')!)
    expect(byTestId('backup-message')!.textContent).toContain('Yedek alındı.')
    expect(await repo.getMeta('lastExternalBackupAt')).not.toBeNull()
  })

  it('E-21 (kısmi) — iptal → mesaj yok, işaretçi değişmez', async () => {
    const { repo } = await setup('cancelled')
    await click(byText('Veri'))
    await click(byTestId('take-backup')!)
    expect(byTestId('backup-message')).toBeNull()
    expect(await repo.getMeta('lastExternalBackupAt')).toBeNull()
  })
})
