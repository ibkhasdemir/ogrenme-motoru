// S11b İçerik içe aktar (BL-38): yapıştır / panodan al / dosya seç → Önizle → Ekle. Uygulamada LLM yok; şablon dışarıdaki sohbet için.
// Yalnız ekler; mevcut içerik ve öğrenme geçmişi değişmez. Hatalı öğe varsa hiçbir şey eklenmez.
import { isCompleteRevision } from '../domain'
import { applyContentImport, planIsEmpty } from '../app/contentImport'
import type { RecoveryDeps } from '../app/recoveryPoints'
import { CONTENT_IMPORT_FORMAT, applyUnitToPlan, parseContentImport, planContentImport, summarizePlan, unitWarning, type ExistingContent, type ImportPlan } from '../engine/import/contentImport'
import type { AppContext } from './app'
import type { BackupServices } from './dataBackup'
import type { RestoreServices } from './dataRestore'
import { button, field, h, input, textarea } from './dom'

export interface ImportUiState {
  text: string
  /** "Tümünü şu ünitenin altına koy" — yapay zekâ üniteyi atlarsa dizini burada toparlarız (BL-39) */
  unit: string
  plan: ImportPlan | null
  error: string | null
  busy: boolean
}

export const IMPORT_PROMPT_TEMPLATE = `Aşağıdaki notları "Öğrenme Motoru" içe aktarma biçiminde JSON'a çevir. Yalnız JSON ver: kod bloğu (\`\`\`), başlık ya da açıklama yazma.

Kurallar:
- Her "atom" TEK cümlelik, tek anlamlı bir bilgidir. "soru" o atomu soran, cevabı içinde vermeyen tek bir sorudur.
- Dizin ÜÇ seviyedir: "ders" › "konu" › "altbaslik". **"konu" ünite düzeyidir ve tüm notlar için hemen hemen AYNI kalır** (örn. tüm not 18. yüzyılı anlatıyorsa her atomda "konu": "18. yy Osmanlı"). Ayrıntıyı ASLA "konu" alanına yazma; ayrıntı "altbaslik" alanına gider (örn. "Küçük Kaynarca Antlaşması", "I. Mahmut Islahatları", "Padişahlar").
- Kaba ölçü: bir ders notu için 1–3 farklı "konu", 5–20 farklı "altbaslik" beklenir. Her olayı ayrı "konu" yaparsan dizin bozulur.
- Notlardaki HER bilgiyi atomlaştır, eksik bırakma. Tarih, kişi, yer, sebep-sonuç, kavram tanımı ve istisnalar ayrı atomlar olur.
- "tur" isteğe bağlı; şunlardan biri ya da birkaçı: olgu, tarih, kronoloji, tanım, sebep-sonuç, süreç, karşılaştırma, mekân, kural, istisna.
- "cengel" isteğe bağlı hatırlatıcıdır; "tur": mantık | kodlama | absürt | benzetme | hikâye | görsel | uyarı | kişisel. Notlarda kullanıcının KENDİ kodlaması varsa onu olduğu gibi ilgili atom(lar)a "kodlama" olarak ekle; kendin kodlama uydurma.
- Her atom için en az bir çoktan seçmeli soru yaz: 2–5 seçenek, hepsi farklı, çeldiriciler aynı konudan ve inandırıcı. "dogru" = doğru seçeneğin METNİ (sayı değil). "kaynak" zorunlu (örn. "ders notu s.2").
- Her sorunun "atom" alanı, "atomlar" içindeki bir atomun metniyle birebir aynı olmalı.

Biçim:
{
  "format": "${CONTENT_IMPORT_FORMAT}",
  "atomlar": [
    { "ders": "Tarih", "konu": "18. yy Osmanlı", "altbaslik": "Islahatlar", "atom": "Lale Devri 1718 Pasarofça Antlaşması ile başladı.", "soru": "Lale Devri hangi antlaşmayla başladı?", "tur": ["tarih"], "cengel": [{ "tur": "kodlama", "metin": "Pasarofça → Lale açtı (1718)" }] },
    { "ders": "Tarih", "konu": "18. yy Osmanlı", "altbaslik": "Küçük Kaynarca Antlaşması", "atom": "Küçük Kaynarca Antlaşması 1774'te imzalandı.", "soru": "Küçük Kaynarca hangi yıl imzalandı?", "tur": ["tarih"] }
  ],
  "sorular": [
    { "atom": "Lale Devri 1718 Pasarofça Antlaşması ile başladı.", "soru": "Lale Devri hangi antlaşmayla başladı?", "secenekler": ["Pasarofça", "Karlofça", "Prut", "Belgrad"], "dogru": "Pasarofça", "kaynak": "ders notu s.1" }
  ],
  "cengeller": [
    { "atom": "Lale Devri 1718 Pasarofça Antlaşması ile başladı.", "tur": "kodlama", "metin": "kullanıcının kendi kodlaması buraya" }
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
  return { atoms: c.atoms, questions, hooks: c.hooks.map((hk) => ({ atomId: hk.atomId, content: hk.content })) }
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

type ShareNav = Navigator & { share?: (d: { text: string; title?: string }) => Promise<void> }
const canShareText = () => typeof (navigator as ShareNav).share === 'function'
const canReadClipboard = () => typeof navigator.clipboard?.readText === 'function'

export async function renderContentImport(ctx: AppContext, services: BackupServices | undefined, state: ImportUiState): Promise<HTMLElement> {
  const textIn = textarea({ placeholder: "JSON'u buraya yapıştır", 'aria-label': 'İçe aktarılacak JSON', rows: 8, 'data-testid': 'import-text' })
  textIn.value = state.text
  textIn.addEventListener('input', () => { state.text = textIn.value; state.plan = null })

  const unitIn = input({ placeholder: 'İsteğe bağlı — örn. 18. yy Osmanlı', 'aria-label': 'Ünite', autocomplete: 'off', 'data-testid': 'import-unit' })
  unitIn.value = state.unit
  unitIn.addEventListener('input', () => { state.unit = unitIn.value })

  const buildPlan = async (): Promise<ImportPlan> => applyUnitToPlan(planContentImport(parseContentImport(state.text), await existingContent(ctx)), state.unit)

  const preview = async () => {
    state.error = null
    try {
      state.plan = await buildPlan()
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
  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (!t.trim()) { ctx.notice('Pano boş.', 'error'); return ctx.render() }
      state.text = t
      await preview()
    } catch {
      ctx.notice('Panoya erişilemedi; kutuya elle yapıştır.', 'error')
      await ctx.render()
    }
  }
  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(IMPORT_PROMPT_TEMPLATE)
      ctx.notice("Şablon kopyalandı. Yapay zekâ sohbetine yapıştır, notlarını ekle, çıkan JSON'u buraya getir.", 'ok')
    } catch {
      ctx.notice('Kopyalanamadı; "Şablonu göster" ile elle seç.', 'error')
    }
    await ctx.render()
  }
  const shareTemplate = async () => {
    try {
      await (navigator as ShareNav).share!({ text: IMPORT_PROMPT_TEMPLATE, title: 'Öğrenme Motoru şablonu' })
    } catch {
      // vazgeçildi ya da desteklenmiyor; sessiz
    }
  }
  const apply = async () => {
    if (state.busy) return
    state.busy = true
    state.error = null
    try {
      const plan = await buildPlan() // güncel içerikle yeniden planla
      const out = await applyContentImport(ctx.motor, plan, recoveryDeps(ctx, services))
      state.text = ''
      state.unit = ''
      state.plan = null
      const parts = [`${out.atomsAdded} atom`, `${out.questionsAdded} soru`]
      if (out.hooksAdded) parts.push(`${out.hooksAdded} çengel`)
      ctx.notice(`${parts.join(', ')} eklendi.`, 'ok')
      await ctx.navigate({ name: 'content', view: { kind: 'list' } })
    } catch (e) {
      state.error = (e as Error).message
      await ctx.render()
    } finally {
      state.busy = false
    }
  }

  const plan = state.plan
  const warning = plan && !plan.errors.length ? unitWarning(plan) : null
  const canApply = !!plan && !plan.errors.length && !planIsEmpty(plan) && !state.busy
  const toList = () => void ctx.navigate({ name: 'content', view: { kind: 'list' } })
  return h('div', { class: 'screen', 'data-screen': 'import' },
    h('div', { class: 'row' }, button('← İçerik', toList, { variant: 'quiet', class: 'btn-inline' }), h('h1', { class: 'text-title' }, 'İçerik içe aktar')),
    h('p', { class: 'text-support' }, "1) Şablonu bir yapay zekâ sohbetine gönder, altına notlarını ekle. 2) Çıkan JSON'u kopyala. 3) Burada Panodan yapıştır → Önizle → Ekle. Yalnız ekler; mevcut içerik ve öğrenme geçmişi değişmez."),
    h('div', { class: 'row' },
      canShareText() ? button('Şablonu paylaş', () => void shareTemplate(), { class: 'btn-inline', testid: 'share-template' }) : null,
      button('Şablonu kopyala', () => void copyTemplate(), { class: 'btn-inline', testid: 'copy-template' }),
    ),
    h('details', {}, h('summary', { class: 'text-support' }, 'Şablonu göster'), h('pre', { class: 'import-template', 'data-testid': 'import-template' }, IMPORT_PROMPT_TEMPLATE)),
    h('div', { class: 'row' },
      canReadClipboard() ? button('Panodan yapıştır', () => void pasteFromClipboard(), { variant: 'secondary', class: 'btn-inline', testid: 'paste-import' }) : null,
      services?.files ? button('Dosya seç', () => void pickFile(), { class: 'btn-inline', testid: 'pick-import' }) : null,
    ),
    textIn,
    field('Ünite (tümü bunun altına konur)', unitIn, 'Yapay zekâ her olayı ayrı konu yaptıysa buraya ünite adını yaz; konular onun alt başlığı olur.'),
    button('Önizle', () => void preview(), { testid: 'preview-import' }),
    state.error ? h('div', { class: 'notice notice-error', role: 'alert', 'data-testid': 'import-error' }, state.error) : null,
    plan ? renderPlan(plan) : null,
    warning ? h('div', { class: 'notice', role: 'status', 'data-testid': 'import-unit-warning' }, warning) : null,
    h('div', { class: 'screen-bottom' },
      button('Ekle', () => void apply(), { variant: 'primary', disabled: !canApply, testid: 'apply-import' }),
      button('Vazgeç', toList, { variant: 'quiet' }),
    ),
  )
}
