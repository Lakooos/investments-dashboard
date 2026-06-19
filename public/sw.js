// Minimal network-first service worker.
//
// Its main job is to make the dashboard an INSTALLABLE PWA — browsers only offer the
// "Install" option when a service worker with a fetch handler is registered — and to
// give basic offline support. Network-first means it never serves a stale build while
// online, and it leaves Vite's HMR alone so `npm run dev` hot-reload keeps working.
const CACHE = 'invdash-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Don't touch Vite's dev/HMR machinery (so hot-reload keeps working in `npm run dev`).
  if (/\/@(vite|react-refresh|fs|id)\//.test(url.pathname) || url.pathname.startsWith('/node_modules/') || url.searchParams.has('t')) return

  e.respondWith(
    (async () => {
      try {
        const res = await fetch(req)
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      } catch {
        const cached = await caches.match(req)
        if (cached) return cached
        if (req.mode === 'navigate') {
          const shell = (await caches.match('./')) || (await caches.match('./index.html'))
          if (shell) return shell
        }
        throw new Error('offline and not cached')
      }
    })(),
  )
})
