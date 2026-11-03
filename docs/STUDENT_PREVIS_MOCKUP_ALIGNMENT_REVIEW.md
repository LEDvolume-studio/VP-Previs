# Student previs: final UI mockup alignment review

Reviewed 23 October 2026 against the user's attached **Sim Trav / Country drive** mockup, the current source, and `STUDENT_PREVIS_IMPLEMENTATION_PLAN.md`. This is an assessment, not a UI implementation. No application code or live project data was changed for this review.

## Acceptance after review

The user accepted everything listed in this review and explicitly confirmed two modes: **Shot POV** and **Scene inspection**, with inspection navigation leaving shot framing unchanged. The recommendations below now inform the required implementation, rather than unresolved approval questions. Visible raster DOF, the named occupant poses, camera-only preset application and timeline additions are accepted scope; they remain unfinished capabilities. The [implementation plan](STUDENT_PREVIS_IMPLEMENTATION_PLAN.md) records the current two-camera contract and acceptance checks. Historical current-code findings below describe the audited single-camera implementation, not the final interaction contract.

## Finding

The renderer, scene-state contracts, local persistence, undo, catalogue and frame evaluator provide substantial reusable foundations. The current student presentation is still a development workbench. Achieving the mockup requires rebuilding that presentation and completing several editing capabilities; styling the existing page will not be sufficient.

The original plan supports the broad product: an interactive Rayzee scene, editable presets, shot sequencing, independent narration, sharing and MP4 export. It lacks a concrete visual and interaction specification for this editor. Some of the mockup also exceeds the implemented capabilities and the accepted initial rendering scope. Test counts and diagnostic export proofs do not establish that this UI has been delivered.

There is no useful evidence-based percentage for total completion. The appropriate reuse assessment is:

| Layer | Reuse assessment |
| --- | --- |
| Portable project state, validation, revisions, undo and recovery | Strong reuse; extend particular contracts rather than replace the foundation. |
| Actual scene loading, raster rendering, Rayzee navigation and LED evaluation | Strong reuse; add view modes, controls and missing render/asset capabilities. |
| Catalogue and immutable asset delivery | Strong reuse; distinguish camera presets from complete scene presets and finish thumbnail publication. |
| Current student layout, controls and timeline presentation | Substantial replacement/refactoring. The scrolling workbench is not the mockup editor. |
| Narration, Share and arbitrary-project Export | Foundations exist, but substantial product implementation remains. |

## What the mockup asks the product to do

- A compact header owns branding, project selection, save state, Share, Export and settings.
- A left panel shows a categorized, selectable two-column **camera preset** thumbnail gallery.
- A persistent central 3D viewer dominates the workspace, with camera/view selection, framing ratio, navigation tools, fullscreen and orientation feedback.
- A right inspector edits the selected shot using focal length, camera height, depth of field, focus distance, aperture, occupant role/pose and individual doors.
- A bottom timeline has a shared time ruler/playhead, duration-proportional shot thumbnails, drag reorder, trim handles, Split, snapping, zoom, transport and Add shot.
- An independent voiceover lane displays editable audio waveforms, microphone/recording access and gain/mute controls.

These areas should remain visible within an editor-height desktop layout. Side-panel content and timeline overflow should scroll within their own regions. The current project list, import/download tools, diagnostics and technical explanations belong in menus, dialogs or a development mode rather than occupying the main canvas workflow.

## Feature-by-feature comparison

| Mockup area | Current support | Required change |
| --- | --- | --- |
| Header and project menu | Local create/open/rename/duplicate/import/download and real committed-save feedback exist. They occupy several page sections. | Build the compact Sim Trav header and project dropdown. Move secondary operations into menus/dialogs. A cloud-shaped Saved icon must distinguish device save from actual online backup. |
| Overall composition | There is now a central scene/inspector grid, but it sits inside a long document with project sidebar, notices, forms and lists. | Replace the scrolling workbench with the mockup's bounded-height three-column editor and bottom timeline. Establish sizing, overflow, resizing and supported desktop breakpoints. |
| Camera preset gallery | Catalogue summaries already carry category and optional pinned thumbnail references. The student page renders text rows below the timeline. | Build the image grid, category navigation, selected tile and custom-camera state; publish the six intended camera views and their real thumbnails. |
| Applying a camera preset | Current preset action copies an entire scene snapshot into a new shot and appends a placement. | Add a distinct apply-camera-to-selected-shot action. A viewpoint click should not accidentally replace occupants/lights/LED or lengthen the sequence. Full-scene presets can remain a separate feature. This interpretation follows the mockup's label and should be made explicit. |
| Interactive 3D scene | Actual Rayzee CameraManager, WASD/mouse navigation, raster post stack and supported model/media loading are implemented. | Keep the runtime. Integrate a stable viewport surface into the new shell and remove diagnostic-page presentation from the ordinary editing experience. |
| View selector / orientation / toolbar | One selected-shot camera currently serves navigation. Framing masks and mouse pan work. There is no student view-mode dropdown, orientation cube or fullscreen button. | Separate shot-camera and scene-inspection modes; add the toolbar, orientation widget and fullscreen host. Define orbit versus free-look explicitly. Reuse existing admin patterns through student-owned adapters. |
| Focal length and camera height | Complete lens values are stored. The student form exposes FOV and XYZ position. | Expose millimetres and a dedicated height slider/number field. Update actual projection consistently with focal length/sensor settings. Define height relative to world/floor or an explicit scene anchor. |
| DOF, focus distance, aperture | Schema/native ports preserve these settings. The student inspector does not expose them, and the raster post stack does not render DOF. | This is a rendering requirement as well as a control-design change if the mockup's toggle is to affect the image. Add and verify raster DOF, or explicitly retain the earlier limited rendering scope. Do not present an inert toggle as a working effect. |
| Human role and Driving / Relaxed / Reaching | Supported student poses and bundled mannequin morph targets are standing and sitting. Root selection has no occupant-role metadata. | Supply real pose assets, versioned driver/passenger/seat mappings and schema/port support. New labels cannot create missing poses. Verify seated placement and hands/body against the vehicle. |
| Driver / passenger doors | Saved hinge transforms already render correctly; pure vehicle-door utilities exist. Student controls do not expose hinges. | Add individual door controls using verified hinge mappings and undoable snapshot edits. Map role names through vehicle handedness; left/right alone is insufficient. |
| Transport and selected scene | Real cuts, scrubbing, frame steps, play/pause/stop and LED timing now work. | Reuse the evaluator/controller, with the mockup's ruler/playhead, previous/next controls and synchronized selection presentation. Complete audio-clock/buffering and long-run acceptance. |
| Horizontal shot strip | Reorder, duration, duplicate and remove commands exist; UI uses vertical cards, numeric fields and buttons. | Implement proportional thumbnail blocks, selection, drag reorder, trim handles, ruler, snap and zoom. Preserve keyboard editing and one undo transaction per completed gesture. |
| Split / left-source trim | No split command or per-placement source offset exists. Right-edge duration changes are supported. | Define source-time and linked-shot semantics, then add atomic commands, schema/import compatibility and preview/export tests. A naive split restarts advancing LED video. |
| Voiceover lane | Independent offsets, sample trims/length, gain/mute and narration commands/evaluation exist. | Implement recording, recoverable media storage, waveform generation, audio playback, lane gestures, microphone/device/error states and upload/mix orchestration. This is substantial unfinished work. |
| Share | Private draft/security foundations exist. Full scene/media backup is still gated; no completed shared-snapshot viewer flow exists. | Implement exact-revision publication, dependency upload/verification, view links, viewer/copy/revoke and the corresponding dialog/progress/error states. |
| Export | Streaming H.264/AAC frame pump, codecs, cancellation/restoration and long fixture proofs exist. Main student-project export is not wired. | Connect the saved project and real narration mix to preflight/progress/cancel/download. The default diagnostic audio provider produces clicks and must not become the student soundtrack. |
| Scene imagery and previews | Real bundled studio/SUV/mannequin/LED assets demonstrate mechanics, with generated timecode media. | Author the actual driving scene, occupant poses and camera compositions shown by the intended product. Branding and thumbnail assets are also deliverables. Matching page chrome does not establish scene-image fidelity. |

## Behaviour changes that need explicit design

### Camera presets and Add shot are different actions

`addPresetShot` currently imports all dependencies, copies the complete shot snapshot and appends a timeline placement. That is useful for scene templates, but does not implement a camera preset selector.

Recommended interaction: selecting a camera tile applies the viewpoint/lens to the selected shot; **Add shot** creates an independent shot card using the current setup. Preserve current objects, lights, occupant/door state and LED configuration when applying a camera-only preset. Track camera-preset identity separately from whole-scene `sourcePreset`; after manual camera changes, the gallery should show Custom or no exact preset match.

The screenshot's selected Driver close-up tile, central Front three-quarter image and Shot 02 labels are illustrative rather than a coherent application state. The implementation needs one selection contract: active timeline placement, inspector target, viewer camera mode, shot label and preset-match indication must agree or clearly explain why they differ.

### Scene inspection must not accidentally reframe a shot

The latest implementation deliberately saves every completed WASD gesture into the selected shot. That matches the last written plan, but a Camera view dropdown suggests a distinction between the shot camera and an editor's free scene view.

Recommended distinction: **Shot camera** edits the shot's saved camera; **Scene view** uses a workspace camera for inspection without modifying the shot. Whether this is the intended dropdown behaviour is a design clarification, not something a still image establishes. Existing EditorViewManager is useful, but its orthographic/editor cameras must not be confused with the supported saved perspective-camera contract.

### Shot cards need predictable independence

The data model separates shots from placements. Duplicate placement currently reuses the same shot, so editing either placement changes both. The mockup presents each block as an individual shot.

Recommended default: newly added or duplicated visible shot cards have independent editable snapshots. Keep linked placements only if their relationship is made explicit. The existing model can support this policy without discarding shot/placement separation; atomic add/duplicate/split commands should enforce it.

### Split and trim must preserve time-dependent content

Today each placement starts its shot's LED time at local frame zero. Splitting it into two placements would restart a playing background at the cut. Left-edge source trimming raises the same issue.

One clean extension is a per-placement source offset, defaulting to zero for existing projects. A split preserves total duration and gives the right segment the old offset plus the cut position. Update validation/migration, evaluation, commands, backend acceptance and preview/export together. Alternatively, independent shot copies can carry adjusted media in-points, but that has different linkage/editing semantics and needs a deliberate choice.

Right-edge duration editing and drag reorder can already use existing commands. Snap, ruler scale and timeline zoom can initially remain workspace UI state. Display seconds as required while persisting integer frames at the accepted 25 fps; labels such as 3.5 s can be rounded displays of frame-aligned durations.

### DOF and pose buttons change capability scope

The accepted initial plan allowed preserving DOF without rendering an additional raster effect. The mockup makes DOF a prominent editable feature. A functional interpretation therefore expands rendering acceptance: the effect must be visible, match preview/export and meet the target-machine budget.

Driving, Relaxed and Reaching also expand the currently supported asset/schema capabilities. They require actual pose data and occupant/vehicle anchors. Do not implement them as cosmetic aliases for Sitting.

Multiple occupant roles also need independently mapped instances. Current scene definitions map model roots and restrict duplicate immutable model entries; the current runtime exposes a human flag rather than driver/passenger/seat identity. Establish explicit repeated-instance packaging and versioned role mappings before treating a role dropdown as supported (`StudentSceneDefinition.js:48`, `:78`; `PublishedShotViewport.js:302`).

## What to retain, adapt and replace

**Retain:** StudentProjectSchema, command validation/undo, StudentProjectRepository, the catalogue/integrity/version rules, ShotSceneAdapter/ThreeShotPorts, native CameraManager navigation, supported model/LED loading, SequenceRasterAdapter/evaluator and the bounded MP4 frame pump. Extend their contracts only where the required behaviour needs it.

**Adapt:** ShotPreviewController into the stable editor-view/shot/transport boundary; camera edit helpers into focal-length/height controls; catalogue metadata into scoped camera presets; pose/door capabilities into semantic occupant/hinge controls; current save status into the compact header.

**Replace/refactor:** The monolithic `main.js` presentation, repeated whole-shell `innerHTML` replacement, long-page layout, Apply-form inspector and vertical timeline UI. Keep the GPU surface mounted across ordinary UI changes. Sliders and drag gestures need transient live state, cancellation, one completed undo step and the planned persistence checkpoints, without rebuilding the whole editor or losing focus/pointer capture.

React and the existing app UI primitives are available, so an isolated component-based student shell is a practical option. This does not require mounting the admin store or duplicating the renderer. Reuse presentation primitives and extract adapters from stateful admin components.

Useful existing references:

- `app/src/App.jsx:266`: full-height/resizable editor layout.
- `app/src/components/ui/resizable.jsx:6`: panel primitives.
- `app/src/components/ui/items-catalog.jsx:22`: image/category gallery pattern; adapt its admin favourites and selection dependencies.
- `app/src/components/layout/TopBar/TopBar.jsx:33`: project/status/header pattern; adapt its admin session dependencies.
- `app/src/components/layout/RightSideBar/CameraTab.jsx:301`: focal-length and DOF control patterns.
- `app/src/components/layout/RightSideBar/PosesTab.jsx:134`: selected image-tile pattern.
- `app/src/components/layout/Viewports/ViewportToolbar.jsx:158`: fullscreen and screenshot interaction patterns.
- `rayzee/src/managers/EditorViewManager.js:42`: separate editor-camera foundation.

## Changes needed in the implementation plan

Keep completed technical foundations and their regression evidence. Add an explicit mockup delivery contract before further UI expansion:

| Plan area | Necessary amendment |
| --- | --- |
| Product/acceptance definition | Make the supplied mockup the visual reference. Specify panel geometry, persistent viewport, selection ownership, view modes, preset scope, gesture/undo rules and responsive behaviour. Review a connected shell before building more controls. |
| Phase 6: catalogue | Distinguish complete scene presets from camera-scoped presets. Add real thumbnail capture/publication and semantic scene/occupant/door capability metadata. |
| Phase 7: authoring | Require the pictured focal-length/height inspector, door controls and intended pose assets. Resolve visible raster DOF against the earlier preservation-only decision. Add separate inspection-camera mode where intended. |
| Phase 8: timeline | Add thumbnail cards, time ruler/playhead, drag reorder/trim, snap, split and zoom explicitly. Specify independent-card defaults and source-time continuity. Add visual/gesture tests rather than relying on equivalent buttons. |
| Phase 9: narration | Existing planned waveform/record/trim/gain/mute scope remains appropriate; connect it to the visible independent lane and shared transport. Implement real media persistence and audio scheduling. |
| Phases 5/10/11: save/share/export | Retain device/cloud status distinctions and existing hosted limits. Implement the header actions as full workflows, not decorative buttons over diagnostic proofs. |
| Phase 12: acceptance | Add screenshot comparison against the mockup at agreed desktop sizes and a real end-to-end workflow using the pictured controls. Retain the original platform, audio/video, persistence and admin-regression gates. |

Suggested next delivery order:

1. Write the small interaction contract and build the mockup shell around the existing live viewer, real project menu/save status and selected-shot state. Review layout and selection before expanding features.
2. Connect the camera thumbnail gallery, focal-length/height inspector and explicit Add shot behaviour. Preserve undo/save through real gestures.
3. Deliver the horizontal timeline and its source-time/independence rules, including split and trim.
4. Supply the required pose/door mappings and decide/implement raster DOF according to the clarified scope.
5. Complete the voiceover lane and audio transport, then project Export and Share, preserving existing security/offline/platform gates.

## Review questions resolved

The user accepted all four review recommendations: separate inspection and shot cameras, camera-only preset application with independent Add shot, visible DOF, and real Driving/Relaxed/Reaching capabilities. The remaining work is implementation, asset authoring and verification under the accepted contract. No mockup decision from this review remains a product blocker.

## Source evidence and verification limits

The comparison is based on source inspection and three independent assessment agents, not a new implementation or a fresh full test run.

| Evidence | Relevant location |
| --- | --- |
| Current UI and whole-shell replacement | `app/src/student/main.js:565`, `:571`, `:583`; `app/src/student/student.css:13`, `:23`, `:63` |
| Camera navigation currently authors the selected shot | `app/src/student/main.js:136` |
| Entire-scene preset insertion | `app/src/previs/domain/StudentCommands.js:127`; `app/src/student/main.js:374` |
| Catalogue category/thumbnail support | `app/src/previs/domain/StudentCatalogueSchema.js:6`, `:40`, `:84` |
| Current inspector fields and supported poses | `app/src/student/ShotEditor.js:22`; `app/src/previs/domain/StudentProjectSchema.js:169`, `:198` |
| Native projection authority / lens metadata | `app/src/previs/engine/ThreeShotPorts.js:149`; `app/src/previs/domain/StudentShotEdits.js:86` |
| Raster effects versus path-traced DOF | `rayzee/src/managers/RealtimeRenderer.js:332`; `rayzee/src/TSL/CameraRay.js:115` |
| Current runtime and capability inventory | `app/src/student/PublishedShotViewport.js:134`, `:302` |
| Reorder/duration/shared-placement commands | `app/src/previs/domain/StudentCommands.js:179`, `:185`, `:205` |
| Strict placement fields and local LED time | `app/src/previs/domain/StudentProjectSchema.js:394`; `app/src/previs/sequence/evaluateSequence.js:42` |
| Narration metadata/commands, absent recording store | `app/src/previs/domain/StudentProjectSchema.js:443`; `app/src/previs/domain/StudentCommands.js:217`, `:251`; `app/src/previs/persistence/StudentProjectRepository.js:9` |
| Backup dependency limitation | `app/src/previs/sync/PrivateDraftBackupService.js:187` |
| Export proof and diagnostic default soundtrack | `app/src/previs/export/RasterMP4Exporter.js:21`, `:40` |

Latest recorded technical verification in `/tmp/previs-interactive-delivery-*.log`: **2,139 tests / 145 files**, build success and lint with zero errors/70 existing warnings. `/tmp/student-previs-interactive-delivery-20261023/report.json` records ten passing hardware integration groups covering real WASD, saved edits, scene cuts, media timing, storage failure/retry and bounded resource reuse. These support reuse of the foundations. They do not verify the mockup's missing gallery, gestures, poses, DOF, narration, Share or student-project Export.

The supplied mockup is an attachment to this conversation; this review does not invent a repository image path for it. No GUI rewrite, asset change, schema migration, push or deployment was performed for this assessment.
