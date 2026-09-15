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
