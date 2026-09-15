import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'UWFlow Quest Overlay',
  version: '0.1.0',
  description: 'Shows UWFlow course and professor ratings on Quest.',
  permissions: ['storage'],
  host_permissions: ['https://uwflow.com/*'],
  background: {
    service_worker: 'src/background/background.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://quest.pecs.uwaterloo.ca/*'],
      js: ['src/content/content.ts'],
      all_frames: true,
      run_at: 'document_idle',
    },
  ],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'UWFlow Quest Overlay',
  },
});
