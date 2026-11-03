import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Matrix3, Mesh, Vector3 } from 'three';
import { mannequinPoseRefit } from '@/utils/mannequinPoseRefit';

function fixture( indexed = true ) {

	const root = new Group();
	root.userData.rayzeePoseModel = 'mannequin-v1';
	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( [ 1, 0, 0, 0, 2, 0, 0, 0, 3 ], 3 ) );
	geometry.setAttribute( 'normal', new Float32BufferAttribute( [ 1, 1, 1, 1, 1, 1, 1, 1, 1 ], 3 ) );
	if ( indexed ) geometry.setIndex( [ 2, 0, 1 ] );
	const mesh = new Mesh( geometry );
	root.add( mesh );
	const parent = new Group();
	parent.position.set( 7, 2, - 3 );
	parent.add( root );
	root.scale.set( 2, 3, 4 );
	root.rotation.y = 0.7;
	mesh.position.x = 0.5;
	return { root, mesh, app: { sceneMeshes: [ new Mesh(), new Mesh(), mesh ] } };

}

describe( 'mannequin BVH refit readers', () => {

	for ( const indexed of [ true, false ] ) it( `packs ${indexed ? 'indexed' : 'non-indexed'} geometry in world space with smooth normals`, () => {

		const { app, root, mesh } = fixture( indexed );
		const data = mannequinPoseRefit( app, root );
		expect( data.indices ).toEqual( [ 2 ] );
		expect( data.positions( 0 ) ).toBeNull();
		expect( data.normals( 1 ) ).toBeNull();
		const positions = data.positions( 2 );
		const normals = data.normals( 2 );
		const order = indexed ? [ 2, 0, 1 ] : [ 0, 1, 2 ];
		const normalMatrix = new Matrix3().getNormalMatrix( mesh.matrixWorld );
		for ( let i = 0; i < 3; i ++ ) {

			const expected = new Vector3().fromBufferAttribute( mesh.geometry.attributes.position, order[ i ] ).applyMatrix4( mesh.matrixWorld );
			expect( expected.distanceTo( new Vector3().fromArray( positions, i * 3 ) ) ).toBeLessThan( 1e-6 );
			const smooth = new Vector3( 1, 1, 1 ).applyMatrix3( normalMatrix ).normalize();
			expect( smooth.distanceTo( new Vector3().fromArray( normals, i * 3 ) ) ).toBeLessThan( 1e-6 );

		}

		// Readers see restored geometry too, so the failure rollback uses fresh samples.
		const before = Array.from( positions );
		mesh.geometry.attributes.position.setX( 0, 9 );
		expect( Array.from( data.positions( 2 ) ) ).not.toEqual( before );

	} );

	it( 'rejects unprocessed characters before their pose can be changed', () => {

		const { root, app } = fixture();
		app.sceneMeshes = [];
		expect( () => mannequinPoseRefit( app, root ) ).toThrow( 'not ready' );

	} );

} );
