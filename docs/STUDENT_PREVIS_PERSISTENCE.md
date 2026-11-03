# Student local persistence foundation

Implemented 21 October 2026. This is a service foundation for Phase 3, not a completed student application. Existing admin `RayzeeEditorDB` documents and project services are unchanged.

## Storage and save contract

`app/src/previs/persistence/StudentProjectRepository.js` uses a separate `RayzeeStudentDB`, schema version 1. The stores are:

| Store | Content |
| --- | --- |
| `projects` | Latest validated portable document and local commit time. |
| `revisions` | Immutable complete documents keyed by project ID and revision. |
| `outbox` | Durable entries keyed by exact project ID/revision, with stable request IDs. |
| `sync` | Device-private acknowledgement state; reserved boundary for future cloud ownership. |
| `recoveries` | Stale writers' attempted documents, with expected/actual revisions. |

`save(document, {expectedRevision})` commits the latest document, immutable revision and outbox in **one native IndexedDB transaction**. Its promise resolves only on transaction completion. A new project requires `expectedRevision:null` and document revision zero. An existing project requires the last observed revision and a document whose revision is exactly one greater. Domain commands produce that successor revision; playback and selection do not call save.

```js
const repository = new StudentProjectRepository();
const document = createStudentProjectDocument();
await repository.save(document, { expectedRevision: null });
// Only now may a UI report "Saved on this device".
const renamed = {
  ...document,
  name: 'Scene study',
  revision: document.revision + 1,
  updatedAt: new Date().toISOString(),
};
await repository.save(renamed, { expectedRevision: document.revision });
```

The API does not yet drive autosave, undo, continuous pointer changes or a local-save indicator. The UI must await save, retain unsaved state after failure and checkpoint interactions explicitly. No crash-window duration has been measured or promised. Browser eviction, cleared site data and unsaved moves are not protected by this service.

## Multiple tabs and recovery

IndexedDB serialises overlapping write transactions. The expected revision is checked **inside** the same transaction as the write. Concurrent writers from revision N therefore cannot both replace it. A stale writer leaves the current document/outbox intact and commits the attempted document to `recoveries`; only after that preservation transaction completes does `save` reject with `StudentRevisionConflict` containing `recoveryId`, `expectedRevision` and `latestDocument`.

`recoveries(projectId)` lists those preserved attempts. `restoreRecovery(recoveryId, {projectId})` creates an independent project with fresh revision zero; it preserves the original recovery record. `duplicate(projectId, options)` similarly creates an independent document. None of these copy private sync records. If storage fails while preserving a conflict, save reports a storage failure and cannot promise that the attempted revision survived; the caller must retain its in-memory copy.

A single-active-writer UI/lease and cross-tab notifications are still future work. Transactional preconditions already prevent silent last-write-wins. No automatic merge is attempted.

## Exact acknowledgements

`pending(projectId)` returns the durable outbox; `getRevision(projectId, revision)` retrieves the corresponding immutable snapshot for upload. `acknowledge(projectId, {revision, requestId, dependenciesVerified:true})` deletes **only** that exact matching outbox entry and monotonically advances the private acknowledged revision. An old acknowledgement cannot clear a newer pending edit or move acknowledged state backwards. Unknown/mismatched acknowledgements return false without a write.

Only the future sync service may assert `dependenciesVerified:true`, after the server has accepted that exact revision and all referenced media. `status(projectId).backedUp` compares the latest local revision to that acknowledged revision. The initial repository API expresses this contract and its original browser tests use synthetic acknowledgements. A separate durable backup service and real Worker integration have since been added; see [STUDENT_PREVIS_SYNC.md](STUDENT_PREVIS_SYNC.md). The student frontend is still not connected to a hosted backend. Device capability creation, private in-flight requests, conditional server revisions and bounded retry now have a separately tested service foundation. Hosted activation, media checkpoints and private recovery remain pending.

## Storage failures and schema upgrades

`StudentStorageError.code` distinguishes `UNAVAILABLE`, `QUOTA_EXCEEDED`, `BLOCKED`, `VERSION_CHANGED` and `TRANSACTION_FAILED`. Failed or aborted native transactions cannot return a successful save. A blocked open rejects with an instruction to close older tabs; its eventual connection is closed rather than reused after rejection. Upgrade-triggered `versionchange` closes the old connection and invalidates that repository until page reload. An unexpectedly closed connection may be reopened. `close()` supports normal teardown.

Optional `onStorageEvent` receives blocked/versionchange/closed notifications for a future UI. No status screen, migration beyond version 1 or automatic storage-persistence permission request is included. Application shell caching is also absent, so **offline refresh of a student page is not yet supported** by this slice; repository reads themselves work without a network connection.

## Portable JSON

`exportJSON(projectId)` serialises only validated student content through `prepareStudentProjectExport`. It never serialises repository rows or private sync metadata. `importJSON(json, options)` accepts at most 16 MiB of UTF-8 JSON, validates it, assigns a new identity/revision and commits it as a new local project. Unknown credential/path/URL fields are rejected by the strict domain schema. `options.projectId` is useful for deterministic tests; normal callers omit it to generate a new ID.

This is a **reference-only JSON document**, not an offline media package. It contains immutable asset/narration references and requires those media versions to remain available through a future resolver. It embeds no narration blobs, library videos, application files, recovery credentials or local file handles. Binary packages, hash verification of included files, archive limits and media offline-readiness UI belong to later phases.

Immutable revisions and recovery copies currently remain in IndexedDB indefinitely. Garbage collection, quota budgeting and retention policy need implementation before a sustained student pilot; do not silently prune pending revisions or the only recovery copy.

## Reproducible verification

Run from the repository root with Node 22.12+ and desktop Chrome (no new packages required):

```sh
node tests/integration/previs/studentRepository.browser.mjs
npx eslint app/src/previs/persistence/StudentProjectRepository.js
```

The standalone `.mjs` harness uses existing `puppeteer-core`, an ephemeral loopback server and **real Chromium IndexedDB**. It is deliberately outside Node Vitest discovery. On macOS it defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; set `CHROME_PATH` for another installed Chrome/Edge executable. No browser download or application server is needed.

Evidence on 21 October 2026: Node 22.22.3, macOS, headless Chrome 155.0.8059.85. Covered native commit/restart and offline reads; actual transaction abort rollback across all save stores; an injected quota exception within a native transaction; two-page revision conflict and durable recovery; exact/out-of-order acknowledgement; portable JSON separation and rejected credential input; native versionchange and blocked upgrades; unavailable storage and a synchronous security denial. The quota test injects the exception and does **not** establish real browser disk exhaustion behaviour. The blocked-upgrade test delegates native open to version 2 to exercise actual blocking while the service remains version 1.

Not run: actual disk exhaustion/eviction, process termination during commit, production offline refresh, UI checkpoint behaviour, Windows/Edge acceptance and server backup integration. No Map mock is used as transaction evidence.
