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
import { restoreDeps, type RestoreServices, type RestoreUiState } from './dataRestore'
import { emergencyRollback } from '../app/restore'
import type { UpdateController } from '../pwa/register'

export type Screen =
  | { name: 'today' }
  | { name: 'read'; pres: Extract<Presentation, { kind: 'read' }> }
  | { name: 'question'; pres: Extract<Presentation, { kind: 'question' }>; phase: 'answer' | 'confidence' | 'reason' | 'result'; initial: string | null; selected: string | null; shownAtMono: number; confidence: Confidence | null; correct: boolean | null; token: UndoToken | null }
  | { name: 'recall'; pres: Extract<Presentation, { kind: 'recall' }>; phase: 'prompt' | 'revealed'; hookShown: boolean; shownAtMono: number; revealAtMono: number | null }
  | { name: 'end'; reason: 'budget' | 'empty'; dueSoon: number; sessionCount: number }
  | { name: 'atomForm' }
  | { name: 'questionForm'; presetAtomId?: string }
  | { name: 'content'; view: ContentView }
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
}

export interface AppContext {
  motor: Motor
  appVersion: string
  navigate(screen: Screen): Promise<void>
  render(): Promise<void>
  notice(text: string, kind?: 'ok' | 'error' | 'info'): void
  session: Session | null
  /** geri yükleme / sıfırlama sonrası: yeni nesil → bellek REBUILD, oturum ve bekleyen yedek teyidi geçersiz (06 §3) */
  afterDataReplaced(): Promise<void>
  /** 06 §8.6: acil geri dönüş de başarısız → yazma-kilitli kurtarma ekranı */
  lockdown(reason: string, jobId: string | null): Promise<void>
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

  const ctx: AppContext = {
    motor,
    appVersion: deps.appVersion,
    get session() { return session },
    async navigate(s) { screen = s; await render() },
    render: () => render(),
    notice(text, kind = 'info') { noticeState = { text, kind } },
    async afterDataReplaced() {
      session = null
      undoBar = null
      backupState.pendingConfirm = null // işaretçi eski nesle aittir (BL-31)
      backupState.lastMessage = null
      await motor.refresh()
    },
    async lockdown(reason, jobId) {
      session = null
      screen = { name: 'lockdown', reason, jobId }
      await render()
    },
  }
  const restoreState: { restore: RestoreUiState } = { restore: { step: 'idle', message: null, error: null } }

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
        return ctx.navigate({ name: 'end', reason: pres.reason, dueSoon: pres.dueSoon, sessionCount })
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
  }

  async function renderScreen(): Promise<HTMLElement> {
    switch (screen.name) {
      case 'today': return renderToday()
      case 'read': return renderRead(screen)
      case 'question': return renderQuestion(screen)
      case 'recall': return renderRecall(screen)
      case 'end': return renderEnd(screen)
      case 'atomForm': return renderAtomForm(ctx)
      case 'questionForm': return renderQuestionForm(ctx, screen.presetAtomId)
      case 'content': return renderContent(ctx, screen.view)
      case 'data': return renderData(ctx, { services: deps.services, backupState, restoreState })
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
      h('div', { class: 'screen-bottom' },
        h('div', { class: 'row' },
          button('+ Atom', () => void ctx.navigate({ name: 'atomForm' }), { class: 'btn-inline' }),
          button('+ Soru', () => void ctx.navigate({ name: 'questionForm' }), { class: 'btn-inline' }),
          button('İçerik', () => void ctx.navigate({ name: 'content', view: { kind: 'list' } }), { class: 'btn-inline' }),
          button('Veri', () => void ctx.navigate({ name: 'data' }), { class: 'btn-inline' }),
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
    return h('div', { class: 'stack' }, hooks.map((hk) => h('div', { class: 'hook' }, h('span', { class: 'hook-type' }, hk.type), h('p', { class: 'text-body' }, hk.content))))
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
        button('Okudum, sına beni', async () => { const p = await motor.presentAtom(s.pres.atom.id); await showPresentation(p) }, { variant: 'primary', testid: 'read-done' }),
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
    destroy() { if (undoTimer) clearTimeout(undoTimer); unsubscribeUpdates?.(); clear(root) },
    setVisible(visible) { if (!session) return; if (visible) session.resume(); else session.pause() },
  }
}
