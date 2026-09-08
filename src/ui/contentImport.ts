// S11b İçerik içe aktar (BL-38): yapıştır ya da dosya seç → Önizle → Ekle. Uygulamada LLM yok; şablon dışarıdaki sohbet için.
// Yalnız ekler; mevcut içerik ve öğrenme geçmişi değişmez. Hatalı öğe varsa hiçbir şey eklenmez.
import { isCompleteRevision } from '../domain'
import { applyContentImport } from '../app/contentImport'
import type { RecoveryDeps } from '../app/recoveryPoints'
import { CONTENT_IMPORT_FORMAT, parseContentImport, planContentImport, summarizePlan, type ExistingContent, type ImportPlan } from '../engine/import/contentImport'
import type { AppContext } from './app'
import type { BackupServices } from './dataBackup'
import type { RestoreServices } from './dataRestore'
import { button, h, textarea } from './dom'

export interface ImportUiState {
  text: string
  plan: ImportPlan | null
  error: string | null
  busy: boolean
}

export const IMPORT_PROMPT_TEMPLATE = `Aşağıdaki notları "Öğrenme Motoru" içe aktarma biçiminde JSON'a çevir. Yalnız JSON ver, açıklama yazma.

Kurallar:
- Her "atom" TEK cümlelik, tek anlamlı bir bilgidir. "soru" o atomu soran, cevabı içinde vermeyen tek bir sorudur.
- "ders" ve "konu" kısa adlardır (örn. "Tarih", "Tanzimat Dönemi").
- "tur" isteğe bağlı; şunlardan biri ya da birkaçı: olgu, tarih, kronoloji, tanım, sebep-sonuç, süreç, karşılaştırma, mekân, kural, istisna.
- "cengel" isteğe bağlı hatırlatıcıdır; "tur": mantık | kodlama | absürt | benzetme | hikâye | görsel | uyarı | kişisel.
- Sorular çoktan seçmelidir: 2–5 seçenek, hepsi farklı. "dogru" = doğru seçeneğin METNİ (sayı değil). "kaynak" zorunlu (örn. "kitap s.217", "ders notu", "kendi").
- Her sorunun "atom" alanı, "atomlar" içindeki bir atomun metniyle birebir aynı olmalı.

Biçim:
{
  "format": "${CONTENT_IMPORT_FORMAT}",
  "atomlar": [
    { "ders": "Tarih", "konu": "Tanzimat Dönemi", "atom": "Tanzimat Fermanı 1839'da ilan edildi.", "soru": "Tanzimat Fermanı hangi yıl ilan edildi?", "tur": ["tarih"], "cengel": [{ "tur": "kodlama", "metin": "18-39: on sekiz otuz dokuz" }] }
  ],
  "sorular": [
    { "atom": "Tanzimat Fermanı 1839'da ilan edildi.", "soru": "Tanzimat Fermanı hangi yıl ilan edildi?", "secenekler": ["1839", "1856", "1876"], "dogru": "1839", "kaynak": "ders notu" }
  ]
}

Notlar:
(buraya yapıştır)
`

async function existingContent(ctx: AppContext): Promise<ExistingContent> {
  const c = await ctx.motor.content()
  const questions: ExistingContent['questions'] = []
  for (const q of c.questions) {
    const rev = await ctx.motor.repo.getRevision(q.id, q.currentVersion)
    if (rev && isCompleteRevision(rev)) questions.push({ primaryAtomId: q.primaryAtomId, text: rev.text, archived: q.archived })
  }
  return { atoms: c.atoms, questions }
}

function recoveryDeps(ctx: AppContext, s: BackupServices | undefined): RecoveryDeps | null {
  const rs = s as RestoreServices | undefined
  if (!rs || !rs.recovery) return null
  return { repo: ctx.motor.repo, clock: ctx.motor.clock, ids: ctx.motor.ids, hash: rs.hash, appVersion: ctx.appVersion, recovery: rs.recovery }
}

function renderPlan(plan: ImportPlan): HTMLElement {
  if (plan.errors.length) {
    const shown = plan.errors.slice(0, 20)
    return h('div', { class: 'notice notice-error', role: 'alert', 'data-testid': 'import-errors' },
      h('div', { class: 'stack' },
        h('strong', {}, `${plan.errors.length} hata — hiçbir şey eklenmez:`),
        ...shown.map((e) => h('div', { class: 'text-support' }, e)),
        plan.errors.length > shown.length ? h('div', { class: 'text-support' }, `… ve ${plan.errors.length - shown.length} hata daha`) : null,
      ))
  }
  return h('div', { class: 'notice notice-ok', role: 'status', 'data-testid': 'import-summary' }, summarizePlan(plan))
}

export async function renderContentImport(ctx: AppContext, services: BackupServices | undefined, state: ImportUiState): Promise<HTMLElement> {
  const input = textarea({ placeholder: "JSON'u buraya yapıştır", 'aria-label': 'İçe aktarılacak JSON', rows: 10, 'data-testid': 'import-text' })
  input.value = state.text
  input.addEventListener('input', () => { state.text = input.value; state.plan = null })

  const preview = async () => {
    state.error = null
    try {
      state.plan = planContentImport(parseContentImport(state.text), await existingContent(ctx))
    } catch (e) {
      state.plan = null
      state.error = (e as Error).message
    }
    await ctx.render()
  }
  const pickFile = async () => {
    if (!services?.files) return
    const f = await services.files.pick()
    if (!f) return
    state.text = f.content
    await preview()
  }
  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(IMPORT_PROMPT_TEMPLATE)
      ctx.notice('Şablon kopyalandı. Yapay zekâ sohbetine yapıştır, notlarını ekle, çıkan JSON\'u buraya getir.', 'ok')
    } catch {
      ctx.notice('Kopyalanamadı; "Şablonu göster" ile elle seç.', 'error')
    }
    await ctx.render()
  }
  const apply = async () => {
    if (state.busy) return
    state.busy = true
    state.error = null
    try {
      const plan = planContentImport(parseContentImport(state.text), await existingContent(ctx)) // güncel içerikle yeniden planla
      const out = await applyContentImport(ctx.motor, plan, recoveryDeps(ctx, services))
      state.text = ''
      state.plan = null
      ctx.notice(`${out.atomsAdded} atom, ${out.questionsAdded} soru eklendi.`, 'ok')
      await ctx.navigate({ name: 'content', view: { kind: 'list' } })
    } catch (e) {
      state.error = (e as Error).message
      await ctx.render()
    } finally {
      state.busy = false
    }
  }

  const plan = state.plan
  const canApply = !!plan && !plan.errors.length && plan.atoms.length + plan.questions.length > 0 && !state.busy
  const toList = () => void ctx.navigate({ name: 'content', view: { kind: 'list' } })
  return h('div', { class: 'screen', 'data-screen': 'import' },
    h('div', { class: 'row' }, button('← İçerik', toList, { variant: 'quiet', class: 'btn-inline' }), h('h1', { class: 'text-title' }, 'İçerik içe aktar')),
    h('p', { class: 'text-support' }, "Atom ve soruları tek tek yazmak yerine JSON olarak ekle: şablonu kopyala, bir yapay zekâ sohbetine notlarınla birlikte yapıştır, çıkan JSON'u buraya yapıştır. Yalnız ekler; mevcut içerik ve öğrenme geçmişi değişmez."),
    h('div', { class: 'row' },
      button('Şablonu kopyala', () => void copyTemplate(), { class: 'btn-inline', testid: 'copy-template' }),
      services?.files ? button('Dosya seç', () => void pickFile(), { class: 'btn-inline', testid: 'pick-import' }) : null,
    ),
    h('details', {}, h('summary', { class: 'text-support' }, 'Şablonu göster'), h('pre', { class: 'import-template', 'data-testid': 'import-template' }, IMPORT_PROMPT_TEMPLATE)),
    input,
    button('Önizle', () => void preview(), { testid: 'preview-import' }),
    state.error ? h('div', { class: 'notice notice-error', role: 'alert', 'data-testid': 'import-error' }, state.error) : null,
    plan ? renderPlan(plan) : null,
    h('div', { class: 'screen-bottom' },
      button('Ekle', () => void apply(), { variant: 'primary', disabled: !canApply, testid: 'apply-import' }),
      button('Vazgeç', toList, { variant: 'quiet' }),
    ),
  )
}
