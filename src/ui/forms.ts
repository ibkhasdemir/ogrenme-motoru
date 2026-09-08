// 07 S9 Atom ekle, S10 Soru ekle. Zorunlu giriş minimumdur (A12); sistemin çıkarabildiği elle girilmez.
import type { AtomFacet, HookType, OptionAtomRelation } from '../domain'
import { ATOM_FACETS, HOOK_TYPES, OPTION_ATOM_RELATIONS } from '../domain'
import type { AppContext } from './app'
import { button, field, h, input, textarea } from './dom'
import { HOOK_TYPE_HINT, HOOK_TYPE_LABEL } from './labels'

const FACET_LABEL: Record<AtomFacet, string> = {
  fact: 'olgu', date: 'tarih', chronology: 'kronoloji', definition: 'tanım', cause_effect: 'sebep-sonuç',
  process: 'süreç', comparison: 'karşılaştırma', spatial: 'mekân', rule: 'kural', exception: 'istisna',
}

export async function renderAtomForm(ctx: AppContext): Promise<HTMLElement> {
  const c = await ctx.motor.content()
  const subjectIn = input({ list: 'subjects-list', placeholder: 'Ders (yoksa oluşturulur)', autocomplete: 'off' })
  const topicIn = input({ list: 'topics-list', placeholder: 'Konu (yoksa oluşturulur)', autocomplete: 'off' })
  const textIn = textarea({ placeholder: 'Tek cümlelik bilgi atomu' })
  const promptIn = textarea({ placeholder: 'Örn. Tanzimat Fermanı hangi yıl ilan edildi?' })
  const whyIn = textarea({ placeholder: 'İsteğe bağlı' })
  const hookType = h('select', { class: 'input', 'aria-label': 'Çengel türü' }, HOOK_TYPES.map((t) => h('option', { value: t }, `${HOOK_TYPE_LABEL[t]} — ${HOOK_TYPE_HINT[t]}`))) as HTMLSelectElement
  const hookIn = textarea({ placeholder: 'İsteğe bağlı' })
  const facets = new Set<AtomFacet>()
  const chips = h('div', { class: 'row', role: 'group', 'aria-label': 'Tür' }, ATOM_FACETS.map((f) => h('button', {
    type: 'button', class: 'chip', 'data-facet': f, 'aria-pressed': 'false',
    onClick: (ev: Event) => { const b = ev.currentTarget as HTMLButtonElement; if (facets.has(f)) facets.delete(f); else facets.add(f); b.classList.toggle('is-on', facets.has(f)); b.setAttribute('aria-pressed', String(facets.has(f))) },
  }, FACET_LABEL[f])))
  const error = h('div', { class: 'notice notice-error', role: 'alert', hidden: true })

  const save = async () => {
    error.hidden = true
    try {
      await ctx.motor.addAtom({
        subjectName: subjectIn.value, topicName: topicIn.value, text: textIn.value, prompt: promptIn.value,
        facets: [...facets], why: whyIn.value, hooks: hookIn.value.trim() ? [{ type: hookType.value as HookType, content: hookIn.value }] : [],
      })
      ctx.notice('Atom kaydedildi.', 'ok')
      await ctx.navigate({ name: 'today' })
    } catch (e) {
      error.textContent = (e as Error).message
      error.hidden = false
    }
  }

  return h('div', { class: 'screen', 'data-screen': 'atom-form' },
    h('h1', { class: 'text-title' }, 'Atom ekle'),
    h('datalist', { id: 'subjects-list' }, c.subjects.map((s) => h('option', { value: s.name }))),
    h('datalist', { id: 'topics-list' }, c.topics.map((t) => h('option', { value: t.name }))),
    field('Ders', subjectIn), field('Konu', topicIn),
    field('Atom (zorunlu)', textIn, 'Tek anlamlı, tek cümle.'),
    field('Soru yüzü (zorunlu)', promptIn, 'Cevabı vermeyen, bu konudaki diğer atomlardan ayırt edilen tek soru'),
    field('Neden', whyIn),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tür (varsayılan: olgu)'), chips),
    field('Çengel türü', hookType), field('Çengel', hookIn, 'Cevabı yazma, cevabı çağrıştır'),
    error,
    h('div', { class: 'screen-bottom' },
      button('Kaydet', () => void save(), { variant: 'primary', testid: 'save-atom' }),
      button('Vazgeç', () => void ctx.navigate({ name: 'today' }), { variant: 'quiet' }),
    ),
  )
}

export async function renderQuestionForm(ctx: AppContext, presetAtomId?: string, presetText?: string): Promise<HTMLElement> {
  const c = await ctx.motor.content()
  const atoms = ctx.motor.sortedAtoms(c.atoms.filter((a) => !a.archived), c.topics, c.subjects)
  const textIn = textarea({ placeholder: 'Soru metni' })
  if (presetText) textIn.value = presetText // 05 §3.3 adım 2: kutudaki ham metin soru metni olarak gelir
  const optionInputs: HTMLInputElement[] = []
  const radios: HTMLInputElement[] = []
  const optionsBox = h('div', { class: 'stack' })
  const addOption = (value = '') => {
    if (optionInputs.length >= 5) return
    const idx = optionInputs.length
    const oi = input({ placeholder: `Seçenek ${idx + 1}`, value })
    const r = h('input', { type: 'radio', name: 'correct', value: String(idx), 'aria-label': `Doğru seçenek ${idx + 1}` }) as HTMLInputElement
    optionInputs.push(oi); radios.push(r)
    optionsBox.append(h('div', { class: 'row' }, r, oi))
  }
  addOption(); addOption()
  const atomSel = h('select', { class: 'input', 'aria-label': 'Ana atom' },
    h('option', { value: '' }, atoms.length ? 'Ana atom seç' : 'önce atom ekle'),
    atoms.map((a) => h('option', { value: a.id, selected: a.id === presetAtomId }, a.text)),
  ) as HTMLSelectElement
  const sourceIn = input({ placeholder: 'Kaynak (örn. 2026 AGS deneme 3, soru 34)' })
  // + Gelişmiş
  const advancedBox = h('div', { class: 'stack', hidden: true })
  const trapIn = input({ placeholder: 'Tuzak tipi (isteğe bağlı)' })
  const qtypeIn = input({ placeholder: 'Soru tipi (isteğe bağlı)' })
  const secondarySel = h('select', { class: 'input', multiple: true, 'aria-label': 'İkincil atomlar' }, atoms.map((a) => h('option', { value: a.id }, a.text))) as HTMLSelectElement
  const oaOptionIdx = h('select', { class: 'input', 'aria-label': 'Yanlış seçenek' }, [0, 1, 2, 3, 4].map((i) => h('option', { value: String(i) }, `Seçenek ${i + 1}`))) as HTMLSelectElement
  const oaAtom = h('select', { class: 'input', 'aria-label': 'Karıştırılan atom' }, h('option', { value: '' }, '—'), atoms.map((a) => h('option', { value: a.id }, a.text))) as HTMLSelectElement
  const oaRel = h('select', { class: 'input', 'aria-label': 'İlişki' }, OPTION_ATOM_RELATIONS.map((r) => h('option', { value: r }, r))) as HTMLSelectElement
  advancedBox.append(field('Tuzak tipi', trapIn), field('Soru tipi', qtypeIn), field('İkincil atomlar', secondarySel), h('p', { class: 'text-support' }, 'Yanlış seçenek → karıştırılan atom'), h('div', { class: 'row' }, oaOptionIdx, oaAtom, oaRel))
  const error = h('div', { class: 'notice notice-error', role: 'alert', hidden: true })

  const save = async () => {
    error.hidden = true
    const options = optionInputs.map((o) => o.value)
    const correctIndex = radios.findIndex((r) => r.checked)
    try {
      if (!textIn.value.trim() || options.filter((o) => o.trim()).length < 2 || correctIndex < 0 || !atomSel.value || !sourceIn.value.trim()) {
        throw new Error('Beş alan da gerekli: soru, en az iki seçenek, doğru seçenek, ana atom, kaynak.')
      }
      const filled = options.map((o, i) => ({ o, i })).filter((x) => x.o.trim())
      const mappedCorrect = filled.findIndex((x) => x.i === correctIndex)
      if (mappedCorrect < 0) throw new Error('Beş alan da gerekli: soru, en az iki seçenek, doğru seçenek, ana atom, kaynak.')
      const secondaryAtomIds = [...secondarySel.selectedOptions].map((o) => o.value).filter((v) => v && v !== atomSel.value)
      const oaIdx = filled.findIndex((x) => x.i === Number(oaOptionIdx.value))
      const optionAtoms = oaAtom.value && oaIdx >= 0 && oaIdx !== mappedCorrect ? [{ optionIndex: oaIdx, atomId: oaAtom.value, relation: oaRel.value as OptionAtomRelation }] : []
      await ctx.motor.addQuestion({
        primaryAtomId: atomSel.value, source: sourceIn.value, text: textIn.value, options: filled.map((x) => x.o), correctIndex: mappedCorrect,
        trapType: trapIn.value, questionType: qtypeIn.value, secondaryAtomIds, optionAtoms,
      })
      ctx.notice('Soru kaydedildi.', 'ok')
      await ctx.navigate({ name: 'today' })
    } catch (e) {
      error.textContent = (e as Error).message
      error.hidden = false
    }
  }

  return h('div', { class: 'screen', 'data-screen': 'question-form' },
    h('h1', { class: 'text-title' }, 'Soru ekle'),
    field('Soru (zorunlu)', textIn),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Seçenekler (2–5; doğru olanı işaretle)'), optionsBox, button('+ Seçenek', () => addOption(), { variant: 'quiet', class: 'btn-inline' })),
    field('Ana atom (zorunlu)', atomSel),
    field('Kaynak (zorunlu)', sourceIn),
    button('+ Gelişmiş', () => { advancedBox.hidden = !advancedBox.hidden }, { variant: 'quiet', class: 'btn-inline' }),
    advancedBox,
    error,
    h('div', { class: 'screen-bottom' },
      button('Kaydet', () => void save(), { variant: 'primary', testid: 'save-question' }),
      button('Vazgeç', () => void ctx.navigate({ name: 'today' }), { variant: 'quiet' }),
    ),
  )
}
