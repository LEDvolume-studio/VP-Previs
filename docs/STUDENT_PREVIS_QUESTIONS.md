# Student previs — answers and continuing decisions

Updated 23 October 2026. Your answers below supersede the provisional product choices. Implementation and verification status remain in [STUDENT_PREVIS_PROGRESS.md](STUDENT_PREVIS_PROGRESS.md).

## Accepted answers

| Topic | Your answer / accepted behaviour |
| --- | --- |
| Admin access | “There will be no admin users. protect the admin site with password protection.” Use a shared password and server-verified session, protecting both admin pages and publishing APIs. No teacher account/identity-provider requirement. |
| Preset authoring and storage | Add an admin Presets tab to select/edit, save an update or new preset, rename and automatically capture thumbnails; updates appear in the student library. “When deployed to Cloudflare, we should use Cloudflare's database to store these changes.” Production uses D1 for preset/editing state and revisions, with R2 for verified binary assets. Local development may use the separate IndexedDB library. Existing student shots remain independent copies. |
| Student viewer | “The student view ... contains the same 3D viewer as Rayzee, with WASD controls. The presets and timeline controls simply dictate the position of the items in the scene (camera, lights, poses, etc).” Centre the student workspace on Rayzee's interactive viewer and existing RMB + WASD/QE/Shift/wheel navigation. Presets, cuts, scrubbing and playback apply complete scene state in that viewer. The earlier static-frame/timing-only shell was an incomplete implementation; its descriptions are historical and superseded. |
| Audience and geography | “This app will only be used in Melbourne, Australia. Block access outside Australia.” Enforce Australia-only access at the trusted hosting edge for student and admin routes. Local development has an explicit exemption. This does not by itself specify data residency or retention. |
| Cloud recovery | “Use Provisional approach.” Keep the private editing/recovery credential separate from public viewing links and portable project content; preserve the device-generated capability. A separate private recovery file is a suitable first UI slice. |
| Narration placement | Independent narration track/layer with multiple recording clips. Moving/reordering shots or changing shot duration leaves narration unchanged. Explicitly selecting shots and narration allows moving both together. New narration is sequence anchored; older shot anchors are preserved until explicitly detached. |
| Recording preservation | “Use Provisional approach.” Preserve original recording assets after clip trim/delete and retain recoverable metadata through undo. Deleting a shot does not delete independent narration. |
| Export soundtrack | “Yes, narration is the only exported file.” Interpreted in the audio question's context: narration is the sole **audio soundtrack in the MP4**, and library video audio is muted. The required video export remains 1920 × 1080 H.264/AAC MP4. |
| Duration | “Yes” to a hard 15-minute maximum: 22,500 frames at 25 fps, shared by timeline/import/API/export validation. |
| Initial raster appearance | Camera framing, exposure and visible LED imagery are sufficient; appearance should match the admin raster renderer. Use its existing post stack. The earlier DOF preservation-only exception is superseded by the accepted final mockup: visible raster DOF is required. Additional simulated LED illumination remains outside the initial requirement; preserve authored settings. |
| Framing | “Use 50% semi transparent black bars for any ratio that's not 16:9.” Preserve the full 1920 × 1080 image; composite black at 0.5 alpha outside the chosen 4:3 or 2.40:1 frame, in preview and exported pixels. |
| Offline media | “Use Provisional approach.” Explicitly prepare selected immutable teacher-video versions and show measured readiness. Shell availability alone must not claim video availability. |
| Slowest target | “Apple Base M5 Is the slowest device.” Use base M5 for the performance acceptance run; record actual hardware and browser. Host hardware is Apple M5, Mac17,2, 10 CPU cores and 16 GiB RAM. The actual 97-mesh, 15-minute Chrome export passed here in 450.06 seconds. Production narration/teacher-media and remaining platform acceptance remain open. |

## Retained handling — accepted 23 October 2026

You instructed us to keep the **Current handling** below. These are now accepted continuing decisions, not pending questions. Local implementation continues under these rules; the corresponding hosted/pilot acceptance limits remain explicit.

| Acceptance area | Topic considered | Current handling (retained) |
| --- | --- | --- |
| Hosted student pilot | What are the approved private-draft/share retention periods, project/school quotas and voice-recording data handling requirements? Is Australian **storage residency** required in addition to blocking overseas visitors? | No invented expiry or production quotas; hosted data routes remain disabled. Melbourne audience and Australia-only access are accepted, but do not answer these storage questions. |
| Platform acceptance | Does naming base M5 also narrow supported browsers/OS to macOS, or do Chrome/Edge on Windows remain required? | Retain the plan's Chrome/Edge Windows/macOS matrix until explicitly narrowed. Chrome/base M5 short and 15-minute actual-scene rendering pass with generated audio/media. Real narration/teacher-media and the remaining browser matrix remain acceptance gates. Edge is not installed on this machine. |
| Timeline tail UI | When narration extends beyond the last shot, should output continue with black or hold the last picture? | Current output duration is the sum of shot placements. Audio beyond that boundary remains preserved and recoverable, but inactive. Do not silently invent a black/held-picture tail. Independent audio placement itself is implemented. |


## Continuing defaults

- Admin remains the teacher authoring interface; students use a separate `/student/` entry and need no accounts.
- The separate entry reuses Rayzee's interactive 3D viewer and navigation. In Shot POV, completed navigation saves the camera to the selected setup. Scene inspection navigation uses a separate camera without changing shot framing; timeline evaluation changes the displayed scene without recording playback as authoring edits.
- Public viewing links permit viewing and independent copying only. Local committed saves remain authoritative.
- Online backup is private. Share publishes an explicit snapshot; later edits remain private until **Update shared version**.
- Presets are editable copies. Student video uploads, animation/keyframing, custom skeletal joint editing and field locks remain outside the initial scope.
- No push, release or hosted deployment is authorised by this implementation session.

## Technical findings

OneDrive hydration resolved the earlier source-read failures. Full tests/build/lint and native browser/storage/backend proofs have passed; see the progress and baseline records for exact runs and remaining gates. Git status still exceeded a bounded timeout in the prior checkpoint; unrelated work is preserved.

The pinned software AAC encoder resolved the measured native macOS delay: 21.35 ms onset delay passes the one-frame tolerance in short and 15-minute synthetic independent FFmpeg checks. This needs no product decision.

Repeat admin development-server startup is intermittent: successful hardware
smokes alternate with a BLAS 66/67 stall before raster rendering. Four latest
instrumented checks passed, but the cause is unresolved. This is an engineering
follow-up, not a question requiring your answer; see the progress record.


The 23 October continuation adds prepared preset publishing and catalogue-backed
selected-shot pictures in the main workspace. It introduces no additional product
question. The retained storage/platform/tail handling remains unchanged, and
hosted data stays disabled. Implementation scope is in the progress record.


The subsequent saved-shot authoring/viewport-reuse continuation introduces no new
question. Completed controls use the accepted metre/Y-up, editable-copy, framing
and pinned-library rules. Unimplemented authoring/transport/offline work remains
an implementation task under the existing answers.

The subsequent viewer correction follows your explicit clarification above and
introduces no new decision or blocking question. The local continuation uses
Rayzee's native camera controls on the visible canvas, a central scene viewport
and inspector, and actual timeline cuts/scrub/play/pause/stop. Camera gestures
settle for 120 ms before saving; pending movement is flushed before other edits
or downloads. An explicit development-only local demo uses the bundled studio,
SUV, mannequin and LED GLBs with stable generated test media for progress review.
It is not a published teacher catalogue. Current verification evidence belongs
in the progress record; the retained storage/platform/tail handling is unchanged,
and no hosted deployment is authorised.

## Final mockup — accepted 23 October 2026

The user agreed with the full alignment review and explicitly confirmed two modes: **view current shot POV** and **Scene inspection mode that does not change shot framing**. The earlier mockup clarification questions are resolved; none should be re-asked as product blockers.

| Topic | Accepted handling |
| --- | --- |
| Shot POV | Display and edit the selected shot camera using the existing Rayzee navigation. Completed gestures save through validated commands and undo. |
| Scene inspection | Use an independent workspace camera. Navigation changes no shot framing, camera/lens data, authoring revision, undo history or backup outbox. Switching back restores the current shot POV; no implicit copy of inspection framing. |
| Explicit scene edits | Object/light/pose/door edits still target the selected shot. Selecting a shot or scrubbing applies scene state while the inspection viewpoint remains independent. |
| Camera presets | Camera tiles change the selected shot's camera/viewpoint/lens only. Add shot and ordinary duplicate-card actions create independent shots; full-scene insertion/linked placements are distinct. |
| Visible DOF | The pictured DOF/focus/aperture controls require a visible raster effect and matching export. This supersedes the earlier DOF preservation-only launch decision. |
| Occupant poses | Driving, Relaxed and Reaching require real assets and versioned occupant/seat mappings. Do not relabel Standing/Sitting as those capabilities. |
| Timeline and product shell | Implement the accepted mockup layout, thumbnail strip, drag/trim/snap/split/zoom and voiceover lane. Split/trim must preserve media timing and independent narration. |

The implementation contract and mode acceptance checks are in [the plan](STUDENT_PREVIS_IMPLEMENTATION_PLAN.md). The [alignment review](STUDENT_PREVIS_MOCKUP_ALIGNMENT_REVIEW.md) remains the source audit, now supplemented by this acceptance. These decisions do not imply the missing controls, two-camera modes, pose assets, DOF or remaining workflows are already implemented. Existing hosted/storage/platform/framing/narration-tail handling remains unchanged.


The first connected mockup slice is now implemented at `/student/?ui=editor`, including independent Shot POV/Scene inspection cameras. It introduces no new clarification question. Missing DOF, driving poses, occupant/door mappings and narration/Share/Export workflows are implementation work under the accepted decisions; they are not requests to narrow the agreed scope. Current evidence and remaining gates are in the progress record.

Accepted preset ownership clarification (23 October 2026): projects define entire
setups; presets inside them store object transforms/visibility and camera framing.
Preset selection must retain loaded project resources and cannot import objects.
Implemented without a new clarification requirement. The older independent-project
preset editing behavior is superseded.
