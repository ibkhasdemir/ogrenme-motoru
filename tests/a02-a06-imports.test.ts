import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT, importSpecifiers, listTsFiles } from './helpers/scan'

// A-02: engine/domain Dexie import etmez; ts-fsrs yalnız scheduler adaptöründe.
// A-06: src/engine ve src/domain yalnız birbirini, src/store/repository arayüzünü ve PlatformServices arayüzlerini import eder.

const SCHEDULER_ADAPTER = resolve(ROOT, 'src/engine/scheduler/adapter.ts')
const ALLOWED_DIRS = ['src/domain', 'src/engine'].map((d) => resolve(ROOT, d))
const ALLOWED_FILES = ['src/store/repository', 'src/platform/services'].map((f) => resolve(ROOT, f))

describe('A-02 / A-06 — çekirdek paket sınırı', () => {
  const files = ['src/domain', 'src/engine'].flatMap(listTsFiles)

  it('taranacak dosya var', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it("A-02 — engine/domain içinde 'dexie' import'u yok; 'ts-fsrs' yalnız scheduler adaptöründe", () => {
    const bad: string[] = []
    for (const f of files) {
      for (const s of importSpecifiers(readFileSync(f, 'utf8'))) {
        if (s === 'dexie' || s.startsWith('dexie/')) bad.push(`${relative(ROOT, f)} → ${s}`)
        if ((s === 'ts-fsrs' || s.startsWith('ts-fsrs/')) && resolve(f) !== SCHEDULER_ADAPTER) bad.push(`${relative(ROOT, f)} → ${s}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('A-06 — yalnız domain/engine, store/repository ve platform/services import edilir (ts-fsrs istisnası adaptörde)', () => {
    const bad: string[] = []
    for (const f of files) {
      for (const s of importSpecifiers(readFileSync(f, 'utf8'))) {
        if (s.startsWith('.')) {
          const target = resolve(dirname(f), s)
          const ok = ALLOWED_DIRS.some((d) => target === d || target.startsWith(d + '\\') || target.startsWith(d + '/')) || ALLOWED_FILES.includes(target)
          if (!ok) bad.push(`${relative(ROOT, f)} → ${s}`)
        } else if (!(s === 'ts-fsrs' && resolve(f) === SCHEDULER_ADAPTER)) {
          bad.push(`${relative(ROOT, f)} → ${s}`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})
