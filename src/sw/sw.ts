/// <reference lib="webworker" />
// Service worker : ouverture instantanée et hors ligne, notifications, pastille sur l'icône.
// La liste des fichiers (__PRECACHE) et la version (__VERSION) sont injectées à la compilation.

const sw = self as unknown as ServiceWorkerGlobalScope & { __PRECACHE: string[]; __VERSION: string };

const CACHE = `gros-mots-${sw.__VERSION}`;

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(sw.__PRECACHE)));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // L'API n'est jamais mise en cache : les points viennent toujours du serveur.
  if (request.method !== 'GET' || url.origin !== sw.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Page : réseau d'abord (version à jour), sinon la copie locale (hors ligne).
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match('/')) ?? Response.error()),
    );
    return;
  }

  // Fichiers de l'app (noms versionnés) : copie locale d'abord.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && url.pathname.startsWith('/assets/')) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  badge: number;
}

sw.addEventListener('push', (event) => {
  let payload: PushPayload;
  try {
    payload = event.data?.json() as PushPayload;
  } catch {
    payload = { title: 'Gros mots', body: event.data?.text() ?? '', tag: 'gros-mots', url: '/', badge: 0 };
  }
  event.waitUntil(
    (async () => {
      const nav = sw.navigator as WorkerNavigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      try {
        if (payload.badge > 0) await nav.setAppBadge?.(payload.badge);
        else await nav.clearAppBadge?.();
      } catch {
        // pastille non prise en charge
      }
      // iOS exige qu'un push affiche toujours une notification.
      await sw.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        data: { url: payload.url },
      });
    })(),
  );
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string } | null)?.url ?? '/', sw.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await (client as WindowClient).navigate(target).catch(() => undefined);
          return;
        }
      }
      await sw.clients.openWindow(target);
    })(),
  );
});
