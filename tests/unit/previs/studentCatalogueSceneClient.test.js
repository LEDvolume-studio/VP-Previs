import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { StudentCatalogueClient } from '../../../app/src/previs/api/StudentCatalogueClient.js';
import { createBundledStudentSceneManifest } from '../../../app/src/previs/fixtures/BundledStudentScene.js';

const baseURL = 'https://previs.example/api';
const scene = () => {

	const manifest = createBundledStudentSceneManifest( { models: [ 'led' ] } );
	return { sceneDefinition: { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: manifest.baseScene, models: manifest.models.map( ( { asset, nodes } ) => ( { asset, nodes } ) ), humanPoseRoots: [] }, assets: manifest.assets };

};

const identity = { sceneId: 'local-fixture-led', version: 'fixture-1' };
const json = value => new Response( JSON.stringify( value ), { headers: { 'content-type': 'application/json' } } );
const client = ( fetch, options = {} ) => new StudentCatalogueClient( { baseURL, fetch, ...options } );
const bytes = new Uint8Array( [ 1, 2, 3, 4 ] );
const asset = () => ( { assetId: 'model', version: '1', kind: 'model', mimeType: 'model/gltf-binary', durationUs: null, byteLength: bytes.length, sha256: createHash( 'sha256' ).update( bytes ).digest( 'hex' ) } );
const binary = ( value = bytes, headers = {} ) => new Response( value, { headers: { 'content-type': 'model/gltf-binary', ...headers } } );
const deferred = () => {

	let resolve;
	const promise = new Promise( yes => {

		resolve = yes;

	} );
	return { promise, resolve };

};

describe( 'student catalogue supported scene resolution', () => {

	it( 'requests only exact configured immutable routes and caches independent bounded scene records', async () => {

		const fetch = vi.fn().mockResolvedValue( json( scene() ) );
		const instance = client( fetch );
		const first = await instance.getScene( identity );
		first.sceneDefinition.models[ 0 ].nodes[ 1 ].nodeId = 'local-change';
		first.assets[ 'local-fixture-led@fixture-1' ].sha256 = 'a'.repeat( 64 );
		expect( await instance.getScene( identity ) ).toEqual( scene() );
		expect( fetch ).toHaveBeenCalledOnce();
		expect( fetch.mock.calls[ 0 ][ 0 ] ).toBe( `${baseURL}/v1/catalogue/scenes/local-fixture-led/fixture-1` );
		expect( fetch.mock.calls[ 0 ][ 1 ] ).toMatchObject( { credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' } );

	} );

	it.each( [ 'extra-response-field', 'wrong-scene', 'wrong-version', 'extra-asset', 'wrong-asset', 'unknown-node-field' ] )( 'rejects %s before caching a scene', async kind => {

		const value = scene();
		if ( kind === 'extra-response-field' ) value.url = 'https://elsewhere.invalid';
		if ( kind === 'wrong-scene' ) value.sceneDefinition.baseScene.sceneId = 'other';
		if ( kind === 'wrong-version' ) value.sceneDefinition.baseScene.version = 'other';
		if ( kind === 'extra-asset' ) value.assets[ 'model@1' ] = asset();
		if ( kind === 'wrong-asset' ) value.assets[ 'local-fixture-led@fixture-1' ].assetId = 'other';
		if ( kind === 'unknown-node-field' ) value.sceneDefinition.models[ 0 ].nodes[ 0 ].url = 'https://elsewhere.invalid';
		const fetch = vi.fn().mockResolvedValueOnce( json( value ) ).mockResolvedValueOnce( json( scene() ) );
		const instance = client( fetch );
		await expect( instance.getScene( identity ) ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );
		expect( await instance.getScene( identity ) ).toEqual( scene() );

	} );

	it( 'rejects invalid scene identities before fetching and unsolicited conditional responses', async () => {

		const fetch = vi.fn();
		await expect( client( fetch ).getScene( { ...identity, sceneId: '../admin' } ) ).rejects.toMatchObject( { code: 'INVALID_REQUEST' } );
		expect( fetch ).not.toHaveBeenCalled();
		await expect( client( vi.fn().mockResolvedValue( new Response( null, { status: 304 } ) ) ).getScene( identity ) ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'rejects conflicting concurrent definitions while preserving the accepted cache', async () => {

		const held = deferred();
		const fetch = vi.fn().mockReturnValueOnce( held.promise ).mockResolvedValueOnce( json( scene() ) );
		const instance = client( fetch ), pending = instance.getScene( identity );
		await instance.getScene( identity );
		const changed = scene(); changed.sceneDefinition.models[ 0 ].nodes[ 1 ].nodeId = 'changed';
		held.resolve( json( changed ) );
		await expect( pending ).rejects.toMatchObject( { code: 'IMMUTABLE_MISMATCH' } );
		expect( await instance.getScene( identity ) ).toEqual( scene() );

	} );

	it( 'bounds scene cache and clear prevents old responses repopulating it', async () => {

		const held = deferred();
		const fetch = vi.fn().mockReturnValueOnce( held.promise ).mockResolvedValueOnce( json( scene() ) );
		const instance = client( fetch, { maxCachedPresets: 1 } ), pending = instance.getScene( identity );
		instance.clear(); held.resolve( json( scene() ) ); await pending;
		await instance.getScene( identity ); expect( fetch ).toHaveBeenCalledTimes( 2 );
		const controller = new AbortController(); controller.abort();
		await expect( instance.getScene( identity, { signal: controller.signal } ) ).rejects.toMatchObject( { code: 'CANCELLED' } );

	} );

	it( 'verifies actual asset hash, length and MIME without retaining mutable byte caches', async () => {

		const fetch = vi.fn().mockImplementation( async () => binary() );
		const instance = client( fetch );
		const first = await instance.getAssetBytes( asset() ); first[ 0 ] = 99;
		expect( await instance.getAssetBytes( asset() ) ).toEqual( bytes );
		expect( fetch.mock.calls[ 0 ][ 0 ] ).toBe( `${baseURL}/v1/catalogue/assets/model/1` );
		expect( fetch.mock.calls[ 0 ][ 1 ] ).toMatchObject( { headers: { Accept: 'model/gltf-binary' }, credentials: 'omit', redirect: 'error' } );

	} );

	it.each( [ 'hash', 'short', 'overflow', 'mime', 'declared-length', 'partial' ] )( 'fails closed on %s asset responses and releases streams', async kind => {

		const actual = kind === 'short' ? bytes.slice( 0, 3 ) : kind === 'overflow' ? new Uint8Array( 5 ) : kind === 'hash' ? new Uint8Array( 4 ) : bytes;
		const response = kind === 'partial' ? new Response( actual, { status: 206, headers: { 'content-type': 'model/gltf-binary' } } ) : binary( actual, kind === 'mime' ? { 'content-type': 'text/html' } : kind === 'declared-length' ? { 'content-length': '5' } : {} );
		await expect( client( vi.fn().mockResolvedValue( response ) ).getAssetBytes( asset() ) ).rejects.toMatchObject( { code: kind === 'short' || kind === 'hash' ? 'ASSET_MISMATCH' : kind === 'overflow' ? 'RESPONSE_TOO_LARGE' : 'INVALID_RESPONSE' } );
		expect( response.body.locked ).toBe( false );

	} );

	it( 'enforces model/video technical bounds and rejects asset URL fields before fetching', async () => {

		const fetch = vi.fn();
		for ( const value of [ { ...asset(), byteLength: 64 * 1024 * 1024 + 1 }, { ...asset(), kind: 'video', mimeType: 'video/mp4', durationUs: 1, byteLength: 128 * 1024 * 1024 + 1 }, { ...asset(), source: 'https://example.invalid' } ] ) await expect( client( fetch ).getAssetBytes( value ) ).rejects.toMatchObject( { code: 'INVALID_REQUEST' } );
		expect( fetch ).not.toHaveBeenCalled();

	} );

	it( 'cancels pending byte reads and releases the body reader', async () => {

		const reading = deferred(), cancel = vi.fn();
		const response = binary( new ReadableStream( { pull() {

			reading.resolve();

		}, cancel } ) );
		const controller = new AbortController();
		const pending = client( vi.fn().mockResolvedValue( response ) ).getAssetBytes( asset(), { signal: controller.signal } );
		await reading.promise; controller.abort();
		await expect( pending ).rejects.toMatchObject( { code: 'CANCELLED' } );
		expect( cancel ).toHaveBeenCalledOnce(); expect( response.body.locked ).toBe( false );

	} );

} );
