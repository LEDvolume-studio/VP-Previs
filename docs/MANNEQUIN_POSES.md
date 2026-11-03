# Mannequin pose presets

The **Poses** tab adds the rigged mannequin to the current scene and switches each instance between **Standing up** and **Sitting down**. Adding a mannequin preserves the current scene. The mannequin is also listed in Assets → Models.

Open the local app at <http://localhost:5173>, choose Poses, and click Add mannequin. Select a character in the dropdown or outliner, then choose its pose thumbnail. Pose changes participate in undo/redo and persist through project saves. Both poses place the feet at floor height; the seated pose is approximately 1.45 m tall, with an upright torso and horizontal thighs. A chair is not included.

For a prepared example, import `assets/mannequin-investigation/mannequin-two-poses.rayzee` from the workspace root using File → Import Project. It contains two independently posed mannequins and a camera framing both; it does not replace the bundled default project.

Git-tracked copies of the source, editable preset rig, generation script, example project, and validation records are archived under [`assets/model-authoring/`](../assets/model-authoring/README.md) in this repository. The original workspace files remain unchanged.

## Asset pipeline

The model comes from [Rigged Human Mannequin man (Rigify), by Fasolka 3D](https://www.blendkit.com/asset-gallery-detail/7a5aeacf-d088-423e-916c-f9bbdfdb9306/). It uses grey and orange PBR materials and has no image textures. The original `.blend`, editable preset `.blend`, CLI generation script, and proof renders are in the workspace's `assets/mannequin-investigation/` directory.

Rebuild from the workspace root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python assets/mannequin-investigation/build-presets.py
cp assets/mannequin-investigation/mannequin-presets.glb assets/mannequin-investigation/standing.png assets/mannequin-investigation/sitting.png rayzee-renderer/app/public/characters/mannequin/
```

The script switches the downloaded Rigify rig's constant IK blend constraints to FK, authors both poses, evaluates the mesh, and exports two shape samples including smooth normals. The resulting GLB retains 69 deform bones and skin weights. These are static presets, not animated transitions or a live IK editor. Additional poses should be authored using the original Blender rig and baked through this pipeline.

## App integration

`app/src/utils/mannequinPoses.js` recognizes the `rayzeePoseModel` glTF extras marker and the named `standing` / `sitting` morph targets. The app bakes the selected sample into base position and normal attributes and clears morph influences. Rayzee's path-tracer geometry extraction reads base attributes; this makes it agree with raster rendering without changing engine code. Each character receives independent geometry. Cached neutral samples prevent accumulation when switching poses repeatedly.

`MannequinPoseService` updates the pose through `refitBLASes()`, using only the mannequin's mesh indices from `app.sceneMeshes`. `mannequinPoseRefit.js` supplies world-space triangle positions and smooth normals, including parent transforms and nonuniform scale. The refit patches the affected GPU buffer ranges and updates BVH bounds without rebuilding the whole scene, reloading materials, or opening the Processing dialog. The existing engine may optimize these small BVHs in background workers. Initial imports still build the scene normally.

Rendering is paused during the synchronous update and its previous pause state is restored afterward. Geometry and BVH data roll back to the previous pose if the upload fails. A `MannequinPoseChanged` event refreshes the picker after undo/redo without emitting a structural scene rebuild.

`captureNodeTransform` / `restoreNodeTransform` save and restore the optional pose name on mannequin mesh nodes. Existing projects need no schema migration. Pose selection resolves the current model instance when applying undo/redo, rather than retaining a root from an older project load.

The right sidebar uses two rows of four tabs to make room for Poses. Existing editor, camera, materials, LED, and animation behaviors remain in their respective tabs.

## Verification

CLI proof renders were inspected for both poses. Regression tests load the real delivered GLB and check its skeleton, materials, grounded bounds, seated proportions, independent instances, repeated pose switching, saved-node restoration, normalized smooth normals, and agreement between skinned raster positions and path-tracer base positions. Service tests cover targeted refits, rollback, scene-load overlap prevention, and absence of full-scene rebuilds. Reader tests verify indexed and non-indexed geometry, world transforms, nonuniformly scaled normals, and exclusion of unrelated meshes.

The engine and app production build passed. Live Chrome checks confirmed standing, sitting, undo, and redo update the selected pose with no Building BVH dialog and no console errors. No deployment was performed.

The full suite passed: 112 test files and 1,439 tests. The changed refit code and tests passed ESLint with no errors.

## Provenance

The source metadata identifies this model as Blendkit royalty-free, not CC0. These files are included for this local application workflow. Review the [Blendkit license](https://www.blendkit.com/docs/licenses/licensing-faq/) before publishing a build that exposes the downloadable asset.
