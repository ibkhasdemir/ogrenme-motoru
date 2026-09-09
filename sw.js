/* 13 §7 — Service worker: sürüm bütünlüğü. Build zamanında BUILD_ID ve PRECACHE yer tutucuları doldurulur (vite eklentisi, BL-35).
   - install: bu build'in TAM varlık manifesti önbelleğe alınır; tek varlık gelmezse install başarısız → eski build yerinde kalır.
   - kabuk ve varlıklar aktif SW'nin KENDİ önbelleğinden (cache-first); ilk yüklemede ağdan.
   - yeni SW waiting'de bekler; skipWaiting yalnız kullanıcı "Yenile" deyince (mesaj).
   - activate: yalnız eski motor-shell-* önbellekleri silinir. IndexedDB, kurtarma deposu veya herhangi bir kullanıcı verisine DOKUNMAZ. */
const BUILD_ID = '5bcf687c24ba'
const PRECACHE = ["./assets/index-BawqivhG.css","./assets/index-D5Ii6Vrm.js","./icons/icon-180.png","./icons/icon-192.png","./icons/icon-512.png","./index.html","./manifest.webmanifest"]
const CACHE_NAME = `motor-shell-${BUILD_ID}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('motor-shell-') && k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // kabuk: gezinme istekleri her zaman bu build'in index.html'i ile eşleşir (yarım sürüm yok)
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html')
        if (shell) return shell
      }
      const hit = await cache.match(req, { ignoreSearch: true })
      if (hit) return hit
      return fetch(req)
    }),
  )
})
