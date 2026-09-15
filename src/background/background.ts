import type { CourseRating, LookupRequest, ProfRating } from '../shared/types';
import { createCache, type StorageArea } from './cache';
import { createLookupHandler } from './lookup';
import { fetchCourses, fetchProfs } from './uwflow';

const storage: StorageArea = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
};

const handleLookup = createLookupHandler({
  courseCache: createCache<CourseRating | null>(storage, 'course:'),
  profCache: createCache<ProfRating | null>(storage, 'prof:'),
  fetchCourses: (codes) => fetchCourses(codes),
  fetchProfs: (names) => fetchProfs(names),
});

chrome.runtime.onMessage.addListener((message: LookupRequest, _sender, sendResponse) => {
  if (message?.type !== 'lookup') return false;
  void handleLookup(message).then(sendResponse);
  return true; // keeps the channel open for the async response
});
