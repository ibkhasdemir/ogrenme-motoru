// 13 §7 — SW kaydı ve güncelleme denetimi (UI/PWA kabuğu; çekirdek bilmez).
// - açılışta ve uygulama öne gelince (görünürlük) arka planda registration.update(); en az 60 s arayla
//   (iOS ana ekran uygulaması sayfayı yeniden yüklemeden sürdürür; yalnız açılışta denetlense yeni sürüm hiç görülmez)
// - yeni SW install (tam ön-önbellek) sonrası waiting'de bekler → "Yeni sürüm hazır → Yenile" çubuğu (yalnız Bugün/Veri)
// - Yenile: SKIP_WAITING mesajı → controllerchange → bu istemci BİR kez yeniden yüklenir (döngü korumalı bayrak)
// - kullanıcı Yenile'ye basmazsa yeni SW tüm istemciler kapanana kadar bekler

export interface UpdateController {
  /** bekleyen (tam indirilmiş) yeni sürüm var mı */
  pending(): boolean
  subscribe(fn: () => void): () => void
  /** Yenile: yalnız bu istemci */
  apply(): void
  /** yeni sürüm denetimi (registration.update); kısıtlı sıklık, çevrimdışıysa sessiz */
  check(): Promise<void>
}

export const UPDATE_CHECK_MIN_INTERVAL_MS = 60_000

export function createUpdateController(): UpdateController & { setPending(v: boolean): void } {
  let isPending = false
  const subs = new Set<() => void>()
  return {
    pending: () => isPending,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
    setPending(v) { isPending = v; for (const fn of subs) fn() },
    apply() { /* registerServiceWorker tarafından bağlanır */ },
    async check() { /* registerServiceWorker tarafından bağlanır */ },
  }
}

/** `check` → `update()` bağlayıcısı: en az `minIntervalMs` arayla; hata (çevrimdışı) sessiz. Saf; test edilir. */
export function bindUpdateCheck(controller: { check(): Promise<void> }, update: () => Promise<unknown>, now: () => number = Date.now, minIntervalMs = UPDATE_CHECK_MIN_INTERVAL_MS): void {
  let last = Number.NEGATIVE_INFINITY
  controller.check = async () => {
    const t = now()
    if (t - last < minIntervalMs) return
    last = t
    try {
      await update()
    } catch {
      // çevrimdışı / ağ hatası: sessiz; bir sonraki görünürlükte yeniden denenir
    }
  }
}

export async function registerServiceWorker(controller: ReturnType<typeof createUpdateController>): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const RELOAD_FLAG = 'motor-sw-reloaded'
  try {
    const reg = await navigator.serviceWorker.register('./sw.js')
    const watch = (w: ServiceWorker | null) => {
      if (!w) return
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) controller.setPending(true) })
    }
    if (reg.waiting && navigator.serviceWorker.controller) controller.setPending(true)
    watch(reg.installing)
    reg.addEventListener('updatefound', () => watch(reg.installing))
    controller.apply = () => {
      const w = reg.waiting
      if (!w) return
      sessionStorage.setItem(RELOAD_FLAG, '1')
      w.postMessage({ type: 'SKIP_WAITING' })
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // yalnız Yenile'ye basılan istemci, bir kez
      if (sessionStorage.getItem(RELOAD_FLAG) === '1') {
        sessionStorage.removeItem(RELOAD_FLAG)
        window.location.reload()
      }
    })
    bindUpdateCheck(controller, () => reg.update())
    void controller.check() // açılışta arka planda güncelleme kontrolü; çevrimdışıysa sessiz
  } catch {
    // SW kaydı başarısız olsa uygulama çalışır (yalnız çevrimdışı kabuk eksik kalır)
  }
}
