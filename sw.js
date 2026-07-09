// Ugly Finance Tool service worker
// NO CACHING: frequent drag-and-drop deploys must never be shadowed by an old
// cached build. Network passthrough only. (Offline unsupported; Supabase needed.)

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => { /* passthrough */ });

// ---- Push notifications ----
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'Ugly Finance';
  const url = data.tab ? ('/?tab=' + encodeURIComponent(data.tab)) : '/';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || 'ugly-finance',
    renotify: true,
    data: { url },
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
      try { data.badge > 0 ? await self.navigator.setAppBadge(data.badge) : await self.navigator.clearAppBadge(); } catch (e) {}
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  // add a changing param so navigate() always triggers a fresh load of current code
  const fresh = target + (target.includes('?') ? '&' : '?') + 'n=' + Date.now();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        try { await c.focus(); } catch (e) {}
        if ('navigate' in c) { try { await c.navigate(fresh); } catch (e) {} }
        return;
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(fresh);
  })());
});
