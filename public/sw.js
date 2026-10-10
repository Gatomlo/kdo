// Service worker : l'application s'installe et s'ouvre vite. Portee = dossier de l'app
// (/hotte/ dans la passerelle). L'API n'est jamais mise en cache (donnees toujours
// fraiches : une reservation doit etre vue tout de suite par les autres offrants).
// Changer VERSION quand la liste des fichiers change.
const VERSION = 'hotte-v1';
const FILES = [
  './', 'style.css', 'manifest.json', 'icon.svg',
  'app/main.js', 'app/ui.js', 'app/api.js', 'app/state.js', 'app/router.js', 'app/cards.js', 'app/connexion.js',
  'app/install.js', 'app/accueil.js', 'app/listes.js', 'app/evenements.js', 'app/cercle.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
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
