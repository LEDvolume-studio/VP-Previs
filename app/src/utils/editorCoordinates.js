// The renderer and saved projects use Y-up. The editor presents Unreal's
// X-forward, Y-lateral, Z-up coordinates without changing stored transforms.
export const toEditorAxes = value => [ value[ 0 ], value[ 2 ], value[ 1 ] ];
export const toEngineAxes = toEditorAxes;
