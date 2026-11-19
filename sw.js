// The Archive — service worker. Bump CACHE_VERSION whenever you want to force a fresh app shell.
const CACHE_VERSION = 'archive-v7';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const IMG_CACHE = 'archive-images-v1';
const IMG_MAX = 400;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req){
  const cache = await caches.open(CACHE_VERSION);
  try{
    // cache:'no-store' skips the browser HTTP cache (GitHub Pages sends max-age=600), so a new upload shows up right away
    const res = await fetch(req.url, {cache: 'no-store'});
    if(res && res.ok) cache.put(req, res.clone());
    return res;
  }catch(err){
    return (await cache.match(req)) || (await cache.match('./index.html'));
  }
}
async function staleWhileRevalidate(req, cacheName){
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fetching = fetch(req).then(res => { if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fetching;
}
async function trimImages(){
  const cache = await caches.open(IMG_CACHE);
  const keys = await cache.keys();
  if(keys.length > IMG_MAX) await Promise.all(keys.slice(0, keys.length - IMG_MAX).map(k => cache.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // The app itself: always try the network first so updates arrive, fall back to cache offline
  if(url.origin === self.location.origin){
    e.respondWith(networkFirst(req));
    return;
  }
  // Poster images
  if(url.hostname === 'image.tmdb.org'){
    e.respondWith(staleWhileRevalidate(req, IMG_CACHE).then(r => { trimImages(); return r; }));
    return;
  }
  // Firebase SDK modules + fonts, so the app can start offline after the first online visit
  if((url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) ||
     url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(staleWhileRevalidate(req, CACHE_VERSION));
    return;
  }
  // Everything else (TMDB API, Firestore sync) goes straight to the network, never cached
});
