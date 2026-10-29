/* Stack service worker: app shell + read-only data cache, and notification clicks. @req FR:pwa/offline.sw @req FR:pwa/offline.private @req FR:pwa/offline.update @req FR:pwa/notify.click */
const VERSION = 'v1';
const SHELL = `stack-shell-${VERSION}`;
const DATA = `stack-data-${VERSION}`;
const DATA_PATHS = ['/api/next', '/api/tasks', '/api/projects', '/api/asks', '/api/inbox', '/api/agents', '/.auth/me'];
const SHELL_FILES = ['/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];

/** 'shell' (stale-while-revalidate), 'data' (network first, cache fallback), or 'pass' (never touched). */
function route(url, method, origin, mode) {
  if (method !== 'GET') return 'pass';
  const u = new URL(url);
  if (u.origin !== origin) return 'pass';
  if (DATA_PATHS.includes(u.pathname)) return 'data';
  // The app is one page with hash routes: only the root document is shell (never /.auth/* or other navigations).
  if (u.pathname === '/' || u.pathname === '/index.html' || u.pathname.startsWith('/assets/') || SHELL_FILES.includes(u.pathname)) return 'shell';
  void mode;
  return 'pass';
}
self.stackRoute = route;

const ok = (res) => res && res.status === 200 && res.type !== 'opaque';

async function shell(req, event) {
  const cache = await caches.open(SHELL);
  const key = req.mode === 'navigate' ? '/' : req;
  const hit = await cache.match(key);
  const fresh = fetch(req).then((res) => { if (ok(res)) void cache.put(key, res.clone()); return res; }).catch(() => undefined);
  if (hit) { event.waitUntil(fresh); return hit; }
  return (await fresh) || Response.error();
}

async function data(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req);
    if (ok(res)) {
      const copy = res.clone();
      const h = new Headers(copy.headers);
      h.set('x-stack-saved-at', new Date().toISOString());
      await cache.put(req, new Response(await copy.blob(), { status: copy.status, statusText: copy.statusText, headers: h }));
    }
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (!hit) throw e;
    const h = new Headers(hit.headers);
    h.set('x-stack-cache', 'offline');
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: h });
  }
}

self.addEventListener('install', () => { /* waits: a new version activates on the next launch */ });
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('stack-') && k !== SHELL && k !== DATA).map((k) => caches.delete(k)))));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const kind = route(req.url, req.method, self.location.origin, req.mode);
  if (kind === 'shell') event.respondWith(shell(req, event));
  else if (kind === 'data') event.respondWith(data(req));
});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear') event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('stack-')).map((k) => caches.delete(k)))));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/#/asks';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (win) return win.navigate(url).then((w) => (w || win).focus());
    return self.clients.openWindow(url);
  }));
});
