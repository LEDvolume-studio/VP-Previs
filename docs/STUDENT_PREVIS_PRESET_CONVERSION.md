# Prepared admin preset conversion

Status: 22 October 2026. `app/src/previs/engine/AdminPresetConverter.js` adds an
app-owned, read-only conversion boundary. It produces a validated independent
student preset shot from a supported saved admin revision plus a complete live
capture. It does not publish a catalogue, change the admin workflow, hydrate an
admin project at a timeline cut, or complete the Phase 2 renderer gate.

## Why a saved `.rayzee` file is insufficient

The current admin serializer saves node local transforms and mannequin pose
labels. Its camera descriptor omits projection/aspect/zoom/scale and some lens
metadata; its light descriptors omit quaternion/scale, may omit directional
targets and quantize colour to sRGB hex. Reconstructing a complete student shot
from these fields alone would guess authored values. The converter instead
checks saved fields against full captured state and retains the captured
precision. Disagreement blocks conversion.

## Preparation and capture contract

1. Resolve an explicit immutable asset manifest and base-scene version. Each
   model/HDRI/media entry includes the actual SHA-256, byte length, kind, MIME
   type and duration where applicable. `prepareStudentSceneConversion()` validates
   this manifest with the student schema, loads each entry through a caller-owned
   byte loader, and checks its exact byte length and SHA-256 before issuing an
   opaque process-local preparation token. A URL, fabricated object, stale token
   from another module/process, or manifest without bytes cannot replace this
   token. Mutable caller manifests are copied before the first asynchronous read.
2. Supply explicit source-to-version mappings. An admin instance maps its
   `catalogId` and exact `assetVersion` to a verified model reference. Every saved
   `instanceId:path` maps to a unique student instance ID, immutable asset node ID
   and exact model version. Light UUIDs map to stable light IDs. HDRI catalogue
   IDs map to exact verified environment references. The source hierarchy paths,
   catalogue URLs, UUIDs and display names are not emitted as portable identity.
   A revised hierarchy requires a new version and mapping; never reuse an old
   child position or look up a node by a display name.
3. Prepare the actual Three.js scene/ports and suspend interactive edits, controls
   and transport around capture. `capturePreparedAdminScene({ source, ports })`
   reads the existing scene/pose/camera/light/environment/media port contracts,
   combines the complete node transforms and pose metadata, and returns a detached
   snapshot. It rejects omitted or extra scene/pose nodes, replacement scene
   bindings and admin project/revision changes during capture. The host owns the
   suspension and `finally` restoration; this helper never pauses or mutates the
   shared admin engine itself.
4. Call `convertAdminProjectToStudentPreset()` with the same saved source revision,
   preparation token, explicit mappings, complete capture, project/shot IDs and
   preset ID/version/name. The returned document contains one independent shot,
   exact asset/base-scene manifests and preset provenance, with no timeline clips
   or narration. Any error returns `{ ok: false, document: null, diagnostics }`;
   no partially converted document is publishable. Diagnostics contain severity,
   code, source field path and an explanation. They do not echo source values.

The optional `ports.rasterAppearance.read(binding)` capture supplies complete
versioned raster appearance. Omitting that port retains the earlier strict
capture contract and never invents renderer/background defaults.

The preparation token proves local byte integrity only. It is **not** catalogue
authorization, an upload verification record or permission to activate backup or
sharing. Byte hashing also does not prove that a container decodes, that a model
has the declared rig, or that a source catalogue alias belongs to those bytes.
The trusted catalogue loader/publisher must establish those facts, enforce size
limits, prepare decoders/GPU resources and own resource cleanup. The supplied
`bakedMaterials` baseline must originate from that verified model's authoring
baseline, rather than copying arbitrary edits from the project being converted.

## Supported state and explicit boundaries

The initial converter reconciles every saved local node transform/visibility and
standing/sitting pose label; complete camera transforms, projection/lens/focus,
framing and exposure; uniquely mapped canonical lights with full captured linear
colour/emission/rotation and type parameters; and a verified HDRI environment.
Camera UI sensor/framing/focus metadata must also match the complete capture.
Unknown authored fields, unversioned/mismatched references, source/capture
disagreement, duplicate mappings and unsupported state block the result.

The current SUV fixture's left/right doors are retained exactly through their
mapped hinge-node quaternions. Scalar `doorAngles` reconstruction requires an
explicit rig-specific axis/rest-pose converter and currently rejects. A future
pose bridge must set the stored hinge orientation rather than apply the same
rotation twice.

LED conversion now requires explicit `mapping.ledWalls[sourceWallInstanceId]`:

```js
{
  wallId: 'portable-wall-id', nodeInstanceId: 'mapped-display-mesh',
  sourceVideo: {assetId: 'private-admin-file-id', name: 'teacher.mp4',
    type: 'video/mp4', size: 12345, lastModified: 123456789},
  media: {assetId: 'verified-video', version: 'immutable-version'},
  mode: 'play', playbackRate: 1,
  surface: {nativeCanvas: [6144, 2592], uvChannel: 1,
    uvBounds: [0, 1, 0, 1], flipU: false}
}
```

The source file descriptor must equal every saved video identity field except
`currentTime`; size/MIME must also equal the verified video manifest. The media
reference must resolve bytes verified by the opaque preparation receipt. These
checks establish the explicit local source-to-version mapping; matching names
alone do not establish media identity or catalogue authorization. The trusted
loader must resolve the intended source file, verify decoding/duration and tie
its surface mapping to the actual prepared model version. A supplied mapping is
not a substitute for those responsibilities.

The display node must belong to that source wall's mapped model hierarchy.
Capture must match saved nits, loop, position, scale, rotation, aspect lock and
fit mode exactly. The source time rounds to the nearest integer microsecond;
out-of-range values fail portable validation. The explicit freeze/play policy
and playback rate come from preparation because admin transport play/pause is
not saved fixed-shot content. The portable tagged presentation has no duplicate
wall transform: its mapped display node already contains the authored transform.
Blank saved walls require null `sourceVideo`/`media` and freeze at zero. Missing,
duplicate, extra or inconsistent mappings block conversion, including blank
walls. File names, source UUIDs and device handles are not emitted.

Material edits that differ from the supplied baked-model baseline reject.
Procedural/gradient skies, ground projection/catcher, automatic exposure,
unrepresented post settings, gobo/IES and unknown render state still reject.
With a complete `rasterAppearance`, the converter preserves the existing raster
appearance settings and explicitly reports known path-only settings as omitted
runtime/path metadata. For example the admin's non-default saturation belongs to
its path compositor and does not introduce a second colour grade in raster.
Inactive sky settings are allowed only in explicit HDRI mode; inactive ground
settings require both ground features disabled. Known stale UI camera copies
defer to the saved active camera or an explicit same-key engine value, which are
still checked against capture. Unknown fields and `maxTextureSize` continue to
reject. Without complete appearance the earlier strict render allowlist remains.
This is not yet a general admin project importer.

Admin selection/panels, the remaining camera list and animation transport are
reported as omitted runtime/editor state. No project file paths, private device
handles, recovery credentials or cloud state enter the student document.

## Verification

`tests/unit/previs/adminPresetConverter.test.js` has 54 passing checks, including:

- The real SUV authoring file's 85 nodes, actual local 19,432,020-byte GLB hash and
  both opposing open-door hinge quaternions.
- The real mannequin authoring file's 148 nodes, actual local GLB hash and both
  standing/sitting metadata. The tests retain the complete saved hierarchy.
- An explicitly labelled one-pixel RGBE HDRI substitutes for the remote HDRI in
  these tests. Its real bytes are hashed; no test claims to have verified or
  published the remote `aristea_wreck_puresky` version.
- Byte size/hash mismatch, fake preparation receipts, asynchronous manifest
  mutation, detached live capture, scene replacement, stale revisions, missing
  mappings, duplicate node mappings and incomplete camera state.
- Sensor/focus mismatch, unsupported material/appearance/media state and full
  captured linear light colour checked against the admin's sRGB descriptor.
- A deliberately composed SUV/LED conversion fixture retains all three actual
  welcome LED hierarchies, nits and placement values (including the blank wall),
  using the actual local main/square LED GLB bytes. A labelled synthetic blue
  ten-second H.264 file replaces the unavailable teacher-linked video; its real
  bytes are hashed. This does not claim that the teacher video or a published
  welcome catalogue revision is verified.
- Every LED placement dimension/rotation/aspect intent, source-time/media identity,
  UV mapping, blank media and exact wall/node inventory is checked for mismatch.
- Optional live raster appearance, independent capture, explicit path-setting
  omission and authoritative camera/engine values versus stale UI copies.
- The unprepared bundled welcome studio still fails with useful explicit
  mapping/appearance diagnostics. It is not silently advertised as a supported
  published preset.

An additional 22 presentation/schema checks retain existing stored v1 content
unchanged, reject ambiguous old/new brightness or transform fields, validate UV
geometry and ensure blank walls never request media decoding.

Run `npx vitest run tests/unit/previs/adminPresetConverter.test.js`. The new source
and tests also pass their scoped ESLint check. Real browser/GPU rig/media capture,
published catalogue identity and a wired teacher capture/publish UI remain open.
