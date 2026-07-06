const STATIC_CACHE_NAME = 'astesia-static-v1';
const RUNTIME_CACHE_NAME = 'astesia-runtime-v1';
const OFFLINE_PAGE_URL = '/offline.html';
const STATIC_ASSET_URLS = [
  OFFLINE_PAGE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSET_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames
        .filter((cacheName) => ![STATIC_CACHE_NAME, RUNTIME_CACHE_NAME].includes(cacheName))
        .map((cacheName) => caches.delete(cacheName))
    );

    if ('navigationPreload' in self.registration) {
      await self.registration.navigationPreload.enable();
    }

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event));
    return;
  }

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (isStaticAssetRequest(request, requestUrl)) {
    event.respondWith(handleStaticAssetRequest(request));
  }
});

async function handleNavigationRequest(event) {
  const runtimeCache = await caches.open(RUNTIME_CACHE_NAME);
  const cachedResponse = await runtimeCache.match(event.request);
  const preloadResponse = await event.preloadResponse;

  if (preloadResponse) {
    runtimeCache.put(event.request, preloadResponse.clone());
    return preloadResponse;
  }

  try {
    const networkResponse = await fetch(event.request);

    if (networkResponse.ok) {
      runtimeCache.put(event.request, networkResponse.clone());
    }

    return networkResponse;
  } catch {
    return cachedResponse ?? caches.match(OFFLINE_PAGE_URL);
  }
}

async function handleStaticAssetRequest(request) {
  const runtimeCache = await caches.open(RUNTIME_CACHE_NAME);
  const cachedResponse = await runtimeCache.match(request);

  if (cachedResponse) {
    void fetchAndCache(request, runtimeCache);
    return cachedResponse;
  }

  return fetchAndCache(request, runtimeCache);
}

async function fetchAndCache(request, cache) {
  const response = await fetch(request);

  if (response.ok) {
    cache.put(request, response.clone());
  }

  return response;
}

function isStaticAssetRequest(request, requestUrl) {
  return ['font', 'image', 'manifest', 'script', 'style'].includes(request.destination)
    || requestUrl.pathname.startsWith('/_expo/')
    || requestUrl.pathname.startsWith('/assets/');
}
