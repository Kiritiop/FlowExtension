import type { Cache } from './cache';
import type { CourseRating, CourseResults, LookupRequest, LookupResponse, ProfRating, ProfResults } from '../shared/types';

export interface LookupDeps {
  courseCache: Cache<CourseRating | null>;
  profCache: Cache<ProfRating | null>;
  fetchCourses(codes: string[]): Promise<CourseResults>;
  fetchProfs(names: string[]): Promise<ProfResults>;
}

async function lookupWithCache<T>(
  keys: string[],
  cache: Cache<T>,
  fetchMissing: (keys: string[]) => Promise<Record<string, T>>,
): Promise<Record<string, T>> {
  const { hits, misses } = await cache.getMany([...new Set(keys)]);
  if (misses.length === 0) return hits;
  const fetched = await fetchMissing(misses);
  await cache.setMany(fetched);
  return { ...hits, ...fetched };
}

export function createLookupHandler(deps: LookupDeps): (request: LookupRequest) => Promise<LookupResponse> {
  return async (request) => {
    try {
      const [courses, profs] = await Promise.all([
        lookupWithCache(request.courseCodes, deps.courseCache, deps.fetchCourses),
        lookupWithCache(request.profNames, deps.profCache, deps.fetchProfs),
      ]);
      return { ok: true, courses, profs };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}
