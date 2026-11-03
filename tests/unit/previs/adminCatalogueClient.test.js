import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AdminCatalogueClient } from '../../../app/src/previs/api/AdminCatalogueClient.js';
import { serializeStudentCatalogueContent } from '../../../app/src/previs/domain/StudentCatalogueSchema.js';
import { studentFixture } from './studentFixtures.js';

const origin = 'https://teacher.example';
const client = ( fetch, extra = {} ) => new AdminCatalogueClient( { baseURL: origin, origin, fetch, ...extra } );
const ack = ( changes = {} ) => ( { presetId: 'wide', version: '1', available: true, headRevision: 0, replayed: false, ...changes } );
const json = ( value, { status = 200, headers = {} } = {} ) => new Response( JSON.stringify( value ), { status, headers: { 'Content-Type': 'application/json', ETag: `"${value.headRevision ?? 0}"`, ...headers } } );
const preset = () => {

	const document = studentFixture();
	return { format: 'rayzee-student-preset', schemaVersion: 1, presetId: 'wide', version: '1', name: 'Wide', description: '', category: 'Studio', defaultDurationFrames: 125, thumbnail: null, assets: document.assets, baseScene: document.baseScenes[ 'studio@1' ], snapshot: document.shots.shotA.snapshot };

};

describe( 'Session-only immutable admin catalogue requests', () => {

	it.each( [
		{ baseURL: 'https://evil.example' }, { baseURL: 'https://secret@teacher.example' }, { baseURL: `${origin}?password=value` },
		{ baseURL: 'http://teacher.example', origin: 'http://teacher.example' }, { baseURL: 'not-url' }, { origin: undefined }, { maxJSONBytes: 0 },
	] )( 'rejects invalid or cross-origin configuration %#', changes => {

		expect( () => client( vi.fn(), changes ) ).toThrow( expect.objectContaining( { code: 'CONFIGURATION' } ) );

	} );

	it( 'accepts explicit same-origin loopback development and reads the current head', async () => {

		const fetch = vi.fn( async () => json( ack( { headRevision: 4 } ) ) );
		const api = client( fetch, { origin: 'http://127.0.0.1:8787', baseURL: 'http://127.0.0.1:8787' } );
		expect( await api.getHead( 'wide' ) ).toEqual( ack( { headRevision: 4 } ) );
		expect( fetch.mock.calls[ 0 ] ).toEqual( [ 'http://127.0.0.1:8787/v1/admin/catalogue/presets/wide', expect.objectContaining( { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' } ) ] );

	} );

	it( 'returns an absent head without inventing a revision and rejects mismatched head metadata', async () => {

		const fetch = vi.fn().mockResolvedValueOnce( new Response( null, { status: 404 } ) ).mockResolvedValueOnce( json( ack(), { headers: { ETag: '"99"' } } ) );
		const api = client( fetch );
		expect( await api.getHead( 'wide' ) ).toBeNull();
		await expect( api.getHead( 'wide' ) ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'pins canonical publication bytes and original preconditions across uncertain network retries', async () => {

		const value = preset(), body = serializeStudentCatalogueContent( value );
		const fetch = vi.fn().mockRejectedValueOnce( new Error( 'private https://secret.invalid' ) ).mockResolvedValueOnce( json( ack( { replayed: true } ) ) );
		const api = client( fetch ), operation = api.preparePublication( { preset: value, requestId: 'stable-operation-1' } );
		expect( Object.isFrozen( operation ) ).toBe( true );
		value.version = 'changed'; value.snapshot.camera.exposure = 987;
		await expect( api.publish( operation ) ).rejects.toMatchObject( { code: 'NETWORK', retryable: true } );
		expect( await api.publish( operation ) ).toEqual( ack( { replayed: true } ) );
		for ( const [ url, options ] of fetch.mock.calls ) {

			expect( url ).toBe( `${origin}/v1/admin/catalogue/presets/wide/1` );
			expect( options.body ).toBe( body );
			expect( options.headers ).toEqual( { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': 'stable-operation-1', 'If-None-Match': '*' } );
			expect( options.credentials ).toBe( 'same-origin' );

		}

	} );

	it( 'never substitutes a newly read head into a replayed operation', async () => {

		const fetch = vi.fn().mockResolvedValueOnce( json( ack( { headRevision: 9, version: 'newer' } ) ) ).mockResolvedValueOnce( json( ack( { headRevision: 3, replayed: true } ) ) );
		const api = client( fetch ), operation = api.preparePublication( { preset: preset(), headRevision: 2, requestId: 'original' } );
		expect( ( await api.getHead( 'wide' ) ).version ).toBe( 'newer' );
		expect( ( await api.publish( operation ) ).headRevision ).toBe( 3 );
		expect( fetch.mock.calls[ 1 ][ 1 ].headers[ 'If-Match' ] ).toBe( '"2"' );
		expect( fetch ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'prepares a bounded availability operation against the exact current version and head revision', async () => {

		const fetch = vi.fn( async () => json( ack( { available: false, headRevision: 6 } ) ) );
		const api = client( fetch ), operation = api.prepareAvailability( { presetId: 'wide', version: '1', available: false, headRevision: 5, requestId: 'hide-1' } );
		expect( await api.setAvailability( operation ) ).toEqual( ack( { available: false, headRevision: 6 } ) );
		expect( fetch.mock.calls[ 0 ] ).toEqual( [ `${origin}/v1/admin/catalogue/presets/wide/availability`, expect.objectContaining( { method: 'POST', body: '{"available":false,"version":"1"}', headers: expect.objectContaining( { 'If-Match': '"5"', 'Idempotency-Key': 'hide-1' } ) } ) ] );
		await expect( api.publish( operation ) ).rejects.toMatchObject( { code: 'INVALID_REQUEST' } );
		await expect( api.setAvailability( { ...operation } ) ).rejects.toMatchObject( { code: 'INVALID_REQUEST' } );

	} );

	it.each( [[ 401, 'AUTHORIZATION', false ], [ 403, 'AUTHORIZATION', false ], [ 409, 'CONFLICT', false ], [ 429, 'RATE_LIMITED', true ], [ 503, 'SERVER', true ], [ 422, 'REJECTED', false ]] )( 'handles status %s without consuming server error text or retrying automatically', async ( status, code, retryable ) => {

		const fetch = vi.fn( async () => new Response( 'private secret response', { status } ) ), api = client( fetch );
		let error;
		try {

			await api.publish( api.preparePublication( { preset: preset(), requestId: 'once' } ) );

		} catch ( failure ) {

			error = failure;

		}

		expect( error ).toMatchObject( { code, status, retryable } );
		expect( error.message ).not.toContain( 'secret' );
		expect( fetch ).toHaveBeenCalledTimes( 1 );

	} );

	it.each( [
		[ ack( { headRevision: 1 } ), {} ], [ ack( { presetId: 'other' } ), {} ], [ ack( { version: 'other' } ), {} ],
		[ ack( { available: false } ), {} ], [ ack( { unexpected: true } ), {} ], [ ack(), { ETag: '"wrong"' } ],
	] )( 'rejects an acknowledgement that cannot prove the original operation %#', async ( value, headers ) => {

		const api = client( async () => json( value, { headers } ) );
		await expect( api.publish( api.preparePublication( { preset: preset(), requestId: 'operation' } ) ) ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'bounds declared and streamed JSON and rejects non-JSON responses', async () => {

		const fetch = vi.fn().mockResolvedValueOnce( json( ack(), { headers: { 'Content-Length': '2048' } } ) ).mockResolvedValueOnce( new Response( 'x'.repeat( 1025 ), { headers: { 'Content-Type': 'application/json' } } ) ).mockResolvedValueOnce( new Response( 'private', { headers: { 'Content-Type': 'text/html' } } ) );
		const api = client( fetch, { maxJSONBytes: 1024 } );
		await expect( api.getHead( 'wide' ) ).rejects.toMatchObject( { code: 'RESPONSE_TOO_LARGE' } );
		await expect( api.getHead( 'wide' ) ).rejects.toMatchObject( { code: 'RESPONSE_TOO_LARGE' } );
		await expect( api.getHead( 'wide' ) ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'cancels an in-flight response reader and avoids a request for an already-aborted signal', async () => {

		const controller = new AbortController(), cancel = vi.fn();
		const fetch = vi.fn( async () => new Response( new ReadableStream( { start( stream ) {

			stream.enqueue( new TextEncoder().encode( '{' ) );

		}, cancel } ), { headers: { 'Content-Type': 'application/json' } } ) );
		const api = client( fetch ), pending = api.getHead( 'wide', { signal: controller.signal } );
		await vi.waitFor( () => expect( fetch ).toHaveBeenCalledOnce() );
		controller.abort();
		await expect( pending ).rejects.toMatchObject( { code: 'CANCELLED' } );
		expect( cancel ).toHaveBeenCalledOnce();
		await expect( api.getHead( 'wide', { signal: controller.signal } ) ).rejects.toMatchObject( { code: 'CANCELLED' } );
		expect( fetch ).toHaveBeenCalledOnce();

	} );

	it( 'uploads a private snapshot of hash-verified bytes and exact immutable metadata', async () => {

		const bytes = new Uint8Array( [ 1, 2, 3, 4 ] ), hash = createHash( 'sha256' ).update( bytes ).digest( 'hex' );
		const asset = { assetId: 'model', version: '1', kind: 'model', sha256: hash, byteLength: 4, mimeType: 'model/gltf-binary', durationUs: null };
		const metadata = serializeStudentCatalogueContent( asset );
		const fetch = vi.fn( async () => json( { assetId: 'model', version: '1', verified: true }, { status: 201, headers: { ETag: `"${hash}"` } } ) );
		const api = client( fetch ), pending = api.uploadAsset( asset, bytes );
		bytes.fill( 255 ); asset.assetId = 'changed'; asset.sha256 = '0'.repeat( 64 );
		expect( await pending ).toEqual( { assetId: 'model', version: '1', verified: true } );
		expect( fetch.mock.calls[ 0 ] ).toEqual( [ `${origin}/v1/admin/catalogue/assets/model/1`, expect.objectContaining( { method: 'PUT', body: new Uint8Array( [ 1, 2, 3, 4 ] ), headers: expect.objectContaining( { 'Content-Type': 'model/gltf-binary', 'X-Asset-Metadata': metadata } ) } ) ] );

	} );

	it( 'rejects mismatched upload bytes before sending and rejects a false upload acknowledgement', async () => {

		const asset = preset().assets[ 'car@1' ], fetch = vi.fn();
		await expect( client( fetch ).uploadAsset( asset, new Uint8Array( 100 ) ) ).rejects.toMatchObject( { code: 'ASSET_MISMATCH' } );
		expect( fetch ).not.toHaveBeenCalled();
		const bytes = new Uint8Array( [ 1 ] ), hash = createHash( 'sha256' ).update( bytes ).digest( 'hex' );
		const api = client( async () => json( { assetId: 'car', version: '1', verified: false }, { headers: { ETag: `"${hash}"` } } ) );
		await expect( api.uploadAsset( { ...asset, sha256: hash, byteLength: 1 }, bytes ) ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

} );
