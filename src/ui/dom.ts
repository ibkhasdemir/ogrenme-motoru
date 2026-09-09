// Küçük DOM yardımcıları (çerçeve yok, 10 §1). Bileşenler yalnız token sınıfları bilir; ham renk yok (11 kural 38).

import { icon, type IconName } from './icons'

type Child = Node | string | number | null | undefined | false | Child[]

export type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else if (k === 'class') el.className = String(v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, String(v))
  }
  append(el, children)
  return el
}

export function add(el: HTMLElement, ...children: Child[]): void {
  append(el, children)
}

function append(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    if (Array.isArray(c)) append(el, c)
    else if (c instanceof Node) el.appendChild(c)
    else el.appendChild(document.createTextNode(String(c)))
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild)
}

/** 14 §5: metin render'ı tek noktadan; v0'da düz metin (span metadata'sı ileride). */
export function renderText(text: string, cls = 'text-body'): HTMLElement {
  return h('p', { class: cls }, text)
}

export function button(label: string, onClick: () => void, opts: { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; disabled?: boolean; class?: string; testid?: string; icon?: IconName } = {}): HTMLButtonElement {
  // Simge varsa etiketin ÖNÜNE gelir; etiket her zaman kalır (14 §9: simge tek başına taşıyıcı değildir) ve
  // `textContent` yalnız etiketi verir — testler ve ekran okuyucu etkilenmez.
  return h('button', {
    type: 'button',
    class: `btn btn-${opts.variant ?? 'secondary'} ${opts.class ?? ''}`.trim(),
    disabled: opts.disabled ?? false,
    'data-testid': opts.testid,
    onClick: () => onClick(),
  }, opts.icon ? icon(opts.icon) : null, label)
}

export function field(label: string, input: HTMLElement, help?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, help ? h('span', { class: 'field-help text-support' }, help) : null)
}

export function input(attrs: Attrs = {}): HTMLInputElement {
  return h('input', { class: 'input', ...attrs })
}

export function textarea(attrs: Attrs = {}): HTMLTextAreaElement {
  return h('textarea', { class: 'input', rows: 3, ...attrs })
}

export function formatDateTr(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatDateTimeTr(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * iOS tarzı "kaydırıp sil" (BL-45/BL-46): satır sola kaydırılınca altındaki eylem açılır.
 * Dokunma yoksa (masaüstü, ekran okuyucu) satırın kendi düğmeleri hep erişilebilir kalır — hareket tek yol DEĞİLDİR.
 */
export function swipeRow(content: HTMLElement, action: { label: string; danger?: boolean; testid?: string; onAct: () => void }): HTMLElement {
  const OPEN_AT = 60
  const WIDTH = 104
  const actionBtn = h('button', {
    type: 'button', class: `swipe-action${action.danger ? ' is-danger' : ''}`,
    ...(action.testid ? { 'data-testid': action.testid } : {}),
    onClick: (ev: Event) => { ev.stopPropagation(); action.onAct() },
  }, action.label)
  const surface = h('div', { class: 'swipe-surface' }, content)
  const row = h('div', { class: 'swipe-row' }, actionBtn, surface)
  let startX = 0
  let startY = 0
  let dx = 0
  let open = false
  let tracking = false
  const setX = (x: number) => { surface.style.transform = x ? `translateX(${x}px)` : '' }
  surface.addEventListener('touchstart', (e: TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    startX = t.clientX; startY = t.clientY; dx = 0; tracking = true
  }, { passive: true })
  surface.addEventListener('touchmove', (e: TouchEvent) => {
    const t = e.touches[0]
    if (!tracking || !t) return
    const mx = t.clientX - startX
    const my = t.clientY - startY
    if (Math.abs(my) > Math.abs(mx)) { tracking = false; return } // dikey kaydırma listeye ait
    dx = Math.max(-WIDTH, Math.min(0, mx + (open ? -WIDTH : 0)))
    setX(dx)
  }, { passive: true })
  const end = () => {
    if (!tracking) return
    tracking = false
    open = dx <= -OPEN_AT
    setX(open ? -WIDTH : 0)
  }
  surface.addEventListener('touchend', end)
  surface.addEventListener('touchcancel', end)
  return row
}
