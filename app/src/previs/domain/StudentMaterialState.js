import { MATERIAL_SCALARS, MATERIAL_COLORS, MATERIAL_ARRAYS, TEXTURE_SLOTS } from '../../services/projects/MaterialState.js';

const fail = () => {

	throw new Error( 'Student material state: unsupported material or embedded texture settings.' );

};

const record = value => value && Object.getPrototypeOf( value ) === Object.prototype;
const only = ( value, keys ) => record( value ) && Object.keys( value ).every( key => keys.includes( key ) );
const vector = ( value, length ) => Array.isArray( value ) && value.length === length && value.every( Number.isFinite );

/** No URLs, shader nodes or arbitrary native property assignment in portable JSON. */
export function validateStudentMaterials( materials, nodes ) {

	if ( ! record( materials ) || Object.keys( materials ).length > 8192 ) fail();
	for ( const [ instanceId, entries ] of Object.entries( materials ) ) {

		if ( ! Object.hasOwn( nodes, instanceId ) || ! Array.isArray( entries ) || entries.length > 256 ) fail();
		const seen = new Set();
		for ( const entry of entries ) {

			if ( ! only( entry, [ 'path', 'slot', 'state' ] ) || ! Array.isArray( entry.path ) || entry.path.length > 32 || ! entry.path.every( index => Number.isSafeInteger( index ) && index >= 0 && index < 8192 ) || ! Number.isSafeInteger( entry.slot ) || entry.slot < 0 || entry.slot > 255 ) fail();
			const key = `${entry.path.join( '/' )}:${entry.slot}`;
			if ( seen.has( key ) ) fail();
			seen.add( key );
			const state = entry.state;
			if ( ! only( state, [ 'name', 'type', 'values', 'colors', 'arrays', 'textures' ] ) || typeof state.name !== 'string' || state.name.length > 1024 || ! [ 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial' ].includes( state.type ) ) fail();
			if ( ! only( state.values, MATERIAL_SCALARS ) || ! only( state.colors, MATERIAL_COLORS ) || ! only( state.arrays, MATERIAL_ARRAYS ) || ! only( state.textures, TEXTURE_SLOTS ) ) fail();
			for ( const [ key, value ] of Object.entries( state.values ) ) {

				if ( key === 'normalScale' ? ! vector( value, 2 ) : key === 'transparent' ? typeof value !== 'boolean' : key === 'attenuationDistance' && value === null ? false : ! Number.isFinite( value ) ) fail();
				if ( [ 'opacity', 'roughness', 'metalness', 'transmission', 'alphaTest' ].includes( key ) && ( value < 0 || value > 1 ) ) fail();
				if ( key === 'side' && ! [ 0, 1, 2 ].includes( value ) ) fail();

			}

			for ( const value of Object.values( state.colors ) ) if ( typeof value !== 'string' || ! /^#[a-f\d]{6}$/i.test( value ) ) fail();
			for ( const [ key, value ] of Object.entries( state.arrays ) ) if ( ! vector( value, key === 'subsurfaceRadius' ? 3 : 2 ) ) fail();
			for ( const value of Object.values( state.textures ) ) if ( value !== null && ( ! only( value, [ 'name', 'offset', 'repeat', 'center', 'rotation', 'flipY', 'channel' ] ) || typeof value.name !== 'string' || value.name.length > 1024 || ! [ 'offset', 'repeat', 'center' ].every( key => vector( value[ key ], 2 ) ) || ! Number.isFinite( value.rotation ) || typeof value.flipY !== 'boolean' || ! Number.isInteger( value.channel ) || value.channel < 0 || value.channel > 3 ) ) fail();

		}

	}

}
