/* BeautyFind service worker (responsive spec §5).
 * - Static build files and fonts: cache first (they are content-hashed).
 * - Public pages (home, search, regions, clinic profiles, treatments, content): network first,
 *   the last good copy is kept so recently viewed clinics open offline.
 * - Private or transactional pages (accounts, dashboards, booking links, payments, auth) and all
 *   API / server-action / RSC requests: network only, never cached. Offline → /offline.
 * Nothing here queues a payment or a form submission. */
const VERSION = 'bf-v1';
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const MEDIA = `${VERSION}-media`;
const OFFLINE = '/offline';
const PRECACHE = [OFFLINE, '/icons/192.png', '/manifest.webmanifest'];
const PRIVATE = /^\/(api|biz|clinic|ops|pay|b|w|review|invite|login|logout|account|receipt|unsubscribe|book|consult|waitlist|gift|saved|for-business\/(join|claim))(\/|$)/;
const MAX_PAGES = 40;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // React Server Component payloads and prefetches: always live.
  if (req.headers.get('RSC') || url.searchParams.has('_rsc')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) caches.open(STATIC).then(c => c.put(req, res.clone()));
        return res;
      })),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(MEDIA).then(async cache => {
        const hit = await cache.match(req);
        const live = fetch(req).then(res => {
          if (res.ok) cache.put(req, res.clone()).then(() => trim(MEDIA, 120));
          return res;
        }).catch(() => hit);
        return hit || live;
      }),
    );
    return;
  }

  if (req.mode !== 'navigate') return;

  if (PRIVATE.test(url.pathname)) {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && res.type === 'basic') caches.open(PAGES).then(c => c.put(req, res.clone())).then(() => trim(PAGES, MAX_PAGES));
        return res;
      })
      .catch(async () => (await caches.match(req)) || caches.match(OFFLINE)),
  );
});
