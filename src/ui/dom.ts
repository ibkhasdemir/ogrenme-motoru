// Küçük DOM yardımcıları (çerçeve yok, 10 §1). Bileşenler yalnız token sınıfları bilir; ham renk yok (11 kural 38).

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

export function button(label: string, onClick: () => void, opts: { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; disabled?: boolean; class?: string; testid?: string } = {}): HTMLButtonElement {
  return h('button', {
    type: 'button',
    class: `btn btn-${opts.variant ?? 'secondary'} ${opts.class ?? ''}`.trim(),
    disabled: opts.disabled ?? false,
    'data-testid': opts.testid,
    onClick: () => onClick(),
  }, label)
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
