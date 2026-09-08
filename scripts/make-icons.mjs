// PWA ikonları: bağımlılıksız PNG üretimi (zlib). Sade: kısık lacivert zemin üzerine açık daire + yatay çubuk ("motor" işareti).
// Kullanım: node scripts/make-icons.mjs → public/icons/icon-{180,192,512}.png
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]) }

function png(size, paint) {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b] = paint(x, y)
      const o = y * (size * 3 + 1) + 1 + x * 3
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const BG = [44, 90, 134] // --color-accent (light)
const FG = [246, 245, 241] // --color-background
function paint(size) {
  const c = size / 2
  const r = size * 0.3
  return (x, y) => {
    const dx = x + 0.5 - c, dy = y + 0.5 - c
    const d = Math.hypot(dx, dy)
    const ring = d > r * 0.72 && d < r
    const bar = Math.abs(dy) < size * 0.045 && Math.abs(dx) < r * 0.55
    return ring || bar ? FG : BG
  }
}

mkdirSync('public/icons', { recursive: true })
for (const s of [180, 192, 512]) writeFileSync(`public/icons/icon-${s}.png`, png(s, paint(s)))
console.log('ikonlar yazıldı: 180, 192, 512')
