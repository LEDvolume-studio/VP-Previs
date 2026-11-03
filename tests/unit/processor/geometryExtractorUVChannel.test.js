import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Matrix3, Mesh, MeshStandardMaterial, Texture } from 'three';
import { GeometryExtractor } from '@/core/Processor/GeometryExtractor.js';
import { TRIANGLE_DATA_LAYOUT as T } from '@/core/EngineDefaults.js';

function makeMesh( uvChannel ) {

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [
		0, 0, 0, 1, 0, 0, 0, 1, 0,
	] ), 3 ) );
	geometry.setAttribute( 'normal', new BufferAttribute( new Float32Array( [
		0, 0, 1, 0, 0, 1, 0, 0, 1,
	] ), 3 ) );
	geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( [
		0, 0, 0.25, 0, 0, 0.25,
	] ), 2 ) );
	geometry.setAttribute( 'uv1', new BufferAttribute( new Float32Array( [
		0.5, 0.5, 1, 0.5, 0.5, 1,
	] ), 2 ) );
	const mesh = new Mesh( geometry, new MeshStandardMaterial() );
	mesh.userData.rayzeeUVChannel = uvChannel;
	return mesh;

}

function firstTriangleFloats( extracted ) {

	const chunk = extracted.triangleData.chunks[ 0 ];
	return new Float32Array( chunk.buffer, chunk.byteOffset, chunk.length );

}

describe( 'GeometryExtractor authored UV channel', () => {

	it( 'preserves an explicitly authored texture matrix during material extraction', () => {

		const mesh = makeMesh( 1 );
		const texture = new Texture( { width: 8, height: 4 } );
		texture.matrixAutoUpdate = false;
		texture.matrix.copy( new Matrix3().set(
			- 0.9993, 0, 0.9993,
			0, 2.3687, - 0.6841,
			0, 0, 1,
		) );
		mesh.material.emissiveMap = texture;
		const expected = texture.matrix.elements.slice();

		const data = new GeometryExtractor().extractMaterialsOnly( mesh );

		expect( data.materials[ 0 ].emissiveMapMatrices ).toEqual( expected );
		expect( texture.matrix.elements ).toEqual( expected );

	} );

	it( 'refreshes transformed parent matrices before packing world-space geometry', () => {

		const root = new Group();
		const mesh = makeMesh( 0 );
		root.add( mesh );
		root.updateMatrixWorld( true );

		// Mimic project hydration: restore the authored root transform after the model
		// was loaded, with no intervening render frame to update child matrixWorld.
		root.position.set( 4, 2, - 3 );
		root.rotation.z = Math.PI / 2;

		const data = firstTriangleFloats( new GeometryExtractor().extract( root ) );
		expect( Array.from( data.slice( T.POSITION_A_OFFSET, T.POSITION_A_OFFSET + 3 ) ) )
			.toEqual( [ 4, 2, - 3 ] );
		expect( Array.from( data.slice( T.POSITION_B_OFFSET, T.POSITION_B_OFFSET + 3 ) ) )
			.toEqual( [ 4, 3, - 3 ] );

	} );

	it( 'packs UV1 when a specialized surface selects channel 1', () => {

		const data = firstTriangleFloats( new GeometryExtractor().extract( makeMesh( 1 ) ) );
		expect( Array.from( data.slice( T.UV_AB_OFFSET, T.UV_AB_OFFSET + 4 ) ) ).toEqual( [ 0.5, 0.5, 1, 0.5 ] );
		expect( Array.from( data.slice( T.UV_C_OFFSET, T.UV_C_OFFSET + 2 ) ) ).toEqual( [ 0.5, 1 ] );

	} );

	it( 'keeps channel 0 as the default and falls back to it when a channel is absent', () => {

		for ( const channel of [ 0, 3 ] ) {

			const data = firstTriangleFloats( new GeometryExtractor().extract( makeMesh( channel ) ) );
			expect( Array.from( data.slice( T.UV_AB_OFFSET, T.UV_AB_OFFSET + 4 ) ) ).toEqual( [ 0, 0, 0.25, 0 ] );

		}

	} );

} );
