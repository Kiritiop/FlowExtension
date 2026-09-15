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
