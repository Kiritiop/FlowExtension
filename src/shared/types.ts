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
