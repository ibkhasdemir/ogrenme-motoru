import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// A-01 (08 §5e): src/domain/** ve src/engine/** içinde tarayıcı/DOM tanımlayıcısı yok (00 A22, 06 §11, 11 kural 33).
// Statik tarama: yorumlar ve string sabitleri ayıklanır, kalan kodda yasaklı tanımlayıcı aranır.

const ROOT = join(__dirname, '..')
const SCANNED_DIRS = ['src/domain', 'src/engine']

const FORBIDDEN = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'location',
  'fetch',
  'XMLHttpRequest',
  'Dexie',
  'HTMLElement',
  'Document',
  'ServiceWorker',
  'Capacitor',
]

export function listTsFiles(dir: string): string[] {
  const abs = join(ROOT, dir)
  let entries: string[]
  try {
    entries = readdirSync(abs)
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const p = join(abs, e)
    if (statSync(p).isDirectory()) out.push(...listTsFiles(join(dir, e)))
    else if (e.endsWith('.ts')) out.push(p)
  }
  return out
}

/** Yorumları ve string/template sabitlerini boşlukla değiştirir; satır sayısı korunur. */
export function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/'(?:\\.|[^'\\\n])*'/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => ' '.repeat(m.length))
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

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
      const lines = code.split('\n')
      lines.forEach((line, i) => {
        let m: RegExpExecArray | null
        re.lastIndex = 0
        while ((m = re.exec(line)) !== null) {
          hits.push(`${relative(ROOT, f)}:${i + 1} → ${m[1]}`)
        }
      })
    }
    expect(hits).toEqual([])
  })
})
