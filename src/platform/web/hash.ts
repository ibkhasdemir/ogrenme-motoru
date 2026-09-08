// 06 §11 HashService web gerçekleştirimi: Web Crypto SHA-256.
// BL-34: daima TextEncoder baytları hash'lenir (Blob/File buffer'ı değil) — jsdom realm uyuşmazlığına takılmaz.
import type { HashService } from '../services'

export class WebCryptoHashService implements HashService {
  async sha256Hex(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }
}
