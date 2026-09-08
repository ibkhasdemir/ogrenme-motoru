import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT, listTsFiles, stripCommentsAndStrings } from './helpers/scan'

// A-01 (08 §5e): src/domain/** ve src/engine/** içinde tarayıcı/DOM tanımlayıcısı yok (00 A22, 06 §11, 11 kural 33).
// Statik tarama: yorumlar ve string sabitleri ayıklanır, kalan kodda yasaklı tanımlayıcı aranır.

const SCANNED_DIRS = ['src/domain', 'src/engine']

const FORBIDDEN = [
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'location', 'fetch',
  'XMLHttpRequest', 'Dexie', 'HTMLElement', 'Document', 'ServiceWorker', 'Capacitor',
]

describe('A-01 — domain/engine tarayıcı bağımsız', () => {
  const files = SCANNED_DIRS.flatMap(listTsFiles)

  it('taranacak en az bir domain dosyası var', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('src/domain/** ve src/engine/** içinde yasaklı tanımlayıcı yok', () => {
    const hits: string[] = []
    const re = new RegExp(`(?<![\\w$.])(${FORBIDDEN.join('|')})(?![\\w$])`, 'g')
    for (const f of files) {
      const code = stripCommentsAndStrings(readFileSync(f, 'utf8'))
      code.split('\n').forEach((line, i) => {
        let m: RegExpExecArray | null
        re.lastIndex = 0
        while ((m = re.exec(line)) !== null) hits.push(`${relative(ROOT, f)}:${i + 1} → ${m[1]}`)
      })
    }
    expect(hits).toEqual([])
  })
})
