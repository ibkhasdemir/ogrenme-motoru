// Gezinme simgeleri (BL-54). Tek çizgi kalınlığı, tek uç biçimi, tek kutu (24×24) — simge seti tutarlı bir ailedir,
// karışık kaynaklardan toplanmış ikonlar arayüzü ucuzlatır. Renk `currentColor`: düğme hangi renkteyse simge de o.
// Erişilebilirlik (14 §9): simge TEK BAŞINA taşıyıcı değildir — her düğmede metin etiketi durur, simge yalnız
// tanımayı hızlandırır. Bu yüzden aria-hidden.

const ICONS = {
  /** + Yakala: not düşme */
  capture: ['M12 5v14', 'M5 12h14'],
  /** Kutu: gelen kutusu tepsisi */
  inbox: ['M4 13h4l1.5 3h5L16 13h4', 'M4 13 6.5 6h11L20 13v4.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z'],
  /** + Atom: yeni bilgi parçası */
  atom: ['M12 4v16', 'M4 12h16', 'M20 8v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z'],
  /** + Soru */
  question: ['M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.7.2-1.2.9-1.2 1.6v.5', 'M11.5 17h.01', 'M20 8v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z'],
  /** İçerik: dizin */
  content: ['M5 5h14', 'M5 12h14', 'M5 19h9'],
  /** İlerleme: zaman içinde birikme (skor değil, sayım) */
  progress: ['M5 19V10', 'M12 19V5', 'M19 19v-6'],
  /** Veri: yedek ve kurtarma */
  data: ['M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z', 'M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
} as const

export type IconName = keyof typeof ICONS

const NS = 'http://www.w3.org/2000/svg'

/** Düğme etiketinin önüne konan simge. Metni değiştirmez: `textContent` yalnız etiketi verir. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.6')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  for (const d of ICONS[name]) {
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  }
  return svg
}
