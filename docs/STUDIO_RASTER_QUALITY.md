# Studio One raster quality

The studio's original normals smoothed across sharp structural corners. Its
25 primitives also used quantized normals. The bundled GLB now has 45-degree
creased normals stored as floats. Triangle positions, order, winding, materials,
nodes and metre scale are unchanged, preserving saved manifest paths.

`node scripts/repair-studio-normals.mjs` reproduces the repair from the original
asset (or accepts a path). The script refuses unsupported geometry and verifies
that expanded triangle positions remain identical before writing the GLB.
The asset test retains the original expanded-position checksum and checks normals.

The raster renderer previously fitted GTAO and shadows using all scene geometry,
including the invisible oversized ground. It now fits to visible meshes, including
object bounds for skinned and instanced meshes. Ambient occlusion represents local
contact: radius is 1.5% of visible scene span, clamped to 2–30 cm, and thickness is
half that radius. Shadows and reflections also benefit from the corrected bounds.

GTAO runs at native resolution with 16 samples and a depth/normal-aware spatial
filter before the existing SMAA pass. This reduces occlusion noise and coarse
edges but increases raster GPU work compared with the old 75% resolution AO.
The filter is disposed with the rest of the raster pipeline. These are narrow
changes in the local raster manager; the path-tracing pipeline is unchanged.

Validation: renderer, bundled asset and project-session tests; production build;
touched-file lint. GPU shader execution and before/after visual comparison still
require a browser with WebGPU; they were unavailable in the development session.
