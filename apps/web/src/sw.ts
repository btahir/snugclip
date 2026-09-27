/// <reference lib="webworker" />
// Snugclip service worker (Serwist, MIT): precaches the whole static export, including fonts
// and the lazily-loaded AAC encoder, so the app works in airplane mode after the first visit.
// Bundled by scripts/build-sw.mjs; the precache manifest is injected at build time.
import { Serwist, type PrecacheEntry } from 'serwist';

declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    // Deep links (?preset=discord&maxh=720) must still hit the precached page.
    ignoreURLParametersMatching: [/.*/],
    directoryIndex: 'index.html',
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  fallbacks: { entries: [{ url: '/404.html', matcher: ({ request }) => request.destination === 'document' }] },
});

serwist.addEventListeners();
