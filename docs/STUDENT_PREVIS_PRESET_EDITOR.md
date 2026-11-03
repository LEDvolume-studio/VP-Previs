# Admin preset editor

Open http://localhost:5173/ and choose **File → Open Default Project**. This opens
the student studio scene in its own saved admin workspace and selects **Presets**
in the right sidebar. **Open student default project** in the Presets tab opens
the same workspace. The welcome scene and other working projects are preserved.
Student review: http://localhost:5173/student/?ui=editor.

## Fixed photographic viewport

Both editors use a 16:9 photographic gate. Admin preview zoom scales its actual
layout width and height together, and its wrapper cannot flex-shrink one axis.
The same gate is used for orthographic editor views; changing the browser or
sidebar size changes display scale only. Ordinary output resolution changes retain
16:9; 4:3 and 2.40:1 framing use 50% transparent masks. The separate explicit
360-degree equirectangular export retains its native 2:1 format.

Project hydration normalizes old photographic canvas dimensions. Admin preset
restoration and the shared camera read/apply ports enforce the 16:9 camera aspect
while retaining the saved pose and vertical FOV. Older preset/shot documents with
window-derived camera aspects therefore render correctly on the student canvas
without requiring a destructive library migration. New captures and regenerated
thumbnails use the corrected gate. Existing thumbnail image bytes are retained
until the preset is updated, when its thumbnail is regenerated.

`tests/browser/previs/viewportAspect.browser.mjs` checks browser layouts, overlay
opacity, legacy preset restoration, saved thumbnail dimensions and equivalent
student rendering of a legacy aspect and its corrected reference.

The **Student presets** gallery reads the same preset repository as the student
editor, including presets created in other projects. Local development shares
changes across tabs on the same origin; published builds use the cloud catalogue.
The initial workspace comes from the Wide student preset (or the first available
preset); subsequent openings restore the saved admin workspace. It does not edit
an individual student's timeline project.

A project owns an entire setup (car studio, house, etc). Many presets within it
record positions, visibility and camera framing. Selecting a preset updates the
loaded objects in place when their inventories match. In the shared student
workspace, choosing a preset with a different inventory loads its saved authoring
scene so that it can also be edited.

- **Update preset** saves the current positions/visibility as a new revision.
- **Save new preset** adds another preset to the current project.
- **Rename preset** updates the selected library name.
- Each preset card has a trash button, labelled **Delete preset [name]**, which
  works without applying that preset. The selected preset also has a **Delete preset**
  button. **Confirm deletion** removes it from both galleries; **Cancel** keeps it.
  Existing student shots, immutable revisions and their assets remain available.
  Removed development seeds stay removed after reload.
- Each save automatically renders a 480 × 270 JPEG thumbnail using the student renderer.

Use normal editor object tools to move/rotate/scale objects and toggle visibility.
Models, materials, environment, poses and media belong to project editing. Presets
do not load or replace those resources. Existing presets referencing removed
objects are rejected before any state is applied; update them from the current
scene. New objects retain their current state until a preset is updated.

## Application and ownership

Ordinary projects link their presets in `extensions.projectPresets`. A preset
records node position, rotation, scale and visibility, light positions/targets, intensity
and visibility, and camera framing. Selecting a preset applies that state to
existing objects. It never opens/creates another project, reloads models or media,
changes materials/environments, or calls the scene rebuild path. Only changed
model transforms need acceleration-data refits; visibility updates use the existing
GPU visibility buffers. Camera-only changes retain all scene resources.

Projects own their model inventory, materials, environment and media. Use project
editing to add/remove objects or change those resources. Presets cannot introduce
missing objects: selection rejects incompatible state before changing anything.
New objects added later keep their current state until that preset is updated.
All authored nodes, including hidden parents and children, are captured.

Existing legacy presets are adopted once only when the complete asset inventory
and node paths match the loaded project. Their positions are mapped to the existing
instance IDs; their materials/media/other project settings are never loaded.
Unrelated house/car setups stay separate in ordinary projects. Selection and rename
there are scoped to the current project's preset links. The student library
workspace carries `extensions.studentPresetLibrary: true`: it lists the complete
student library, remaps compatible scenes even if already initialized, and permits
updating the original preset revision from this workspace. Ordinary project persistence/export retains these
links and lightweight state snapshots.

Cloudflare D1 continues storing published preset revisions, including the owning
project ID and lightweight `projectPresetState`; R2 retains project delivery files
and automatic thumbnails. Full portable student snapshots remain publication
artifacts for compatibility, not admin projects to hydrate. Project opening alone
reconnects pinned LED media. Published state for the same project can be discovered
on refresh; legacy libraries remain preserved.

In the student editor, applying a preset or adding a preset shot requires the
existing project model inventory. Legacy scene IDs can be mapped through identical
verified model hashes and glTF node indices. The shot takes object/light/LED transforms and camera
framing while retaining the current project's model identities. LED walls also take
the selected preset's saved video, in-point, play/freeze mode, looping, playback
rate, brightness and presentation settings. The existing display mesh binding is
retained after node mapping. Referenced video metadata joins the project in the
same undoable edit; other shots are unchanged. A preset requiring different models or ambiguous instance mappings is rejected
before any change. Existing historical shots remain intact.
The initial choice in an empty student workspace still loads its scene once.

## Saving and student updates

Saving verifies the project delivery assets through CaptureAdminPreset, then
renders its thumbnail. The full portable delivery snapshot remains available for
opening the student project initially; admin selection only reads lightweight
state. Capture pauses navigation and playing LED media temporarily, restores them
in finally, and rejects scene changes during preparation. Revision guards and
exact uncertain-save retries preserve existing cloud persistence guarantees.

The student library receives committed names, cameras and thumbnails immediately
across local tabs, or every 15 seconds/on focus from Cloudflare. Preset thumbnails
apply object transforms, visibility, light position, intensity and visibility and camera framing to
the selected shot in one undoable command. Use scene preset adds transform state as a new shot in
the existing setup, retaining materials and light objects and applying its saved
LED video settings. It rejects
an incompatible model inventory. Existing student timeline shots stay independent
of later library revisions.

Student playback first checks downloaded plate files for an exact size, duration
and SHA-256 match to the saved video asset. Matching OPFS files decode directly
under a shared playback lease; names alone cannot select a view. When no matching
download exists, the immutable preset catalogue supplies the video. The catalogue
resolver can combine an older demo scene with newly saved preset media, so existing
student projects no longer retain the LED timecode placeholder after applying a
plate preset. No new upload or preset resave is required for existing saved video
references.

The student editor's timeline owns LED playback time: at timeline frame N the
selected angle displays source frame N at 25 fps, including while paused or
scrubbing. Shot cuts change the camera/view without restarting the drive. Admin
preview pause, in-point and speed remain saved for standalone preset previews but
do not offset or freeze timeline playback. A nonlooping source holds its last
complete frame after its end; an explicitly looping wall wraps. Existing saved
student projects receive this behavior without migration or preset resaving.

Transitions retain the student viewport, geometry, LED material and texture when
the scene inventory matches. A newly selected video prepares on that viewport
while the previous picture stays visible. Playback verifies/opens upcoming media,
warms exact timeline cut frames, and precompiles shot variants before starting its
clock. Shot application stages the evaluated media time directly, avoiding an
extra decode of the admin calibration frame at every cut.

The 128 MiB encoded-media budget applies to catalogue videos retained as in-memory
bytes. Verified OPFS Files are read lazily under playback leases and do not count
their entire on-disk length as resident memory. All four large downloaded angles
can therefore stay prepared together; decoded frame caches remain bounded to four
frames per source. Preparing an incompatible scene still requires its own scene
resources, and verification failures preserve the existing viewport rather than
silently replacing it.

## Cloudflare storage

Production builds use **Cloudflare D1** for preset names, immutable revisions,
portable scene state and protected admin editing documents. **R2** stores verified
models, media, HDRI files and thumbnails. One guarded D1 transaction updates both
the editable record and public student catalogue. Public student reads exclude
the admin editing document. Existing password/session and Australia-only edge
rules remain in force.

`CloudAdminPresetRepository` uses the protected preset editor API and asset upload
client. `CloudStudentPresetRepository` uses only the public catalogue. Production
always selects cloud storage, including when a local override is supplied; there
is no silent device-only fallback after a server error. Development defaults to
IndexedDB and supports `VITE_PRESET_STORAGE=cloud` for integration testing.
Fresh students can start a project directly from a published scene preset.

Apply migration `0006_preset_editor.sql` alongside the earlier migrations and bind
the intended D1 database and R2 library when deployment is authorized. Exact
configuration, activation flags and database limits are documented in
[backend/PRESET_EDITOR.md](../backend/PRESET_EDITOR.md). Automatic development
seeding does not run in production. Existing local development records are not
automatically uploaded to a different hosted origin; initial hosted catalogue
population remains an explicit deployment data step. No hosted migration,
push, release or deployment has been performed.

Verification and artifacts are recorded in STUDENT_PREVIS_PROGRESS.md. New
reproducible checks are the local-preset repository native browser suite and
`tests/browser/previs/adminPresets.browser.mjs`, plus the extended student editor
browser suite and capture/controller tests.



Light intensity is part of preset state, including an explicit value of zero.
Position and visibility remain independent: a hidden light retains its saved
intensity and a visible light can have zero intensity. Both preset-tile application
and adding a preset shot restore these values on the existing student lights.
Older admin lightweight records recover omitted intensity from their immutable
saved editing document; no database migration or manual resave is required.
