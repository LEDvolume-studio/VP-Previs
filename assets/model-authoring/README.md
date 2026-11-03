# Model authoring archive

These files preserve the editable rigs, sample projects, and validation records used for the bundled pose assets. They were copied from the workspace's `../assets/` investigation folders so they are included in Git. The original working files remain in place. Raw API responses, temporary exports, downloaded service exports, and Blender `.blend1` backups are omitted.

## Mannequin

`mannequin/mannequin-source.blend` is the downloaded Rigify source. `mannequin/mannequin-presets.blend` is the editable standing/seated master. To reproduce the preset export in this archive directory:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --disable-autoexec --python assets/model-authoring/mannequin/build-presets.py
```

The script writes its GLB and previews beside itself; the runtime copies are committed under `app/public/characters/mannequin/`. `mannequin/mannequin-two-poses.rayzee` is the portable example project. JSON files record the original CLI validation results, not tests automatically rerun when these archive copies change.

See [mannequin integration](../../docs/MANNEQUIN_POSES.md) for runtime behavior and provenance. The model's Blendkit royalty-free license still governs distribution.

## SUV

`suv/mid-suv-rigged.blend` is the editable hinge rig with separated window-glass material. It retains full-resolution image references to the user-supplied `/Users/mitcha/Downloads/asset/` folder; those original texture images are not embedded in this Blender archive. The runtime GLB under `app/public/vehicles/mid-suv/` embeds its optimized textures and is self-contained.

`suv/mid-suv-front-doors.rayzee` is the portable both-doors-open example. `inspection.json` records the source hierarchy and materials; `rig-summary.json` records the final export parameters. Reproduce the SUV from its user-supplied source with `scripts/prepare-mid-suv.py`, as described in [vehicle integration](../../docs/VEHICLE_DOOR_POSES.md). That script continues writing the original workspace authoring folder; refresh this archive after future authoring changes.

The source asset's license still governs distribution. Committing these local files does not publish or deploy them.
