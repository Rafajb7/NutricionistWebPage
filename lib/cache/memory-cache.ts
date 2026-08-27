type MemoryCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const memoryCache = new Map<string, MemoryCacheEntry<unknown>>();
const pendingLoads = new Map<string, Promise<unknown>>();
const cacheVersions = new Map<string, number>();

export function readMemoryCache<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry.value as T;
}

export function readStaleMemoryCache<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  return entry ? (entry.value as T) : null;
}

export function writeMemoryCache<T>(key: string, value: T, ttlMs: number): void {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + Math.max(ttlMs, 1)
  });
}

export async function getOrSetMemoryCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const cached = readMemoryCache<T>(key);
  if (cached !== null) return cached;

  const pending = pendingLoads.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const version = cacheVersions.get(key) ?? 0;
  const nextLoad = loader()
    .then((value) => {
      if ((cacheVersions.get(key) ?? 0) === version) {
        writeMemoryCache(key, value, ttlMs);
      }
      return value;
    })
    .finally(() => {
      if (pendingLoads.get(key) === nextLoad) {
        pendingLoads.delete(key);
      }
    });

  pendingLoads.set(key, nextLoad);
  return nextLoad;
}

export function deleteMemoryCache(key: string): void {
  memoryCache.delete(key);
  pendingLoads.delete(key);
  cacheVersions.set(key, (cacheVersions.get(key) ?? 0) + 1);
}
