// Gezinme simgeleri (BL-54, BL-56'da yeniden çizildi).
// Tek aile kuralları: 24×24 kutu · 1.7 çizgi · yuvarlak uç ve köşe · optik olarak aynı ağırlık · `currentColor`.
// Karışık kaynaklardan toplanmış ikonlar arayüzü ucuzlatır; bu yüzden hepsi aynı ızgarada elle kuruldu.
// Erişilebilirlik (14 §9): simge TEK BAŞINA taşıyıcı değildir — her düğmede metin etiketi durur, simge yalnız
// tanımayı hızlandırır. Bu yüzden `aria-hidden`.

type Shape =
  | { t: 'path'; d: string }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; rx: number }

const ICONS: Record<string, Shape[]> = {
  /** + Yakala: aklına geleni hızlıca kutuya at */
  capture: [
    { t: 'circle', cx: 12, cy: 12, r: 8.4 },
    { t: 'line', x1: 12, y1: 8.3, x2: 12, y2: 15.7 },
    { t: 'line', x1: 8.3, y1: 12, x2: 15.7, y2: 12 },
  ],
  /** Kutu: gelen kutusu tepsisi (içi dolduğunda rozet gelir) */
  inbox: [
    { t: 'path', d: 'M4.5 13.6 6.9 6.5A2 2 0 0 1 8.8 5.1h6.4a2 2 0 0 1 1.9 1.4l2.4 7.1' },
    { t: 'path', d: 'M4.5 13.6h3.6a1.6 1.6 0 0 1 1.5 1.1 1.6 1.6 0 0 0 1.5 1h1.8a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 1 1.5-1.1h3.6V17a1.9 1.9 0 0 1-1.9 1.9H6.4A1.9 1.9 0 0 1 4.5 17Z' },
  ],
  /** + Atom: tek cümlelik bilgi kartı ekle */
  atom: [
    { t: 'rect', x: 3.6, y: 5.2, w: 16.8, h: 13.6, rx: 3 },
    { t: 'line', x1: 12, y1: 9.3, x2: 12, y2: 14.7 },
    { t: 'line', x1: 9.3, y1: 12, x2: 14.7, y2: 12 },
  ],
  /** + Soru: sorulan şey — konuşma balonu, karttan ayrışsın diye */
  question: [
    { t: 'path', d: 'M20 12.2a7.6 7.6 0 0 1-7.6 7.6c-1.2 0-2.3-.3-3.3-.8l-4.1 1.3 1.3-3.7a7.6 7.6 0 1 1 13.7-4.4Z' },
    { t: 'path', d: 'M10.2 10.1a2.2 2.2 0 0 1 4.3.6c0 1.4-2.1 1.7-2.1 3' },
    { t: 'line', x1: 12.4, y1: 16.4, x2: 12.41, y2: 16.4 },
  ],
  /** İçerik: dizin — açık kitap */
  content: [
    { t: 'path', d: 'M12 7.6A3 3 0 0 0 9 5.4H4.4v11.4H9a3 3 0 0 1 3 2.2' },
    { t: 'path', d: 'M12 7.6A3 3 0 0 1 15 5.4h4.6v11.4H15a3 3 0 0 0-3 2.2' },
    { t: 'line', x1: 12, y1: 7.6, x2: 12, y2: 19 },
  ],
  /** İlerleme: zaman içinde birikme (skor değil, sayım — 10 §1 grafik/skor yasağı ürün için, simge için değil) */
  progress: [
    { t: 'line', x1: 5.2, y1: 19, x2: 5.2, y2: 13.4 },
    { t: 'line', x1: 12, y1: 19, x2: 12, y2: 7.4 },
    { t: 'line', x1: 18.8, y1: 19, x2: 18.8, y2: 10.4 },
  ],
  /** Veri: yedek ve kurtarma */
  data: [
    { t: 'path', d: 'M4.6 6.9c0-1.5 3.3-2.7 7.4-2.7s7.4 1.2 7.4 2.7-3.3 2.7-7.4 2.7-7.4-1.2-7.4-2.7Z' },
    { t: 'path', d: 'M4.6 6.9v10.2c0 1.5 3.3 2.7 7.4 2.7s7.4-1.2 7.4-2.7V6.9' },
    { t: 'path', d: 'M4.6 12c0 1.5 3.3 2.7 7.4 2.7s7.4-1.2 7.4-2.7' },
  ],
}

export type IconName = keyof typeof ICONS

const NS = 'http://www.w3.org/2000/svg'

/** Düğme etiketinin önüne konan simge. Metni değiştirmez: `textContent` yalnız etiketi verir. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  for (const s of ICONS[name] ?? []) {
    if (s.t === 'path') svg.appendChild(shape('path', { d: s.d }))
    else if (s.t === 'circle') svg.appendChild(shape('circle', { cx: s.cx, cy: s.cy, r: s.r }))
    else if (s.t === 'line') svg.appendChild(shape('line', { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }))
    else svg.appendChild(shape('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: s.rx }))
  }
  return svg
}

function shape(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}
