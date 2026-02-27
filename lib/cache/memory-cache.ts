type MemoryCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const memoryCache = new Map<string, MemoryCacheEntry<unknown>>();

export function readMemoryCache<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value as T;
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

  const value = await loader();
  writeMemoryCache(key, value, ttlMs);
  return value;
}

export function deleteMemoryCache(key: string): void {
  memoryCache.delete(key);
}

