# Mid SUV front-door presets

Open **Poses → Vehicles → Add Mid SUV** to append the SUV to the current scene. It is also available in Assets → Models. Two independent switches, **Left door** and **Right door**, open or close each front door. Each switch displays Open or Closed; switching one leaves the other door's angle untouched. Each open door rotates 65° about its forward hinge. Left/right follow the supplied model's L/R naming.

For this OneDrive checkout, run `npm run dev:local` from the Rayzee repository and open `http://localhost:5173/`. This launcher copies public assets into `~/.local/share/rayzee/runtime-<checkout-id>/public` and places Vite's dependency cache at `node_modules/.vite` beneath that runtime directory. The `node_modules` path segment is required to keep the React compiler from processing bundled dependencies a second time and injecting invalid named imports. It avoids the File Provider stream timeouts observed when serving the GLB directly from OneDrive. Source files and original public assets remain in the checkout. Restart the launcher after changing public assets to refresh the served copy; source edits still use normal Vite hot reload.

Use the vehicle dropdown or select a vehicle part in the outliner to target an instance. Each car has independent hinges. Door rotations persist through the existing node-transform project serialization, and pose changes participate in undo/redo. Undo also restores custom hinge angles edited through Attributes.

The **Window transparency** slider beneath the door toggles fades the selected SUV's glass: 0% preserves its original textured appearance, and 100% hides the glazing. It controls the windshield, door and rear quarter windows, rear window, and roof glass. Window borders, mirrors, headlamps, taillights, and interior elements retain their materials. This is an opacity fade, not a change to physical refraction or tint. Changes support undo/redo and existing project material serialization. Older in-memory exports without the dedicated glass material display a re-add hint.

The prepared example `assets/suv-investigation/mid-suv-front-doors.rayzee` (relative to the workspace root) contains the SUV with both front doors open and a camera framing the car. Import it through File → Import Project and open Poses → Vehicles.

Git-tracked copies of the editable rig, example project, and inspection records are archived under [`assets/model-authoring/`](../assets/model-authoring/README.md) in this repository. The original workspace files remain unchanged.

## Asset preparation

Source: `/Users/mitcha/Downloads/asset/KB3D_Mid SUV.blend`. The supplied Blender, FBX, OBJ, MTL, and textures remain unchanged.

From the Rayzee repository:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python scripts/prepare-mid-suv.py -- --source '/Users/mitcha/Downloads/asset/KB3D_Mid SUV.blend'
```

The script relinks all 87 referenced external texture files, adds forward-edge hinge parents to the existing separate front doors, and exports `app/public/vehicles/mid-suv/mid-suv.glb`. It saves a full-resolution editable Blender copy in `../assets/suv-investigation/mid-suv-rigged.blend` before optimizing the web textures.

The web export caps textures at 1024 pixels and uses JPEG quality 90 for opaque images, with PNG retained where alpha is needed. Images are embedded in the GLB, so there are no loose texture paths to reconnect in Rayzee. The export is approximately 19 MB; original-resolution source textures remain available for future higher-quality exports. Blender displacement is not baked into glTF geometry. The original PBR base color, roughness/metallic, normal, emissive, and alpha inputs are retained where supported by glTF.

The entire door assembly moves beneath each hinge, including the exterior, window, mirror, inner trim, and other material primitives. Rear doors, hatch, wheels, and body remain as separate source parts but are not controlled by this first set of presets. CLI renders `closed.png` and `both-open.png` were visually checked for door direction and attachment.

The source's `KB3D_CEV_TranslElemMidSUV` atlas material mixes glass and lamp lenses. The exporter classifies its disconnected polygon islands using inspected source-space bounds, assigning only the 1,860 window polygons to `KB3D_MidSUV_WindowGlass`. Its glTF material extras include `rayzeeVehicleWindowGlass: true`. The copied material retains original UVs, textures, and shading; lamps and interior components keep the original material. A polygon-count assertion guards changes to this source-specific classification. The original mesh topology and front-door primitive counts remain unchanged; body and hatch gain a separate glass material primitive.

## Runtime integration

Hinge nodes carry `rayzeeVehicleDoor` and `rayzeeDoorOpenDegrees` glTF extras. `vehicleDoorPoses.js` applies local quaternions and reads each hinge independently for the switches. A manually adjusted nonzero angle is shown as Open; closing that switch resets it to zero, while opening sets it to 65°. Toggling the other door preserves the custom angle. Existing named preset helpers remain available for programmatic use.

`VehicleDoorPoseService` identifies all 12 material primitives beneath the two front-door hinges using the engine's `sceneMeshes` index space. It calls `app.updateMeshTransforms(indices)`, updating only rigid placement matrices and scene BVH bounds. It does not modify vertex buffers, refit deforming geometry, reload materials, or rebuild the scene. Initial model import still requires the normal scene build. Failed uploads roll back hinge transforms.

No engine files were changed. The catalog entry, vehicle pose UI, and controller are app-side additions. Existing mannequin controls remain under Poses → People.

`VehicleWindowService` targets only the six meshes with the window material marker, updates their Three.js opacity and transparency, and uploads those scalar values through `app.setMaterialProperty`. It does not rebuild geometry, BVHs, or material textures. Slider edits coalesce in undo history. Project saving already serializes opacity and transparency per mesh, so no schema change is needed.

## Verification

Tests load the delivered GLB's actual geometry/hierarchy (without browser image decoding), verify embedded PBR images, all four presets, fixed hinge positions, independent instances, unchanged body geometry, project-transform round trips, custom-angle undo states, targeted rigid updates, rollback, and load-overlap prevention. Window tests cover isolated glass, independent instances, 0/65/100% transparency, restorable material state, unchanged non-glass materials, and targeted material uploads. The full suite passed: 113 test files and 1,445 tests. Engine and app production builds passed.

The local server successfully served the GLB with a matching source hash, the vehicle UI module, and the required cross-origin isolation headers. The glass-enabled GLB is 19,432,020 bytes. Targeted ESLint checks passed. Chrome verified the independent door switches and window slider at 0/50/100%, including Edit → Undo/Redo. The 50% transparency setting survived saving and a full page reload, with no console errors. No Building BVH overlay appeared during slider changes. No deployment was performed.

## Provenance

This asset was supplied by the user for their local Rayzee workflow. No license document was included in the inspected asset folder. Its source license still governs any distribution; this task does not publish or deploy the model.
