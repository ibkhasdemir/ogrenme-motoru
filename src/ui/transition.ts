// 14 §14 — Hareket süs değil, yön duygusudur. Yeni ekran DOKUNULAN NOKTADAN büyüyerek açılır (iOS'ta uygulama açılışının
// bıraktığı his), geri gidişte hafifçe küçülerek gelir, aynı ekranın adımları (soru → güven → sonuç) yumuşak belirir.
// View Transitions API iOS Safari'de güvenilir olmadığı için el ile yapılır. prefers-reduced-motion tümünü kapatır (CSS).
// Kural: animasyon YALNIZ gerçek geçişte çalışır; aynı ekranın yeniden çizimi (arama kutusuna yazarken) sessizdir.

export type ScreenTransition = 'push' | 'pop' | 'fade'

/** Dokunulan öğenin kimliği: nokta + kutusu + görünümü. Geçiş bundan sonra gelirse ekran BU KUTUDAN açılır. */
interface TouchOrigin {
  x: number
  y: number
  at: number
  /** dokunulan düğmenin/satırın viewport kutusu ve görünümü; yoksa yalnız nokta kullanılır */
  box: { top: number; left: number; width: number; height: number; radius: string; background: string; shadow: string } | null
}
let lastPoint: TouchOrigin | null = null
/** Dokunuşla geçiş arasında bundan çok zaman geçtiyse nokta bayattır → ekran ortasından açılır. */
const POINT_TTL_MS = 1500
/** animationend gelmezse sınıfın en geç düşeceği süre (motion-base'in birkaç katı). */
const CLEANUP_MS = 900
/** kabuk büyümesinin süresi (ms) — ekran geçişinden biraz uzun, çünkü yol da uzun */
const MORPH_MS = 340

/** Dokunuş noktasını izlemeye başlar; döndürdüğü işlev dinleyiciyi kaldırır. */
export function trackTouchOrigin(): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
  const handler = (ev: Event): void => {
    const p = ev as PointerEvent
    if (typeof p.clientX !== 'number' || typeof p.clientY !== 'number') return
    if (p.clientX === 0 && p.clientY === 0) return // klavyeyle tetiklenen tık: nokta yok, ortadan açılsın
    lastPoint = { x: p.clientX, y: p.clientY, at: Date.now(), box: boxOf(p.target) }
  }
  window.addEventListener('pointerdown', handler, { capture: true, passive: true })
  // iOS Safari :active sözde-sınıfını YALNIZ sayfada bir dokunma dinleyicisi varsa tetikler. Basılı geri bildirim
  // (düğme/çip/seçenek küçülmesi) telefonda ancak bu boş dinleyiciyle görünür hâle gelir; masaüstünde etkisi yok.
  const noop = (): void => {}
  window.addEventListener('touchstart', noop, { capture: true, passive: true })
  return () => {
    window.removeEventListener('pointerdown', handler, { capture: true })
    window.removeEventListener('touchstart', noop, { capture: true })
    forgetTouchOrigin()
  }
}

/** Dokunulan öğenin en yakın "basılabilir" atasının kutusu ve görünümü; büyüyen kabuk buna göre kurulur. */
function boxOf(target: EventTarget | null): TouchOrigin['box'] {
  const start = target instanceof Element ? target : null
  const el = start && typeof start.closest === 'function' ? start.closest('button, a, [role="button"], .list-item, .chip') : null
  if (!el || typeof el.getBoundingClientRect !== 'function') return null
  const r = el.getBoundingClientRect()
  if (!(r.width > 0 && r.height > 0)) return null
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null
  return {
    top: r.top, left: r.left, width: r.width, height: r.height,
    radius: (cs && cs.borderRadius) || '999px',
    background: (cs && cs.backgroundColor) || 'transparent',
    shadow: cs && cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow : 'none',
  }
}

/** Test/oturum sınırı için: nokta hafızasını temizler. */
export function forgetTouchOrigin(): void { lastPoint = null }

function motionReduced(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * BL-54 — kabuk büyümesi (container transform): dokunulan tuşun KENDİSİ büyüyüp ekrana dönüşür. İki parça birlikte:
 *   1) tuşun boş bir kopyası (kabuk) tuşun kutusundan tam ekrana büyür ve sonunda silinir,
 *   2) yeni ekran aynı kutudan açılan yuvarlak dikdörtgenle (clip-path) ortaya çıkar — "içi açılıp içindekiler gelir".
 * Web Animations API; `fill` YOK (BL-50 kuralı: animasyon donarsa/çalışmazsa içerik tam görünür kalır). Bitince ya da
 * emniyet zaman aşımında her şey temizlenir. Kurulamazsa null döner ve çağıran CSS'teki ölçek geçişine düşer.
 */
function morphFromBox(el: HTMLElement, box: NonNullable<TouchOrigin['box']>): (() => void) | null {
  if (typeof el.animate !== 'function' || typeof document === 'undefined' || !document.body) return null
  const elRect = el.getBoundingClientRect()
  if (!(elRect.width > 0 && elRect.height > 0)) return null
  const vw = document.documentElement.clientWidth || elRect.width
  const vh = document.documentElement.clientHeight || elRect.height
  // kutuyu ekranın kendi koordinatına çevir (clip-path öğenin kenar kutusuna göredir)
  const top = Math.max(0, box.top - elRect.top)
  const left = Math.max(0, box.left - elRect.left)
  const right = Math.max(0, elRect.right - (box.left + box.width))
  const bottom = Math.max(0, elRect.bottom - (box.top + box.height))

  // Perde: büyüyen kabuk zeminle aynı renkteyse (beyaz tuş / kâğıt zemin) hareket görünmez olur. Zemini bir anlığına
  // kısarak büyüyen şeklin kenarını okunur kılar; sonunda tamamen kalkar. Renk token'dan gelir (11 kural 38).
  const scrim = document.createElement('div')
  scrim.setAttribute('aria-hidden', 'true')
  scrim.className = 'morph-scrim'
  document.body.appendChild(scrim)

  const shell = document.createElement('div')
  shell.setAttribute('aria-hidden', 'true')
  shell.className = 'morph-shell'
  // Yalnız geometri ve renk satır içi; gölge CSS'te (tuşun kendi zayıf gölgesi büyüyünce kaybolur, kabuğa güçlüsü gerekir).
  shell.style.cssText = [
    `left:${box.left}px`, `top:${box.top}px`, `width:${box.width}px`, `height:${box.height}px`,
    `border-radius:${box.radius}`, `background:${box.background}`,
  ].join(';')
  document.body.appendChild(shell)

  const easing = 'cubic-bezier(0.2, 0, 0, 1)'
  const shellAnim = shell.animate([
    { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, borderRadius: box.radius, opacity: 1 },
    { opacity: 0.5, offset: 0.35 },
    { opacity: 0, offset: 0.72 },
    { left: '0px', top: '0px', width: `${vw}px`, height: `${vh}px`, borderRadius: '0px', opacity: 0 },
    // kabuk yolun ~%70'inde tamamen erir: "tuş büyüyüp dağılıyor" hissi kalır, ekranı kaplayan renk katmanı olmaz
    // (özellikle mürekkep birincil düğmede tam ekran siyah bir kare çakması olurdu)
  ], { duration: MORPH_MS, easing })
  const clipAnim = el.animate([
    { clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${box.radius})`, opacity: 0.55 },
    { clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 },
  ], { duration: MORPH_MS, easing })

  const scrimAnim = scrim.animate(
    [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0.75, offset: 0.65 }, { opacity: 0 }],
    { duration: MORPH_MS, easing },
  )

  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    for (const a of [shellAnim, clipAnim, scrimAnim]) { try { a.cancel() } catch { /* zaten bitmiş olabilir */ } }
    shell.remove()
    scrim.remove()
  }
  void Promise.allSettled([shellAnim.finished, clipAnim.finished, scrimAnim.finished]).then(cleanup)
  return cleanup
}

/**
 * Ekran köküne geçiş sınıfını ve büyüme merkezini yazar. Öğe DOM'a eklendikten SONRA çağrılmalıdır (merkez, öğenin
 * kendi kutusuna göre hesaplanır). Animasyon bitince sınıf ve satır içi değerler düşer: geride kalıcı transform kalmaz
 * (kalırsa yapışkan başlık ve safe-area hesapları bozulur).
 */
export function applyScreenTransition(el: HTMLElement, kind: ScreenTransition | null): void {
  if (!kind) return
  const fresh = lastPoint && Date.now() - lastPoint.at <= POINT_TTL_MS ? lastPoint : null
  let morphCleanup: (() => void) | null = null
  if (kind === 'push') {
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
    if (fresh && rect && rect.width > 0 && rect.height > 0) {
      const x = Math.min(Math.max(fresh.x - rect.left, 0), rect.width)
      const y = Math.min(Math.max(fresh.y - rect.top, 0), rect.height)
      el.style.setProperty('--origin-x', `${Math.round(x)}px`)
      el.style.setProperty('--origin-y', `${Math.round(y)}px`)
    }
  }
  // İleri gidişte sayfa başa sarar: yeni ekran her zaman kendi başlığından başlar (uzun bir listenin ortasındayken
  // açılan ekranın "ortadan" başlaması gezinmeyi bozar). Geri gidişte bulunduğun yer korunur.
  if (kind === 'push' && typeof document !== 'undefined') {
    const scroller = document.scrollingElement ?? document.documentElement
    if (scroller) scroller.scrollTop = 0
  }
  // İçeriğin geliş yönü dokunulan tarafa bağlanır: alttaki gezinme tuşuna basıldıysa içerik aşağıdan yukarı,
  // üstteki bir satıra basıldıysa yukarıdan aşağı yerleşir. Aksi hâlde kabuk alttan büyürken içerik yukarıdan
  // düşer ve iki hareket birbirine ters çalışır.
  if (kind === 'push' && fresh && typeof el.getBoundingClientRect === 'function') {
    const r = el.getBoundingClientRect()
    if (r.height > 0) el.style.setProperty('--settle-dy', fresh.y - r.top < r.height * 0.45 ? '-12px' : '12px')
  }
  const cls = kind === 'push' ? 'screen-push' : kind === 'pop' ? 'screen-pop' : 'screen-fade'
  el.classList.add(cls)
  // Kabuk kurulabildiyse kabın kendi ölçek animasyonu susar (iki hareket üst üste binmesin). İçeriğin kademeli
  // varışı `.screen-push > *` üzerinden aynen sürer: kabuk açılır, içindekiler sırayla yerine oturur.
  if (kind === 'push' && fresh && fresh.box && !motionReduced()) {
    morphCleanup = morphFromBox(el, fresh.box)
    if (morphCleanup) el.classList.add('is-morphing')
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  const done = (): void => {
    if (timer) { clearTimeout(timer); timer = null }
    if (typeof el.removeEventListener === 'function') el.removeEventListener('animationend', onEnd)
    if (morphCleanup) { morphCleanup(); morphCleanup = null }
    el.classList.remove(cls, 'is-morphing')
    el.style.removeProperty('--origin-x')
    el.style.removeProperty('--origin-y')
    el.style.removeProperty('--settle-dy')
  }
  // animationend KABARCIKLANIR: içerideki kademeli varış animasyonları da bu öğeye ulaşır. Hedef kontrolü olmadan
  // ilk biten çocuk (en hızlısı) ekranın sınıfını düşürür ve HENÜZ BİTMEMİŞ bütün animasyonlar aynı anda kesilir —
  // ekran yarı yolda zıplar. Bu yüzden yalnız ekranın KENDİ animasyonu temizliği tetikler ({ once } da bu yüzden yok:
  // kabarcıklanan ilk olay dinleyiciyi tüketirdi).
  const onEnd = (ev: Event): void => { if (ev.target === el) done() }
  if (typeof el.addEventListener === 'function') el.addEventListener('animationend', onEnd)
  // Emniyet ağı: animationend gelmezse (hareket kapalı, sekme boyanmıyor, animasyon yarıda kesildi) sınıf yine de düşer.
  timer = setTimeout(done, CLEANUP_MS)
}
