# Supported published scenes and interactive student viewport

23 October 2026. The immutable catalogue resolves supported models/media into the
main interactive student scene viewer. It uses Rayzee's existing CameraManager
controls on the visible canvas. Presets and timeline placements apply complete
scene state in this same viewer. Earlier saved-frame-only descriptions are
superseded by the user's explicit clarification and the interactive continuation.
Hosted data stays disabled; narration and production project MP4 export remain
open.
## Complete versioned scene identity

Existing `rayzee-student-preset` schema v1 remains readable and copyable. Schema
v2 adds one required `sceneDefinition`, containing only portable identifiers:

```js
{
  format: 'rayzee-student-scene', schemaVersion: 1,
  baseScene: { sceneId, version, assets: [ { assetId, version } ] },
  models: [ {
    asset: { assetId, version },
    nodes: [ { instanceId, nodeId, gltfNodeIndex, expectedName } ]
  } ],
  humanPoseRoots: [ /* explicitly mapped model root IDs */ ]
}
```

Each model has exactly one null-index/null-name scene-root mapping and complete
unique glTF-index/name mappings. Models exactly cover the immutable base scene;
URLs, file paths and runtime Three.js UUIDs are absent. V2 snapshots must cover
all nodes, use explicit raster appearance and perspective projection, express
doors through hinge transforms, and identify supported human roots and LED mesh
nodes. The first capability supported no HDRI asset. The current viewport also
supports verified bounded HDR/EXR assets and mapped embedded material overrides;
see [renderer parity](STUDENT_PREVIS_RENDERER_PARITY.md). Unsupported environments,
projections, scalar door angles and stale/incomplete inventories fail explicitly.

`SupportedGLB.js` supplies one DOM-free preflight shared by server publication,
local preparation and the verified loader. It checks complete JSON/BIN chunk
bounds, embedded-only resources, supported extensions, hierarchy, mappings,
accessor spans/strides/sparse data, tagged standing/sitting morph support and a
single triangle mesh with the selected UV channel for each LED display. Clients
still verify SHA-256 and exact size before parsing. A preflight is a supported
subset, not certification of arbitrary glTF or all future material/texture cases.

Technical bounds: 64 MiB per model container, 128 MiB scene containers, 8,192
mapped scene nodes and 64 models/lights. Decoded accessor checks independently
bound each accessor to 64 MiB and their declared sum per model to 128 MiB.
Selected-shot video downloads have a 128 MiB aggregate bound. These limits are
not total browser/native/GPU residency measurements or production school quotas.

## Atomic publication and resolution

Migration `0005_supported_scenes.sql` stores immutable supported definitions and
extends the existing publication transaction. Before a v2 commit, the backend
reads and hashes the actual server-owned bounded GLBs, validates capabilities,
and rejects a different definition claiming the same scene ID/version. The
preset, supported definition, base-scene record, head and replay receipt commit
atomically. Concurrent conflicting definitions cannot leave a partial winner.
V1 metadata-only presets do not acquire a render capability by inference.

`GET /v1/catalogue/scenes/:sceneId/:version` returns exactly
`{sceneDefinition, assets}`, with only its model metadata, a strong ETag and
conditional 304 after storage checks. `StudentCatalogueClient.getScene()` validates
identity/content and retains defensive bounded metadata copies. `getAssetBytes()`
constructs only catalogue asset routes and verifies exact MIME, length and hash;
it retains no raw-byte cache and cancels unread/aborted responses. No imported
project URL becomes fetch authority. Private draft dependency acknowledgements
remain conservative and are not broadened by this work.

## Prepared admin capture and publishing

`prepareStudentPresetPublication()` composes byte verification, supported GLB
preflight, stable live-port capture and the existing authoritative admin
converter. It preserves unsupported-field/material/environment diagnostics,
checks revision/binding stability through asynchronous work, retains no model
byte map, and returns detached v2 content or structured diagnostics. The host
must suspend edits/transport around capture. The additive converter path accepts
an explicitly absent environment; it still rejects an unmapped non-null HDRI.
This reusable capture service is not yet wired into a live editor capture button.

The normal build adds `/admin/student-presets/`, linked from the admin Projects
dialog. It uses the existing shared-password cookie and is protected by the same
Pages admin-route checks. It accepts prepared **v2 preset JSON**, never a raw
admin project. Select exact source files, then review/preflight models and video
duration, inspect metadata, and explicitly publish. It uploads verified bytes and
submits a frozen canonical operation with its original head precondition and
idempotency key. An uncertain response offers **Retry exact publication**; it does
not silently refresh the head or overwrite a competing edit. Head refresh and
hide/restore controls preserve existing student copies. A replay receipt is not
presented as the current head.

Prepared operations and file selections currently live in the open tab. Refresh
requires reselecting the source files and inspecting the current published head;
there is no cross-restart publisher operation journal. Full capture/draft/thumbnail
preview/catalogue administration UX remains open. Hosted service activation,
password provisioning, retention/quotas and deployment were not performed.

## Main workspace rendering and ownership

Each shot offers **Edit setup**, and opening a supported project selects its scene automatically. A lazy app-owned runtime resolves its
published immutable mapping, compares saved model metadata, loads verified GLBs,
prepares native poses, canonical lights and camera, decodes referenced LED videos,
and applies the complete snapshot through the existing transactional ports. It
uses `RealtimeRenderer` and the existing GTAO/SSR/bloom/SMAA stack, copies the
frame synchronously to a 1920 × 1080 canvas and composites the accepted 50% bars.
LED duration is compared with the actual decoded track within 1 ms before use.
Setup selection starts at local frame zero. Timeline cuts/scrubs/steps/playback
apply the evaluated shot and local media time in the same viewer. Interactive
WASD/mouse movement paints the live camera without reapplying the saved shot on
each frame. Completed gestures save through the workspace command path. There
are no admin stores or BVH builds in this runtime.

Preview alone never writes an edit revision. Completed edits hide the picture
until the device save commits, then compatible revisions update the retained
viewport. Project switching and closing abort preparation and invalidate it. The
controller drains old preparation/teardown before starting a replacement, so a
late model/decode result cannot attach a stale canvas. Cleanup attempts all owned
media, decoder, post-processing, controls, model and renderer resources. Failed
teardown blocks another preview until reload. Missing or corrupt media produces
an error while device-saved content and local save status remain intact.

Lazy student rendering dependencies are added by exact bytes/hash to the public
edge manifest, including their static/dynamic dependency graph. Admin publisher,
admin editor and engineering HTML remain private. The offline shell precaches
only its static editing graph; permitting online preview code does not cache
models/videos or claim offline pictures. No broad public JavaScript suffix rule
was introduced.

## Native proof

Run `npm run build`, then `npm run test:previs:published-scene`. The harness starts
an isolated same-origin bridge to the actual Worker/Miniflare D1/R2 and serves
current `app/dist`; no account, real password or deployment is used. It captures
two reference frames from the existing 97-mesh studio/SUV/mannequin/LED fixture,
registers actual bytes, and publishes v2 snapshots. A separate admin cookie jar
reviews files and publishes through the new screen; the student uses anonymous
catalogue reads. It then checks main-workspace pictures against those independent
fixture frames, visible frozen/playing LED pixels, revision isolation, cancellation,
missing-media failure and retry.

Initial final-build hardware run passes on Chrome 155 / base Apple M5. Mean
sampled RGB differences from the independent reference are **0.0588** and
**0.0660** on a 0–255 channel scale; both preserve actual pose, doors, LED content
and framing. PNGs and report: `/tmp/student-previs-supported-publication-20261023/`.
The later receipt-loss/hide-restore rerun is recorded in the progress document.
These are generated timecode videos; real teacher-library and microphone
acceptance, remaining Chrome/Edge Windows/macOS checks, full native/process memory
and the intermittent admin BVH startup investigation remain open.

The final rerun extends that proof through the actual all-route Pages middleware,
backed by the final built asset graph: admin publisher and engineering routes need
the shared session, while the anonymous student imports exact authorized lazy code.
It passes all five native groups, including genuine publication-response loss,
unchanged receipt replay and hide/restore. Final mean RGB differences are 0.0589
and 0.0634; artifacts are `/tmp/student-previs-supported-edge-20261023/`, with log
`/tmp/previs-supported-edge-browser-20261023.log`. No hosted site was changed.
The post-order manifest fix is also exercised by the current built offline harness,
which now independently rehashes every public asset before launching Chrome.


## Saved-shot editing and compatible updates — 23 October

Main-workspace forms now edit the supported shot camera, model-root positions,
standing/sitting human pose, existing light intensity and LED mode/in-point/loop/
brightness. See [workspace behaviour](STUDENT_PREVIS_STUDENT_UI.md). These are
local completed commands with immediate save and undo/redo, not continuous
viewport dragging or a complete Phase 7 editor.

`ShotViewportCompatibility` pins the prepared immutable base scene/model metadata,
node mappings, native light IDs/types, wall/display IDs and already decoded media
versions. Unrelated project assets and shots do not force a reload. The runtime
also preflights every concrete native port. Compatible updates retain the renderer,
loaded models and decoders and replace the frozen sequence revision. Unknown
versions, unsupported native state or changed scene inventory require explicit
preparation. No compatibility shortcut skips complete document validation.

`ShotPreviewController` serializes update/close/prepare, hides suspended or failed
pictures, freezes requests and prevents stale completions from attaching. Save
acknowledgement precedes picture refresh; refresh errors cannot become false
storage-failure/recovery messages. Runtime failures repaint the previous
successful shot/time, or mark the runtime unusable if restoration also fails.
An exact unchanged-wall path avoids material/texture/canvas churn while staging
all requested decoded times before committing any wall pixels.


## Interactive navigation and shared scene transport — 23 October

The student runtime now binds the existing Rayzee CameraManager to the visible
canvas and uses an app-owned navigation driver. RMB/WASD/QE/Shift/wheel and
mouse pan retain their native implementation. Pose changes repaint the existing
scene through the same raster post stack, with bounded/coalesced work and no
model reload. Native document/media operations suspend navigation; disposal
cancels RAF and clears held input.

A first actual movement reports unsaved camera state without replacing DOM or
interrupting the held gesture. Once motion/deceleration settles for 120 ms, the
exact live pose/target saves as one command. Root actions share a camera-flush
promise, preserving movement before another edit or JSON download. Forms merge
unchanged pose inputs against the latest live save so an exposure-only Apply
does not overwrite a just-completed movement. No periodic in-gesture checkpoint
is claimed; termination can lose the current uncompleted gesture.

Controller selection/seek freezes the request and reuses compatible scenes.
Unchanged document/shot signatures use only frame rendering, avoiding repeated
complete shot application/compatibility preflight. Root playback serializes
rendered frames against the wall clock, skipping late preview frames rather
than accumulating work. Rapid seeks supersede older results. Pause restores
editing input; Stop returns to the prior editing setup. This is basic rendered
transport, without narration/audio-clock integration or 15-minute drift acceptance.

Development **Open local demo scene** uses exact bundled GLBs and a stable generated
video through a byte-verified local catalogue adapter. The normal viewport
implements rendering; no alternate fake/demo renderer is introduced. The action
and source assets are omitted from the production build. It is not a teacher
publication or offline-media readiness claim.
