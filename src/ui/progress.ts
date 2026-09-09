// S15 İlerleme (BL-42): "nerede zayıfım" — yalnız ham olaylardan sayılan şeyler. Skor/indeks uydurulmaz, sıralama motoru
// etkilenmez (A20). Veri azken oran gösterilmez; "yeterli veri yok" denir.
import type { AtomStat } from '../engine/analysis/stats'
import { MIN_FOR_RATE, atomStats, hardestAtoms, successRate, sureButWrongAtoms, summarize, topicStats } from '../engine/analysis/stats'
import type { AppContext } from './app'
import { button, formatDateTimeTr, h } from './dom'

const WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60_000 // uygulama katmanı sabiti (BL-24): motor/analiz tarafında zaman aritmetiği yok

export async function renderProgress(ctx: AppContext): Promise<HTMLElement> {
  const c = await ctx.motor.content()
  const now = ctx.motor.clock.now()
  const since = new Date(Date.parse(now) - WINDOW_DAYS * DAY_MS).toISOString()
  // Arşivlenen atom çalışma dünyasından çıkmıştır: özet, listeler ve konu toplamları aynı kümeyi kullanır
  const active = new Set(c.atoms.filter((a) => !a.archived).map((a) => a.id))
  const attempts = ctx.motor.listAttempts().filter((a) => active.has(a.primaryAtomIdAtAttempt))
  const input = { attempts, voids: ctx.motor.listVoids(), atoms: c.atoms, topics: c.topics, subjects: c.subjects }
  const all = summarize(input)
  const recent = summarize({ ...input, since })
  const stats = atomStats({ ...input, since })
  const atomText = (id: string) => c.atoms.find((a) => a.id === id)?.text ?? 'silinmiş atom'
  const openAtom = (id: string) => void ctx.navigate({ name: 'content', view: { kind: 'atom', atomId: id } })

  const rate = successRate(recent.answered, recent.failed)
  const line = (label: string, value: string) => h('div', { class: 'row' }, h('span', { class: 'text-body' }, label), h('span', { class: 'text-meta' }, value))
  const atomRow = (s: AtomStat, detail: string) => h('button', {
    type: 'button', class: 'list-item', 'data-stat-atom': s.atomId, onClick: () => openAtom(s.atomId),
  }, h('span', { class: 'stack' }, h('span', { class: 'text-body' }, atomText(s.atomId)), h('span', { class: 'text-meta' }, detail)))

  const hardest = hardestAtoms(stats)
  const risky = sureButWrongAtoms(stats)
  const topics = topicStats({ ...input, since }, stats).filter((t) => t.answered > 0 || t.atoms > 0)

  return h('div', { class: 'screen', 'data-screen': 'progress' },
    h('div', { class: 'row' }, button("← Bugün", () => void ctx.navigate({ name: 'today' }), { variant: 'quiet', class: 'btn-inline' }), h('h1', { class: 'text-title' }, 'İlerleme')),
    h('p', { class: 'text-support' }, `Son ${WINDOW_DAYS} günün sayıları (arşivlenenler hariç). Burada gösterilenler ölçülen şeylerdir; puan ya da tahmin yoktur. Ne çalışacağına yine motor karar verir, bu ekran sıralamayı değiştirmez.`),

    h('section', { class: 'card stack', 'data-section': 'summary' },
      h('h2', { class: 'text-section' }, 'Özet'),
      line('Cevaplanan', `${recent.answered}`),
      line('Başarısız', `${recent.failed}`),
      line('Doğruluk', rate === null ? `yeterli veri yok (${MIN_FOR_RATE} cevap gerekir)` : `%${rate}`),
      line('Çalışılan gün', `${recent.activeDays}`),
      h('p', { class: 'text-support', 'data-testid': 'lifetime' }, all.answered ? `Tüm zamanlar: ${all.answered} cevap · ilk kayıt ${formatDateTimeTr(all.firstAt!)}` : 'Henüz hiç cevap yok.'),
    ),

    risky.length
      ? h('section', { class: 'card stack', 'data-section': 'sure-wrong' },
        h('h2', { class: 'text-section' }, 'Emindim ama yanlıştı'),
        h('p', { class: 'text-support' }, 'Bunlar bilmediğin şeyler değil; yanlış bildiğin şeyler. Önce bunlara bak.'),
        ...risky.map((s) => atomRow(s, `${s.sureButWrong} kez emin olup yanlış · son ${formatDateTimeTr(s.lastAt!)}`)),
      )
      : null,

    hardest.length
      ? h('section', { class: 'card stack', 'data-section': 'hardest' },
        h('h2', { class: 'text-section' }, 'Zorlandıkların'),
        ...hardest.map((s) => atomRow(s, [
          s.failStreak > 1 ? `${s.failStreak} kez üst üste başarısız` : `${s.failed}/${s.answered} başarısız`,
          s.external ? `${s.external}'i dışarıdan` : '',
        ].filter(Boolean).join(' · '))),
      )
      : h('p', { class: 'text-support' }, recent.answered ? 'Son dönemde başarısız cevabın yok.' : 'Çalışmaya başlayınca burada zorlandığın atomlar listelenir.'),

    topics.length
      ? h('section', { class: 'card stack', 'data-section': 'topics' },
        h('h2', { class: 'text-section' }, 'Konular'),
        ...topics.map((t) => {
          const r = successRate(t.answered, t.failed)
          return h('div', { class: 'row', 'data-topic-stat': t.topicId },
            h('span', { class: 'text-body' }, t.label),
            h('span', { class: 'text-meta' }, `${t.studiedAtoms}/${t.atoms} atom${t.answered ? ` · ${t.answered} cevap` : ''}${r === null ? '' : ` · %${r}`}`),
          )
        }),
      )
      : null,
  )
}
