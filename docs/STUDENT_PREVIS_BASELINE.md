# Student previs baseline — 21 October 2026

This report records actual observations from the implementation session. A blocked collection or source read is not a passing test and is not evidence of an application assertion failure. The wider implementation handoff is [STUDENT_PREVIS_PROGRESS.md](STUDENT_PREVIS_PROGRESS.md); product questions are in [STUDENT_PREVIS_QUESTIONS.md](STUDENT_PREVIS_QUESTIONS.md).

## Source and runtime

- Repository: `rayzee-renderer/`; sibling `Cadra/` was not modified.
- Starting HEAD: `c0e1f886f769d1296a0e99842967957dc633b7a6` (`docs(assets): archive editable rigs and portable pose examples`). Prior local commits include `1df6c289` (pose controls/renderer workflows), `85b3825f` (agent guidance), `4709aad2` (Unreal camera navigation fix), and `2f1e2e87` (upstream v8.4 merge).
- `AGENT.md`, deployment guidance, plan, manifests and Vitest config were read. The runtime script's metadata is readable (1,870 bytes), but reading its contents timed out twice after 12 and 8 seconds; `git show HEAD:scripts/dev-local-runtime.mjs` also timed out after 8 seconds. The script was not executed without inspecting it.
- Node was initially absent from the shell PATH. Adding `$HOME/.local/share/fnm/node-versions/v22.22.3/installation/bin` gives Node **v22.22.3**, npm **10.9.8**. The local dependency installation resolves Vitest **4.1.4**; manifests declare Vite `^8.0.0`, Vitest `^4.1.2`, Three `^0.186.0`, and engine package version `8.4.0`.
- Root `node_modules` already points to `/Users/mitcha/.local/share/rayzee/3d-editor-runtime/node_modules`, outside OneDrive. No dependency reinstall or upstream upgrade was used for baseline tests.
- No credentials were printed or included in copied sources. No push, release or deployment was performed.

## Worktree and OneDrive limitations

`git status --short --untracked-files=no` timed out after 15 seconds. `git ls-files -m` timed out after 8 seconds. Consequently, the starting dirty-file set is **unknown**, not clean. A bounded `git ls-files --others --exclude-standard` succeeded before implementation and listed `docs/STUDENT_PREVIS_IMPLEMENTATION_PLAN.md`. Existing files were preserved.

`git log -5 --oneline` and `git rev-parse HEAD` succeeded, but history narrowed to renderer paths timed out after 15 seconds. This is not a complete shared-engine history audit.

A source-copy attempt used 24 workers with a four-second bound per file and recorded SHA-256/size for each successful copy. It excluded `.git`, dependencies, `.local-runtime`, builds, coverage/caches, `.env*`, and token-named files. Of 594 candidates, **351 copied and 243 failed** in 34 seconds. Temporary location: `/tmp/rayzee-previs-baseline-20261021`; machine-readable evidence: `COPY_MANIFEST.json` in that directory. This temporary copy is incomplete and must not be presented as a runnable, verified snapshot.

Failures include most pre-existing test sources, `app/index.html`, `app/src/main.jsx`, `App.jsx`, `store.js`, styles, `rayzee/vite.config.js`, several workers and benchmark files. Source-file size/listing availability does not prove its bytes are locally readable. Successful copies include most engine and app services, enabling inspection without repeatedly reading OneDrive.

A second bounded pass copied **380 / 599** candidates and failed 219, in 17 seconds. The count increased because implementation files appeared during parallel work; this is not an immutable baseline archive. Some test sources became readable after initial access, but the admin bootstrap/config remained blocked. The manifest now describes that second pass. `ls -lO app/src/main.jsx` reports `compressed,dataless`; `ProjectSchema.js` and subsequently its test source have locally available bytes.

## Automated checks

Commands ran from the repository root with the Node 22 PATH above.

| Command | Actual result |
| --- | --- |
| `npx vitest run tests/unit/app/projectSchema.test.js tests/unit/app/projectSession.test.js tests/unit/app/projectSessionUndo.test.js tests/unit/app/undoManager.test.js` | Initial **exit 1**: 4 collection failures, 0 tests, `ETIMEDOUT`, 46.81 s. Rerun after partial materialisation: **exit 1**, 2 suites passed / 2 failed, **18 passed / 6 skipped**, 15.09 s. Schema and undo tests passed; project-session import depends on unreadable `Constants.js`, yielding one import timeout and one 10-second `beforeAll` timeout. |
| `npx vitest run tests/unit/app/ledVideoManager.test.js tests/unit/app/mannequinPoseService.test.js tests/unit/app/mannequinPoseRefit.test.js tests/unit/app/vehicleDoorPoses.test.js` | **PASS**: 4 files / **28 tests**, 1.01 s. |
| `npm run lint` | **Exit 2**; ESLint 9.39.4 reports `ETIMEDOUT: connection timed out, read` from `readFileHandle/readAndVerifyFile`. No reliable complete lint result. |
| `npm test` | **Exit 1**, 7.03 s: **29 files passed / 84 failed** (113), **300 tests passed / 23 skipped** (323 discovered). All failed-suite diagnostics are read `ETIMEDOUT` errors; sources or imports never completed. This run does not establish assertion failures in those unread suites. |
| `npm run build` | Not yet run. The baseline copy is incomplete, including the engine Vite config and admin HTML/bootstrap. Do not use a synthetic replacement as proof of the existing admin build. |

## Fixtures and browser acceptance

Available inventory by readable file metadata includes `app/public/vehicles/mid-suv/mid-suv.glb`, `app/public/characters/mannequin/mannequin-presets.glb` and the existing Mercedes model. Metadata alone does not verify a fixture opens or renders. No representative admin scene has yet been opened/rendered during this baseline, and no real student recordings were used.

The successful local copies were also parsed as GLB v2 containers; declared lengths match actual bytes and JSON scene chunks decode. This checks structure, not rendered appearance:

| Fixture | Bytes / structure | SHA-256 |
| --- | --- | --- |
| `app/public/vehicles/mid-suv/mid-suv.glb` | 19,432,020; 20 nodes, 17 meshes | `38bdd5dcbf6be692ecf8dd7d6c0bca44c060234836fa8eba012e979eed9597bc` |
| `app/public/characters/mannequin/mannequin-presets.glb` | 1,787,740; 71 nodes, 1 mesh | `a494718adecba5ac662b199af944de2d60368bc3f8498c7664c82d400624bf12` |
| `app/public/models/mercedesmayback.glb` | 8,840,360; 91 nodes, 35 meshes | `9192378ea4492194de40775f9bcc68b923b1e1e9722668e7d4338259be456c73` |

`app/src/data/default-scene.json` parses with five assets, 128 node records, one camera, zero explicit lights and three LED wall records. It references a 57,086,205-byte rural-road video by local filename/asset ID and saved positions. That reference is not a timecoded, bundled, reproducible teacher-video fixture and cannot establish online/offline video availability. The full representative acceptance fixture still needs to be captured.

The plan requires a studio/car/two pose states/distinct camera and light setups/timecoded teacher video plus synthetic audio. A synthetic diagnostic can establish export mechanics, but cannot establish fidelity of that representative admin fixture. Keep those acceptance claims separate.

Chrome is available on this macOS host. Edge and Windows testing, real-GPU admin regression, cross-origin delivery/Range/isolation checks, 15-minute drift, and representative school-hardware memory/performance remain pending. Browser automation should use existing Puppeteer tooling and report software rendering separately from target hardware.

## Raster appearance inventory from source

This is a source inspection, not visual equivalence testing. It includes the narrow explicit-size raster branch introduced in this session; other features below existed before that change.

| Area | Existing path and practical limit |
| --- | --- |
| Depth of field / focus | `CameraManager._captureEffects/_applyEffects` retain aperture, focal length, focus distance, DOF mode/blur, scale/anamorphic settings and autofocus configuration. `RenderSettings` routes these to path-tracer uniforms; `TSL/CameraRay.js` applies the lens model. `RealtimeRenderer._initPostProcessing` has **no DOF pass**: GTAO/denoise → SSR → emissive bloom → SMAA. Persisted DOF therefore does not prove raster blur. |
| Exposure / colour | `PathTracerApp` initialises the shared renderer tone-mapping mode and exposure. `RenderSettings.handleExposure` writes `renderer.toneMappingExposure` when auto-exposure is disabled; Three applies this inside tone mapping, so `NoToneMapping` ignores it. The raster branch returns before path-tracer pipeline rendering; path-pipeline automatic exposure must not be assumed to adapt in raster. Deterministic export needs explicit, stable exposure and verified output colour. |
| Framing / masks | Sensor utilities use a fixed 16:9 gate. `FrameRatioOverlay.jsx` renders 4:3/2.40:1 bars as DOM `bg-black/55` elements over the canvas; `Viewport3D.jsx` mounts this separately. Canvas capture **does not include those guides**. Decide whether exported 1080p imagery includes a deliberate framing treatment; do not infer it from the editor overlay. Camera projection/aspect must be set independently of UI resizing during export. |
| LED picture / brightness | `LEDVideoManager` composes video into a canvas using saved placement, creates an SRGB `CanvasTexture` with explicit UV channel/transform, and assigns the display's emissive map. Brightness maps as `nits / 100`; material is tone mapped. Compositing is capped at a longest dimension of **2048 pixels**, so its texture resolution is independent of final 1080p framing. Frozen frames and advancing frames share the raster texture identity. |
| LED illumination | Raster bloom shows bright emissive surfaces and SSR can reflect visible screen content. No LED-generated area-light proxy or screen-driven diffuse GI is present in `LEDVideoManager` or `RealtimeRenderer`. The screen's light spill on a car/person cannot be assumed equivalent to path-traced emissive lighting. This needs a product decision if required for launch. |
| Lights / environment | Raster mirrors canonical light transforms and targets into proxies, converts power/exposure/temperature, synchronises environment intensity/background/rotation, and uses selected shadow casters (maximum four lights). AO and SSR depend on scene bounds/screen visibility. These approximations need real-scene comparison; they do not establish path-traced parity. |
| Existing seeking | `LEDVideoManager.seek` assigns a clamped `video.currentTime` and returns without a completion promise. Deterministic offline export needs a separate decoded-frame readiness boundary rather than assuming that method completes the seek. |

Source anchors: `rayzee/src/managers/RealtimeRenderer.js`, `CameraManager.js`, `rayzee/src/RenderSettings.js`, `rayzee/src/PathTracerApp.js`, `rayzee/src/TSL/CameraRay.js`, `app/src/services/LEDVideoManager.js`, `app/src/components/layout/Viewports/FrameRatioOverlay.jsx`, and `app/src/utils/cameraSensor.js`.

## Retry after OneDrive download — 21 October 2026

The following checks ran after the user reported that most files had downloaded. They verify the **current implementation worktree**, including new student modules and the narrow raster renderer change; they are not a reconstructed pre-change baseline. Sources were being edited by other agents during this session. The original observations above remain historical evidence.

- HEAD remains `c0e1f886`; `git -c core.fsmonitor=false log -8 --oneline` completed. Even with fsmonitor disabled, `git status --short` exceeded a bounded **20-second** subprocess timeout. The starting dirty-file set therefore remains unknown. No destructive Git operation was attempted.
- Admin project/session/undo plus LED/pose/door tests now all collect and pass: **8 files, 57 tests**, 887 ms. Command: `node node_modules/vitest/vitest.mjs run tests/unit/app/projectSchema.test.js tests/unit/app/projectSession.test.js tests/unit/app/projectSessionUndo.test.js tests/unit/app/undoManager.test.js tests/unit/app/ledVideoManager.test.js tests/unit/app/mannequinPoseService.test.js tests/unit/app/mannequinPoseRefit.test.js tests/unit/app/vehicleDoorPoses.test.js`.
- `npm test`: **PASS**, exit 0, **116 files / 1,497 tests**, 16.22 s. Coverage: statements 68.67%, branches 59.8%, functions 67.28%, lines 68.97%. Log: `/tmp/rayzee-previs-retry-test.log`.
- `npm run build`: **PASS**, exit 0, engine 1.40 s and admin app 3.22 s. Vite reports large chunks and time spent in React/worker plugins. This does not establish a built `/student/` entry or browser asset delivery. Log: `/tmp/rayzee-previs-retry-build.log`.
- `npm run lint`: **INCOMPLETE**, exit 2: ESLint 9.39.4 still reports `ETIMEDOUT` while reading a file. Log: `/tmp/rayzee-previs-retry-lint.log`.
- A narrower lint run completed across `app/src/previs`, the student diagnostic, previs unit/browser tests, `RealtimeRenderer.js` and its test. It found **64 formatting errors**, all fixable, in the domain schema/commands, sequence evaluator and evaluator tests. Export, media, diagnostic, persistence and the raster renderer passed this invocation. Formatting fixes and subsequent verification belong to the implementation handoff; do not treat this intermediate result as final lint status. Log: `/tmp/rayzee-previs-retry-targeted-lint.log`.

All retry commands used Node 22.22.3 via `/Users/mitcha/.local/share/fnm/node-versions/v22.22.3/installation/bin`. No package installation was needed.

## Export lifecycle review

The proof streams fragmented MP4 to an OPFS writable in 1 MiB chunks, encodes one video frame and one 1,920-sample mono PCM block at a time, awaits each encode, and closes each submitted audio sample. `DecodedLEDSource` closes retrieved samples in `finally`, rejects stale seek completions with a generation counter, and disposes its input. This is useful source evidence for bounded ownership, but does **not** replace the required measured 22,500-frame soak or prove native decoder/encoder memory bounds.

Review identified lifecycle concerns and sent them to the implementing agent: returning an OPFS `File` after deleting its backing entry; writable cleanup on codec/preflight failure before the exporter `try`; ensuring diagnostic UI unlocks if file cleanup fails; and avoiding a restore error obscuring the original export failure. Final fixes and browser evidence are tracked in [STUDENT_PREVIS_PROGRESS.md](STUDENT_PREVIS_PROGRESS.md).

## Baseline gate

Phase 0 is **partial**. Admin unit regressions and both builds now pass on the current worktree. Full lint still encounters source I/O failure, the pre-change dirty-file set is unknown, and representative real-GPU admin/browser acceptance remains required. The initial incomplete temporary copy must not be promoted to a verified baseline archive.

## Real WebGPU admin smoke — 22 October 2026

The normal admin Vite configuration was launched from `app/` on `http://127.0.0.1:5183`; the isolated student proof configuration was not used. `tests/browser/previs/adminBaseline.browser.mjs` opened the bundled Welcome Project in a disposable Chrome profile with `--enable-unsafe-webgpu`, resolved the engine through `import('/src/lib/appProxy.js').getApp()`, and waited for the project store to leave its loading state before checking two animation frames and capturing a screenshot. Initial engine readiness alone is insufficient: the project can still be downloading its environment afterward.

Final result: **PASS**, Chrome **155.0.8059.85**, approximately **7.9 seconds**, at **09:36 AEDT**. The renderer was `WebGPURenderer` / `WebGPUBackend`; the adapter reported vendor **apple**, architecture **metal-3**, and **isFallbackAdapter: false**. The Welcome Project reached `saved`, with no loading failure, **67 meshes**, one restored perspective camera, and raster mode active. The captured viewport was visually inspected: car, studio geometry, floor and LED surfaces rendered. Camera and Poses tabs opened successfully; the camera panel displayed its lens/sensor/framing controls, and the pose panel offered adding a mannequin. No scene content, camera settings, pose state, or account was changed. This is an admin raster startup/control-panel smoke, not a path-traced parity or pose round-trip test.

Two saved rural-road video references were unavailable in the fresh profile (`missingMedia`, permission `denied`); the viewport and LED panel clearly displayed reconnect-file placeholders. Those saved handles do not constitute bundled playable media. The final run had **zero application page errors** and **zero failed asset requests**. The harness blocked analytics and non-read HTTP methods. Earlier camera-tab attempts encountered stale Vite optimized dependency URLs for the Radix toggle modules (HTTP 504); restarting this test server with `--force` rebuilt the development cache and the final run passed without source changes.

Reproduce with Node 22 on PATH:

```sh
cd app
../node_modules/.bin/vite --config vite.config.js --host 127.0.0.1 --port 5183 --strictPort --force
# In another terminal, from the repository root:
ADMIN_EVIDENCE_DIR=/tmp node tests/browser/previs/adminBaseline.browser.mjs
```

Evidence: `/tmp/rayzee-admin-baseline-ready-report.json` and `/tmp/rayzee-admin-baseline-ready.png` (temporary local artifacts). The test accepts `ADMIN_TEST_ORIGIN`, `CHROME_PATH`, and `ADMIN_EVIDENCE_DIR`. The smoke server was stopped afterward. Representative videos, standing/sitting and door-state visual round-trips, path-tracer comparison, Windows/Edge and school-hardware performance remain unverified.

## Integration verification — 22 October 2026

These observations supersede the earlier lint limitation for the current worktree. They do not reconstruct the original dirty-file set, certify target school hardware, or establish acceptance of changes made after the commands loaded their sources. No second full build was started by the verification agent; the main agent owns `/tmp/rayzee-previs-final-build.log` and the final build report.

Commands began at approximately **09:30 Melbourne time**. A source/test/config hash capture at `2026-10-21T22:30:41Z` (09:30:41 on 22 October in Melbourne) contains 33 files; a second capture at `22:31:42Z` found changes to `ThreeShotPorts.js`, `DiagnosticScene.js` and `rasterDiagnostic.browser.mjs`. These checks therefore describe the modules loaded during that interval. Later Three.js bridge work and diagnostic changes require their own subsequent verification. Captures: `/tmp/rayzee-previs-final-verification-start.json` and `/tmp/rayzee-previs-final-verification-end.json`.

| Command / scope | Observed result |
| --- | --- |
| `npm run test:previs:storage` | **PASS**, exit 0, **13 native Chromium storage checks**, Chrome 155.0.8059.85 on macOS. Covers atomic document/revision/outbox commits, native transaction abort and quota failure, concurrent-tab conflict recovery, exact and nonregressing acknowledgments, portable privacy/import isolation, schema upgrade/blocked upgrade, and unavailable/denied storage. Log: `/tmp/rayzee-previs-final-storage.log`. |
| `npm test` | **PASS**, exit 0, **119 files / 1,563 tests**, 5.71 s. Coverage: statements 67.66%, branches 58.81%, functions 64.46%, lines 68.27%. Log: `/tmp/rayzee-previs-final-test.log`. |
| Targeted ESLint: `app/src/previs`, `app/src/student`, `app/build`, previs unit/integration/browser tests, `RealtimeRenderer.js` and test, both app Vite configurations | **PASS**, exit 0, no warnings/errors after the harness/config corrections below. `.mjs` browser/integration drivers now receive recommended JavaScript checks with both Node and browser globals. Log: `/tmp/rayzee-previs-final-targeted-lint.log`. |
| Initial `npm run lint`, with a 90-second ceiling | Stopped at the main agent's request after identifying dependency-backup traversal; **not a passing result**. `lsof` showed ESLint reading `.local-runtime/node_modules-onedrive-backup/@octokit/...`, and the log showed Babel parsing the backup's large parser bundle. This generated folder is ignored by Git but was outside ESLint's default `node_modules` exclusion. Logs: `/tmp/rayzee-previs-final-lint.log`, `/tmp/rayzee-previs-final-lint-open-files.log`. |
| `npm run lint` after adding generated-runtime/proof-build ignores | **PASS**, exit 0, **0 errors / 70 pre-existing warnings**. Log: `/tmp/rayzee-previs-final-lint-after-ignore.log`. The warning categories are 52 unused-variable, 8 React hook dependency, 6 undefined-name and 4 React refresh export warnings. All 32 warning-bearing files were compared byte-for-byte with their `HEAD` contents and are unchanged. Evidence: `/tmp/rayzee-previs-final-lint-warning-history.json`. No unrelated warning fixes were made. |

The warning classification also has a source-only JSON lint report, `/tmp/rayzee-previs-final-source-lint.json` (469 files; identical 0-error/70-warning result). Existing warnings are not new previs assertion failures or evidence of skipped test collection.

The built student offline shell was separately rechecked after fixing an async Promise executor exposed by the new `.mjs` lint rules. **PASS**, exit 0, five browser check groups; `/tmp/rayzee-previs-offline-final.log`. This uses native service worker/cache/IndexedDB behavior, exact built assets, offline navigation, preservation of cached isolation headers, missing-install-asset failures and a waiting upgrade. Its manifest excludes models/videos and the diagnostic. Full scope and limitations are in [STUDENT_PREVIS_OFFLINE.md](STUDENT_PREVIS_OFFLINE.md); do not infer offline scene/video availability from shell success.

The initial unknown worktree state and real representative admin/target-platform rendering remain open acceptance limits. The earlier lint I/O/traversal blockage has a concrete local cause and is resolved by excluding generated runtime and proof-build directories from source linting.

## Delivery integration — 22 October 2026

After adding the local backend, HTTP client, durable sync requests and acknowledgement-loop guard, the full application suite passes **1,613 tests across 123 files** (5.86 s). Main engine/app multi-page build passes. Full lint passes with 70 warnings previously verified against unchanged HEAD files; generated `.local-runtime`, proof builds and backend Wrangler state are excluded from lint traversal.

Additional real integration evidence: 14 Miniflare D1/R2 backend groups; seven Chromium IndexedDB + actual Worker/D1/R2 sync groups; 13 native storage checks; six student UI groups against the current production multi-page output; five production-output offline shell groups. See `STUDENT_PREVIS_BACKEND.md`, `STUDENT_PREVIS_SYNC.md`, `STUDENT_PREVIS_EXPORT.md` and `STUDENT_PREVIS_PROGRESS.md` for scope and commands.

Independent FFmpeg checks verify all 250/22,500 video frame timestamps and all 10/900 audio clicks. The synthetic 15-minute encode finishes in 82.14 s with bounded queues and about 0.21 MB retained JS heap growth after test GC. This is not a 15-minute real-scene or target-platform release gate. No credential files were opened or used, and no hosted deployment, push or release was performed.


## 22 October answer-alignment regression

After applying the accepted narration/framing/access decisions and adding prepared
conversion plus the shared sequence raster bridge: 1,679 tests across 126 files
pass; full engine/app build passes; full lint passes with the same 70 existing
warnings and zero errors. Generated Pages output is excluded from lint traversal.
The actual production public-edge manifest matches seven files by size/hash.
Current built student UI (including atomic custom-shot undo/redo), offline shell,
native storage and combined browser/backend sync pass 6/5/13/7 groups/checks
respectively. Backend passes 23 groups (14 draft/media + 9 security).

Host identification: Apple M5, Mac17,2, 10 CPU cores, 16 GiB RAM. The short GPU
proof now uses the shared evaluator with 50% framing bars and decoded-output pixel
checks; independent FFmpeg timing/audio checks pass again. See current progress
and export records for artifacts and exact remaining release gates.


## Actual scene slice — 22 October 2026

1,821 tests across 132 files pass; full MPA and isolated proof builds pass; lint
passes with the existing 70 warnings. Actual-model GPU scene proof passes on
Chrome 155/base M5: 97 meshes, concrete camera/light/pose/door/LED/appearance
round trips, and 22,500 frames of 1080p25 in 450.06 seconds. Independent FFmpeg
passes exact video timestamps and all 900 audio clicks. Light-proxy and owned
pose-attribute identity fixes remove measured tracked GPU resource growth across
repeated operations. This remains generated diagnostic audio/media, not teacher
publication or microphone narration acceptance.

Admin startup was repeated after this slice: normal hardware WebGPU smoke passes
with 67 meshes and camera/pose panels, but some development-server runs stall at
BLAS 66/67 without page/network errors. The last four instrumented runs pass;
the latest three take 3.055 / 2.814 / 3.316 s. Bounded worker-header diagnostics
were added to the browser harness. The underlying intermittent worker startup
issue remains open; no BVH workaround or clean regression claim is justified.
See the final investigation in `STUDENT_PREVIS_PROGRESS.md` for exact evidence.
