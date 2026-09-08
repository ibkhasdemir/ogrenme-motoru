// Veri ekranı "Yapay zekâ" bölümü (BL-44). Anahtar bu cihazda kalır: localStorage; yedeğe girmez, geri yükleme silmez.
// Uygulama anahtarsız tam çalışır; bu bölüm yalnız içe aktarmayı hızlandırır.
import { maskKey, type AiSettingsStore } from '../app/aiSettings'
import { AI_PROVIDERS, DEFAULT_MODEL, PROVIDER_KEY_URL, PROVIDER_LABEL, type AiConfig, type AiProvider } from '../platform/ai'
import { WebAiService } from '../platform/web/ai'
import type { AppContext } from './app'
import { button, field, h, input } from './dom'

export interface AiSectionState {
  editing: boolean
  provider: AiProvider
  key: string
  model: string
  testing: boolean
  message: string | null
}

export const emptyAiState = (): AiSectionState => ({ editing: false, provider: 'anthropic', key: '', model: '', testing: false, message: null })

export function renderAiSection(ctx: AppContext, store: AiSettingsStore, state: AiSectionState): HTMLElement {
  const saved = store.read()
  const providerSel = h('select', { class: 'input', 'aria-label': 'Sağlayıcı' },
    ...AI_PROVIDERS.map((p) => h('option', { value: p, selected: p === state.provider }, PROVIDER_LABEL[p])),
  ) as HTMLSelectElement
  providerSel.addEventListener('change', () => { state.provider = providerSel.value as AiProvider; void ctx.render() })
  const keyIn = input({ type: 'password', placeholder: 'API anahtarı', 'aria-label': 'API anahtarı', autocomplete: 'off', 'data-testid': 'ai-key' })
  keyIn.value = state.key
  keyIn.addEventListener('input', () => { state.key = keyIn.value })
  const modelIn = input({ placeholder: `Model (boş bırak: ${DEFAULT_MODEL[state.provider]})`, 'aria-label': 'Model', autocomplete: 'off' })
  modelIn.value = state.model
  modelIn.addEventListener('input', () => { state.model = modelIn.value })

  const save = async () => {
    const key = state.key.trim()
    if (!key) { state.message = 'Anahtar boş olamaz.'; return ctx.render() }
    const config: AiConfig = { provider: state.provider, apiKey: key, ...(state.model.trim() ? { model: state.model.trim() } : {}) }
    store.write(config)
    state.editing = false
    state.key = ''
    state.message = store.read() ? 'Anahtar bu cihaza kaydedildi. Yedeğe girmez.' : 'Anahtar kaydedilemedi (tarayıcı depolamayı engelliyor).'
    await ctx.render()
  }
  const test = async () => {
    const cfg = store.read()
    if (!cfg || state.testing) return
    state.testing = true
    state.message = 'Deneniyor…'
    await ctx.render()
    try {
      const out = await new WebAiService(cfg).complete({ prompt: 'Yalnız şu kelimeyi yaz: hazir', maxTokens: 16 })
      state.message = `Bağlantı çalışıyor. Yanıt: "${out.trim().slice(0, 40)}"`
    } catch (e) {
      state.message = (e as Error).message
    } finally {
      state.testing = false
      await ctx.render()
    }
  }
  const remove = async () => {
    store.clear()
    state.message = 'Anahtar bu cihazdan silindi.'
    await ctx.render()
  }

  return h('section', { class: 'card stack', 'data-section': 'ai' },
    h('h2', { class: 'text-section' }, 'Yapay zekâ (isteğe bağlı)'),
    saved
      ? h('div', { class: 'stack' },
        h('p', { class: 'text-body', 'data-testid': 'ai-status' }, `${PROVIDER_LABEL[saved.provider]} · anahtar ${maskKey(saved.apiKey)}${saved.model ? ` · ${saved.model}` : ''}`),
        h('div', { class: 'row' },
          button(state.testing ? 'Deneniyor…' : 'Bağlantıyı dene', () => void test(), { class: 'btn-inline', disabled: state.testing, testid: 'ai-test' }),
          button('Değiştir', () => { state.editing = true; state.provider = saved.provider; state.model = saved.model ?? ''; void ctx.render() }, { class: 'btn-inline' }),
          button('Anahtarı sil', () => void remove(), { variant: 'danger', class: 'btn-inline', testid: 'ai-remove' }),
        ),
      )
      : h('p', { class: 'text-support' }, 'Anahtar girersen ders notunu doğrudan uygulamada atomlara çevirebilirsin. Girmezsen hiçbir şey değişmez: şablonu kopyalayıp dışarıda kullanmaya devam edersin.'),
    !saved || state.editing
      ? h('div', { class: 'stack' },
        field('Sağlayıcı', providerSel, `Anahtarı ${PROVIDER_KEY_URL[state.provider]} adresinden alırsın.`),
        field('API anahtarı', keyIn, 'Yalnız bu telefonda saklanır; yedek dosyasına girmez, bize gitmez.'),
        field('Model', modelIn),
        button('Kaydet', () => void save(), { variant: 'primary', testid: 'ai-save' }),
        state.editing ? button('Vazgeç', () => { state.editing = false; state.key = ''; void ctx.render() }, { variant: 'quiet' }) : null,
      )
      : null,
    state.message ? h('div', { class: 'notice', role: 'status', 'data-testid': 'ai-message' }, state.message) : null,
    h('p', { class: 'text-support' }, 'Üretilen içerik öneridir: önce önizlersin, onaylamadan hiçbir şey eklenmez. Çevrimdışıyken yapay zekâ çalışmaz, uygulamanın geri kalanı çalışır.'),
  )
}
