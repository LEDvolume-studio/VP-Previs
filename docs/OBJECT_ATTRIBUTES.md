# Object attributes and manifest transforms

The Attributes tab retains the persisted `material` tab identifier so existing projects and selection routing continue to work. Material editing remains available below the transform section when a mesh is selected.

## Transform ownership

Every scene node owns its local position, quaternion and scale, including asset roots, nested folders and meshes. Parent matrices compose with child matrices to produce world transforms. Editing a folder therefore moves its complete subtree without changing child-local values or shared geometry. Numeric edits use the same transform refresh and project undo checkpoints as gizmo edits. Rotation is displayed in degrees in the object's Euler order; the manifest retains the quaternion to avoid depending on an Euler display convention.

The existing version 1 JSON manifest (`.rayzee`) already captures all nodes, keyed by asset instance ID and child-index path. No new parallel transform store or schema migration is needed. Paths assume the same version of the asset retains its hierarchy. Shared manifests still require the referenced asset files to be available; measurements do not embed geometry or make external assets portable.

## Measurements

Size is derived from world-aligned geometry bounds for the selected node and its descendants, including hidden geometry. It includes ancestor scale and changes with rotation. It is read-only; scale edits resize the selected node. Empty folders display a dash. Size is not persisted because it would become stale after a transform or asset change.

Position uses metres relative to the parent; scale is a dimensionless multiplier. The world convention is **1 unit = 1 metre**, declared as `scene.units: { length: "metre", metresPerUnit: 1 }` in the JSON manifest. Legacy manifests receive this metadata without rescaling their authored placements; incompatible explicit unit conventions are rejected rather than silently misinterpreted. Imported coordinates are interpreted in metres; assets authored in another unit must be converted or resized with the Attributes scale control.

## Studio One calibration

Studio One is retained at its native root scale `[1, 1, 1]`. Interior ray samples in the bundled GLB, taking the nearest surface from inside the room (therefore excluding wall thickness), give:

| Measurement | Reference (approx.) | Model at metre scale |
| --- | ---: | ---: |
| Long side, Z | 17.01 m | 17.00989 m |
| Short side, X | 14.24 m | 13.95620 m |
| Clear height, Y | 9.10 m | 9.12509 m |

Horizontal samples originate at `(0, 4, 0)` along both X and Z directions; vertical samples originate at `(4, 4, -5)` to avoid overhead equipment. The width discrepancy is approximately 2%; long side and height already closely match the reference. A uniform scale correction cannot reconcile all three, and stretching only the width would distort the authored model on the basis of approximate measurements. The chosen calibration is therefore 1 metre per existing unit. These are sampled clearances, not a survey of all room surfaces.

The full model's bounds are about `16.668 × 9.242 × 17.180` metres before scene placement: these include protruding geometry, not just the room. The Attributes size remains the world bounding box, so a rotated studio can have larger X/Z values than the internal room dimensions.

## Orthographic grid

Top, Front and Side views share a Grid toggle, saved as `workspace.editorView.gridVisible`. Legacy projects default to showing the grid. Minor spacing adapts in metric 1/2/5 increments as the user zooms; major lines occur every ten minor intervals. The displayed spacing is in metres. The toggle hides grid lines and world axes while retaining the viewport background and model. It does not affect the photographic camera or final renders.

Edits commit on Enter or blur, Escape discards an uncommitted edit. Non-finite values and near-zero scale are rejected; negative scale remains supported for mirrored assets. Measurements refresh when subtree world matrices change, including gizmo edits and undo/redo. This inspector measures static geometry placement; it is not a continuous per-frame deformation measurement tool for animation.

## Temporary ruler annotations

Top, Front and Side views have a Ruler button. With it enabled, drag with the left mouse button to draw a measured line. Holding Control temporarily enables the same left-drag action; holding the middle mouse button draws one ruler without leaving the tool enabled. Holding Shift during a drag constrains the line to the nearest horizontal or vertical direction in that view. The distance label is in metres and updates as the line is drawn. Rulers are placed on the active orthographic camera's target plane, so they measure projected distance in that view rather than raycast distance across model surfaces.

Rulers are stored in memory per view. They remain when switching among Top, Front, Side and Perspective, and update on pan, zoom or resize. Clear removes all rulers from all three views. They are cleared when the project changes or the page refreshes, and never enter the manifest or exported render.
