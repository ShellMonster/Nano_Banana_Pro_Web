const CACHE_NAME = 'banana-template-images-v1';
const MAX_MEMORY_ENTRIES = 80;

const memoryCache = new Map<string, string>();
const memoryOrder: string[] = [];

const isCacheable = (src: string) => /^https?:\/\//i.test(src);

const remember = (src: string, url: string) => {
  memoryCache.set(src, url);
  memoryOrder.push(src);
  if (memoryOrder.length <= MAX_MEMORY_ENTRIES) return;
  const oldest = memoryOrder.shift();
  if (!oldest) return;
  const oldUrl = memoryCache.get(oldest);
  if (oldUrl) {
    URL.revokeObjectURL(oldUrl);
  }
  memoryCache.delete(oldest);
};

export const getCachedImageUrl = async (src: string): Promise<string> => {
  if (!src || !isCacheable(src)) return src;
  const cached = memoryCache.get(src);
  if (cached) return cached;
  if (typeof caches === 'undefined') return src;

  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(src);
    if (!response) return src;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    remember(src, url);
    return url;
  } catch {
    return src;
  }
};

export const cacheImageResponse = async (src: string): Promise<void> => {
  if (!src || !isCacheable(src)) return;
  if (typeof caches === 'undefined') return;

  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(src);
    if (cached) return;
    const response = await fetch(src, { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) return;
    await cache.put(src, response.clone());
  } catch {
    // ignore cache failures
  }
};
