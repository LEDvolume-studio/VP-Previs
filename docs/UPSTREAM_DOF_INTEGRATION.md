# Depth-of-field integration — 15 October 2026

This batch adapts upstream `c6987163` to the VP fork after the focused fixes,
light-radius support and imported camera clipping. Existing commits and previous
working-tree changes are retained. No package version or Git history is changed.

## Lens models

Enable Depth of Field in the Camera tab, then choose **Lens Model**:

| Model | Behavior |
| --- | --- |
| Legacy | The existing aperture radius, spherical focus target and normalized focus-distance UI. This remains the default, including for older projects and camera effects without a model field. |
| Physical | Upstream's corrected radius `focalLength / (2 × f-number)`, converted from millimetres using Scene Units / Metre. Focus is measured on a flat plane perpendicular to the camera axis. DOF Intensity remains an artistic multiplier; use 1 for the specified f-number. |
| Look | Background Blur sets far-background blur as a fraction of image height. Lens size follows focus distance and field of view, giving the same normalized blur at different scene scales. Perspective focus uses the same flat plane as Physical. |

Use Scene Units / Metre = 1 for a scene in metres, 100 for centimetres, and 1000
for millimetres. In the new models, focus controls display scene units. Panorama
uses radial focus and pauses autofocus without losing the Auto preference.

The compatibility default intentionally differs from upstream, which changes its
viewer default to Look. The existing `sceneScale` uniform and old preset behavior
remain available in Legacy. New-model presets change aperture/blur and bokeh
parameters without changing the sensor, focal length, FOV, camera position or
focus distance. Your existing manual-focus controls are retained.

## Fork integration

- The primary and debug kernels use the same lens parameters. Imported camera
  clipping from the previous batch still applies after lens-ray generation.
- New-model autofocus and click-to-focus measure axial depth. Legacy keeps its
  original radial measurement and UI conversion. Autofocus history resets on a
  camera, scene-camera list or lens-model change.
- Model, blur and units are captured with each camera's effects and included in
  saved-view/project snapshots. Older effects restore Legacy rather than
  inheriting a newly selected model from another camera.
- The three new fields are part of the camera undo and persistence keys.
  Opening an older project explicitly resets their defaults, preventing state
  from a previously opened Physical/Look project from leaking into it.
- Sensor controls, frame overlays, editor views, Unreal navigation and LED video
  workflows retain their existing implementations.

## Validation

- Full suite: 109 files / 1,430 tests passed, including the existing LED,
  project, undo, sensor, editor, raster and navigation regressions.
- New CPU tests cover mode routing, axial versus legacy autofocus, panorama
  suspension, per-camera/project effects, preset framing, focus-unit conversion,
  camera undo and opening an older project after using another model.
- `npm run bench:studio` checks 128 GPU rays for each lens configuration: the
  Legacy aperture and spherical focus remain intact; Physical has the corrected
  radius and flat focus; Physical/Look stay consistent under a 100× scene-scale
  change; disabled DOF and zero Look blur produce pinhole rays. All three models
  render finite pixels through the application, and the debug kernel compiles.
  The previous light-radius and camera-clipping GPU checks also pass.
- GPU quality comparisons pass against existing goldens/ground truth for
  `cornell-emissive`, `glass-transmission`, `shadow-catcher-ground` and
  `refit-deform`. No baselines were replaced.
- Engine/app production builds pass. Changed-file ESLint has no errors; existing
  unused-variable warnings remain.
- Live app: Outliner selection/deselection and right-mouse/W navigation pass;
  the Physical selector is usable, scene units route to the engine, and a preset
  preserves the live camera's framing and sensor. No page errors occurred.
  The Camera panel was also inspected visually.
- A pre-edit recovery snapshot and incremental diffs are retained outside the
  repository. Unrelated pre-existing working files are unchanged.

These checks cover the listed behaviors and scenes, not every production asset.

## Remaining colour-management integration

OpenColorIO (`1c2a8904` and follow-ups) remains separate. It introduces an optional
WASM runtime and changes input textures, material/light emission, the environment,
the displayed view and export/readback transforms. Its upstream default remains
linear Rec.709 until a configuration is loaded, which offers a compatibility path.

The next integration needs explicit parity tests for the existing canvas and
saved-image look, the raster preview, and LED video texture updates before an
OCIO configuration is enabled. This batch adds no colour-management dependency
and changes no colour defaults.
