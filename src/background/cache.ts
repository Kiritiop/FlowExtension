export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface Cache<T> {
  getMany(keys: string[]): Promise<{ hits: Record<string, T>; misses: string[] }>;
  setMany(values: Record<string, T>): Promise<void>;
}

interface Entry<T> {
  value: T;
  storedAt: number;
}

export function createCache<T>(storage: StorageArea, prefix: string, now: () => number = Date.now): Cache<T> {
  return {
    async getMany(keys) {
      const stored = await storage.get(keys.map((key) => prefix + key));
      const hits: Record<string, T> = {};
      const misses: string[] = [];
      for (const key of keys) {
        const entry = stored[prefix + key] as Entry<T> | undefined;
        if (entry && now() - entry.storedAt < CACHE_TTL_MS) hits[key] = entry.value;
        else misses.push(key);
      }
      return { hits, misses };
    },
    async setMany(values) {
      const storedAt = now();
      const items: Record<string, Entry<T>> = {};
      for (const [key, value] of Object.entries(values)) items[prefix + key] = { value, storedAt };
      await storage.set(items);
    },
  };
}
