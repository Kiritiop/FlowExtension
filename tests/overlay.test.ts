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
