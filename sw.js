// The Archive — service worker. Bump CACHE_VERSION to force a fresh app shell.
const CACHE_VERSION = 'archive-v14';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const IMG_CACHE = 'archive-images-v1';
const IMG_MAX = 2500;
let imgPuts = 0;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function notifyUpdate(){
  self.clients.matchAll({type: 'window'}).then(cs => cs.forEach(c => c.postMessage({type: 'archive-update'})));
}
// The app itself opens instantly from the saved copy; a fresh copy is fetched in the background
// and, if it changed, the page offers a "Refresh" button. This keeps it fast on a weak connection.
async function shellHandler(req, event){
  const cache = await caches.open(CACHE_VERSION);
  const key = req.mode === 'navigate' ? new Request('./index.html') : req;
  const cached = await cache.match(key);
  const refresh = fetch(req, {cache: 'no-cache'}).then(async res => {
    if(res && res.ok){
      const h = (r, n) => r.headers.get(n);
      const changed = cached && (h(res, 'etag') !== h(cached, 'etag') || h(res, 'last-modified') !== h(cached, 'last-modified') || h(res, 'content-length') !== h(cached, 'content-length'));
      await cache.put(key, res.clone());
      if(changed && (req.mode === 'navigate' || /index\.html$/.test(req.url))) notifyUpdate();
    }
    return res;
  }).catch(() => null);
  if(cached){ event.waitUntil(refresh); return cached; }
  return (await refresh) || (await cache.match('./index.html')) || Response.error();
}
async function staleWhileRevalidate(req, cacheName){
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fetching = fetch(req).then(res => { if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fetching;
}
// poster pictures never change for a given address, so keep them on the device and show them instantly
async function imageFirst(req){
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req);
  if(hit) return hit;
  try{
    const res = await fetch(req);
    if(res && (res.ok || res.type === 'opaque')){
      cache.put(req, res.clone());
      if(++imgPuts % 60 === 0) trimImages();
    }
    return res;
  }catch(e){ return Response.error(); }
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
  if(url.origin === self.location.origin){ e.respondWith(shellHandler(req, e)); return; }
  if(url.hostname === 'image.tmdb.org'){ e.respondWith(imageFirst(req)); return; }
  if((url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(staleWhileRevalidate(req, CACHE_VERSION));
    return;
  }
  // everything else (TMDB data, Firestore sync) goes straight to the network and is never cached
});
