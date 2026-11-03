export const DOF_MODES = Object.freeze( { physical: 0, look: 1, legacy: 2 } );

export const dofModeId = mode => Object.hasOwn( DOF_MODES, mode ) ? DOF_MODES[ mode ] : DOF_MODES.legacy;
