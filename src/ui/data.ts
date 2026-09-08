// 07 S12 Veri / Ayarlar — Phase 9: Motor bölümü (REBUILD, kuyruk tavanları, sürüm satırı, ileri tarihli kayıtlar).
// Yedek al / Yedekten geri yükle / Kurtarma noktaları / Tüm veriyi sıfırla bölümleri Phase 10'da `dataExtras` ile eklenir (11 kural 31).
import { SCHEMA_VERSION } from '../store/repository'
import type { AppContext } from './app'
import { button, field, formatDateTimeTr, h, input } from './dom'

export async function renderData(ctx: AppContext, extras?: (ctx: AppContext) => Promise<HTMLElement[]>): Promise<HTMLElement> {
  const m = ctx.motor
  const cfg = m.schedulerConfig
  const skew = m.clockSkew()
  const reviewCapIn = input({ type: 'number', min: 0, step: 1, value: String(m.queueConfig.reviewCap), 'aria-label': 'Günlük tekrar tavanı', inputmode: 'numeric' })
  const newPerDayIn = input({ type: 'number', min: 0, step: 1, value: String(m.queueConfig.newPerDay), 'aria-label': 'Günlük yeni tavanı', inputmode: 'numeric' })
  const saveCaps = async () => {
    try {
      await m.setQueueConfig({ reviewCap: Number(reviewCapIn.value), newPerDay: Number(newPerDayIn.value) })
      ctx.notice('Kuyruk tavanları kaydedildi; yalnız görünürlüğü etkiler, vadeler değişmez.', 'ok')
    } catch (e) {
      ctx.notice(`Tavan kaydedilmedi: ${(e as Error).message}`, 'error')
    }
    await ctx.render()
  }
  const extraSections = extras ? await extras(ctx) : []
  return h('div', { class: 'screen', 'data-screen': 'data' },
    h('div', { class: 'row' }, button('← Bugün', () => void ctx.navigate({ name: 'today' }), { variant: 'quiet', class: 'btn-inline' }), h('h1', { class: 'text-title' }, 'Veri')),
    ...extraSections,
    h('section', { class: 'card stack', 'data-section': 'motor' },
      h('h2', { class: 'text-section' }, 'Motor'),
      button('Hafızayı yeniden hesapla', async () => { await m.refresh(); ctx.notice('Hafıza durumu öğrenme geçmişinden yeniden hesaplandı.', 'ok'); await ctx.render() }, { testid: 'rebuild' }),
      field('Günlük tekrar (reviewCap)', reviewCapIn),
      field('Günlük yeni (newPerDay)', newPerDayIn),
      button('Tavanları kaydet', () => void saveCaps(), { class: 'btn-inline', testid: 'save-caps' }),
      h('p', { class: 'version-line', 'data-testid': 'version-line' }, `uygulama ${ctx.appVersion} · şema ${SCHEMA_VERSION} · ${cfg.engine} ${cfg.engineVersion} · ${cfg.algorithm} · hedef hatırlama ${cfg.requestRetention.toFixed(2)} · fuzz ${cfg.enableFuzz ? 'açık' : 'kapalı'} · policy v${m.policy.policyVersion}`),
    ),
    skew.futureDated.length
      ? h('section', { class: 'card stack', 'data-section': 'skew' },
        h('h2', { class: 'text-section' }, 'İleri tarihli kayıtlar'),
        h('p', { class: 'text-support' }, 'Cihaz saati ileri alınmışken yazılmış kayıtlar. Geçersiz kılma ham kaydı silmez; hafıza hesabı o kayıtları görmez.'),
        h('ul', { class: 'stack' }, skew.futureDated.map((a) => h('li', { class: 'text-body' }, `${formatDateTimeTr(a.timestamp)} · ${a.kind === 'question' ? 'soru' : 'kart'}`))),
        button('Bu kayıtları geçersiz kıl', async () => { await m.voidClockSkew(skew.futureDated.map((a) => a.id)); ctx.notice(`${skew.futureDated.length} kayıt geçersiz kılındı; vadeler yeniden hesaplandı.`, 'ok'); await ctx.render() }, { variant: 'danger', testid: 'void-skew' }),
      )
      : null,
  )
}
