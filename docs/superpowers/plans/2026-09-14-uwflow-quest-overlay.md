# UWFlow Quest Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that shows UWFlow course and professor rating badges on Quest, with a popup to toggle each kind.

**Architecture:** Manifest V3. A content script scans Quest pages for course codes and instructor names and inserts Shadow DOM badges. It sends one batched lookup message per scan to a background worker, which queries the UWFlow GraphQL API and caches results in `chrome.storage.local`. A popup stores two toggles in `chrome.storage.sync`.

**Tech Stack:** TypeScript, Vite 8, @crxjs/vite-plugin 2.x, Vitest 5, jsdom, @types/chrome.

**Spec:** `docs/superpowers/specs/2026-09-14-uwflow-quest-overlay-design.md`

## Global Constraints

- Quest host: `https://quest.pecs.uwaterloo.ca/*`, content script runs with `all_frames: true`.
- UWFlow endpoint: `https://uwflow.com/graphql`. Only the background worker calls it.
- Permissions: `storage` only. Host permissions: `https://uwflow.com/*` only.
- Cache TTL: 24 hours. Failures are never cached. "Not found" results are cached.
- Request timeout: 10 seconds.
- Content script debounce: 300ms.
- Badges with fewer than 5 ratings are greyed out.
- Console log prefix: `[UWFlow Overlay]`. No error UI is ever injected into Quest.
- No emojis and no em dashes anywhere in code, comments, UI text, or commit messages.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

```
package.json, tsconfig.json, vitest.config.ts     Tooling (Task 1)
vite.config.ts, manifest.config.ts                Build and manifest (Task 7)
src/shared/types.ts        Rating, lookup request and response types
src/shared/profNames.ts    splitInstructors, normalizeProfName
src/shared/settings.ts     Settings type, defaults, chrome.storage.sync wrappers
src/content/courseCodes.ts findCourseCodes
src/content/badge.ts       createCourseBadge, createProfBadge, BADGE_ATTR
src/content/selectors.ts   INSTRUCTOR_SELECTOR (the one place Quest layout lives)
src/content/scan.ts        Find targets in the DOM, insert and remove badges
src/content/overlay.ts     applyOverlay: scan, look up, insert
src/content/index.ts       Chrome wiring: observer, debounce, settings changes
src/background/uwflow.ts   fetchCourses, fetchProfs (GraphQL client)
src/background/cache.ts    createCache (TTL cache over a storage area)
src/background/lookup.ts   createLookupHandler (cache plus fetch)
src/background/index.ts    Chrome wiring: message listener
src/popup/index.html, popup.ts, popup.css   Toggles
tests/...                  Vitest tests and fixtures
```

---

### Task 1: Tooling, shared types, course code detection

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/shared/types.ts`, `src/content/courseCodes.ts`
- Test: `tests/courseCodes.test.ts`

**Interfaces:**
- Produces: `CourseRating`, `ProfRating`, `CourseResults`, `ProfResults`, `LookupRequest`, `LookupResponse` from `src/shared/types.ts`.
- Produces: `findCourseCodes(text: string): CourseCodeMatch[]` where `CourseCodeMatch = { code: string; end: number }`.

- [ ] **Step 1: Create package.json and install dependencies**

```json
{
  "name": "uwflow-quest-overlay",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "typecheck": "tsc",
    "test": "vitest run"
  }
}
```

Run: `npm install -D typescript @types/chrome vite @crxjs/vite-plugin vitest jsdom`
Expected: installs without peer dependency errors.

- [ ] **Step 2: Create tsconfig.json and vitest.config.ts**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["chrome", "vite/client"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src", "tests", "*.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
```

- [ ] **Step 3: Create shared types**

`src/shared/types.ts`:

```ts
export interface CourseRating {
  code: string;
  name: string;
  liked: number | null;
  easy: number | null;
  useful: number | null;
  filledCount: number;
}

export interface ProfRating {
  code: string;
  name: string;
  clear: number | null;
  engaging: number | null;
  filledCount: number;
}

// A null value means UWFlow has no course or prof for that key.
export type CourseResults = Record<string, CourseRating | null>;
export type ProfResults = Record<string, ProfRating | null>;

export interface LookupRequest {
  type: 'lookup';
  courseCodes: string[]; // UWFlow format, e.g. "cs246"
  profNames: string[]; // from normalizeProfName, e.g. "brad lushman"
}

export type LookupResponse =
  | { ok: true; courses: CourseResults; profs: ProfResults }
  | { ok: false; error: string };
```

- [ ] **Step 4: Write the failing test**

`tests/courseCodes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findCourseCodes } from '../src/content/courseCodes';

describe('findCourseCodes', () => {
  it('finds a code with a space and reports where it ends', () => {
    expect(findCourseCodes('Take CS 246 next term')).toEqual([{ code: 'cs246', end: 11 }]);
  });

  it('finds a code without a space', () => {
    expect(findCourseCodes('CS246')).toEqual([{ code: 'cs246', end: 5 }]);
  });

  it('keeps a letter suffix', () => {
    expect(findCourseCodes('MATH 135A')).toEqual([{ code: 'math135a', end: 9 }]);
  });

  it('allows up to two spaces, including non-breaking ones', () => {
    expect(findCourseCodes('CS  246 - OOP')).toEqual([{ code: 'cs246', end: 7 }]);
    expect(findCourseCodes('CS   246')).toEqual([]);
  });

  it('finds several codes in one string', () => {
    expect(findCourseCodes('CS 246 and MATH 135')).toEqual([
      { code: 'cs246', end: 6 },
      { code: 'math135', end: 19 },
    ]);
  });

  it('ignores lowercase, long subjects, and long numbers', () => {
    expect(findCourseCodes('cs 246, ABCDEFG 123, term 1269, CS 2460')).toEqual([]);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/courseCodes.test.ts`
Expected: FAIL, cannot resolve `../src/content/courseCodes`.

- [ ] **Step 6: Implement**

`src/content/courseCodes.ts`:

```ts
export interface CourseCodeMatch {
  code: string; // UWFlow format, e.g. "cs246"
  end: number; // index just past the match
}

// 2 to 6 capitals, up to two spaces (Quest often pads with non-breaking
// spaces), 3 digits, optional letter suffix.
const COURSE_CODE_PATTERN = /\b([A-Z]{2,6})[  ]{0,2}(\d{3}[A-Z]?)\b/g;

export function findCourseCodes(text: string): CourseCodeMatch[] {
  const pattern = new RegExp(COURSE_CODE_PATTERN);
  const matches: CourseCodeMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    matches.push({
      code: (match[1] + match[2]).toLowerCase(),
      end: match.index + match[0].length,
    });
  }
  return matches;
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run tests/courseCodes.test.ts && npx tsc`
Expected: 6 tests PASS, tsc exits 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src tests
git commit -m "Add tooling, shared types, and course code detection"
```

---

### Task 2: Instructor name splitting and normalization

**Files:**
- Create: `src/shared/profNames.ts`
- Test: `tests/profNames.test.ts`

**Interfaces:**
- Produces: `splitInstructors(text: string): string[]` returning display names in "First Last" order with placeholders removed.
- Produces: `normalizeProfName(name: string): string` returning trimmed, whitespace-collapsed, lowercased name. This is the lookup key on both sides.

- [ ] **Step 1: Write the failing test**

`tests/profNames.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeProfName, splitInstructors } from '../src/shared/profNames';

describe('splitInstructors', () => {
  it('returns a single name as is', () => {
    expect(splitInstructors('Brad Lushman')).toEqual(['Brad Lushman']);
  });

  it('reorders "Last, First" with or without a space', () => {
    expect(splitInstructors('Lushman, Brad')).toEqual(['Brad Lushman']);
    expect(splitInstructors('Lushman,Brad')).toEqual(['Brad Lushman']);
  });

  it('splits instructors separated by commas, line breaks, or semicolons', () => {
    expect(splitInstructors('Brad Lushman, Carmen Bruni')).toEqual(['Brad Lushman', 'Carmen Bruni']);
    expect(splitInstructors('Brad Lushman\nCarmen Bruni')).toEqual(['Brad Lushman', 'Carmen Bruni']);
    expect(splitInstructors('Brad Lushman; Carmen Bruni')).toEqual(['Brad Lushman', 'Carmen Bruni']);
  });

  it('collapses whitespace including non-breaking spaces', () => {
    expect(splitInstructors('  Brad   Lushman  ')).toEqual(['Brad Lushman']);
  });

  it('drops placeholders and empty text', () => {
    expect(splitInstructors('Staff')).toEqual([]);
    expect(splitInstructors('TBA')).toEqual([]);
    expect(splitInstructors('To be Announced')).toEqual([]);
    expect(splitInstructors('Brad Lushman\nStaff')).toEqual(['Brad Lushman']);
    expect(splitInstructors('')).toEqual([]);
  });
});

describe('normalizeProfName', () => {
  it('lowercases and collapses whitespace but keeps accents and punctuation', () => {
    expect(normalizeProfName('  Brad   LUSHMAN ')).toBe('brad lushman');
    expect(normalizeProfName('François Paré')).toBe('françois paré');
    expect(normalizeProfName("Cait O'Donnell")).toBe("cait o'donnell");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/profNames.test.ts`
Expected: FAIL, cannot resolve `../src/shared/profNames`.

- [ ] **Step 3: Implement**

`src/shared/profNames.ts`:

```ts
const PLACEHOLDERS = new Set(['staff', 'tba', 'tbd', 'to be announced', 'to be determined']);

// Lookup key used by both the content script and the background worker.
export function normalizeProfName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Line breaks and semicolons separate instructors. Within a line, exactly two
// comma parts where the first has no space is "Last, First"; otherwise commas
// separate instructors.
export function splitInstructors(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/[\n;]/)) {
    const parts = line
      .split(',')
      .map((part) => part.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (parts.length === 2 && !parts[0].includes(' ')) {
      names.push(`${parts[1]} ${parts[0]}`);
    } else {
      names.push(...parts);
    }
  }
  return names.filter((name) => !PLACEHOLDERS.has(name.toLowerCase()));
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/profNames.test.ts && npx tsc`
Expected: 6 tests PASS, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/profNames.ts tests/profNames.test.ts
git commit -m "Add instructor name splitting and normalization"
```

---

### Task 3: UWFlow GraphQL client

**Files:**
- Create: `src/background/uwflow.ts`
- Create: `tests/fixtures/uwflow-courses.json`, `tests/fixtures/uwflow-profs.json`
- Test: `tests/uwflow.test.ts`

**Interfaces:**
- Consumes: `CourseResults`, `ProfResults`, `ProfRating` (Task 1), `normalizeProfName` (Task 2).
- Produces: `fetchCourses(codes: string[], fetchFn?: FetchFn): Promise<CourseResults>`, every requested code present as a key.
- Produces: `fetchProfs(names: string[], fetchFn?: FetchFn): Promise<ProfResults>`, every requested normalized name present as a key.
- Produces: `UWFLOW_ENDPOINT`, `type FetchFn = (url: string, init: RequestInit) => Promise<Response>`.

- [ ] **Step 1: Record fixtures from the real API**

Run:

```bash
curl -s -X POST https://uwflow.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ course(where:{code:{_in:[\"cs246\",\"math135\",\"acc608\"]}}){ code name rating { liked easy useful filled_count } } }"}' \
  > tests/fixtures/uwflow-courses.json
curl -s -X POST https://uwflow.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ prof(where:{_or:[{name:{_ilike:\"brad lushman\"}},{name:{_ilike:\"adil al-mayah\"}},{name:{_ilike:\"françois paré\"}}]}){ code name rating { clear engaging filled_count } } }"}' \
  > tests/fixtures/uwflow-profs.json
```

Expected: courses fixture has `cs246` (filled_count 868), `math135`, and `acc608` with null ratings and filled_count 0. Profs fixture has `brad_lushman`, two `Adil Al-Mayah` records (filled_count 8 and 3), and `françois_paré`. If counts have drifted since 2026-09-14, update the numbers in the test to match the fixture.

- [ ] **Step 2: Write the failing test**

`tests/uwflow.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fetchCourses, fetchProfs, UWFLOW_ENDPOINT } from '../src/background/uwflow';
import coursesResponse from './fixtures/uwflow-courses.json';
import profsResponse from './fixtures/uwflow-profs.json';

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
}

function sentBody(fetchFn: ReturnType<typeof fakeFetch>) {
  const [url, init] = fetchFn.mock.calls[0];
  expect(url).toBe(UWFLOW_ENDPOINT);
  return JSON.parse(init.body as string);
}

describe('fetchCourses', () => {
  it('maps ratings and marks unknown codes as null', async () => {
    const fetchFn = fakeFetch(coursesResponse);
    const results = await fetchCourses(['cs246', 'acc608', 'room101'], fetchFn);

    expect(results.cs246?.name).toBe('Object-Oriented Software Development');
    expect(results.cs246?.liked).toBeCloseTo(0.6636, 4);
    expect(results.cs246?.filledCount).toBe(868);
    expect(results.acc608).toEqual({
      code: 'acc608',
      name: 'US GAAP',
      liked: null,
      easy: null,
      useful: null,
      filledCount: 0,
    });
    expect(results.room101).toBeNull();
    expect(sentBody(fetchFn).variables).toEqual({ codes: ['cs246', 'acc608', 'room101'] });
  });

  it('does not call UWFlow for an empty list', async () => {
    const fetchFn = fakeFetch(coursesResponse);
    expect(await fetchCourses([], fetchFn)).toEqual({});
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws on GraphQL errors', async () => {
    const fetchFn = fakeFetch({ errors: [{ message: "field 'x' not found" }] });
    await expect(fetchCourses(['cs246'], fetchFn)).rejects.toThrow("field 'x' not found");
  });

  it('throws on HTTP errors', async () => {
    const fetchFn = fakeFetch({}, 503);
    await expect(fetchCourses(['cs246'], fetchFn)).rejects.toThrow('HTTP 503');
  });
});

describe('fetchProfs', () => {
  it('queries names case-insensitively with LIKE wildcards escaped', async () => {
    const fetchFn = fakeFetch({ data: { prof: [] } });
    await fetchProfs(['brad lushman', 'a_b%c'], fetchFn);

    expect(sentBody(fetchFn).variables).toEqual({
      where: { _or: [{ name: { _ilike: 'brad lushman' } }, { name: { _ilike: 'a\\_b\\%c' } }] },
    });
  });

  it('keys results by normalized name, prefers the duplicate with more ratings, ignores extras', async () => {
    const fetchFn = fakeFetch(profsResponse);
    const results = await fetchProfs(['brad lushman', 'adil al-mayah', 'nobody here'], fetchFn);

    expect(results['brad lushman']?.code).toBe('brad_lushman');
    expect(results['brad lushman']?.clear).toBeCloseTo(0.9425, 4);
    expect(results['adil al-mayah']?.filledCount).toBe(8);
    expect(results['nobody here']).toBeNull();
    expect(Object.keys(results).sort()).toEqual(['adil al-mayah', 'brad lushman', 'nobody here']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/uwflow.test.ts`
Expected: FAIL, cannot resolve `../src/background/uwflow`.

- [ ] **Step 4: Implement**

`src/background/uwflow.ts`:

```ts
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
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/uwflow.test.ts && npx tsc`
Expected: 6 tests PASS, tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/background/uwflow.ts tests/uwflow.test.ts tests/fixtures
git commit -m "Add UWFlow GraphQL client for courses and profs"
```

---

### Task 4: Cache and lookup handler

**Files:**
- Create: `src/background/cache.ts`, `src/background/lookup.ts`
- Create: `tests/helpers/memoryStorage.ts`
- Test: `tests/cache.test.ts`, `tests/lookup.test.ts`

**Interfaces:**
- Consumes: `CourseRating`, `ProfRating`, `CourseResults`, `ProfResults`, `LookupRequest`, `LookupResponse` (Task 1).
- Produces: `CACHE_TTL_MS`, `interface StorageArea { get(keys: string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> }`, `interface Cache<T> { getMany(keys: string[]): Promise<{ hits: Record<string, T>; misses: string[] }>; setMany(values: Record<string, T>): Promise<void> }`, `createCache<T>(storage: StorageArea, prefix: string, now?: () => number): Cache<T>`.
- Produces: `interface LookupDeps { courseCache: Cache<CourseRating | null>; profCache: Cache<ProfRating | null>; fetchCourses(codes: string[]): Promise<CourseResults>; fetchProfs(names: string[]): Promise<ProfResults> }`, `createLookupHandler(deps: LookupDeps): (request: LookupRequest) => Promise<LookupResponse>`.

- [ ] **Step 1: Write the test helper and failing cache test**

`tests/helpers/memoryStorage.ts`:

```ts
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
```

`tests/cache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cache.test.ts`
Expected: FAIL, cannot resolve `../src/background/cache`.

- [ ] **Step 3: Implement the cache**

`src/background/cache.ts`:

```ts
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
```

- [ ] **Step 4: Run cache tests**

Run: `npx vitest run tests/cache.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Write the failing lookup test**

`tests/lookup.test.ts`:

```ts
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/lookup.test.ts`
Expected: FAIL, cannot resolve `../src/background/lookup`.

- [ ] **Step 7: Implement the lookup handler**

`src/background/lookup.ts`:

```ts
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
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npx vitest run tests/cache.test.ts tests/lookup.test.ts && npx tsc`
Expected: 6 tests PASS, tsc exits 0.

- [ ] **Step 9: Commit**

```bash
git add src/background/cache.ts src/background/lookup.ts tests/helpers tests/cache.test.ts tests/lookup.test.ts
git commit -m "Add 24 hour cache and batched lookup handler"
```

---

### Task 5: Badges

**Files:**
- Create: `src/content/badge.ts`
- Test: `tests/badge.test.ts`

**Interfaces:**
- Consumes: `CourseRating`, `ProfRating` (Task 1).
- Produces: `type BadgeKind = 'course' | 'prof'`, `BADGE_ATTR = 'data-uwflow-badge'`, `createCourseBadge(rating: CourseRating, doc?: Document): HTMLElement`, `createProfBadge(rating: ProfRating, doc?: Document): HTMLElement`. The returned host is a `span` with `data-uwflow-badge="<kind>"` and `data-uwflow-key="<rating.code>"`, and an open shadow root containing one `a`.

- [ ] **Step 1: Write the failing test**

`tests/badge.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { BADGE_ATTR, createCourseBadge, createProfBadge } from '../src/content/badge';
import type { CourseRating, ProfRating } from '../src/shared/types';

const cs246: CourseRating = { code: 'cs246', name: 'Object-Oriented Software Development', liked: 0.6636, easy: 0.572, useful: 0.6947, filledCount: 868 };
const lushman: ProfRating = { code: 'brad_lushman', name: 'Brad Lushman', clear: 0.9425, engaging: 0.8489, filledCount: 235 };

function linkOf(host: HTMLElement): HTMLAnchorElement {
  return host.shadowRoot!.querySelector('a')!;
}

describe('createCourseBadge', () => {
  it('shows liked percentage with a full breakdown on hover', () => {
    const host = createCourseBadge(cs246);
    const link = linkOf(host);

    expect(host.getAttribute(BADGE_ATTR)).toBe('course');
    expect(host.dataset.uwflowKey).toBe('cs246');
    expect(link.textContent).toBe('66% liked');
    expect(link.title).toBe(
      'Object-Oriented Software Development\nLiked: 66%\nEasy: 57%\nUseful: 69%\n868 ratings\nClick to open UWFlow',
    );
    expect(link.href).toBe('https://uwflow.com/course/cs246');
    expect(link.target).toBe('_blank');
    expect(link.className).toBe('');
  });

  it('greys out badges with fewer than 5 ratings', () => {
    expect(linkOf(createCourseBadge({ ...cs246, filledCount: 4 })).className).toBe('muted');
    expect(linkOf(createCourseBadge({ ...cs246, filledCount: 5 })).className).toBe('');
  });

  it('shows "No ratings" when UWFlow has none', () => {
    const link = linkOf(createCourseBadge({ ...cs246, liked: null, easy: null, useful: null, filledCount: 0 }));
    expect(link.textContent).toBe('No ratings');
    expect(link.className).toBe('muted');
  });
});

describe('createProfBadge', () => {
  it('shows clear percentage and links to the prof page', () => {
    const host = createProfBadge(lushman);
    const link = linkOf(host);

    expect(host.getAttribute(BADGE_ATTR)).toBe('prof');
    expect(link.textContent).toBe('94% clear');
    expect(link.title).toBe('Brad Lushman\nClear: 94%\nEngaging: 85%\n235 ratings\nClick to open UWFlow');
    expect(link.href).toBe('https://uwflow.com/professor/brad_lushman');
  });
});

describe('badge clicks', () => {
  it('do not reach Quest click handlers', () => {
    const outer = document.createElement('div');
    const questHandler = vi.fn();
    outer.addEventListener('click', questHandler);
    const host = createCourseBadge(cs246);
    outer.append(host);
    document.body.append(outer);

    const link = linkOf(host);
    link.addEventListener('click', (event) => event.preventDefault()); // jsdom cannot navigate
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));

    expect(questHandler).not.toHaveBeenCalled();
    outer.remove();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/badge.test.ts`
Expected: FAIL, cannot resolve `../src/content/badge`.

- [ ] **Step 3: Implement**

`src/content/badge.ts`:

```ts
import type { CourseRating, ProfRating } from '../shared/types';

export type BadgeKind = 'course' | 'prof';

export const BADGE_ATTR = 'data-uwflow-badge';

const LOW_SAMPLE = 5;

const STYLE = `
  a {
    display: inline-block;
    margin-left: 4px;
    padding: 0 6px;
    border-radius: 8px;
    background: #1f6feb;
    color: #fff;
    font: 600 11px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    text-decoration: none;
    white-space: nowrap;
    vertical-align: middle;
    cursor: pointer;
  }
  a:hover { background: #1558c0; }
  a.muted { background: #8c959f; }
`;

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`;
}

function ratingCount(count: number): string {
  return count === 1 ? '1 rating' : `${count} ratings`;
}

function createBadge(
  doc: Document,
  kind: BadgeKind,
  key: string,
  label: string,
  tooltip: string[],
  href: string,
  muted: boolean,
): HTMLElement {
  const host = doc.createElement('span');
  host.setAttribute(BADGE_ATTR, kind);
  host.dataset.uwflowKey = key;

  const style = doc.createElement('style');
  style.textContent = STYLE;

  const link = doc.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = [...tooltip, 'Click to open UWFlow'].join('\n');
  link.textContent = label;
  if (muted) link.className = 'muted';
  // Keep Quest's own click handlers (table rows, surrounding links) from firing.
  link.addEventListener('click', (event) => event.stopPropagation());

  host.attachShadow({ mode: 'open' }).append(style, link);
  return host;
}

export function createCourseBadge(rating: CourseRating, doc: Document = document): HTMLElement {
  const hasRatings = rating.filledCount > 0 && rating.liked !== null;
  return createBadge(
    doc,
    'course',
    rating.code,
    hasRatings ? `${percent(rating.liked)} liked` : 'No ratings',
    [
      rating.name,
      `Liked: ${percent(rating.liked)}`,
      `Easy: ${percent(rating.easy)}`,
      `Useful: ${percent(rating.useful)}`,
      ratingCount(rating.filledCount),
    ],
    `https://uwflow.com/course/${encodeURIComponent(rating.code)}`,
    rating.filledCount < LOW_SAMPLE,
  );
}

export function createProfBadge(rating: ProfRating, doc: Document = document): HTMLElement {
  const hasRatings = rating.filledCount > 0 && rating.clear !== null;
  return createBadge(
    doc,
    'prof',
    rating.code,
    hasRatings ? `${percent(rating.clear)} clear` : 'No ratings',
    [rating.name, `Clear: ${percent(rating.clear)}`, `Engaging: ${percent(rating.engaging)}`, ratingCount(rating.filledCount)],
    `https://uwflow.com/professor/${encodeURIComponent(rating.code)}`,
    rating.filledCount < LOW_SAMPLE,
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/badge.test.ts && npx tsc`
Expected: 5 tests PASS, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/content/badge.ts tests/badge.test.ts
git commit -m "Add Shadow DOM rating badges"
```

---

### Task 6: Page scanning and overlay

**Files:**
- Create: `src/content/selectors.ts`, `src/content/scan.ts`, `src/content/overlay.ts`, `src/shared/settings.ts`
- Test: `tests/overlay.test.ts`

**Interfaces:**
- Consumes: `findCourseCodes` (Task 1), `splitInstructors`, `normalizeProfName` (Task 2), `BADGE_ATTR`, `BadgeKind`, `createCourseBadge`, `createProfBadge` (Task 5), `LookupRequest`, `LookupResponse` (Task 1).
- Produces: `type Settings = { showCourseRatings: boolean; showProfRatings: boolean }`, `DEFAULT_SETTINGS`, `loadSettings(): Promise<Settings>`, `saveSettings(patch: Partial<Settings>): Promise<void>`, `onSettingsChange(callback: (settings: Settings) => void): void` from `src/shared/settings.ts`.
- Produces: `INSTRUCTOR_SELECTOR: string`.
- Produces: `findCourseTargets(root: Node): CourseTarget[]`, `insertCourseBadges(targets: CourseTarget[], makeBadge: (code: string) => HTMLElement | null): void`, `findProfTargets(root: ParentNode): ProfTarget[]`, `insertProfBadges(targets: ProfTarget[], makeBadge: (name: string) => HTMLElement | null): void`, `removeBadges(root: ParentNode, kind: BadgeKind): void`.
- Produces: `type Lookup = (request: LookupRequest) => Promise<LookupResponse>`, `applyOverlay(doc: Document, getSettings: () => Settings, lookup: Lookup): Promise<void>`.

- [ ] **Step 1: Create settings and selectors (no tests: thin wrappers verified in Task 7 manual check)**

`src/shared/settings.ts`:

```ts
export type Settings = {
  showCourseRatings: boolean;
  showProfRatings: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  showCourseRatings: true,
  showProfRatings: true,
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

export function onSettingsChange(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === 'sync') void loadSettings().then(callback);
  });
}
```

`src/content/selectors.ts`:

```ts
// Elements where Quest lists instructor names. PeopleSoft element IDs end in
// $<row>. Class search results use MTG_INSTR$n; schedule and cart pages use
// ids containing SSR_INSTR_LONG$n. Confirmed against saved pages in Task 8.
export const INSTRUCTOR_SELECTOR = ['[id^="MTG_INSTR$"]', '[id*="SSR_INSTR_LONG$"]'].join(', ');
```

- [ ] **Step 2: Write the failing test**

`tests/overlay.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOverlay } from '../src/content/overlay';
import { removeBadges } from '../src/content/scan';
import type { Settings } from '../src/shared/settings';
import type { CourseRating, LookupRequest, LookupResponse, ProfRating } from '../src/shared/types';

const cs246: CourseRating = { code: 'cs246', name: 'OOP', liked: 0.66, easy: 0.57, useful: 0.69, filledCount: 868 };
const lushman: ProfRating = { code: 'brad_lushman', name: 'Brad Lushman', clear: 0.94, engaging: 0.85, filledCount: 235 };

function okLookup() {
  return vi.fn(async (_request: LookupRequest): Promise<LookupResponse> => ({
    ok: true,
    courses: { cs246, lec001: null },
    profs: { 'brad lushman': lushman },
  }));
}

function count(kind: string, root: ParentNode = document) {
  return root.querySelectorAll(`[data-uwflow-badge="${kind}"]`).length;
}

let settings: Settings;
const getSettings = () => settings;

beforeEach(() => {
  settings = { showCourseRatings: true, showProfRatings: true };
  document.body.innerHTML = `
    <p id="text">Take CS 246 then CS 246 again, LEC 001</p>
    <span id="MTG_INSTR$0">Brad Lushman</span>
  `;
});

describe('applyOverlay', () => {
  it('sends one batched lookup and badges known courses and profs', async () => {
    const lookup = okLookup();
    await applyOverlay(document, getSettings, lookup);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith({
      type: 'lookup',
      courseCodes: ['cs246', 'lec001'],
      profNames: ['brad lushman'],
    });
    expect(count('course')).toBe(2);
    expect(count('prof', document.getElementById('MTG_INSTR$0')!)).toBe(1);
    expect(document.getElementById('text')!.textContent).toBe('Take CS 246 then CS 246 again, LEC 001');
    expect(document.getElementById('text')!.children[0].previousSibling!.textContent).toBe('Take CS 246');
  });

  it('does not duplicate badges when run again', async () => {
    const lookup = okLookup();
    await applyOverlay(document, getSettings, lookup);
    await applyOverlay(document, getSettings, lookup);

    expect(count('course')).toBe(2);
    expect(count('prof')).toBe(1);
    expect(lookup).toHaveBeenLastCalledWith({ type: 'lookup', courseCodes: ['lec001'], profNames: [] });
  });

  it('skips form fields and scripts', async () => {
    document.body.innerHTML = '<textarea>CS 246</textarea><input value="CS 246"><script>var x = "CS 246";</script>';
    const lookup = okLookup();
    await applyOverlay(document, getSettings, lookup);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('splits instructor cells on line breaks and ignores placeholders', async () => {
    document.body.innerHTML = '<span id="DERIVED_CLS_DTL_SSR_INSTR_LONG$0">Brad Lushman<br>Staff</span>';
    const lookup = okLookup();
    await applyOverlay(document, getSettings, lookup);
    expect(lookup).toHaveBeenCalledWith({ type: 'lookup', courseCodes: [], profNames: ['brad lushman'] });
    expect(count('prof')).toBe(1);
  });

  it('respects the toggles', async () => {
    settings.showProfRatings = false;
    const lookup = okLookup();
    await applyOverlay(document, getSettings, lookup);

    expect(lookup.mock.calls[0][0].profNames).toEqual([]);
    expect(count('course')).toBe(2);
    expect(count('prof')).toBe(0);
  });

  it('does not insert a kind that was switched off while waiting for UWFlow', async () => {
    const lookup = vi.fn(async (): Promise<LookupResponse> => {
      settings = { showCourseRatings: false, showProfRatings: true };
      return { ok: true, courses: { cs246 }, profs: { 'brad lushman': lushman } };
    });
    await applyOverlay(document, getSettings, lookup);
    expect(count('course')).toBe(0);
    expect(count('prof')).toBe(1);
  });

  it('skips text that changed while waiting for UWFlow', async () => {
    const lookup = vi.fn(async (): Promise<LookupResponse> => {
      document.getElementById('text')!.firstChild!.textContent = 'Something else';
      return { ok: true, courses: { cs246 }, profs: {} };
    });
    await applyOverlay(document, getSettings, lookup);
    expect(count('course')).toBe(0);
  });

  it('inserts nothing and logs when the lookup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lookup = vi.fn(async (): Promise<LookupResponse> => ({ ok: false, error: 'timeout' }));
    await applyOverlay(document, getSettings, lookup);

    expect(count('course')).toBe(0);
    expect(count('prof')).toBe(0);
    expect(warn).toHaveBeenCalledWith('[UWFlow Overlay] timeout');
    warn.mockRestore();
  });
});

describe('removeBadges', () => {
  it('removes only the given kind', async () => {
    await applyOverlay(document, getSettings, okLookup());
    removeBadges(document, 'course');
    expect(count('course')).toBe(0);
    expect(count('prof')).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/overlay.test.ts`
Expected: FAIL, cannot resolve `../src/content/overlay`.

- [ ] **Step 4: Implement scanning**

`src/content/scan.ts`:

```ts
import { normalizeProfName, splitInstructors } from '../shared/profNames';
import { BADGE_ATTR, type BadgeKind } from './badge';
import { findCourseCodes } from './courseCodes';
import { INSTRUCTOR_SELECTOR } from './selectors';

export interface CourseTarget {
  node: Text;
  text: string; // node contents when scanned
  end: number;
  code: string;
}

export interface ProfTarget {
  element: Element;
  name: string; // normalized
}

const SKIP_SELECTOR = `script, style, noscript, title, textarea, input, select, option, [contenteditable], [${BADGE_ATTR}]`;
const MIGHT_HAVE_CODE = /[A-Z]{2}[  ]{0,2}\d{3}/;

function isBadge(node: Node | null, kind: BadgeKind, key: string): boolean {
  return (
    node?.nodeType === Node.ELEMENT_NODE &&
    (node as Element).getAttribute(BADGE_ATTR) === kind &&
    (node as Element).getAttribute('data-uwflow-key') === key
  );
}

export function findCourseTargets(root: Node): CourseTarget[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: CourseTarget[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!MIGHT_HAVE_CODE.test(node.data)) continue;
    if (node.parentElement?.closest(SKIP_SELECTOR)) continue;
    for (const { code, end } of findCourseCodes(node.data)) {
      // A handled code ends its text node and is followed by its badge.
      if (end === node.data.length && isBadge(node.nextSibling, 'course', code)) continue;
      targets.push({ node, text: node.data, end, code });
    }
  }
  return targets;
}

export function insertCourseBadges(targets: CourseTarget[], makeBadge: (code: string) => HTMLElement | null): void {
  const byNode = new Map<Text, CourseTarget[]>();
  for (const target of targets) {
    byNode.set(target.node, [...(byNode.get(target.node) ?? []), target]);
  }
  for (const [node, nodeTargets] of byNode) {
    if (!node.isConnected || node.data !== nodeTargets[0].text) continue;
    // Work from the end so earlier offsets stay valid after each split.
    nodeTargets.sort((a, b) => b.end - a.end);
    for (const { end, code } of nodeTargets) {
      const badge = makeBadge(code);
      if (!badge) continue;
      if (end < node.data.length) node.splitText(end);
      node.after(badge);
    }
  }
}

// textContent drops <br>, which Quest uses between instructors.
function textWithLineBreaks(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
  if (node.nodeName === 'BR') return '\n';
  return Array.from(node.childNodes, textWithLineBreaks).join('');
}

export function findProfTargets(root: ParentNode): ProfTarget[] {
  const targets: ProfTarget[] = [];
  for (const element of root.querySelectorAll(INSTRUCTOR_SELECTOR)) {
    if (element.querySelector(`[${BADGE_ATTR}="prof"]`)) continue;
    for (const name of splitInstructors(textWithLineBreaks(element))) {
      targets.push({ element, name: normalizeProfName(name) });
    }
  }
  return targets;
}

export function insertProfBadges(targets: ProfTarget[], makeBadge: (name: string) => HTMLElement | null): void {
  for (const { element, name } of targets) {
    if (!element.isConnected) continue;
    const badge = makeBadge(name);
    if (badge) element.append(badge);
  }
}

export function removeBadges(root: ParentNode, kind: BadgeKind): void {
  for (const badge of root.querySelectorAll(`[${BADGE_ATTR}="${kind}"]`)) badge.remove();
}
```

- [ ] **Step 5: Implement the overlay**

`src/content/overlay.ts`:

```ts
import type { Settings } from '../shared/settings';
import type { LookupRequest, LookupResponse } from '../shared/types';
import { createCourseBadge, createProfBadge } from './badge';
import { findCourseTargets, findProfTargets, insertCourseBadges, insertProfBadges } from './scan';

export type Lookup = (request: LookupRequest) => Promise<LookupResponse>;

export async function applyOverlay(doc: Document, getSettings: () => Settings, lookup: Lookup): Promise<void> {
  const settings = getSettings();
  const courseTargets = settings.showCourseRatings ? findCourseTargets(doc.body ?? doc.documentElement) : [];
  const profTargets = settings.showProfRatings ? findProfTargets(doc) : [];
  if (courseTargets.length === 0 && profTargets.length === 0) return;

  const response = await lookup({
    type: 'lookup',
    courseCodes: [...new Set(courseTargets.map((target) => target.code))],
    profNames: [...new Set(profTargets.map((target) => target.name))],
  });
  if (!response.ok) {
    console.warn(`[UWFlow Overlay] ${response.error}`);
    return;
  }

  // Settings can change while waiting for UWFlow.
  const current = getSettings();
  if (current.showCourseRatings) {
    insertCourseBadges(courseTargets, (code) => {
      const rating = response.courses[code];
      return rating ? createCourseBadge(rating, doc) : null;
    });
  }
  if (current.showProfRatings) {
    insertProfBadges(profTargets, (name) => {
      const rating = response.profs[name];
      return rating ? createProfBadge(rating, doc) : null;
    });
  }
}
```

- [ ] **Step 6: Run all tests and typecheck**

Run: `npx vitest run && npx tsc`
Expected: all tests PASS (9 new in overlay.test.ts), tsc exits 0. If tsc rejects the `stored as Partial<Settings>` cast in `settings.ts` because of the installed @types/chrome signature, change it to `stored as unknown as Partial<Settings>` and rerun.

- [ ] **Step 7: Commit**

```bash
git add src/shared/settings.ts src/content/selectors.ts src/content/scan.ts src/content/overlay.ts tests/overlay.test.ts
git commit -m "Add page scanning and overlay"
```

---

### Task 7: Extension wiring, popup, and build

**Files:**
- Create: `src/background/index.ts`, `src/content/index.ts`
- Create: `src/popup/index.html`, `src/popup/popup.ts`, `src/popup/popup.css`
- Create: `manifest.config.ts`, `vite.config.ts`

**Interfaces:**
- Consumes: everything above. `createLookupHandler`, `createCache`, `StorageArea`, `fetchCourses`, `fetchProfs`, `applyOverlay`, `removeBadges`, `loadSettings`, `saveSettings`, `onSettingsChange`, `DEFAULT_SETTINGS`, `Settings`.
- Produces: a loadable `dist/` extension.

- [ ] **Step 1: Background entry**

`src/background/index.ts`:

```ts
import type { CourseRating, LookupRequest, ProfRating } from '../shared/types';
import { createCache, type StorageArea } from './cache';
import { createLookupHandler } from './lookup';
import { fetchCourses, fetchProfs } from './uwflow';

const storage: StorageArea = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
};

const handleLookup = createLookupHandler({
  courseCache: createCache<CourseRating | null>(storage, 'course:'),
  profCache: createCache<ProfRating | null>(storage, 'prof:'),
  fetchCourses: (codes) => fetchCourses(codes),
  fetchProfs: (names) => fetchProfs(names),
});

chrome.runtime.onMessage.addListener((message: LookupRequest, _sender, sendResponse) => {
  if (message?.type !== 'lookup') return false;
  void handleLookup(message).then(sendResponse);
  return true; // keeps the channel open for the async response
});
```

- [ ] **Step 2: Content entry**

`src/content/index.ts`:

```ts
import { DEFAULT_SETTINGS, loadSettings, onSettingsChange, type Settings } from '../shared/settings';
import type { LookupRequest, LookupResponse } from '../shared/types';
import { applyOverlay } from './overlay';
import { removeBadges } from './scan';

const DEBOUNCE_MS = 300;

let settings: Settings = DEFAULT_SETTINGS;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let rerun = false;

const observer = new MutationObserver(schedule);

function lookup(request: LookupRequest): Promise<LookupResponse> {
  return chrome.runtime.sendMessage(request);
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
}

async function run(): Promise<void> {
  // After the extension is reloaded or updated, old content scripts lose access to it.
  if (!chrome.runtime?.id) {
    observer.disconnect();
    return;
  }
  // Only one scan at a time, so badges are never inserted twice.
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      await applyOverlay(document, () => settings, lookup);
    } while (rerun);
  } catch (err) {
    console.warn('[UWFlow Overlay]', err);
  } finally {
    running = false;
  }
}

onSettingsChange((next) => {
  settings = next;
  if (!next.showCourseRatings) removeBadges(document, 'course');
  if (!next.showProfRatings) removeBadges(document, 'prof');
  schedule();
});

void loadSettings().then((loaded) => {
  settings = loaded;
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
});
```

- [ ] **Step 3: Popup**

`src/popup/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>UWFlow Quest Overlay</title>
    <link rel="stylesheet" href="./popup.css" />
  </head>
  <body>
    <h1>UWFlow Quest Overlay</h1>
    <label><input type="checkbox" id="showCourseRatings" /> Course ratings</label>
    <label><input type="checkbox" id="showProfRatings" /> Professor ratings</label>
    <p class="note">
      Ratings from <a href="https://uwflow.com" target="_blank" rel="noopener noreferrer">UWFlow</a>.
      Changes apply to open Quest tabs right away.
    </p>
    <script type="module" src="./popup.ts"></script>
  </body>
</html>
```

`src/popup/popup.ts`:

```ts
import { loadSettings, saveSettings, type Settings } from '../shared/settings';

const keys: (keyof Settings)[] = ['showCourseRatings', 'showProfRatings'];

void loadSettings().then((settings) => {
  for (const key of keys) {
    const checkbox = document.getElementById(key) as HTMLInputElement;
    checkbox.checked = settings[key];
    checkbox.addEventListener('change', () => void saveSettings({ [key]: checkbox.checked }));
  }
});
```

`src/popup/popup.css`:

```css
body {
  width: 240px;
  margin: 0;
  padding: 12px 14px;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  color: #1f2328;
}

h1 {
  margin: 0 0 10px;
  font-size: 14px;
}

label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  cursor: pointer;
}

.note {
  margin: 10px 0 0;
  color: #656d76;
  font-size: 12px;
}
```

- [ ] **Step 4: Manifest and Vite config**

`manifest.config.ts`:

```ts
import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'UWFlow Quest Overlay',
  version: '0.1.0',
  description: 'Shows UWFlow course and professor ratings on Quest.',
  permissions: ['storage'],
  host_permissions: ['https://uwflow.com/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://quest.pecs.uwaterloo.ca/*'],
      js: ['src/content/index.ts'],
      all_frames: true,
      run_at: 'document_idle',
    },
  ],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'UWFlow Quest Overlay',
  },
});
```

`vite.config.ts`:

```ts
import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
});
```

- [ ] **Step 5: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: tsc exits 0, all tests PASS, `dist/manifest.json` is written.

- [ ] **Step 6: Verify the built manifest**

Run: `node -e "const m=require('./dist/manifest.json'); console.log(JSON.stringify({perm:m.permissions,hosts:m.host_permissions,cs:m.content_scripts.map(c=>({matches:c.matches,all_frames:c.all_frames})),popup:m.action.default_popup,bg:m.background}, null, 2))"`
Expected: permissions `["storage"]`, host permissions include `https://uwflow.com/*` (CRXJS may add entries needed for dev only when running `npm run dev`, not in `build`), one content script for Quest with `all_frames: true`, popup path and service worker present. Also confirm `ls dist/src/popup/index.html` exists.

- [ ] **Step 7: Commit**

```bash
git add src/background/index.ts src/content/index.ts src/popup manifest.config.ts vite.config.ts
git commit -m "Wire up background, content script, popup, and build"
```

---

### Task 8: Verify against real Quest pages

This task needs saved Quest pages from the user. The selectors in `src/content/selectors.ts` are a best guess from PeopleSoft conventions and must be confirmed here.

**Files:**
- Create: `tests/fixtures/quest/*.html` (sanitized)
- Modify (only if needed): `src/content/selectors.ts`
- Test: `tests/questPages.test.ts`

**Interfaces:**
- Consumes: `applyOverlay` (Task 6), `LookupRequest`, `LookupResponse` (Task 1).

- [ ] **Step 1: Get saved pages**

Ask the user to log in to Quest in Chrome and save each of these with Cmd+S, format "Webpage, Complete", into `quest-pages/` in the project (gitignored): class search results for a course with several sections, shopping cart with at least one class, My Class Schedule in list view, and a course catalogue page.

- [ ] **Step 2: Find the HTML that holds the content**

Quest loads content in an iframe, so the saved top-level file may be a shell. For each page run:

```bash
grep -l -E 'MTG_INSTR\$|SSR_INSTR_LONG\$|[A-Z]{2,6}(&nbsp;| ){0,2}[0-9]{3}' -r quest-pages
```

Use the files that match. If no instructor element matches either selector, open the file, search for a visible instructor name, and note the `id` pattern of the element that wraps it.

- [ ] **Step 3: Create sanitized fixtures**

For each page, copy the content HTML to `tests/fixtures/quest/<page>.html` (`class-search.html`, `shopping-cart.html`, `class-schedule.html`, `catalogue.html`). Remove all `<script>` blocks. Replace the student's name, student number, email, and any address with placeholder text such as `Student Name` and `00000000`. Then check nothing personal is left:

```bash
grep -n -i -E '<student name>|[0-9]{8}|@uwaterloo.ca' tests/fixtures/quest/*.html
```

Expected: no output, or only matches the user confirms are not personal (for example class numbers are 4 digits and do not match).

- [ ] **Step 4: Write the page test**

Fill in `expectedCourses` and `expectedProfs` with values visible in each fixture (course codes in UWFlow format, instructor names normalized to lowercase). Set `expectedProfs` to `[]` for pages that do not list instructors.

`tests/questPages.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { applyOverlay } from '../src/content/overlay';
import type { LookupRequest, LookupResponse } from '../src/shared/types';
import catalogue from './fixtures/quest/catalogue.html?raw';
import classSchedule from './fixtures/quest/class-schedule.html?raw';
import classSearch from './fixtures/quest/class-search.html?raw';
import shoppingCart from './fixtures/quest/shopping-cart.html?raw';

// Every requested key is "found", so badges appear wherever a target was detected.
function everythingFound() {
  return vi.fn(async (request: LookupRequest): Promise<LookupResponse> => ({
    ok: true,
    courses: Object.fromEntries(
      request.courseCodes.map((code) => [code, { code, name: code, liked: 0.5, easy: 0.5, useful: 0.5, filledCount: 10 }]),
    ),
    profs: Object.fromEntries(
      request.profNames.map((name) => [name, { code: name, name, clear: 0.5, engaging: 0.5, filledCount: 10 }]),
    ),
  }));
}

const pages = [
  { name: 'class search', html: classSearch, expectedCourses: ['<from fixture>'], expectedProfs: ['<from fixture>'] },
  { name: 'shopping cart', html: shoppingCart, expectedCourses: ['<from fixture>'], expectedProfs: ['<from fixture>'] },
  { name: 'class schedule', html: classSchedule, expectedCourses: ['<from fixture>'], expectedProfs: ['<from fixture>'] },
  { name: 'catalogue', html: catalogue, expectedCourses: ['<from fixture>'], expectedProfs: [] },
];

describe.each(pages)('$name page', ({ html, expectedCourses, expectedProfs }) => {
  it('detects the courses and instructors shown', async () => {
    document.documentElement.innerHTML = html;
    const lookup = everythingFound();
    await applyOverlay(document, () => ({ showCourseRatings: true, showProfRatings: true }), lookup);

    const request = lookup.mock.calls[0][0];
    expect(request.courseCodes).toEqual(expect.arrayContaining(expectedCourses));
    expect(request.profNames).toEqual(expect.arrayContaining(expectedProfs));
    expect(document.querySelectorAll('[data-uwflow-badge="course"]').length).toBeGreaterThan(0);
    if (expectedProfs.length > 0) {
      expect(document.querySelectorAll('[data-uwflow-badge="prof"]').length).toBeGreaterThan(0);
    }
  });
});
```

The `'<from fixture>'` strings are replaced with real values read from the fixture files in this step; the test is not run until they are.

- [ ] **Step 5: Run and fix selectors**

Run: `npx vitest run tests/questPages.test.ts`
Expected: PASS. If instructor detection fails, update `INSTRUCTOR_SELECTOR` in `src/content/selectors.ts` to match the id pattern found in Step 2, keep the comment accurate, and rerun until PASS. Then run `npm test` to confirm nothing else broke.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/quest tests/questPages.test.ts src/content/selectors.ts
git commit -m "Verify detection against saved Quest pages"
```

- [ ] **Step 7: Manual check in Chrome**

1. `npm run build`, open `chrome://extensions`, enable Developer mode, "Load unpacked", pick `dist/`.
2. On Quest, open class search results, shopping cart, My Class Schedule, and the course catalogue. Confirm course badges next to codes and prof badges next to instructors, hover tooltips, and that clicking a badge opens UWFlow in a new tab without triggering Quest.
3. Look at class search results with many sections. If the same course code repeats on every row and the badges are cluttered, report it to the user before changing anything.
4. Open the popup, switch off "Professor ratings": prof badges disappear from the open Quest tab without a refresh. Switch it back on: they return. Repeat for "Course ratings".
5. Turn off Wi-Fi, reload a Quest page for a course not seen before: no badges, no errors on the page, one `[UWFlow Overlay]` warning in the console.
