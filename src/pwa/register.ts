// 13 §7 — SW kaydı ve güncelleme denetimi (UI/PWA kabuğu; çekirdek bilmez).
// - açılışta arka planda registration.update()
// - yeni SW install (tam ön-önbellek) sonrası waiting'de bekler → "Yeni sürüm hazır → Yenile" çubuğu (yalnız Bugün/Veri)
// - Yenile: SKIP_WAITING mesajı → controllerchange → bu istemci BİR kez yeniden yüklenir (döngü korumalı bayrak)
// - kullanıcı Yenile'ye basmazsa yeni SW tüm istemciler kapanana kadar bekler

export interface UpdateController {
  /** bekleyen (tam indirilmiş) yeni sürüm var mı */
  pending(): boolean
  subscribe(fn: () => void): () => void
  /** Yenile: yalnız bu istemci */
  apply(): void
}

export function createUpdateController(): UpdateController & { setPending(v: boolean): void } {
  let isPending = false
  const subs = new Set<() => void>()
  return {
    pending: () => isPending,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
    setPending(v) { isPending = v; for (const fn of subs) fn() },
    apply() { /* registerServiceWorker tarafından bağlanır */ },
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
    void reg.update().catch(() => undefined) // arka planda güncelleme kontrolü; çevrimdışıysa sessiz
  } catch {
    // SW kaydı başarısız olsa uygulama çalışır (yalnız çevrimdışı kabuk eksik kalır)
  }
}
