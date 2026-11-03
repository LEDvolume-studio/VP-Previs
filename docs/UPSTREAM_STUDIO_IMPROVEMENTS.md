# Upstream studio improvements — 14 October 2026

This batch selectively backports two features from upstream v11.8.0 onto the
existing VP fork and the previously integrated focused fixes. It does not change
the package version or merge the later upstream engine architecture.

## Point and spot light radius

Based on upstream `8fbfcbdb`. The Lights panel now has a **Radius** control for
point and spot lights, in scene units. Zero retains point-light behavior; a
positive radius samples a facing disc to produce soft shadows and finite-size
falloff in path-traced renders. Spotlight cones, gobos and IES distributions
continue to use the direction to the light's centre.

The radius is stored in `light.userData.radius`, represented in LightManager's
descriptors, and included in the existing project save/load and lighting undo
paths. Older descriptors default to zero. Raster preview retains its existing
Three.js point/spot lighting model.

The point-light GPU record grows from 9 to 10 floats; the spot record keeps its
20-float stride and uses reserved slot 18. CPU serialization, uniform allocation,
light counts and shader indexing are updated together. A small subset of
upstream's per-kernel `SceneResources` context compiles disc sampling only while
a point or spot light has a radius. Changing between zero/nonzero requires a
kernel rebuild; changing one positive radius to another updates the light buffer.

## Imported camera clip start

Based on upstream `e73acdde`. The glTF loader preserves authored `znear` as
`camera.userData.clipStart`. Perspective rays begin on that plane; panorama rays
begin on a sphere. The default viewer camera keeps a zero path-tracing clip start,
independent of its raster `near` value.

The backport covers primary rays, debug rays, the NormalDepth denoiser guide,
viewport picking, click-to-focus and autofocus. It uses the fork's existing
CameraManager, saved views and project snapshot format. Per-camera effects,
sensor settings, Unreal navigation and the separate orthographic editor views
remain intact. New snapshots store clip start; older snapshots without the field
retain imported camera metadata or the zero default for an untagged camera.

USD-specific import changes and bidirectional tracing changes from these upstream
commits are not applicable to the current fork and were not imported.

## Validation

- Full suite: 107 files / 1,419 tests passed, including the prior focused fixes
  and the fork's LED, project save/load/undo, navigation, sensor, transform,
  editor-view and raster tests.
- New CPU regressions cover camera switching, saved views, project snapshots,
  clipping-aware picking, radius editing, light save/restore, older light
  descriptors and shader specialization.
- Engine and app production builds passed.
- ESLint on changed files: no errors; existing unused-variable warnings remain.
- Existing GPU golden/ground-truth checks passed for `cornell-emissive`,
  `glass-transmission`, `shadow-catcher-ground` and `refit-deform` without
  replacing baselines.
- `npm run bench:studio` checks disc-light irradiance and spotlight cone bounds
  numerically, checks perspective/panorama clip distances, and renders complete
  scenes to verify wall clipping and reversible zero/nonzero radius changes.
- The clipping render reads red 0 with the wall visible, 1 beyond the clip plane,
  and 0 again after disabling clipping. The radius render returns exactly to its
  initial point-light mean after radius is set back to zero.
- Live app: 67 meshes loaded, Outliner highlight and click-to-deselect passed,
  right-mouse/W navigation moved the camera, and no page errors occurred.
- A recovery snapshot was saved before editing. Of the 73 pre-existing working
  files, 66 remain byte-for-byte unchanged. Seven receive the integration edits:
  the light-store branch, glTF plugin, path tracer camera/light handling, light
  shader data/sampling, and clipping-aware interaction. Their incremental diffs
  were reviewed; existing LED, project and navigation implementations are retained.

These checks cover the named behaviors and scenes; they do not establish parity
for every production asset.

## Remaining larger integrations

Scale-aware depth of field was subsequently integrated with a Legacy compatibility
mode on 15 October; see [the DOF integration report](UPSTREAM_DOF_INTEGRATION.md).
OpenColorIO/Blender colour configuration still needs dedicated integration and
migration tests against the fork's existing look and LED texture updates. The
full renderer/viewer split and storage/denoiser migrations also remain separate work.
