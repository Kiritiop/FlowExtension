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
