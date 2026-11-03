# Student/admin renderer comparison — 23 October 2026

Review: http://localhost:5173/student/?ui=editor

The student and admin raster viewports use the same `RealtimeRenderer`, Three.js
WebGPU renderer and GTAO/SSR/bloom/SMAA graph. Admin defaults to raster; the
student viewport does not implement the admin's optional path-traced final mode.

## Cause and correction

The original local study was a diagnostic fixture. It loaded the SUV's embedded
material defaults, used strong point lights, and had no HDRI lighting. It did not
restore the authored appearance from the admin project. The embedded car texture
image hashes match; this was not evidence of missing texture image bytes.

The follow-up report of a see-through body exposed a second, student-only issue:
admin `GeometryExtractor.processMaterial()` enables depth writing for imported
materials, while the student skipped geometry extraction and retained glTF BLEND's
`depthWrite=false`. Opaque paint texels then failed to occlude subsequently drawn
meshes. The body alpha pixels are all 255 and all nine exterior paint primitives
have opacity 1; only six window primitives have reduced opacity. Both hosts now
call the same `RasterMaterialPreparation.js` helper for the existing admin depth
policy. No saved shot or authored material opacity needs migration.

Comparison used the actual admin export saved locally as
`~/Downloads/Sim-Trav-admin-render-comparison-20261023.rayzee`, revision 276.
That export contains normal scale `[1, -1]`, dedicated window opacity `0.06`,
exposure `0.12`, the Aristea Wreck HDRI at intensity 1 / rotation 270 degrees,
and authored directional/spot lights. These values now drive the review study.

- Admin `ProjectSession` and the student material port share one material
  serializer/restorer in `services/projects/MaterialState.js`. No student-specific
  paint/glass shader is introduced. Portable material state targets immutable
  mapped primitive paths/slots and embedded textures; unsupported material types,
  external texture URLs and arbitrary shader properties are rejected.
- Material and texture clones are owned by the loaded scene. Original shared
  model materials remain untouched. Capture/apply/rollback restores complete
  authored state, including embedded texture removal/restoration. Material changes
  refresh the shared renderer's material-dependent lighting/shadow policy.
- Versioned HDR/EXR environment bytes are size/hash verified before decoding with
  the same float loaders and texture configuration as admin. Environment changes
  requiring new assets trigger viewport preparation, rather than inheriting the
  previous shot's environment. Limits are 32 MiB encoded / 8M decoded pixels.
- Area-light LTC initialization now belongs to the shared `RealtimeRenderer`,
  so both hosts initialize the same lookup textures once. Imported material depth
  preparation is also shared; no lighting or reflection algorithm was forked.

Fresh development editor studies use the corrected appearance. Older studies
offer **Open copy with admin appearance**. This creates a separate locally saved
project, preserving shot cameras/lenses, scene placements, timing and media while
replacing the diagnostic material, light, environment and exposure settings.
The currently reviewed copy is **Studio study · admin appearance**; its original
project remains available through the project menu.

## Evidence and limits

`npm run test:previs:renderer-parity` runs a native WebGPU comparison of the SUV
through the student production viewport and an independent admin-style host using
the actual admin `AssetLoader`, `GeometryExtractor` material preparation,
`LightManager` and shared material restoration.
Both receive matching car transforms, camera, materials, HDRI, lights and post
settings at 1920 × 1080. The comparison passes with a mean absolute RGBA channel
difference of **0.00914 / 255**, below its 0.1 threshold. It is not bit exact:
edge outliers exist. Artifacts are `/tmp/sim-trav-renderer-parity/report.json`,
`admin-reference.png`, `student.png` and `student-depth-review.png`.

The earlier 0.01845 comparison omitted admin extraction and therefore missed the
depth-writing defect; that claim is superseded. Including actual admin material
preparation first reproduced the failure (**0.78547 / 255**); sharing the native
depth policy resolves it. A real-SUV unit regression independently checks all 69
mesh depth flags, nine opaque paint primitives and six transparent window meshes.

The full unit suite passes **2,194 tests / 152 files**, including actual HDRI
float-byte equality, material restoration/isolation, unsafe state rejection,
aliased primitive rejection, and area-light LTC inputs. Full engine/app build
passes, and scoped lint is clean. Browser interaction and offline-shell results
from the preceding appearance change remain recorded in the progress log.
The first full-suite run overlapped the build and hit import/hook timeouts;
the subsequent full run without the concurrent build passed all tests.

This proves equivalent raster rendering for matching tested inputs. The local
study retains its own studio layout, mannequin, LED test clip and cameras; it is
not a copy of every object/placement or road plate in the user's admin scene.
Live admin capture/publication still needs explicit material/HDRI mapping support
in its converter and UX. Arbitrary admin shaders, externally sourced material
textures, path-traced final mode and visible student DOF remain separate gates.
No new clarification is needed under the retained decisions. Nothing was pushed
or deployed.
