# UWFlow Quest Overlay

A Chrome extension that shows [UWFlow](https://uwflow.com) course and professor ratings directly on [Quest](https://quest.pecs.uwaterloo.ca), so you can compare courses and sections without switching tabs.

## What it does

When you open Quest, the extension adds small rating badges to the page:

- **Course badges** appear next to course codes such as `CS 246` or `MATH 135`, and show the percentage of students who liked the course (for example "66% liked").
- **Professor badges** appear next to instructor names and show the percentage who rated the professor as clear (for example "94% clear").

Badges work on class search results, the shopping cart, enrolment pages, My Class Schedule, and the course catalogue.

Hover over a badge to see the full breakdown:

- Courses: liked, easy, useful, and the number of ratings.
- Professors: clear, engaging, and the number of ratings.

Click a badge to open that course or professor on UWFlow in a new tab.

A grey badge means the rating is based on fewer than 5 reviews, so take it with a grain of salt. "No ratings" means UWFlow knows the course or professor but nobody has rated them yet. If there is no badge at all, UWFlow has no matching entry.

## Installing

The extension is not on the Chrome Web Store, so you build it yourself and load it into Chrome. You need [Node.js](https://nodejs.org) 22 or newer.

1. Clone this repository and install dependencies:

   ```sh
   git clone <repository-url>
   cd FlowExtension
   npm install
   ```

2. Build the extension:

   ```sh
   npm run build
   ```

   This creates a `dist/` folder.

3. Open Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode** in the top right corner.
5. Click **Load unpacked** and select the `dist/` folder.
6. Optionally, pin the extension from the puzzle piece icon in the toolbar so the settings popup is one click away.

Open or refresh a Quest tab and the badges will appear once the page loads.

Other Chromium-based browsers such as Edge and Brave should also work using the same steps on their extensions page.

## Settings

Click the extension icon in the toolbar to open the popup. It has two toggles:

- **Course ratings**
- **Professor ratings**

Both are on by default. Changes apply to open Quest tabs immediately, with no refresh needed. Your choices sync across Chrome browsers signed in to the same account.

## Updating

Pull the latest changes, rebuild, then reload the extension:

```sh
git pull
npm install
npm run build
```

On `chrome://extensions`, click the reload icon on the UWFlow Quest Overlay card, then refresh any open Quest tabs.

## Good to know

- Ratings are cached for 24 hours, so a new review on UWFlow may take up to a day to show up in a badge.
- Professor matching is by exact full name (ignoring capitalization). If Quest and UWFlow spell a name differently, including accents, no badge is shown. The extension never guesses a close match.
- Placeholder instructors such as "Staff" or "TBA" are skipped.
- Occasionally something that looks like a course code but is not one (for example a room number) is picked up, but a badge only appears if UWFlow actually has that course.
- The extension only reads public rating data from UWFlow. It does not need a UWFlow account, and it does not send any of your Quest information anywhere. The only thing sent to UWFlow is the list of course codes and instructor names found on the page.

## Troubleshooting

**No badges appear.** Refresh the Quest tab. If you just installed or reloaded the extension, tabs that were already open need a refresh before the extension can run in them. Also check that both toggles in the popup are on.

**Badges stopped appearing after a while.** UWFlow may be unreachable or slow. The extension tries again the next time the page changes, so navigating within Quest or refreshing usually brings them back.

**Still stuck.** Open Chrome DevTools on the Quest tab (right-click, then Inspect) and look in the Console for messages starting with `[UWFlow Overlay]`. They show what the extension found on the page and whether the request to UWFlow succeeded.

## Development

```sh
npm run dev        # build in watch mode, then load dist/ as an unpacked extension
npm run build      # type check, production build, and bundle sanity check
npm run typecheck  # type check only
npm test           # run the unit tests
```

The project is written in TypeScript and built with Vite and `@crxjs/vite-plugin`. Tests use Vitest with jsdom.

Source layout:

- `src/content/` finds course codes and instructor names on Quest pages and inserts the badges. Instructor element selectors live in `src/content/selectors.ts`, so if Quest changes its layout that is the file to update.
- `src/background/` queries the UWFlow GraphQL API and caches results.
- `src/popup/` is the settings popup.
- `src/shared/` holds types, settings, and name handling shared by the other parts.
- `tests/` has unit tests and recorded UWFlow responses used as fixtures.

## Credits

All ratings come from [UWFlow](https://uwflow.com). This project is not affiliated with UWFlow or the University of Waterloo.
