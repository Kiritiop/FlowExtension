import type { StorageArea } from '../../src/background/cache';

export function memoryStorage(): StorageArea {
  const data: Record<string, unknown> = {};
  return {
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(items) {
      Object.assign(data, items);
    },
  };
}
