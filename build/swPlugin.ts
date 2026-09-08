// BL-35 — Build zamanında service worker'a tam varlık manifesti + buildId enjekte eden küçük Vite eklentisi (ek paket yok).
// dist/ içindeki tüm dosyalar (index.html, hash'li assets/*, manifest, ikonlar) listelenir; sw.js kendisi hariç.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Plugin } from 'vite'

export function listDistFiles(dir: string, root = dir): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...listDistFiles(p, root))
    else out.push(relative(root, p).split('\\').join('/'))
  }
  return out.sort()
}

/** buildId: manifest dosya adları + içerik hash'lerinden türetilir → aynı build aynı id; değişen varlık yeni id. */
export function computeBuildId(distDir: string, files: string[]): string {
  const h = createHash('sha256')
  for (const f of files) {
    h.update(f)
    h.update(readFileSync(join(distDir, f)))
  }
  return h.digest('hex').slice(0, 12)
}

export function renderServiceWorker(template: string, precache: string[], buildId: string): string {
  if (!template.includes('__BUILD_ID__') || !template.includes('__PRECACHE__')) throw new Error('sw.js şablonunda yer tutucular yok')
  return template.replace(/__BUILD_ID__/g, buildId).replace(/__PRECACHE__/g, JSON.stringify(precache))
}

export function swPrecachePlugin(): Plugin {
  let outDir = 'dist'
  return {
    name: 'motor-sw-precache',
    apply: 'build',
    enforce: 'post',
    configResolved(cfg) {
      outDir = cfg.build.outDir
    },
    closeBundle() {
      const files = listDistFiles(outDir).filter((f) => f !== 'sw.js')
      const buildId = computeBuildId(outDir, files)
      const precache = files.map((f) => `./${f}`)
      const swPath = join(outDir, 'sw.js')
      const template = readFileSync(swPath, 'utf8')
      writeFileSync(swPath, renderServiceWorker(template, precache, buildId), 'utf8')
      writeFileSync(join(outDir, 'build-id.txt'), buildId, 'utf8')
    },
  }
}
