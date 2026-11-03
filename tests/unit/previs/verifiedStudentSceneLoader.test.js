import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DataTexture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadVerifiedStudentScene } from '../../../app/src/previs/engine/VerifiedStudentSceneLoader.js';
import { createBundledStudentSceneManifest } from '../../../app/src/previs/fixtures/BundledStudentScene.js';
import { createStudentMaterialPort } from '../../../app/src/previs/engine/StudentMaterialPort.js';
import appearance from '../../../app/src/student/demo/admin-appearance.json';

const manifest = models => createBundledStudentSceneManifest( { models } );
const readBytes = async source => new Uint8Array( await readFile( new URL( `../../../app/public${source}`, import.meta.url ) ) );
const load = ( value, options = {} ) => loadVerifiedStudentScene( value, { fetchBytes: readBytes, ...options } );
const hash = bytes => createHash( 'sha256' ).update( bytes ).digest( 'hex' );
const resourceSpies = root => {

	const resources = new Set();
	root.traverse( node => {

		if ( node.geometry ) resources.add( node.geometry );
		for ( const material of Array.isArray( node.material ) ? node.material : [ node.material ] ) if ( material ) resources.add( material );

	} );
	return [ ...resources ].map( resource => vi.spyOn( resource, 'dispose' ) );

};

describe( 'verified immutable student scene loading', () => {

	it( 'parses the real mannequin, studio and LED GLBs with exact complete stable mappings', async () => {

		const value = manifest( [ 'studio', 'mannequin', 'led' ] );
		const loaded = await load( value );
		expect( loaded.assertReady() ).toBe( loaded.binding );
		expect( loaded.binding.nodes ).toHaveLength( 76 );
		expect( loaded.nodeObjects.size ).toBe( 76 );
		const mannequinMeshes = loaded.nodeObjects.get( 'mannequin-instance-69' ).getObjectsByProperty( 'isSkinnedMesh', true );
		expect( mannequinMeshes.length ).toBeGreaterThan( 0 );
		for ( const mesh of mannequinMeshes ) {

			expect( mesh.morphTargetDictionary ).toHaveProperty( 'standing' );
			expect( mesh.morphTargetDictionary ).toHaveProperty( 'sitting' );

		}

		expect( loaded.nodeObjects.get( 'led-instance-0' ).isMesh ).toBe( true );
		expect( loaded.nodeObjects.get( 'studio-instance-0' ).getObjectsByProperty( 'isMesh', true )[ 0 ].geometry.getAttribute( 'position' ).count ).toBeGreaterThan( 0 );
		expect( loaded.lightObjects.size ).toBe( 0 );
		expect( Object.isFrozen( loaded.binding.nodes ) ).toBe( true );
		expect( JSON.stringify( loaded.binding ) ).not.toMatch( /uuid|\.glb|\/models\// );
		loaded.dispose();
		expect( loaded.binding.ready ).toBe( false );
		expect( () => loaded.assertReady() ).toThrow( 'disposed' );

	} );

	it( 'parses the actual SUV geometry/material hierarchy, with only image decoding replaced for Node', async () => {

		const textures = [];
		const createGLTFLoader = () => new GLTFLoader().register( () => ( {
			name: 'HeadlessImageDecodeOnly',
			loadTexture() {

				const texture = new DataTexture( new Uint8Array( [ 255, 255, 255, 255 ] ), 1, 1 );
				textures.push( vi.spyOn( texture, 'dispose' ) );
				return Promise.resolve( texture );

			},
		} ) );
		const loaded = await load( manifest( [ 'suv' ] ), { createGLTFLoader } );
		expect( loaded.binding.nodes ).toHaveLength( 21 );
		expect( loaded.nodeObjects.get( 'suv-instance-1' ).name ).toBe( 'FrontDoor_left_Hinge' );
		expect( loaded.nodeObjects.get( 'suv-instance-3' ).name ).toBe( 'FrontDoor_right_Hinge' );
		expect( loaded.nodeObjects.get( 'suv-instance-0' ).children.length ).toBeGreaterThan( 1 );
		expect( textures.length ).toBeGreaterThan( 10 );
		const materials = createStudentMaterialPort( { nodeObjects: loaded.nodeObjects, inventory: appearance.materials, trackResources: loaded.trackResources } );
		materials.apply( appearance.materials );
		const meshes = loaded.sceneRoot.getObjectsByProperty( 'isMesh', true );
		expect( meshes ).toHaveLength( 69 );
		// Admin's extraction prepares BLEND materials for depth-correct raster
		// drawing. Correct opacity alone cannot prevent the see-through body bug.
		expect( meshes.every( mesh => mesh.material.depthWrite ) ).toBe( true );
		const paint = meshes.filter( mesh => mesh.material.name === 'KB3D_CEV_MidSuvExteriorBody' );
		expect( paint ).toHaveLength( 9 );
		expect( paint.every( mesh => mesh.material.opacity === 1 && ! mesh.material.transmission ) ).toBe( true );
		const glass = meshes.filter( mesh => mesh.material.opacity < 1 );
		expect( glass ).toHaveLength( 6 );
		expect( glass.every( mesh => mesh.material.opacity === 0.06000000000000005 && mesh.material.transparent ) ).toBe( true );
		loaded.dispose();
		expect( textures.every( spy => spy.mock.calls.length === 1 ) ).toBe( true );

	} );

	it( 'preserves authored local transforms without unit guessing, centering or rescaling', async () => {

		const loaded = await load( manifest( [ 'mannequin' ] ) );
		const bytes = await readBytes( '/characters/mannequin/mannequin-presets.glb' );
		const jsonLength = new DataView( bytes.buffer ).getUint32( 12, true );
		const json = JSON.parse( new TextDecoder().decode( bytes.subarray( 20, 20 + jsonLength ) ) );
		for ( const [ index, node ] of json.nodes.entries() ) {

			const object = loaded.nodeObjects.get( `mannequin-instance-${index}` );
			expect( object.position.toArray() ).toEqual( node.translation || [ 0, 0, 0 ] );
			expect( object.quaternion.toArray() ).toEqual( node.rotation || [ 0, 0, 0, 1 ] );
			expect( object.scale.toArray() ).toEqual( node.scale || [ 1, 1, 1 ] );

		}

		loaded.dispose();

	} );

	it.each( [ 'hash', 'size' ] )( 'rejects %s mismatch before a GLTF loader is created', async kind => {

		const value = manifest( [ 'led' ] );
		const createGLTFLoader = vi.fn();
		const asset = Object.values( value.assets )[ 0 ];
		if ( kind === 'hash' ) asset.sha256 = '0'.repeat( 64 ); else asset.byteLength ++;
		await expect( load( value, { createGLTFLoader } ) ).rejects.toThrow( kind );
		expect( createGLTFLoader ).not.toHaveBeenCalled();

	} );

	it.each( [ 'missing', 'duplicate-index', 'stale-name', 'duplicate-id' ] )( 'rejects %s mappings before parsing', async kind => {

		const value = manifest( [ 'mannequin' ] );
		const nodes = value.models[ 0 ].nodes;
		if ( kind === 'missing' ) nodes.pop();
		if ( kind === 'duplicate-index' ) nodes[ 2 ].gltfNodeIndex = nodes[ 1 ].gltfNodeIndex;
		if ( kind === 'stale-name' ) nodes[ 1 ].expectedName = 'Stale';
		if ( kind === 'duplicate-id' ) nodes[ 2 ].instanceId = nodes[ 1 ].instanceId;
		const createGLTFLoader = vi.fn();
		await expect( load( value, { createGLTFLoader } ) ).rejects.toThrow();
		expect( createGLTFLoader ).not.toHaveBeenCalled();

	} );

	it( 'rejects external images before parsing even if their container hash is correct', async () => {

		const value = manifest( [ 'led' ] );
		const original = await readBytes( value.models[ 0 ].source );
		const view = new DataView( original.buffer );
		const jsonLength = view.getUint32( 12, true );
		const json = JSON.parse( new TextDecoder().decode( original.subarray( 20, 20 + jsonLength ) ) );
		json.images = [ { uri: 'https://example.invalid/unverified.png' } ];
		const encoded = new TextEncoder().encode( JSON.stringify( json ) );
		const paddedLength = Math.ceil( encoded.byteLength / 4 ) * 4;
		const bytes = new Uint8Array( original.byteLength - jsonLength + paddedLength );
		bytes.set( original.subarray( 0, 20 ) );
		bytes.fill( 32, 20, 20 + paddedLength );
		bytes.set( encoded, 20 );
		bytes.set( original.subarray( 20 + jsonLength ), 20 + paddedLength );
		new DataView( bytes.buffer ).setUint32( 8, bytes.byteLength, true );
		new DataView( bytes.buffer ).setUint32( 12, paddedLength, true );
		Object.assign( Object.values( value.assets )[ 0 ], { sha256: hash( bytes ), byteLength: bytes.byteLength } );
		const createGLTFLoader = vi.fn();
		await expect( load( value, { fetchBytes: () => bytes, createGLTFLoader } ) ).rejects.toThrow( 'self-contained' );
		expect( createGLTFLoader ).not.toHaveBeenCalled();

	} );

	it( 'loads verified bytes from a strict catalogue asset route supplied by the trusted registry', async () => {

		const value = manifest( [ 'led' ] );
		const bytes = await readBytes( value.models[ 0 ].source );
		value.models[ 0 ].source = '/v1/catalogue/assets/local-fixture-led/fixture-1';
		const fetchBytes = vi.fn().mockResolvedValue( bytes );
		const loaded = await load( value, { fetchBytes } );
		expect( fetchBytes ).toHaveBeenCalledWith( value.models[ 0 ].source, expect.objectContaining( { byteLength: bytes.byteLength } ) );
		expect( loaded.assertReady().nodes ).toHaveLength( 2 );
		loaded.dispose();

	} );

	it.each( [ '/v1/catalogue/assets/a/v1?secret=x', '/v1/catalogue/assets/a/v1/other', '/v1/catalogue/assets/a/../b', '//untrusted.invalid/model.glb' ] )( 'rejects noncanonical runtime catalogue source %s before reading', async source => {

		const value = manifest( [ 'led' ] );
		value.models[ 0 ].source = source;
		const fetchBytes = vi.fn();
		await expect( load( value, { fetchBytes } ) ).rejects.toThrow( /absolute model path/ );
		expect( fetchBytes ).not.toHaveBeenCalled();

	} );

	it( 'captures detached manifest and byte copies across asynchronous work', async () => {

		const value = manifest( [ 'led' ] );
		const loaded = await load( value, { fetchBytes: async source => {

			const bytes = await readBytes( source );
			value.models[ 0 ].nodes[ 1 ].expectedName = 'Changed while reading';
			value.baseScene.sceneId = 'changed';
			Object.values( value.assets )[ 0 ].sha256 = 'f'.repeat( 64 );
			return bytes;

		} } );
		expect( loaded.binding.baseScene.sceneId ).toBe( 'local-fixture-led' );
		loaded.dispose();

	} );

	it( 'rejects cancellation after bytes finish without creating parser resources', async () => {

		const controller = new AbortController();
		const createGLTFLoader = vi.fn();
		await expect( load( manifest( [ 'led' ] ), { signal: controller.signal, createGLTFLoader, fetchBytes: async source => {

			const bytes = await readBytes( source ); controller.abort(); return bytes;

		} } ) ).rejects.toMatchObject( { name: 'AbortError' } );
		expect( createGLTFLoader ).not.toHaveBeenCalled();

	} );

	it.each( [ 'cancel', 'throw' ] )( 'drains and disposes real parsed dependencies after a parse-stage %s', async kind => {

		const controller = new AbortController();
		let spies = [];
		const createGLTFLoader = () => new GLTFLoader().register( () => ( {
			name: 'FailAfterRealParse',
			afterRoot( result ) {

				spies = resourceSpies( result.scene );
				if ( kind === 'cancel' ) controller.abort(); else throw new Error( 'Injected parse failure' );

			},
		} ) );
		await expect( load( manifest( [ 'mannequin' ] ), { signal: controller.signal, createGLTFLoader } ) ).rejects.toThrow();
		expect( spies.length ).toBeGreaterThan( 1 );
		expect( spies.every( spy => spy.mock.calls.length === 1 ) ).toBe( true );

	} );

	it( 'disposes the first real model when another model fails byte verification', async () => {

		let spies = [];
		const value = manifest( [ 'mannequin', 'led' ] );
		value.assets[ 'local-fixture-led@fixture-1' ].sha256 = '0'.repeat( 64 );
		const createGLTFLoader = () => new GLTFLoader().register( () => ( { name: 'ObserveOwnedResources', afterRoot: result => {

			spies = resourceSpies( result.scene );

		} } ) );
		await expect( load( value, { createGLTFLoader } ) ).rejects.toThrow( 'hash' );
		expect( spies.every( spy => spy.mock.calls.length === 1 ) ).toBe( true );

	} );

	it( 'disposes shared allocations once and owns host-created replacement geometry', async () => {

		const loaded = await load( manifest( [ 'led' ] ) );
		const mesh = loaded.nodeObjects.get( 'led-instance-0' );
		const original = vi.spyOn( mesh.geometry, 'dispose' );
		mesh.geometry = mesh.geometry.clone();
		const replacement = vi.spyOn( mesh.geometry, 'dispose' );
		const material = vi.spyOn( mesh.material, 'dispose' );
		loaded.dispose();
		loaded.dispose();
		expect( original ).toHaveBeenCalledTimes( 1 );
		expect( replacement ).toHaveBeenCalledTimes( 1 );
		expect( material ).toHaveBeenCalledTimes( 1 );

	} );

	it( 'rejects stale or replaced mappings after load', async () => {

		const loaded = await load( manifest( [ 'led' ] ) );
		loaded.nodeObjects.get( 'led-instance-0' ).removeFromParent();
		expect( () => loaded.assertReady() ).toThrow( 'stale' );
		loaded.dispose();

	} );

	it( 'rejects a retargeted Map even when every replacement is in the loaded scene', async () => {

		const loaded = await load( manifest( [ 'led' ] ) );
		loaded.nodeObjects.set( 'led-instance-0', loaded.nodeObjects.get( 'led-root' ) );
		expect( () => loaded.assertReady() ).toThrow( 'stale' );
		loaded.dispose();

	} );

	it( 'streams exact bounded bytes through the default same-origin fetch path', async () => {

		const value = manifest( [ 'led' ] );
		const bytes = await readBytes( value.models[ 0 ].source );
		const fetchSpy = vi.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( bytes ) );
		try {

			const loaded = await loadVerifiedStudentScene( value );
			expect( loaded.binding.ready ).toBe( true );
			expect( fetchSpy ).toHaveBeenCalledWith( value.models[ 0 ].source, expect.objectContaining( { credentials: 'same-origin', redirect: 'error', cache: 'no-store' } ) );
			loaded.dispose();

		} finally {

			fetchSpy.mockRestore();

		}

	} );

	it( 'cancels an oversized network body before parsing', async () => {

		const value = manifest( [ 'led' ] );
		const cancel = vi.fn();
		const body = new ReadableStream( { start: controller => controller.enqueue( new Uint8Array( 8681 ) ), cancel } );
		const fetchSpy = vi.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( body ) );
		const createGLTFLoader = vi.fn();
		try {

			await expect( loadVerifiedStudentScene( value, { createGLTFLoader } ) ).rejects.toThrow( 'exceeds immutable manifest size' );
			expect( cancel ).toHaveBeenCalledTimes( 1 );
			expect( createGLTFLoader ).not.toHaveBeenCalled();

		} finally {

			fetchSpy.mockRestore();

		}

	} );

	it( 'attempts remaining resource cleanup and detaches its root when a disposal listener throws', async () => {

		const loaded = await load( manifest( [ 'led' ] ) );
		const mesh = loaded.nodeObjects.get( 'led-instance-0' );
		vi.spyOn( mesh.geometry, 'dispose' ).mockImplementation( () => {

			throw new Error( 'Injected disposal failure' );

		} );
		const material = vi.spyOn( mesh.material, 'dispose' );
		expect( () => loaded.dispose() ).toThrow( AggregateError );
		expect( material ).toHaveBeenCalledTimes( 1 );
		expect( loaded.sceneRoot.children ).toHaveLength( 0 );
		expect( loaded.binding.ready ).toBe( false );

	} );

	it( 'rejects unknown fixture selections and runtime source URLs', async () => {

		expect( () => manifest( [ 'missing' ] ) ).toThrow( 'unique known' );
		expect( () => manifest( [ 'led', 'led' ] ) ).toThrow( 'unique known' );
		const value = manifest( [ 'led' ] );
		value.models[ 0 ].source = 'https://example.invalid/model.glb';
		const fetchBytes = vi.fn();
		await expect( load( value, { fetchBytes } ) ).rejects.toThrow( 'bundled or catalogue absolute' );
		expect( fetchBytes ).not.toHaveBeenCalled();

	} );

} );
