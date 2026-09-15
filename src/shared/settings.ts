export type Settings = {
  showCourseRatings: boolean;
  showProfRatings: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  showCourseRatings: true,
  showProfRatings: true,
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

export function onSettingsChange(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === 'sync') void loadSettings().then(callback);
  });
}
