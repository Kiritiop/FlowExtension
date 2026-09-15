import { loadSettings, saveSettings, type Settings } from '../shared/settings';

const keys: (keyof Settings)[] = ['showCourseRatings', 'showProfRatings'];

void loadSettings().then((settings) => {
  for (const key of keys) {
    const checkbox = document.getElementById(key) as HTMLInputElement;
    checkbox.checked = settings[key];
    checkbox.addEventListener('change', () => void saveSettings({ [key]: checkbox.checked }));
  }
});
