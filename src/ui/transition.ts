// 14 §14 — Hareket süs değil, yön duygusudur. Yeni ekran DOKUNULAN NOKTADAN büyüyerek açılır (iOS'ta uygulama açılışının
// bıraktığı his), geri gidişte hafifçe küçülerek gelir, aynı ekranın adımları (soru → güven → sonuç) yumuşak belirir.
// View Transitions API iOS Safari'de güvenilir olmadığı için el ile yapılır. prefers-reduced-motion tümünü kapatır (CSS).
// Kural: animasyon YALNIZ gerçek geçişte çalışır; aynı ekranın yeniden çizimi (arama kutusuna yazarken) sessizdir.

export type ScreenTransition = 'push' | 'pop' | 'fade'

/** Son dokunuş noktası (viewport koordinatı). Geçiş bundan sonra gelirse büyüme merkezi burasıdır. */
let lastPoint: { x: number; y: number; at: number } | null = null
/** Dokunuşla geçiş arasında bundan çok zaman geçtiyse nokta bayattır → ekran ortasından açılır. */
const POINT_TTL_MS = 1500
/** animationend gelmezse sınıfın en geç düşeceği süre (motion-base'in birkaç katı). */
const CLEANUP_MS = 900

/** Dokunuş noktasını izlemeye başlar; döndürdüğü işlev dinleyiciyi kaldırır. */
export function trackTouchOrigin(): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
  const handler = (ev: Event): void => {
    const p = ev as PointerEvent
    if (typeof p.clientX !== 'number' || typeof p.clientY !== 'number') return
    if (p.clientX === 0 && p.clientY === 0) return // klavyeyle tetiklenen tık: nokta yok, ortadan açılsın
    lastPoint = { x: p.clientX, y: p.clientY, at: Date.now() }
  }
  window.addEventListener('pointerdown', handler, { capture: true, passive: true })
  return () => { window.removeEventListener('pointerdown', handler, { capture: true }); forgetTouchOrigin() }
}

/** Test/oturum sınırı için: nokta hafızasını temizler. */
export function forgetTouchOrigin(): void { lastPoint = null }

/**
 * Ekran köküne geçiş sınıfını ve büyüme merkezini yazar. Öğe DOM'a eklendikten SONRA çağrılmalıdır (merkez, öğenin
 * kendi kutusuna göre hesaplanır). Animasyon bitince sınıf ve satır içi değerler düşer: geride kalıcı transform kalmaz
 * (kalırsa yapışkan başlık ve safe-area hesapları bozulur).
 */
export function applyScreenTransition(el: HTMLElement, kind: ScreenTransition | null): void {
  if (!kind) return
  if (kind === 'push') {
    const fresh = lastPoint && Date.now() - lastPoint.at <= POINT_TTL_MS ? lastPoint : null
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
    if (fresh && rect && rect.width > 0 && rect.height > 0) {
      const x = Math.min(Math.max(fresh.x - rect.left, 0), rect.width)
      const y = Math.min(Math.max(fresh.y - rect.top, 0), rect.height)
      el.style.setProperty('--origin-x', `${Math.round(x)}px`)
      el.style.setProperty('--origin-y', `${Math.round(y)}px`)
    }
  }
  const cls = kind === 'push' ? 'screen-push' : kind === 'pop' ? 'screen-pop' : 'screen-fade'
  el.classList.add(cls)
  let timer: ReturnType<typeof setTimeout> | null = null
  const done = (): void => {
    if (timer) { clearTimeout(timer); timer = null }
    el.classList.remove(cls)
    el.style.removeProperty('--origin-x')
    el.style.removeProperty('--origin-y')
  }
  if (typeof el.addEventListener === 'function') el.addEventListener('animationend', done, { once: true })
  // Emniyet ağı: animationend gelmezse (hareket kapalı, sekme boyanmıyor, animasyon yarıda kesildi) sınıf yine de düşer.
  timer = setTimeout(done, CLEANUP_MS)
}
