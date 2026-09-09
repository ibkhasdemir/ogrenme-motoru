// 05 §3 Öğrenme Kutusu ekranları (BL-41): S13 "+ Yakala" (tek kutu, hızlı) ve S14 "Kutu" (bekleyenler + işleme).
// Yakalama ölçüm değildir: bu ekranlarda hiçbir Attempt yazılmaz. Attempt yalnız işleme sırasında,
// başarısızlık anında hafıza durumu olan atomda ve gerçek başarısızlık nedeniyle doğar (05 §2).
import type { Atom, InboxItem, ProvenanceType } from '../domain'
import { PROVENANCE_TYPES } from '../domain'
import type { CaptureReason } from '../engine/capture/capture'
import type { AppContext } from './app'
import { button, field, formatDateTimeTr, h, input, textarea } from './dom'

export const PROVENANCE_LABEL: Record<ProvenanceType, string> = {
  deneme: 'Deneme', kitap: 'Kitap', kisi: 'Biri sordu', merak: 'Merak', ders: 'Ders', sosyal_medya: 'Sosyal medya', kendi: 'Kendi',
}

const REASONS: { value: CaptureReason; label: string; help: string }[] = [
  { value: 'curious', label: 'Merak ettim', help: 'ölçüm yok' },
  { value: 'forgot', label: 'Hatırlayamadım', help: 'gerçek başarısızlık' },
  { value: 'wrong', label: 'Yanlış yaptım', help: 'gerçek başarısızlık' },
  { value: 'confused', label: 'Karıştırdım', help: 'başka atomla' },
]

export interface CaptureUiState {
  text: string
  provenance: ProvenanceType | ''
  note: string
  /** işlenen öğe ve seçilen atom (Kutu ekranı) */
  processing: { itemId: string; atomId: string | null; query: string; reason: CaptureReason | null; sure: boolean | null; confusedWith: string | null; asQuestion: boolean } | null
}

export const emptyCaptureState = (): CaptureUiState => ({ text: '', provenance: '', note: '', processing: null })

/** S13 — "+ Yakala": tek dokunuşta kaydet. Düzenleme zorunlu değildir (05 §3.1). */
export async function renderCapture(ctx: AppContext, state: CaptureUiState): Promise<HTMLElement> {
  const textIn = textarea({ placeholder: 'Ne oldu? (soru, kavram, aklına takılan)', 'aria-label': 'Yakalanan metin', rows: 4, 'data-testid': 'capture-text' })
  textIn.value = state.text
  textIn.addEventListener('input', () => { state.text = textIn.value })
  const src = h('select', { class: 'input', 'aria-label': 'Nereden' },
    h('option', { value: '' }, 'Köken (isteğe bağlı)'),
    ...PROVENANCE_TYPES.map((t) => h('option', { value: t }, PROVENANCE_LABEL[t])),
  ) as HTMLSelectElement
  src.value = state.provenance
  src.addEventListener('change', () => { state.provenance = src.value as ProvenanceType | '' })
  const noteIn = input({ placeholder: 'Not (örn. AGS deneme 3, soru 34)', 'aria-label': 'Köken notu', autocomplete: 'off' })
  noteIn.value = state.note
  noteIn.addEventListener('input', () => { state.note = noteIn.value })
  const error = h('div', { class: 'notice notice-error', role: 'alert', hidden: true })

  const save = async () => {
    error.hidden = true
    try {
      await ctx.motor.captureInbox({ rawText: textIn.value, ...(src.value ? { provenanceType: src.value as ProvenanceType } : {}), ...(noteIn.value.trim() ? { note: noteIn.value } : {}) })
      state.text = ''
      state.note = ''
      ctx.notice('Kutuya alındı. İşlerken atomuna bağlarsın; şu an hiçbir ölçüm yazılmadı.', 'ok')
      await ctx.navigate({ name: 'today' })
    } catch (e) {
      error.textContent = (e as Error).message
      error.hidden = false
    }
  }
  return h('div', { class: 'screen', 'data-screen': 'capture' },
    h('div', { class: 'row' }, button("← Bugün", () => void ctx.navigate({ name: 'today' }, { back: true }), { variant: 'quiet', class: 'btn-inline' }), h('h1', { class: 'text-title' }, 'Yakala')),
    h('p', { class: 'text-support' }, 'Şimdi düzenlemek zorunda değilsin. Kutuda bekler, sonra atomuna bağlarsın. Bu kayıt bir ölçüm değildir; vadelerine dokunmaz.'),
    field('Ne yakaladın', textIn),
    field('Nereden', src),
    field('Not', noteIn),
    error,
    h('div', { class: 'screen-bottom' },
      button('Kutuya at', () => void save(), { variant: 'primary', testid: 'save-capture' }),
      button('Vazgeç', () => void ctx.navigate({ name: 'today' }), { variant: 'quiet' }),
    ),
  )
}

/** S14 — Kutu: bekleyenler, işleme (atom seç → neden → kaydet), atma. */
export async function renderInbox(ctx: AppContext, state: CaptureUiState): Promise<HTMLElement> {
  const items = (await ctx.motor.listInbox()).filter((i) => i.status === 'pending').sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  const c = await ctx.motor.content()
  const proc = state.processing
  const open = proc ? items.find((i) => i.id === proc.itemId) : undefined
  if (proc && !open) state.processing = null
  return h('div', { class: 'screen', 'data-screen': 'inbox' },
    h('div', { class: 'row' }, button("← Bugün", () => void ctx.navigate({ name: 'today' }, { back: true }), { variant: 'quiet', class: 'btn-inline' }), h('h1', { class: 'text-title' }, 'Kutu')),
    open ? renderProcess(ctx, state, open, c.atoms) : renderList(ctx, state, items),
  )
}

function renderList(ctx: AppContext, state: CaptureUiState, items: InboxItem[]): HTMLElement {
  if (!items.length) {
    return h('div', { class: 'stack' },
      h('p', { class: 'text-support' }, 'Kutu boş. Aklına takılanı "+ Yakala" ile buraya at, sonra işlersin.'),
      button('+ Yakala', () => void ctx.navigate({ name: 'capture' }), { variant: 'primary', testid: 'to-capture' }),
    )
  }
  return h('div', { class: 'stack' },
    h('p', { class: 'text-support' }, `${items.length} bekleyen. İşlemek: atomuna bağla, gerekiyorsa nedenini söyle.`),
    ...items.map((i) => h('div', { class: 'card stack', 'data-inbox': i.id },
      h('p', { class: 'text-body' }, i.rawText),
      h('p', { class: 'text-meta' }, `${formatDateTimeTr(i.capturedAt)}${i.provenance ? ` · ${PROVENANCE_LABEL[i.provenance.type]}${i.provenance.note ? ` · ${i.provenance.note}` : ''}` : ''}`),
      h('div', { class: 'row' },
        button('İşle', () => { state.processing = { itemId: i.id, atomId: null, query: '', reason: null, sure: null, confusedWith: null, asQuestion: false }; void ctx.render() }, { variant: 'primary', class: 'btn-inline', testid: `process-${i.id}` }),
        button('At', async () => { await ctx.motor.discardInbox(i.id); ctx.notice('Kutudan atıldı.', 'ok'); await ctx.render() }, { variant: 'quiet', class: 'btn-inline' }),
      ),
    )),
    button('+ Yakala', () => void ctx.navigate({ name: 'capture' }), { class: 'btn-inline', testid: 'to-capture' }),
  )
}

function renderProcess(ctx: AppContext, state: CaptureUiState, item: InboxItem, atoms: Atom[]): HTMLElement {
  const proc = state.processing!
  const q = proc.query.trim().toLocaleLowerCase('tr')
  const matches = atoms.filter((a) => !a.archived && (!q || a.text.toLocaleLowerCase('tr').includes(q) || a.prompt.toLocaleLowerCase('tr').includes(q))).slice(0, 8)
  const selected = proc.atomId ? atoms.find((a) => a.id === proc.atomId) : undefined
  // 05 §3.3 / §5a F01: neden sorusu yalnız başarısızlık ANINDA hafıza durumu olan atomda sorulur
  const asksReason = !!selected && ctx.motor.askReasonFor(selected.id, item.capturedAt)

  const search = input({ type: 'search', placeholder: 'Atom ara', value: proc.query, 'aria-label': 'Atom ara', 'data-testid': 'inbox-search' })
  search.addEventListener('input', () => { proc.query = search.value; proc.atomId = null; void ctx.render() })

  const confusedSel = h('select', { class: 'input', 'aria-label': 'Karıştırdığın atom' },
    h('option', { value: '' }, 'Hangisiyle karıştı?'),
    ...atoms.filter((a) => !a.archived && a.id !== proc.atomId).slice(0, 50).map((a) => h('option', { value: a.id }, a.text)),
  ) as HTMLSelectElement
  confusedSel.value = proc.confusedWith ?? ''
  confusedSel.addEventListener('change', () => { proc.confusedWith = confusedSel.value || null })

  // 05 §3.3 adım 2: öğe bir soruysa beş zorunlu alanla Question olur; işleme bitince soru formuna ham metinle geçilir
  const asQuestion = h('input', { type: 'checkbox', 'aria-label': 'Bunu soru olarak da ekle', 'data-testid': 'as-question' }) as HTMLInputElement
  asQuestion.checked = proc.asQuestion
  asQuestion.addEventListener('change', () => { proc.asQuestion = asQuestion.checked })

  const canSave = !!selected && (!asksReason || !!proc.reason) && !(asksReason && proc.reason === 'wrong' && proc.sure === null)
  const save = async () => {
    if (!selected) return
    try {
      const out = await ctx.motor.processInbox({
        itemId: item.id, atomId: selected.id,
        ...(asksReason && proc.reason ? { reason: proc.reason } : {}),
        ...(proc.sure === null ? {} : { sureAtFailure: proc.sure }),
        ...(proc.reason === 'confused' && proc.confusedWith ? { confusedWithAtomId: proc.confusedWith } : {}),
      })
      const wantsQuestion = proc.asQuestion
      const atomId = selected.id
      const rawText = item.rawText
      state.processing = null
      const parts = ['Kutu öğesi işlendi']
      if (out.attempt) parts.push('dış başarısızlık kaydedildi, bu atom öne alındı')
      else parts.push('ölçüm yazılmadı')
      if (out.relationAdded) parts.push('karıştırma ilişkisi eklendi')
      ctx.notice(`${parts.join(' · ')}.${wantsQuestion ? ' Şimdi soruyu tamamla.' : ''}`, 'ok')
      if (wantsQuestion) await ctx.navigate({ name: 'questionForm', presetAtomId: atomId, presetText: rawText })
      else await ctx.render()
    } catch (e) {
      ctx.notice((e as Error).message, 'error')
      await ctx.render()
    }
  }

  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' }, h('p', { class: 'text-body' }, item.rawText), h('p', { class: 'text-meta' }, formatDateTimeTr(item.capturedAt))),
    field('Hangi atom?', search, 'Varsa mevcut atomu seç; yoksa önce "+ Atom" ile ekle, sonra buraya dön.'),
    h('div', { class: 'stack' }, ...matches.map((a) => h('button', {
      type: 'button', class: `list-item${a.id === proc.atomId ? ' is-on' : ''}`, 'data-pick-atom': a.id,
      onClick: () => { proc.atomId = a.id; proc.reason = null; proc.sure = null; proc.confusedWith = null; void ctx.render() },
    }, h('span', { class: 'text-body' }, a.text)))),
    !matches.length ? h('p', { class: 'text-support' }, 'Eşleşen atom yok. "+ Atom" ile ekleyip buraya dön.') : null,
    selected && !asksReason
      ? h('p', { class: 'text-support', 'data-testid': 'no-reason' }, 'Bu atomun o an hafıza durumu yoktu; ölçüm yazılmaz, ilk denemesini normal döngüde yapar.')
      : null,
    selected && asksReason
      ? h('div', { class: 'card stack', 'data-testid': 'reason-block' },
        h('h2', { class: 'text-section' }, 'Bu neden geldi?'),
        h('div', { class: 'stack' }, ...REASONS.map((r) => h('button', {
          type: 'button', class: `list-item${proc.reason === r.value ? ' is-on' : ''}`, 'data-reason': r.value,
          onClick: () => { proc.reason = r.value; if (r.value !== 'wrong') proc.sure = null; void ctx.render() },
        }, h('span', { class: 'text-body' }, r.label), h('span', { class: 'text-meta' }, r.help)))),
        proc.reason === 'wrong'
          ? h('div', { class: 'stack', 'data-testid': 'sure-block' },
            h('p', { class: 'text-support' }, 'Bundan emin miydin?'),
            h('div', { class: 'row' },
              button('Evet', () => { proc.sure = true; void ctx.render() }, { class: `btn-inline${proc.sure === true ? ' is-on' : ''}`, testid: 'sure-yes' }),
              button('Hayır', () => { proc.sure = false; void ctx.render() }, { class: `btn-inline${proc.sure === false ? ' is-on' : ''}`, testid: 'sure-no' }),
            ))
          : null,
        proc.reason === 'confused' ? field('Karıştırdığın atom', confusedSel) : null,
      )
      : null,
    selected ? h('label', { class: 'topic-row' }, asQuestion, h('span', { class: 'stack' },
      h('span', { class: 'text-body' }, 'Bunu soru olarak da ekle'),
      h('span', { class: 'text-meta' }, 'kaydettikten sonra soru formu ham metinle açılır'))) : null,
    h('div', { class: 'screen-bottom' },
      button('Kaydet', () => void save(), { variant: 'primary', disabled: !canSave, testid: 'save-process' }),
      button('Vazgeç', () => { state.processing = null; void ctx.render() }, { variant: 'quiet' }),
    ),
  )
}
