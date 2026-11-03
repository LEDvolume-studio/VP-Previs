# Student previs checkpoint review

Reviewed 23 October 2026 (Australia/Melbourne) against the original
[implementation plan](STUDENT_PREVIS_IMPLEMENTATION_PLAN.md). This records the
checkpoint entering the teacher catalogue slice; subsequent implementation and
test results belong in [progress](STUDENT_PREVIS_PROGRESS.md). The original
checkboxes remain complete release gates, rather than a count of modules added.

The initial useful local checkpoint has been reached: admin baseline evidence,
short raster/LED/audio export, bounded synthetic long export and an actual
97-mesh studio/car/mannequin/LED export on base M5. The complete student workflow
and full Phase 1 platform acceptance have not been completed. No hosted
deployment, push or release has occurred.

## Requirement coverage

| Original requirement | Implemented and evidenced at this checkpoint | Remaining requirement |
| --- | --- | --- |
| R1: preserve admin/upstream integration | Existing admin format is retained. Regression tests and hardware startup/camera/pose checks pass. Shared engine changes are narrow, documented and tested. | Intermittent admin BLAS 66/67 startup stall remains unresolved despite four latest passing checks. Complete admin import/export, Unreal controls, LED and affected path-traced walkthrough remains a release gate. An upstream upgrade is separately scheduled work. |
| R2: separate student frontend, presets and custom setups | Independent `/student/`, local empty custom-shot creation and detached preset-copy commands exist. Verified real-scene rendering runs in the separate engineering entry. | Trusted catalogue, teacher publishing, main-workspace rendered preset/custom authoring and simplified scene controls. |
| R3: complete fixed shot state | Strict camera/light/node/pose/door/environment/LED contracts, prepared admin conversion and concrete GPU A → B → A restoration exist. Real fixture mappings and asset bytes are verified. | Connect those contracts to editable production shots and catalogue-supported scenes; persist/reopen every category through the main workspace. |
| R4: timeline edits and real-time playback | Order/duration/undo/refresh and timing-only main UI work. Shared evaluator drives actual scene seek/play/stop with race/cancellation checks in the engineering route. | Main-workspace rendered transport, production audio clock and 15-minute preview drift/performance acceptance. |
| R5: 1080p25 raster MP4 on Chrome/Edge, macOS/Windows | Hardware Chrome/macOS exports exact 1080p25 H.264/AAC with deterministic media, framing, bounded queues, cancellation and retry. Independent FFmpeg validates timestamps and audio. | User-facing project export, real narration/mixing, independent GUI-player checks and remaining browser/OS combinations. |
| R6: 15-minute support | Shared schema/commands/API/export enforce 22,500 frames. Synthetic and actual 22,500-frame streaming exports pass locally on base M5. | End-to-end authored project/narration and remaining platform acceptance; the local proof does not establish the entire product gate. |
| R7: frozen/advancing LED | Deterministic decode and native UV/placement/nits service support both modes; visible GPU pixels and encoded frames verify both. | Teacher-library integration, production authoring controls and prepared offline media. |
| R8: independent multiple narration clips | Schema, sample/frame evaluation, independent edit commands, legacy detach and explicit mixed-selection movement are tested. Shot edits preserve independent narration metadata. | Microphone recording, durable decodable segments, waveform/editor, audio-clock preview, uploads and bounded real-recording mix. |
| R9: teacher publication without redeploy | Verified prepared conversion and shared-password/server-session foundations exist. | Capture UI, immutable catalogue/library versions, publish/hide/preview operations and separate-browser visibility checks. This is the next implementation slice. |
| R10: account-free backup/share/view/copy | Account-free private capability draft API and durable reference-free backup service have local browser/D1/R2 proofs. | Main UI backup/recovery, complete trusted scene/media dependency handling, explicit share publication, clean-browser viewer/copy/revocation. No share API or viewer is claimed. |
| R11: refresh/offline survival and downloads | Native IndexedDB revisions/outbox commit atomically; conflicts preserve recovery copies. Built shell refreshes offline. Reference-only JSON import/download works and excludes editing secrets. | Models/video offline preparation/readiness, recording persistence, continuous-control checkpoint measurement, private recovery UI and validated media-containing portable packages. |
| R12: teacher R2 background-video library only | Immutable version/hash contracts and prepared-byte conversion reject unsupported/unverified media identities. No student video-upload UI exists. | Trusted versioned R2 library, manifests, authorized resolution/range delivery and catalogue restriction through the whole product path. |

## Phase gates

| Phase | Gate status | Work needed to close the original gate |
| --- | --- | --- |
| 0: baseline/fixtures | Established locally; follow-up open | Resolve intermittent admin startup and complete representative teacher-video verification. Bounded Git inventory attempts still time out; do not infer a clean worktree. |
| 1: raster/media feasibility | Local short/synthetic-long/actual-long proofs pass; full gate open | Remaining Chrome/Edge Windows/macOS matrix and independent desktop players. Record outstanding teacher/narration and native/process-memory limitations. |
| 2: domain/shot contracts | Core implemented and contract-tested | Trusted supported catalogue resolution and production conversion/authoring integration. Unsupported imports must continue failing explicitly. |
| 3: separate entry/local persistence | Working local foundation | Continuous camera/control checkpoint measurement and storage-failure UX for those controls. An active-writer lease is absent; transactional compare-and-swap already prevents silent overwrites. |
| 4: backend | Local D1/R2/security foundation tested | Trusted catalogue references and hosted routing/secrets verification. Hosted student-data routes remain disabled under the continuing storage policy. |
| 5: backup/recovery | Reference-free service integration tested | Complete asset/media dependencies, UI wiring, private recovery export/restore and cross-browser recovery walkthrough. |
| 6: publishing/library | Conversion foundation; next slice | Trusted immutable catalogue/library and publish/hide APIs, revalidating client, atomic preset copy, admin capture UI and separate-browser proof without rebuilding. |
| 7: authoring/offline media | Real-scene engineering viewport foundation | Main-workspace gallery/controls and verified offline model/video cache, progress/readiness, Range/cancel/quota/eviction checks. |
| 8: timeline/transport | Pure/local timing UI and real-scene bridge implemented | Production viewport/audio transport and measured 15-minute preview drift. |
| 9: narration | Domain/evaluation foundations only | Recording, segment recovery, editing, upload and real microphone/audio tests. |
| 10: sharing/viewer | Pending | Immutable publication, viewer, independent copy, authorized media, update/revoke and clean-browser tests. |
| 11: production export/packages | Engineering export foundation | Export arbitrary supported student projects with narration, complete preflight/UI, platform/player acceptance and secure media-package round trip. |
| 12: regression/hosted pilot | Pending | Complete target walkthrough, hosted checks when authorized, backup/restore and cleanup drills, monitoring and operational runbooks. |

## Recorded evidence and limits

The most recent completed core checkpoint reports **1,821 tests across 132 files**,
full engine/app and isolated proof builds, and lint with zero errors and 70
existing warnings. Backend integration passes 23 groups; native storage 13
checks; combined browser/backend sync seven groups; built student UI six groups;
offline shell five groups. These are separate test types, not an aggregate test
count. This review reads the recorded results and source; it does not claim a new
execution of those suites.

On base Apple M5 (Mac17,2, 10 CPU cores, 16 GiB RAM), Chrome 155/macOS 26.6.1
exported the actual 97-mesh scene's **22,500 frames / 900 seconds in 450.06
seconds**, producing 605,057,501 bytes. Independent FFmpeg checked every video
timestamp and all 900 generated audio clicks: 21.354 ms onset delay and 32 ms
padding are within one 40 ms frame. Warmed retained JS grew 3,789,968 bytes;
tracked renderer resource counts remained stable. These are generated media and
clicks, not production microphone narration or verified teacher-library media.
Tracked renderer allocations do not measure total browser/native/GPU residency.
See [real-scene evidence](STUDENT_PREVIS_REAL_SCENE.md) and
[export evidence](STUDENT_PREVIS_EXPORT.md).

## Continuing decisions accepted on 23 October

The user has explicitly retained the **Current handling** for every remaining
question. Treat these as continuing decisions; do not re-ask them or invent a
different policy:

- No invented retention expiry, production quotas or Australian storage-residency
  commitment. Hosted student-data routes stay disabled; Australia-only trusted
  edge access remains the accepted geographic rule.
- Retain Chrome and Edge on both Windows and macOS. Base M5 is the minimum
  performance target, rather than permission to narrow the platform matrix.
- Output duration remains the sum of shot placements. Narration beyond the final
  shot stays preserved/recoverable but inactive; do not add black or held-picture
  tails.

## Next dependency order

Continue with Phase 6 locally: define a trusted immutable scene/asset/preset
registry, validate publication against it, add revalidating catalogue reads and
publish/hide operations, then atomically copy a selected preset and all required
manifest records into a student project. Prove old pinned versions remain
resolvable after update/hide and failed publication exposes nothing incomplete.
Do not mistake the bundled engineering fixture for a published teacher preset.

Then connect that supported data path to Phase 7's main student viewport and
controls, followed by measured offline media preparation. This supplies the
production scene dependency required by narration, sharing and arbitrary-project
export. Continue local implementation while hosted policy and platform gates
remain explicit. The admin startup investigation remains an engineering issue,
not a user clarification.


## Subsequent supported-scene continuation — 23 October

The progress record now supersedes the earlier missing catalogue/viewport portions
of this entering-checkpoint table: local immutable publishing/library, supported v2
node mappings, prepared capture service, prepared-preset publishing screen and
main-workspace selected-shot pictures are implemented and verified. R2/R3/R7/R9/R12
therefore have an additional end-to-end local slice. They are not complete release
requirements: live capture controls, simplified scene authoring, rendered sequence
transport, true teacher-media/platform acceptance and verified offline media remain.
No original full release checkbox was marked complete by this supporting slice.
See [supported scenes](STUDENT_PREVIS_SUPPORTED_SCENES.md) and the latest progress
entry for 2,017 unit tests, 37 backend groups and the native GPU/publication proof.


## Subsequent authoring continuation — 23 October

The next local slice now connects simplified camera/object/human-pose/light/LED
forms to native durable saves and the supported main-workspace viewport. Undo,
redo and reload preserve those edits; compatible revisions retain the prepared
scene/media and canvas. Native failure injection confirms attempted edits remain
available while stale pictures and further editing are withheld until recovery.

This advances R2/R3/R7 and the completed-control portion of R11. It leaves Phase
7 partial: door/rotation/light/source controls, supported custom scenes and
verified offline media remain; Phase 8 still needs rendered main-workspace
transport. No original full-release checkbox has been closed by these forms.
The passing verification is 2,117 unit tests/143 files, full and isolated builds,
zero lint errors, six native UI groups, five offline groups, five catalogue groups
and eight actual Pages/D1/R2/GPU groups. The latest progress entry records
artifacts, measured pixel tolerance, resource counts and remaining boundaries.


## User correction: interactive viewer — 23 October

The user clarified that the student entry must contain Rayzee's same interactive
3D viewer with WASD controls. Presets and timeline controls recall the scene's
camera, objects, lights, poses and LED state. The earlier saved-frame/timing-only
main UI was an implementation misunderstanding. It is superseded, rather than
being treated as the intended final student design. The original plan and
questions record now state this explicitly.

The corrected main workspace uses native CameraManager navigation on the visible
canvas and rendered setup selection, cuts, scrubbing, frame steps, play/pause/stop
in that same scene. Settled navigation saves an undoable pose command and
flushing preserves the pose before another edit/download. Remaining Phase 7/8
gates include other scene controls, offline media, gesture checkpoints, narration
audio-clock integration and measured long-run/platform acceptance. Full phase
checkboxes remain open. See the final interactive progress entry for tests and
artifacts; no hosted deployment or authorisation change has occurred.
