import { describe, expect, it, vi } from 'vitest';
import { createCache } from '../src/background/cache';
import { createLookupHandler } from '../src/background/lookup';
import type { CourseRating, CourseResults, ProfRating, ProfResults } from '../src/shared/types';
import { memoryStorage } from './helpers/memoryStorage';

const cs246: CourseRating = { code: 'cs246', name: 'OOP', liked: 0.66, easy: 0.57, useful: 0.69, filledCount: 868 };
const lushman: ProfRating = { code: 'brad_lushman', name: 'Brad Lushman', clear: 0.94, engaging: 0.85, filledCount: 235 };

function setup() {
  const storage = memoryStorage();
  const fetchCourses = vi.fn(async (codes: string[]): Promise<CourseResults> =>
    Object.fromEntries(codes.map((code) => [code, code === 'cs246' ? cs246 : null])),
  );
  const fetchProfs = vi.fn(async (names: string[]): Promise<ProfResults> =>
    Object.fromEntries(names.map((name) => [name, name === 'brad lushman' ? lushman : null])),
  );
  const handle = createLookupHandler({
    courseCache: createCache<CourseRating | null>(storage, 'course:'),
    profCache: createCache<ProfRating | null>(storage, 'prof:'),
    fetchCourses,
    fetchProfs,
  });
  return { handle, fetchCourses, fetchProfs };
}

describe('createLookupHandler', () => {
  it('fetches misses once and serves repeats from the cache', async () => {
    const { handle, fetchCourses, fetchProfs } = setup();
    const request = { type: 'lookup' as const, courseCodes: ['cs246', 'lec001'], profNames: ['brad lushman'] };

    const expected = { ok: true, courses: { cs246, lec001: null }, profs: { 'brad lushman': lushman } };
    expect(await handle(request)).toEqual(expected);
    expect(await handle(request)).toEqual(expected);
    expect(fetchCourses).toHaveBeenCalledTimes(1);
    expect(fetchProfs).toHaveBeenCalledTimes(1);
  });

  it('only fetches keys that are not cached, without duplicates', async () => {
    const { handle, fetchCourses, fetchProfs } = setup();
    await handle({ type: 'lookup', courseCodes: ['cs246'], profNames: [] });
    await handle({ type: 'lookup', courseCodes: ['cs246', 'math135', 'math135'], profNames: [] });

    expect(fetchCourses).toHaveBeenLastCalledWith(['math135']);
    expect(fetchProfs).not.toHaveBeenCalled();
  });

  it('returns an error and caches nothing when UWFlow fails', async () => {
    const { handle, fetchCourses } = setup();
    fetchCourses.mockRejectedValueOnce(new Error('UWFlow returned HTTP 503'));

    const request = { type: 'lookup' as const, courseCodes: ['cs246'], profNames: [] };
    expect(await handle(request)).toEqual({ ok: false, error: 'UWFlow returned HTTP 503' });
    expect(await handle(request)).toEqual({ ok: true, courses: { cs246 }, profs: {} });
    expect(fetchCourses).toHaveBeenCalledTimes(2);
  });
});
