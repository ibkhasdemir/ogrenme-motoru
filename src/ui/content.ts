// 07 S11 İçerik (minimal): Ders › Konu › Atom listesi; atom aç (arşivle, soru yüzü tamamla); soru aç (Düzenle → yeni sürüm, K01,
// Sürüm geçmişi). Öğrenme modu: doğru seçenek burada görünebilir (14 §10).
import type { Atom, CompleteQuestionRevision, Question, QuestionRevision } from '../domain'
import { isCompleteRevision } from '../domain'
import { affectedAttemptsByKeyChange } from '../engine/question/contentError'
import type { AppContext } from './app'
import { button, field, formatDateTimeTr, h, input, textarea } from './dom'
import { hookTypeLabel } from './labels'

export type ContentView =
  | { kind: 'list'; query?: string }
  | { kind: 'atom'; atomId: string }
  | { kind: 'question'; questionId: string; edit?: boolean }
  | { kind: 'history'; questionId: string }

export const LEGACY_UNAVAILABLE_TEXT = 'Bu eski denemeye ait soru metni eski veri modelinde saklanmadığı için mevcut değil.'
export const VERSION_DATE_UNKNOWN = 'sürüm tarihi bilinmiyor'
export const EDIT_WARNING = 'Bu değişiklik yeni bir sürüm oluşturur; eski cevapların eski sürümle saklanır.'
export const CONTEXT_RESET_WARNING = 'Yanlış-şık ve ikincil atom ilişkileri sıfırlandı; gerekirse Gelişmiş\'ten yeniden işaretle.'
export const KEY_ERROR_QUESTION = 'Eski cevap anahtarı hatalı mıydı?'

export async function renderContent(ctx: AppContext, view: ContentView): Promise<HTMLElement> {
  switch (view.kind) {
    case 'list': return renderList(ctx, view.query ?? '')
    case 'atom': return renderAtom(ctx, view.atomId)
    case 'question': return renderQuestion(ctx, view.questionId, view.edit ?? false)
    case 'history': return renderHistory(ctx, view.questionId)
  }
}

function back(ctx: AppContext, view: ContentView = { kind: 'list' }): HTMLElement {
  return button('← İçerik', () => void ctx.navigate({ name: 'content', view }), { variant: 'quiet', class: 'btn-inline' })
}

async function renderList(ctx: AppContext, query: string): Promise<HTMLElement> {
  const c = await ctx.motor.content()
  const q = query.trim().toLocaleLowerCase('tr')
  const atoms = ctx.motor.sortedAtoms(c.atoms.filter((a) => !a.archived), c.topics, c.subjects)
    .filter((a) => !q || a.text.toLocaleLowerCase('tr').includes(q) || a.prompt.toLocaleLowerCase('tr').includes(q))
  const missingPrompt = atoms.filter((a) => !a.prompt.trim())
  const rest = atoms.filter((a) => a.prompt.trim())
  const search = input({ type: 'search', placeholder: 'Ara', value: query, 'aria-label': 'Ara' })
  search.addEventListener('input', () => void ctx.navigate({ name: 'content', view: { kind: 'list', query: search.value } }))
  const row = (a: Atom, badge?: string, withCrumb = true) => {
    const qCount = c.questions.filter((x) => x.primaryAtomId === a.id && !x.archived).length
    const due = ctx.motor.nextDueOf(a.id)
    const topic = c.topics.find((t) => t.id === a.topicId)
    const subject = topic ? c.subjects.find((s) => s.id === topic.subjectId) : undefined
    const crumb = withCrumb ? [subject?.name, topic?.name].filter(Boolean).join(' › ') : '' // grup içinde başlık zaten söyler
    return h('button', { type: 'button', class: 'list-item', 'data-atom': a.id, onClick: () => void ctx.navigate({ name: 'content', view: { kind: 'atom', atomId: a.id } }) },
      h('span', { class: 'stack' },
        h('span', { class: 'text-body' }, a.text),
        h('span', { class: 'text-meta' }, [crumb, `${qCount} soru`, due ? `sonraki vade ${formatDateTimeTr(due)}` : ''].filter(Boolean).join(' · ')),
      ),
      badge ? h('span', { class: 'badge' }, badge) : null,
    )
  }
  // Ders › Konu grupları (dizin görünümü, BL-39): sıralı atom listesi konuya göre kesilir; arama açıkken gruplar açık gelir
  const groups: { key: string; label: string; atoms: Atom[]; questions: number }[] = []
  for (const a of rest) {
    const topic = c.topics.find((t) => t.id === a.topicId)
    const subject = topic ? c.subjects.find((s) => s.id === topic.subjectId) : undefined
    let g = groups.find((x) => x.key === a.topicId)
    if (!g) { g = { key: a.topicId, label: [subject?.name, topic?.name].filter(Boolean).join(' › ') || 'Konusuz', atoms: [], questions: 0 }; groups.push(g) }
    g.atoms.push(a)
    g.questions += c.questions.filter((x) => x.primaryAtomId === a.id && !x.archived).length
  }
  const openAll = !!q || groups.length === 1
  return h('div', { class: 'screen', 'data-screen': 'content' },
    h('div', { class: 'row' }, button("← Bugün", () => void ctx.navigate({ name: 'today' }), { variant: 'quiet', class: 'btn-inline' }), h('h1', { class: 'text-title' }, 'İçerik')),
    h('div', { class: 'row' }, button('İçe aktar', () => void ctx.navigate({ name: 'import' }), { class: 'btn-inline', testid: 'to-import' }), h('span', { class: 'text-meta' }, `${rest.length + missingPrompt.length} atom · ${groups.length} konu`)),
    search,
    missingPrompt.length ? h('div', { class: 'stack' }, h('p', { class: 'text-support' }, 'Soru yüzü eksik olan atomlar çalışılmaz; tamamlayınca kuyruğa girer.'), missingPrompt.map((a) => row(a, 'soru yüzü eksik'))) : null,
    rest.length
      ? h('div', { class: 'stack' }, ...groups.map((g) => h('details', { class: 'group', open: openAll, 'data-group': g.key },
        h('summary', { class: 'group-summary' }, h('span', { class: 'text-body' }, g.label), h('span', { class: 'text-meta' }, `${g.atoms.length} atom · ${g.questions} soru`)),
        h('div', { class: 'stack group-body' }, ...g.atoms.map((a) => row(a, undefined, false))),
      )))
      : (!missingPrompt.length ? h('p', { class: 'text-support' }, 'Henüz atom yok.') : null),
  )
}

async function renderAtom(ctx: AppContext, atomId: string): Promise<HTMLElement> {
  const c = await ctx.motor.content()
  const atom = c.atoms.find((a) => a.id === atomId)
  if (!atom) return h('div', { class: 'screen' }, back(ctx), h('p', { class: 'text-body' }, 'Atom bulunamadı.'))
  const hooks = c.hooks.filter((x) => x.atomId === atom.id)
  const questions = c.questions.filter((x) => x.primaryAtomId === atom.id)
  const promptIn = textarea({ value: atom.prompt, placeholder: 'Cevabı vermeyen, bu konudaki diğer atomlardan ayırt edilen tek soru' })
  const savePrompt = async () => {
    if (!promptIn.value.trim()) { ctx.notice('Soru yüzü boş olamaz.', 'error'); return ctx.render() }
    await ctx.motor.repo.putAtom({ ...atom, prompt: promptIn.value.trim() })
    ctx.notice('Soru yüzü kaydedildi; atom artık çalışılabilir.', 'ok')
    await ctx.navigate({ name: 'content', view: { kind: 'atom', atomId } })
  }
  return h('div', { class: 'screen', 'data-screen': 'content-atom' },
    back(ctx),
    h('p', { class: 'text-question' }, atom.text),
    atom.archived ? h('p', { class: 'badge' }, 'arşivli') : null,
    atom.prompt.trim()
      ? h('p', { class: 'text-body' }, `Soru yüzü: ${atom.prompt}`)
      : h('div', { class: 'stack' }, h('span', { class: 'badge' }, 'soru yüzü eksik'), field('Soru yüzü', promptIn), button('Soru yüzünü kaydet', () => void savePrompt(), { variant: 'primary', testid: 'save-prompt' })),
    atom.why ? h('p', { class: 'text-body' }, `Neden: ${atom.why}`) : null,
    atom.how ? h('p', { class: 'text-body' }, `Nasıl: ${atom.how}`) : null,
    hooks.length ? h('div', { class: 'stack' }, hooks.map((hk) => h('div', { class: 'hook' }, h('span', { class: 'hook-type' }, hookTypeLabel(hk.type)), h('p', { class: 'text-body' }, hk.content)))) : null,
    h('h2', { class: 'text-section' }, `Sorular (${questions.length})`),
    questions.length
      ? h('div', { class: 'stack' }, questions.map((q) => h('button', { type: 'button', class: 'list-item', 'data-question': q.id, onClick: () => void ctx.navigate({ name: 'content', view: { kind: 'question', questionId: q.id } }) }, h('span', {}, `Soru · v${q.currentVersion}${q.archived ? ' · arşivli' : ''}`), h('span', { class: 'source' }, q.source))))
      : h('p', { class: 'text-support' }, 'Bu atomun sorusu yok; hatırlama kartıyla çalışılır.'),
    h('div', { class: 'screen-bottom' },
      button('+ Soru ekle', () => void ctx.navigate({ name: 'questionForm', presetAtomId: atom.id }), { class: 'btn-inline' }),
      atom.archived ? null : button('Arşivle', async () => { await ctx.motor.repo.archiveAtom(atom.id); ctx.notice('Atom arşivlendi (silinmedi).', 'ok'); await ctx.navigate({ name: 'content', view: { kind: 'list' } }) }, { variant: 'danger', class: 'btn-inline', testid: 'archive-atom' }),
    ),
  )
}

function revisionBlock(rev: QuestionRevision, atoms: Atom[], voidNotes: string[]): HTMLElement {
  const created = rev.createdAt ? formatDateTimeTr(rev.createdAt) : VERSION_DATE_UNKNOWN
  if (!isCompleteRevision(rev)) {
    return h('div', { class: 'card stack', 'data-revision': rev.version },
      h('p', { class: 'text-meta' }, `v${rev.version} · ${created}`),
      h('p', { class: 'text-body' }, LEGACY_UNAVAILABLE_TEXT),
      voidNotes.length ? h('p', { class: 'text-support' }, `Geçersiz kılınan denemeler: ${voidNotes.join('; ')}`) : null,
    )
  }
  const primary = atoms.find((a) => a.id === rev.primaryAtomId)
  return h('div', { class: 'card stack', 'data-revision': rev.version },
    h('p', { class: 'text-meta' }, `v${rev.version} · ${created}`),
    h('p', { class: 'text-question' }, rev.text),
    h('ul', { class: 'stack' }, rev.options.map((o) => h('li', { class: o.id === rev.correctOptionId ? 'result-correct' : '' }, `${o.text}${o.id === rev.correctOptionId ? ' (doğru)' : ''}`))),
    h('p', { class: 'text-support' }, `Ana atom: ${primary?.text ?? rev.primaryAtomId}`),
    voidNotes.length ? h('p', { class: 'text-support' }, `İçerik hatası nedeniyle geçersiz kılınan denemeler: ${voidNotes.join('; ')}`) : null,
  )
}

async function renderQuestion(ctx: AppContext, questionId: string, edit: boolean): Promise<HTMLElement> {
  const c = await ctx.motor.content()
  const question = c.questions.find((q) => q.id === questionId)
  if (!question) return h('div', { class: 'screen' }, back(ctx), h('p', { class: 'text-body' }, 'Soru bulunamadı.'))
  const rev = await ctx.motor.repo.getRevision(question.id, question.currentVersion)
  const atom = c.atoms.find((a) => a.id === question.primaryAtomId)
  const goBack = () => void ctx.navigate({ name: 'content', view: { kind: 'atom', atomId: question.primaryAtomId } })
  if (!rev) return h('div', { class: 'screen' }, back(ctx), h('p', { class: 'text-body' }, 'Güncel sürüm bulunamadı.'))
  if (edit && isCompleteRevision(rev)) return renderEdit(ctx, question, rev, c.atoms)
  return h('div', { class: 'screen', 'data-screen': 'content-question' },
    button('← Atom', goBack, { variant: 'quiet', class: 'btn-inline' }),
    h('p', { class: 'text-meta' }, `Soru · güncel sürüm v${question.currentVersion} · kaynak: ${question.source}${question.archived ? ' · arşivli' : ''}`),
    revisionBlock(rev, c.atoms, []),
    h('p', { class: 'text-support' }, `Ana atom: ${atom?.text ?? question.primaryAtomId}`),
    h('div', { class: 'screen-bottom' },
      isCompleteRevision(rev) && !question.archived ? button('Düzenle', () => void ctx.navigate({ name: 'content', view: { kind: 'question', questionId, edit: true } }), { testid: 'edit-question' }) : null,
      button('Sürüm geçmişi', () => void ctx.navigate({ name: 'content', view: { kind: 'history', questionId } }), { testid: 'history' }),
      question.archived ? null : button('Arşivle', async () => { await ctx.motor.repo.archiveQuestion(question.id); ctx.notice('Soru arşivlendi; geçmişi ve sürümleri korunur.', 'ok'); goBack() }, { variant: 'danger', testid: 'archive-question' }),
    ),
  )
}

function renderEdit(ctx: AppContext, question: Question, rev: CompleteQuestionRevision, atoms: Atom[]): HTMLElement {
  const textIn = textarea({ value: rev.text })
  const optionInputs = rev.options.map((o) => input({ value: o.text, 'data-option-id': o.id }))
  const radios = rev.options.map((o) => h('input', { type: 'radio', name: 'edit-correct', value: o.id, checked: o.id === rev.correctOptionId, 'aria-label': `Doğru: ${o.text}` }) as HTMLInputElement)
  const atomSel = h('select', { class: 'input', 'aria-label': 'Ana atom' }, atoms.filter((a) => !a.archived || a.id === rev.primaryAtomId).map((a) => h('option', { value: a.id, selected: a.id === rev.primaryAtomId }, a.text))) as HTMLSelectElement
  const error = h('div', { class: 'notice notice-error', role: 'alert', hidden: true })
  const keyBox = h('div', { class: 'card stack', hidden: true, 'data-testid': 'key-error-box' })

  const buildPatch = () => ({
    text: textIn.value,
    options: rev.options.map((o, i) => ({ id: o.id, text: optionInputs[i]!.value })),
    correctOptionId: radios.find((r) => r.checked)?.value ?? rev.correctOptionId,
    primaryAtomId: atomSel.value,
  })

  const commit = async (contentError?: { attemptIds: string[]; note: string }) => {
    error.hidden = true
    try {
      const out = await ctx.motor.reviseQuestion(question.id, buildPatch(), contentError)
      if (!out.created) ctx.notice('Semantik değişiklik yok; sürüm üretilmedi.', 'info')
      else ctx.notice(out.contextChanged ? `Yeni sürüm v${out.revision.version} oluşturuldu. ${CONTEXT_RESET_WARNING}` : `Yeni sürüm v${out.revision.version} oluşturuldu.`, 'ok')
      await ctx.navigate({ name: 'content', view: { kind: 'question', questionId: question.id } })
    } catch (e) {
      error.textContent = (e as Error).message
      error.hidden = false
    }
  }

  const save = async () => {
    const patch = buildPatch()
    const newCorrect = patch.correctOptionId
    const correctTextChanged = rev.options.find((o) => o.id === newCorrect)?.text !== optionInputs[rev.options.findIndex((o) => o.id === newCorrect)]?.value
    if (newCorrect !== rev.correctOptionId || correctTextChanged) {
      // K01: doğru cevap değişti → "Eski cevap anahtarı hatalı mıydı?"
      const keyId = correctTextChanged ? '__new__' : newCorrect // metni değişen seçenek yeni id alır → hiçbir eski deneme onu seçmemiştir
      const affected = affectedAttemptsByKeyChange(ctx.motor.listAttempts(), ctx.motor.listVoids(), question.id, question.currentVersion, keyId)
      keyBox.hidden = false
      keyBox.replaceChildren(
        h('p', { class: 'text-section' }, KEY_ERROR_QUESTION),
        h('p', { class: 'text-support' }, affected.length ? `${affected.length} deneme yanlış anahtarla ölçülmüştü (bu cevaplar geçersiz kılınır; ham kayıt silinmez).` : 'Etkilenen deneme yok; yalnız yeni sürüm oluşur.'),
        h('div', { class: 'row' },
          button(affected.length ? 'Evet — Bu ölçümleri geçersiz kıl' : 'Evet', () => void commit(affected.length ? { attemptIds: affected.map((a) => a.id), note: `${question.id} v${question.currentVersion}: eski cevap anahtarı hatalıydı` } : undefined), { variant: 'danger', class: 'btn-inline', testid: 'key-error-yes' }),
          button('Hayır — yalnız yeni sürüm', () => void commit(), { class: 'btn-inline', testid: 'key-error-no' }),
        ),
      )
      return
    }
    await commit()
  }

  return h('div', { class: 'screen', 'data-screen': 'content-edit' },
    button('← Soru', () => void ctx.navigate({ name: 'content', view: { kind: 'question', questionId: question.id } }), { variant: 'quiet', class: 'btn-inline' }),
    h('h1', { class: 'text-title' }, `Düzenle · v${question.currentVersion}`),
    h('div', { class: 'notice', role: 'note', 'data-testid': 'edit-warning' }, EDIT_WARNING),
    field('Soru', textIn),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Seçenekler (doğru olanı işaretle)'), h('div', { class: 'stack' }, rev.options.map((_, i) => h('div', { class: 'row' }, radios[i]!, optionInputs[i]!)))),
    field('Ana atom', atomSel),
    keyBox,
    error,
    h('div', { class: 'screen-bottom' },
      button('Kaydet', () => void save(), { variant: 'primary', testid: 'save-edit' }),
      button('Vazgeç', () => void ctx.navigate({ name: 'content', view: { kind: 'question', questionId: question.id } }), { variant: 'quiet' }),
    ),
  )
}

async function renderHistory(ctx: AppContext, questionId: string): Promise<HTMLElement> {
  const c = await ctx.motor.content()
  const revisions = await ctx.motor.repo.listRevisions(questionId)
  const attempts = ctx.motor.listAttempts()
  const voids = ctx.motor.listVoids()
  const byVersion = (v: number) => voids
    .filter((vd) => vd.reason === 'content_error')
    .filter((vd) => attempts.some((a) => a.id === vd.targetAttemptId && a.kind === 'question' && a.questionId === questionId && a.questionVersion === v))
    .map((vd) => `${formatDateTimeTr(vd.timestamp)} — ${vd.note ?? 'içerik hatası'}`)
  return h('div', { class: 'screen', 'data-screen': 'content-history' },
    button('← Soru', () => void ctx.navigate({ name: 'content', view: { kind: 'question', questionId } }), { variant: 'quiet', class: 'btn-inline' }),
    h('h1', { class: 'text-title' }, 'Sürüm geçmişi'),
    h('p', { class: 'text-support' }, 'Sürümler düzenlenemez; geçmiş denemeler cevap verdikleri sürümle saklanır.'),
    h('div', { class: 'stack' }, revisions.map((r) => revisionBlock(r, c.atoms, byVersion(r.version)))),
  )
}
