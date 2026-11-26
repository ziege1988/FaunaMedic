/* Flora Medici Service Worker
 * - "Network first": Ist das Handy online, wird beim Start immer die neueste Version geladen (= automatische Updates).
 *   Offline wird die zuletzt gespeicherte Version genutzt.
 * - Empfängt Push-Mitteilungen (Erinnerungen) und öffnet beim Antippen die passende Pflanze.
 */
const CACHE_VERSION = 'floramedici-v2.1.1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/main.js', 'js/util.js', 'js/db.js', 'js/ai.js', 'js/reminders.js',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('floramedici-') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Nur eigene Dateien behandeln – KI- und GitHub-Anfragen laufen direkt.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});

/* ---------- Mitteilungen ---------- */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Flora Medici';
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: data.body || 'Deine Pflanzen warten auf dich 🌿',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: data.tag || data.id || undefined,
      data: { url: data.url || './' },
    }),
    self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(() => {}) : Promise.resolve(),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === target.origin) {
        await w.focus();
        w.postMessage({ type: 'navigate', hash: target.hash });
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
