// AiService (BL-44) — uygulama içi yapay zekâ, PlatformServices sınırının arkasında (A22). Motor ve domain bunu BİLMEZ.
// Anayasa kuralı korunur (A18): yapay zekâ onaysız kalıcı bilgi modelini değiştiremez. Bu servis yalnız METİN döndürür;
// yazma yolu her zaman kullanıcının önizleyip onayladığı içe aktarma planıdır.
// Sunucu yoktur (10 "backend yok"): çağrı doğrudan tarayıcıdan, KULLANICININ KENDİ anahtarıyla yapılır.

export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export interface AiConfig {
  provider: AiProvider
  /** kullanıcının kendi anahtarı; yalnız bu cihazda saklanır, yedeğe GİRMEZ */
  apiKey: string
  /** boşsa sağlayıcının varsayılan modeli */
  model?: string
}

export interface AiRequest {
  prompt: string
  /** üst sınır; uzun ders notlarında yanıt kesilmesin diye yüksek tutulur */
  maxTokens?: number
  signal?: AbortSignal
}

export class AiError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message)
    this.name = 'AiError'
  }
}

export interface AiService {
  /** Serbest metin üretir. Ağ/anahtar hatalarında AiError fırlatır. */
  complete(req: AiRequest): Promise<string>
}

/** Sağlayıcı varsayılanları tek yerde; kullanıcı isterse model adını kendisi yazar. */
export const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-2.0-flash',
}

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'ChatGPT (OpenAI)',
  gemini: 'Gemini (Google)',
}

/** Anahtar alma adresi — ekranda gösterilir ki kullanıcı nereden alacağını bilsin. */
export const PROVIDER_KEY_URL: Record<AiProvider, string> = {
  anthropic: 'console.anthropic.com',
  openai: 'platform.openai.com',
  gemini: 'aistudio.google.com',
}
