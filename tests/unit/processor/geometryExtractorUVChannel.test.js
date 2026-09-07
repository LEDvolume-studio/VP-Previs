import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
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

describe( 'GeometryExtractor authored UV channel', () => {

	it( 'packs UV1 when a specialized surface selects channel 1', () => {

		const data = new GeometryExtractor().extract( makeMesh( 1 ) ).triangleData;
		expect( Array.from( data.slice( T.UV_AB_OFFSET, T.UV_AB_OFFSET + 4 ) ) ).toEqual( [ 0.5, 0.5, 1, 0.5 ] );
		expect( Array.from( data.slice( T.UV_C_MAT_OFFSET, T.UV_C_MAT_OFFSET + 2 ) ) ).toEqual( [ 0.5, 1 ] );

	} );

	it( 'keeps channel 0 as the default and falls back to it when a channel is absent', () => {

		for ( const channel of [ 0, 3 ] ) {

			const data = new GeometryExtractor().extract( makeMesh( channel ) ).triangleData;
			expect( Array.from( data.slice( T.UV_AB_OFFSET, T.UV_AB_OFFSET + 4 ) ) ).toEqual( [ 0, 0, 0.25, 0 ] );

		}

	} );

} );
