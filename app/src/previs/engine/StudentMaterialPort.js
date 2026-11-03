import { serializeMaterial, applyMaterialState, TEXTURE_SLOTS } from '../../services/projects/MaterialState.js';
import { validateStudentMaterials } from '../domain/StudentMaterialState.js';

/** Restore authored scalar/UV state through the very same helper as admin projects. */
export function createStudentMaterialPort( { nodeObjects, inventory, trackResources = () => {}, onChanged = () => {} } ) {

	const bindings = new Map();
	const nodes = Object.fromEntries( nodeObjects );
	validateStudentMaterials( inventory, nodes );
	const resolved = [], seen = new Map();
	for ( const [ id, entries ] of Object.entries( inventory ) ) for ( const entry of entries ) {

		let mesh = nodeObjects.get( id );
		for ( const index of entry.path ) mesh = mesh?.children[ index ];
		const original = Array.isArray( mesh?.material ) ? mesh.material[ entry.slot ] : entry.slot === 0 ? mesh?.material : null;
		if ( ! mesh?.isMesh || ! original || original.type !== entry.state.type ) throw new Error( 'Authored material does not match the immutable model primitive.' );
		const slots = seen.get( mesh ) || new Set();
		if ( slots.has( entry.slot ) ) throw new Error( 'Material mappings address the same model primitive twice.' );
		slots.add( entry.slot ); seen.set( mesh, slots );
		resolved.push( { id, entry, mesh, original } );

	}

	for ( const { id, entry, mesh, original } of resolved ) {

		const material = original.clone();
		for ( const slot of TEXTURE_SLOTS ) if ( material[ slot ] ) material[ slot ] = material[ slot ].clone();
		trackResources( material );
		if ( Array.isArray( mesh.material ) ) {

			mesh.material = [ ...mesh.material ]; mesh.material[ entry.slot ] = material;

		} else mesh.material = material;
		bindings.set( `${id}:${entry.path.join( '/' )}:${entry.slot}`, { id, path: entry.path, slot: entry.slot, material, original: serializeMaterial( material ), textures: Object.fromEntries( TEXTURE_SLOTS.map( slot => [ slot, material[ slot ] ] ) ) } );

	}

	const keyFor = ( id, entry ) => `${id}:${entry.path.join( '/' )}:${entry.slot}`;
	const validate = values => {

		validateStudentMaterials( values, nodes );
		const entries = Object.entries( values ).flatMap( ( [ id, list ] ) => list.map( entry => [ id, entry ] ) );
		if ( entries.length !== bindings.size ) throw new Error( 'Material inventory changed; reload the supported scene.' );
		for ( const [ id, entry ] of entries ) {

			const binding = bindings.get( keyFor( id, entry ) );
			if ( ! binding || entry.state.type !== binding.material.type ) throw new Error( 'Material mapping changed; reload the supported scene.' );
			for ( const [ slot, value ] of Object.entries( entry.state.textures ) ) if ( value && ! binding.textures[ slot ] ) throw new Error( 'Material texture is not embedded in the immutable model.' );

		}

	};

	const read = () => {

		const values = Object.fromEntries( Object.keys( inventory ).map( id => [ id, []] ) );
		for ( const binding of bindings.values() ) values[ binding.id ].push( { path: [ ...binding.path ], slot: binding.slot, state: serializeMaterial( binding.material ) } );
		return values;

	};

	const apply = values => {

		validate( values );
		for ( const [ id, entries ] of Object.entries( values ) ) for ( const entry of entries ) {

			const binding = bindings.get( keyFor( id, entry ) );
			for ( const slot of TEXTURE_SLOTS ) binding.material[ slot ] = binding.textures[ slot ];
			applyMaterialState( binding.material, binding.original );
			applyMaterialState( binding.material, entry.state );

		}

		onChanged();

	};

	return { read, capture: read, validate, apply, restore: apply };

}
