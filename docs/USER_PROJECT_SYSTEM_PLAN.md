# User accounts, projects and offline sync overhaul

Prepared 2 November 2026. This is an implementation plan based on inspection and
fresh verification of the current code. No application changes, user creation,
email sending or deployment were performed while preparing it.

## Delivery rule

Implement the numbered steps in order. **Do not begin the next step until the
current step's verification gate passes.** A written description of intended
behaviour, a mock response or a successful build cannot substitute for the
specified persistence, browser or hosted check.

For each step, append an evidence record here containing the change/commit,
commands, results, browser/environment where applicable, manual observations and
remaining failures. Mark it `VERIFIED` only when every acceptance criterion passes.
If a gate fails, fix and rerun that gate before continuing. Explicitly changing a
requirement requires updating both the plan and its acceptance criteria.

| Step | State | Evidence |
| --- | --- | --- |
| 0. Inspect and establish baseline | VERIFIED | Inspection, tests and cloud reads recorded below |
| 1. Specify contracts and migrations | VERIFIED | Revised contract, additive migration and fresh/populated D1/R2 verification recorded below. |
| 2. Implement student identity and revocation | VERIFIED | Actual Worker/D1 identity, access and guarded-write checks recorded below. |
| 3. Implement account-owned cloud projects | VERIFIED | Actual Worker/D1/R2 project, bootstrap, ownership and race checks recorded below. |
| 4. Implement versioned admin default scene | VERIFIED | Local Worker publication, admin browser and fresh-profile scene checks recorded below. |
| 5. Partition local storage and support cloud hydration | VERIFIED | Native Chromium storage and lifecycle checks recorded below. |
| 6. Complete durable sync and dependency verification | VERIFIED | Actual Worker/D1/R2 and native browser sync checks recorded below. |
| 7. Prepare the complete student editor for offline use | VERIFIED | Production-build Chrome shell and account-backed editor checks recorded below. |
| 8. Connect login, autosave and project selection UI | VERIFIED | Actual Worker and production editor browser checks recorded below. |
| 9. Deliver admin user/project management and login links | VERIFIED | Actual Worker/admin/student browser workflow and read-only media review recorded below. |
| 10. Verify the integrated failure scenarios | VERIFIED | Scenario matrix and full local gates recorded below. |
| 11. Stage, verify and release | VERIFIED | Shared preview and production acceptance passed; final details below. |

## 0. Findings and verified baseline

### Existing code to retain and extend

| Area | Current implementation | Consequence |
| --- | --- | --- |
| Admin authentication | `backend/src/security/AdminSecurity.js`, `PagesSecurity.js`, `functions/_middleware.js` | Shared admin password/session and Australia network gate already exist. Reuse these for new admin operations. |
| Student entry | `app/src/student/main.js` | `/student/` opens the engineering workbench; `?ui=editor` selects the real editor. There is no student identity gate. |
| Student editing | `app/src/student/editor/EditorSession.js`, `main.jsx` | Saves locally and lists device projects. Cloud backup is explicitly disconnected. Startup awaits the preset library before opening projects, which can block offline startup. |
| Student storage | `app/src/previs/persistence/StudentProjectRepository.js` | Real IndexedDB transactions commit project, immutable revision and outbox together. Expected revisions, recovery copies and exact acknowledgements already exist. Storage is not partitioned by user. |
| Draft sync | `app/src/previs/sync/PrivateDraftBackupService.js`, `app/src/previs/api/DraftApiClient.js` | Durable frozen requests, idempotency, retry and conflict preservation exist, but each draft has a device capability. Revision zero and projects with any dependencies are ineligible. |
| Cloud documents | `backend/src/worker.js`, migrations `0001`–`0002` | D1 revision pointers and R2 documents/narration exist. Draft API is restricted in code to local/test environments. No user ownership, account project list or admin project browsing exists. |
| Default timeline | `GET /v1/student/starting-project` in `worker.js` | Reads the fixed R2 key `student/shared-starting-project.json`. No admin publication API, versioned default pointer or account-level first-project transaction exists. |
| Scene presets | `services/presets/{PresetRepository,CloudAdminPresetRepository,CloudStudentPresetRepository,AdminPresetService}.js`, `backend/src/catalogue/CatalogueApi.js` | Versioned cloud library with admin publication and student reads exists. Published builds select cloud presets. Presets and a complete starting timeline are different things. |
| Admin project files | `app/src/services/projects/{ProjectRepository,ProjectSession,ProjectSchema}.js` | A separate `RayzeeEditorDB`, schema and device-local default exist. This is not the student document format and cannot directly open a student sequence. |
| Voiceover | `app/src/student/editor/LocalNarration.js` | Recorded blobs live in a separate `RayzeeNarrationDB`; they are not uploaded by the editor. |
| Offline shell | `app/build/studentOfflinePlugin.js`, `student/workbench.js` | Precaches the workbench/static graph. The real editor is lazy-loaded and does not register the service worker itself. Query-string navigation bypasses its cache. Models/media are excluded. |
| Sharing | `app/src/student/editor/main.jsx` | Share is a placeholder. No share service exists. |
| Legacy sign-in | `app/src/components/layout/TopBar/AuthProvider.jsx` | Optional Supabase sign-in is unrelated to current Cloudflare admin authentication and student storage. Do not build this feature on it. |

Older progress/security/offline documents describe earlier slices. Use current
source and fresh checks when their status statements disagree.

### The requested default is already in the cloud

Read-only checks against the production origin on 2 November 2026 established:

- `https://vp-previs.pages.dev/v1/student/starting-project` returns HTTP 200 and a
  valid student document named **Studio study · admin appearance**.
- Project ID: `b9770199-c9bd-4245-a23f-ba7578da9012`; document revision: **111**;
  **4 shots, 4 clips, 9 assets**.
- The complete parsed document equals
  `.local-runtime/repaired-shared-starting-project.json`. It differs from the
  pre-repair backup. The repaired local file's raw SHA-256 is
  `922bc1f4fbdf58adb18f135adc9b2930a362921155d2b17ec8b730261636e514`.
- The pinned scene definition was fetched and validated through the actual
  `StudentCatalogueClient`; its model inventory contains four assets.
- All nine assets were fetched with that same client, which verified each MIME
  type, complete byte length and SHA-256. This includes the three approximately
  67 MB driving videos. No upload was necessary.
- Catalogue asset routes do not support the HEAD probe used initially; its 404s
  were superseded by successful, fully verified GETs.

This establishes a cloud copy of the repaired backup. It does not establish that
the latest browser IndexedDB revision is identical, or that the scene renders
correctly in a fresh browser. Step 4 must check both before declaring the new
default publication workflow complete. Preserve the cloud version and both local
backups during the overhaul.

### Fresh checks run successfully

Node 22.22.3; browser harnesses used Chrome 156.0.8078.74 on macOS.

| Command | Result |
| --- | --- |
| `npm run test:previs -- --reporter=dot` | 57 files, 892 tests passed |
| `npm run test:previs:backend` | 50 tests passed; actual Worker with Miniflare D1/R2 |
| `npm run test:previs:storage` | 13 native Chromium IndexedDB checks passed |
| `npm run test:previs:sync` | 7 actual Worker + D1/R2 + Chromium sync checks passed |

Backend output is also recorded at `/tmp/rayzee-user-project-plan-backend.log`
(temporary evidence, not a permanent repository artifact). Node is not on the
default shell PATH here; prepend
`/Users/mitcha/.local/share/fnm/node-versions/v22.22.3/installation/bin` for commands.

These checks verify the existing foundations, including their intentional
limitations. No full-editor offline, new-user or login-link feature has passed
acceptance yet. Git status stalled on this OneDrive checkout; the two status
processes started for this audit were stopped. Existing changes were preserved.

## Product and architecture decisions for implementation

- A student receives a **reusable UUID v4 login link**, with no password or
  registration. Anyone holding the link has that student's access. Keep the UUID
  separate from the public internal user ID so links can rotate without changing
  project ownership.
- Recommended link shape: `/student/#login=<uuid>`. Capture it before boot, commit
  a successfully validated identity/credential privately on the device, then
  remove the fragment from the address bar. Send the UUID as a Bearer credential
  to student APIs. The server stores its hash; it checks active access on every
  protected operation. Retain the credential locally for reconnection without
  asking students to re-enter it after every outage. Admin session cookies remain
  separate.
- A previously validated browser may reopen its own cached work offline without
  the original URL. A browser with neither a valid incoming link nor a stored
  identity sees: **“Please request a login link from your VP supervisor.”** A
  never-validated link cannot establish an identity while offline.
- Preserve local-first editing: local commit is the save boundary; cloud work is
  asynchronous. Cloud outages must not block committed local editing or opening
  cached projects. Browser closure pauses sync; reopening resumes durable work.
- One student owns many projects. Admins can see and open every student's cloud
  projects automatically. Use the student renderer in a protected, read-only
  admin review route; do not force student documents into the unrelated admin
  scene schema. Admin editing of a student's live document is outside this plan.
- Implement creation, selection, rename, duplication and archive/restore. Use
  tombstones/metadata operations so offline clients cannot resurrect an archived
  project. Permanent deletion and retention policy are separate work.
- First login creates exactly one independent project from a pinned default
  version, including revision zero in cloud storage. Later logins/devices reopen
  existing projects. Updating the default never changes existing projects.
- Creating an account requires first name, last name and graduation year. An
  admin issues and copies the login link and sends it to the student manually.
  The application does not send invitations or use an email provider. Reissuing
  rotates the UUID and immediately invalidates the previous link.
- Supervisor access satisfies the sharing requirement described here. Public
  viewing links, peer editing and collaborative merging are separate features;
  replace the placeholder's future promises with accurate supervisor-access text.
- Revocation stops future server access, including uploads already racing a
  revoke. A disconnected device cannot learn about revocation until reconnecting;
  downloaded work cannot be remotely recalled. Preserve unsynced work for export
  when denial is received, stop uploads and show the revoked-access screen.
- The user requires local development and the deployed application to share the
  same Cloudflare D1 database and R2 storage. Use explicit shared-cloud bindings;
  keep automated tests isolated. Local changes against those bindings affect the
  deployed data. Complete backups, migrations and hosted verification in the
  ordered release gate before enabling shared account writes.

## 1. Specify contracts and migrations

Use the following route outline when writing the exact contract. Names may be
refined in this step; authentication and revision semantics must remain explicit.

| Proposed route | Purpose / authority |
| --- | --- |
| `/v1/admin/users` | List/create users; admin session |
| `/v1/admin/users/:userId` | Read/update user details and access state; admin session |
| `/v1/admin/users/:userId/access-link` | Issue/rotate a link for admin copying and manual distribution; admin session |
| `/v1/student/me` | Validate the UUID and return a non-secret user identity; student Bearer UUID |
| `/v1/student/bootstrap` | Idempotently ensure the first project; student Bearer UUID |
| `/v1/student/projects` | List/create owned projects; student Bearer UUID |
| `/v1/student/projects/:projectId` | Read/conditionally update an owned project |
| `/v1/student/projects/:projectId/metadata` | Conditional rename/archive/restore |
| `/v1/student/projects/:projectId/narration/...` | Owned upload/checkpoint/completion/read |
| `/v1/admin/users/:userId/projects` | List a user's latest cloud projects; admin session |
| `/v1/admin/projects/:projectId/...` | Read-only project/revision/narration access; admin session |
| `/v1/admin/student-default/...` | Preview/publish/read default versions; admin session |

**Actions**

1. Write request/response, error, revision and offline-state contracts before
   wiring UI. Reuse the existing portable student schema; keep ownership,
   credentials, cloud pointers and retry state outside exported project JSON.
2. Add an additive D1 migration after `0006`: users, hashed access links/access
   generation, project ownership and summary metadata, initialization marker,
   versioned default pointers, link issuance operations and archive metadata. Reuse
   immutable document/revision/object reservation tables where practical.
3. Specify a private local identity registry and per-user repository/media
   namespaces. Leave pre-account projects unassigned until explicitly imported;
   never assign all device projects to the first student who signs in.
4. Separate local document revisions from authoritative server revisions. Specify
   atomic adoption of a downloaded cloud head without generating a new identity,
   resetting it to revision zero or enqueueing a fake local edit.
5. Specify account field validation and issue/copy/rotation behaviour for links
   distributed manually by admins. Issue a replacement UUID on reissue and make
   the previous link stop working immediately. Specify safe retry after a lost
   issuance response without logging links or exposing them in public records.

**Verification gate**

- Apply migrations to a fresh database and an existing foundation fixture; all
  existing documents/catalogue rows remain readable.
- Inspect constraints/indexes for unique bootstrap, user ownership and stable
  request IDs. Record the API examples and state transitions in this document or
  a linked contract document.
- Confirm the contract and schema require first name, last name and graduation
  year, and specify issue/copy, rotation, lost-response retry and manual
  distribution. No email sender or delivery provider is required.

## 2. Implement student identity and revocation

**Touchpoints:** new student security/client modules alongside existing admin
security and API clients; `worker.js`; new account integration tests.

**Actions**

1. Add authenticated admin create/list/update/revoke/restore/rotate-link APIs and
   student identity validation API. Student APIs derive the user from the Bearer
   UUID; never trust a client-supplied owner ID. Account creation requires first
   name, last name and graduation year.
2. Hash UUIDs on the server. Return a newly issued link only through authorized
   issuance paths. Reuse admin same-origin checks and static errors.
3. Enforce revocation/link generation in every project/media operation, with a
   final D1 active-user/generation predicate when committing a write. Merely
   authenticating once at request start is insufficient.
4. Preserve the existing country gate, admin session boundaries and public static
   asset manifest. A student credential must never authorize an admin API.

**Verification gate**

- Actual Worker/D1 tests: valid/malformed/unknown UUIDs, revoke, restore, rotate,
  guessed IDs, required account fields and student-to-admin attempts. Exercise the ownership/commit guard
  with seeded resource rows and a minimal test handler before Step 3 adds the
  full project endpoints.
- Hold a guarded write after initial authorization, revoke access, then release
  it; its D1 commit must fail. Repeat against real project/media endpoints in
  Steps 3 and 6 when those operations exist.
- Check issued credentials do not appear in portable exports, logs or error
  responses. Existing backend/admin-security tests still pass.

## 3. Implement account-owned cloud projects

**Touchpoints:** `worker.js`, preferably a focused project API module, D1
migration and existing immutable R2/revision machinery.

**Actions**

1. Add student project list/get/create/update/rename/duplicate/archive/restore,
   revision/media reads, and equivalent admin list/read APIs. Bound and paginate
   summary lists; include owner, timestamps, current cloud revision and status.
2. Preserve stable client-generated IDs for offline-created projects, idempotency
   keys, immutable revisions, conditional `If-Match` and verified object commits.
   Register an unedited new/duplicated project at revision zero.
3. Make first-project bootstrap idempotent per user, not per browser. Reserve one
   project identity/default version and atomically mark successful initialization
   only when the verified document is live. Retry abandoned reservations safely.
4. Make project metadata operations durable and conditional. An offline edit to
   a remotely archived project becomes a preserved recovery choice, not an
   implicit restore. No hard delete or revision pruning is needed for this slice.

**Verification gate**

- Two concurrent first-logins and a lost creation response yield exactly one
  starter project. Returning users and fresh devices see the same project IDs.
  At this stage, drive the APIs through authenticated test clients and a seeded
  default-version fixture; the student login UI is implemented in Step 8.
- Test revision zero, two devices editing one head, list pagination, ownership,
  rename/archive races, replay and duplicate project independence with real D1/R2.
- Admin reads student projects without possessing student credentials; students
  cannot list or read any other user's project or narration.

## 4. Implement the versioned admin default scene

**Touchpoints:** admin editor project/preset controls, a new default-scene service
and API, existing catalogue publication and the starting-project endpoint.

**Actions**

1. Inspect the browser holding the named scene and export its exact latest
   student document plus dependency inventory. Compare it with the verified
   revision-111 cloud copy. Do not silently promote an older backup over newer
   browser work. Preserve a recoverable export before any migration.
2. Add explicit admin **Preview default**, **Set as student default** and version
   information. Distinguish full timeline publication from saving a scene preset
   and from the admin editor's device-local default project.
3. Support publication from the relevant source: a complete student timeline
   must keep its clips; an admin-only scene must use the supported conversion
   pipeline to create a valid starting student document. Do not assume a reverse
   conversion from student sequence to admin project exists.
4. Publish immutable document/dependency versions, verify them, then atomically
   advance the default pointer with a revision precondition. Bootstrap uses a
   pinned pointer/version. Keep the previous default for rollback.
5. Adopt the existing repaired cloud scene as the initial version if it matches
   the intended latest source. Keep the old fixed-key GET as a compatibility
   reader during migration; stop relying on manual bucket writes.

**Verification gate**

- A fresh browser profile with no old IndexedDB/cache renders all four shots,
  framing, lights, poses, environment and LED videos from the hosted assets.
  Use the existing student renderer with a test host/client for the new APIs;
  the final account login flow is verified after Step 8.
- Two students get separate editable copies. Editing either leaves the default
  and other student's project unchanged.
- Interrupted publication leaves the previous default usable. Changing default
  affects only later projects. Admin preview identifies the exact published
  version and all dependencies pass integrity checks.

## 5. Partition local storage and support cloud hydration

**Touchpoints:** `StudentProjectRepository.js`, `LocalNarration.js`, active-project
metadata, recovery/sync records and new identity storage.

**Actions**

1. Use stable internal user IDs to namespace project, narration, recovery, outbox
   and selection state. The repository already accepts `databaseName`; use a
   versioned namespace or equivalently enforced owner keys. Shared immutable
   catalogue bytes may be deduplicated by hash.
2. Add atomic remote-head adoption: install the document and acknowledged cloud
   baseline without creating pending writes. Never overwrite dirty local work
   when a remote head arrives; preserve both and surface the conflict.
3. Retain the existing one-transaction local save and expected-revision checks.
   Add durable metadata operations and identity bootstrap state as needed.
4. Offer explicit legacy import into a chosen account, assigning fresh ownership
   and project identity while preserving original documents and audio.
5. Stop/abort the old account's sync and rendering on account switch; late
   callbacks may not update another account's UI or storage. Namespace the current
   global `sim-trav-review-project` selection.

**Verification gate**

- Native Chromium IndexedDB tests cover upgrade, abort, quota denial, restart,
  cloud hydration, stale remote reads, legacy import and account switching.
- Users A and B in one browser never see each other's private project/audio
  lists. Exercise account switching through a storage/lifecycle harness; a late
  simulated callback cannot reassign or acknowledge B's work. The real upload
  race is repeated with the completed sync service in Step 6.
- Existing 13 storage checks remain valid; adapt fixtures only for explicit new
  contracts, without weakening transaction assertions.

## 6. Complete durable sync and dependency verification

**Touchpoints:** `PrivateDraftBackupService.js`, `DraftApiClient.js`, repository
backup operations, catalogue validation and narration upload/completion APIs.

**Actions**

1. Replace device-draft authority with account authorization while retaining
   durable frozen requests, stable request identity and exact acknowledgements.
   Support revision zero and discovery/download of account cloud projects.
2. Replace blanket dependency exclusion with verification of pinned catalogue
   scene/assets and resumable narration checkpoints. Upload local narration,
   verify its length/hash server-side, then publish the referencing document.
3. Wire a single local-commit notification boundary used by every save path:
   edits, undo/redo, camera checkpoints, new/imported/duplicated projects,
   recording and metadata changes. Do not miss direct repository writes.
4. Sync all pending projects with bounded concurrency and persistent retry.
   Recover on startup, reconnection, focus and explicit Retry; periodically probe
   after a bounded retry cycle so a recovered server is detected even if the
   browser never emits another `online` event.
5. Preserve conflicts as independent recovery copies. Present reopen-cloud and
   save-local-as-copy choices; do not silently merge or replace pending work.
6. Define safe retention/budget rules. Never prune pending/in-flight revisions,
   referenced media or the only recovery copy; bound orphan cleanup and preserve
   old project dependency versions even when a preset is retired.

**Verification gate**

- Extend the actual Worker + native browser sync harness for full scene projects
  and recorded audio. Test dropped responses after commit, restart, N+1 while N
  uploads, aborted local acknowledgement and duplicate requests.
- A fresh browser and the admin can retrieve the exact latest document and audio.
  An acknowledgement for N cannot mark N+1 synced; document-only storage cannot
  claim complete sync while narration/dependencies are missing.
- Verify server recovery without a new `online` event, inactive-project sync,
  cross-device conflicts, credential rotation and revoked-access queue shutdown.

## 7. Prepare the complete student editor for offline use

**Touchpoints:** `studentOfflinePlugin.js`, shared student bootstrap,
`CloudStudentPresetRepository.js`, catalogue/media resolution and existing plate
download/cache services.

**Actions**

1. Make `/student/` the canonical student editor route. Move the engineering
   workbench behind its explicit diagnostic/admin entry. Preserve legacy editor
   query links by normalizing them before boot.
2. Register the worker from shared bootstrap and cache the complete editor's
   required lazy module graph, CSS and decoding dependencies. Extend exact public
   asset manifests without exposing any admin module or review document.
3. Open validated identity/local projects before network refreshes. Persist a
   last-known usable catalogue/default and pinned scene definitions; a failed
   cloud preset list must not prevent cached projects from opening.
4. Prepare required models, environment and selected videos automatically after
   opening a project. Reuse verified plate downloads where possible. Track
   per-project completeness, hash checks, quota failures and evicted assets.
   Show **Ready offline** only after the required inventory is durable.
5. Keep private API responses and credentials out of the public shell cache.
   Keep safe worker update behaviour: no forced reload during unsynced editing;
   an incomplete update retains the previous usable shell.

**Verification gate**

- On the production build, log in and prepare a scene with videos/audio; disable
  networking, reload `/student/`, render and edit all prepared shots, rename and
  create projects from the cached default. Close/reopen and recover exact edits.
  Until Step 8 supplies login UI, seed a validated test identity and use the
  authenticated editor harness. Repeat with actual link navigation in Steps
  8 and 10; seeding is not evidence of the final login experience.
- Test a failed/missing media download and eviction: report incomplete offline
  readiness accurately while retaining project edits and available media.
- Test failed shell updates, header/isolation preservation, identity recovery and
  absence of admin/private-data cache fallbacks. Run the adapted offline browser
  harness against the real editor, not only the workbench.

## 8. Connect student login, autosave and project selection UI

**Touchpoints:** `student/main.js`, `editor/EditorSession.js`, `editor/main.jsx`,
editor styles and new project/auth state modules.

**Actions**

1. Resolve identity before constructing an account repository or starting the
   editor. Show the VP-supervisor message for a missing identity; distinct retry,
   invalid-link and revoked-link states must not create anonymous projects.
2. On first online login immediately open the independent default project once
   its local transaction completes. Prioritize its first visible shot, then
   prepare other media in the background. Network work must not delay later
   cached startup. First-ever offline visits explain that initial validation and
   scene download require a connection.
3. Replace device-only selection with a unified account project picker: cloud
   summaries plus pending local creations, current selection, last modification,
   sync/readiness state and archive access. Preserve IDs while fetching a remote
   project. Add New, Rename, Duplicate, Archive, Restore and Import/Export.
4. Keep flush/pending-recording safeguards when switching projects. Add explicit
   recovery UI and local-save retry/download actions after storage failures.
5. Drive the top bar from separate local-save, cloud-sync and offline-readiness
   state. Renderer loading/playback messages must not overwrite save truth.

| Condition | Required top-bar wording/behaviour |
| --- | --- |
| Edit not yet committed | Saving on this device… |
| Local transaction failed | Not saved on this device — Retry / Download |
| Local commit, network unavailable | Saved on this device · Offline |
| Pending uploads | Saved on this device · Waiting to sync |
| Upload underway | Syncing… |
| Exact latest revision and dependencies acknowledged | Saved to cloud, with last successful sync time |
| Server errors/retry exhausted | Saved on this device · Cloud unavailable — Retry |
| Conflict | Changes preserved · Review conflict |
| Access denied | Access revoked · Local changes retained for download |

Use a local-save icon for local-only states; the current cloud-check icon must
not imply a cloud acknowledgement. Offline readiness is a separate indicator.

**Verification gate**

- Browser tests exercise missing/invalid/valid links, remembered identity,
  first/returning login, online/offline startup and project CRUD across restart.
- Observe every status transition using delayed/failed requests and native
  transaction failures. Switching projects cannot show another project's ack.
- Camera, timeline, presets, recording and undo/redo save correctly with the
  network blocked. Selection/inspection/playback alone creates no authoring edit.

## 9. Deliver admin management and login links

**Touchpoints:** a protected `/admin/users/` entry, admin navigation, new admin
user/project clients, link issuance service and `/admin/users/.../projects/...`
review route. Add entries to Vite builds and keep them out of the student graph.

**Actions**

1. Build a searchable user list showing first name, last name, graduation year,
   active/revoked state and last cloud activity. Require those three identity
   fields on creation. Add create/edit, issue/copy link, revoke and restore
   controls with visible success/failure results.
2. Let admins copy the issued link for manual distribution. Record idempotent
   issuance without claiming that the student received the link. Reissue rotates
   the UUID and invalidates the previous link; safely handle a lost response.
3. Show each user's cloud projects, revision/time and archive status. Label
   these as the latest cloud-synced versions; the admin cannot observe edits that
   remain on a disconnected student's device.
4. Open projects with the student sequence renderer in a read-only admin review
   context authenticated by the admin cookie. Disable all save/upload/edit
   commands at the service boundary, not only buttons. Play videos and narration.
5. Make revocation retain the user's projects for admin access. Rotating or
   restoring access must not transfer ownership or create a new starter project.

**Verification gate**

- End-to-end browser test creates two users with all required fields, copies
  their links, signs in through separate profiles, creates several projects and
  opens them from the admin list. Missing required account fields are rejected.
- Verify a copied UUID link works, a reissued link invalidates the previous one,
  and a lost issuance response can be handled safely. No delivery status is
  claimed for a manually distributed link.
- Revoke a student while editing online and while offline; verify server denial
  after reconnect, retained local edits and continued admin access to cloud work.
- Student access to admin UI/APIs is denied. Admin project review generates no
  document writes, even via keyboard shortcuts or direct session methods.

## 10. Verify integrated failure scenarios

**Actions and verification gate**

Run the full user workflow against the built app and actual local Worker/D1/R2,
including these scenarios. Each needs assertions on durable content, not just
screenshots of successful status text.

| Scenario | Required result |
| --- | --- |
| Same student opens link simultaneously in two clean profiles | One starter project; both see its cloud identity |
| Student edits several projects through an outage and restart | Exact local edits survive; all pending projects eventually sync |
| Server commits a write but its response disappears | Replay confirms one revision; no duplicate project or media |
| New edit occurs while older upload finishes | New edit remains pending until its own acknowledgement |
| Two tabs/devices edit the same project | Conditional conflict; both versions recoverable; no silent overwrite |
| Student switches identity during upload | No cross-account UI, credentials, media or acknowledgement leakage |
| Project is archived elsewhere while offline edits exist | Archive is not silently undone; offline work can be recovered |
| Revocation races a document/media completion | No new authorized cloud head after the revocation commit |
| Missing/changed dependency, audio upload failure | No false complete-sync or offline-ready state |
| Storage quota/blocked upgrade/transaction abort | Clear unsaved state; existing committed work remains intact |
| New shell fails to install | Previous editor still opens prepared projects offline |
| Default changes while a student is creating a project | One coherent pinned version; existing projects unchanged |

Run `npm run test:previs`, storage, backend, sync, relevant editor/offline browser
tests, `npm run build`, and lint on changed files. Update scripts/fixtures for the
canonical route and new ownership model. Retain regression coverage for camera,
presets, driving plates, timeline playback and voiceover. The user selected
Chrome 156 on this Mac as the acceptance browser and hardware target. Record
those results before calling offline support accepted.

## 11. Stage, verify and release

**Actions**

1. Add explicit preview/production configuration for the new account/project API.
   The current draft API has a code-level local/test restriction; changing only
   environment flags will not enable hosted project saving. Keep it disabled
   until this release gate is ready.
2. Back up the live default/catalogue and database state. Apply additive
   migrations, configure D1/R2 and server-only credentials,
   then deploy a preview with the real Pages Functions and all-route middleware.
   Follow `docs/CLOUDFLARE_DEPLOYMENT.md`; preserve isolation headers/manifests.
3. Repeat clean-browser login/default rendering, copied-link access, offline
   reload/edit/reconnect, admin review and revocation against that hosted preview.
   Confirm production remains on its prior deployment during preview verification.
4. Prepare rollback: disable new access/writes and return to a compatible build
   without deleting cloud/local user projects or downgrading their storage schema.
   Keep the previously published default available.
5. Deploy production only within deployment authorization. Re-run the hosted
   acceptance workflow with test accounts, then enable real student link issuance.

**Verification gate**

- Preview has passed the actual user workflow, including complete media/audio
  integrity and offline recovery; no hosted-disabled draft foundation is being
  mistaken for an active project service.
- Production smoke checks pass, rollback is documented and no existing scene or
  catalogue is lost. Test-user cleanup archives records without removing evidence.
- Record deployment URL/version, migrations, test identities (no credentials),
  verification outcomes and the exact tested default version here.

All implementation steps are now verified by the evidence records below. The
baseline and original cloud-copy checks alone did not satisfy later gates.

## Step 1 evidence — verified

- Added `docs/USER_PROJECT_SYSTEM_CONTRACT.md` with the proposed API examples,
  revision and offline state transitions, identity isolation, and login-link
  issuance contract. These describe intended behaviour; the new APIs are not yet
  implemented.
- Added `backend/migrations/0007_student_accounts.sql` and
  `tests/integration/previs/backend.account-migration.mjs`. Miniflare D1/R2
  checks apply the migrations to fresh and populated foundation fixtures and
  verify preserved draft/catalogue data and objects, ownership, bootstrap and
  request constraints, and indexes.
- With Node 22.22.3, `npm run test:previs:backend` passed: 52 tests, 0 failures,
  including both migration fixtures. Output: `/tmp/rayzee-account-step1-backend.log`.
- The original sender/provider gate was superseded by the user's decision to
  distribute copied links manually and require first name, last name and
  graduation year. The revised contract, migration and acceptance criteria now
  reflect that decision. Both migration fixtures and the full backend suite
  were rerun successfully: 52 passed, 0 failed. No email integration is required.

## Step 2 evidence — verified

- Added `backend/src/security/StudentAccounts.js`, Worker routing, and additive
  migration `0008_student_admin_operations.sql`. Account endpoints remain
  local/test-only until the release gate. Admin authentication, same-origin and
  country checks remain in force; student UUIDs are stored only as hashes.
- `npm run test:previs:backend` with Node 22.22.3 passed 56 tests, 0 failures;
  output is at `/tmp/rayzee-identity-backend.log`. The actual Worker and
  Miniflare D1 tests exercise malformed/unknown links, rotation, revoke, restore,
  admin boundaries, ownership and non-disclosure. A test handler holds a write
  after authorization, revokes via the admin API, and confirms the guarded D1
  mutation does not commit. Existing project schema tests reject private sync
  fields; the new identity module does not log credentials.
- Real project and media endpoint races remain to be repeated in Steps 3 and 6,
  as required by those gates.

## Step 3 evidence — verified

- Added `backend/src/projects/AccountProjects.js`, Worker routes and migration
  `0009_account_project_requests.sql`. Local/test APIs now support account-owned
  project creation and revision reads/writes, bootstrap, conditional metadata,
  archive/restore, duplication, admin reads and verified narration reads.
- `npm run test:previs:backend` passed 61 tests, 0 failures (Node 22.22.3;
  `/tmp/rayzee-projects-backend.log`). Actual Worker/D1/R2 tests covered
  concurrent bootstrap and replay, revision zero, competing edits, pagination,
  ownership, metadata races, audio duplication and a real document write held
  across revocation. Lint passed for the changed backend implementation.
- The seeded default used for this gate has no narration. Default narration
  publication/copy remains for Step 4; pinned catalogue verification remains
  for Step 6, and acknowledgements do not claim those dependencies are verified.
- A subsequent held-upload/archive race preserved the archived head but returned
  a generic revision conflict. The response was corrected and the expanded
  backend suite rerun: 62 tests passed, 0 failed. Provisional Step 4 tests were
  temporarily excluded because their endpoints do not yet exist.

## Step 4 evidence — verified

- Exported the open local student scene to
  `.local-runtime/browser-student-default-export-20261102.json`. It is revision
  113 of the same project as the preserved cloud revision 111. The differences
  are one shot's camera transform/target, revision and update time. The user
  selected revision 113 as the intended source. Added a browser audio download
  control and preserved the referenced recording as
  `.local-runtime/browser-student-default-audio-20261102.webm`: 187,741 bytes,
  SHA-256 `88094bff98691e8132708afd7d34eca971d3505d2c423c5ee3a093a6be547491`,
  matching the document inventory. The existing backups remain intact.
- Added the versioned default API, migration `0010_student_defaults.sql`, and
  the admin Student Default Timeline controls. The existing fixed-key reader is
  retained. `npm run test:previs:backend` passed 66 tests; `npm run build` and
  `npm run test:previs -- --reporter=dot` passed (892 tests). The Worker tests
  cover interrupted staging, dependency failures, pinned versions, independent
  starters and narration copies.
- In a clean Chrome 156 profile the chosen timeline rendered all four shots via
  the real student renderer and hosted catalogue/plate assets. The playhead
  advanced from frame 94 to 123 and rendered pixels changed during playback.
  The source has no mapped light objects; shot 4 is dark at its saved 0.12
  exposure. Evidence: `/tmp/rayzee-default-113-render/report.json` and shot PNGs.
- The actual local Worker staged, activated and previewed exact revision 113
  after verifying all nine hosted assets, scene definition and recorded audio.
  Test version `911ebfdc-b03c-4fd4-8283-6b46a3154a52`, document SHA-256
  `49a26fd97c85049f4fe4201976a31463cf5b9bcd4bad54026e51cc8eb0521a5d`;
  evidence `/tmp/rayzee-default-113-publication.json`. A separate clean-browser
  admin test exercised missing audio, preview and conditional publication to a
  local D1 head (`/tmp/rayzee-default-admin-ui-new.log`). No production default
  was changed; hosted adoption remains part of the release gate.

## Step 5 evidence — verified

- Added account-specific project, narration and selection namespaces, validated
  identity registry, lifecycle fencing, explicit legacy import, atomic cloud
  head adoption and a durable metadata queue. Login and real sync integration
  remain in Steps 8 and 6 respectively. Failed legacy imports may leave
  unreferenced copied audio in the selected account; the source is preserved.
- `npm run test:previs:storage` passed in Chrome 156: all 13 original checks and
  five grouped account checks. These cover restart, stale and dirty heads,
  abort/quota, account and audio isolation, direct stale handles and late
  acknowledgements, metadata replay, and verified legacy-audio import. Output:
  `/tmp/rayzee-account-storage.log`. Lint passed for the new storage modules.

## Step 6 evidence — verified

- Added account sync and API clients, durable frozen revision-zero and later
  requests, commit notifications, bounded concurrent retries and discovery,
  verified narration upload/download and catalogue dependency checks. Added
  migration `0011_narration_copy_reservations.sql` and bounded cleanup for
  settled abandoned copies. Pending copies are conservatively retained; a
  crash-stranded pending reservation needs a later safe recovery policy.
- `npm run test:previs:sync` passed the original seven and twelve account groups
  in Chrome 156 against the actual Worker, D1 and R2. Coverage includes full
  scene/audio, lost responses and restart, exact acknowledgements, fresh-browser
  and admin retrieval, conflict, missing/changed dependencies, retry without an
  online event, native acknowledgement abort, rotation, revocation and account
  switching during upload. `/tmp/rayzee-account-sync-final.log` contains the results.
- `npm run test:previs:backend` passed 68 tests, including a held media completion
  across revocation and bounded copy cleanup (`/tmp/rayzee-sync-backend.log`).
  Narration resumes at a durable whole-asset checkpoint: interrupted partial bytes
  are retried as a complete bounded upload, not resumed by byte range.
- No local project, revision, recovery or media pruning is performed; device
  storage may grow. End-to-end metadata replay is not covered by the sync harness;
  its durable queue and exact acknowledgement have native storage coverage.

## Step 7 evidence — verified

- Work in progress makes the student editor canonical, precaches its lazy graph,
  and adds a verified catalogue cache and offline-readiness indicator.
- `npm run build` passed, `npm run test:previs -- --reporter=dot` passed 892
  tests and `npm run test:previs:backend` passed 68. The adapted
  `npm run test:previs:offline` shell test passed in Chrome 156: exact public
  graph, legacy navigation and isolation, private/admin cache boundaries,
  failed installation and a waiting update. `/tmp/rayzee-step7-offline.log`.
- `npm run test:previs:offline:editor` passed against the production build and
  hosted media with a seeded validated test identity and account namespace. It
  rendered and changed exposure on each of four shots offline, checked exact
  committed values, renamed and reopened in a new tab, created from the cached
  default, and verified eviction, a missing download and a failed shell update.
  No browser page errors occurred; the deliberately missing install asset was
  the expected server error. `/tmp/rayzee-real-account-offline-final.log`.
  Initial stricter attempts exposed harness timing and decimal issues; after
  waiting for enabled selection and using valid decimal values the full run
  passed. Actual login-link navigation remains an acceptance check in Steps 8
  and 10. The user subsequently selected Chrome 156 on this Mac as the target
  for Step 10 acceptance.

## Step 8 evidence — verified

- Added link validation, remembered account startup, account workspace and
  sync lifecycle wiring, and a project menu with new, rename, duplicate,
  archive/restore, device import and JSON import/export. Save and offline
  readiness indicators are separate; supervisor access text replaces the
  placeholder sharing promise.
- Production build, lint and 892 previs unit tests passed. `npm run
  test:previs:accounts` passed Chrome/actual Worker checks for missing, invalid
  and valid links, one starter across profiles, remembered offline startup,
  cloud/offline status labels, offline rename/restart, duplication and
  archive/restore. See `/tmp/rayzee-step8-browser.log`.
- The expanded Chrome/actual Worker suite passed 14 groups, including delayed
  acknowledgements across project switches, retry exhaustion and manual retry,
  quota failure, conflict recovery, no-edit selection and account CRUD. A
  production editor offline run covered recording and its quota retry, undo/redo,
  preset, all four shot edits, and no-edit inspection/playback. Evidence:
  `/tmp/rayzee-step8-account-strict.log`, `/tmp/rayzee-step8-strict.log`.
- Fixed the account New flow to use the authenticated pinned default and its
  verified audio, plus mixed cloud/local timestamp sorting. Full backend suite
  passed 68 tests and previs unit suite 894 tests after these changes.
- The final account browser run passed 15 groups, adding explicit observations
  of transient saving and waiting states and the revoked/reconnect export UI.
  The full strict account and offline editor evidence remains at the paths above.

## Shared Cloudflare binding evidence — verified

- Read-only Pages configuration confirms deployed `DB` and `ADMIN_AUTH_DB` use
  `vp-previs-student` (`68cb01ea-7596-4d5e-b2e3-38fb88c59991`) and `LIBRARY`
  uses `vp-previs-library`. D1 currently has migrations 0001–0006.
- Local Vite now uses `backend/wrangler.shared.jsonc` remote bindings through
  `getPlatformProxy`, with the same D1 and bucket. All three R2 binding names map
  to that bucket; object prefixes distinguish catalogue, documents and audio.
  Startup performs a read-only catalogue check and never seeds or migrates.
  The live local server read 18 deployed assets successfully. Tests remain isolated.
- The release below completed the shared account schema, DOCUMENTS/NARRATION
  bindings and hosted activation. Cross-origin exact-document/audio checks passed.

## Step 9 evidence — verified

- Added protected `/admin/users/`, admin navigation, account creation/editing,
  issue/copy/rotation, revoke/restore and latest cloud project lists. Required
  fields and lost issuance responses are handled without claiming email delivery.
- Actual Worker/D1/R2 plus separate Chrome profiles passed two-user creation,
  copied-link login, project lists, online/offline revocation and retained export,
  restore, link rotation and safe replay. Student access to admin routes/APIs is
  denied. `/tmp/rayzee-step9-users.log`, `/tmp/rayzee-step9-private-routes.log`.
- Read-only review rendered four distinct shots, advanced video pixels after at
  least 25 frames and started a verified narration WebAudio source. Keyboard
  shortcuts and service-boundary tests produced no project writes. Evidence:
  `/tmp/rayzee-step9-review-media-final.log` and focused review tests. These are
  local acceptance checks; hosted release remains outstanding.

## Step 10 evidence — verified

- Failure matrix and commands are recorded in `USER_PROJECT_FAILURE_VERIFICATION.md`.
  Target is user-approved Chrome 156 on this Mac. Unit 899, backend 70, storage13+5,
  sync7+13 and account16 groups passed, along with production build and lint.
- Full offline editor run passed after fixing an omitted bundler-generated import
  facade in the shell graph. A regression fixture checks final emitted references.
  `/tmp/rayzee-step10-offline-fixed.log`, `/tmp/rayzee-step10-shell-fixed.log`,
  `/tmp/rayzee-step10-backend-final.log`. No shared cloud data was used by tests.

## Step 11 evidence — verified

- Full D1 SQL export and all 32 R2 object backups are preserved under
  `.local-runtime/shared-cloud-backup-20261102/`. Applied additive migrations
  0007–0011 to `vp-previs-student`. Existing32 objects retain original sizes/ETags.
- Local and both Pages environments now bind DB/ADMIN_AUTH_DB to D1
  `68cb01ea-7596-4d5e-b2e3-38fb88c59991`, and LIBRARY/DOCUMENTS/NARRATION to
  `vp-previs-library`. Hosted account access/writes are explicit; legacy device
  drafts remain disabled. Hosted backend tests passed 73/73.
- Preview `https://12c547c5.vp-previs.pages.dev` passed Chrome 156 hosted account,
  full-scene offline edit/audio recovery, exact sync, admin review and revocation.
  Production stayed on its prior deployment during preview verification.
- Production build `https://198ebc0c.vp-previs.pages.dev` was then deployed to
  `https://vp-previs.pages.dev` with Functions/all-route middleware. Production
  acceptance passed on Chrome 156 this Mac, including full offline recovery, audio,
  exact cloud content, independent accounts, admin review and revocation.
- Cross-origin verification created a test user locally, validated its issued
  production link, bootstrapped from production and compared exact document and
  narration bytes through both local and hosted admin APIs. The results match;
  the test user was revoked. Report: `cross-origin-verification.json` in backup
  directory. Local copied links now use the production student origin.

- Final production deployment ID: `198ebc0c-de89-411a-ac3f-4348c6dc12b1`.
  Exact default: `2e0366c9-c4a0-4620-8a58-8a01dd66ae1e`, source revision 113,
  SHA-256 `49a26fd97c85049f4fe4201976a31463cf5b9bcd4bad54026e51cc8eb0521a5d`.
  Preview and production reports are under `.local-runtime/hosted-check-ReleaseCheck1793591105153/`
  and `.local-runtime/hosted-check-ReleaseCheck1793591347376/`; neither stores
  login credentials in its JSON report. All 79 public student files matched build
  hashes/sizes and isolation headers. Five release-check accounts were revoked
  and their five projects archived, retaining the evidence.
- Final Pages API/local configuration comparison confirms identical D1 and R2
  bindings for local, preview and production. Rollback instructions are in
  `SHARED_CLOUDFLARE_DEVELOPMENT.md`; account flags can disable reads/writes
  without deleting projects or downgrading the additive schema. The prior fixed
  revision 111 default and catalogue objects are preserved.
