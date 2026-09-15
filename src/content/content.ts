import { DEFAULT_SETTINGS, loadSettings, onSettingsChange, type Settings } from '../shared/settings';
import type { LookupRequest, LookupResponse } from '../shared/types';
import { applyOverlay } from './overlay';
import { removeBadges } from './scan';

const DEBOUNCE_MS = 300;

const FRAME = window === window.top ? 'top frame' : 'iframe';
console.log(`[UWFlow Overlay] debug: content script running in ${FRAME} ${location.href}`);

let settings: Settings = DEFAULT_SETTINGS;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let rerun = false;
let observedRoot: Element | null = null;

const observer = new MutationObserver(schedule);

function lookup(request: LookupRequest): Promise<LookupResponse> {
  return chrome.runtime.sendMessage(request);
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
}

async function run(): Promise<void> {
  console.log(
    `[UWFlow Overlay] debug: run in ${FRAME} ${JSON.stringify({
      hasRuntime: Boolean(chrome.runtime?.id),
      running,
      sameRoot: document.documentElement === observedRoot,
    })}`,
  );
  // After the extension is reloaded or updated, old content scripts lose access to it.
  if (!chrome.runtime?.id) {
    observer.disconnect();
    return;
  }
  // Only one scan at a time, so badges are never inserted twice.
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      await applyOverlay(document, () => settings, lookup);
    } while (rerun);
  } catch (err) {
    console.warn('[UWFlow Overlay]', err);
  } finally {
    running = false;
  }
}

onSettingsChange((next) => {
  settings = next;
  if (!next.showCourseRatings) removeBadges(document, 'course');
  if (!next.showProfRatings) removeBadges(document, 'prof');
  schedule();
});

void loadSettings().then((loaded) => {
  console.log(`[UWFlow Overlay] debug: settings loaded in ${FRAME} ${JSON.stringify(loaded)}`);
  settings = loaded;
  observedRoot = document.documentElement;
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
});
