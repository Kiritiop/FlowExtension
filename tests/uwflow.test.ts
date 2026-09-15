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
