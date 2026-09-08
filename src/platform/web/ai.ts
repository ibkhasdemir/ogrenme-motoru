// AiService web gerçekleştirimi (BL-44): doğrudan tarayıcıdan sağlayıcının HTTP API'sine. Sunucu/proxy yok.
// Anahtar kullanıcınındır ve YALNIZ bu cihazda (localStorage) durur; yedeğe girmez, ağa yalnız sağlayıcıya gider.
import { AiError, DEFAULT_MODEL, type AiConfig, type AiRequest, type AiService } from '../ai'

const DEFAULT_MAX_TOKENS = 8000

async function readError(res: Response): Promise<string> {
  try {
    const t = await res.text()
    return t.slice(0, 300)
  } catch {
    return `${res.status}`
  }
}

/** 4xx anahtar/istek hatasıdır (tekrar denemek düzeltmez); 429 ve 5xx geçicidir. */
function failFor(res: Response, body: string): AiError {
  if (res.status === 401 || res.status === 403) return new AiError('Anahtar reddedildi. Veri ekranından anahtarı kontrol et.', false)
  if (res.status === 429) return new AiError('Sağlayıcı hız sınırı; biraz bekleyip yeniden dene.', true)
  if (res.status >= 500) return new AiError('Sağlayıcı geçici olarak yanıt vermedi; yeniden dene.', true)
  return new AiError(`İstek reddedildi (${res.status}): ${body}`, false)
}

export class WebAiService implements AiService {
  constructor(private readonly config: AiConfig) {}

  async complete(req: AiRequest): Promise<string> {
    const { provider, apiKey } = this.config
    const model = this.config.model?.trim() || DEFAULT_MODEL[provider]
    const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS
    if (!apiKey.trim()) throw new AiError('Anahtar girilmemiş.', false)
    try {
      if (provider === 'anthropic') return await this.anthropic(model, maxTokens, req)
      if (provider === 'openai') return await this.openai(model, maxTokens, req)
      return await this.gemini(model, maxTokens, req)
    } catch (e) {
      if (e instanceof AiError) throw e
      throw new AiError(`Bağlantı kurulamadı: ${(e as Error).message}. Çevrimdışıysan yapay zekâ çalışmaz; şablonla elle devam edebilirsin.`, true)
    }
  }

  private async anthropic(model: string, maxTokens: number, req: AiRequest): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true', // tarayıcıdan doğrudan çağrı (sunucumuz yok)
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: req.prompt }] }),
      ...(req.signal ? { signal: req.signal } : {}),
    })
    if (!res.ok) throw failFor(res, await readError(res))
    const data = (await res.json()) as { content?: { type: string; text?: string }[] }
    const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
    if (!text.trim()) throw new AiError('Boş yanıt geldi.', true)
    return text
  }

  private async openai(model: string, maxTokens: number, req: AiRequest): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model, max_completion_tokens: maxTokens, messages: [{ role: 'user', content: req.prompt }] }),
      ...(req.signal ? { signal: req.signal } : {}),
    })
    if (!res.ok) throw failFor(res, await readError(res))
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content ?? ''
    if (!text.trim()) throw new AiError('Boş yanıt geldi.', true)
    return text
  }

  private async gemini(model: string, maxTokens: number, req: AiRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.config.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: req.prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }),
      ...(req.signal ? { signal: req.signal } : {}),
    })
    if (!res.ok) throw failFor(res, await readError(res))
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    if (!text.trim()) throw new AiError('Boş yanıt geldi.', true)
    return text
  }
}
