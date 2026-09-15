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
