# Student workspace offline shell

Implemented 22 October 2026. This is a bounded application-shell cache for the local student document/timeline workspace. It does not prepare models, teacher videos, narration, HDR environments, the raster diagnostic or the admin editor for offline use.

## Build and registration

`app/build/studentOfflinePlugin.js` runs only during builds. Both Vite configurations include a named `student` entry and `studentOfflinePlugin()`. The plugin walks that entry's static JavaScript imports, CSS and referenced bundled assets, then emits `/student/sw.js`. The content hash covers the selected filenames and their bytes; a shell dependency change creates a new cache version. An unrelated diagnostic entry change does not change that version. Future dynamically imported workspace features need an explicit extension to this static-graph contract before claiming offline support.

The production workspace registers the worker with scope `/student/`; development previews do not register it. Installation precaches `/student/`, `/student/index.html` and the selected hashed assets. The current proof manifest contains just the two workspace URLs, a module-preload polyfill, the student JavaScript chunk and its stylesheet. No diagnostic/codec bundle or model/video is included.

The generated URLs assume deployment at the origin root, as required by the `/student/` route. The host must serve the actual built files, JavaScript MIME types and existing isolation headers. Subdirectory deployment requires adapting this contract. HTTPS or localhost is required for service workers.

## Scope and update behavior

- Only exact workspace navigation to `/student/` and `/student/index.html`, without a query string, can use a cached page. Only the listed same-origin GET asset paths can use the asset cache. Other routes and methods pass through to normal browser networking.
- `/`, admin routes, `/student/diagnostic/`, shares, API requests and uncached media never receive a workspace-HTML fallback. A student worker cannot control an admin document outside its registration scope.
- Precache failure rejects installation. A newly created partial cache is removed; any pre-existing cache of the same version is preserved. The previous active worker and cache remain usable after a failed update.
- No automatic `skipWaiting` or `clients.claim` interrupts a running editor. The first installation needs a subsequent navigation to control the page. Updates wait for existing controlled pages to close; old shell caches are removed only when the new worker activates.
- IndexedDB remains the authority for committed project revisions. The shell cache contains public program assets, not document contents or private backup authority. Clearing browser site data or storage eviction can remove both shell and local work; portable JSON remains the available backup in this implementation.

The footer explicitly separates shell availability from media readiness. A successful shell installation is not evidence that a referenced scene or teacher video is playable offline. Media preparation, integrity/version tracking, quotas, HTTP Range delivery and recovery from media eviction remain later work.

## Reproduce verification

Use the configured Node 22 runtime. The browser harness starts its own ephemeral strict static HTTP server, serves built assets, and closes the server/browser afterward; it does not use the development server or an HTML fallback.

```sh
npm run build:previs
STUDENT_BUILD_DIR=app/dist-previs-diagnostic node tests/browser/previs/studentOffline.browser.mjs
```

The same harness defaults to `app/dist` after a complete `npm run build`; `CHROME_PATH` may override the installed Chrome executable. The strict server mirrors Vite's COOP `same-origin` and COEP `credentialless` policy. Cached navigation must retain a secure, cross-origin-isolated context. This localhost result does not verify hosted headers, CDN behavior or service-worker policy on school networks.

## Observed result

On 22 October 2026 the isolated production build and browser harness passed on macOS (`darwin`), Chrome **155.0.8059.85**. The run used native Chromium Service Worker, CacheStorage and IndexedDB APIs:

1. Verified generated dependency inclusion, exclusion of unrelated diagnostic code, cache-version changes for shell changes, and exact installed cache contents.
2. Created and renamed a project, awaited revision 1's local acknowledgment, disabled networking, refreshed the built page and recovered the exact committed document. A second rename while offline committed revision 2 and survived another offline refresh.
3. Verified isolation headers survive cached navigation and the footer states that referenced media are not prepared.
4. Verified admin pages remain uncontrolled, while diagnostic navigation, shares, API and an uncached model fail offline instead of receiving student HTML. The isolated build uses a root boundary sentinel because it omits the admin bundle; this scope test is not an admin rendering acceptance test.
5. Injected a worker update whose precache included a missing asset. Installation became redundant, removed its new partial cache and retained the active cache; offline reopening still worked. Also checked failure when the proposed worker reused an existing cache version.
6. Installed a successful update while the editor remained open. It waited, preserving the existing controller and both cache versions until activation is safe.

Build log: `/tmp/rayzee-previs-offline-build.log`. Browser evidence: `/tmp/rayzee-previs-offline.log`. The plugin and browser harness pass ESLint. Windows/Edge, actual hosted delivery, cache eviction, target school hardware, scene/video offline preparation and production deployment have not been verified by this shell proof.
