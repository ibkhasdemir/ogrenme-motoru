// Statik tarama yardımcıları (A-01, A-02, A-06, U-SC-14, A-SW-01).
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = join(__dirname, '..', '..')

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

export function importSpecifiers(src: string): string[] {
  const out: string[] = []
  const re = /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) out.push(m[1]!)
  return out
}
