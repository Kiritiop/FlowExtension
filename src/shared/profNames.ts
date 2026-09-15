const PLACEHOLDERS = new Set(['staff', 'tba', 'tbd', 'to be announced', 'to be determined']);

// Lookup key used by both the content script and the background worker.
export function normalizeProfName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Line breaks and semicolons separate instructors. Within a line, exactly two
// comma parts where the first has no space is "Last, First"; otherwise commas
// separate instructors.
export function splitInstructors(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/[\n;]/)) {
    const parts = line
      .split(',')
      .map((part) => part.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (parts.length === 2 && !parts[0].includes(' ')) {
      names.push(`${parts[1]} ${parts[0]}`);
    } else {
      names.push(...parts);
    }
  }
  return names.filter((name) => !PLACEHOLDERS.has(name.toLowerCase()));
}
