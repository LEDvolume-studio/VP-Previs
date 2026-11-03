# Student previs implementation plan

Prepared 21 October 2026 for the next Codex session. Source: `../../conversation.txt` in the local workspace. This document is the handoff; the conversation is outside the Git repository and must not become a runtime dependency.

Status: implementation in progress. See `STUDENT_PREVIS_PROGRESS.md` for completed slices, actual evidence and outstanding gates, and `STUDENT_PREVIS_QUESTIONS.md` for morning decisions. No hosted deployment has been performed. Original phase checkboxes remain release gates, not a substitute for the progress record. A requirement-by-requirement review dated 23 October is in [STUDENT_PREVIS_CHECKPOINT_REVIEW.md](STUDENT_PREVIS_CHECKPOINT_REVIEW.md). The user has retained the remaining questions’ current handling: hosted data stays disabled without invented retention/quotas, the full browser/OS matrix remains, and narration after the final shot stays preserved but inactive.

## 1. Outcome and scope

Keep the existing Rayzee-based editor as the teacher/admin authoring interface. Add a separate student frontend at `/student/` where students can create a sequence from teacher presets or custom setups, adjust shots, record narration, save safely, share a viewing link, and export a raster MP4.

**User clarification, 23 October 2026:** the student frontend centres the same interactive Rayzee 3D viewer, including its existing right-mouse-button + WASD navigation, Q/E vertical movement, Shift speed modifier and mouse-wheel speed control. Presets and timeline placements recall the camera, objects, lights, poses and LED state in this viewer. A separate student bootstrap and simpler surrounding controls must preserve that interaction model. The earlier selected static-frame and timing-only UI was an incomplete implementation, and its descriptions are superseded by this clarification.

**Final UI reference, supplied 23 October 2026:** use the attached Sim Trav mockup as the visual target. The [mockup alignment review](STUDENT_PREVIS_MOCKUP_ALIGNMENT_REVIEW.md) distinguishes reusable foundations from missing UI, changed preset/view semantics and new capability work. It proposes explicit delivery gates for the camera gallery, full-height editor, horizontal timeline and pictured inspector. The existing broad phase descriptions are not evidence that this visual design is implemented. The user has accepted the review, including visible DOF, the named driving poses, camera-only preset application and split/source-trim behaviour. The contract below records these required scope changes.

### Accepted mockup contract — 23 October 2026

The user accepted the alignment review and explicitly confirmed two viewport modes. These are implementation requirements, not outstanding clarification questions. The mockup shell and connected interactions are the next review checkpoint.

| Mode | Display and navigation | Effect on saved shots |
| --- | --- | --- |
| **Shot POV** | View through the current shot's camera. Existing Rayzee mouse/WASD controls edit that camera. | Completed camera gestures use the validated save/undo path for the selected shot. |
| **Scene inspection** | View the same scene through a separate workspace camera, using Rayzee navigation. | Inspection camera motion never changes shot pose, target, lens, framing, document revision, undo history or backup outbox. |

Keep workspace view state separate from portable shot state. Switching modes must never copy the inspection camera into a shot. Flush pending Shot POV movement through the existing durable save path before leaving it; do not flush inspection movement as a shot edit. Returning to Shot POV restores the selected shot's camera exactly. Explicit object/light/pose edits still affect the selected shot in either mode; only inspection-camera navigation is non-authoring.

Selection and timeline evaluation apply the selected shot's objects/lights/poses/media in the scene. When inspecting, preserve the independent inspection viewpoint as those shot states change. Sequence playback/export uses saved shot cameras; a playback preview may temporarily show Shot POV, then restore the previous inspection mode/viewpoint on stop. Export, thumbnails and shared playback must always use shot cameras, regardless of the current workspace mode.

Also accepted from the alignment review:

- Use the supplied Sim Trav mockup for the compact header, camera thumbnail gallery, persistent viewport, inspector and bottom horizontal shot/voiceover timeline.
- Camera preset selection applies only the camera/viewpoint/lens to the selected shot. **Add shot** and ordinary shot-card duplication create independent editable snapshots. Keep complete-scene preset insertion and explicitly linked placements distinct.
- Deliver focal-length/height controls, driver/passenger door mapping and real Driving/Relaxed/Reaching pose assets/capabilities; do not substitute cosmetic pose labels.
- Visible raster depth of field is now required for the pictured DOF/focus/aperture controls and matching export. This supersedes the earlier preservation-only launch exception for DOF; the remaining accepted raster appearance decisions remain.
- Deliver horizontal thumbnails, ruler/playhead, snapping, zoom, drag reorder/trim and atomic Split with time-dependent media continuity, keeping narration independent.
- Retain the existing validation, persistence/recovery, renderer, catalogue and export foundations. Build narration, Share and project Export as complete workflows, with honest saved/backup/readiness status.

Acceptance must verify mode switching in both directions, navigation in both modes, timeline selection during inspection, undo/reload, pending-save failure, and playback/export restoration. Inspection-only navigation and mode switching add no authoring revisions; a pending Shot POV gesture may require its own save before switching. The first connected two-camera implementation and mockup shell are available locally at `/student/?ui=editor`; see the progress record for tests and remaining acceptance gates. The original `/student/` workbench remains available during review. Visible DOF, named poses, final occupant/media mappings, narration and complete Share/Export workflows remain open.

### Requirements explicitly stated by the user

| ID | Requirement |
| --- | --- |
| R1 | Retain the existing admin editor and the ability to integrate Rayzee upstream improvements. |
| R2 | Separate student frontend centred on the same interactive Rayzee 3D viewer and existing navigation controls; teacher-created presets plus custom camera, lighting and object setups. |
| R3 | Fixed setups first. Persist car transforms, complete camera settings, human/door poses, lights and LED wall media/time per shot. Motion within shots comes later. |
| R4 | Timeline duration/order editing and real-time sequence playback that applies complete scene state in the same interactive viewer. |
| R5 | Raster MP4 export at 1920 × 1080, 25 fps. Desktop Chrome and Edge on macOS and Windows. |
| R6 | Support sequences up to 15 minutes: 22,500 frames at 25 fps. |
| R7 | Support both frozen LED video frames and advancing video from a saved position. |
| R8 | Support multiple narration clips on a separate independent track. Shot edits do not move narration; explicit mixed selection can move both. |
| R9 | Admin creates presets and chooses which are available to students without redeploying application code. |
| R10 | Students do not need accounts. Share creates a link to an online project; there is no assignment/submission system or teacher inbox requirement. |
| R11 | Work survives refreshes and connection loss. Preserve local saving and downloadable projects. |
| R12 | Background videos come from the teacher's R2 library. Student background-video uploads are outside the initial release. |

### Proposed defaults from the discussion

Use these as implementation defaults, but record any changes in the decision log. Some are recommendations from the preceding assistant rather than explicit user selections.

- Local IndexedDB saves are authoritative for the current editing session. Network work never blocks a local save.
- Automatically back up private drafts after the first meaningful edit when online. Share is separate from backup.
- A public share link points to the last explicitly shared snapshot. Ordinary edits only update the private draft. An explicit **Update shared version** replaces the snapshot behind that link; old snapshots remain immutable internally.
- Anyone possessing a viewing link can view and make an independent copy. The link grants no authority to edit the source.
- Use a private device-held capability for draft ownership, with an optional recovery mechanism. No student login screen.
- Cloudflare Workers + D1 + R2 is the preferred backend candidate because the app already uses Cloudflare and the user chose R2 for library videos. Validate the integration before fixing the hosting design.
- Presets are fully editable copies initially; retain standing/sitting compatibility and add the accepted Driving/Relaxed/Reaching assets and door mappings. Custom skeletal joint editing and field locks remain separate features unless requested.
- Library-video audio is muted; narration is the sole soundtrack in the MP4 (confirmed 22 October).
- Enforce the confirmed hard 15-minute maximum consistently at editing/import/API/export boundaries.

### Accepted decisions and remaining policy gates

Updated from the user answers on 22 October. See `STUDENT_PREVIS_QUESTIONS.md` for the accepted answers and the narrower remaining clarifications. Do not block local implementation on hosted storage policy.

| Decision | Proposed approach | Resolve before |
| --- | --- | --- |
| Admin protection | Shared password protection for admin pages and API; server-verified sessions, no admin accounts. | Verify at the hosting edge before any deployment. |
| Recovery | Separate private recovery credential/file; never place its secret in a public viewing link or portable content. | Cloud backup UI release. |
| Narration placement | Independent sequence track; shot reorder/duration/delete leaves narration unchanged. Explicit mixed selection moves both; legacy shot anchors require explicit conversion. | Narration UI; domain commands implemented. |
| Shortened/deleted clips | Preserve source recordings after audio trim/delete; shot deletion leaves independent audio intact. Undo restores clip metadata. | Timeline/narration editing UX. |
| Raster camera/LED appearance | Match existing admin raster post stack; framing/exposure/visible LED sufficient. Visible raster DOF is required under the accepted mockup contract, with preview/export consistency. Additional simulated LED illumination remains outside the initial requirement. 50% black framing bars in preview and output. | Production scene integration. |
| Geography and storage | Melbourne use; block access outside Australia at trusted edge. Australian storage residency, retention and quotas remain open; no invented expiry. | Hosted student pilot. |
| Performance target | Base Apple M5 is the slowest supported device. Current local host is confirmed M5, 10 CPU cores, 16 GiB RAM; retain original browser/OS matrix pending clarification. | Representative real-scene 15-minute acceptance. |
| Offline media scope | Explicit preparation of selected videos, with an accurate readiness indicator. Never claim uncached videos work offline. | Offline playback release. |

Out of scope: animation/keyframing, student accounts, collaborative editing, automatic multi-device merge, teacher submissions inbox, server-side rendering, student background uploads and automatic upload of exported MP4s.

## 2. Repository starting point and constraints

The implementation repository is `rayzee-renderer/`, not its parent workspace. `Cadra/` is a sibling reference project, not an integration target.

This planning session read the complete conversation, `AGENT.md`, deployment guidance, root/app package manifests, the current project schema, part of its repository, the existing engine-to-store adapter and Vitest configuration. Some OneDrive-backed reads and Git status calls stalled. Do not interpret this plan as a new complete source audit or a successful baseline test run.

| Existing location | Use in the next session |
| --- | --- |
| `AGENT.md` | Preserve local UI/control behaviour; keep engine changes narrow and regression-tested. |
| `DETAILED-AGENT.md` | Read before renderer, scene-processing, WebGPU or other high-risk engine work. |
| `app/src/services/projects/ProjectSchema.js` | Existing `rayzee-project` v1 document, metre units, migration/validation/export patterns. Keep admin documents compatible. |
| `app/src/services/projects/ProjectRepository.js` | Existing `RayzeeEditorDB`, project/file-handle/metadata stores. Reuse patterns; give students a separate database. |
| `app/src/services/projects/ProjectSession.js` | Reinspect capture/hydration/undo wiring. Full project hydration must not become the operation used at every cut. |
| `app/src/lib/EngineAdapter.js` | Existing engine-event → Zustand bridge. New previs adapter should compose with this boundary, not silently replace it. |
| `app/src/lib/appProxy.js`, `app/src/store.js` | Inspect singleton/global dependencies before bootstrapping the student page. |
| `app/src/services/LEDVideoManager.js` | Inspect seeking, local handles, textures and path-tracer interactions. |
| `app/src/services/MannequinPoseService.js`, `VehicleDoorPoseService.js` | Existing pose application and regression tests. |
| `rayzee/src/managers/CameraManager.js`, `LightManager.js` | Verify snapshot completeness, stable identity, rotation and targets. |
| `rayzee/src/managers/RealtimeRenderer.js`, `rayzee/src/PathTracerApp.js` | Verify externally controlled raster render, output sizing and safe capture options. |
| `rayzee/src/managers/VideoRenderManager.js`, `app/src/lib/VideoEncoder.js` | Existing animation/export implementation is a reference, not the student sequence contract. |
| `tests/unit/app/` | Existing project, undo, LED, human and vehicle regression coverage. |
| `vitest.config.js` | Node test environment, `tests/**/*.test.js` discovery and source alias for `rayzee`; browser/media checks need a separate harness. Coverage currently excludes many new proposed service locations. |
| `app/vite.config.js`, `app/public/_headers` | Reinspect build/base/asset routing; preserve isolation headers. |
| `docs/CLOUDFLARE_DEPLOYMENT.md`, `scripts/dev-local-runtime.mjs` | Existing deployment/local runtime guidance. Read runtime script before using it. |

The conversation's engine versions, live-upstream comparison and failed-test report are historical findings. Recheck local HEAD, dependencies and relevant history; do not upgrade upstream as part of this feature by default.

## 3. Architecture and contracts

### Suggested application-owned layout

Prefer a multi-page Vite build inside the existing `app/` workspace, with an independent student bootstrap and stores. First verify this fits the current build. A separate workspace is acceptable if routing or dependencies justify it, but record why. Both approaches must produce a tested `/student/` endpoint without mounting admin and student in one runtime.

Independence concerns the entry point, authoring state and persistence. Reuse Rayzee's actual camera/navigation controls on the visible student viewport. Simplify the gallery, inspector and timeline around that viewport; do not substitute a static screenshot or timing cursor for the required scene interaction. In Shot POV, navigation authors the selected shot camera and completed movement saves through commands. Scene inspection uses separate workspace camera state and never writes shot framing. Playback and scrubbing apply evaluated state without authoring edits. Flush pending Shot POV navigation before another edit, leaving that mode, or downloading a portable project; never flush inspection navigation into a shot.

```text
app/
  student/index.html                  # proposed second HTML entry
  src/student/                       # student bootstrap, controls, stores
  src/previs/
    domain/                          # schemas, validation, migrations, commands
    engine/                          # ShotSceneAdapter; capture/apply/capture-frame
    sequence/                        # pure evaluation + transport orchestration
    persistence/                     # IndexedDB, portable project package
    media/                           # versioned library refs, cache, narration
    sync/                            # durable outbox, revisions, retry/recovery
    export/                          # deterministic raster MP4 pipeline
    api/                             # provider-independent HTTP client
  src/components/...                 # admin preset authoring integration
backend/                             # proposed isolated Worker + D1 migrations
tests/unit/previs/
tests/integration/previs/
tests/browser/previs/                # new browser harness; not Node Vitest tests
docs/                                # contracts, engine patches, runbooks, evidence
```

Share pure domain/services between both frontends. Keep provider bindings in `backend/` and the HTTP client. Avoid importing admin UI stores into pure domain code or using engine objects as persistence records.

### Persisted domain

| Record | Required contract |
| --- | --- |
| Asset reference | Stable ID + immutable version + content hash/size/type metadata. Resolve through a manifest; URLs, file handles and live Three.js UUIDs are not durable identity. |
| Base scene | Immutable studio/environment and asset manifest. Hydrate once per compatible scene; prepare incompatible scenes before cuts. |
| Preset version | Immutable shot snapshot + base scene version + metadata, thumbnail and default duration. Availability lives outside the immutable version. |
| Student shot | Stable shot ID, source preset/version if any, complete editable snapshot. No shared mutable references to presets or duplicated shots. |
| Timeline clip | Stable placement ID, shot ID and positive integer `durationFrames`. Sequence order derives from the ordered clip list. |
| Narration asset | Immutable media ID, recording segments/manifest, codec/sample-rate/channel metadata, duration, hash and upload state. |
| Narration clip | Media ID, independent sequence offset, source trim, length, gain and mute. Explicit legacy timeline-clip anchors remain readable for compatibility; new clips are independent. Use integer audio samples for audio trim precision; convert to timeline frames at explicit boundaries. |
| Student document | Distinct format/schema version, local project ID, timestamps, edit revision, base scenes, shot map, ordered clips, narration, media manifest and output settings. No editing secrets in the document. |
| Sync metadata | Private cloud ID/capability reference, acknowledged revision, durable outbox, upload checkpoints and conflict state. Separate from portable/public project content. |
| Shared snapshot | Validated immutable revision with exact reachable asset/narration versions and a view-link pointer. No dependency on private draft endpoints. |

Shot state includes car/people transforms (position, quaternion, scale, visibility), human poses, door angles, complete camera projection/sensor/focus/exposure settings, lights with persistent IDs/type/transforms/targets/type-specific settings, supported appearance/environment overrides, and per-wall LED media version, freeze/play mode, in-point, loop, playback rate, brightness and placement. Store metres/Y-up; keep Unreal-style coordinate conversion in UI only.

Stable node mappings must be scoped to an immutable asset version. Resolve changed model hierarchies with a versioned mapping or reject clearly; do not apply poses to whichever child happens to occupy an old array index.

### Timing and engine boundary

- Fixed 25 fps for this release; timeline spans are half-open `[startFrame, endFrame)`. The last frame of a nonempty sequence is `totalFrames - 1`; seeking to the sequence end stops without evaluating a nonexistent shot.
- Pure `evaluateSequence(document, frame)` returns the active placement, shot ID, local frame, LED source times and active narration. It must not mutate engine state or authoring history.
- Preview and export use that evaluator. Preview uses an audio clock when audio is active and a monotonic clock otherwise; playback may skip display frames to preserve timing. Offline export evaluates every frame.
- For LED play mode, derive source time from saved in-point + local time × rate, then apply a documented loop/end-of-media rule. Freeze mode always resolves the saved source time. Clip reordering must not change its saved in-point.
- `ShotSceneAdapter` owns scene readiness, shot capture/apply and renderer state restoration. Avoid asset reload, BVH/material rebuild or deep cloning on each display frame.
- Suppress authoring undo/autosave while applying playback/export state. Restore the selected editing shot after stop, cancel and failure.
- Proposed export contract: `prepareScene`, `applyShot`, `prepareMediaAtTime`, `renderRasterFrame({width,height})`, `restoreEditorState`. Names are provisional; behaviours are the compatibility boundary.

### Local saving, cloud backup and sharing

```text
Edit command -> validate -> durable local revision + outbox transaction
                              |                 |
                         show local saved    retry in background
                                                |
                            upload/verify narration -> conditional draft write
                                                |
                                     mark exact revision acknowledged

Share -> freeze selected local revision -> ensure all dependencies online
      -> server validates and publishes snapshot -> return viewing link
```

Show **Saving on this device** until the IndexedDB transaction commits. Then show **Saved on this device**. Show **Backed up online** only when that exact current revision and its required media have been acknowledged. Offline status must never hide a local-write failure.

Use a durable outbox, not only in-memory timers or `beforeunload`. Persist completed commands immediately; checkpoint continuous drags at a short measured interval and flush on interaction end. Document the remaining crash window; do not promise every uncommitted pointer move survives process termination. Browser storage eviction/cleared data requires cloud recovery or downloaded backups.

Use revision-based conditional updates and idempotency keys. Late acknowledgements cannot clear newer pending edits. A stale/multi-tab writer must receive a conflict, preserve both revisions and offer a recovery copy; silent last-write-wins is unacceptable. Prefer one active writer per local project with cross-tab coordination, while still enforcing revisions on the server.

Sharing captures revision N. If the student edits N+1 during upload, only N is published. Never return a working share link for missing media. No distributed transaction spans D1 and R2: upload immutable objects first, verify them, then commit the database snapshot/pointer; retry safely and clean abandoned objects later.

### Backend surface and data ownership

Proposed API behaviours, not mandatory route spelling:

| Operation | Access and invariant |
| --- | --- |
| Read catalogue/versioned assets | Public published metadata; hidden presets omitted from new choices, pinned versions still resolvable for existing projects. |
| Create anonymous draft | Rate/quota limited and idempotent. Implementation uses a client-generated private ownership capability, durably saved with the request before creation; the server stores its hash. Lost-response retry recovers the same creation without orphan drafts. See STUDENT_PREVIS_DECISIONS.md. |
| Read/update private draft | Capability required; revision precondition and request ID checked server-side. |
| Create/complete narration upload | Owner scope; server-generated object key, validated size/type/hash, resumable checkpoints where needed. |
| Create/update share | Owner scope; references a validated complete draft revision and immutable media manifest. |
| Read share | Opaque view token; returns only the published snapshot and authorised media URLs. |
| Revoke share/delete draft | Owner/admin scope; references retained by active snapshots are protected from cleanup. |
| Publish/version/hide preset; manage library | Authenticated teacher only, enforced in backend even if admin frontend remains publicly reachable. |

Suggested tables: `presets`, `preset_versions`, `asset_versions`, `drafts`, `draft_revisions`, `media_objects`, `upload_sessions`, `shares`, plus explicit revision-to-media references for safe garbage collection. Decide whether immutable documents fit D1 or belong in R2 after measuring fixture sizes; store small metadata/pointers in D1. Do not store media blobs there.

Editing capabilities need cryptographically random secrets, hashed server storage, redacted logs and no appearance in public exports/URLs/analytics. A recovery URL should exchange a secret from its fragment, remove it from the address bar and restore private authority without leaking it through referrers. View tokens are bearer access; disclose that anyone with the link can view. Private narration must not be served through an unrestricted public bucket merely because built-in library videos are public.

## 4. Phased delivery and verification

Use one reviewable vertical slice at a time. A phase is complete only when its deliverable, automated tests, applicable browser checks and evidence are recorded. Later phases cannot bypass a failed dependency by marking it complete.

### Phase 0 — Establish a reproducible baseline and fixtures

Dependencies: none. Covers R1 and creates evidence for all later work.

- [ ] Read repository guidance; inspect working-tree status and relevant local engine history. Preserve unrelated changes.
- [ ] Establish Node/dependency runtime using the documented scripts. If OneDrive stalls, use a verified local copy excluding credentials, `.git`, dependencies, builds and caches; do not overwrite the original or test stale sources.
- [ ] Record HEAD, dirty files, tool versions and baseline targeted tests/build/lint outcomes. Separate existing failures from new failures.
- [ ] Capture a representative fixture: studio, car, at least two human/door poses, distinguishable camera/lights and a teacher video with visible timecode. Add an audio click/count test asset without student recordings.
- [ ] Define a browser harness using existing Puppeteer tooling where suitable; distinguish mocks from real GPU/media validation. No new framework required without a reason.

Tests/gate: run existing project schema/session/undo, LED and pose tests; verify admin fixture opens and renders. Reproduce any blocked reads with a bounded timeout and document the fallback. Exit with a baseline report and fixture inventory, not an assertion that unrun tests passed.

### Phase 1 — Prove raster, LED and MP4 feasibility early

Dependencies: Phase 0. Covers the high-risk parts of R5–R8 before building the full editor.

- [ ] Read detailed engine guidance/history; build a small diagnostic harness with two hard-cut setups, one frozen LED shot, one playing LED shot and synthetic audio.
- [ ] Prove a raster-only scene path, explicit 1080p output independent of viewport/DPR and a raster-safe capture path. Add only narrow engine hooks needed for the proof.
- [ ] Prototype deterministic LED decoding/frame readiness. Do not rely on a fixed sleep after assigning `video.currentTime`.
- [ ] Evaluate Mediabunny/WebCodecs MP4/H.264 + AAC with runtime capability checks and a documented AAC fallback if needed. Pin chosen dependencies only after the proof.
- [ ] Stream output to a file/OPFS-backed destination and bound decode/render/encode queues. Prove cancellation and editor-state restoration.
- [ ] Inventory raster appearance: focus/DOF, exposure, framing masks and LED lighting. Record missing visual effects and resolve launch expectations rather than silently dropping settings.

Tests/gate: export a 10-second fixture with exactly 250 frames, 1920 × 1080 dimensions, 40,000 µs timestamp increments, correct cut boundaries, frozen/advancing LED content and audio alignment within one video frame. Inspect with a media probe and decoded sample frames; play in independent desktop players. Run real Chrome/Edge checks on macOS/Windows, recording OS/browser/GPU and codec results. If machines are unavailable, keep that matrix pending.

Before committing to the export architecture, run a synthetic 15-minute streaming soak: 22,500 frames, no linear accumulation of decoded frames/PCM/output bytes in JS memory, cancellation releases resources and a second export succeeds. Record throughput and peak memory. Real-scene long-run testing repeats at Phase 11. Failure here requires resolving the export path before substantial export UI work.

### Phase 2 — Durable document and complete shot capture/apply

Dependencies: Phase 0; incorporate adapter findings from Phase 1. Covers R2, R3 and R7.

- [ ] Implement distinct student schema, validation/migrations, stable IDs and immutable versioned asset resolution.
- [ ] Add complete shot capture/apply behind the previs adapter. Reinspect all camera settings and light rotation/targets/IDs rather than relying on historical findings.
- [ ] Preserve existing admin `.rayzee` format; add an explicit import-to-student conversion producing a first shot and a conversion report for unsupported content.
- [ ] Test pose/node mappings per asset version and explicit missing-asset errors. Limit first release to supported catalogue assets unless an import is durably packaged.
- [ ] Add fixture-based contract tests that can be rerun during upstream engine upgrades.

Tests/gate: A → B → A round-trip preserves all transforms, camera fields, light state/IDs, people/door poses, environment and LED references within documented float tolerances. Editing a preset copy never mutates its source. Duplicated shots have independent IDs/data. Invalid/nonfinite values, duplicate IDs, unsupported schema versions and unresolvable asset versions fail clearly. Existing admin schema/session tests remain green.

### Phase 3 — Independent student entry and trustworthy local persistence

Dependencies: Phase 2. Covers R2 and R11 before cloud work.

- [ ] Add independent `/student/` bootstrap, store and IndexedDB namespace. Keep existing admin route/workspace/default-project records intact.
- [ ] Implement new/open/rename/duplicate projects, minimal shot edit commands, undo/redo, local save status and recovery UI.
- [ ] Atomically persist document revisions and durable outbox entries; store narration blobs separately when added later. Keep playback and selection-only updates out of edit revisions.
- [ ] Checkpoint continuous adjustments; handle quota/IDB failures, blocked migrations and old-version tabs without reporting false success.
- [ ] Coordinate tabs so two editors cannot silently overwrite one local project.

Tests/gate: edit, wait for local acknowledgement, refresh with network disabled and recover the exact committed revision. Simulate termination/restart with a pending outbox. Test rapid drag + refresh at documented checkpoints, failed/aborted IDB transactions, unavailable storage, two tabs and old-schema upgrade. Admin and student projects remain isolated. Load `/student/` directly and refresh it in built preview; JS/CSS/models return actual assets, not an HTML fallback.

### Phase 4 — Account-free backend and conditional draft API

Dependencies: Phases 0 and 2; can follow the local slice without waiting for full timeline UI. Covers R9–R11 foundations.

- [ ] Create isolated Worker/backend project with local D1/R2 development, versioned migrations and separate test/preview/production configuration.
- [ ] Implement draft creation/read/update, immutable revision metadata, capability verification, schema validation, idempotency and conditional revision writes.
- [ ] Define limits, error envelopes and provider-independent client interface. Keep server secrets out of all `VITE_*` values and browser bundles.
- [ ] Protect admin pages and publishing API with a shared password/server-verified session; enforce Australia-only access using trusted hosting metadata. Verify hosted routing/secrets before enabling data routes.
- [ ] Implement owner-scoped narration upload initiation/completion contracts and reference bookkeeping, even before recorder UI exists.

Tests/gate: local integration tests exercise real D1/R2 emulation, including duplicate create/update after lost response, forged/missing/wrong capabilities, stale revisions, cross-project media access, revoked access, oversized/invalid payloads and unauthenticated admin calls. Concurrent updates from one base revision yield one accepted successor and a conflict for the other. Test migration from empty and prior fixture databases. No credentials in artifacts or logs.

### Phase 5 — Automatic private backup and recovery

Dependencies: Phases 3 and 4. Covers R10 and R11.

- [ ] Create a private cloud draft after the first meaningful edit; persist identity/credentials safely before queuing later writes.
- [ ] Implement startup/online retries with backoff/jitter, upload checkpoints, cancellation, conditional revisions and exact-revision acknowledgements. Treat online events as retry hints, not proof of reachability.
- [ ] Show truthful local/cloud/offline/conflict status. Preserve local edits on auth expiry, API errors or server rejection.
- [ ] Implement conflict recovery as an explicit preserved copy; no automatic collaborative merge.
- [ ] Add private recovery export/link and a restore path; handle a local draft newer than the recovered remote revision.

Tests/gate: network fails before request, after remote commit but before response, during media transfer and during restart. Every committed local edit remains recoverable; retries create no duplicate drafts/revisions/uploads. Acknowledgement of N cannot mark N+1 backed up. Reconnection sends the newest coherent revision and dependencies. Recover on another browser with the private credential; a viewing token cannot recover edit authority. Clearing local data without a credential is explained accurately.

### Phase 6 — Teacher preset publishing and versioned R2 library

Dependencies: Phases 2 and 4. Covers R2, R9 and R12.

- [ ] Add admin capture-as-preset with name/description/category/default duration/thumbnail and validation against supported assets/media.
- [ ] Implement draft/preview/publish/version/hide operations; publish immutable versions and update catalogue availability atomically.
- [ ] Define library video manifests: stable ID/version, duration/timebase, dimensions, content hash, R2 object reference, poster and required playback metadata.
- [ ] Fetch the student catalogue dynamically with cache revalidation. Existing projects resolve pinned versions after preset updates/hiding.
- [ ] Restrict published media references to the teacher catalogue; no arbitrary student URL or background upload path.

Tests/gate: admin publishes and hides a preset without rebuilding the frontend; a separate student browser sees the catalogue change. Previously created shots retain the old state and media version. Failed/incomplete publication leaves no visible broken preset. Public requests cannot modify presets. Missing versions and unsupported preset fields produce useful diagnostics. Verify cross-origin loading under actual isolation headers.

### Phase 7 — Student shot authoring and verified offline media

Dependencies: Phases 3 and 6; use Phase 5 for backup status. Covers R2, R3, R7, R11 and R12.

- [ ] Build the accepted mockup shell and both **Shot POV** / **Scene inspection** modes with strictly separate cameras. Verify inspection cannot alter saved framing or authoring history.
- [ ] Build the camera thumbnail gallery, the same interactive Rayzee viewport with its existing RMB + WASD/QE/Shift/wheel controls, and simplified inspector controls for camera, car/people/doors, lights and LED source/in-point/freeze/play settings. Camera presets update only the selected camera; complete-scene presets remain distinct. Add the accepted focal-length/height/DOF, occupant-pose and door controls. Provide a custom-shot path from a supported base scene.
- [ ] Make every completed edit a domain command with undo/redo and persistence. Allow a clear save-to-shot workflow without recording playback state as edits.
- [ ] Cache application shell/required models/library metadata and explicitly selected video versions. Use a versioned cache strategy and range-capable media delivery for seeking where needed.
- [ ] Show cache progress/storage usage and accurate per-project offline readiness. Recover from eviction and missing cached sources without changing the saved shot.

Tests/gate: create custom and preset-derived shots; edit every required state category; reopen and compare. Verify existing Rayzee fly/pan/speed controls in the visible student canvas, camera save after a completed gesture, and a pending-navigation flush before edits/download. Prepare media, disconnect, refresh and render/scrub the selected frozen/playing backgrounds. Uncached or partially downloaded media is reported unavailable, never silently replaced. Test HTTP Range seeking, cancellation, cache version changes, quota exhaustion and privacy/isolation headers in hosted preview. Existing admin controls remain functional.

### Phase 8 — Timeline and shared sequence transport

Dependencies: Phases 2, 3 and 7. Covers R4, R6 and R7.

- [ ] Implement pure frame evaluation, clip insertion/duplication/deletion/reorder, duration editing, selection, scrubbing, frame steps and play/pause/stop. Cuts, scrubbing and playback apply evaluated scene state and media time in the same Rayzee viewer.
- [ ] Implement horizontal thumbnail cards, ruler/playhead, snapping, zoom, drag reorder/trim and atomic Split; preserve media source-time continuity and independent-card defaults.
- [ ] Use one transport/controller for editing preview, narration recording and export evaluation. Preload scenes/media and explicitly buffer if required state is not ready.
- [ ] Keep GPU/media updates outside React rendering and authoring persistence. Virtualise visible timeline items where measurements justify it.
- [ ] Apply complete shots only at cuts or changed-state boundaries; update only time-dependent media during held shots. Guard asynchronous seeks with generation/cancellation IDs.

Tests/gate: table-driven evaluator tests cover empty sequence, one frame, exact cut, last frame, end seek, reorder and 22,500-frame boundary. Frozen media never advances; loop/nonloop/in-point rules match preview/export. Rapid A → B → A seeks cannot display a stale completed B seek. Reordering and duration edits survive undo/redo/refresh. Browser timing test includes hard cuts and a 15-minute clock-drift run; record buffering and real-time performance on the representative school machine. Stop restores the editing shot without adding undo entries or cloud revisions.

### Phase 9 — Narration recording, editing and durable uploads

Dependencies: Phases 5 and 8. Covers R8 and narration portions of R11.

- [ ] Add microphone selection/permissions, count-in, start/stop, visible recording state, waveform, trim/move/gain/mute/delete on the independent narration track, plus explicit mixed shot/audio selection movement.
- [ ] Persist recording data incrementally with segment ordering/container metadata. Prove interrupted recordings can be decoded; arbitrary MediaRecorder chunks are not assumed to be standalone files.
- [ ] Upload immutable recordings/segments in the background with checksums and retry checkpoints; never discard the only local copy after upload failure.
- [ ] Schedule preview against the audio clock and keep narration positions independent of shot placement. Support explicit mixed selection movement and legacy-anchor conversion. Handle permission denial/device removal without damaging existing clips.
- [ ] Implement bounded/block-based audio mixing for export. Do not require all decoded long recordings and the complete mix to coexist in memory.

Tests/gate: synthetic audio fixtures prove trim/gain/overlap and anchors. Reorder/resize/delete a shot: independent narration retains its absolute start and source. Move an explicit mixed selection: only selected narration moves with the selected shots. Duplicate/shorten/delete behaviours follow recorded policy and undo restores media references. Refresh during recording recovers all committed decodable segments and flags the incomplete tail. Offline recording, reconnect upload and lost upload acknowledgement are recoverable. Use real microphone browser tests in addition to fake-device automation; check 15-minute drift and peak memory.

### Phase 10 — Share publication and independent viewer

Dependencies: Phases 5, 6, 8 and 9. Covers R10.

- [ ] Implement Share and Update shared version with progress and an exact frozen revision. Finish/verify required narration uploads before publication.
- [ ] Add a view-only route such as `/student/share/<token>` with transport, media error states and **Make a copy**. Copy creates new local/private identities and never reuses ownership credentials.
- [ ] Resolve narration through share-authorised URLs; built-in assets stay pinned to their immutable versions. Refresh expiring URLs during long playback without losing sequence position.
- [ ] Implement revocation and failed-publication recovery. Offline Share preserves work and offers retry after reconnection; no premature link.

Tests/gate: create link, open in a clean browser with no original IndexedDB/cookies and play the complete sequence/audio. Public viewer cannot update source draft or request other private media. Edit source after sharing; viewer remains on prior snapshot until explicit update. Concurrent edit during sharing does not leak a later revision. Missing/corrupt uploads prevent publication. Retry after lost publish response returns the same result. Revoked/unknown links and a link updated during playback have defined, tested behaviour; an already-open viewer may keep its loaded immutable snapshot until reload.

### Phase 11 — Production MP4 export and portable project packages

Dependencies: Phases 1, 8 and 9; package versioned-media rules also use Phase 6. Covers R5, R6 and R11.

- [ ] Promote the proof into a user-facing export service using the same evaluator, exact frame timestamps, deterministic media decoding and explicit output framing/colour handling.
- [ ] Add preflight for codecs/assets/disk space, progress, cancellation and actionable errors. Render every frame; do not substitute wall-clock MediaRecorder capture.
- [ ] Bound media/encoder queues and audio mix memory; close frames, codecs, textures, audio contexts and file handles on every exit path. Keep partial output cleanup and original edit state reliable.
- [ ] Provide downloadable project packages with schema/manifest/narration and optional selected built-in assets for true offline portability. A lightweight reference package must clearly state it needs network access for built-ins.
- [ ] Import packages as new private projects, validating hashes, versions, schema, archive paths and expanded-size limits. Exclude private sync/edit credentials and local file paths.

Tests/gate: short export verifies exact frame count/cuts, LED timecode, audio mix/trim/gain, visual framing and one-frame A/V tolerance. Export the representative full 15-minute scene with narration on the supported browser/OS matrix; record elapsed time, memory and decode/encode queue limits. Cancel at prepare/render/finalise, simulate encoder/disk/media failure, then successfully export again. Resize UI/change DPR during export without changing dimensions. Reopen the MP4 in independent players. Package round-trip in a clean browser restores all included content; reference-only packages correctly explain offline omissions and reject corrupt/malicious archives.

### Phase 12 — Regression, hosted pilot and operational handoff

Dependencies: all prior release gates. Covers all requirements.

- [ ] Run targeted tests, full suite, build and lint; classify pre-existing failures rather than hiding them.
- [ ] Verify admin project import/export, camera/Unreal controls, poses, LED workflow and any existing path-traced workflows touched by shared changes.
- [ ] Verify production-style routing, content MIME types, missing-asset errors, isolation/CORS/Range headers, service-worker upgrades and old-project migrations in a hosted preview when authorised.
- [ ] Add backups/restore drill, retention/garbage-collection job, abandoned-upload cleanup and administrative deletion. Reachability from active draft revisions and shares prevents deleting required media.
- [ ] Add redacted operational errors, rate/storage monitoring and a short teacher publishing/student recovery runbook.
- [ ] Document local engine patches and run the adapter contract suite against a candidate upstream integration branch when an upgrade is separately scheduled. Do not bundle that upgrade into this release.

Tests/gate: complete the acceptance walkthrough below on real target machines. Simulate backend outage, offline refresh, storage failure, expired media URLs and a recoverable server restore. Dry-run cleanup proves that old active shares still open. All unresolved requirements have an explicit owner/blocker; no production-ready claim while target-platform or 15-minute tests remain unrun. No push/release/production deployment is implied by this planning task.

## 5. Test execution and evidence

### Existing commands to establish in Phase 0

Run from `rayzee-renderer/` with the supported Node runtime. These are planned commands, not results from this planning session.

```sh
npx vitest run tests/unit/app/projectSchema.test.js tests/unit/app/projectSession.test.js tests/unit/app/projectSessionUndo.test.js tests/unit/app/undoManager.test.js
npx vitest run tests/unit/app/ledVideoManager.test.js tests/unit/app/mannequinPoseService.test.js tests/unit/app/mannequinPoseRefit.test.js tests/unit/app/vehicleDoorPoses.test.js
npm test
npm run build
npm run lint
```

Add scripts for backend integration and browser acceptance when those harnesses exist; document exact commands in the handoff. Add an IndexedDB test implementation or real-browser repository tests as needed; a mocked Map cannot prove transactions, quota handling or restart recovery. Extend coverage selection to new domain/services and backend code deliberately.

Use fake clocks and deterministic media fixtures for pure timing tests. Use real IndexedDB/API emulation for persistence/sync integration. Use real GPU, codecs, R2 delivery and audio for browser acceptance. Do not use screenshots or mocked renderer calls as proof of valid exported media.

### Minimum acceptance walkthrough

1. Teacher captures a preset, publishes it and changes its availability without frontend deployment.
2. Student opens `/student/` without an account, adds two presets and a custom shot, edits camera/car/poses/lights and both LED modes.
3. Student reorders/durations/undoes edits, refreshes, disconnects and continues editing; all acknowledged local saves restore correctly.
4. Student records multiple clips on the independent narration track; shot reorder/duration edits leave audio unchanged. Explicit mixed selection moves both selected shots and narration.
5. Network returns; private backup catches up, including audio. Saved/backed-up status describes the exact current revision.
6. Share completes; clean-browser viewer sees and hears the snapshot. Later source edits remain private until Update shared version.
7. Viewer makes an independent editable copy. Private recovery restores editing on another browser only with the private credential.
8. Export a short diagnostic and a representative 15-minute 1080p/25 fps MP4 with correct LED and audio timing; cancellation/retry also works.
9. Download/import a project package; verify included-media offline restoration and clear handling of reference-only content.
10. Repeat on Chrome/macOS, Edge/macOS, Chrome/Windows and Edge/Windows; test at least one representative school machine. Admin regression walkthrough still passes.

### Completion evidence per phase

Record phase/status, commit or source revision, changed modules, automated command/results, fixture IDs, browser/OS/GPU, observed timing/memory where relevant and remaining blockers. Keep evidence in a small `docs/STUDENT_PREVIS_PROGRESS.md` created during implementation; link larger artifacts rather than committing recordings or huge exports. Use `not run` and a reason for unavailable tests.

## Preset authoring checkpoint — accepted 23 October 2026

The user requested a Presets tab inside the normal admin editor with selecting a
preset for editing, saving the scene as an update or new preset, renaming, and
automatic thumbnails, all reflected in the student view. The user additionally
requires Cloudflare's database for deployed persistence. The implementation now
connects the admin editing workflow to a shared repository contract: device-local
IndexedDB for development, Cloudflare D1/R2 for production. D1 commits the editable
record and public student catalogue version atomically; thumbnails and verified
model/media/HDRI files live in R2. Student library changes refresh without silently
overwriting already-created shots. This advances the live capture and authoring
gates; it does not complete the remaining original narration/export/platform gates.

Workflow and validation: [preset editor](STUDENT_PREVIS_PRESET_EDITOR.md),
[Cloudflare bindings/migrations](../backend/PRESET_EDITOR.md), and
[progress](STUDENT_PREVIS_PROGRESS.md). Hosted bindings, schema migration,
initial catalogue population and deployment remain explicit release work.

## 6. Instructions for the next Codex session

Start with Phase 0 and the smallest Phase 1 proof. This is a multi-session roadmap, not a request to build all features before validating the foundation.

1. Read this plan and `AGENT.md`; inspect current worktree/history and follow deployment/local-runtime guidance. Keep unrelated work intact.
2. Complete baseline/fixture setup and document real test outcomes. Investigate stalled OneDrive reads with bounded attempts; do not let them become unreported hangs.
3. Read detailed engine guidance, inspect raster loading/capture/LED call paths and implement the smallest deterministic raster diagnostic with audio.
4. Add tests for each engine contract changed and record all merge-sensitive diffs. Leave the existing admin route usable.
5. If Phase 1 exposes a codec, frame-readiness or memory blocker, resolve or report that precise blocker with a reproducible fixture before expanding student UI.
6. End the session with a concrete handoff: completed gates, exact test evidence, outstanding failures, source paths, next phase/action and decisions actually requiring user input. Update this plan only when scope/contracts change, and update the progress record after each slice.

First useful session outcome: a reproducible admin baseline plus a short raster MP4 proof showing a correct cut, a frozen LED frame, advancing LED playback and synchronised synthetic audio. Do not mark the entire Phase 1 gate passed until the long-run and target-platform checks are also complete.

## 7. Primary references checked for planning

Backend and codec choices remain subject to the proofs above. Recheck documentation when implementing and pin the versions used.

- Cloudflare Workers can use service bindings, including D1/R2; keep them behind the backend boundary. [Workers bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/), [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/).
- R2 supports direct presigned uploads and multipart options; choose resumability based on recording size and validate completion server-side. [R2 object uploads](https://developers.cloudflare.com/r2/objects/upload-objects/).
- Mediabunny supports MP4 output and chunked output targets, but browser codec availability must be probed; AAC may need its extension encoder. These capabilities do not prove this application's timing, memory or GPU behaviour. [Writing media files](https://mediabunny.dev/guide/writing-media-files), [Supported formats and codecs](https://mediabunny.dev/guide/supported-formats-and-codecs).

### Accepted correction: projects own scenes; presets own state

The earlier preset-as-independent-project workflow is superseded. A project defines
the complete car/house/etc setup and owns every resource. Presets within it define
existing object transforms/visibility and camera framing. Applying presets must
not hydrate projects, add/load objects, recreate materials/media or rebuild shaders.
Changes to model inventory belong to project editing. Project-scoped selection,
legacy adoption without resource loading, and student rejection of unrelated setup
presets are now part of the preset checkpoint. See STUDENT_PREVIS_PRESET_EDITOR.md
for the revised workflow and storage contract.

### Local voiceover checkpoint — 23 October 2026

Local microphone recording and sequence-synchronised playback are implemented in
the student editor. Voiceover clips can move, trim from either end and delete;
completed edits persist locally and support Undo/Redo. Completed encoded audio
files survive reload in a separate IndexedDB store. Native fake-device recording,
file-write failure/retry and pointer/keyboard timeline editing are verified.
See STUDENT_PREVIS_VOICEOVER.md and STUDENT_PREVIS_PROGRESS.md. Phase 9's broader
incremental-crash-recovery/upload/waveform/long-duration/platform gates remain open.
