const CACHE = 'fut-parca-shell-v9';
const SHELL = [
  './', './index.html', './styles.css', './theme.css', './card.css', './goal.css',
  './theme-init.js', './app.js', './account_client.mjs', './card.mjs', './domain.mjs', './seed.mjs',
  './manifest.webmanifest', './logo-fut-parca.jpeg', './app-icon-192.png', './app-icon-512.png',
  './app-icon-maskable-512.png', './avatar-1.png', './avatar-2.png', './avatar-3.png', './avatar-4.png', './excluir-conta.html',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
