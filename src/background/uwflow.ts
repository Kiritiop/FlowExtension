import { normalizeProfName } from '../shared/profNames';
import type { CourseResults, ProfRating, ProfResults } from '../shared/types';

export const UWFLOW_ENDPOINT = 'https://uwflow.com/graphql';
const TIMEOUT_MS = 10_000;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const defaultFetch: FetchFn = (url, init) => fetch(url, init);

const COURSES_QUERY = `query Courses($codes: [String!]) {
  course(where: {code: {_in: $codes}}) {
    code
    name
    rating { liked easy useful filled_count }
  }
}`;

const PROFS_QUERY = `query Profs($where: prof_bool_exp!) {
  prof(where: $where) {
    code
    name
    rating { clear engaging filled_count }
  }
}`;

interface RawCourse {
  code: string;
  name: string;
  rating: { liked: number | null; easy: number | null; useful: number | null; filled_count: number | null } | null;
}

interface RawProf {
  code: string;
  name: string;
  rating: { clear: number | null; engaging: number | null; filled_count: number | null } | null;
}

async function queryUWFlow<T>(query: string, variables: object, fetchFn: FetchFn): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(UWFLOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`UWFlow returned HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(`UWFlow GraphQL error: ${json.errors[0].message}`);
    if (!json.data) throw new Error('UWFlow response had no data');
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCourses(codes: string[], fetchFn: FetchFn = defaultFetch): Promise<CourseResults> {
  if (codes.length === 0) return {};
  const data = await queryUWFlow<{ course: RawCourse[] }>(COURSES_QUERY, { codes }, fetchFn);
  const results: CourseResults = Object.fromEntries(codes.map((code) => [code, null]));
  for (const raw of data.course) {
    results[raw.code] = {
      code: raw.code,
      name: raw.name,
      liked: raw.rating?.liked ?? null,
      easy: raw.rating?.easy ?? null,
      useful: raw.rating?.useful ?? null,
      filledCount: raw.rating?.filled_count ?? 0,
    };
  }
  return results;
}

// Escapes LIKE wildcards so _ilike behaves as a case-insensitive equals.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function fetchProfs(names: string[], fetchFn: FetchFn = defaultFetch): Promise<ProfResults> {
  if (names.length === 0) return {};
  const where = { _or: names.map((name) => ({ name: { _ilike: escapeLike(name) } })) };
  const data = await queryUWFlow<{ prof: RawProf[] }>(PROFS_QUERY, { where }, fetchFn);
  const results: ProfResults = Object.fromEntries(names.map((name) => [name, null]));
  for (const raw of data.prof) {
    const key = normalizeProfName(raw.name);
    if (!Object.hasOwn(results, key)) continue;
    const rating: ProfRating = {
      code: raw.code,
      name: raw.name,
      clear: raw.rating?.clear ?? null,
      engaging: raw.rating?.engaging ?? null,
      filledCount: raw.rating?.filled_count ?? 0,
    };
    // UWFlow has some duplicate prof records; keep the one with more ratings.
    const existing = results[key];
    if (!existing || rating.filledCount > existing.filledCount) results[key] = rating;
  }
  return results;
}
