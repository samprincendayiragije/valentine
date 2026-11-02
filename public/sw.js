// Minimal service worker: caches the app shell so the app opens offline.
// It only ever touches same-origin GET requests. Supabase traffic (cross-origin) is never
// intercepted or cached, so no message data can end up in this cache.
const CACHE = 'valentine-shell-v1'
const SHELL = ['./', 'manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL.map((p) => new URL(p, self.registration.scope).href))).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // Pages: network first so updates arrive, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put(new URL('./', self.registration.scope).href, res.clone())); return res })
        .catch(() => caches.match(new URL('./', self.registration.scope).href)),
    )
    return
  }

  // Everything else (hashed JS/CSS, images): serve from cache, refresh in the background.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res }).catch(() => cached)
      return cached || network
    }),
  )
})
