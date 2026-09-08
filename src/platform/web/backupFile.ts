// 06 §11 BackupFileService web gerçekleştirimi. BL-09 sırası: showSaveFilePicker (kaydetme gözlemlenir → saved) →
// navigator.share({ files }) (iOS paylaşım sayfası; gözlemlenemez → initiated) → Blob indirme (initiated).
// Ayrı ShareService arayüzü YOK; paylaşım bu servisin iç ayrıntısıdır.
import type { BackupFileService, BackupFileToSave, BackupSaveResult } from '../services'

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>
  }>
}

function isAbort(e: unknown): boolean {
  return (e as { name?: string } | undefined)?.name === 'AbortError'
}

export class WebBackupFileService implements BackupFileService {
  async save(file: BackupFileToSave): Promise<BackupSaveResult> {
    const blob = new Blob([file.content], { type: file.mime })
    const w = window as unknown as SaveFilePickerWindow
    if (typeof w.showSaveFilePicker === 'function') {
      try {
        const handle = await w.showSaveFilePicker({ suggestedName: file.name, types: [{ description: 'Öğrenme Motoru yedeği', accept: { 'application/json': ['.json'] } }] })
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        return 'saved'
      } catch (e) {
        return isAbort(e) ? 'cancelled' : 'failed'
      }
    }
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> }
    if (typeof nav.share === 'function' && typeof nav.canShare === 'function') {
      const f = new File([blob], file.name, { type: file.mime })
      if (nav.canShare({ files: [f] })) {
        try {
          await nav.share({ files: [f], title: file.name })
          return 'initiated' // paylaşım sayfasına verildi; kaydetme gözlemlenemez
        } catch (e) {
          return isAbort(e) ? 'cancelled' : 'failed'
        }
      }
    }
    try {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return 'initiated'
    } catch {
      return 'failed'
    }
  }

  pick(): Promise<{ name: string; content: string } | null> {
    return new Promise((resolvePick) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      input.style.display = 'none'
      let settled = false
      const finish = (v: { name: string; content: string } | null) => {
        if (settled) return
        settled = true
        input.remove()
        resolvePick(v)
      }
      input.addEventListener('change', async () => {
        const f = input.files?.[0]
        if (!f) return finish(null)
        try {
          finish({ name: f.name, content: await f.text() })
        } catch {
          finish(null)
        }
      })
      input.addEventListener('cancel', () => finish(null))
      document.body.appendChild(input)
      input.click()
    })
  }
}
