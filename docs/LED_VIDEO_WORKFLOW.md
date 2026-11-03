# LED video workflow

## Supplied GLB inspection

Both source files report glTF 2.0, were exported by Unreal Engine 5.8.2, and use `KHR_mesh_quantization`. Neither declares a unit extension. Their numeric dimensions match the supplied metre measurements exactly enough to establish that one scene unit is one metre. The committed files in `app/public/models/led/` are byte-identical copies of the supplied GLBs; no CDN is involved.

### Main LED Volume Wall

- Hierarchy: scene `Main` → node/mesh `QuadWall`. There are no child, frame, backing, or support nodes.
- Source node transform: translation `(5.5999999, 0.099999994, 0)`, identity rotation and scale. The local pivot is at the base and at the back-centre of the curve.
- World bounds in the supplied file: min `(3.8023165, 0.0999700, -4.4050879)`, max `(5.5999999, 4.2169295, 4.4045897)`.
- Dimensions: depth X `1.7976834 m`, height Y `4.1169595 m`, width Z `8.8096776 m`. The requested 8.8 m is therefore the chord/overall bounding-box width, not the arc length. The 16-segment centreline polyline has an arc length of approximately `9.75872 m`.
- Forward direction: vertex and face normals point around `-X` (centre normal `-X`, edge normals fan toward `±Z`).
- Topology: 180 vertices, 756 unsigned-byte indices, 252 triangles, one primitive. Positions are float32; normals and tangents are normalized int8.
- Material: one unnamed default metallic-roughness material, with no textures or authored emission. The whole mesh is the visible LED surface.
- UVs: `TEXCOORD_0` and `TEXCOORD_1` are present. UV0 is an atlas with a discontinuity at mid-height and is not suitable for a single video. UV1 is continuous around all 17 curve columns; U spans about `-0.000700951..1` and V spans `0.288818359..0.7109375`. V increases from physical top to bottom. The manager normalizes these bounds and mirrors U so the logical canvas reads left-to-right from the front.

### Square Wild Wall

- Hierarchy: scene `Main` → node/mesh `WildWall`. There is no separate frame, backing, or support geometry.
- Source node transform: translation `(1.39999998, 0.299999982, -4.9000001)`, quaternion `(0, 0.707106829, 0, 0.707106829)`, unit scale. The retained Y rotation turns the local YZ plane into an XY display; the translation came from the larger source stage.
- Supplied world bounds: min `(0.1999999, 0.29999998, -4.90000026)`, max `(2.6000001, 2.69999984, -4.89999994)`.
- Dimensions: `2.4000002 × 2.3999999 m`; geometric thickness is effectively zero. The base-centre pivot and orientation are usable once translation is removed.
- Forward direction: local normals are `-X`; after the authored Y rotation the display faces `+Z`.
- Topology: 4 vertices, 6 unsigned-byte indices, 2 triangles, one primitive. Positions are float32; normals and tangents are normalized int8.
- Material: one unnamed default metallic-roughness material. The only mesh is the display.
- UVs: UV0 and UV1 are both complete, continuous `0..1` square unwraps, with V increasing from top to bottom. The LED workflow consistently uses UV1 for both assets.

### Preparation decision

The geometry is correct and should not be reconstructed. The catalog uses the committed source copies directly and performs a small deterministic normalization before the engine rebuild: it removes the source-stage translation, keeps scale and orientation, replaces only the display material, and adds metadata. This preserves the curved wall’s true chord, arc, topology, normals, and continuous UV1. Because neither GLB includes frame/support meshes, there is no non-display geometry to make emissive; future assets can identify a display child while leaving their other children untouched.

## Versioned metadata and ownership

The LED root carries JSON-safe `userData.rayzeeLED` version 1:

```js
{
  version: 1,
  isLEDVolume: true,
  assetId,
  assetType,
  displayMeshIdentifier,
  physicalDimensions: { width, height, depth },
  nativeCanvas: { width, height },
  maxBrightnessNits,
  currentBrightnessNits,
  uvChannel: 1,
  uvBounds: { minU, maxU, minV, maxV },
  flipU,
  videoPlacementTransform: {
    position: { x, y },
    scale: { x, y },
    rotationDegrees,
    aspectRatioLocked,
    fitMode
  },
  loop
}
```

The display child carries `userData.rayzeeLEDDisplay` with the matching stable identifier and surface role. `LEDVideoManager` lives in the application layer because `File`, object URLs, `HTMLVideoElement`, autoplay policy, and browser media events are host concerns, not renderer concerns. It keeps a record per root UUID containing the transient source `File`, object URL, video element, `VideoTexture`, paused-frame canvas and `CanvasTexture`, event-handler list, video-frame callback handle, generation/capture IDs, and pending placement timer. None of these resources enters serializable `userData`.

Selection changes do not affect playback. Selecting a child walks its ancestors to find the LED root. Replacing or clearing video increments its generation, cancels callbacks/listeners, pauses and detaches the element, revokes the object URL, and disposes both textures. Removing a wall disposes its one record; replacing/unloading the whole scene disposes all records. Application disposal does the same. Device loss releases media resources and leaves a reload-required error because the engine intentionally does not rebuild a lost WebGPU device.

## Catalog and scene integration

- `app/src/Constants.js` defines the local catalog entries and immutable source facts. They are appended to `MODEL_FILES`, so the existing default model index does not move.
- `ModelsTab.jsx` keeps the catalog’s Add action for LED entries and hides Replace: LED assets always append to the current scene.
- `useAssetLoader.js` routes an LED catalog item to the dedicated add operation while retaining the existing loading/toast behavior.
- `AssetLoaderService.js` calls `PathTracerApp.addModel()` with a synchronous `prepareRoot` hook, ensuring normalization, material setup, and metadata exist before geometry/material extraction.

The normal engine append path tags the root as a scene object and performs the same reframe-free rebuild used by other added models. Consequently, LED roots and children appear in the outliner, use standard selection and transform gizmos, participate in visibility updates, and use the existing scene-object removal path.

## Video and renderer lifecycle

Input validation accepts `.mp4` and `.mov`, verifies the supplied MIME type when available, the ISO base-media `ftyp` box, an `avc1`/`avc3` H.264 sample entry, baseline browser capability, and finally native `canplay`/`error` decoding. The video is always muted, default-muted, inline, and has no audio controls. Native `loadedmetadata`, `loadeddata`, `canplay`, `play`, `pause`, `timeupdate`, `seeking`, `seeked`, `ended`, and `error` events drive UI state. A rejected `play()` promise becomes an actionable inline error.

Each playing wall uses its own `VideoTexture` in raster mode. `requestVideoFrameCallback`, where supported, marks frame availability and wakes the existing application loop; the raster branch itself remains the presentation loop. When the first video starts, the manager saves the user’s path-tracing preference, forces `pathTracerEnabled = false`, and wakes a loop that may have stopped after convergence. Raster mode remains forced while the active count is nonzero. A path-tracer toggle during playback updates the saved preference but cannot leave raster mode; the latest value is restored only after all static-frame uploads finish.

On pause, end, initial load, or a completed seek while paused, the manager draws the exact current media time into that wall’s private canvas. A `CanvasTexture` replaces the raster `VideoTexture`, and the engine rebuilds its static material texture buckets once every wall is inactive. If another wall is still playing, capture is retained but bucket upload is deferred, preventing any live `VideoTexture` from entering the path tracer. A queued material rebuild then makes the paused image available for primary visibility, reflections, indirect transport, and emissive shading; the material’s already-emissive triangles remain in next-event sampling. Generation/capture IDs plus a global mode-operation ID prevent an old capture or rebuild from restoring path tracing after playback has restarted.

Both raster and path tracing therefore show pixels from the same captured canvas at the same media time and use the same texture matrix. Path-tracer accumulation resets after texture/material or placement commits.

## Brightness

One conversion is used everywhere:

```text
renderer emission = brightness in nits / 100
```

Thus the 600-nit wall reaches emission 6 and the 10,000-nit wall reaches emission 100, preserving the `16.67:1` pre-tone-map ratio. The value is clamped to each asset’s maximum. The raster `MeshStandardMaterial` and path-tracer material buffer receive the same intensity. The engine’s emissive-triangle power calculation multiplies material luminance by emissive intensity, so LED triangles enter its light BVH and their selection power follows the same nits ratio. The current sampler is triangle/material-importance sampled rather than per-texel importance sampled; the captured map is evaluated for visible and bounce-hit emission, while triangle selection uses the conservative white display scalar. Tone mapping and exposure can compress or clip the displayed ratio but do not change scene-linear emission. A future bloom pass should consume the tone-mapping pipeline’s HDR input; it must not introduce a second nits conversion.

## Placement convention

Placement uses normalized logical-canvas coordinates independent of 6144 × 2592 or square output resolution:

- Origin `(0,0)` is the logical canvas top-left; `+X` points right and `+Y` down.
- `position` is the video rectangle centre/pivot.
- `scale.x` and `scale.y` are rectangle width and height divided by LED canvas width and height. Values and centres are not clamped, so overscan is cropped by the display.
- Rotation is clockwise degrees about the rectangle centre.
- The mapping order is authored UV1 normalization (and asset-specific U mirror), inverse translation to the pivot, inverse rotation, then inverse X/Y scale into source-video UV space.
- `contain` fits the full source, `cover` fills and crops, `stretch` sets both normalized dimensions to one and unlocks aspect ratio, and reset returns to centred contain.

Both supplied UV sets use a glTF/top-left V convention for the chosen channel, so both live and captured textures set `flipY = false`. Both use `channel = 1`, identical `matrix`, clamp wrapping, and centre-aware affine offset/repeat/rotation. The curved mesh’s UV1 normalization turns its authored V subrange into `0..1`; its continuous U coordinate carries the same transform across all curve segments. During playback placement edits change only the raster texture matrix. When paused, a 160 ms commit debounce updates the path-tracer emissive transform and resets accumulation.

The path tracer packs one UV set per triangle, so the display mesh also carries `userData.rayzeeUVChannel = 1`. `GeometryExtractor` honors that opt-in hint (and otherwise remains on UV0), ensuring the paused-frame path uses the same continuous channel as Three.js raster rendering.
