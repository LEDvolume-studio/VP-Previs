# Student previs implementation progress

Updated 23 October 2026 (Australia/Melbourne). Implementation is in progress; this is **not a production-ready student release**. No push, release, or hosted deployment has been performed. Admin documents remain `rayzee-project`; student content uses a distinct format and IndexedDB database.

Accepted user answers and retained handling are in [STUDENT_PREVIS_QUESTIONS.md](STUDENT_PREVIS_QUESTIONS.md). The user retained all remaining current handling on 23 October; there is no new question blocking local implementation. The implementation roadmap remains [STUDENT_PREVIS_IMPLEMENTATION_PLAN.md](STUDENT_PREVIS_IMPLEMENTATION_PLAN.md), with requirement/phase comparison in [STUDENT_PREVIS_CHECKPOINT_REVIEW.md](STUDENT_PREVIS_CHECKPOINT_REVIEW.md).

The user subsequently supplied the final Sim Trav UI mockup. The [mockup alignment review](STUDENT_PREVIS_MOCKUP_ALIGNMENT_REVIEW.md) now records where this implementation and plan support it, where the student presentation needs replacement, and which behaviours/capabilities remain missing. The first connected mockup implementation is now available for local review below; technical foundation completion must not be treated as final visual/UI completion. The accepted policy handling remains unchanged; the subsequent acceptance below resolves the mockup-specific interaction questions.

## Accepted next checkpoint

After accepting the mockup alignment review, the user explicitly confirmed **Shot POV** and **Scene inspection**. The first implementation now separates the saved shot camera from an independent inspection camera; inspection movement never writes shot framing. The review's camera-only presets, independent shot cards, visible DOF, named pose assets and timeline requirements are accepted. The plan/questions now record these as decisions, not pending approval. The opt-in editor at `/student/?ui=editor` is the current mockup review build. The default `/student/` retains the engineering workbench while the remaining workflows are connected.

## Current deliverable

Latest authoring checkpoint: [admin preset editor](STUDENT_PREVIS_PRESET_EDITOR.md).
The normal admin right sidebar has a **Presets** tab for loading, updating,
duplicating and renaming full scene presets, with automatic rendered thumbnails.
The student library refreshes shared versions. Production uses Cloudflare D1/R2;
development uses IndexedDB by default. Hosted bindings/migrations and deployment
have not been performed.

Latest renderer correction: [student/admin parity evidence](STUDENT_PREVIS_RENDERER_PARITY.md).
The live review now opens **Studio study · admin appearance** with the authored
SUV materials, HDRI, lights and exposure. Its original study remains saved.
Follow-up: the student-only see-through body defect is fixed by sharing admin's
imported-material depth preparation. The initial comparison omitted that step;
its parity claim is superseded by the corrected regression below.

- Separate `/student/` workspace centred on the interactive Rayzee 3D viewer with native RMB + WASD/QE/Shift/wheel navigation, a settings inspector and rendered scene timeline. Presets, setup selection, cuts and scrubbing apply camera/object/light/pose/LED state in the same viewer. Completed navigation saves one undoable camera command after settling; other forms preserve that live pose. Project create/open/import/download, detached teacher preset copies, placements/durations/order and revisioned undo/redo remain. A labelled development-only studio demo supports local review without a teacher service. Narration, cloud backup, sharing, verified offline media, remaining scene controls and project export remain open.
- Durable native IndexedDB saves commit content, immutable revisions and outbox together. Compare-and-swap prevents silent multi-tab overwrites and preserves attempted conflicting edits as recovery projects. Failed saves retain in-memory work and offer download/retry.
- Built student shell supports offline navigation/refresh after installation and control. Only its exact static dependencies are cached; no models, videos, API, diagnostic, or share content is claimed available offline. An update waits for older editors to close.
- Strict student schema and pure commands/evaluator preserve stable version references, complete core camera/light metadata, fixed 25 fps/1080p output and 22,500-frame maximum. Half-open cuts, LED freeze/play/loop/end rules and narration placement/sample boundaries are tested. New narration uses an independent track; shot edits leave it unchanged. Explicit mixed-selection movement and legacy-anchor detach commands are implemented.
- App-owned transactional shot adapter and concrete Three.js camera/node/light ports support complete-state/version preflight and reverse rollback. Read-only prepared admin conversion now verifies actual asset bytes and explicit node/version mappings, reconciles complete live capture, and rejects unsupported state with structured diagnostics. Real SUV/mannequin saved fixtures and composed welcome LED state now cover explicit UV/nits/media and appearance conversion. A separate `/student/scene/` entry renders 97 actual verified studio/SUV/mannequin/LED meshes through concrete camera/light/pose/environment/media ports. It supports live seek/play/stop and fixture export, with generated media/click audio. Catalogue-backed interactive rendering and basic rendered sequence transport are connected in the main workspace. Live capture controls, remaining scene authoring controls, audio transport and project export remain integration gates.
- `/student/diagnostic/` proves WebGPU raster capture through the existing `RealtimeRenderer`, a hard cut, decoded frozen/advancing LED timecode, click audio, streamed H.264/AAC MP4 output, cancellation, failure and subsequent export. Geometry is an explicit synthetic studio/car/person/door fixture. The default short proof includes GTAO, SSR, bloom and SMAA; `?raw` is available for comparison. It now uses a validated frozen student sequence through the shared preview/export bridge and composites 50% framing bars (4:3 then 2.40:1) into displayed and encoded pixels. See [export evidence](STUDENT_PREVIS_EXPORT.md).

- Isolated local Worker/D1/R2 draft and narration contracts, plus a durable private backup client/service, now have native integration tests. The current student page is not connected to them. Unknown base scenes/media remain pending; hosted operation is disabled.


## Connected mockup review — 23 October 2026

Review link on the running development server: **http://localhost:5173/student/?ui=editor**. It was opened and verified in Chrome. This is a local development review, not a hosted release. The original `/student/` workbench remains available. Fresh development profiles open a verified bundled studio/SUV/mannequin/LED study automatically; existing editor projects reopen from the separate student IndexedDB database. The studio study uses generated LED test media, not the final road plates or teacher catalogue. Production builds do not auto-create demo projects.

Implemented in `app/src/student/editor/`:

- Sim Trav header/project menu, six real rendered camera tiles, persistent native Rayzee viewer, compact shot inspector, full-height desktop layout and bottom horizontal shot/voiceover timeline. Camera presets apply only camera settings. Add shot creates an independent snapshot and placement in one command.
- Shot POV edits the authoring camera. Scene inspection owns a second native camera with its own navigation. Switching modes never copies inspection framing into a shot. Inspection pose survives compatible shot updates/cuts; pending Shot POV movement flushes before a mode switch or another edit. Playback temporarily displays Shot POV and restores inspection on pause/stop without writing project revisions.
- Focal length/FOV, camera height, exposure, standing/sitting and existing light intensity controls use validated commands and local saving. Inspector builders run after pending navigation flushes so height edits preserve the latest camera aim. Local scalar drafts commit once on release/blur. Saved lens values retain their precision even when labels round for display.
- Horizontal rendered shot thumbnails, ruler seeking/frame stepping, play/pause/stop, snapping, zoom, duration adjustment, drag reordering, Add shot and undo/redo. Playback, seeks, edits and project switching share one queue; stale renders cannot overwrite newer selection/state. Navigation failure disables the viewer, and failed local commits retain an explicit unsaved attempt with retry/download/open-latest actions.
- Existing project JSON import/download and device project selection are connected. Saved status says **Saved on this device**. Share/Export dialogs explain remaining work; they do not claim publication or project MP4 export.

**Verified for this review:** full suite **2,176 tests across 149 files**; main engine/app build and isolated previs build pass. Seven native Chrome/WebGPU editor workflow groups plus the production editor startup check pass (`npm run test:previs:editor`): real scene/gallery loading; inspection navigation and mode roundtrip without document writes; camera-only preset and undo; independent Add shot; lens/FOV and duration edit/undo; playback/restoration without revisions; actual Shot POV WASD gesture saved once and undone. Twelve session tests additionally cover in-flight playback cancellation, failed saves, queued commands, stale runtime errors empty documents and correct shot-camera thumbnails during inspection. Full lint passes with the existing 70 warnings and no errors. Five production offline-shell groups and six existing production workbench groups pass after splitting the bootstrap. Offline precaching still includes the lazy workbench's static dependency graph, excluding GPU/model/video dependencies. The query-based editor itself does not claim offline scene availability.

Browser evidence: `/tmp/sim-trav-editor-review/report.json`, `student-editor-initial.png` and `student-editor.png`. Logs: `/tmp/previs-editor-full-unit.log`, `/tmp/previs-editor-build.log`, `/tmp/previs-editor-isolated-build.log`, `/tmp/previs-editor-offline.log`, `/tmp/previs-editor-workbench.log` and `/tmp/previs-mockup-browser.log`.

**Remaining mockup gates:** interior camera/occupant mappings and final media; visible raster DOF; Driving/Relaxed/Reaching assets; verified vehicle door controls; independent narration recording/playback/waveforms; atomic split and source trim with LED continuity; teacher catalogue insertion/custom setup creation in this layout; connected sharing/private backup/project MP4 workflows; verified offline media and the full desktop platform matrix. Disabled pictured controls remain labelled unavailable. The first connected shell/two-camera review slice is ready; the complete mockup and original plan remain in progress. No new user clarification is required, and retained decisions are unchanged.

## Timeline navigation refinement — 23 October 2026

The review editor at **http://localhost:5173/student/?ui=editor** now supports trackpad pinch (Chromium Ctrl+wheel) zooming around the mouse pointer. The timestamp beneath the pointer stays anchored, including on short sequences; ordinary horizontal scrolling continues to pan. The existing zoom slider uses the same scale and keeps its viewport centre anchored. Pinch input is coalesced per animation frame, and thumbnails keep using their existing rendered images as their geometry changes.

Drag the small divider at the timeline's top edge to resize its height. The shot lane and thumbnails expand together, while the ruler, voiceover lane and controls remain visible. Height is bounded to retain space for the viewer; arrow keys adjust the focused divider, Home/End select its bounds, and double-click restores the default. These are session-local workspace controls and create no project revisions or undo entries.

Validation: **726 previs tests across 36 files**, scoped lint and app production build pass. Nine native Chrome/WebGPU editor workflow groups pass, including pointer-anchored pinch without browser page zoom, ordinary horizontal wheel pan, divider/thumbnail resizing, keyboard/reset behaviour and unchanged native IndexedDB content after layout navigation. The existing camera/mode, preset, lens, timeline save/undo and playback checks also pass. Evidence: `/tmp/previs-timeline-browser.log`, `/tmp/previs-timeline-unit.log`, `/tmp/previs-timeline-build.log` and `/tmp/sim-trav-editor-review/timeline-expanded.png`. No new clarification is needed.

## Playback keyboard shortcut — 23 October 2026

Space now starts/pauses timeline playback at the current cursor in the review editor. A capture listener consumes keydown and keyup so focused presets, shot cards, buttons and checkboxes cannot activate accidentally. Held-key repeats toggle only once. Text/number inputs, editable content, native selects, dialogs, project menus and modified shortcuts retain their normal keyboard handling. The transport button exposes the Space shortcut in its tooltip and accessibility metadata.

Ten native editor workflow groups pass, including Space with focused preset/shot controls, repeat suppression, input-field exclusion and unchanged saved project state. Scoped lint and app production build pass; logs are `/tmp/previs-space-browser.log`, `/tmp/previs-space-lint.log` and `/tmp/previs-space-build.log`.

## Phase status and evidence

| Phase | Status | Evidence / remaining gate |
| --- | --- | --- |
| 0: baseline | Local regression evidence established; intermittent admin startup remains open | After OneDrive hydration: 57 targeted admin tests passed. Latest core run: 2,139 tests across 145 files; full build passes. Full lint passes with 70 pre-existing warnings after excluding generated dependency backups. Hardware admin smoke renders the 67-mesh scene and opens camera/pose panels, but repeat development-server runs intermittently stall at BLAS 66/67. See the final investigation record below. Two saved LED files need reconnecting in a fresh browser. Git dirty inventory still exceeds the bounded timeout. |
| 1: raster/media feasibility | Short, synthetic-long and actual-scene-long proofs passed locally on base M5; full release matrix pending | Chrome 155/macOS 26.6.1: 250-frame GPU export with post stack and exact frozen/advancing decoded LED timecodes. Synthetic 22,500-frame stream, cleanup and retry pass. Independent FFmpeg verifies every video timestamp and all 900 audio clicks within one frame. Host is now identified as base Apple M5 (Mac17,2, 10 CPU cores, 16 GiB RAM). Actual bundled 97-mesh scene exported all 22,500 frames in 450.06 s with stable tracked GPU counts; teacher-media/narration, independent GUI players, Edge/Windows and complete native/GPU process memory profiling remain pending. |
| 2: domain and shot contracts | Core contracts, prepared converter and preview/export bridge implemented | Strict v1 format; independent narration/group edits; immutable commands; complete camera/light ports; verified-byte admin converter with explicit LED presentation and raster appearance; real bundled scene loader; native pose deformation/door transforms; full concrete GPU A/B/A and latest-seek cancellation. Published supported node mappings and selected-shot rendering are connected; simplified saved-shot forms are connected; remaining authoring controls and supported custom-base-scene creation remain. See [conversion](STUDENT_PREVIS_PRESET_CONVERSION.md), [domain](STUDENT_PREVIS_DOMAIN.md) and [bridge](STUDENT_PREVIS_THREE_BRIDGE.md). |
| 3: separate frontend and local saving | Working local foundation | Native IndexedDB 13-check integration harness; built Chrome UI six workflow groups; offline built-shell harness. Completed native camera gestures save after deceleration and 120 ms settling; in-gesture periodic checkpoints and an active-writer lease remain absent. Transaction preconditions already protect conflicts. |
| 4: private draft backend | Local foundation tested | Thirty-seven real backend integration groups pass: fourteen draft/media D1/R2 groups, nine password/country/Pages security groups and fourteen catalogue/supported-scene groups, including the actual compiled all-route middleware and 600,000-iteration hosted password verification. Local migrations and Wrangler dry-run pass. Shared-password admin sessions, Pages static-route protection and Australia-only trusted-edge checks are implemented locally; hosted activation/security operations remain gated. See [backend evidence](STUDENT_PREVIS_BACKEND.md). |
| 5: private backup | Reference-free local integration tested | Seven combined Chromium IndexedDB + actual Worker/D1/R2 groups pass. Exact frozen requests, lost create/update responses, local ack transaction abort, newer edits and genuine remote conflict recovery are covered. Unknown scene/media references remain pending. No frontend/hosted backup or private recovery UI. See [sync evidence](STUDENT_PREVIS_SYNC.md). |
| 6: presets and R2 catalogue | Local publishing, supported mappings, prepared publishing screen and student copy path implemented | Protected API registers bytes and atomically commits immutable v2 scene definitions/presets. Shared GLB preflight, prepared read-only admin capture service, review/upload/publish/hide screen and exact-operation retry are implemented. Separate browser proof covers actual D1/R2, cookie protection and supported scene pictures. Live editor capture/draft/thumbnail UX, broader asset capability and hosted delivery remain. See [supported scenes](STUDENT_PREVIS_SUPPORTED_SCENES.md). |
| 7: shot authoring/offline media | Interactive Rayzee scene viewport, durable forms and prepared reuse | Native visible-canvas CameraManager supplies the existing WASD/mouse controls. Setup selection verifies published scene/media and applies complete saved state. Camera position/aim/FOV/exposure/framing, root-object position, standing/sitting, light intensity and LED mode/in-point/loop/nits use durable commands and undo/redo. No model/media reload for compatible updates. Door/rotation/add-light/source-picker controls, supported custom-base-scene path, continuous checkpoint measurement and verified offline media remain. |
| 8: timeline/transport | Main interactive viewer now driven by rendered transport | Timeline selection, scrubbing, frame steps, play/pause and stop use the same viewport and frame evaluator. Cuts apply full camera/pose/door/light state and local LED time. Compatible cuts reuse prepared scene/media; playback creates no authoring revisions. Bounded playback waits for each render and skips late preview frames against wall time. Production narration/audio clock, buffering UX, longer drift/performance measurement and the remaining platform matrix remain. |
| 9–10: narration/share | Not implemented | Narration record/evaluation contracts exist; no microphone recorder/uploads/viewer. |
| 11: export/packages | Diagnostic foundation only | Streamed MP4 pump is not connected to student projects. JSON is reference-only and embeds no media or editing credentials. No production export/package/offline-media claim. |
| 12: release/pilot | Not reached | Matrix/real-school-machine/runbooks/backend operations remain. |


## Checkpoint review after the user answers

The plan's **first useful checkpoint was reached locally**: initial admin baseline,
short post-processed raster MP4 with a hard cut/frozen and advancing decoded LED
frames/synchronised audio, plus the synthetic 15-minute bounded-stream proof.
The host has now been identified as the requested base M5. The current admin repeat investigation below remains open. The **entire Phase 1
release gate remains open** for teacher media/narration, remaining browser/OS/player
acceptance and full native/GPU process memory measurements. The actual bundled
scene long export has now passed locally; see the later delivery record.

That implementation slice added prepared admin-to-student conversion, shared
evaluator-to-raster transport, and accepted narration/framing behaviour.
Exact pixel checks and twelve decoded H.264 comparisons confirm
the 50% bars. Current short proof and independent FFmpeg evidence are in
`/tmp/student-previs-answers-framing-20261022/` (250 frames, 1.66 s encode,
1,413,607 bytes, exact timestamps, 21.354 ms click onset delay). Source revision
remains local/uncommitted; HEAD is `c0e1f886f769d1296a0e99842967957dc633b7a6`.

Australia-only checks apply to hosted network requests using trusted country
metadata. Previously downloaded offline content remains local. No deployment,
password provisioning, account creation or catalogue publication has occurred.

## Reproduce locally

Use Node 22.22.3 on this machine:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v22.22.3/installation/bin:$PATH"
npm run dev:previs
# Open /student/ or /student/diagnostic/ on the displayed local origin.
npm run build:previs
npm run test:previs
npm run test:previs:storage
npm run test:previs:browser
npm run test:previs:soak
# Separate local backend dependencies, once:
npm --prefix backend ci
npm run test:previs:backend
npm run test:previs:sync
```

UI harness: start a Vite or production preview server and set `STUDENT_TEST_ORIGIN` if not `http://127.0.0.1:5177`. Offline harness takes `STUDENT_BUILD_DIR=app/dist-previs-diagnostic` and creates its own static server. Browser paths can be selected using `CHROME_PATH`. No browser installation is performed by these harnesses.

The normal `npm run build` now builds admin, `/student/` and `/student/diagnostic/` as separate Vite entries. `build:previs` is an isolated proof build in `app/dist-previs-diagnostic`; it does not replace the admin output. Both preserve isolation headers in configured local serving; hosted headers still require the deployment verification gate.

Independent media verification (external FFmpeg executable required):

```sh
python3 tests/browser/previs/verifyRasterMedia.py /path/to/raster-10sec.mp4 --frames 250 --ffmpeg /path/to/ffmpeg
python3 tests/browser/previs/verifyRasterMedia.py /path/to/synthetic-15min.mp4 --frames 22500 --ffmpeg /path/to/ffmpeg
```

Use `--frames 250` / `--frames 22500` (separate argument and value). The script streams decoded frame diagnostics and one-second PCM blocks and enforces one-frame audio tolerance. It is independent of the Mediabunny writer/reader. It does not install packages.

## Recorded media findings

The final short GPU proof uses the full existing raster post stack. The synthetic 15-minute run rendered exactly 22,500 frames in 82.14 seconds, writing 23,935,202 bytes to device-backed storage. Native video queue maximum: 4. AAC worker maximum: one pending encode command and 4,096-byte PCM blocks. Sampled JS heap peak: 55.28 MB; after test GC, retained JS heap was 12,152,860 bytes before and 12,359,840 after. This is not total native/WASM/GPU process memory profiling.

Native Apple AAC initially measured 44.02 ms late and failed the 40 ms target. Pinned `mediabunny@1.62.0` and `@mediabunny/aac-encoder@1.62.0` now give 21.354 ms onset delay. Independent FFmpeg verified every timestamp in both files and all 10/900 clicks, with no measurable drift. AAC tail padding is 26.67 ms/32 ms respectively, within one frame. No real samples were removed and no guessed platform offset is used.

Detailed evidence, limitations and primary references are in [STUDENT_PREVIS_EXPORT.md](STUDENT_PREVIS_EXPORT.md). Current artifacts are outside Git at `/tmp/student-previs-verified-20261022/`; earlier diagnostic experiments remain separately named. Temporary artifacts may be removed by machine cleanup and are not committed.

## Merge-sensitive changes and next actions

Engine changes remain localized to `RealtimeRenderer`: optional fixed physical output sizing; explicit prepared environment replacement/clearing; stable light-proxy/shadow/target identities across synchronization. Native light parameters, power conversion, canonical state and shadow-slot reassignment are regression-tested. App-owned mannequin pose application preserves GPU attribute identity. Normal admin APIs remain compatible; no upstream upgrade was bundled.

App build changes add distinct HTML entries and generated student-only shell caching. Student services do not import admin stores or `appProxy`, and the existing admin hydration operation is not used at cuts.

Next concrete actions: wire live admin capture controls to the prepared publication service; extend authoring to door/rotation/light/source selection and supported custom scenes; extend rendered transport with audio/buffering acceptance and verified offline media. Camera/object/human-pose/light/LED forms, native WASD navigation and basic rendered timeline transport now share the retained viewport and durable authoring path. The prepared publishing screen, trusted supported scene resolution and main-workspace selected-shot pictures are now implemented. Keep the full Phase 1 platform gate pending. Remaining storage/platform/tail handling was retained by the user on 23 October; hosted data stays disabled, the full browser matrix remains, and narration past the last shot stays preserved but inactive.

## Delivery verification and handoff

Previous checkpoint core suite: **1,613 tests across 123 files passed** (5.86 s). The current answer-alignment run below supersedes this count. This includes the regression that stops replay when an unchanged local acknowledgement cannot commit. Main engine/app MPA build and full lint pass; the remaining 70 warnings are in unchanged pre-existing files. Backend adds 14 real D1/R2 test groups, storage adds 13 native browser checks, sync adds seven combined browser/backend groups, student workflow adds six groups and offline shell adds five groups. These are different test types, not one inflated aggregate count.

The private capability creation flow intentionally differs from the original suggested server-returned secret: the device generates/persists it before requesting a draft. This, AAC selection and other implementation choices are recorded in [STUDENT_PREVIS_DECISIONS.md](STUDENT_PREVIS_DECISIONS.md).

No production student scene authoring/teacher publishing/narration/share/project export UI is being claimed complete. The separate engineering scene viewport is described below. Local API/storage proofs do not establish hosted security, retention, quotas, disaster recovery or target-machine acceptance. User answers have now superseded the earlier provisional narration/authentication/framing choices. Remaining narrow policy/UX clarifications are recorded separately.

Previous checkpoint commands/results: `npm test` passed; `npm run build` passed; `npm run lint` passed with the 70 known warnings. `npm run test:previs:backend` passed 14/14 groups; `npm run test:previs:sync` passed seven groups; current production-MPA UI passed six groups. Native storage passed 13 checks, and the production-MPA offline shell passed five groups. Final logs are `/tmp/rayzee-previs-finished-*.log`, `/tmp/rayzee-previs-final-*-ready.log` and `/tmp/rayzee-previs-delivery-*.log`.


## Answer-alignment delivery verification — 22 October 2026

- **Core:** `npm test` passed **1,679 tests / 126 files** (6.54 s).
- **Build:** `npm run build` passed for the engine and all app entries. Existing
  large-chunk warnings remain. Actual production public-edge manifest independently
  matches all seven files byte-for-byte (SHA-256 and size).
- **Lint:** `npm run lint` passed, zero errors and the same 70 pre-existing
  warnings. Generated `backend/dist-pages/**` is now excluded, just like existing
  build output; the initial traversal failure was generated bundle code.
- **Backend:** `npm run test:previs:backend` passed **23/23 groups** (3.05 s),
  including actual D1/R2, shared-password sessions, Australia-only checks,
  packaged Pages middleware, asset fallback/alias protection and strong verifier.
  See [security contract](STUDENT_PREVIS_ADMIN_SECURITY.md). Hosted activation is
  still off; the existing live site has not acquired these protections.
- **Native browser:** storage **13 checks**, sync **7 groups**, current built
  student UI **6 groups**, offline shell **5 groups** passed. The UI now verifies
  custom-shot creation/undo/redo as one atomic local revision.
- **GPU/media:** new shared-evaluator short diagnostic, exact 50% Canvas2D
  samples, twelve decoded H.264 framing comparisons, LED timing, DPR/cancel/
  failure/retry and cleanup passed on Chrome 155 / base M5. Independent FFmpeg
  again passed all timestamps and audio tolerance. The existing synthetic
  15-minute proof remains valid; a real representative scene long run is pending.

Current logs: `/tmp/rayzee-previs-answers-final-{unit,build,lint,backend,ui,offline,sync}.log`.
GPU and independent-decoder reports: `/tmp/student-previs-answers-framing-20261022/`.
Scoped tracked-file whitespace checks pass. Git status still exceeded a bounded
10-second attempt; no unrelated changes were discarded. No push, release or
hosted deployment was performed.

The studio/LED/appearance and actual-scene transport slice below supersedes this
previous handoff boundary. The next product integration is trusted teacher catalogue
and main student scene authoring. Do not
activate whole-project online-backup/share claims for unverified scene/media.


## Actual scene slice — 22 October 2026

Implemented a versioned LED presentation without reinterpreting legacy content:
explicit nits, immutable mapped display node, native UV channel/bounds/mirroring,
normalized rectangle placement/rotation/fit metadata and blank wall handling.
Optional raster appearance preserves the existing admin post stack, real tone/
background controls and independent lighting settings. Path-only settings such
as saturation are explicitly classified rather than added as an invented grade.
Prepared conversion compares saved/live fields and verifies supplied media bytes;
unknown teacher file identities cannot become verified catalogue assets.

A byte-verified loader supplies real local studio, SUV, mannequin and LED assets
with complete glTF-index node mappings and cleanup on cancellation/partial failure.
`/student/scene/` is a separate private engineering route in the normal MPA build,
linked only when bundled fixture assets are available. It wires actual Three
camera/settings/light managers, model transforms, real mannequin vertex/normal
poses, authored door hinges, prepared environment and deterministic LED service.
The main student workspace's honest local-only scope remains unchanged.

Short GPU proof: all 97 meshes render, A/B/A changes/restores actual geometry and
complete snapshots; green frozen and yellow advancing LED frames are visible;
50% guides survive H.264 encode; preview races/Stop/prepare failure, export cancel,
injected failure/cleanup error, retry and temporary-file cleanup pass. See
[real scene](STUDENT_PREVIS_REAL_SCENE.md), [loader](STUDENT_PREVIS_SCENE_LOADER.md),
[appearance](STUDENT_PREVIS_RASTER_APPEARANCE.md) and
[LED service](STUDENT_PREVIS_LED_RENDERING.md).

The real browser harness exposed ~35 MB retained JS growth per export. Fixes keep
raster light/shadow identities and owned mannequin BufferAttributes stable. The
warmed short rerun now has 3,562,084 bytes retained JS growth, unchanged GPU
attribute/program/texture/uniform counts and passing strict memory/retry checks.
Reported renderer allocation counters total 529,298,262 bytes; this is not total
browser/native/GPU residency. Short artifacts:
`/tmp/student-previs-real-scene-memory-fixed-20261022/`. Independent FFmpeg also
passes all 250 video timestamps and ten audio clicks (21.354 ms onset delay).

The 22,500-frame **actual** scene export passed with generated click audio:
450.06 seconds to encode 900 seconds / 605,057,501 bytes. Independent FFmpeg
verifies every timestamp and all 900 clicks (21.354 ms constant delay, 32 ms
padding). Sampled JS peak was 167,797,303 bytes; forced-GC retained JS increased
by 3,789,968 bytes (72,340,328 → 76,130,296) over the warmed long run. Tracked
renderer resource counts stayed unchanged; total tracked allocation was
529,298,262 bytes. This is not total process/native/GPU memory profiling.
Artifacts: `/tmp/student-previs-real-scene-20261022/`. Production microphone narration, independent GUI players, Edge/
Windows/macOS matrix, hosted delivery and true offline media remain open.


## Current slice verification

`npm test`: **1,821 tests / 132 files passed** (7.83 s). Full engine/app MPA build
and isolated proof build pass; current production student edge manifest matches
all seven public graph entries by exact bytes/hash and excludes engineering
routes. Full lint passes with zero errors and the existing 70 warnings. Backend
passes 23 groups; combined browser/backend sync passes seven, and current offline
shell passes five. Student UI passes all six groups when run separately; its
initial parallel timing run timed out during the transport endpoint check and
was rerun successfully without a product change.

The real-scene short and long hardware-GPU browser harnesses both pass, including
actual visual/pose/door/LED/frame checks, preview races, state restoration,
encoder/backpressure limits, failures/cleanup/retry and strict warmed retained-
heap limits. Independent FFmpeg passes both the 250- and 22,500-frame files.
A complete acceptance claim still requires the recorded remaining matrix and
production narration/teacher-media work.

Current logs: `/tmp/previs-real-scene-complete-{unit,build,lint,proof-build}.log`,
`/tmp/previs-real-scene-soak.log`, `/tmp/previs-real-scene-ffmpeg-long.log`,
`/tmp/previs-real-scene-ui-isolated.log`, and the backend/offline/sync logs with
`/tmp/previs-real-scene-final-` prefix. No push, release or hosted deployment.

Final sequential production-output rerun also passes all six student UI groups
and all five offline-shell groups. Logs:
`/tmp/previs-real-scene-handoff-{ui,offline}.log`. Explicit tracked-file whitespace
checks pass; the final bounded Git status still times out after eight seconds.

### Admin repeat investigation

The normal admin origin `http://127.0.0.1:5187` passes hardware WebGPU startup,
67-mesh Welcome Project restoration and camera/pose-panel checks in 2.870 s.
A subsequent run passes, but another stalls at **Building BLAS 66/67** until the
120-second limit, with no page errors or failed requests. The remaining worker
is `BVHWorker.js`; this is before raster rendering. Source inspection finds no
dependency on the changed `RealtimeRenderer` during this build, but does not
establish the actual cause. The worker pool has no task deadline/message-error
diagnostics; no speculative scene-processing change was made.

The smoke harness now records bounded worker message headers on failure, without
recording triangle payloads, and accepts a bounded load timeout. After adding
that observation, four consecutive runs pass, including three sequential repeats
in **3.055 / 2.814 / 3.316 s**. These passes do not resolve the earlier intermittent
stall. Keep deterministic admin startup as an engineering follow-up before
release. Logs: `/tmp/previs-admin-investigate.log`,
`/tmp/previs-real-scene-admin-repeat{1,2}.log`,
`/tmp/previs-admin-worker-evidence.log` and
`/tmp/previs-admin-evidence-repeat{1,2,3}.log`.

A separate temporary-cache experiment failed React runtime interop because its
cache path lacked the `/node_modules/` segment required by the existing local
runtime script; it is not evidence of a normal-build application regression.
The final smoke harness passes scoped lint. No engine/BVH workaround was added.


## Plan review and catalogue continuation — 23 October 2026

Reviewed the original R1–R12 requirements and all phase gates in
[STUDENT_PREVIS_CHECKPOINT_REVIEW.md](STUDENT_PREVIS_CHECKPOINT_REVIEW.md).
The useful local checkpoint remains reached; the complete student workflow and
release gates remain open. Original release checkboxes were not marked complete
merely because supporting modules exist. The user retained all current handling:
no invented hosted retention/quotas/residency promise, hosted data routes disabled,
Chrome/Edge on Windows/macOS retained, and narration beyond the final shot
preserved/recoverable but inactive.

Continued Phase 6 locally:

- Strict immutable preset/catalogue contracts include complete assets/base scene,
  snapshot, descriptive metadata, default duration and optional pinned thumbnail.
- Shared-password-protected library upload verifies actual SHA-256/length and
  R2 storage before registration. Atomic D1 publication binds immutable preset,
  base-scene identity, monotonic catalogue head and replay-safe receipt together.
  Concurrent publish/hide operations use head-revision preconditions. Hidden
  historical versions and their registered bytes remain resolvable.
- Public reads expose available summaries and exact pinned versions, with strong
  ETags/304 and raw single-range asset delivery. JSON claims never authorize
  arbitrary URLs or overwrite a registered immutable identity. Byte verification
  does not establish glTF node/material support or actual media duration/codec.
- The main student workspace explicitly loads/refreshes its teacher library.
  Revalidating, bounded, credential-free read client rejects malformed content
  and identities. One `addPresetShot` command copies dependencies, an independent
  shot and default placement in a single local revision/undo step; conflicts and
  the 22,500-frame limit fail without mutating saved work.
- Actual built Chrome UI + native IndexedDB + actual Worker/D1/R2 prove publication,
  update and hide without a frontend rebuild. Metadata is escaped, old copied
  versions stay unchanged, undo/redo includes all dependencies, offline reload
  restores copies, and catalogue failure never changes truthful local-save status.

Verification: **1,874 tests / 134 files**, full engine/app MPA build, isolated
proof build and full lint pass (zero errors, the same 70 existing warnings).
Backend **31 groups** pass: existing 23 plus eight catalogue groups. Final native
browser runs pass **five catalogue**, **six student UI** and **five offline**
groups. Production public-edge manifest independently matches all **seven** entries
by exact bytes/hash. Scoped/new-file whitespace checks pass. Bounded Git status
still times out at eight seconds; unrelated work was preserved.

The combined native browser/private-backend sync regression also passes all
seven groups. Wrangler applies migrations 0003/0004 successfully to the existing
local development database; no remote database was touched. Logs:
`/tmp/previs-catalogue-final-sync-20261023.log` and
`/tmp/previs-catalogue-local-migration-20261023.log`.

Logs: `/tmp/previs-catalogue-full-{unit,lint,backend}-20261023.log`,
`/tmp/previs-catalogue-final-{build,build-previs,catalogue,ui,offline}-20261023.log`.
Worker dry-run and catalogue-specific integration evidence are in
[STUDENT_PREVIS_CATALOGUE_BACKEND.md](STUDENT_PREVIS_CATALOGUE_BACKEND.md).
Reproduce the native catalogue proof with `npm run build` then
`npm run test:previs:catalogue`; it provisions only ephemeral local test data and
serves the built workspace itself.

No additional renderer/scene-processing change was made in this slice. The
intermittent admin BLAS startup finding remains open from the preceding record;
the long GPU export was not needlessly repeated for catalogue-only changes.
Teacher capture/draft/preview/publish UI, validated model-node mappings and
media preflight, catalogue-backed main viewport/controls and verified offline
media remain next integration work. The new API/client path is not a complete
Phase 6 or production authoring release. Private draft dependency acknowledgements
remain conservative; the student page still makes no cloud backup/share/project
MP4 claim. No real credentials, push, release or hosted deployment were used.


## Supported publication and main-workspace pictures — 23 October 2026

Continued the next Phase 6/7 dependency from the plan review. Preset v1 remains
readable; v2 adds a complete URL-free immutable scene definition. Shared DOM-free
GLB preflight checks actual model hierarchy/node names, human pose samples, LED
mesh/UV capability, embedded resource bounds and decoded accessor allocations.
Migration 0005 atomically registers definitions with publication receipts and
rejects concurrent conflicting definitions. The strict catalogue client resolves
scene identity and verified asset bytes rather than imported URLs.

Prepared admin capture now composes the existing authoritative converter with
byte/mapping verification and revision/binding guards; unsupported authored fields
still produce diagnostics. `/admin/student-presets/`, linked from Projects, reviews
prepared v2 JSON and exact files, validates model/video support, uploads, publishes,
refreshes current head and hides/restores availability. It uses the existing admin
session. **Live editor capture is not yet exposed by a button**; prepared operations
are held in the open publishing tab, not a cross-restart journal.

The main student workspace now offers **Preview shot**. It lazily creates an
independent raster viewport from a registered supported scene and the saved shot,
uses native camera/light/pose/LED ports and the existing post stack, and displays
its saved start frame with 50% framing bars. It neither writes a project revision
nor claims rendered timeline playback. Closing/editing/switching cancels and drains
old work; missing media leaves saved content intact and repaired bytes permit retry.
A teardown failure prevents another preview until reload.

Hardware proof on Chrome 155/base M5 renders the actual 97-mesh fixture through
published D1/R2 assets in a separate anonymous student context. Both standing/
closed/frozen-green and seated/open/yellow-start-frame shots match independent
fixture images with mean sampled RGB differences below **0.07 / 255**. A separate
admin context publishes through the new screen, retries an actually committed
publication after its response is dropped, and hides/restores availability. Every
retry retains the same body/key/precondition and produces one immutable commit.
No student edit revision is created by preview, cancellation or media failures.

The initial final-artifact byte comparison caught Vite rewriting lazy preload code
after manifest hashing. The plugin now uses an explicitly post-ordered generation
hook. Final built bytes are independently verified by the native offline harness.
The normal MPA has **26** exact public graph entries, including **15** online-only
lazy dependencies; the shell precaches **10** entries. Publisher JS and admin/
engineering HTML remain private. This authorizes application code only, not offline
models/videos. See [supported scenes](STUDENT_PREVIS_SUPPORTED_SCENES.md).

Current verification: **2,017 tests / 141 files** pass (7.79 s); full engine/app MPA
and isolated proof builds pass; full lint passes with the same 70 warnings and
zero errors. Backend **37 groups** pass, including actual all-route middleware,
public lazy/private publisher asset classification and six new supported-scene
groups. Built student UI **six**, catalogue **five**, offline **five** and combined
browser/backend sync **seven** groups pass. Local migration 0005 applies cleanly;
no remote database was touched. GPU/publication proof has **five** native groups.
Detailed artifact and protected-edge rerun results follow this record.

Logs: `/tmp/previs-supported-complete-{unit,lint,backend,proof-build,catalogue,ui,offline}-20261023.log`,
`/tmp/previs-supported-final-{build,sync,migration,publication}-20261023.log`.
GPU images/report: `/tmp/student-previs-supported-publication-final-20261023/`.
No shared engine/core or BVH processing change was made. The previous intermittent
admin BLAS startup remains an open engineering issue. The 15-minute export was not
repeated for this selected-frame integration; its earlier evidence remains scoped
as recorded. No push, release, real credential use or hosted deployment occurred.

The final protected-delivery GPU rerun also passes all five groups through the
**actual all-route Pages middleware** serving final built assets. Separate cookie
jars keep admin and student contexts isolated; anonymous dynamic imports pass the
exact final byte gate, while publisher/engineering routes require the session.
Both previews match the reference at **0.0589 / 0.0634** mean sampled RGB channel
difference. The committed-response-loss and hide/restore flows pass, including
browser-level repeated PUTs retaining identical request identity/content. Final
report/images: `/tmp/student-previs-supported-edge-20261023/`; log:
`/tmp/previs-supported-edge-browser-20261023.log`. This is local Miniflare delivery,
not verification of a deployed Cloudflare site. The current built catalogue/UI/
offline reruns also pass after the post-order manifest fix.


## Saved-shot authoring and viewport reuse — 23 October

Continued Phase 7 after the original-plan checkpoint review. The main student
workspace now provides completed Apply forms for camera position/target/FOV,
exposure/framing, mapped root-object position, standing/sitting human pose,
existing light intensity, and LED freeze/play/in-point/loop/nits. Detached pure
helpers preserve all unexposed state, authored roll/focal length on exposure-only
edits, and arbitrary saved LED microseconds when the frame field is unchanged.
Each edit uses complete-document validation, one native IndexedDB transaction and
one undo step. All placements sharing the shot use its updated snapshot.

The preview is hidden while saving. Failed saves retain attempted values and
disable forms until retry/recovery; successful saves update the picture only
after commit. Preview failures remain separate from save status. Compatible
updates reuse the same canvas, model objects, GPU renderer and media decoders.
Immutable prepared inventories and concrete port checks reject incompatible
updates. Frozen evaluator revisions are replaced under a serialized operation
queue; cancellation drains before teardown, and failed updates restore the
previous successful shot/frame or explicitly require reload if rollback fails.
Unchanged LED configurations reuse material/texture/canvas objects while still
staging exact source times transactionally before changing any displayed wall.
No shared engine or normal admin code changed in this slice.

Verification on Chrome 155/base Apple M5:

- Full unit suite: **2,117 tests / 143 files** pass. Full engine/app build and
  isolated proof build pass. Full lint has zero errors and the same 70 existing
  warnings; scoped authoring/runtime lint is clean.
- Built native student UI: six workflow groups pass, including native storage
  failure, offline local edits, JSON import/download and two-tab recovery.
- Built offline-shell and actual D1/R2 catalogue suites: five groups each pass.
  The offline harness independently verifies final public asset hashes.
- Expanded actual all-route Pages/D1/R2/GPU proof: **eight groups** pass. It
  retains prepared publication/receipt-loss/cancellation/missing-media checks,
  then exercises every new form, copied-source isolation, undo/redo pixel
  restoration, 12 repeated UI edits with the exact same canvas and no further
  catalogue/model/video reads, failed native save/retry, and exact reload.
- Direct final public viewport module: 24 alternating revisions restore exact
  pixels after an unchanged revision. Tracked resources remain identical:
  98 geometries, 89 textures, 64 programs, 22 render targets, one decoder and
  504,988,216 tracked bytes. This is not total browser/native/GPU residency.
  Invalid inputs and an aborted queued update preserve the previous picture.
  First-frame versus immediate same-frame rendering differs by only
  **0.0020335 / 255 mean RGB**; the first unchanged revision has exactly that
  same difference. This isolates the tiny variation from document updating;
  subsequent alternating revisions have no accumulating drift.

Artifacts: `/tmp/student-previs-shot-edits-release-check-20261023/` includes the
actual workspace PNG and full report. Logs: `/tmp/previs-shot-edits-final-unit-20261023.log`,
`/tmp/previs-shot-edits-final-build-20261023.log`,
`/tmp/previs-shot-edits-proof-build-20261023.log`,
`/tmp/previs-shot-edits-final-lint-20261023.log`,
`/tmp/previs-shot-edits-ui-20261023.log`,
`/tmp/previs-shot-edits-final-offline-20261023.log`,
`/tmp/previs-shot-edits-final-catalogue-20261023.log` and
`/tmp/previs-shot-edits-release-check-gpu-20261023.log`. Earlier exploratory
runs remain separate and are superseded by this final passing run.

The expected initial local checkpoint remains reached; full original phase
gates remain open. This adds actual authoring to R2/R3/R7 and storage-failure
evidence for those completed controls under R11. It does not complete Phase 7:
door/rotation/light creation/source-picker controls, supported custom-base-scene
creation, live admin capture UX, rendered sequence transport and verified
offline media remain. Continuous drags are not introduced, so no drag checkpoint
crash-window claim is added. The intermittent normal admin startup issue and
remaining platform/teacher-media/narration acceptance remain open. No new
clarification is required under the retained decisions. Nothing was pushed,
released or deployed.


## Renderer parity correction — 23 October 2026

Investigated the reported SUV texture, window, reflection and harsh-lighting
mismatch against an actual exported admin project. The raster engine was already
the same class; the original local diagnostic study omitted HDRI and authored
per-primitive material restoration and used different lights/exposure.

Admin and student now use one shared material state helper. Student snapshots
optionally preserve validated mapped embedded-material state, including normal
orientation, glass opacity and UV transforms, with transactional restoration and
owned material/texture clones. The supported viewport now verifies and decodes
bounded versioned HDR/EXR environments using the admin float loaders. Shared
RealtimeRenderer initializes area-light LTC resources for both hosts. See
[renderer comparison](STUDENT_PREVIS_RENDERER_PARITY.md) for exact integration
points and remaining limits.

The development demo uses actual admin revision 276 appearance values. An explicit
copy action upgrades old diagnostic studies without overwriting the originals.
The user's current **Studio study · admin appearance** is open, rendered and saved
on this device at http://localhost:5173/student/?ui=editor. Its three placements,
shot cameras and authored timing were retained. The screenshot is
`/tmp/sim-trav-renderer-parity/student-editor-review.png`.

Final validation:

- **2,192 unit tests / 151 files pass**, including material restoration/isolation,
  preflight rejection, actual HDRI float-byte equality and shared area-light inputs.
- Full engine/app build passes. Full lint has **zero errors / 70 existing warnings**.
- Native WebGPU admin-style loader versus student production viewport comparison
  passes at 1920 × 1080 with **0.018446 / 255 mean absolute RGBA channel error**.
  Edge outliers remain; this is equivalent output within a measured tolerance,
  not bit-identical output. Inputs include the same 69 SUV meshes, camera,
  authored materials, HDRI, lights and post settings.
- Native editor browser proof: **10 workflow groups pass**, including timeline
  pinch/resizing, Space transport, independent inspection, presets, authoring,
  local saves, undo and playback. Built offline-shell proof: **five groups pass**.
- Final logs: `/tmp/previs-parity-final-{unit,build,lint,gpu,editor,offline}.log`.
  GPU report and images: `/tmp/sim-trav-renderer-parity/`.

The engine-parity correction does not complete the original plan or final visual
acceptance. The demo retains its own studio/LED test clip and object placements;
those differ from the user's complete admin scene. General live admin capture
and publication still need explicit converter mapping for the newly supported
materials/HDRI, and student DOF, final driving media/poses and other previously
listed gates remain open. No new question is required under retained handling.
Nothing was pushed, released or deployed.


## Student-only SUV body translucency — 23 October 2026

The user correctly reported that the preceding appearance correction still let
other meshes show through solid body panels. Actual model/material audit confirms
both hosts use the same SUV GLB, all exterior paint texture alpha pixels are 255,
all nine exterior paint primitives have opacity 1, and only six window primitives
have opacity 0.06. The problem was native depth preparation, not opacity leaking
between mesh bindings.

Admin always runs GeometryExtractor material preparation, which enables depth
writing even for glTF BLEND materials. Student skipped extraction and retained
glTF's depthWrite=false, allowing later geometry to draw over opaque body texels.
The pre-existing admin policy (present since the monorepo restructure) is now a
small shared RasterMaterialPreparation helper called by GeometryExtractor and the
verified student loader. The change preserves authored alpha, opacity and glass
blending and applies to existing saved studies on load without document migration.

The former GPU reference also skipped admin extraction, so the preceding parity
claim did not cover the actual admin preparation path. The corrected reference
runs real GeometryExtractor.extractMaterialsOnly. It reproduced the defect before
the fix (0.785474/255 mean RGBA difference), then passed after the fix
(0.009144/255). A failing-then-passing real SUV loader test also checks all69 mesh
depth flags, all nine solid paint primitives and exactly six transparent windows.
New shared helper tests preserve alpha maps and opacity for both paint and glass.

Final verification: 2,194 tests / 152 files pass, full engine/app build passes,
scoped lint and diff whitespace checks pass. An initial full-suite run concurrent
with the build hit import/hook timeouts; the subsequent full run passed all tests.
The live saved student project was visually checked with opaque body panels and
transparent windows; no project edits were needed. Screenshot:
`/tmp/sim-trav-renderer-parity/student-depth-review.png`. Logs:
`/tmp/previs-car-depth-unit-before.log`, `/tmp/previs-car-depth-before.log`,
`/tmp/previs-car-depth-unit-after.log`, `/tmp/previs-car-depth-gpu-after.log`,
`/tmp/previs-car-depth-final-unit-retry.log`,
`/tmp/previs-car-depth-final-build.log`, `/tmp/previs-car-depth-final-lint.log`.
No new questions, push, release or deployment.


## Admin preset editing and Cloudflare persistence — 23 October 2026

Implemented the requested Presets tab in the normal admin right sidebar. It lists
existing scene presets with thumbnails, opens a selected preset as a separate
admin editing project, captures current edits as a new revision or independent
new preset, and supports renaming. Native camera projection is restored after
admin sensor hydration, preserving saved framing. The initial six development
camera choices now have complete editable admin and student scene records.

Saving captures supported live camera/lens/exposure, object/hinge transforms,
standing/sitting human poses, embedded material state, canonical lights, verified
HDRI and available LED media/time/placement. Explicit byte/version/node mappings
and rendering validation reject unsupported state before committing. The capture
accepts admin's exact snorm16 attribute packing without treating real geometry
edits as valid. An actual student viewport renders the automatic JPEG thumbnail.
Navigation and LED playback are restored even when capture/save fails. Scene or
project changes during asynchronous preparation reject the capture. Uncertain
cloud saves retain the exact prepared request/thumbnail/bytes/revision guard and
have an explicit retry action, preventing duplicate new presets after lost replies.

The student's camera tiles refresh names, cameras and thumbnail revisions without
writing its project. A tile remains camera-only. The distinct Use scene preset
button adds a complete detached shot and retains all existing shots. Fresh hosted
students can start a project from a published preset. Existing scene and asset
versions remain resolvable after the library changes.

The user's subsequent Cloudflare requirement is implemented, not deferred to a
browser-only design: production selects CloudAdminPresetRepository and
CloudStudentPresetRepository. Cloudflare D1 stores names, immutable revisions,
portable state and protected editing documents; R2 stores immutable verified
binary files and thumbnails. Migration 0006 and the existing catalogue operation
triggers atomically commit the editing revision and public student preset/head.
The deployed student uses only public catalogue routes, polls every 15 seconds
and refreshes on focus. The admin list uses compact summaries and loads a full
scene only when selected, so six substantial scenes do not exceed the default
JSON list bound. Local development remains a separate shared IndexedDB library,
with cross-tab notifications. Production never silently falls back to it.

Verification:

- Full unit suite: **2,254 tests / 159 files pass**. Full engine/app build passes.
  Full lint: **zero errors / 70 existing warnings**. Scoped whitespace check passes.
- Native actual admin/student GPU browser workflow: **four groups pass**, covering
  preset selection/full scene hydration/framing, camera edit/save update/automatic
  thumbnail, live student refresh, rename and independent Save as new.
- Expanded student GPU editor browser proof: **12 groups pass**, including actual
  cross-tab name/thumbnail changes with unchanged existing student content and
  full-scene preset insertion as a detached new shot.
- Native IndexedDB/BroadcastChannel library checks: **seven groups pass**,
  including immutable history, compare-and-swap races, actual quota failure,
  complete rollback and historical scene resolution.
- **44 backend tests pass** with actual Miniflare D1/R2. These include the actual
  cloud admin/student clients uploading a bundled GLB and automatic thumbnail,
  save/rename/student reads, protected document privacy, stale writes, receipt
  replay, injected trigger rollback, historical scenes and compact listing.
  Production-strength password verification plus explicit hosted preset-only
  activation is tested while private draft routes remain disabled.
- Actual Pages Functions compilation passes. Built offline-shell result is
  recorded in `/tmp/previs-preset-editor-release-offline.log`.

Logs: `/tmp/previs-preset-editor-release-{unit,lint,build,offline}.log`,
`/tmp/previs-admin-presets-browser-final-proof.log`,
`/tmp/student-cloud-factory-editor-browser.log`,
`/tmp/previs-preset-backend-tests.log`.
Visual proof: `/tmp/sim-trav-admin-presets/admin-presets.png` and
`student-presets.png`; report is alongside them. Earlier exploratory native runs
exposed seed/capture integration mismatches and are superseded by the final
passing workflow. The live user admin Presets tab was opened with its original
scene retained; no test presets were written into the user's project library.

Workflow: STUDENT_PREVIS_PRESET_EDITOR.md. Deployment bindings, migrations,
explicit activation flags, D1 row bounds and preset-only configuration:
../backend/PRESET_EDITOR.md. No hosted migration/activation or deployment was
performed; initial hosted catalogue population remains an explicit release data
step. No credentials were read, and nothing was pushed or released. The original
plan remains in progress: driving poses/media, visible DOF, narration, Share/MP4,
remaining platforms and hosted acceptance are still separate gates. No new
clarification is needed under the accepted decisions.

### Project-owned preset correction — 23 October 2026

The previous independent-project edit workflow is superseded by the user's clarified
model: one project owns the complete setup; many presets store transforms and
visibility within it. Admin selection no longer calls ProjectSession.hydrate or
creates an editing project. Scene objects, geometry, materials, HDRI, LED video and
GPU resources stay alive. Changed transforms use the existing refit API; visibility
uses the existing visibility-buffer update. Presets are scoped to project links
persisted in project extensions and associated with their project in published D1
records. Compatible legacy transforms can be adopted without loading their scene.
Student insertion now rejects different scene versions and retains current project
resources while applying preset transforms. The initial scene still loads once
when opening/creating a project. No deployment or credential access was performed.

Validation for the correction: **2,258 tests / 160 files pass**, targeted lint is
clean, and engine/app production builds pass. Actual admin GPU browser checks pass
for project/resource identity retention, save/update/new/rename, automatic
thumbnails and live student refresh. Instrumenting the renderer backend confirms
**zero render-pipeline compilations** across repeated preset switches; measured
switch calls were **3/3/3 ms** in the final run (hardware-specific observations).
The student editor's **12 browser groups pass**, including project-resource
retention during preset-shot insertion. Logs: `/tmp/project-presets-browser.log`,
`/tmp/project-presets-student-browser.log`, `/tmp/project-presets-full-tests.log`,
`/tmp/project-presets-final-lint.log`, `/tmp/project-presets-build.log`.

### Student preset object-state correction — 23 October 2026

The student thumbnail handler still had the old camera-only behavior. It now uses
one shared preset-state application function for both updating the selected shot
and adding a preset shot. This copies existing node transforms/visibility, door
positions, light transforms/targets and camera framing, while retaining project
asset bindings, materials, media, environment and human pose geometry. The edit
is one replaceShot command and undoes atomically without touching other shots.
Student UI wording now says Scene presets and describes the full state application.

Legacy student scenes and newer admin exports may have different scene/instance
IDs despite identical GLBs. Their nodes are mapped by verified model SHA-256,
byte length and glTF node index, retaining the loaded scene identity and GPU
viewport. Unknown models, missing nodes and ambiguous repeated model instances
are rejected before committing. No scene/model import fallback was added.

Validation: 2,261 tests / 161 files pass and production engine/app builds pass.
Native student browser checks verify moved car and human state, changed rendered
pixels with a fixed camera, retained viewport identity and atomic undo (13 groups).
Logs: /tmp/student-preset-state-{full-tests,build,browser,lint}.log.

The native admin-to-student roundtrip also passes: move both real admin model roots,
save the preset with its thumbnail, receive it in an already-open legacy student
scene, click its tile and verify both mapped root transforms, unchanged base scene
and identical canvas. Admin switching still compiles zero render pipelines.
Evidence: /tmp/student-preset-admin-roundtrip.log. No deployment was performed.

### Preset light intensity, position and visibility — 23 October 2026

Added intensity to lightweight project-owned light state. Admin selection restores
it on the existing light alongside position/target and visibility. Older lightweight
states omitted intensity but their immutable admin documents already captured it;
selection recovers that saved value, preserving explicit zero. Student preset-tile
application and preset-shot insertion now apply saved intensity as well as their
already supported light transform/visibility. Light identities/types, other project
resources and existing shots remain intact. No shader/engine changes were needed.

Validation: 2,263 tests / 161 files pass. Native admin browser checks move a light to
[4,7,3], set intensity 37 and hide it, save its preset, switch away/back, and verify
all three fields on the original light. The already-open student view receives and
applies those fields while retaining its scene and canvas. Student browser groups
also pass, including applying and undoing light/object state together. Tests cover
visible zero-intensity lights, hiding/revealing, legacy recovery and retaining
other shots. Logs: /tmp/preset-lights-{admin-browser,student-browser,full-tests,build,lint}.log.
No deployment or credentials were accessed.

### Local student voiceover recording and timeline editing — 23 October 2026

Connected the existing narration domain schema/commands to local MediaRecorder
capture, a separate IndexedDB audio store, and Web Audio sequence playback. Record
starts at the playhead, plays the scene while silencing existing narration, and
stops/saves on request or at the sequence end (15-minute ceiling). The complete
container is decoded for exact sample metadata and SHA-256-pinned before the
project receives its clip reference. New take asset+placement is one undoable
project revision. No audio is uploaded.

The Voiceover track now supports pointer move, left/right source trims, keyboard
move/trim, delete and Undo/Redo. Shot placements also have delete controls. A
failed local file write retains the take for explicit retry/discard without adding
a dangling placement. Completed files/metadata survive reload; source bytes remain
available for Undo/Redo after clip deletion. JSON exports explicitly identify the
omission of recorded audio. The guide is STUDENT_PREVIS_VOICEOVER.md.

The actual Chrome fake-microphone browser suite passes eight groups: recording
and native byte persistence; reload; keyboard trims/move; pointer drag/trim;
observed Web Audio source scheduling; delete/undo; injected native IDB quota-style
write failure with retry; shot delete/undo. The existing student editor's 13 browser
groups also pass. Evidence: /tmp/voiceover-browser.log,
/tmp/voiceover-editor-browser.log and /tmp/sim-trav-voiceover/{report.json,voiceover.png}.
Unit tests cover source bounds, playback offsets/cancellation, permission denial,
one-revision capture/undo and failed-file-save semantics. Current full suite:
2,272 tests / 162 files pass. Production build passes; final lint is recorded in
/tmp/voiceover-full-lint.log. Logs also include /tmp/voiceover-{full-tests,build,lint}.log.

Original Phase 9 remains partial: incremental crash recovery, waveforms, gain/mute
and device/count-in UI, mixed selection, upload/resume, full-duration memory/drift
and real microphone/platform checks remain open. No claim of crash recovery for
an unfinished take: its bytes are held in memory until Stop. No user microphone,
credentials or deployment were accessed during automated tests.

### Prepared student playback cuts — 23 October 2026

Compatible shots now retain the live scene and GPU resources during playback.
The session caches its evaluator per immutable document, avoids redundant
view-mode renders, and retargets the existing sequence without restoring the
editing baseline or drawing an intermediate frame at each cut. Shot application
skips unchanged material/environment state while continuing to apply camera,
object, light, pose and LED state transactionally.

Before the playback clock starts, the viewport verifies and opens upcoming LED
videos and warms each upcoming shot's GPU variants offscreen. The visible preview
stays unchanged. Warming tracks individual shots so starting midway and later
returning to the beginning also prepares unseen states. The transport may show
**Preparing playback…** once before starting; microphone capture starts after
preparation so that warmup does not record leading silence.

LED video/brightness/placement changes reuse the wall's material, texture and
canvases. Decoders retain up to four prepared source frames each; playback warms
the next cut's inpoint ahead of time and avoids decoding the same source time
twice. Verified encoded media retains the existing 128 MiB viewport budget.
Different base scenes or media beyond that budget retain the safe reload fallback;
this work targets the accepted single-project, positional-preset workflow.

Native Chrome/WebGPU regression uses two distinct verified videos, tests
preparation from mid-sequence followed by the beginning, checks the visible frame
for flashing, and asserts stable geometry/LED resource identities with no asset
fetches or render-pipeline compilation during prepared cuts. See
`npm run test:previs:playback-cuts` and
`/tmp/previs-playback-cuts-report.json` for measured timings on this machine.
These timings are observations rather than a cross-device performance guarantee.

Validation: **2,279 tests across 162 files pass**, production engine/app build
passes, and full lint reports no errors (70 existing warnings). The native editor
13-group regression and voiceover eight-group regression pass; voiceover was
rerun after playback preparation was moved ahead of microphone capture. Logs:
`/tmp/previs-cuts-{full-tests,full-lint,build,browser,voiceover-browser}.log`.
The original implementation plan remains in progress. No new clarification is
needed; retained decisions are unchanged. No deployment was performed.
