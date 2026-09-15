import type { Settings } from '../shared/settings';
import type { LookupRequest, LookupResponse } from '../shared/types';
import { createCourseBadge, createProfBadge } from './badge';
import { findCourseTargets, findProfTargets, insertCourseBadges, insertProfBadges } from './scan';

export type Lookup = (request: LookupRequest) => Promise<LookupResponse>;

export async function applyOverlay(doc: Document, getSettings: () => Settings, lookup: Lookup): Promise<void> {
  const settings = getSettings();
  const courseTargets = settings.showCourseRatings ? findCourseTargets(doc.body ?? doc.documentElement) : [];
  const profTargets = settings.showProfRatings ? findProfTargets(doc) : [];
  const where = doc.defaultView && doc.defaultView === doc.defaultView.top ? 'top frame' : 'iframe';
  console.log(
    `[UWFlow Overlay] debug: scan in ${where} ${JSON.stringify({
      courses: [...new Set(courseTargets.map((target) => target.code))],
      profs: [...new Set(profTargets.map((target) => target.name))],
    })}`,
  );
  if (courseTargets.length === 0 && profTargets.length === 0) return;

  console.log(`[UWFlow Overlay] debug: sending lookup from ${where}`);
  const response = await lookup({
    type: 'lookup',
    courseCodes: [...new Set(courseTargets.map((target) => target.code))],
    profNames: [...new Set(profTargets.map((target) => target.name))],
  });
  console.log(`[UWFlow Overlay] debug: lookup result in ${where} ${JSON.stringify(response).slice(0, 300)}`);
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
