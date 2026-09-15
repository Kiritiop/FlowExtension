// Fails the build if the service worker or content script loader points at the
// wrong bundle. CRXJS once wired the service worker to the content script
// because both entry files were named index.ts.
import { readFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const read = (path) => readFileSync(new URL(path, dist), 'utf8');

const manifest = JSON.parse(read('manifest.json'));

function importedChunk(loaderPath) {
  const match = read(loaderPath).match(/assets\/[\w.-]+\.js/);
  if (!match) throw new Error(`No chunk import found in ${loaderPath}`);
  return match[0];
}

const checks = [
  { name: 'service worker', loader: manifest.background.service_worker, marker: 'onMessage.addListener' },
  { name: 'content script', loader: manifest.content_scripts[0].js[0], marker: 'MutationObserver' },
];

let failed = false;
for (const { name, loader, marker } of checks) {
  const chunk = importedChunk(loader);
  const ok = read(chunk).includes(marker);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${loader} -> ${chunk} (expects ${marker})`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
