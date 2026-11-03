# Focused upstream fixes — 14 October 2026

Selected from `atul-mourya/rayzee-renderer`, reviewed through upstream
`b1fd4ff1` (v11.8.0), and applied to the VP fork at `85b3825f` plus its existing
working-tree changes. This is a selective code integration, not a full upstream
merge or version upgrade.

## Imported changes

| Upstream commit | Change |
| --- | --- |
| `ed268cd7` | Convert imported glTF punctual lights from photometric units and correct spotlight falloff. Includes the corresponding bench light units. |
| `7951e434` | Remeasure the survivor curve when transmission/subsurface budgets change, avoiding dropped light paths. |
| `bb075e32` | Request a display refresh after the closing denoise. |
| `ccbd0f5c` | Cache OIDN weight downloads by URL, retry failed downloads, and clear the cache on disposal. |
| `94b1535e` | Abort and yield before disposing a denoiser network during a quality switch. |
| `7f3b9ae0` | Upload only changed TLAS leaves after visibility edits. |
| `b54da933` | Clear partial update ranges before a later full buffer upload; required alongside the visibility optimization. |
| `ff5664ac` | Refresh materials/textures without replacing the scene's emissive sampling or instance table. |
| `ee3cbfe5` | Split large one-dimensional compute dispatches into rows within the device limit. |
| `4d0dec97` | Share the Outliner's selection subscription and notify only affected rows. |

Only application/engine code, tests, and the relevant bench scene changes were
imported. Upstream agent instructions, release files, and broad architecture
changes were excluded.

## Fork integration

The existing camera, editor-view, sensor, project persistence/undo, and LED video
implementations are retained. The only addition to the already modified
`PathTracerApp.js` is the denoiser display-refresh callback, wired to its existing
`refreshFrame()` method. No camera navigation or project schema changes are
needed for this integration.

Additional regressions cover closing-denoise redraws and stale completion events,
preservation of emissive/instance data on material rebuild, and bounce readbacks
when a free-bounce budget changes or a camera move invalidates the measurement.
Imported tests cover light units, OIDN caching/model swaps, BVH upload ranges, and
large dispatch limits.

Imported glTF punctual lighting intentionally changes: new imports now use the
correct photometric conversion. Scenes previously tuned around overbright
imported lights may need their lighting/exposure reviewed. Existing processed
lights retain their conversion markers; this change does not migrate saved
project light values. LED emissive materials are outside this light-unit conversion.

## Validation

- Before integration: 100 test files / 1,391 tests passed.
- After integration: 105 test files / 1,411 tests passed, including the fork's
  project, undo, LED video, editor-view, sensor, raster, transform, and navigation tests.
- `npm run build`: engine and app builds passed.
- ESLint on changed code/tests: no errors; two existing unused-variable warnings
  remain (`renderMode` in `PathTracerStage`, `context` in `DenoisingManager`).
- GPU quality checks passed against existing goldens and ground truth for
  `cornell-emissive`, `glass-transmission`, `shadow-catcher-ground`, and `refit-deform`.
  Baselines were not blessed or replaced.
- Live-app smoke check: initialization, Outliner selection/deselection and row
  highlighting, and right-mouse/W camera navigation.
- Preservation check: reconstructed the pre-integration dirty tree and verified
  all 33 originally modified tracked files (allowing the one intended callback
  addition) and all 22 existing untracked files against the recovery snapshot.
- `git diff --check`: passed.

The GPU checks cover the four named scenes, not every possible production asset.
The full v11.8 camera, storage, colour-management, and denoiser migrations remain
separate work.
