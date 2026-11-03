import { assetVersionKey } from '../domain/StudentProjectSchema.js';

/** Prepared HDRI identity only; network fetching/decoding belongs to the loader. */
export function createStudentEnvironmentPort( { textures = new Map(), initial, settings, realtimeRenderer } ) {

	textures = new Map( textures );
	let current = structuredClone( initial );
	if ( typeof realtimeRenderer.setEnvironment !== 'function' ) throw new Error( 'Raster environment replacement support is required' );
	const validate = value => {

		if ( ! value || value.rotation?.length !== 3 || ! value.rotation.every( Number.isFinite ) || value.rotation[ 0 ] !== 0 || value.rotation[ 2 ] !== 0 ) throw new Error( 'Raster environment supports an explicit finite Y-axis rotation only' );
		if ( value.asset && ! textures.get( assetVersionKey( value.asset ) )?.isTexture ) throw new Error( 'The versioned environment texture is not prepared' );
		if ( ! Number.isFinite( value.intensity ) || value.intensity < 0 || typeof value.background !== 'boolean' ) throw new Error( 'Invalid raster environment settings' );

	};

	const apply = value => {

		validate( value );
		current = structuredClone( value );
		settings.setMany( { environmentIntensity: value.intensity, environmentRotation: value.rotation[ 1 ] * 180 / Math.PI, showBackground: value.background }, { silent: true, reset: false } );
		realtimeRenderer.setEnvironment( value.asset ? textures.get( assetVersionKey( value.asset ) ) : null );

	};

	validate( current );
	return { read: () => structuredClone( current ), capture: () => structuredClone( current ), validate, apply, restore: apply };

}
