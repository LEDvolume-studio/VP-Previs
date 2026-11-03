import { context } from 'three/tsl';

// Matches upstream's per-kernel context. Only light-radius specialization is
// backported here; existing texture binding remains owned by ShaderBuilder.
const KEY = 'rayzeeScene';
export const withSceneResources = ( node, resources ) => context( node, { [ KEY ]: resources } );

export function usesLightRadius( builder ) {

	return builder.context[ KEY ]?.lightRadius ?? true;

}
