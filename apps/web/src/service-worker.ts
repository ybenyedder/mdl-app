/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE_NAME = `mdl-connect-${version}`;
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin) return;

  // Ne jamais mettre en cache les flux SSE ni les endpoints API sensibles/authentifiés
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Assets statiques / build : CacheFirst (versionnés par SvelteKit)
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Navigation / pages HTML : NetworkFirst avec fallback cache pour le mode hors-ligne (scanner QR)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && !url.pathname.startsWith('/admin')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const offlineFallback = await caches.match('/');
          return (
            offlineFallback ||
            new Response('Hors ligne — reconnectez-vous pour charger cette page.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            })
          );
        })
    );
  }
});

sw.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string } = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MDL Connect', body: event.data?.text() || 'Nouvelle notification' };
  }
  const title = data.title || 'MDL Connect';
  const options: NotificationOptions = {
    body: data.body || 'Consultez l’application MDL Connect.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' }
  };
  event.waitUntil(sw.registration.showNotification(title, options));
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data as { url?: string } | undefined)?.url || '/';
  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return sw.clients.openWindow(targetUrl);
    })
  );
});
