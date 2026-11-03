# Student interactive scene workspace

The separate `/student/` entry centres Rayzee's interactive 3D viewer, with a scene inspector and sequence timeline around it. It uses the student domain, native IndexedDB repository and shared sequence evaluator without importing the admin store. Rayzee's native `CameraManager` owns navigation on the visible canvas: hold the right mouse button with WASD to fly, Q/E to move down/up, Shift to move faster and the wheel to change speed; middle mouse pans. Presets and timeline controls recall camera, object, light, pose and LED state in this same viewer.

This follows the user's explicit clarification on 23 October. Earlier descriptions of a selected static start-frame preview and a timing-only cursor are historical foundation behaviour, now superseded. A supported saved setup loads into the interactive viewer; timeline cuts, scrubbing, play, pause and stop now display evaluated scene state and LED time. This does not complete the remaining narration, cloud backup, sharing, verified offline media or production export interfaces. See the progress record for current test evidence and acceptance limits.

**Accepted target after the mockup review:** the viewer has **Shot POV** (navigation edits the selected shot camera) and **Scene inspection** (a separate workspace camera whose navigation never changes shots). Returning to POV restores the selected shot camera. Explicit scene edits still target the selected shot in either mode. Inspection viewpoint state is excluded from project/export camera state. The current implementation described below still uses one authoring camera; this two-mode behaviour is required next work, not an implemented capability. See the accepted contract in the implementation plan.

A configured same-origin teacher catalogue provides editable preset copies; loading it is explicit and optional. In development only, **Open local demo scene** creates a locally saved two-setup sequence using the actual bundled studio, SUV, mannequin and LED GLBs plus a stable generated timecode video. This is review data, not a teacher publication, hosted catalogue or student upload. A saved local demo can reopen with the same verified asset identity without replacing its edits. Production builds omit this development action.

`/student/diagnostic/` remains a separate raster export fixture; `/student/scene/` remains a separate actual-asset scene/transport/export integration fixture in the normal build. The isolated build omits its link because it excludes bundled models. Production builds register the separate student shell service worker; its installation/control status appears in the footer. Development mode does not register a service worker. Shell availability never claims that referenced models/videos are cached or offline-ready.

Implemented local workflows:

- Create, list, open, rename, and duplicate sequences; download portable student JSON; validate/import student JSON under a fresh project ID and revision zero. Invalid imports leave the open project intact. Downloads include metadata and media references only, not media bytes.
- Save completed edits to the real IndexedDB repository. Camera navigation saves the selected setup after controls release and a 120 ms settling interval; pending navigation is flushed before another edit or project download. Show “Saved on this device” only after the transaction commits, and always say that cloud backup is not connected. Selection, scrub, transport and download add no revision of their own; flushing an outstanding camera gesture is an authoring save.
- If a save fails, retain the attempted document in memory, pause editing/project switching, offer JSON download and retry. Warn on closing a tab with an attempted unsaved edit. A schema upgrade pauses editing and requests reload.
- If another tab wins a revision race, keep the repository's durable recovery copy, offer restoration into a fresh project, or open the latest saved original. Reopening an original also lists its preserved recovery copies. Recovery records are not deleted by restoration.
- Create explicitly empty custom shots with a complete camera snapshot and empty scene; independently duplicate shot snapshots. These are not teacher presets and do not imply that assets have rendered. Imported snapshots are preserved; selecting a supported setup loads its verified models and media into the central viewer. An empty setup reports that it has no scene models.
- Insert, duplicate, remove, reorder, and change integer frame durations of timeline placements. Duration controls enforce the shared 22,500-frame limit. Deleting a shot requires removing its timeline placements first. Removing clips preserves orphaned narration records as the domain specifies.
- Undo/redo completed commands using new monotonically increasing revisions. Undo history is limited to the current open tab/project. Creating an empty custom shot atomically adds its immutable base-scene version and shot in one saved revision and one undo step; undo removes both, and redo restores both.
- Load/refresh the available teacher catalogue with ETag revalidation. Copy a complete immutable preset, its dependencies and a default-duration placement as one saved edit/undo step. Version identity collisions fail explicitly. Catalogue errors never change local save status; copied content needs no network to reopen, but referenced model/video bytes are not cached.
- Load a selected saved setup through its registered scene mapping and verified model/video bytes into Rayzee's interactive viewer. Actual poses, doors, lights, LED content and framing are applied. Close or switch projects to invalidate it. Compatible saved edits reuse the prepared viewport after the transaction commits. Loading/cancellation/error handling is separate from local-save revisions.
- Scrub, step and play/pause/stop at 25 fps using the shared evaluator's half-open frame ranges and exact end state. Cuts apply complete shot state in the same viewer; held shots update time-dependent LED media. Transport does not save evaluated playback as authoring edits. Narration playback remains a separate unfinished integration.

Run the browser regression with the isolated Vite server running:

```sh
npx vite --config app/vite.previs.config.js --host 127.0.0.1 --port 5177
node tests/browser/previs/studentUI.browser.mjs
```

`STUDENT_TEST_ORIGIN` can select another running server, and `CHROME_PATH` can select a Chromium executable. The test uses real Chrome interactions, downloads, IndexedDB, two tabs, a disconnected network, and injected native transaction failure. It does not use a memory persistence mock.

Historical foundation verification on 22 October 2026 used Chrome 155.0.8059.85 against the production MPA output, including `student/sw.js`: all six browser workflow groups passed. Direct `/student/` reloads, local failure/retry, conflicting-tab recovery, real JSON downloads/imports, the then timing-only transport, and a 390-pixel viewport passed. Those checks do not establish the subsequent interactive-viewer behaviour; current evidence is recorded in the progress document. Prefer a built preview for this suite during parallel development so Vite source reloads cannot interrupt browser interactions.

Next integration work: live admin capture controls, remaining supported scene authoring,
verified offline media preparation, and private recovery UI. The user retained
the remaining policy/platform/tail handling on 23 October; see the decisions
record, rather than treating these implementation gaps as new questions.

23 October catalogue browser integration: `npm run test:previs:catalogue` builds
no application source; run `npm run build` first. It starts an isolated same-origin
HTTP bridge to the actual Worker/D1/R2 and serves `app/dist`. Five workflow groups
pass in Chrome 155: empty catalogue, byte registration/publication visible without
rebuild, escaped metadata/ETag handling, atomic copy/undo/redo, version/hide with
pinned copies, and native offline reopening. Passwords are ephemeral test data;
no real credentials or hosted service are used. Admin publication in this harness
is via the API, not a completed teacher capture/publishing screen.


23 October supported-scene continuation adds five native GPU/publication groups
in `npm run test:previs:published-scene`. The admin screen at
`/admin/student-presets/` reviews prepared v2 JSON and exact source files, publishes,
retries an uncertain committed response unchanged, and hides/restores availability.
A separate anonymous student workspace renders two published actual 97-mesh shots
without editing its saved revision; cancelled preparation, missing media, repaired
retry and initial edit invalidation pass. The subsequent authoring continuation below replaces edit invalidation with compatible viewport updates. Full contract and remaining boundaries:
[STUDENT_PREVIS_SUPPORTED_SCENES.md](STUDENT_PREVIS_SUPPORTED_SCENES.md).


## Saved-shot authoring continuation — 23 October

The scene inspector for a supported saved setup offers camera
position/target in metres, vertical FOV, exposure and framing; mapped model-root
position and standing/sitting human poses; existing light intensity; and LED
freeze/play, 25 fps source in-point, loop and nits. Source media stays pinned to
the preset version. Model selection uses verified scene-root capabilities, rather
than guessing from arbitrary imported node IDs. Unexposed rotation, scale, door,
lens, appearance and media-placement fields are preserved. Exposure-only changes
preserve authored camera roll and focal length; untouched sub-frame LED in-points
keep their exact microseconds.

Each Apply is a complete replacement command with whole-document validation,
immediate native IndexedDB commit and one undo step. All placements sharing that
shot use the new state. The old picture is hidden while saving or updating. A
failed transaction retains attempted fields, disables editing and offers retry
or download; retry can reuse the prepared scene after a durable save. Rendering
errors after commit report an unavailable picture without claiming the save
failed. The original form-only slice introduced no continuous drag controls; the
subsequent native navigation integration now saves completed camera gestures as
described above. It does not claim that a tab termination before the settling
save can preserve unacknowledged movement.

Compatible revisions retain the canvas, GPU renderer, models and decoded media.
A frozen evaluator for the saved revision replaces the old evaluator. Updates
and frame rendering serialize; cancellation drains native work, and failed
updates restore the previous successful state or require reload after failed
rollback. Missing/deleted/incompatible selected shots clear the picture. Unchanged
LED configurations retain their native material/texture/canvas identities while
still decoding and staging the required saved times.

This remains a partial Phase 7 authoring slice. Door controls, root rotation, light
creation/position/colour, library source selection, a supported custom-base-scene
path and verified offline media remain. The subsequent interactive-viewer
continuation implements rendered timeline cuts/scrub/play/pause/stop; broader
transport performance, audio integration and platform acceptance remain gates. Other
unapplied forms are reset when the workspace rerenders; use each form's Apply
before editing another category.
