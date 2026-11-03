# Concrete Three.js shot ports

Status: 22 October 2026. `app/src/previs/engine/ThreeShotPorts.js` now supplies
concrete camera, mapped model transform, and canonical light ports for
`ShotSceneAdapter`. Unit tests use actual Three.js objects, actual
`RenderSettings` and `LightManager` instances, and the actual `CameraManager`
public focus methods on a DOM-free instance shell. This adds CPU integration
coverage. It does not instantiate a WebGPU renderer, load catalogue assets,
deform real human/door meshes, or integrate the student viewport.

## Wiring and responsibilities

`createThreeShotPorts(options)` requires:

| Option | Meaning |
| --- | --- |
| `binding` | The same ready immutable-version inventory described in [STUDENT_PREVIS_DOMAIN.md](STUDENT_PREVIS_DOMAIN.md). Loader verifies asset bytes and stable node mappings before making it ready. |
| `sceneRoot` | The actual loaded model root, normally `app.meshScene`. |
| `nodeObjects` | `Map<instanceId, Object3D>` from catalogue mapping; each mapped object must remain in the model root. |
| `lightObjects` | `Map<lightId, Light>` for every canonical light in `lightManager.scene`, normally `app.scene`. Do not map raster proxy lights or engine UUIDs as durable IDs. |
| `cameraManager` | Existing ready camera manager, with its actual perspective/orthographic camera, orbit target, autofocus fields and public focus setters. |
| `settings` | Existing `RenderSettings` instance (`get`, `setMany`). |
| `cameraMetadata` | Mutable app-owned `{ sensorWidth, sensorHeight, frameOverlayRatio }`; these have no equivalent RenderSettings keys. |
| `lightManager` | Actual canonical light manager (`scene`, `updateLights`). |
| `updateNodes(objects)` | Explicit engine synchronization callback. Convert mapped objects to the engine's current affected mesh indices and call the appropriate transform update; do not guess array indices or perform a full BVH rebuild. |
| `pose`, `environment`, `media` | Explicit services with `read`, `capture`, `apply`, `restore`, and synchronous side-effect-free `validate`. They use the same port contract as the transaction adapter. |

Optional callbacks/options:

- `withoutRecording(operation)` wraps every content mutation, including injected
  service apply/restore. The host can temporarily suppress undo/autosave recording
  while awaiting the whole operation and must restore its prior mode in `finally`.
  It defaults to invoking the operation. The factory has no store dependency and
  never writes the admin undo stack itself.
- `onCameraChanged(camera)` lets the host reset accumulation/update secondary
  rendering after a completed camera write. It defaults to a no-op.
- `runtime` remains the optional transaction adapter's capture/restore port. The
  owner must suspend transport, interactive controls and rendering around export
  or shot-apply work. Runtime is restored after content.
- `supportedRenderProjections` defaults to `['perspective']`. A host that actually
  supports panorama may explicitly include `equirectangular`. This flag declares
  a real host capability; it does not implement a panorama raster shader.

The factory copies the Maps, so later map edits do not retarget existing ports.
A scene/camera replacement requires a new binding and port set. All light IDs
must map uniquely to actual canonical objects; unmapped canonical lights reject
rather than persisting across shots unnoticed. Named objects may be resolved by
the catalogue loader, but display names are not used as stable identity here.

## Concrete operations

Model transforms apply native local-space position/quaternion/scale/visibility,
update local/world matrices, then await `updateNodes`. Both parent and child
mappings are supported through the final root matrix update. Objects with manually
owned world matrices (`matrixWorldAutoUpdate === false`) reject explicitly.

Camera writes use current `RenderSettings` keys with `silent: true, reset: false`;
there are no invented sensor settings or store calls. Projection fields,
independent ray `clipStart`, native transforms, orbit target, focus mode/point,
focus smoothing and metadata are applied explicitly. Authored fov and quaternion
win over derived lens values. The bridge does not call `controls.update()`, which
would replace an authored quaternion with a look-at rotation. The owner must keep
controls suspended while applying/capturing a shot.

Perspective and orthographic snapshots require the corresponding already-ready
camera type. The bridge does not replace a camera behind engine references.
Off-axis view offsets are currently rejected because the portable schema does
not encode them. Target/current panorama modes unsupported by the host reject
before mutation, so rollback never depends on a mode the host cannot restore.

Lights retain existing object identity and use linear RGB/native radians.
Temperature/useTemperature/exposure, source radius, directional angle, spot
cone/penumbra, area geometry/normalization/spread/shape and hemisphere ground RGB
are handled concretely. Canonical `LightManager.updateLights()` synchronizes
engine light buffers and secondary raster proxies through its existing callback.

Spot/directional targets are serialized in **world space** and converted through
the actual target parent's transform when applying. Singular target parents
reject. Area targets are a derived world position plus positive-Z direction,
matching the existing LightManager descriptor convention; their authored transform
is authoritative. A target contradicting that transform rejects. Point, ambient
and hemisphere targets use the canonical `[0,0,0]` sentinel because those types
have no target object. Gobo/IES/projection maps, cast-shadow settings, and manual
world matrices currently reject before any authored value changes.

`ShotSceneAdapter` now calls optional synchronous `port.validate(value, binding)`
for every subsystem after document/identity checks and before capture/write.
The concrete bridge requires validators for its injected services, so unsupported
poses, missing media decoders and unsupported environment conversions can also
fail at this stage. Validators must not start asynchronous work; asset preparation
belongs before the ready binding is published.

## Evidence and remaining renderer gates

Tests compare actual Three object A → B → A captures across distinct camera/lens/
framing/target values, negative camera scale, object transforms/visibility, source
light values and parented light targets. A downstream media failure exercises
rollback of actual Three transforms and RenderSettings. Additional tests cover all
six supported light types, orthographic bounds, area orientation consistency,
unsupported panorama, missing canonical mappings, required service validators and
mutation-recording suppression.

Plain portable values compare exactly in these fixtures. Recomputed matrix
numbers are checked to 10 decimal places; derived area targets permit component
error of 1e-6 because they are computed from quaternion/matrix transforms. These
are CPU fixture tolerances, not measured GPU or posed-mesh acceptance thresholds.

Still required before claiming complete shot capture/apply:

1. Implement catalogue loader/version mapping and actual pose/environment/media
   service bridges; validate unsupported admin appearance settings explicitly.
2. Wire `updateNodes` to affected engine mesh indices and exercise the GPU transform
   path, not only Object3D matrices. Pose deformation needs its own correct refit
   callback. Test original/admin behavior after wiring.
3. Connect renderer reset, control/transport suspension, store display synchronization
   and autosave suppression. Silent settings suppress change events but do not
   synchronize the admin UI on their own.
4. Capture/restore runtime autofocus history, renderer output/resolution/helpers,
   playback and other transient engine state in the injected runtime service.
   The concrete camera port restores saved focus settings, not private smoothing
   internals or settings provenance tags.
5. Prove real studio/car/standing/sitting/door/light/environment/LED A → B → A in
   browser, including timecode media, final frame capture and failure/cancel
   restoration. Keep raster DOF/area-light/LED-illumination fidelity separate from
   the ability to preserve their authored parameters.

## Shared sequence raster bridge (22 October answer alignment)

`SequenceRasterAdapter` now connects a frozen `createSequenceEvaluator` revision
to the existing scene adapter's `captureState` / `applyShot` / `restoreState`
contract. `prepare` captures the editing state before host GPU/media preparation;
`renderFrame` applies complete state only when the shot changes, awaits the host's
decoded-media port on every frame, then synchronously renders/copies into a
Canvas2D capture surface. The sequence endpoint is never encoded as an extra
frame. Scene loading and immutable catalogue readiness remain the host's job.

Overlapping seeks serialize all scene writes and cancel superseded media work.
An old application/decode must settle before the newest seek writes; cancelled
work cannot paint a stale frame. Rendering is rejected while preparing or
restoring, and restoration drains pending work before attempting both scene and
host restoration. A failed restore prevents reusing an unsafe viewport.

`FrameFraming` supplies the same geometric/compositing contract for student
preview and export: full image retained, black source-over at alpha 0.5;
1920×1080 4:3 uses 240-pixel side bars, 2.40:1 uses 140-pixel top/bottom bars.
Canvas caller state is restored. Composite once after each fresh GPU copy to
avoid accumulating opacity. The existing admin DOM guides are unchanged.

The diagnostic now uses this bridge and an actual validated student document,
with the generated LED video's real SHA-256/size. Its fixture-owned scene port
applies camera/cut state; proxy geometry, static lights and door remain explicit
fixture code. This is **not** the production catalogue/rig/ThreeShotPorts wiring.
Twenty-seven focused lifecycle/framing tests pass. Chrome on the confirmed base
M5 also verifies exact before/after Canvas2D samples and twelve decoded H.264
framing samples within a 12-code-value lossy tolerance. LED freeze/play/cuts,
physical sizing, cancellation, failure and retry still pass.


## Real raster viewport integration

The separate `/student/scene/` engineering entry now wires all concrete ports to
verified local studio/SUV/mannequin/LED GLBs. It creates its own WebGPU renderer,
actual CameraManager, RenderSettings and canonical LightManager; it imports no
admin stores/app singleton. Scene transforms use native Object3D matrices.
`StudentPosePort` uses the existing pure mannequin pose geometry code; standing
and sitting update the actual vertex/normal buffers. Door hinge quaternions stay
in mapped scene-node transforms, avoiding a second scalar-angle application.
There is no path tracer or BVH in this raster-only viewport, so no invented
path-tracer refit callback is needed.

`StudentEnvironmentPort` resolves only prepared immutable texture versions and
finite Y-axis rotations. `RealtimeRenderer.setEnvironment(texture|null)` is a
new narrow engine method: it replaces the light/mesh scene environment and the
fallback cache together, then runs existing synchronization. Tests prove
HDRI → null → the same HDRI cannot leak the earlier lighting/background.
The port copies the registry Map; caller replacements cannot retarget a version.
The encompassing ShotSceneAdapter supplies rollback if a later port fails.

The optional `rasterAppearance` port is inserted before media in the content
transaction. A viewport supporting it requires explicit appearance in each
rendered shot; a viewport without it rejects such shots before any capture/write.
Capture retains the new record, and reverse rollback restores its settings and
renderer state after a downstream media failure. Legacy adapter calls without
appearance continue to use their prior contract. See
[appearance](STUDENT_PREVIS_RASTER_APPEARANCE.md),
[LED rendering](STUDENT_PREVIS_LED_RENDERING.md), and
[verified loader](STUDENT_PREVIS_SCENE_LOADER.md).

The scene entry remains a host-owned fixture, not a published preset library or
production student authoring screen. Its narration is diagnostic click audio.
Actual teacher-media identity, catalogue publication, full authoring controls
and narration recording/mixing remain separate implementation gates.


Repeated GPU exports also identified resource identity churn. The raster-only
pose port now copies exact baked pose values into its existing owned native
position/normal BufferAttributes, marks them dirty and preserves geometry bounds.
It does not edit the shared admin pose utility. An eight-cycle actual-rig test
proves attribute identity and version updates. Raster light synchronization now
reuses each canonical source's proxy/shadow/target while updating live transforms,
power, color, temperature, cone, area and shadow parameters. Removal/type changes
still release the old proxy. Unit regressions and the real GPU harness verify
that existing canonical objects/settings remain unchanged and that tracked GPU
resource counts do not grow across the warmed export and failure/retry sequence.
