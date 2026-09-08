// @vitest-environment jsdom
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareBackup } from '../src/app/backup'
import { Motor } from '../src/app/motor'
import type { BackupFileService, BackupSaveResult } from '../src/platform/services'
import { WebCryptoHashService } from '../src/platform/web/hash'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { DexieRestoreJournal } from '../src/store/recovery/journal'
import { RecoveryDb } from '../src/store/recovery/recoveryDb'
import { DexieRecoveryStore } from '../src/store/recovery/recoveryStore'
import { mountApp, type AppHandle } from '../src/ui/app'
import { MSG_INVALID, MSG_REPLACE } from '../src/ui/dataRestore'
import { FakeClock, fakeIds } from './helpers/engineFixture'
import { uniqueDbName } from './helpers/legacyDb'

// Phase 10c — E-11 geri yükleme akışı, E-12 Veri ekranı dört bölüm + sürüm satırı, E-13 bozuk yedek mesajı, E-14 kurtarma noktası listesi, E-21 (geri yükleme sonrası "Yedek durumu bilinmiyor").

const flush = async (n = 16) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const text = () => document.body.textContent ?? ''
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const click = async (el: HTMLElement) => { el.click(); await flush() }
const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim() === label)!

const hash = new WebCryptoHashService()
let handle: AppHandle | null = null
let root: HTMLDivElement
const names: string[] = []
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
afterEach(async () => { handle?.destroy(); handle = null; document.body.replaceChildren(); for (const n of names.splice(0)) await Dexie.delete(n) })

function fakeFiles(saveResult: BackupSaveResult, pickText: () => string | null): BackupFileService {
  return { save: async () => saveResult, pick: async () => { const t = pickText(); return t === null ? null : { name: 'yedek.json', content: t } } }
}

async function setup(pick: { text: string | null }) {
  const clock = new FakeClock()
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  const a = await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Tanzimat 1839.', prompt: 'Tanzimat hangi yıl?' })
  await motor.addQuestion({ primaryAtomId: a.id, source: 'kendi', text: 'Tanzimat hangi yıl?', options: ['1839', '1856'], correctIndex: 0 })
  const session = motor.startSession(null)
  await motor.next(session)
  const pq = await motor.presentAtom(a.id)
  if (pq.kind === 'question') await motor.answerQuestion(session, pq, { initialSelectedOptionId: pq.revision.correctOptionId, selectedOptionId: pq.revision.correctOptionId, confidence: 'sure', responseTimeMs: 1 })
  const name = uniqueDbName('rec'); names.push(name)
  const db = new RecoveryDb(name)
  const recovery = new DexieRecoveryStore(db)
  const journal = new DexieRestoreJournal(db)
  const files = fakeFiles('saved', () => pick.text)
  handle = mountApp(root, { motor, appVersion: '0.2.0', services: { files, hash, recovery, journal } })
  await flush()
  return { motor, repo, clock, recovery, journal, files }
}

describe('Phase 10c — S12 geri yükleme UI', () => {
  it('E-12 — Veri ekranı: dört bölüm ve sürüm satırı (5.4.2, fuzz kapalı, şema 2) görünür', async () => {
    await setup({ text: null })
    await click(byText('Veri'))
    const sections = [...document.querySelectorAll<HTMLElement>('section[data-section]')].map((s) => s.getAttribute('data-section'))
    expect(sections).toEqual(['backup', 'restore', 'recovery-points', 'motor'])
    expect(text()).toContain('Yedek al'); expect(text()).toContain('Yedekten geri yükle'); expect(text()).toContain('Kurtarma noktaları'); expect(text()).toContain('Motor')
    const v = byTestId('version-line')!.textContent!
    expect(v).toContain('uygulama 0.2.0'); expect(v).toContain('şema 2'); expect(v).toContain('ts-fsrs 5.4.2'); expect(v).toContain('FSRS-6'); expect(v).toContain('hedef hatırlama 0.90'); expect(v).toContain('fuzz kapalı'); expect(v).toContain('policy v1')
    expect(byTestId('reset')).not.toBeNull()
  })

  it('E-11 / E-14 / E-21 — dosya seç → Doğrulanıyor → özet → "Bu yedeğe geri dön" → "Doğrulandı: …"; kurtarma noktası listede; geri yükleme sonrası "Yedek durumu bilinmiyor"', async () => {
    const pick = { text: null as string | null }
    const { motor, repo, clock } = await setup(pick)
    // yedek al (metin), sonra veri değişsin
    const backup = await prepareBackup({ repo, clock, ids: motor.ids, hash, appVersion: '0.2.0' })
    const b = await motor.addAtom({ subjectName: 'Coğrafya', topicName: 'İklim', text: 'Ek atom.', prompt: 'Ek?' })
    expect((await repo.listAtoms())).toHaveLength(2)
    pick.text = backup.text
    await click(byText('Veri'))
    await click(byTestId('restore-pick')!)
    expect(byTestId('restore-summary')).not.toBeNull()
    expect(text()).toContain('1 atom · 1 soru · 1 öğrenme olayı')
    expect(text()).toContain(MSG_REPLACE)
    await click(byTestId('restore-confirm')!)
    expect(byTestId('restore-done')!.textContent).toContain('Doğrulandı: 1 atom, 1 soru, 1 öğrenme olayı.')
    expect((await repo.listAtoms()).map((a) => a.id)).not.toContain(b.id)
    // E-14: kurtarma noktası listesi (pre_restore) — tarih · neden · sayılar; "Bu noktaya dön" var
    await click(byText("Bugün'e dön"))
    expect(byTestId('backup-reminder')!.textContent).toContain('Yedek durumu bilinmiyor') // E-21
    await click(byText('Veri'))
    const points = [...document.querySelectorAll<HTMLElement>('[data-point]')]
    expect(points).toHaveLength(1)
    expect(points[0]!.textContent).toContain('Geri yükleme öncesi')
    expect(points[0]!.textContent).toContain('2 atom')
    const back = points[0]!.querySelector<HTMLElement>('button')!
    await click(back) // "Bu noktaya dön" → aynı özet + onay akışı
    expect(byTestId('restore-summary')).not.toBeNull()
    expect(text()).toContain('2 atom · 1 soru')
    await click(byTestId('restore-confirm')!)
    expect(byTestId('restore-done')).not.toBeNull()
    expect((await repo.listAtoms())).toHaveLength(2) // ek atom geri geldi
  })

  it('E-13 — bozuk yedek: "Yedek doğrulanamadı. Mevcut verine dokunulmadı." + neden; sayılar değişmez', async () => {
    const pick = { text: null as string | null }
    const { repo } = await setup(pick)
    const before = JSON.stringify(await repo.snapshotAll())
    await click(byText('Veri'))
    pick.text = '{"backupFormatVersion":2,"schemaVersion":2,"backupId":"x","createdAt":"2026-09-08T00:00:00.000Z","appVersion":"0.2.0","platform":"pwa","config":{},"content":{},"events":{},"checksum":{"algorithm":"sha256","value":"00","of":"x"}}'
    await click(byTestId('restore-pick')!)
    const err = byTestId('restore-error')!.textContent!
    expect(err).toContain(MSG_INVALID)
    expect(err).toContain('Sağlama toplamı uyuşmuyor')
    expect(JSON.stringify(await repo.snapshotAll())).toBe(before)
    expect(byTestId('restore-summary')).toBeNull()
  })

  it('Tüm veriyi sıfırla — iki onay; öncesinde pre_reset noktası; sonrası depo boş; noktadan dönüş listede', async () => {
    const { repo, recovery } = await setup({ text: null })
    await click(byText('Veri'))
    await click(byTestId('reset')!)
    expect(byTestId('reset-step-1')).not.toBeNull()
    expect(await repo.listAtoms()).toHaveLength(1) // henüz değişmedi
    await click(byTestId('reset-step-1')!)
    await click(byTestId('reset-step-2')!)
    expect(byTestId('restore-message')!.textContent).toContain('Tüm veri sıfırlandı')
    expect(await repo.listAtoms()).toEqual([])
    expect((await recovery.list()).map((p) => p.reason)).toEqual(['pre_reset'])
    expect(text()).toContain('Sıfırlama öncesi')
  })
})
