import { describe, expect, it } from 'vitest';
import { CACHE_TTL_MS, createCache } from '../src/background/cache';
import { memoryStorage } from './helpers/memoryStorage';

describe('createCache', () => {
  it('misses first, then hits after setMany, including null values', async () => {
    const cache = createCache<string | null>(memoryStorage(), 'course:');
    expect(await cache.getMany(['cs246', 'room101'])).toEqual({ hits: {}, misses: ['cs246', 'room101'] });

    await cache.setMany({ cs246: 'rating', room101: null });
    expect(await cache.getMany(['cs246', 'room101'])).toEqual({
      hits: { cs246: 'rating', room101: null },
      misses: [],
    });
  });

  it('expires entries after 24 hours', async () => {
    let now = 1_000;
    const cache = createCache<string>(memoryStorage(), 'course:', () => now);
    await cache.setMany({ cs246: 'rating' });

    now = 1_000 + CACHE_TTL_MS - 1;
    expect((await cache.getMany(['cs246'])).misses).toEqual([]);

    now = 1_000 + CACHE_TTL_MS;
    expect((await cache.getMany(['cs246'])).misses).toEqual(['cs246']);
  });

  it('keeps prefixes separate', async () => {
    const storage = memoryStorage();
    await createCache<string>(storage, 'course:').setMany({ x: 'course' });
    expect((await createCache<string>(storage, 'prof:').getMany(['x'])).misses).toEqual(['x']);
  });
});
