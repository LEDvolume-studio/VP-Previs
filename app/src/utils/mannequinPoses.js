import { Float32BufferAttribute, Vector3 } from 'three';

export const MANNEQUIN_CATALOG_ID = 'rigged-mannequin-v1';
export const MANNEQUIN_POSES = Object.freeze( [

	{ id: 'standing', label: 'Standing up' },
	{ id: 'sitting', label: 'Sitting down' },

] );
const sources = new WeakMap();

export function isPoseMesh( mesh ) {

	if ( ! mesh?.isMesh ) return false;
	for ( let node = mesh; node; node = node.parent ) {

		if ( node.userData?.rayzeePoseModel === 'mannequin-v1' ) return true;

	}

	return false;

}

// Bake evaluated Blender shape samples into base attributes. GeometryExtractor
// reads base attributes, whereas raster rendering evaluates morph influences;
// baking and clearing influences makes both render paths agree, including normals.
export function applyMeshPose( mesh, pose = 'standing' ) {

	if ( ! isPoseMesh( mesh ) ) return false;
	if ( ! MANNEQUIN_POSES.some( item => item.id === pose ) ) throw new Error( `Unknown mannequin pose: ${pose}` );
	const index = mesh.morphTargetDictionary?.[ pose ];
	if ( index === undefined ) throw new Error( `Missing mannequin pose: ${pose}` );
	let source = sources.get( mesh );
	if ( ! source ) {

		// A loader or cloned character may share geometry. Own each instance's
		// geometry before editing so characters can have independent poses.
		mesh.geometry = mesh.geometry.clone();
		source = {};
		for ( const name of [ 'position', 'normal' ] ) {

			const attribute = mesh.geometry.getAttribute( name );
			if ( ! attribute || ! mesh.geometry.morphAttributes[ name ]?.[ index ] ) throw new Error( `Missing pose ${name} samples` );
			const values = new Float32Array( attribute.count * 3 );
			const vector = new Vector3();
			for ( let i = 0; i < attribute.count; i ++ ) vector.fromBufferAttribute( attribute, i ).toArray( values, i * 3 );
			source[ name ] = values;

		}

		sources.set( mesh, source );

	}

	for ( const name of [ 'position', 'normal' ] ) {

		const morph = mesh.geometry.morphAttributes[ name ][ index ];
		const values = new Float32Array( source[ name ].length );
		const vector = new Vector3();
		const base = new Vector3();
		for ( let i = 0; i < morph.count; i ++ ) {

			vector.fromBufferAttribute( morph, i );
			if ( mesh.geometry.morphTargetsRelative ) vector.add( base.fromArray( source[ name ], i * 3 ) );
			if ( name === 'normal' ) vector.normalize();
			vector.toArray( values, i * 3 );

		}

		mesh.geometry.setAttribute( name, new Float32BufferAttribute( values, 3 ) );

	}

	mesh.morphTargetInfluences.fill( 0 );
	mesh.geometry.computeBoundingBox();
	mesh.geometry.computeBoundingSphere();
	// SkinnedMesh caches its own bounds separately from BufferGeometry.
	mesh.boundingBox = null;
	mesh.boundingSphere = null;
	mesh.userData.rayzeePose = pose;
	return true;

}

export function prepareMannequin( root, pose = 'standing' ) {

	let count = 0;
	root.traverse( mesh => {

		if ( applyMeshPose( mesh, pose ) ) count ++;

	} );
	return count;

}

export function mannequinPose( root ) {

	let pose = null;
	root?.traverse( mesh => {

		if ( isPoseMesh( mesh ) ) pose = mesh.userData.rayzeePose || 'standing';

	} );
	return pose;

}
