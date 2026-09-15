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
