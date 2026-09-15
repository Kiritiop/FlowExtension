# UWFlow Quest Overlay: Design

Date: 2026-09-14

## Goal

A Chrome extension that shows UWFlow course and professor ratings directly on Quest (quest.pecs.uwaterloo.ca), so students can compare courses and sections without switching tabs.

## Scope

In scope:

- Course rating badges next to course codes anywhere they appear on Quest: class search, shopping cart, enrolment, My Class Schedule, course catalogue.
- Professor rating badges next to instructor names wherever Quest lists them.
- A popup with two independent toggles: course ratings and professor ratings.

Out of scope:

- Any feature outside Quest.
- Writing reviews, submitting data to UWFlow, or any authenticated UWFlow access.
- Automated end-to-end tests against live Quest.

## Tooling

- TypeScript, Vite 8, @crxjs/vite-plugin 2.x.
- Vitest 5 with jsdom for tests.
- `npm run dev` for development with auto reload, `npm run build` to produce `dist/`, loaded in Chrome via "Load unpacked".

## Architecture

### Manifest (MV3)

- Content script matches `https://quest.pecs.uwaterloo.ca/*` with `all_frames: true`, because Quest renders most content inside an iframe.
- `host_permissions`: `https://uwflow.com/*`.
- `permissions`: `storage`.

### Content script (`src/content/`)

- Scans visible text for course codes and instructor names.
- Sends the collected codes and names to the background worker in one message per scan.
- Renders badges inside a Shadow DOM so Quest CSS and badge CSS cannot affect each other.
- Uses a MutationObserver, debounced at about 300ms, to rescan the page, since Quest updates pages without full reloads. Anything already badged is skipped, so rescans are cheap, and only one scan runs at a time.
- Listens for `chrome.storage` changes and shows or hides badge types immediately when a toggle changes.
- Marks processed elements so they are not badged twice. Skips inputs, textareas, scripts, styles, and its own badges.
- Stops quietly if the extension context is invalidated (for example after an extension update).

### Background worker (`src/background/`)

- The only component that talks to UWFlow (`https://uwflow.com/graphql`). Running requests here avoids content script cross-origin limits.
- Batches all course codes from one scan into a single GraphQL query using `code: {_in: [...]}`, and all instructor names into a single query using `_or` of case-insensitive `name: {_ilike: ...}` matches, with LIKE wildcards escaped.
- Caches results in `chrome.storage.local` for 24 hours, keyed per course code and per normalized instructor name. Successful "not found" results are cached too. Failures are not cached.
- Requests time out after 10 seconds.

### Popup (`src/popup/`)

- Two toggles: "Course ratings" and "Professor ratings". Both default to on.
- Stored in `chrome.storage.sync`.

### Shared (`src/shared/`)

- Message types between content script and background worker.
- Rating data types.
- Settings type and defaults.

## Data and matching

### UWFlow API findings

- The GraphQL API is public and needs no login.
- `course(where: {code: {_eq: "cs246"}})` returns `rating { liked easy useful filled_count comment_count }`. Values are fractions between 0 and 1.
- `prof(where: ...)` returns `name`, `code` (for example `brad_lushman`), and `rating { clear engaging filled_count comment_count }`.
- Section to prof links (`course_section.meetings.prof`) are mostly empty for the current and next terms, so professors cannot be matched through Quest class numbers. Matching is by name.
- Prof codes are not derived consistently from names: `françois_paré` keeps accents, `adil_al-mayah` and `adil_al_mayah` both exist, `andrei_l._badescu` keeps a period. Codes cannot be generated from a name, so the lookup query matches on `name`.
- Some profs have duplicate records under the same name.

### Course codes

- Pattern: 2 to 6 uppercase letters, optional whitespace, 3 digits, optional single uppercase letter suffix. Examples: `CS 246`, `CS246`, `MATH 135A`.
- Normalized to UWFlow format: lowercase with no whitespace (`cs246`).
- A badge is only rendered when UWFlow returns that course, which filters false matches such as `ROOM 101`.
- How to handle a code that repeats many times on one page (for example across section rows in class search) is decided per page after inspecting saved Quest HTML. Default until then: badge each distinct text occurrence.

### Professors

- Instructor names are read from the elements where Quest lists instructors. The exact selectors are determined from saved Quest HTML and kept in one module so layout changes are fixed in one place.
- Splitting: line breaks and semicolons separate instructors. Within a line, exactly two comma parts where the first has no space is read as "Last, First" and reordered ("Lushman, Brad" becomes "Brad Lushman"). Otherwise commas separate instructors.
- Matching: by full name, case-insensitive, whitespace collapsed. Accents must match exactly.
- When UWFlow has duplicate records with the same name, the one with more ratings is used.
- Placeholders such as "Staff", "TBA", and "To be Announced" are ignored.
- No match means no badge. The extension never guesses a close name.

### Badges

- Course badge, compact: liked percentage, for example "66% liked".
- Prof badge, compact: clear percentage, for example "94% clear".
- Hover shows the full breakdown (course: liked, easy, useful; prof: clear, engaging) and the number of ratings.
- Click opens `https://uwflow.com/course/<code>` or `https://uwflow.com/professor/<code>` in a new tab.
- Fewer than 5 ratings: badge is greyed out.
- A course or prof with a rating value of null shows "No ratings" in grey.

## Error handling

- UWFlow unreachable, slow, or returning GraphQL errors: log once per scan to the console with the prefix `[UWFlow Overlay]`, render no badges, do not cache, retry on the next scan.
- Quest layout changes: course detection is text based and degrades gracefully. Prof detection depends on selectors and fails to "no prof badges".
- No error UI is ever injected into Quest.

## Testing

- Unit tests: course code detection and normalization, instructor name splitting and normalization, cache expiry, GraphQL response mapping using recorded real UWFlow responses.
- Page tests: run the content script scan against saved Quest pages (jsdom) and assert badge placement. Saved pages are stripped of the student's name, student number, and other personal details before being added as fixtures.
- Manual check in Chrome: class search, shopping cart, My Class Schedule, course catalogue, and both toggles on and off.

## Open inputs

- Saved Quest pages (Chrome "Save Page As", "Webpage, Complete") for class search results, shopping cart, My Class Schedule, and the course catalogue. Needed to finalize instructor selectors and repeated-code handling.
