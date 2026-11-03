# Student timeline viewport reuse

The student timeline reuses its loaded models, GPU device, native cameras and
light objects when moving between shots of the same base scene. Camera and
object transforms are shot state, not reasons to recreate the renderer.

`ShotLightPool` prepares the union of saved lights for that scene. Each native
shot application receives a detached preview copy padded with inactive lights;
missing lights are hidden and have zero intensity. Portable documents, undo
history and exported shots keep their original light inventories. The viewport
compatibility check accepts subsets of this prepared pool while still rejecting
unknown IDs/types and changed immutable assets.

The student viewport opts into `RealtimeRenderer.stableLightInventory`. This
keeps raster proxy lights and their shadow slots in the render list, using zero
intensity for hidden canonical lights. Otherwise Three.js changes its lighting
pipeline when the visible light list changes, even though the GPU device and
scene objects were retained. This option is deliberately off by default for the
main editor. Preserve that opt-in boundary during upstream merges.

`studentTimelineScrub.browser.mjs` checks repeated forward/backward seeks in both
Sequencer and Viewport modes across shots with different saved light lists. It
requires zero rebuilds, shader precompiles, new render pipelines or asset fetches,
unchanged saved project data, correct shot cameras and restoration of the first
rendered frame.
