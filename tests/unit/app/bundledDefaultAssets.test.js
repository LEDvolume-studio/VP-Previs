import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted( () => {

	globalThis.window ||= { devicePixelRatio: 2 };
	globalThis.localStorage ||= {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
	};

} );
import { Box3, DoubleSide, PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import bundledDefaultScene from '@/data/default-scene.json';
import { MODEL_FILES } from '@/Constants';
import { prepareLEDAssetRoot } from '@/services/LEDVideoManager';
import { AssetLoader } from '@/core/Processor/AssetLoader.js';

describe( 'bundled default project assets', () => {

	it( 'keeps Studio One at metre scale using interior surfaces rather than exterior bounds', async () => {

		const bytes = await readFile( 'app/public/models/studio-one.glb' );
		const { scene } = await new GLTFLoader().parseAsync( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ), '' );
		scene.updateMatrixWorld( true );
		scene.traverse( node => {

			if ( node.material ) node.material.side = DoubleSide;

		} );
		const distance = ( origin, direction ) => new Raycaster( new Vector3( ...origin ), new Vector3( ...direction ) ).intersectObject( scene, true )[ 0 ].distance;
		// Sample clear sections inside the room: nearest surfaces exclude wall thickness.
		const width = distance( [ 0, 4, 0 ], [ 1, 0, 0 ] ) + distance( [ 0, 4, 0 ], [ - 1, 0, 0 ] );
		const length = distance( [ 0, 4, 0 ], [ 0, 0, 1 ] ) + distance( [ 0, 4, 0 ], [ 0, 0, - 1 ] );
		const height = distance( [ 4, 4, - 5 ], [ 0, 1, 0 ] ) + distance( [ 4, 4, - 5 ], [ 0, - 1, 0 ] );
		expect( Math.abs( length - 17.01 ) ).toBeLessThan( 0.05 );
		expect( Math.abs( width - 14.24 ) ).toBeLessThan( 0.30 );
		expect( Math.abs( height - 9.1 ) ).toBeLessThan( 0.05 );
		expect( new Box3().setFromObject( scene ).getSize( new Vector3() ).x ).toBeGreaterThan( width + 2 );
		const studio = bundledDefaultScene.scene.assets.find( asset => asset.catalogId === 'model-studio-one' );
		expect( bundledDefaultScene.scene.nodes[ `${studio.instanceId}:0` ].scale ).toEqual( [ 1, 1, 1 ] );
		expect( bundledDefaultScene.scene.units ).toEqual( { length: 'metre', metresPerUnit: 1 } );

	} );

	it( 'repairs studio hard-edge normals while preserving triangles and manifest mesh paths', async () => {

		const bytes = await readFile( 'app/public/models/studio-one.glb' );
		const { scene } = await new GLTFLoader().parseAsync( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ), '' );
		const positionHash = createHash( 'sha256' );
		const meshes = [];
		scene.traverse( node => {

			if ( node.isMesh ) meshes.push( node );

		} );
		expect( meshes ).toHaveLength( 25 );
		expect( meshes[ 0 ].name ).toBe( 'StudioOne' );
		const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
		for ( const mesh of meshes ) {

			const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
			const positions = geometry.attributes.position;
			positionHash.update( Buffer.from( positions.array.buffer, positions.array.byteOffset, positions.array.byteLength ) );
			for ( let index = 0; index < positions.count; index += 3 ) {

				a.fromBufferAttribute( positions, index );
				b.fromBufferAttribute( positions, index + 1 );
				c.fromBufferAttribute( positions, index + 2 );
				const faceNormal = b.sub( a ).cross( c.sub( a ) );
				if ( faceNormal.lengthSq() < 1e-14 ) continue;
				faceNormal.normalize();
				for ( let corner = 0; corner < 3; corner ++ ) {

					normal.fromBufferAttribute( geometry.attributes.normal, index + corner );
					expect( normal.length() ).toBeCloseTo( 1, 5 );
					expect( faceNormal.dot( normal ) ).toBeGreaterThan( Math.cos( Math.PI / 4 ) - 1e-5 );

				}

			}

		}

		// Expanded position bytes of the original GLB, including triangle order.
		expect( positionHash.digest( 'hex' ) ).toBe( 'd79ced7b80ddcd24ff288a53d8025efa6fe29a1b941b0ef89784c3c8996942ef' );

	} );

	it( 'parses and prepares every local model in the saved scene', async () => {

		const scene = new Scene();
		const assetLoader = new AssetLoader( scene, new PerspectiveCamera(), {} );
		for ( const asset of bundledDefaultScene.scene.assets ) {

			const catalog = MODEL_FILES.find( item => item.id === asset.catalogId );
			expect( catalog, asset.catalogId ).toBeDefined();
			const bytes = await readFile( `app/public${catalog.url}` );
			const buffer = bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
			const parsed = await new GLTFLoader().parseAsync( buffer, '' );
			assetLoader._processAndParent( parsed.scene );
			if ( catalog.led ) prepareLEDAssetRoot( parsed.scene, catalog );
			expect( parsed.scene.parent, asset.catalogId ).toBe( scene );

		}

	} );

} );
