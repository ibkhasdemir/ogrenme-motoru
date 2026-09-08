// Yapay zekâ ayarları (BL-44) — anahtar CİHAZDA kalır: localStorage, IndexedDB'ye yazılmaz.
// Bunun iki sonucu var: (1) taşınabilir yedek dosyası anahtarı TAŞIMAZ (yedek yalnız IndexedDB içeriğidir),
// (2) geri yükleme/sıfırlama anahtara dokunmaz. Uygulama anahtar olmadan tam çalışır (çevrimdışı yol korunur).
import { AI_PROVIDERS, type AiConfig, type AiProvider } from '../platform/ai'

const KEY = 'motor-ai-config'

export interface AiSettingsStore {
  read(): AiConfig | null
  write(config: AiConfig): void
  clear(): void
}

function isProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && (AI_PROVIDERS as readonly string[]).includes(v)
}

/** Tarayıcı deposu; erişilemezse (özel mod, izin) sessizce "ayar yok" davranır. */
export class LocalAiSettings implements AiSettingsStore {
  read(): AiConfig | null {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<AiConfig>
      if (!isProvider(parsed.provider) || typeof parsed.apiKey !== 'string' || !parsed.apiKey.trim()) return null
      return { provider: parsed.provider, apiKey: parsed.apiKey, ...(parsed.model?.trim() ? { model: parsed.model.trim() } : {}) }
    } catch {
      return null
    }
  }

  write(config: AiConfig): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(config))
    } catch {
      // kota/izin yoksa ayar kalıcı olmaz; çağıran okuyarak doğrular
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // yoksay
    }
  }
}

/** Ekranda gösterilecek maskeli anahtar: son dört hane dışında hiçbir şey gösterilmez. */
export function maskKey(apiKey: string): string {
  const t = apiKey.trim()
  if (t.length <= 4) return '••••'
  return `••••${t.slice(-4)}`
}
