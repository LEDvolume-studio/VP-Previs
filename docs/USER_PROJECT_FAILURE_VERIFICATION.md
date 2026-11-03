# Integrated account failure verification

Target selected by the user: Chrome 156 on this Mac. These checks use isolated
Miniflare D1/R2 and native Chromium IndexedDB/Service Worker against the actual
Worker and production build. They do not write shared Cloudflare data.

| Step 10 scenario | Durable-content evidence |
| --- | --- |
| Simultaneous clean-profile login | `studentAccounts.browser.mjs` opens two profiles concurrently and asserts both native account stores contain the same sole starter; D1 has one bootstrap/project. |
| Several projects through outage/restart | `studentAccountSync.browser.mjs` saves and edits two projects while creation returns 503, closes stores, reloads the page and checks exact remote documents after all queued work syncs. |
| Response disappears after server commit | Original sync harness destroys document responses; account harness replaces committed media/project responses with 503, restarts, and asserts one immutable revision/media. |
| N+1 while N finishes | Account sync captures the exact intermediate native acknowledgement and confirms N+1 remains pending, then checks separate conditional requests/acks. |
| Two writers | Account sync and built account UI preserve both winning cloud content and local recovery; UI can save a separate local copy. |
| Identity changes in upload | Account sync holds a real upload and switches account workspace; checks isolated document, credential and acknowledgement state. |
| Remote archive with offline work | Account sync archives through another client, commits local edits, resumes and asserts archived cloud head remains revision zero while the exact offline document is stored in recovery. |
| Revoke during document/media completion | `backend.account-projects.mjs` holds actual document put/media completion after authorization and revokes; final D1 head/completion does not commit. |
| Missing dependency/audio failure | Account sync checks absent audio and mutated catalogue hashes cannot yield a head/ack; production offline editor checks eviction and failed download cannot retain ready status. |
| Storage failure | Native storage checks blocked upgrade, abort/quota and atomic rollback; account UI displays unsaved work and retries. |
| Failed shell install | Native shell and production editor tests inject a missing precache asset and assert old shell remains, partial cache is removed, and committed work remains. |
| Default changes during creation | `backend.student-default.mjs` holds the actual default-object read after bootstrap reservation, advances default pointer, releases creation and asserts the reserved project uses one old pinned version while a later student uses the new version. |

## Latest results

- `npm run build`: passed (`/tmp/rayzee-step10-build.log`).
- `npm run test:previs -- --reporter=dot`: 899 passed in 60 files (`/tmp/rayzee-step10-unit.log`).
- `npm run test:previs:backend`: 70 passed (`/tmp/rayzee-step10-backend.log`).
- `npm run test:previs:storage`: original 13 plus five grouped account checks passed (`/tmp/rayzee-step10-storage.log`).
- `npm run test:previs:sync`: original seven plus thirteen grouped account checks passed (`/tmp/rayzee-step10-sync.log`).
- `npm run test:previs:accounts`: sixteen browser groups passed (`/tmp/rayzee-step10-accounts.log`).
- `npm run test:previs:offline`: passed (`/tmp/rayzee-step10-offline.log`).
- Production offline editor passed after fixing omitted bundler import facades (`/tmp/rayzee-step10-offline-fixed.log`); shell regression and final backend70 pass.
- ESLint passes for the four Step 10 test files (`/tmp/rayzee-step10-lint.log`).

The canonical production offline editor harness retains camera, preset, driving
plate, timeline/playback and voiceover browser coverage. Historical anonymous
dev-editor scripts are not used against the shared live-data localhost bridge.

The final run exposed an actual omitted dynamic-import facade in the offline shell. The graph walker now follows final emitted local references, with a regression fixture. The complete offline authoring run passed against an immutable build snapshot after the fix.
