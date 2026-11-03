# Portable raster appearance

`app/src/previs/engine/RasterAppearance.js` owns the portable controls used by the existing admin `RealtimeRenderer`. It introduces no engine change or additional image grade. The optional shot `snapshot.rasterAppearance` is a complete version-1 record:

```js
{
  version: 1,
  postProcessing: 'rayzee-realtime-v1',
  toneMapping: 4,
  outputColorSpace: 'srgb',
  enableEnvironment: true,
  showBackground: true,
  transparentBackground: false,
  backgroundIntensity: 1,
  backgroundBlurriness: 0,
  backgroundColor: '#000000'
}
```

Exposure stays in `snapshot.camera.exposure`. The immutable HDRI reference, lighting intensity and rotation stay in `snapshot.environment`. Its legacy `background` flag must agree with `rasterAppearance.showBackground` when the appearance record exists. Background intensity is independent of environment lighting intensity; a hidden or transparent background does not disable HDRI lighting. Rotation is in radians in the environment snapshot and degrees in `RenderSettings`.

The post-processing identifier means the engine's existing MRT scene pass, full-resolution GTAO with depth/normal denoising, SSR, emissive bloom and SMAA. Their parameters and scene-bounds fitting remain owned by `RealtimeRenderer`. Capture checks the expected fixed pass parameters and output connection; raw rendering, missing passes or modified fixed parameters need a new supported appearance contract. The helper never guesses equivalent effects or creates a second stack. Built-in tone mappings 0–4, 6 and 7 are supported; custom tone mapping and non-sRGB output are rejected.

`captureRasterAppearance(host)` reads detached validated data. `applyRasterAppearance(value, host)` applies the small allowlist through real `RenderSettings.setMany(..., {silent: true, reset: false})`, writes renderer tone mapping/output colour space, and calls `RealtimeRenderer.syncEnvironment()`. It restores its owned settings and renderer values if synchronisation fails; both errors survive if restoration also fails. `createRasterAppearancePort(host)` exposes the existing shot-port read/capture/validate/apply/restore convention. `host` supplies the matching settings, renderer and real-time renderer. Camera, immutable HDRI/media resources, edit locks and the surrounding shot transaction remain the host's responsibility.

Live automatic exposure is rejected because its stage can mutate renderer exposure independently of fixed camera metadata. Enabled ground projection/catcher requires a separate supported scene conversion. Unknown fields and incomplete records are rejected before mutation.

## Authored settings versus raster-visible settings

The admin project stores many path-tracer and workspace settings. `classifyRasterRenderSetting(key)` is an explicit, finite conversion allowlist, not a rule that accepts every engine default:

| Classification | Treatment |
| --- | --- |
| `appearance` | Compare against complete live raster appearance. |
| `path-only` | Explicit conversion diagnostic acknowledges its omission from the raster shot. |
| `runtime-only` | Omit transport, helper and output-size preferences; student output has its own fixed dimensions. |
| `inactive-hdri-input` | Omit procedural/gradient inputs only after verifying HDRI mode. |
| `inactive-ground-input` | Omit projection/catcher dimensions only after verifying both features are disabled. |
| `null` | Reject or implement a dedicated conversion. |

Saturation routes exclusively to the path-traced compositor. Likewise `enableBloom` and its UI parameters control the path compositor; the raster stack always has its own emissive bloom values. Adding saturation or mirroring those UI bloom controls into student raster rendering would change the admin raster image. The bundled welcome project stores saturation 1.2 and exposure 0.22; the helper preserves exposure through the separate camera contract and does not invent a saturation grade. Its raster bloom remains strength 0.3/radius 0.35/threshold 0.8 even though the path-compositor bloom UI is disabled.

`maxTextureSize` is deliberately unclassified because texture downsampling can change the raster image. Asset preparation must handle that fidelity policy explicitly. `autoExposure`, environment mode and enabled ground features also require explicit converter handling. UI camera defaults may disagree with saved engine/live camera state; conversion must use established hydration precedence instead of treating stale UI defaults as separate authored camera values.

## Validation

`tests/unit/previs/rasterAppearance.test.js` uses actual `RenderSettings`, `RealtimeRenderer`, Three.js scene objects and the complete real post graph. Only browser image transport for SMAA lookup textures is replaced in Node; no GPU execution is claimed. The 23 checks cover strict validation, scene background/environment effects, renderer and setting restoration, post-stack rejection, conditional setting classification and the actual bundled welcome render values. A real WebGPU scene/export comparison remains a separate acceptance gate.
