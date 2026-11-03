import { describe, expect, it, vi } from 'vitest';
import { StudentCatalogueApiError, StudentCatalogueClient } from '../../../app/src/previs/api/StudentCatalogueClient.js';
import { studentFixture } from './studentFixtures.js';

const baseURL = 'https://previs.example/api';
const summary = ( overrides = {} ) => ( { presetId: 'wide', version: '1', name: 'Wide', description: '', category: 'Studio', defaultDurationFrames: 125, thumbnail: null, ...overrides } );
const catalogue = ( overrides = {} ) => ( { format: 'rayzee-student-catalogue', schemaVersion: 1, presets: [ summary() ], ...overrides } );
const preset = ( overrides = {} ) => {

	const document = studentFixture();
	return { format: 'rayzee-student-preset', schemaVersion: 1, ...summary(), assets: document.assets, baseScene: document.baseScenes[ 'studio@1' ], snapshot: document.shots.shotA.snapshot, ...overrides };

};

const json = ( value, headers = {} ) => new Response( JSON.stringify( value ), { headers: { 'content-type': 'application/json; charset=utf-8', ...headers } } );
const client = ( fetch, options = {} ) => new StudentCatalogueClient( { baseURL, fetch, ...options } );
const deferred = () => {

	let resolve;
	const promise = new Promise( yes => {

		resolve = yes;

	} );
	return { promise, resolve };

};

describe( 'StudentCatalogueClient', () => {

	it( 'requires explicit trustworthy endpoint configuration without fetching on construction', () => {

		const fetch = vi.fn();
		const instance = client( fetch, { origin: 'https://previs.example' } );
		expect( instance ).toBeInstanceOf( StudentCatalogueClient );
		expect( fetch ).not.toHaveBeenCalled();
		for ( const invalid of [ undefined, '/api', 'http://example.com', 'file:///tmp/api', 'https://user:secret@previs.example', 'https://previs.example/?x=1', 'https://previs.example/#x' ] ) expect( () => client( fetch, { baseURL: invalid } ) ).toThrow( StudentCatalogueApiError );
		expect( () => client( fetch, { origin: 'https://different.example' } ) ).toThrow( StudentCatalogueApiError );
		expect( () => client( fetch, { maxJSONBytes: 0 } ) ).toThrow( StudentCatalogueApiError );
		expect( () => client( fetch, { maxCachedPresets: 0 } ) ).toThrow( StudentCatalogueApiError );
		expect( () => client( fetch, { baseURL: 'http://127.0.0.1:8787', origin: 'http://127.0.0.1:8787' } ) ).not.toThrow();

	} );

	it( 'reads only the configured endpoint without credentials or redirects', async () => {

		const fetch = vi.fn().mockResolvedValue( json( catalogue() ) );
		expect( await client( fetch ).list() ).toEqual( catalogue() );
		expect( fetch ).toHaveBeenCalledExactlyOnceWith( `${baseURL}/v1/catalogue`, {
			method: 'GET', headers: { Accept: 'application/json' }, signal: undefined, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
		} );

	} );

	it( 'conditionally revalidates the list and returns independent validated copies on 304', async () => {

		const fetch = vi.fn().mockResolvedValueOnce( json( catalogue(), { etag: '"catalogue-1"' } ) ).mockResolvedValueOnce( new Response( null, { status: 304 } ) );
		const instance = client( fetch );
		const first = await instance.list();
		first.presets[ 0 ].name = 'Changed locally';
		expect( await instance.list() ).toEqual( catalogue() );
		expect( fetch.mock.calls[ 1 ][ 1 ].headers[ 'If-None-Match' ] ).toBe( '"catalogue-1"' );

	} );

	it( 'does not treat an unsolicited 304 as an empty catalogue', async () => {

		await expect( client( vi.fn().mockResolvedValue( new Response( null, { status: 304 } ) ) ).list() ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'keeps the last validated list and ETag after invalid updates', async () => {

		const fetch = vi.fn().mockResolvedValueOnce( json( catalogue(), { etag: '"good"' } ) ).mockResolvedValueOnce( json( { ...catalogue(), sourceURL: 'https://elsewhere.invalid' }, { etag: '"bad"' } ) ).mockResolvedValueOnce( new Response( null, { status: 304 } ) );
		const instance = client( fetch );
		await instance.list();
		await expect( instance.list() ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );
		expect( await instance.list() ).toEqual( catalogue() );
		expect( fetch.mock.calls[ 2 ][ 1 ].headers[ 'If-None-Match' ] ).toBe( '"good"' );

	} );

	it( 'does not let an older concurrent list overwrite a newer validated result', async () => {

		const old = deferred();
		const fetch = vi.fn().mockReturnValueOnce( old.promise ).mockResolvedValueOnce( json( catalogue( { presets: [ summary( { version: '2' } ) ] } ), { etag: '"new"' } ) ).mockResolvedValueOnce( new Response( null, { status: 304 } ) );
		const instance = client( fetch );
		const pending = instance.list();
		await instance.list();
		old.resolve( json( catalogue(), { etag: '"old"' } ) );
		await pending;
		expect( ( await instance.list() ).presets[ 0 ].version ).toBe( '2' );
		expect( fetch.mock.calls[ 2 ][ 1 ].headers[ 'If-None-Match' ] ).toBe( '"new"' );

	} );

	it( 'caches immutable versions and never exposes the cache to caller mutation', async () => {

		const fetch = vi.fn().mockResolvedValue( json( preset() ) );
		const instance = client( fetch );
		const first = await instance.getPreset( { presetId: 'wide', version: '1' } );
		first.snapshot.nodes.carInstance.transform.position[ 0 ] = 100;
		first.assets[ 'car@1' ].sha256 = 'f'.repeat( 64 );
		expect( await instance.getPreset( { presetId: 'wide', version: '1' } ) ).toEqual( preset() );
		expect( fetch ).toHaveBeenCalledTimes( 1 );
		expect( fetch.mock.calls[ 0 ][ 0 ] ).toBe( `${baseURL}/v1/catalogue/presets/wide/1` );

	} );

	it( 'bounds immutable version cache using least recently used entries', async () => {

		const fetch = vi.fn().mockImplementation( async url => json( preset( { version: url.split( '/' ).at( - 1 ) } ) ) );
		const instance = client( fetch, { maxCachedPresets: 2 } );
		const read = version => instance.getPreset( { presetId: 'wide', version } );
		await read( '1' ); await read( '2' ); await read( '1' ); await read( '3' ); await read( '1' );
		expect( fetch ).toHaveBeenCalledTimes( 3 );
		await read( '2' );
		expect( fetch ).toHaveBeenCalledTimes( 4 );

	} );

	it.each( [[ '../admin', '1' ], [ 'wide', '/latest' ], [ 'wide', '' ], [ {}, '1' ], [ 'wide', 1 ]] )( 'rejects invalid route identity %s %s without network access', async ( presetId, version ) => {

		const fetch = vi.fn();
		await expect( client( fetch ).getPreset( { presetId, version } ) ).rejects.toMatchObject( { code: 'INVALID_REQUEST' } );
		expect( fetch ).not.toHaveBeenCalled();

	} );

	it( 'rejects a validated preset with a different requested identity and does not cache it', async () => {

		const fetch = vi.fn().mockResolvedValueOnce( json( preset( { version: '2' } ) ) ).mockResolvedValueOnce( json( preset() ) );
		const instance = client( fetch );
		await expect( instance.getPreset( { presetId: 'wide', version: '1' } ) ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );
		expect( await instance.getPreset( { presetId: 'wide', version: '1' } ) ).toEqual( preset() );
		expect( fetch ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'detects conflicting concurrent responses for an immutable preset', async () => {

		const held = deferred();
		const fetch = vi.fn().mockReturnValueOnce( held.promise ).mockResolvedValueOnce( json( preset() ) );
		const instance = client( fetch );
		const pending = instance.getPreset( { presetId: 'wide', version: '1' } );
		await instance.getPreset( { presetId: 'wide', version: '1' } );
		held.resolve( json( preset( { name: 'Changed server version' } ) ) );
		await expect( pending ).rejects.toMatchObject( { code: 'IMMUTABLE_MISMATCH' } );
		expect( ( await instance.getPreset( { presetId: 'wide', version: '1' } ) ).name ).toBe( 'Wide' );

	} );

	it( 'accepts concurrent immutable responses whose object key order differs', async () => {

		const held = deferred();
		const fetch = vi.fn().mockReturnValueOnce( held.promise ).mockResolvedValueOnce( json( preset() ) );
		const instance = client( fetch );
		const pending = instance.getPreset( { presetId: 'wide', version: '1' } );
		await instance.getPreset( { presetId: 'wide', version: '1' } );
		held.resolve( json( Object.fromEntries( Object.entries( preset() ).reverse() ) ) );
		expect( await pending ).toEqual( preset() );

	} );

	it.each( [[ 403, 'AUTHORIZATION', false ], [ 404, 'NOT_FOUND', false ], [ 429, 'RATE_LIMITED', true ], [ 503, 'SERVER', true ]] )( 'reports HTTP %s without exposing the response', async ( status, code, retryable ) => {

		const instance = client( vi.fn().mockResolvedValue( new Response( 'SECRET SERVER BODY', { status } ) ) );
		await expect( instance.list() ).rejects.toMatchObject( { code, status, retryable } );
		await expect( instance.list() ).rejects.not.toThrow( 'SECRET' );

	} );

	it.each( [ 'invalid-mime', 'http-error', 'cancelled' ] )( 'releases the rejected %s response body without reading it', async kind => {

		const cancel = vi.fn();
		const controller = new AbortController();
		const response = new Response( new ReadableStream( { cancel } ), { status: kind === 'http-error' ? 503 : 200, headers: { 'content-type': kind === 'invalid-mime' ? 'text/html' : 'application/json' } } );
		const fetch = vi.fn().mockImplementation( async () => {

			if ( kind === 'cancelled' ) controller.abort();
			return response;

		} );
		await expect( client( fetch ).list( { signal: controller.signal } ) ).rejects.toMatchObject( { code: kind === 'invalid-mime' ? 'INVALID_RESPONSE' : kind === 'http-error' ? 'SERVER' : 'CANCELLED' } );
		expect( cancel ).toHaveBeenCalledTimes( 1 );

	} );

	it( 'reports network failure instead of pretending the library is empty', async () => {

		await expect( client( vi.fn().mockRejectedValue( new Error( 'secret endpoint' ) ) ).list() ).rejects.toMatchObject( { code: 'NETWORK', retryable: true } );

	} );

	it.each( [ new Response( '<html>fallback</html>', { headers: { 'content-type': 'text/html' } } ), new Response( '{', { headers: { 'content-type': 'application/json' } } ), json( { format: 'rayzee-student-catalogue', schemaVersion: 2, presets: [] } ) ] )( 'rejects HTML fallbacks, invalid JSON and unsupported schemas', async response => {

		await expect( client( vi.fn().mockResolvedValue( response ) ).list() ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'enforces declared and streaming byte limits, including multibyte UTF-8', async () => {

		await expect( client( vi.fn().mockResolvedValue( json( catalogue(), { 'content-length': '9000' } ) ), { maxJSONBytes: 1000 } ).list() ).rejects.toMatchObject( { code: 'RESPONSE_TOO_LARGE' } );
		const value = catalogue( { presets: [ summary( { name: '猫'.repeat( 20 ) } ) ] } );
		const text = JSON.stringify( value );
		await expect( client( vi.fn().mockResolvedValue( json( value ) ), { maxJSONBytes: text.length } ).list() ).rejects.toMatchObject( { code: 'RESPONSE_TOO_LARGE' } );
		const encoded = new TextEncoder().encode( JSON.stringify( catalogue() ) );
		const response = new Response( new ReadableStream( { start( controller ) {

			for ( let offset = 0; offset < encoded.length; offset += 13 ) controller.enqueue( encoded.slice( offset, offset + 13 ) );
			controller.close();

		} } ), { headers: { 'content-type': 'application/json' } } );
		expect( await client( vi.fn().mockResolvedValue( response ), { maxJSONBytes: encoded.length } ).list() ).toEqual( catalogue() );

	} );

	it( 'rejects invalid UTF-8 rather than silently repairing published names', async () => {

		const response = new Response( new Uint8Array( [ 0xff ] ), { headers: { 'content-type': 'application/json' } } );
		await expect( client( vi.fn().mockResolvedValue( response ) ).list() ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'rejects pre-cancelled reads even when a preset is cached', async () => {

		const fetch = vi.fn().mockResolvedValue( json( preset() ) );
		const instance = client( fetch );
		await instance.getPreset( { presetId: 'wide', version: '1' } );
		const controller = new AbortController(); controller.abort();
		await expect( instance.list( { signal: controller.signal } ) ).rejects.toMatchObject( { code: 'CANCELLED' } );
		await expect( instance.getPreset( { presetId: 'wide', version: '1' }, { signal: controller.signal } ) ).rejects.toMatchObject( { code: 'CANCELLED' } );
		expect( fetch ).toHaveBeenCalledTimes( 1 );

	} );

	it( 'does not commit a fetch response delivered after cancellation', async () => {

		const held = deferred();
		const fetch = vi.fn().mockReturnValueOnce( held.promise ).mockResolvedValueOnce( new Response( null, { status: 304 } ) );
		const instance = client( fetch );
		const controller = new AbortController();
		const pending = instance.list( { signal: controller.signal } );
		controller.abort(); held.resolve( json( catalogue(), { etag: '"cancelled"' } ) );
		await expect( pending ).rejects.toMatchObject( { code: 'CANCELLED' } );
		await expect( instance.list() ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );
		expect( fetch.mock.calls[ 1 ][ 1 ].headers ).not.toHaveProperty( 'If-None-Match' );

	} );

	it( 'cancels a pending body read and prevents partial-response cache commits', async () => {

		const reading = deferred();
		const cancel = vi.fn();
		const response = new Response( new ReadableStream( { pull() {

			reading.resolve();

		}, cancel } ), { headers: { 'content-type': 'application/json' } } );
		const fetch = vi.fn().mockResolvedValueOnce( response ).mockResolvedValueOnce( new Response( null, { status: 304 } ) );
		const instance = client( fetch );
		const controller = new AbortController();
		const pending = instance.list( { signal: controller.signal } );
		await reading.promise; controller.abort();
		await expect( pending ).rejects.toMatchObject( { code: 'CANCELLED' } );
		expect( cancel ).toHaveBeenCalled();
		await expect( instance.list() ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'clear drops both caches and prevents older in-flight work from repopulating them', async () => {

		const held = deferred();
		const fetch = vi.fn().mockResolvedValueOnce( json( catalogue(), { etag: '"one"' } ) ).mockResolvedValueOnce( json( preset() ) ).mockReturnValueOnce( held.promise ).mockResolvedValueOnce( json( preset() ) ).mockResolvedValueOnce( new Response( null, { status: 304 } ) );
		const instance = client( fetch );
		await instance.list(); await instance.getPreset( { presetId: 'wide', version: '1' } );
		const pending = instance.list();
		instance.clear();
		held.resolve( json( catalogue(), { etag: '"old"' } ) ); await pending;
		await instance.getPreset( { presetId: 'wide', version: '1' } );
		await expect( instance.list() ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );
		expect( fetch ).toHaveBeenCalledTimes( 5 );
		expect( fetch.mock.calls[ 4 ][ 1 ].headers ).not.toHaveProperty( 'If-None-Match' );

	} );

} );
