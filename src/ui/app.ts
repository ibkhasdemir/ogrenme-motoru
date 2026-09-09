// 07_UI_FLOW_V0 — Telefon-first akış. Aç → çalış → kapat. Durum makinesi (07 §3): Attempt her zaman doğru cevabın gösteriminden
// önce diske yazılır (soru yolu); kartta ölçüm "Cevabı aç" anında biter (BL-05). Vanilla TS, çerçeve yok.
import type { Confidence, MemoryHook, WrongReason } from '../domain'
import type { Motor, Presentation } from '../app/motor'
import type { Session, UndoToken } from '../engine/session/session'
import { add, button, clear, h, renderText } from './dom'
import { renderAtomForm, renderQuestionForm } from './forms'
import { renderContent, type ContentView } from './content'
import { renderData } from './data'
import { currentReminder, reminderLine, type BackupSectionState, type BackupServices } from './dataBackup'
import { hookTypeLabel } from './labels'
import { renderContentImport, type ImportUiState } from './contentImport'
import { emptyCaptureState, renderCapture, renderInbox, type CaptureUiState } from './capture'
import { renderProgress } from './progress'
import { restoreDeps, type RestoreServices, type RestoreUiState } from './dataRestore'
import { emergencyRollback } from '../app/restore'
import type { UpdateController } from '../pwa/register'
import type { AiService } from '../platform/ai'
import type { AiSettingsStore } from '../app/aiSettings'
import { emptyAiState, type AiSectionState } from './dataAi'
import { applyScreenTransition, trackTouchOrigin, type ScreenTransition } from './transition'

export type Screen =
  | { name: 'today' }
  | { name: 'read'; pres: Extract<Presentation, { kind: 'read' }> }
  | { name: 'question'; pres: Extract<Presentation, { kind: 'question' }>; phase: 'answer' | 'confidence' | 'reason' | 'result'; initial: string | null; selected: string | null; shownAtMono: number; confidence: Confidence | null; correct: boolean | null; token: UndoToken | null }
  | { name: 'recall'; pres: Extract<Presentation, { kind: 'recall' }>; phase: 'prompt' | 'revealed'; hookShown: boolean; shownAtMono: number; revealAtMono: number | null }
  | { name: 'end'; reason: 'budget' | 'empty'; dueSoon: number; sessionCount: number; pendingFirstTests: number }
  | { name: 'atomForm' }
  | { name: 'questionForm'; presetAtomId?: string; presetText?: string }
  | { name: 'content'; view: ContentView }
  | { name: 'import' }
  | { name: 'capture' }
  | { name: 'inbox' }
  | { name: 'progress' }
  | { name: 'data' }
  | { name: 'lockdown'; reason: string; jobId: string | null }

export interface AppDeps {
  motor: Motor
  appVersion: string
  /** yedek servisleri (HashService + BackupFileService [+ RecoveryStore + RestoreJournal]); yoksa Veri ekranında yedek bölümleri çıkmaz */
  services?: BackupServices | RestoreServices
  /** kilit ekranında kurtarma dökümü (main.ts kurtarma okuyucusunu bağlar) */
  onRecoveryDump?: () => Promise<void>
  /** 13 §7: bekleyen yeni sürüm → yalnız Bugün/Veri ekranında "Yeni sürüm hazır · Yenile"; Yenile yalnız bu istemciyi yeniler */
  updates?: UpdateController
  /** BL-44: geçerli anahtar varsa yapay zekâ servisi üretir; yoksa null döner */
  ai?: () => AiService | null
  /** BL-44: anahtar ayarları deposu (cihaz içi); verilmezse Veri ekranında yapay zekâ bölümü çıkmaz */
  aiSettings?: AiSettingsStore
}

export interface AppContext {
  motor: Motor
  appVersion: string
  /** `back: true` → geri dönüş sayılır: açılma efekti oynamaz (o ekrana zaten oradan gelinmişti) */
  navigate(screen: Screen, opts?: { back?: boolean }): Promise<void>
  render(): Promise<void>
  notice(text: string, kind?: 'ok' | 'error' | 'info'): void
  session: Session | null
  /** geri yükleme / sıfırlama sonrası: yeni nesil → bellek REBUILD, oturum ve bekleyen yedek teyidi geçersiz (06 §3) */
  afterDataReplaced(): Promise<void>
  /** 06 §8.6: acil geri dönüş de başarısız → yazma-kilitli kurtarma ekranı */
  lockdown(reason: string, jobId: string | null): Promise<void>
  /** BL-44: kullanıcı kendi anahtarını girdiyse yapay zekâ servisi; yoksa null (uygulama tam çalışır) */
  ai?: () => AiService | null
}

export interface AppHandle {
  ctx: AppContext
  getScreen(): Screen
  render(): Promise<void>
  destroy(): void
  /** görünürlük değişimi: oturum bütçesi durur/devam eder (03 §6.3) */
  setVisible(visible: boolean): void
}

interface UndoBar {
  token: UndoToken
  atomText: string
}

export function mountApp(root: HTMLElement, deps: AppDeps): AppHandle {
  const { motor } = deps
  let screen: Screen = { name: 'today' }
  let session: Session | null = null
  let sessionCount = 0
  let undoBar: UndoBar | null = null
  let undoTimer: ReturnType<typeof setTimeout> | null = null
  let noticeState: { text: string; kind: 'ok' | 'error' | 'info' } | null = null
  let renderSeq = 0
  const backupState: BackupSectionState = { pendingConfirm: null, lastMessage: null }
  const importState: ImportUiState = { text: '', notes: '', unit: '', plan: null, error: null, busy: false, generating: false }
  const captureState: CaptureUiState = emptyCaptureState()
  const aiState: AiSectionState = emptyAiState()

  // Geri hareketi (BL-45): her ekran geçişi tarayıcı geçmişine yazılır. iOS ana ekran uygulamasında kenardan kaydırma ve
  // Android'de donanım geri tuşu bunu kullanır; ayrıca ekranın üstündeki "←" hep yapışık durur.
  // Geçiş animasyonu (14 §14): yön duygusu. İleri gidiş dokunulan noktadan büyür, geri gidiş küçülerek gelir, aynı
  // ekranın adımları yumuşak belirir. Aynı ekranın yeniden çizimi (yazarken) sessizdir — bu yüzden anahtarla karşılaştırılır.
  const untrackTouch = trackTouchOrigin()

  // Yapışkan başlık, içerik altından geçmeye başlayınca saç teli çizgi + çok hafif gölge alır (14 §11, §16).
  // Böylece "sayfa kaydı mı" sorusu görsel olarak yanıtlanır; çizgi tepedeyken görünmez, gereksiz çerçeve olmaz.
  const onScroll = (): void => {
    const header = root.querySelector<HTMLElement>('.screen > .row:first-child')
    if (!header) return
    const scroller = document.scrollingElement ?? document.documentElement
    header.classList.toggle('is-stuck', (scroller?.scrollTop ?? 0) > 4)
  }
  const scrollOk = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
  if (scrollOk) window.addEventListener('scroll', onScroll, { passive: true })
  let poppedTransition = false
  let lastPushKey = 'today'
  let lastFadeKey = ''

  const stack: Screen[] = [{ name: 'today' }]
  let depth = 1 // geçmişteki konumumuz (history.state.motorDepth ile aynı); ileri gitme bunu artırır
  let popping = false
  const historyOk = typeof history !== 'undefined' && typeof history.pushState === 'function'

  const ctx: AppContext = {
    motor,
    appVersion: deps.appVersion,
    get session() { return session },
    async navigate(s, opts) {
      const sameKind = screen.name === s.name
      if (opts?.back) poppedTransition = true // "← Bugün" gibi düğmeler ileri gidiş değildir
      screen = s
      if (!popping) {
        if (sameKind) {
          // aynı ekranın içindeki durum değişimi (arama yazarken): geçmiş şişmez ama yığın tepesi GÜNCELLENİR
          stack[depth - 1] = s
          if (historyOk) history.replaceState({ motorDepth: depth }, '')
        } else {
          stack.length = depth // geri gidip başka yere sapıldıysa ileri kayıtları düşer
          stack.push(s)
          depth = stack.length
          if (historyOk) history.pushState({ motorDepth: depth }, '')
        }
      }
      await render()
    },
    render: () => render(),
    notice(text, kind = 'info') { noticeState = { text, kind } },
    async afterDataReplaced() {
      session = null
      undoBar = null
      backupState.pendingConfirm = null // işaretçi eski nesle aittir (BL-31)
      backupState.lastMessage = null
      await motor.refresh()
    },
    ...(deps.ai ? { ai: deps.ai } : {}),
    async lockdown(reason, jobId) {
      session = null
      screen = { name: 'lockdown', reason, jobId }
      // kendi geçmiş girdisini alır ki geri hareketi kilitten çıkarmasın (onPopState ayrıca yutar)
      stack.length = depth
      stack.push(screen)
      depth = stack.length
      if (historyOk) history.pushState({ motorDepth: depth }, '')
      await render()
    },
  }
  const restoreState: { restore: RestoreUiState } = { restore: { step: 'idle', message: null, error: null } }

  const STUDY_SCREENS = new Set(['read', 'question', 'recall', 'end'])
  const onPopState = (ev: PopStateEvent) => {
    // 06 §8.6: yazma-kilitli kurtarma ekranı terk edilemez; geri hareketi burada yutulur
    if (screen.name === 'lockdown') {
      if (historyOk) history.pushState({ motorDepth: depth }, '')
      return
    }
    popping = true
    try {
      // geçmişteki konum state'ten okunur: hem geri hem İLERİ doğru ekrana götürür
      const target = Math.min(Math.max(1, ((ev.state as { motorDepth?: number } | null)?.motorDepth) ?? 1), stack.length)
      if (STUDY_SCREENS.has(screen.name)) { session = null; undoBar = null } // yarım cevap kaydedilmez (07 §1.1)
      depth = target
      screen = stack[depth - 1] ?? { name: 'today' as const }
      poppedTransition = true
      void render()
    } finally {
      popping = false
    }
  }
  if (historyOk) {
    history.replaceState({ motorDepth: 1 }, '')
    window.addEventListener('popstate', onPopState)
  }

  function nowMono(): number { return motor.clock.monotonicMs() }

  function scheduleUndoHide(token: UndoToken): void {
    if (undoTimer) clearTimeout(undoTimer)
    const remaining = Math.max(0, token.expiresAtMono - nowMono())
    undoTimer = setTimeout(() => { undoTimer = null; void render() }, remaining + 10)
  }

  function tokenAlive(token: UndoToken | null): token is UndoToken {
    return !!token && !token.consumed && nowMono() <= token.expiresAtMono
  }

  // --- oturum akışı (03 §6) ---
  async function startSession(budgetMs: number | null): Promise<void> {
    session = motor.startSession(budgetMs)
    sessionCount = 0
    undoBar = null
    await nextItem()
  }

  async function nextItem(): Promise<void> {
    if (!session) return ctx.navigate({ name: 'today' })
    const pres = await motor.next(session)
    await showPresentation(pres)
  }

  async function showPresentation(pres: Presentation): Promise<void> {
    switch (pres.kind) {
      case 'end':
        return ctx.navigate({ name: 'end', reason: pres.reason, dueSoon: pres.dueSoon, sessionCount, pendingFirstTests: session?.pendingFirstTests() ?? 0 })
      case 'read':
        return ctx.navigate({ name: 'read', pres })
      case 'question':
        return ctx.navigate({ name: 'question', pres, phase: 'answer', initial: null, selected: null, shownAtMono: nowMono(), confidence: null, correct: null, token: null })
      case 'recall':
        return ctx.navigate({ name: 'recall', pres, phase: 'prompt', hookShown: false, shownAtMono: nowMono(), revealAtMono: null })
    }
  }

  async function leaveToToday(): Promise<void> {
    // 07 §1.1: çalışma ekranından Bugün'e dönüş — yarım cevap kaydedilmez, öğe yeniden sunulur (pendingReplay zorunluluğu kalmaz)
    session = null
    undoBar = null
    await ctx.navigate({ name: 'today' })
  }

  // --- render sürekliliği ---
  // Her render ekranı sıfırdan kurar. Telefonda bunun iki görünür bedeli var: yazarken odak (ve klavye) kaybolur, açık
  // <details> panelleri kapanır. Aşağıdaki iki yardımcı, aynı kimliği taşıyan öğeye odağı ve açıklığı geri verir.
  function focusKeyOf(el: Element | null): string | null {
    if (!el || el === document.body) return null
    const k = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.id
    return k || null
  }
  function captureFocus(): { key: string; start: number | null; end: number | null } | null {
    const el = document.activeElement
    const key = focusKeyOf(el)
    if (!key || !root.contains(el)) return null
    const f = el as HTMLInputElement | HTMLTextAreaElement
    const selectable = typeof f.selectionStart === 'number'
    return { key, start: selectable ? f.selectionStart : null, end: selectable ? f.selectionEnd : null }
  }
  function restoreFocus(saved: { key: string; start: number | null; end: number | null } | null): void {
    if (!saved) return
    // CSS.escape yalnız CSS nesnesine bağlıyken çalışır (koparılırsa TypeError); yoksa tırnak/ters bölü kaçışı yeter
    const esc = typeof window.CSS?.escape === 'function' ? window.CSS.escape(saved.key) : saved.key.replace(/["\\]/g, '\\$&')
    const el = root.querySelector<HTMLElement>(`[data-testid="${esc}"], [aria-label="${esc}"], #${esc}`)
    if (!el) return
    el.focus({ preventScroll: true })
    const f = el as HTMLInputElement | HTMLTextAreaElement
    if (saved.start !== null && typeof f.setSelectionRange === 'function') {
      try { f.setSelectionRange(saved.start, saved.end ?? saved.start) } catch { /* desteklemeyen tip */ }
    }
  }
  // Yatay kaydırılan çubuk (büyük sistem yazısında alt çubuk taşabilir): her render DOM'u sıfırdan kurduğu için
  // kaydırma konumu sıfırlanıyor ve kullanıcı sağa kaydırdığı çubuğu geri döndüğünde baştan buluyordu.
  function captureScroll(): number[] {
    return [...root.querySelectorAll<HTMLElement>('.nav-bar')].map((el) => el.scrollLeft)
  }
  function restoreScroll(saved: number[]): void {
    const bars = [...root.querySelectorAll<HTMLElement>('.nav-bar')]
    bars.forEach((el, i) => { const x = saved[i]; if (x) el.scrollLeft = x })
  }

  function captureOpenPanels(): Set<string> {
    const open = new Set<string>()
    for (const d of root.querySelectorAll<HTMLDetailsElement>('details[data-keep-key]')) {
      if (d.open) open.add(d.getAttribute('data-keep-key')!)
    }
    return open
  }
  function restoreOpenPanels(open: Set<string>): void {
    if (!open.size) return
    for (const d of root.querySelectorAll<HTMLDetailsElement>('details[data-keep-key]')) {
      if (open.has(d.getAttribute('data-keep-key')!)) d.open = true
    }
  }

  // --- geçiş anahtarları ---
  // pushKey: "başka bir yere gittim" (ekran değişti ya da İçerik içinde bir kademe indim) → büyüyerek açılır.
  // fadeKey: aynı ekranın bir sonraki adımı (soru → güven → sonuç) → yumuşak belirir. İkisi de aynıysa animasyon yok.
  function pushKey(s: Screen): string {
    return s.name === 'content' ? `content:${s.view.kind}` : s.name
  }
  function fadeKey(s: Screen): string {
    if (s.name === 'question' || s.name === 'recall') return `${s.name}:${s.phase}`
    return pushKey(s)
  }
  function nextTransition(): ScreenTransition | null {
    const pk = pushKey(screen)
    const fk = fadeKey(screen)
    const kind: ScreenTransition | null = poppedTransition ? 'pop' : pk !== lastPushKey ? 'push' : fk !== lastFadeKey ? 'fade' : null
    lastPushKey = pk
    lastFadeKey = fk
    poppedTransition = false
    return kind
  }

  // --- render ---
  async function render(): Promise<void> {
    const seq = ++renderSeq
    let el: HTMLElement
    try {
      el = await renderScreen()
    } catch (e) {
      el = h('div', { class: 'screen' }, h('div', { class: 'notice notice-error' }, `Hata: ${(e as Error).message}`), button("Bugün'e dön", () => void leaveToToday()))
    }
    if (seq !== renderSeq) return // araya yeni render girdi
    const savedFocus = captureFocus()
    const openPanels = captureOpenPanels()
    const savedScroll = captureScroll()
    clear(root)
    if (deps.updates?.pending() && (screen.name === 'today' || screen.name === 'data')) {
      el.prepend(h('div', { class: 'notice notice-ok', role: 'status', 'data-testid': 'update-bar' }, 'Yeni sürüm hazır · ', button('Yenile', () => deps.updates!.apply(), { variant: 'quiet', class: 'btn-inline', testid: 'update-apply' })))
    }
    if (noticeState) {
      el.prepend(h('div', { class: `notice ${noticeState.kind === 'error' ? 'notice-error' : noticeState.kind === 'ok' ? 'notice-ok' : ''}`, role: 'status' }, noticeState.text))
      noticeState = null
    }
    if (undoBar && tokenAlive(undoBar.token) && screen.name !== 'today') { // BL-11: sonraki ekranda (oturum sonu dâhil) 30 sn
      const bar = undoBar
      el.appendChild(h('div', { class: 'undo-bar', role: 'status' },
        h('span', { class: 'text-support' }, 'Son kartı geri al'),
        button('Geri al', () => void undoRecall(bar.token), { variant: 'quiet', class: 'btn-inline', testid: 'undo-recall' }),
      ))
    } else if (undoBar && !tokenAlive(undoBar.token)) undoBar = null
    root.appendChild(el)
    applyScreenTransition(el, nextTransition())
    onScroll()
    restoreOpenPanels(openPanels)
    restoreScroll(savedScroll)
    restoreFocus(savedFocus)
  }

  async function renderScreen(): Promise<HTMLElement> {
    switch (screen.name) {
      case 'today': return renderToday()
      case 'read': return renderRead(screen)
      case 'question': return renderQuestion(screen)
      case 'recall': return renderRecall(screen)
      case 'end': return renderEnd(screen)
      case 'atomForm': return renderAtomForm(ctx)
      case 'questionForm': return renderQuestionForm(ctx, screen.presetAtomId, screen.presetText)
      case 'content': return renderContent(ctx, screen.view)
      case 'import': return renderContentImport(ctx, deps.services, importState)
      case 'capture': return renderCapture(ctx, captureState)
      case 'inbox': return renderInbox(ctx, captureState)
      case 'progress': return renderProgress(ctx)
      case 'data': return renderData(ctx, { services: deps.services, backupState, restoreState, ...(deps.aiSettings ? { ai: { store: deps.aiSettings, state: aiState } } : {}) })
      case 'lockdown': return renderLockdown(screen)
    }
  }

  /** 06 §8.6 — yazma-kilitli kurtarma ekranı: tek dokunuşla aynı noktaya dönüş + kurtarma dökümü; uygulama yeniden açılmalı. */
  function renderLockdown(s: Extract<Screen, { name: 'lockdown' }>): HTMLElement {
    const services = deps.services as RestoreServices | undefined
    const retry = async () => {
      if (!services?.journal || !services.recovery || !s.jobId) return
      const job = await services.journal.get(s.jobId)
      if (!job?.prePointId) { ctx.notice('Ön nokta bulunamadı; kurtarma dökümü al.', 'error'); return render() }
      const out = await emergencyRollback(restoreDeps(ctx, services), s.jobId, job.prePointId, 'kullanıcı isteğiyle yeniden deneme')
      if (out.ok === false && out.rolledBack) { await ctx.afterDataReplaced(); ctx.notice('Önceki durumuna dönüldü. Uygulamayı yeniden aç.', 'ok'); await ctx.navigate({ name: 'today' }) } else { ctx.notice('Dönüş yine başarısız; kurtarma dökümü al.', 'error'); await render() }
    }
    return h('div', { class: 'screen', 'data-screen': 'lockdown' },
      h('h1', { class: 'text-title' }, 'Kurtarma'),
      h('p', { class: 'text-body' }, 'Geri yükleme tamamlanamadı; verin korunmuş kurtarma noktasındadır.'),
      h('p', { class: 'text-support' }, s.reason),
      h('div', { class: 'screen-bottom' },
        button('Kurtarma noktasına dön', () => void retry(), { variant: 'primary', testid: 'lockdown-retry' }),
        deps.onRecoveryDump ? button('Kurtarma dökümü al', () => void deps.onRecoveryDump!(), { testid: 'lockdown-dump' }) : null,
      ),
    )
  }

  // --- S1 Bugün ---
  async function renderToday(): Promise<HTMLElement> {
    const summary = await motor.today()
    const content = await motor.content()
    const hasAtoms = content.atoms.some((a) => !a.archived)
    const n = summary.queue.length
    const todayIso = motor.clock.now()
    const reminder = deps.services ? reminderLine(await currentReminder(ctx)) : null
    const pending = (await motor.listInbox()).filter((i) => i.status === 'pending').length // 05 §3: bekleyen yakalamalar
    const el = h('div', { class: 'screen', 'data-screen': 'today' },
      h('div', {},
        h('h1', { class: 'text-title' }, 'Bugün'),
        h('p', { class: 'text-meta' }, new Date(todayIso).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })),
      ),
      h('div', { class: 'counts' },
        h('div', { class: 'count' }, h('span', { class: 'count-n' }, String(summary.counts.review)), h('span', { class: 'count-l' }, 'tekrar')),
        h('div', { class: 'count' }, h('span', { class: 'count-n' }, String(summary.counts.new)), h('span', { class: 'count-l' }, 'yeni')),
        h('div', { class: 'count' }, h('span', { class: 'count-n' }, String(summary.counts.doneToday)), h('span', { class: 'count-l' }, 'bugün yapılan')),
      ),
      h('div', { class: 'row' },
        button('İlerleme', () => void ctx.navigate({ name: 'progress' }), { variant: 'quiet', class: 'btn-inline', testid: 'to-progress', icon: 'progress' }),
      ),
      summary.skew.warning
        ? h('div', { class: 'notice', role: 'status' }, `Cihaz saati tutarsız görünüyor: ${summary.skew.futureDated.length} kayıt ileri tarihli · `, button('İncele', () => void ctx.navigate({ name: 'data' }), { variant: 'quiet', class: 'btn-inline' }))
        : null,
      reminder
        ? h('div', { class: 'notice', role: 'status', 'data-testid': 'backup-reminder' }, `${reminder} · `, button('Yedek al', () => void ctx.navigate({ name: 'data' }), { variant: 'quiet', class: 'btn-inline' }))
        : null,
      n > 0
        ? h('div', { class: 'stack' },
          button(`Başla · ${n} öğe`, () => void startSession(null), { variant: 'primary', testid: 'start' }),
          h('div', { class: 'row' },
            button('3 dk', () => void startSession(3 * 60_000), { class: 'btn-inline', testid: 'start-3' }),
            button('5 dk', () => void startSession(5 * 60_000), { class: 'btn-inline', testid: 'start-5' }),
            button('10 dk', () => void startSession(10 * 60_000), { class: 'btn-inline', testid: 'start-10' }),
          ),
        )
        : h('div', { class: 'card' }, renderText(hasAtoms ? 'Şu an vadesi gelen bir şey yok. Motor zamanı geldiğinde getirir.' : 'Henüz atom yok', 'text-body')),
      // 07 §6 + 14 §11: alt çubuk DÖRT alan taşır ve KAYDIRILMAZ. Yedi düğme tek satıra sığmıyor, yana kayıyor,
      // sağdakiler kırpılıyor ve her yeniden çizimde başa dönüyordu. İçerik üretme eylemleri (+ Atom / + Soru)
      // İçerik ekranına, İlerleme ise sayıların altına taşındı — ait oldukları yer orası.
      h('div', { class: 'screen-bottom' },
        h('div', { class: 'nav-bar', role: 'group', 'aria-label': 'Gezinme' },
          button('+ Yakala', () => void ctx.navigate({ name: 'capture' }), { class: 'btn-inline', testid: 'to-capture', icon: 'capture' }),
          pending > 0
            ? button(`Kutu · ${pending}`, () => void ctx.navigate({ name: 'inbox' }), { class: 'btn-inline', testid: 'to-inbox', icon: 'inbox' })
            : button('Kutu', () => void ctx.navigate({ name: 'inbox' }), { class: 'btn-inline', testid: 'to-inbox', icon: 'inbox' }),
          button('İçerik', () => void ctx.navigate({ name: 'content', view: { kind: 'list' } }), { class: 'btn-inline', icon: 'content' }),
          button('Veri', () => void ctx.navigate({ name: 'data' }), { class: 'btn-inline', icon: 'data' }),
        ),
      ),
    )
    return el
  }

  function crumb(pres: Extract<Presentation, { kind: 'read' | 'question' | 'recall' }>, prefix?: string): HTMLElement {
    const place = [pres.subject?.name, pres.topic?.name].filter(Boolean).join(' › ')
    return h('p', { class: 'crumb' }, [prefix, place].filter(Boolean).join(' · '))
  }

  function hooksBlock(hooks: MemoryHook[]): HTMLElement | null {
    if (!hooks.length) return null
    return h('div', { class: 'stack' }, hooks.map((hk) => h('div', { class: 'hook' }, h('span', { class: 'hook-type' }, hookTypeLabel(hk.type)), h('p', { class: 'text-body' }, hk.content))))
  }

  function atomExplanation(pres: Extract<Presentation, { kind: 'read' | 'question' | 'recall' }>): HTMLElement {
    const a = pres.atom
    return h('div', { class: 'card stack', 'data-testid': 'atom-explanation' },
      h('p', { class: 'text-question' }, a.text),
      a.why ? h('p', { class: 'text-body' }, `Neden: ${a.why}`) : null,
      a.how ? h('p', { class: 'text-body' }, `Nasıl: ${a.how}`) : null,
      hooksBlock(pres.hooks),
    )
  }

  // --- S2 Oku ---
  function renderRead(s: Extract<Screen, { name: 'read' }>): HTMLElement {
    return h('div', { class: 'screen', 'data-screen': 'read' },
      crumb(s.pres, 'Yeni'),
      atomExplanation(s.pres),
      h('div', { class: 'screen-bottom' },
        // BL-47: "Okudum" ilk denemeyi hemen açmaz; araya birkaç öğe girer, soru gerçek hatırlamayı ölçer
        button('Okudum', async () => {
          session?.deferFirstTest(s.pres.atom.id)
          await nextItem()
        }, { variant: 'primary', testid: 'read-done' }),
        button("Bugün'e dön", () => void leaveToToday(), { variant: 'quiet' }),
      ),
    )
  }

  // --- S3–S6 Soru ---
  function renderQuestion(s: Extract<Screen, { name: 'question' }>): HTMLElement {
    const { pres } = s
    const rev = pres.revision
    const showResult = s.phase === 'result'
    const optionClass = (id: string) => {
      if (!showResult) return `btn option ${s.selected === id ? 'is-selected' : ''}` // ölçüm modu: yalnız seçili/seçili değil (14 §10)
      if (id === rev.correctOptionId) return 'btn option is-correct'
      if (id === s.selected) return 'btn option is-incorrect'
      return 'btn option'
    }
    const options = h('div', { class: 'stack', role: 'group', 'aria-label': 'Seçenekler' },
      rev.options.map((o) => h('button', {
        type: 'button', class: optionClass(o.id), disabled: s.phase !== 'answer', 'data-option': o.id,
        'aria-pressed': s.selected === o.id ? 'true' : 'false',
        onClick: () => { s.initial = s.initial ?? o.id; s.selected = o.id; void render() },
      }, o.text)),
    )
    const el = h('div', { class: 'screen', 'data-screen': 'question', 'data-phase': s.phase })
    if (s.phase === 'answer') {
      add(el, 
        crumb(pres, session ? `${session.answered + 1}/${session.answered + 1}` : undefined),
        h('p', { class: 'text-question' }, rev.text),
        options,
        h('div', { class: 'screen-bottom' },
          button('Cevapla', () => { s.phase = 'confidence'; void render() }, { variant: 'primary', disabled: !s.selected, testid: 'answer' }),
          button("Bugün'e dön", () => void leaveToToday(), { variant: 'quiet' }),
        ),
      )
    } else if (s.phase === 'confidence') {
      // S4: cevap açıklanmadan ÖNCE güven (A7)
      const pick = (c: Confidence) => void onConfidence(s, c)
      add(el, 
        crumb(pres),
        h('p', { class: 'text-question' }, 'Ne kadar eminsin? Cevap henüz gösterilmedi.'),
        h('div', { class: 'stack' },
          button('Eminim', () => pick('sure'), { testid: 'conf-sure' }),
          button('İki şık arasında kaldım', () => pick('unsure'), { testid: 'conf-unsure' }),
          button('Salladım', () => pick('guess'), { testid: 'conf-guess' }),
        ),
      )
    } else if (s.phase === 'reason') {
      // S6: yalnız "Yanlış." + dört çip; doğru seçenek ve açıklama HENÜZ yok (07 §3)
      const reason = (r: WrongReason) => void onReason(s, r)
      add(el, 
        h('p', { class: 'text-display result-incorrect' }, 'Yanlış.'),
        options,
        h('p', { class: 'text-section' }, 'Neden yanlış?'),
        h('div', { class: 'row', role: 'group', 'aria-label': 'Yanlış nedeni' },
          h('button', { type: 'button', class: 'chip', onClick: () => reason('unknown') }, 'Bilmiyordum'),
          h('button', { type: 'button', class: 'chip', onClick: () => reason('confused') }, 'Karıştırdım'),
          h('button', { type: 'button', class: 'chip', onClick: () => reason('attention') }, 'Dikkat / işlem'),
          h('button', { type: 'button', class: 'chip', onClick: () => reason('skipped') }, 'Geç'),
        ),
      )
    } else {
      // S5: sonuç — Attempt zaten diskte
      add(el, 
        h('p', { class: `text-display ${s.correct ? 'result-correct' : 'result-incorrect'}` }, s.correct ? 'Doğru.' : 'Yanlış.'),
        options,
        atomExplanation(pres),
        h('div', { class: 'screen-bottom' },
          button('Devam', () => void nextItem(), { variant: 'primary', testid: 'continue' }),
          tokenAlive(s.token) ? button('Geri al', () => void undoQuestion(s), { variant: 'quiet', testid: 'undo' }) : null,
        ),
      )
    }
    return el
  }

  async function onConfidence(s: Extract<Screen, { name: 'question' }>, confidence: Confidence): Promise<void> {
    if (!session || !s.selected || !s.initial) return
    s.confidence = confidence
    const correct = s.selected === s.pres.revision.correctOptionId
    s.correct = correct
    if (!correct) { s.phase = 'reason'; return render() } // neden Attempt'ın parçasıdır; kayıt neden dokunuşunda
    await writeQuestionAttempt(s)
  }

  async function onReason(s: Extract<Screen, { name: 'question' }>, reason: WrongReason): Promise<void> {
    await writeQuestionAttempt(s, reason)
  }

  async function writeQuestionAttempt(s: Extract<Screen, { name: 'question' }>, wrongReason?: WrongReason): Promise<void> {
    if (!session || !s.selected || !s.initial || !s.confidence) return
    const responseTimeMs = Math.max(0, Math.round(nowMono() - s.shownAtMono))
    try {
      const { token } = await motor.answerQuestion(session, s.pres, {
        initialSelectedOptionId: s.initial, selectedOptionId: s.selected, confidence: s.confidence, ...(wrongReason ? { wrongReason } : {}), responseTimeMs,
      })
      sessionCount++
      s.token = token
      if (token) scheduleUndoHide(token)
      s.phase = 'result' // doğru cevap ve açıklama Attempt diske yazıldıktan SONRA açılır
      await render()
    } catch (e) {
      ctx.notice(`Kayıt yazılamadı: ${(e as Error).message}. Öğe yeniden sunulacak.`, 'error')
      await nextItem()
    }
  }

  async function undoQuestion(s: Extract<Screen, { name: 'question' }>): Promise<void> {
    if (!session || !s.token) return
    const ok = await motor.undo(session, s.token)
    if (!ok) { ctx.notice('Geri alma süresi geçti.', 'info'); return render() }
    await nextItem() // aynı soru, aynı sürüm bir kez yeniden sunulur (03 §6.5)
  }

  // --- S7 Hatırlama kartı ---
  function renderRecall(s: Extract<Screen, { name: 'recall' }>): HTMLElement {
    const { pres } = s
    const el = h('div', { class: 'screen', 'data-screen': 'recall', 'data-phase': s.phase }, crumb(pres, 'Hatırlama kartı'))
    if (s.phase === 'prompt') {
      add(el, 
        h('p', { class: 'text-question' }, pres.atom.prompt),
        h('p', { class: 'text-support' }, 'Önce kendi kendine söyle (sesli olabilir). Sonra cevabı aç.'),
        s.hookShown ? hooksBlock(pres.hooks) : null,
        h('div', { class: 'screen-bottom' },
          pres.hooks.length && !s.hookShown ? button('Çengeli göster', () => { s.hookShown = true; void render() }, { testid: 'show-hook' }) : null,
          button('Cevabı aç', () => { s.phase = 'revealed'; s.revealAtMono = nowMono(); void render() }, { variant: 'primary', testid: 'reveal' }),
          button("Bugün'e dön", () => void leaveToToday(), { variant: 'quiet' }),
        ),
      )
    } else {
      const assess = (v: 'good' | 'hard' | 'again') => void onSelfAssessment(s, v)
      add(el, 
        atomExplanation(pres),
        h('div', { class: 'screen-bottom' },
          button('Hatırladım', () => assess('good'), { testid: 'sa-good' }),
          button('Zorlandım', () => assess('hard'), { testid: 'sa-hard' }),
          button('Hatırlayamadım', () => assess('again'), { testid: 'sa-again' }),
        ),
      )
    }
    return el
  }

  async function onSelfAssessment(s: Extract<Screen, { name: 'recall' }>, selfAssessment: 'good' | 'hard' | 'again'): Promise<void> {
    if (!session) return
    const responseTimeMs = Math.max(0, Math.round((s.revealAtMono ?? nowMono()) - s.shownAtMono)) // sunumdan "Cevabı aç"a kadar (03 §4.4)
    try {
      const { token } = await motor.answerRecall(session, s.pres, { selfAssessment, hookShown: s.hookShown, responseTimeMs })
      sessionCount++
      if (token) { undoBar = { token, atomText: s.pres.atom.text }; scheduleUndoHide(token) } // BL-11: sonraki ekranda 30 sn çubuk
      await nextItem()
    } catch (e) {
      ctx.notice(`Kayıt yazılamadı: ${(e as Error).message}.`, 'error')
      await nextItem()
    }
  }

  async function undoRecall(token: UndoToken): Promise<void> {
    if (!session) return
    undoBar = null
    const ok = await motor.undo(session, token)
    if (!ok) { ctx.notice('Geri alma süresi geçti.', 'info'); return render() }
    await nextItem()
  }

  // --- S8 Oturum sonu ---
  async function renderEnd(s: Extract<Screen, { name: 'end' }>): Promise<HTMLElement> {
    const summary = await motor.today()
    return h('div', { class: 'screen', 'data-screen': 'end' },
      h('p', { class: 'text-display' }, s.reason === 'budget' ? 'Süre doldu.' : 'Bugünlük bu kadar.'),
      s.pendingFirstTests > 0 ? h('p', { class: 'text-support', 'data-testid': 'pending-first' }, `${s.pendingFirstTests} yeni atomu okudun ama henüz sınanmadın; bir sonraki oturumda yeniden gelecekler.`) : null,
      h('p', { class: 'text-body' }, `Bu oturum: ${s.sessionCount} · Bugün toplam: ${summary.counts.doneToday}`),
      s.dueSoon > 0 ? h('p', { class: 'text-support' }, `${s.dueSoon} atom 15 dakika içinde yeniden gelecek (öğrenme adımı).`) : null,
      h('div', { class: 'screen-bottom' }, button("Bugün'e dön", () => void leaveToToday(), { variant: 'primary', testid: 'to-today' })),
    )
  }

  const unsubscribeUpdates = deps.updates?.subscribe(() => { if (screen.name === 'today' || screen.name === 'data') void render() })

  void render()

  return {
    ctx,
    getScreen: () => screen,
    render,
    destroy() {
      if (historyOk) window.removeEventListener('popstate', onPopState)
      if (undoTimer) clearTimeout(undoTimer)
      untrackTouch()
      if (scrollOk) window.removeEventListener('scroll', onScroll)
      unsubscribeUpdates?.()
      clear(root)
    },
    setVisible(visible) { if (!session) return; if (visible) session.resume(); else session.pause() },
  }
}
