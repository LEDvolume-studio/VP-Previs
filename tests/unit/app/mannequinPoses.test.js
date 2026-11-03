import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { isPoseMesh, mannequinPose, prepareMannequin } from '@/utils/mannequinPoses';
import { captureNodeTransform, restoreNodeTransform } from '@/services/projects/projectStateUtils';

async function fixture() {

	const buffer = readFileSync( new URL( '../../../app/public/characters/mannequin/mannequin-presets.glb', import.meta.url ) );
	const data = await new GLTFLoader().parseAsync( buffer.buffer.slice( buffer.byteOffset, buffer.byteOffset + buffer.byteLength ), '' );
	return data.scene;

}

function meshes( root ) {

	const result = [];
	root.traverse( node => {

		if ( isPoseMesh( node ) ) result.push( node );

	} );
	return result;

}

describe( 'bundled mannequin poses', () => {

	it( 'retains the skin, PBR materials, ground contact and useful standing/seated proportions', async () => {

		const root = await fixture();
		const parts = meshes( root );
		expect( parts ).toHaveLength( 2 );
		for ( const mesh of parts ) {

			expect( mesh.isSkinnedMesh ).toBe( true );
			expect( mesh.skeleton.bones ).toHaveLength( 69 );
			expect( mesh.material.roughness ).toBeCloseTo( 0.7 );

		}

		prepareMannequin( root, 'standing' );
		root.updateMatrixWorld( true );
		const standing = new Box3().setFromObject( root, true );
		prepareMannequin( root, 'sitting' );
		const sitting = new Box3().setFromObject( root, true );
		expect( standing.min.y ).toBeCloseTo( 0, 4 );
		expect( sitting.min.y ).toBeCloseTo( 0, 4 );
		expect( standing.max.y ).toBeCloseTo( 1.806, 2 );
		expect( sitting.max.y ).toBeLessThan( standing.max.y - 0.3 );
		expect( sitting.getSize( new Vector3() ).z ).toBeGreaterThan( 0.6 );
		const vector = new Vector3();
		for ( const mesh of parts ) {

			const positions = mesh.geometry.attributes.position;
			const normals = mesh.geometry.attributes.normal;
			for ( let index = 0; index < positions.count; index ++ ) {

				// Raster skinning and path-tracer base-attribute extraction must agree.
				mesh.getVertexPosition( index, vector );
				expect( vector.distanceTo( new Vector3().fromBufferAttribute( positions, index ) ) ).toBeLessThan( 0.0001 );
				expect( vector.fromBufferAttribute( normals, index ).length() ).toBeCloseTo( 1, 4 );

			}

			expect( mesh.morphTargetInfluences ).toEqual( [ 0, 0 ] );

		}

	} );

	it( 'switches repeatedly without drift, keeps independent instances and restores saved poses', async () => {

		const first = await fixture();
		const second = clone( first );
		prepareMannequin( first, 'standing' );
		prepareMannequin( second, 'standing' );
		const original = meshes( first ).map( mesh => Array.from( mesh.geometry.attributes.position.array ) );
		first.position.set( 3, 0, 4 );
		prepareMannequin( first, 'sitting' );
		expect( mannequinPose( second ) ).toBe( 'standing' );
		expect( first.position.toArray() ).toEqual( [ 3, 0, 4 ] );
		const saved = JSON.parse( JSON.stringify( meshes( first ).map( captureNodeTransform ) ) );
		for ( let i = 0; i < 3; i ++ ) {

			prepareMannequin( first, 'standing' );
			expect( meshes( first ).map( mesh => Array.from( mesh.geometry.attributes.position.array ) ) ).toEqual( original );
			prepareMannequin( first, 'sitting' );

		}

		meshes( second ).forEach( ( mesh, index ) => restoreNodeTransform( mesh, saved[ index ] ) );
		expect( mannequinPose( second ) ).toBe( 'sitting' );
		expect( meshes( second ).map( mesh => Array.from( mesh.geometry.attributes.position.array ) ) )
			.toEqual( meshes( first ).map( mesh => Array.from( mesh.geometry.attributes.position.array ) ) );
		expect( () => prepareMannequin( first, 'unknown' ) ).toThrow( 'Unknown mannequin pose' );
		expect( mannequinPose( first ) ).toBe( 'sitting' );

	} );

} );
