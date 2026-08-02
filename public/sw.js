// [变更] 修改前: 使用 v2 缓存继续复用旧图标响应
// [变更] 修改后: 升级到 v3 缓存以重新拉取站点图标资源
// [原因] 推广页图标已从 Expo 默认图标替换为 Astesia 图标，需要让旧缓存失效
const STATIC_CACHE_NAME = 'astesia-static-v3';
const RUNTIME_CACHE_NAME = 'astesia-runtime-v3';
const OFFLINE_PAGE_URL = '/offline.html';
const STATIC_ASSET_URLS = [
  OFFLINE_PAGE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png?v=20260802',
  '/icons/icon-512.png?v=20260802',
  '/icons/apple-touch-icon.png?v=20260802',
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
  const preloadResponse = await event.preloadResponse;

  if (preloadResponse) {
    return preloadResponse;
  }

  try {
    // [变更] 修改前: 缓存并在离线时返回旧版本导航 HTML
    // [变更] 修改后: 导航始终请求当前入口，失败时只返回独立离线页
    // [原因] 部署会删除旧 chunk，旧 HTML 引用旧资源会导致 PWA 发版后白屏
    return await fetch(event.request);
  } catch {
    return caches.match(OFFLINE_PAGE_URL);
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
