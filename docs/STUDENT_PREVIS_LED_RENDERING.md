# Student LED rendering service

`app/src/previs/media/StudentLEDWallService.js` supplies a viewport-owned media port for `presentationVersion: 1` LED walls. It accepts explicit stable mesh mappings and already opened, byte-verified `DecodedLEDSource` instances. It imports no admin stores, application singleton, HTML video playback clock or library audio. Legacy wall brightness/transform records are explicitly rejected rather than reinterpreted as nits and UV placement.

```js
const media = createStudentLEDWallService({
  nodeObjects,  // Map<immutable nodeInstanceId, THREE.Mesh>
  mediaSources // Map<assetVersionKey, DecodedLEDSource>
});
await media.apply(initialShot.snapshot.ledWalls);
// Supply media to createThreeShotPorts / ShotSceneAdapter.
await media.renderEvaluation(evaluation, { signal });
```

`read()` returns a detached portable wall array. `capture()` returns an opaque runtime token. `restore(token)` restores wall configuration and re-decodes the precise previously requested displayed source times, including freeze/play frames reached after the shot's initial in point. The port methods are asynchronous; callers must await them. `validate(walls)` is synchronous and checks complete presentation records, unique mapped mesh ownership, available UV channels and exact decoder identities before scene mutation.

`apply()` builds and decodes new resources before replacing any current mesh material. If preparation or decoding fails, newly allocated resources are released and the prior displayed shot remains present. `renderEvaluation()` reads the evaluator's exact source times, awaits decoder completion into separate staging canvases, then commits all wall textures after successful staging. Cancelled or failed decoding leaves the last committed display intact. Operations serialize; callers can cancel superseded work with the existing sequence adapter's abort signal.

## Matching the admin raster image

The service follows the focused image-presentation algorithms in `LEDVideoManager.js` without importing its app/global dependencies:

- Real `MeshStandardNodeMaterial`, black diffuse colour, white emissive colour for media, roughness 0.72, front side and `materialEmissive` as the dynamic emissive node. Emissive intensity is exactly `brightnessNits / 100`; blank media is black with zero emission.
- A native-aspect composite canvas with longest edge at most 2,048 pixels. Source display dimensions are read once per decoder through Mediabunny's public track API and cached. Every frame awaits `DecodedLEDSource.drawAt()` before composition.
- Black fill followed by the stored normalized rectangle position, scale and clockwise rotation. Admin `applyFit()` already writes contain/cover/stretch into rectangle scale. The service preserves that stored rectangle and does not apply fit scaling a second time. Fit mode and aspect lock remain authored editing metadata.
- sRGB `CanvasTexture`, linear filtering, no mipmaps, `flipY = false` for authored top-left UVs, explicit UV channel and a fixed matrix normalizing the authored UV bounds with optional U mirroring. Placement has already been composited into the pixels, so the texture matrix applies only surface normalization.

Original geometry and UV buffers are never mutated or cloned; matrix-based normalization preserves the asset's immutable data. Original mesh materials are retained without disposal. Owned materials and textures stay stable across per-frame seeks and are replaced only when a complete wall configuration is applied/restored.

`await media.dispose()` waits for in-flight decoding, restores every original mesh material, disposes owned materials/textures and releases owned canvas backing stores. It does not dispose caller-owned source decoders, model geometry, textures or original materials. Dispose those source decoders only after the service has settled. The host retains responsibility for scene/resource ownership, cancellation and the larger camera/light/environment transaction.

`await media.inspect()` returns detached read-only diagnostics: source/display dimensions and centre RGBA, requested source time, texture sampling matrix/channel, actual UV bounds, first world normal and emissive settings. It exposes no live canvas, texture, material or mesh handles. This is a diagnostic-only readback, not a per-frame rendering operation.

## Verification

Eighteen unit checks use actual Three.js geometry, UV attributes, node materials and texture matrices with injected deterministic decoder/Canvas2D ports. They verify nits, known authored UV endpoints, exact placement operations, 2,048-pixel bounds, sample completion before commit, stable per-frame resources, captured frame restoration, blank walls, strict rejection, failed/cancelled decoding, retry, partial allocation cleanup, disposal ordering and detached diagnostic readback.

An independent Chrome WebGPU run against the real-scene fixture also confirmed the actual GLB wall displays decoded media: at frame 0 its source/display centre was `[27,152,28,255]` at source time 1 s; at sequence frame 125 both were `[152,147,28,255]` at source time 0.48 s, and the GPU output visibly displayed `LED 012 / 0.48 s`. The authored wall's 180 normals all face negative X (mean approximately `[-0.907,0,0]`). A positive 90° Y rotation presents it toward a camera at positive Z; the opposite rotation shows its back. The service retains the admin's front-side material policy instead of masking an incorrectly oriented fixture by enabling both sides. Actual UV1 bounds `[-0.0007009506,1,0.2888183594,0.7109375]` match the immutable surface metadata.
