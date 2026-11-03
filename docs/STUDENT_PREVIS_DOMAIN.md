# Student previs domain foundation

Status: 22 October 2026. Portable content, completed-edit commands, deterministic
frame evaluation, and an injected scene transaction adapter are implemented.
The transaction adapter is tested with independent in-memory subsystem ports;
[concrete Three.js camera/node/light ports](STUDENT_PREVIS_THREE_BRIDGE.md) also
have real-object CPU round-trip tests. **These ports are not yet wired to a live
student renderer and do not complete the Phase 2 studio/car/human/LED gate.**

## Portable content

`app/src/previs/domain/StudentProjectSchema.js` defines the distinct
`rayzee-student-project` format, schema version 1. The admin `rayzee-project`
format remains separate. Version 1 is unreleased; no legacy student migration is
claimed. Future versions and unknown fields are rejected rather than guessed.
The unreleased version now accepts explicitly tagged LED presentation and an
optional raster appearance record. Existing stored v1 content is cloned without
changing its meanings. Older code that predates these additions rejects the new
fields; this is not a released cross-version interoperability promise.

Content uses metres/Y-up, integer 25 fps timeline frames, fixed 1920×1080 output,
and at most 22,500 frames. Narration trims use integer source samples; video
positions use integer microseconds. Transform quaternions must have length one
within 0.0001. Values must be finite. Keys and embedded stable IDs must agree.
Asset references resolve exact `assetId@version` entries; base scenes resolve
exact `sceneId@version` entries. Neither is a mutable URL or array index.

A shot owns independent camera, node/pose/door, light, environment, and LED data.
Nodes contain both an app instance ID (the record key) and an asset-version node
ID. A node's model asset must be part of its immutable base scene manifest.
Duplicate placements of one shot share that shot intentionally; duplicating a
shot creates independent data. Preset copies retain source ID/version provenance
while holding no mutable reference to the source preset.

The strict schema excludes URLs, device handles, credentials, cloud sync state,
engine objects, and arbitrary metadata. Portable import gets a new project ID,
creation/update time, and revision zero. Local repository metadata and media
bytes live separately. Narration segment metadata describes contiguous ordered
bytes of one recording container: individual recorder chunks are not promised
to be independently decodable.

`StudentCommands.js` produces validated copies and inverses for completed edits.
Undo/redo is another completed edit with a new increasing revision. No-op edits
return the original document and do not create backup work. Removing a timeline
placement leaves the separate narration track and source assets unchanged.
Removing a shot that still has a placement fails. Selection/transport are not
content edits.

### Independent narration track

The confirmed product behaviour is an independent track with multiple narration
clips. `addNarrationClip` supplies `{ type: 'sequence' }` when `anchor` is omitted
and rejects creating new shot anchors. Each recording has an absolute
`offsetFrames`, source sample trim, gain and mute state. Shot reorder, duration,
duplication and deletion commands never rewrite narration. Overlapping recordings
are supported. Audio trim/replacement/deletion leaves immutable source assets in
`narration.assets`; command inverses restore deleted clip/trim metadata.

Existing explicit `{ type: 'clip', clipId }` records remain valid with their
original semantics; import does not silently change their playback.
`detachNarrationFromShot` is the explicit conversion command. It keeps the
recording's absolute start, source samples, gain and mute state. An orphaned
legacy anchor needs an explicit `offsetFrames` because its former start cannot
be recovered from a missing placement. Undo restores the original anchor.

`moveTimelineSelection` accepts `clipIds` and `narrationClipIds` as explicit,
unique selections. With shots selected, `index` is the insertion point **after
removing the selected contiguous shot block**. It preserves shot order and moves
only selected independent narration by the same frame delta as the block's first
shot. With only narration selected, use an integer `deltaFrames` instead. The
whole command validates atomically and creates one undo step. Unknown/duplicate
IDs, noncontiguous shot selections, legacy anchored audio and invalid positions
reject without changing the document. Selection itself remains runtime state.

The current visual lane is a compact ordered list starting at frame zero; it
does not represent gaps or a movable sequence origin. Group reorder is therefore
implemented, but dragging every shot later to create a leading blank interval
is not implemented. There is no narration editing UI yet. These commands do not
claim that a select-all timeline interaction is already available.

## Camera and light inventory

The inventory was checked against `CameraManager.js`, `RenderSettings.js`,
`DepthOfField.js`, `LightManager.js`, and the app camera store. The historical
admin camera/light serializers are not sufficient on their own for this schema.

| State | Portable representation | Renderer integration requirement |
| --- | --- | --- |
| Camera position/quaternion/scale/visibility and orbit target | `camera.transform`, `target` | Apply matrices and orbit target without allowing controls to overwrite the authored rotation. |
| Three camera projection | Perspective fov/aspect/near/far/zoom/filmGauge/filmOffset; orthographic bounds/near/far/zoom; both include independent `clipStart` | Update projection/world matrices; retain clipStart separately from the near plane. |
| Render projection | `renderProjection.type` (`perspective`, `equirectangular`), longitude/latitude ranges, horizon level | Raster must explicitly report unsupported panorama instead of silently rendering perspective. Panorama values remain portable. |
| Lens/sensor/focus | Focal length, sensor width/height, focus distance, aperture, enableDOF, aperture scale, anamorphic ratio, dofBlur, unitsPerMetre | Preserve all fields even when raster has no equivalent effect; respect legacy engine focus scaling. |
| DOF enum | `legacy`, `physical`, `look` | These match current `DepthOfField.js`; raster DOF is a separate release decision. |
| Autofocus | `manual`, `auto`, normalized screen point, smoothing factor | These match current `CameraManager`; `off`/`center`/`point` are rejected. Deterministic export must retain the captured focus distance rather than refocusing per wall-clock frame. |
| Framing overlay | `camera.frameOverlayRatio`: `16:9`, `4:3`, `2.40:1` | Confirmed treatment: preserve the full 1920×1080 image and composite 50% transparent black framing bars for non-16:9 ratios. |
| Exposure | `camera.exposure` | The renderer setting is global but shot-owned in this document. |
| Light identity and placement | Persistent app light ID, type, complete transform, target, RGB/intensity | Engine UUID replacement is not a persistent ID mapping. Preserve area orientation and spot/directional targets. |
| Light emission | Temperature, useTemperature, exposure | Explicit common settings for all light types. |
| Point/spot | Distance, decay, source radius; spot angle and penumbra | All portable angles are radians; existing LightManager descriptors use degrees for some controls and require conversion. |
| Directional | Angular source size | Radians. |
| Area | Width, height, normalize, spread, square/rectangle/disk/ellipse | Preserve fields raster cannot reproduce; no geometry/material rebuild per display frame. |
| Hemisphere | Ground RGB | Explicitly typed. |

The portable environment currently supports an exact HDRI asset version (or
null), intensity, rotation, and background visibility. It does **not** encode
all admin procedural skies, background blur/intensity, ground projection/catcher,
or arbitrary appearance/material overrides. Gobo and IES profile references also
need versioned manifests before support. The strict schema rejects these fields
if present; a future real-engine capture/import bridge must detect their use and
reject clearly instead of dropping them during conversion. Generic admin project
import into student content is not implemented. Do not claim complete preservation
of these unsupported settings.

Sensor preset labels are UI metadata, not physical camera state. Framing overlay
ratios are explicitly retained because they record the intended shot framing. Navigation speed, selection, the full admin camera list, transient autofocus
smoothing history, and play/pause state belong to runtime restoration rather than
a saved fixed shot. `unitsPerMetre` is retained for engine DOF compatibility; new
metre scenes should set it to 1.

### Explicit LED presentation

Existing v1 LED records retain their exact `brightness` and `transform` fields.
No migration renames brightness or assumes that its old unit was nits. The new
alternative has `presentationVersion: 1` and these exact fields:

```js
{
  wallId: 'main-wall', presentationVersion: 1,
  nodeInstanceId: 'mapped-display-mesh',
  media: { assetId: 'teacher-video', version: 'verified-version' },
  mode: 'play', inPointUs: 7903555, loop: true, playbackRate: 1,
  brightnessNits: 558,
  placement: {
    position: [0.44667986527543957, 0.5439198073780784],
    scale: [0.75, 1], rotationDegrees: 0,
    aspectRatioLocked: true, fitMode: 'contain'
  },
  surface: {
    nativeCanvas: [6144, 2592], uvChannel: 1,
    uvBounds: [0, 1, 0, 1], flipU: false
  }
}
```

`nodeInstanceId` resolves the actual display mesh through the immutable model
mapping. That node owns its local transform; a second wall transform is rejected.
The wall ID is portable app identity, never an admin wall UUID or hierarchy path.
Media resolves exact verified video bytes. A blank display uses `media: null`,
`mode: 'freeze'`, `inPointUs: 0`; its nits and placement remain editable content
but the evaluator does not request a decoded frame for it.

Brightness follows the admin convention: emission intensity is nits divided by
100. Placement uses the admin top-left normalized display coordinates: translate
to position, rotate by `rotationDegrees`, draw a centered rectangle with the exact
saved normalized scale, and leave uncovered pixels black. The saved scale is
authoritative. `fitMode` and `aspectRatioLocked` preserve editing intent; changing
them is an explicit edit that may compute a new scale. A renderer must not apply
contain/cover a second time on every frame.

`surface` belongs to this exact prepared model version, including any UV island
normalization the loader already performed. Bounds are `[minU,maxU,minV,maxV]`;
`flipU` and channel retain the actual post-preparation mapping. Bounds must have
positive extent, canvas dimensions must be positive integers, and scales must
be at least 0.0001 to match the admin placement minimum. Source UV transforms,
rotation, aspect intent and blank displays must never disappear at conversion.

### Optional raster appearance

`snapshot.rasterAppearance` contains the versioned existing admin raster post
stack, renderer tone mapping/output colour space, environment/background switches,
background intensity/blur/colour. Its `showBackground` must agree with
`snapshot.environment.background`. Exposure remains owned by the camera, and
HDRI identity/intensity/rotation remain owned by the environment. This avoids
two independently editable copies of those values. See
[STUDENT_PREVIS_RASTER_APPEARANCE.md](STUDENT_PREVIS_RASTER_APPEARANCE.md) for exact
host validation and supported settings. A legacy snapshot without this field
does not acquire invented appearance defaults during import.

## Injected ShotSceneAdapter contract

`app/src/previs/engine/ShotSceneAdapter.js` orchestrates an already loaded viewport.
It does not load assets or modify shared engine code. Construct it with `scene`,
`pose`, `camera`, `lights`, `environment`, `media`, and optional `runtime` ports.
The viewport owner must stop interactive/animation mutations while an adapter
operation is running. Overlapping adapter calls reject explicitly.

Each content port implements:

- `read(binding)`: return detached portable content for capture.
- `capture(binding)`: capture independent subsystem state sufficient for rollback.
- `apply(value, binding)`: apply the supplied shot content; resolve only mapped IDs.
- `restore(capturedState, binding)`: restore exactly the captured subsystem state.
- Optional synchronous `validate(value, binding)`: reject unsupported target state
  without side effects before any subsystem capture/write.

`read` and `capture` have intentionally different purposes. A capture can contain
renderer/private runtime state; it is never placed in the portable document.
Ports must not retain mutable references to input content or expose live objects
from `read`. Ports own their concrete engine conversion and resource lifecycle.

The `scene` port also implements synchronous `getBindings()`, returning the same
object identity until scene reload/rebinding:

```js
{
  ready: true,
  baseScene: { sceneId: 'studio', version: '1' },
  assets: [ { assetId: 'car', version: '1' }, /* loaded, verified media etc. */ ],
  nodes: [ { instanceId: 'carInstance', asset: { assetId: 'car', version: '1' }, nodeId: 'root' } ],
  lights: [ { lightId: 'key', type: 'spot' } ],
  ledWalls: [ { wallId: 'wall' } ]
}
```

Bindings may also hold engine handles, but those must be resolved from a
versioned catalogue mapping. Readiness means the loader has already verified the
exact immutable asset bytes; the adapter checks reference readiness, not hashes.
A changed hierarchy must get a new mapping/version. Matching an old child array
index, display name, or regenerated engine UUID is forbidden.

The initial adapter requires an exact node/light/wall inventory match, including
light types. This is a deliberate fixed-scene scope: absent objects cannot leak
state from shot B into shot A. Adding/removing light or object inventories requires
preparing the corresponding base scene/binding first; dynamic inventory editing
is not implemented here. Scene reload creates a new binding object even when
reloading the same versions, making old restore tokens invalid.

Portable values per port:

| Port | `read` result | `apply` argument |
| --- | --- | --- |
| scene | `{ [instanceId]: transform }` | Shot `nodes` record (read transform and stable mapping) |
| pose | `{ [instanceId]: { humanPose, doorAngles } }` | Shot `nodes` record (read pose/doors) |
| camera | Complete camera object | Complete camera object |
| lights | Complete light array | Complete light array |
| environment | Environment object | Environment object |
| media | Complete LED wall array | Complete LED wall array |

Transforms follow the mapped object's local parent space, using native metre/Y-up
values. The stable base-scene mapping supplies that parent hierarchy. World/editor
coordinate conversions belong at the UI boundary, not in saved arrays.

The optional runtime port has `capture`/`restore` only. It captures transport,
renderer mode/resolution, helper visibility, focus transient state, etc. Runtime
is captured first and restored last so animation resumes only after content is
restored. The export owner must suspend rendering/transport before changing state.

Public adapter methods:

- `captureShot(document, shotId)`: capture independent portable shot content and
  validate every supported field. Caller records it with a completed-edit command.
- `applyShot(document, shotId)`: preflight the full document, scene/asset versions,
  complete inventories and node mappings; capture every subsystem; apply in scene,
  pose, camera, lights, environment, media order. If a write fails, attempt every
  rollback in reverse order, then rethrow. Rollback failures are aggregated with
  the application error and require viewport reload.
- `captureState(document, shotId)`: obtain an opaque in-memory token for export or
  preview restoration. Tokens belong to one adapter and must never be serialized.
- `restoreState(token)`: restore all subsystems; refuse stale scene bindings.

Capture failures occur before writes. Asset loading failure or an unresolved ID
also occurs before writes. Capturing or applying a shot clones content only at a
shot boundary. Do not call it every display frame: LED frame updates should use
the prepared media source driven by the evaluator.

## Pure sequence evaluation

`createSequenceEvaluator(document)` validates and captures immutable content once
per revision. `evaluate(frame)` returns a fixed active placement/shot/local frame,
LED source times, and active narration source sample positions. It has no renderer,
media element, wall-clock, or store dependency. Preview and export can use the
same evaluator. `frame === totalFrames` is an ended transport state, never an extra
rendered frame; other out-of-range/noninteger frames reject.

Looping LED sources wrap across the complete source. Nonlooping sources hold the
last microsecond inside the asset duration. Freeze sources retain their in-point.
Independent narration continues across shot cuts at the same absolute sample
position. Legacy clip-anchored narration is silent when orphaned and is bounded
to its placement, including after reorder/trim. Each returned `remainingSamples`
is bounded to the sequence end (or legacy placement end), so scheduling a whole
tail cannot run past the output window.
Integer sample boundaries are derived from the absolute narration start to avoid
rounding drift at fractional sample rates. Overlapping narration remains a list for the audio
mixer; the evaluator does not perform audio decoding or resampling.

Output length currently equals the sum of visual placement durations. Shortening
that window does not alter any narration clip or source; narration beyond its
end is inactive and becomes available again when the visual sequence is extended.
No automatic black tail or last-shot hold is invented. A narration UI must show
out-of-window clips honestly before production export is enabled; independent
track authoring does not imply that audio extends the visual output automatically.

## Verification and remaining gates

Unit tests cover portable round trips and invalid data, exact version/identity
resolution, independent preset/duplicate content, command inverses, timeline
boundaries/reorder/orphan semantics, independent multi-clip narration across shot
edits/cuts, explicit legacy-anchor conversion, atomic mixed selection moves,
source preservation and undo, LED looping/holding, narration sample trims,
and injected adapter A → B → A capture/apply, rollback, runtime restoration,
failed capture, missing/duplicate mappings, stale bindings, and overlapping calls.
The injected A → B → A fixture compares plain numbers exactly; this does not claim
GPU/Three matrix float tolerance validation.

Before marking the plan's Phase 2 capture/apply gate complete, wire the concrete
Three.js ports and implement remaining media/pose/environment/runtime services.
Run a renderer-backed fixture with studio, car, standing/sitting
humans, distinct doors, both LED modes, and timecode video. Check capture after
actual Three transforms/pose deformation, camera-store synchronization, texture
updates, light processing, and export cancellation/restoration. Establish and
document measured matrix/float tolerances. Test unsupported admin settings/profile
imports fail explicitly. Keep the existing admin camera/session regression suite
green. Raster DOF/area lights/LED illumination fidelity remain release questions.


## Immutable teacher catalogue copies — 23 October 2026

`StudentCatalogueSchema.js` defines complete `rayzee-student-preset` v1 content:
preset identity/version, descriptive metadata, default duration, optional pinned
image thumbnail, exact asset manifest, one immutable base-scene manifest and a
complete shot snapshot. It validates via the existing student document schema;
URLs, unknown fields, unresolved assets, unsupported MIME types, duplicate browse
choices and invalid duration/state fail explicitly. Server registration and
actual renderer/codec preflight remain separate checks.

`addPresetShot` copies all dependencies, an independent shot with pinned source
provenance and its default-duration timeline placement in one pure command.
Existing identical dependency versions are reused; an immutable ID collision with
different content is rejected. The normal 22,500-frame limit applies. One saved
revision and undo step covers the whole operation; undo removes only what that
operation added, and redo restores detached content. Later teacher publication or
hiding does not rewrite existing copies. Native UI/D1/R2 evidence and API trust
boundaries are in `STUDENT_PREVIS_CATALOGUE_BACKEND.md` and the progress record.
