// Service worker : l'application s'installe et s'ouvre vite. Portee = dossier de l'app
// (/kdo/ dans la passerelle). L'API n'est jamais mise en cache (donnees toujours
// fraiches : une reservation doit etre vue tout de suite par les autres offrants).
// Changer VERSION quand la liste des fichiers change.
const VERSION = 'kdo-v17';
const FILES = [
  './', 'style.css', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png',
  'app/main.js', 'app/ui.js', 'app/api.js', 'app/state.js', 'app/router.js', 'app/cards.js', 'app/connexion.js',
  'app/install.js', 'app/accueil.js', 'app/listes.js', 'app/evenements.js', 'app/cercle.js', 'app/idees.js', 'app/cadeaux.js', 'app/recherche.js', 'app/journal.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Notifications (Web Push) : { title, body, url } ; au toucher, l'app s'ouvre a la bonne page.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Kdo', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Kdo', { body: d.body || '', icon: 'icon-192.png', badge: 'favicon-32.png', data: { url: d.url || '#/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(self.registration.scope).href + String((e.notification.data && e.notification.data.url) || '#/').replace(/^\.?\//, '');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    if (c) return c.navigate(target).then((w) => (w || c).focus());
    return self.clients.openWindow(target);
  }));
});

// Reseau d'abord (3 s au plus), sinon la copie gardee. API et autres sites : pas d'intervention.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const scope = new URL(self.registration.scope).pathname;
  const key = req.mode === 'navigate' ? scope : req;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(() => reject(new Error('lent')), 3000))]);
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch {
      const hit = await cache.match(key, { ignoreSearch: true });
      return hit || fetch(req);
    }
  })());
});
