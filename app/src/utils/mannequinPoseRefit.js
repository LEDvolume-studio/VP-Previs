import { Matrix3, Vector3 } from 'three';
import { isPoseMesh } from './mannequinPoses';

// The poses are baked into base attributes with the skeleton in its bind pose.
// Refit readers use sceneMeshes indices, triangle index order, and world space,
// matching PathTracerApp.refitBLASes without touching any other scene geometry.
export function mannequinPoseRefit( app, root ) {

	const parts = new Set();
	root.traverse( mesh => {

		if ( isPoseMesh( mesh ) ) parts.add( mesh );

	} );
	const indices = [];
	app.sceneMeshes.forEach( ( mesh, index ) => {

		if ( parts.has( mesh ) ) indices.push( index );

	} );
	if ( ! indices.length || indices.length !== parts.size ) throw new Error( 'The mannequin is not ready in the renderer.' );
	const allowed = new Set( indices );
	let positions = new Float32Array( 0 );
	let normals = new Float32Array( 0 );
	const vector = new Vector3();
	const normalMatrix = new Matrix3();
	const read = ( index, normal ) => {

		if ( ! allowed.has( index ) ) return null;
		const mesh = app.sceneMeshes[ index ];
		const geometry = mesh.geometry;
		const attribute = geometry.getAttribute( normal ? 'normal' : 'position' );
		const count = geometry.index?.count ?? attribute.count;
		const length = count * 3;
		let output = normal ? normals : positions;
		if ( output.length !== length ) {

			output = new Float32Array( length );
			if ( normal ) normals = output;
			else positions = output;

		}

		mesh.updateWorldMatrix( true, false );
		if ( normal ) normalMatrix.getNormalMatrix( mesh.matrixWorld );
		for ( let i = 0; i < count; i ++ ) {

			const vertex = geometry.index ? geometry.index.getX( i ) : i;
			vector.fromBufferAttribute( attribute, vertex );
			if ( normal ) vector.applyMatrix3( normalMatrix ).normalize();
			else vector.applyMatrix4( mesh.matrixWorld );
			vector.toArray( output, i * 3 );

		}

		return output;

	};

	return { indices, positions: index => read( index, false ), normals: index => read( index, true ) };

}
