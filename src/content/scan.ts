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
