// 07 S11 İçerik (minimal): Ders › Konu › Atom listesi; atom aç (arşivle, soru yüzü tamamla); soru aç (Düzenle → yeni sürüm, K01,
// Sürüm geçmişi). Öğrenme modu: doğru seçenek burada görünebilir (14 §10).
import type { Atom, CompleteQuestionRevision, HookType, Question, QuestionRevision } from '../domain'
import { HOOK_TYPES, isCompleteRevision } from '../domain'
import { affectedAttemptsByKeyChange } from '../engine/question/contentError'
import { joinTopicPath, splitTopicPath } from '../engine/import/contentImport'
import type { AppContext } from './app'
import { button, field, formatDateTimeTr, h, input, swipeRow, textarea } from './dom'
import { HOOK_TYPE_HINT, HOOK_TYPE_LABEL, hookTypeLabel } from './labels'

export type ContentView =
  | { kind: 'list'; query?: string; archived?: boolean }
  | { kind: 'atom'; atomId: string }
  | { kind: 'question'; questionId: string; edit?: boolean }
  | { kind: 'history'; questionId: string }
  | { kind: 'topics' }

export const LEGACY_UNAVAILABLE_TEXT = 'Bu eski denemeye ait soru metni eski veri modelinde saklanmadığı için mevcut değil.'
export const VERSION_DATE_UNKNOWN = 'sürüm tarihi bilinmiyor'
export const EDIT_WARNING = 'Bu değişiklik yeni bir sürüm oluşturur; eski cevapların eski sürümle saklanır.'
export const CONTEXT_RESET_WARNING = 'Yanlış-şık ve ikincil atom ilişkileri sıfırlandı; gerekirse Gelişmiş\'ten yeniden işaretle.'
export const KEY_ERROR_QUESTION = 'Eski cevap anahtarı hatalı mıydı?'

export async function renderContent(ctx: AppContext, view: ContentView): Promise<HTMLElement> {
  switch (view.kind) {
    case 'list': return renderList(ctx, view.query ?? '', view.archived ?? false)
    case 'atom': return renderAtom(ctx, view.atomId)
    case 'question': return renderQuestion(ctx, view.questionId, view.edit ?? false)
    case 'history': return renderHistory(ctx, view.questionId)
    case 'topics': return renderTopics(ctx)
  }
}

/**
 * S11c Konuları düzenle (BL-39): mevcut konuları bir ünitenin altına taşı ya da yeniden adlandır/birleştir.
 * Telefon bulgusu 2026-09-08: içe aktarmada yapay zekâ üniteyi atlayınca 115 atom 37 ayrı konuya dağıldı; yeniden içe aktarmadan düzeltilebilmeli.
 */
async function renderTopics(ctx: AppContext): Promise<HTMLElement> {
  const c = await ctx.motor.content()
  const rows = c.topics
    .map((t) => ({ topic: t, subject: c.subjects.find((s) => s.id === t.subjectId), atoms: c.atoms.filter((a) => a.topicId === t.id && !a.archived).length }))
    .filter((r) => r.atoms > 0)
    .sort((a, b) => (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '', 'tr') || a.topic.name.localeCompare(b.topic.name, 'tr'))
  const selected = new Set<string>()
  let prefilledId: string | null = null // ad alanı hangi konu için dolduruldu; seçim değişince yenilenir (bayat adla yanlış konuyu birleştirme riski)
  let busy = false
  const unitIn = input({ placeholder: 'Ünite adı (örn. 18. yy Osmanlı)', 'aria-label': 'Ünite adı', autocomplete: 'off' })
  const nameIn = input({ placeholder: 'Yeni ad', 'aria-label': 'Yeni konu adı', autocomplete: 'off' })
  const moveBtn = button('Seçilenleri ünite altına taşı', () => void move(), { variant: 'primary', disabled: true, testid: 'move-topics' })
  const renameBtn = button('Seçileni yeniden adlandır', () => void rename(), { disabled: true, testid: 'rename-topic' })
  const count = h('span', { class: 'text-meta', 'data-testid': 'topic-selection' }, '0 konu seçili')
  const sync = () => {
    const only = selected.size === 1 ? rows.find((r) => r.topic.id === [...selected][0]) : undefined
    if (only && only.topic.id !== prefilledId) { nameIn.value = only.topic.name; prefilledId = only.topic.id }
    if (!only && prefilledId !== null) { nameIn.value = ''; prefilledId = null }
    count.textContent = only ? `1 konu seçili: ${only.topic.name}` : `${selected.size} konu seçili`
    moveBtn.disabled = busy || selected.size === 0 || !unitIn.value.trim()
    renameBtn.disabled = busy || !only || !nameIn.value.trim()
    selectAllBtn.disabled = busy || selected.size === rows.length
    clearBtn.disabled = busy || selected.size === 0
  }
  unitIn.addEventListener('input', sync)
  nameIn.addEventListener('input', sync)
  queueMicrotask(sync) // ilk çizimde düğme durumları (satır sayısına göre) yerine otursun
  const move = async () => {
    const unit = unitIn.value.trim()
    if (busy || !unit || !selected.size) return
    // iki seçili konu aynı ada inerse taşıma istemsiz birleştirme olur (ör. iki farklı ünitenin "Islahatlar"ı) → yapılmaz
    const picked = [...selected].map((id) => rows.find((r) => r.topic.id === id)).filter((r): r is (typeof rows)[number] => !!r)
    const clash = new Map<string, string[]>()
    for (const r of picked) {
      const target = joinTopicPath(unit, r.topic.name).toLocaleLowerCase('tr')
      clash.set(target, [...(clash.get(target) ?? []), r.topic.name])
    }
    const collided = [...clash.values()].filter((names) => names.length > 1)
    if (collided.length) {
      ctx.notice(`Taşınmadı: şu konular aynı ada inip birleşirdi — ${collided.map((n) => n.join(' + ')).join('; ')}. Önce adlarını farklılaştır.`, 'error')
      return ctx.render()
    }
    busy = true
    sync()
    try {
      let merged = 0
      for (const r of picked) {
        const out = await ctx.motor.renameTopic(r.topic.id, joinTopicPath(unit, r.topic.name))
        if (out.merged) merged++
      }
      ctx.notice(`${selected.size} konu "${unit}" ünitesinin altına taşındı${merged ? `; ${merged} tanesi aynı adlı konuyla birleşti` : ''}. Atomlar ve öğrenme geçmişi değişmedi.`, 'ok')
      await ctx.navigate({ name: 'content', view: { kind: 'topics' } })
    } catch (e) {
      busy = false
      ctx.notice(`Taşınamadı: ${(e as Error).message}`, 'error')
      await ctx.render()
    }
  }
  const rename = async () => {
    const id = [...selected][0]
    const name = nameIn.value.trim()
    if (busy || !id || !name) return
    busy = true
    sync()
    try {
      const out = await ctx.motor.renameTopic(id, name)
      ctx.notice(out.merged ? `Konular birleştirildi; ${out.movedAtoms} atom taşındı.` : 'Konu adı değiştirildi.', 'ok')
      await ctx.navigate({ name: 'content', view: { kind: 'topics' } })
    } catch (e) {
      busy = false
      ctx.notice((e as Error).message, 'error')
      await ctx.render()
    }
  }
  const checkboxes = new Map<string, HTMLInputElement>()
  const setAll = (on: boolean) => {
    selected.clear()
    for (const [id, cb] of checkboxes) { cb.checked = on; if (on) selected.add(id) }
    sync()
  }
  const selectAllBtn = button('Tümünü seç', () => setAll(true), { class: 'btn-inline', testid: 'select-all-topics' })
  const clearBtn = button('Seçimi temizle', () => setAll(false), { class: 'btn-inline', variant: 'quiet', testid: 'clear-topics' })
  const row = (r: (typeof rows)[number]) => {
    const cb = input({ type: 'checkbox', 'aria-label': r.topic.name })
    checkboxes.set(r.topic.id, cb)
    cb.addEventListener('change', () => { if (cb.checked) selected.add(r.topic.id); else selected.delete(r.topic.id); sync() })
    return h('label', { class: 'topic-row', 'data-topic': r.topic.id }, cb,
      h('span', { class: 'stack' },
        h('span', { class: 'text-body' }, r.topic.name),
        h('span', { class: 'text-meta' }, `${r.subject?.name ?? ''} · ${r.atoms} atom`),
      ))
  }
  return h('div', { class: 'screen', 'data-screen': 'topics' },
    h('div', { class: 'row' }, back(ctx), h('h1', { class: 'text-title' }, 'Konuları düzenle')),
    h('p', { class: 'text-support' }, 'Konuları bir ünitenin altında toplayabilirsin: "Küçük Kaynarca" → "18. yy Osmanlı › Küçük Kaynarca". Aynı adlı konu varsa birleşir. Atomlar, sorular ve öğrenme geçmişi değişmez.'),
    rows.length > 3 ? h('p', { class: 'text-support' }, `${rows.length} konu var. Hepsi aynı ünitedense: Tümünü seç → ünite adını yaz → taşı.`) : null,
    h('div', { class: 'card stack' },
      h('div', { class: 'row' }, selectAllBtn, clearBtn, count),
      field('Ünite', unitIn), moveBtn,
      field('Konu adı (tek seçimde)', nameIn), renameBtn,
    ),
    rows.length ? h('div', { class: 'stack' }, ...rows.map(row)) : h('p', { class: 'text-support' }, 'Henüz konu yok.'),
  )
}

function back(ctx: AppContext, view: ContentView = { kind: 'list' }): HTMLElement {
  return button('← İçerik', () => void ctx.navigate({ name: 'content', view }, { back: true }), { variant: 'quiet', class: 'btn-inline' })
}

async function renderList(ctx: AppContext, query: string, archived: boolean): Promise<HTMLElement> {
  const c = await ctx.motor.content()
  const q = query.trim().toLocaleLowerCase('tr')
  const archivedCount = c.atoms.filter((a) => a.archived).length
  const atoms = ctx.motor.sortedAtoms(c.atoms.filter((a) => a.archived === archived), c.topics, c.subjects)
    .filter((a) => !q || a.text.toLocaleLowerCase('tr').includes(q) || a.prompt.toLocaleLowerCase('tr').includes(q))
  const missingPrompt = atoms.filter((a) => !a.prompt.trim())
  const rest = atoms.filter((a) => a.prompt.trim())
  const search = input({ type: 'search', placeholder: 'Ara', value: query, 'aria-label': 'Ara' })
  search.addEventListener('input', () => void ctx.navigate({ name: 'content', view: { kind: 'list', query: search.value, archived } }))
  // atom başına soru sayısı bir kez hesaplanır (115 atom / 115 soruda listenin her satırında yeniden taramamak için)
  const qCounts = new Map<string, number>()
  for (const q of c.questions) if (!q.archived) qCounts.set(q.primaryAtomId, (qCounts.get(q.primaryAtomId) ?? 0) + 1)
  const row = (a: Atom, badge?: string, withCrumb = true) => {
    const qCount = qCounts.get(a.id) ?? 0
    const due = ctx.motor.nextDueOf(a.id)
    const topic = c.topics.find((t) => t.id === a.topicId)
    const subject = topic ? c.subjects.find((s) => s.id === topic.subjectId) : undefined
    const crumb = withCrumb ? [subject?.name, topic?.name].filter(Boolean).join(' › ') : '' // grup içinde başlık zaten söyler
    const item = h('button', { type: 'button', class: 'list-item', 'data-atom': a.id, onClick: () => void ctx.navigate({ name: 'content', view: { kind: 'atom', atomId: a.id } }) },
      h('span', { class: 'stack' },
        h('span', { class: 'text-body' }, a.text),
        h('span', { class: 'text-meta' }, [crumb, `${qCount} soru`, due ? `sonraki vade ${formatDateTimeTr(due)}` : ''].filter(Boolean).join(' · ')),
      ),
      badge ? h('span', { class: 'badge' }, badge) : null,
    )
    // BL-46: sola kaydır → arşivle (arşivdeyken geri getir). Aynı eylemler atom ekranında da var; hareket tek yol değil.
    return archived
      ? swipeRow(item, {
        label: 'Geri getir', testid: `unarchive-${a.id}`,
        onAct: () => void (async () => { await ctx.motor.unarchiveAtom(a.id); ctx.notice('Atom geri getirildi.', 'ok'); await ctx.render() })(),
      })
      : swipeRow(item, {
        label: 'Arşivle', danger: true, testid: `archive-${a.id}`,
        onAct: () => void (async () => { await ctx.motor.archiveAtom(a.id); ctx.notice('Atom arşivlendi; listeden ve kuyruktan çıktı. Arşiv\'den geri getirebilirsin.', 'ok'); await ctx.render() })(),
      })
  }
  // Ders › Ünite grupları, içinde alt başlıklar (dizin görünümü, BL-39): konu adındaki " › " ayracı ünite/alt başlık ayrımıdır
  const groups: { key: string; label: string; subs: { label: string | null; atoms: Atom[] }[]; count: number; questions: number }[] = []
  for (const a of rest) {
    const topic = c.topics.find((t) => t.id === a.topicId)
    const subject = topic ? c.subjects.find((s) => s.id === topic.subjectId) : undefined
    const { unit, sub } = splitTopicPath(topic?.name ?? '')
    const key = `${topic?.subjectId ?? ''}\n${unit.toLocaleLowerCase('tr')}`
    let g = groups.find((x) => x.key === key)
    if (!g) { g = { key, label: [subject?.name, unit].filter(Boolean).join(' › ') || 'Konusuz', subs: [], count: 0, questions: 0 }; groups.push(g) }
    let s = g.subs.find((x) => x.label === sub)
    if (!s) { s = { label: sub, atoms: [] }; g.subs.push(s) }
    s.atoms.push(a)
    g.count++
    g.questions += qCounts.get(a.id) ?? 0
  }
  const openAll = !!q || groups.length === 1
  return h('div', { class: 'screen', 'data-screen': 'content' },
    h('div', { class: 'row' }, button("← Bugün", () => void ctx.navigate({ name: 'today' }, { back: true }), { variant: 'quiet', class: 'btn-inline' }), h('h1', { class: 'text-title' }, 'İçerik')),
    h('div', { class: 'row' },
      button('İçe aktar', () => void ctx.navigate({ name: 'import' }), { class: 'btn-inline', testid: 'to-import' }),
      button('+ Atom', () => void ctx.navigate({ name: 'atomForm' }), { class: 'btn-inline', icon: 'atom' }),
      button('+ Soru', () => void ctx.navigate({ name: 'questionForm' }), { class: 'btn-inline', icon: 'question' }),
      button('Konular', () => void ctx.navigate({ name: 'content', view: { kind: 'topics' } }), { class: 'btn-inline', testid: 'to-topics' }),
      archived
        ? button('← Listeye dön', () => void ctx.navigate({ name: 'content', view: { kind: 'list' } }, { back: true }), { class: 'btn-inline', testid: 'to-active' })
        : button(`Arşiv${archivedCount ? ` · ${archivedCount}` : ''}`, () => void ctx.navigate({ name: 'content', view: { kind: 'list', archived: true } }), { class: 'btn-inline', testid: 'to-archived' }),
      h('span', { class: 'text-meta' }, `${rest.length + missingPrompt.length} atom · ${groups.length} ünite`),
    ),
    search,
    missingPrompt.length ? h('div', { class: 'stack' }, h('p', { class: 'text-support' }, 'Soru yüzü eksik olan atomlar çalışılmaz; tamamlayınca kuyruğa girer.'), missingPrompt.map((a) => row(a, 'soru yüzü eksik'))) : null,
    rest.length
      ? h('div', { class: 'stack' }, ...groups.map((g) => h('details', { class: 'group', open: openAll, 'data-group': g.key, 'data-keep-key': `group:${g.key}` },
        h('summary', { class: 'group-summary' }, h('span', { class: 'text-body' }, g.label), h('span', { class: 'text-meta' }, `${g.count} atom · ${g.questions} soru`)),
        h('div', { class: 'stack group-body' }, ...g.subs.flatMap((s) => [
          s.label ? h('p', { class: 'group-sub', 'data-sub': s.label }, s.label) : null,
          ...s.atoms.map((a) => row(a, undefined, false)),
        ])),
      )))
      : (!missingPrompt.length ? h('p', { class: 'text-support' }, archived ? 'Arşivde atom yok.' : 'Henüz atom yok.') : null),
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
  // Kendi kodlamanı sonradan ekleme (BL-39): içe aktarmanın "cengeller" bölümünün ekran karşılığı
  const hookTypeIn = h('select', { class: 'input', 'aria-label': 'Çengel türü' }, HOOK_TYPES.map((t) => h('option', { value: t }, `${HOOK_TYPE_LABEL[t]} — ${HOOK_TYPE_HINT[t]}`))) as HTMLSelectElement
  hookTypeIn.value = 'mnemonic'
  const hookIn = textarea({ placeholder: 'Kendi kodlaman / hatırlatıcın', 'aria-label': 'Çengel metni', rows: 2, 'data-testid': 'hook-text' })
  let savingHook = false
  const saveHook = async () => {
    const content = hookIn.value.trim()
    if (savingHook) return // çift dokunuş aynı çengeli iki kez yazmasın (silme yolu yok)
    if (!content) { ctx.notice('Çengel metni boş olamaz.', 'error'); return ctx.render() }
    savingHook = true
    try {
      const added = await ctx.motor.addHook(atom.id, { type: hookTypeIn.value as HookType, content })
      ctx.notice(added ? 'Çengel eklendi.' : 'Bu çengel zaten var.', added ? 'ok' : 'info')
      await ctx.navigate({ name: 'content', view: { kind: 'atom', atomId } })
    } catch (e) {
      savingHook = false
      ctx.notice((e as Error).message, 'error')
      await ctx.render()
    }
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
    h('details', { class: 'card', 'data-keep-key': `hook-form:${atomId}` }, h('summary', { class: 'text-support' }, hooks.length ? 'Çengel ekle' : 'Çengel ekle (kendi kodlaman)'),
      h('div', { class: 'stack' }, field('Tür', hookTypeIn), field('Çengel', hookIn, 'Cevabı yazma, cevabı çağrıştır'), button('Çengeli kaydet', () => void saveHook(), { testid: 'save-hook' }))),
    h('h2', { class: 'text-section' }, `Sorular (${questions.length})`),
    questions.length
      ? h('div', { class: 'stack' }, questions.map((q) => h('button', { type: 'button', class: 'list-item', 'data-question': q.id, onClick: () => void ctx.navigate({ name: 'content', view: { kind: 'question', questionId: q.id } }) }, h('span', {}, `Soru · v${q.currentVersion}${q.archived ? ' · arşivli' : ''}`), h('span', { class: 'source' }, q.source))))
      : h('p', { class: 'text-support' }, 'Bu atomun sorusu yok; hatırlama kartıyla çalışılır.'),
    h('div', { class: 'screen-bottom' },
      button('+ Soru ekle', () => void ctx.navigate({ name: 'questionForm', presetAtomId: atom.id }), { class: 'btn-inline' }),
      atom.archived
        ? button('Arşivden çıkar', async () => { await ctx.motor.unarchiveAtom(atom.id); ctx.notice('Atom geri getirildi.', 'ok'); await ctx.navigate({ name: 'content', view: { kind: 'atom', atomId } }) }, { class: 'btn-inline', testid: 'unarchive-atom' })
        : button('Arşivle', async () => { await ctx.motor.archiveAtom(atom.id); ctx.notice('Atom arşivlendi (silinmedi).', 'ok'); await ctx.navigate({ name: 'content', view: { kind: 'list' } }) }, { variant: 'danger', class: 'btn-inline', testid: 'archive-atom' }),
      // BL-46: kalıcı silme yalnız hiç çalışılmamış ve sorusu olmayan atomda; yoksa neden olmadığı yazılır
      ctx.motor.hasHistory(atom.id)
        ? h('p', { class: 'text-support', 'data-testid': 'no-delete' }, 'Bu atomun öğrenme geçmişi var: silinemez, yalnız arşivlenir. Ham cevap kayıtların korunur.')
        : questions.length
          ? h('p', { class: 'text-support', 'data-testid': 'no-delete' }, 'Bu atomun sorusu var: kalıcı silmek için önce soruyu arşivle.')
          : button('Kalıcı sil', async () => {
            try {
              await ctx.motor.deleteAtomPermanently(atom.id)
              ctx.notice('Atom kalıcı olarak silindi (hiç çalışılmamıştı).', 'ok')
              await ctx.navigate({ name: 'content', view: { kind: 'list' } })
            } catch (e) {
              ctx.notice((e as Error).message, 'error')
              await ctx.render()
            }
          }, { variant: 'danger', class: 'btn-inline', testid: 'delete-atom' }),
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
  const goBack = () => void ctx.navigate({ name: 'content', view: { kind: 'atom', atomId: question.primaryAtomId } }, { back: true })
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
    button('← Soru', () => void ctx.navigate({ name: 'content', view: { kind: 'question', questionId: question.id } }, { back: true }), { variant: 'quiet', class: 'btn-inline' }),
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
    button('← Soru', () => void ctx.navigate({ name: 'content', view: { kind: 'question', questionId } }, { back: true }), { variant: 'quiet', class: 'btn-inline' }),
    h('h1', { class: 'text-title' }, 'Sürüm geçmişi'),
    h('p', { class: 'text-support' }, 'Sürümler düzenlenemez; geçmiş denemeler cevap verdikleri sürümle saklanır.'),
    h('div', { class: 'stack' }, revisions.map((r) => revisionBlock(r, c.atoms, byVersion(r.version)))),
  )
}
