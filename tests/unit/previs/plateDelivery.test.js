import { describe, expect, it, vi } from 'vitest';
import { handlePlateDelivery, plateRange } from '../../../backend/src/plates/PlateDelivery.js';
import { PlateCatalogueClient } from '../../../app/src/services/plates/PlateCatalogueClient.js';
import { PLATE_SLOTS } from '../../../app/src/services/plates/PlateSet.js';

const manifest = { format: 'rayzee-driving-plates', schemaVersion: 1, id: 'set-1', name: 'Drive', frameCount: 50, headingOffset: 0, files: Object.fromEntries( PLATE_SLOTS.map( slot => [ slot, { encoding: slot.split( '-' )[ 1 ], width: 1280, height: 890, fps: 25, frameCount: 50, size: 32, chunks: [ '0'.repeat( 64 ) ] } ] ) ) };
const origin = 'https://studio.example';
const adapter = () => ( { secret: 'a1'.repeat( 32 ), readJSON: async () => ( { schemaVersion: 1, sets: [ manifest ] } ), readObject: vi.fn( async ( path, range ) => ( { size: 32, body: range ? new Uint8Array( 32 ).slice( range.start, range.end + 1 ) : new Uint8Array( 32 ) } ) ) } );
const request = ( path, options = {} ) => new Request( origin + path, options );
const cookieFor = async api => ( await handlePlateDelivery( request( '/v1/plates/session', { method: 'POST', headers: { Origin: origin } } ), api ) ).headers.get( 'set-cookie' ).split( ';' )[ 0 ];

describe( 'private plate delivery', () => {

	it( 'requires an app session, checks the issuing origin and rejects forged cookies', async () => {

		const api = adapter();
		expect( ( await handlePlateDelivery( request( '/v1/plates' ), api ) ).status ).toBe( 401 );
		expect( ( await handlePlateDelivery( request( '/v1/plates/session', { method: 'POST', headers: { Origin: 'https://elsewhere.example' } } ), api ) ).status ).toBe( 403 );
		const cookie = await cookieFor( api );
		expect( cookie ).toContain( '__Host-rayzee-plates=' );
		expect( ( await handlePlateDelivery( request( '/v1/plates', { headers: { Cookie: cookie } } ), api ) ).status ).toBe( 200 );
		expect( ( await handlePlateDelivery( request( '/v1/plates', { headers: { Cookie: cookie + 'bad' } } ), api ) ).status ).toBe( 401 );
		expect( ( await handlePlateDelivery( request( '/v1/plates', { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } } ), api ) ).status ).toBe( 403 );

	} );

	it( 'streams exact byte ranges and refuses traversal, invalid ranges and unknown sets', async () => {

		const api = adapter(), Cookie = await cookieFor( api );
		const response = await handlePlateDelivery( request( '/v1/plates/set-1/front-hevc.mp4', { headers: { Cookie, Range: 'bytes=2-9' } } ), api );
		expect( response.status ).toBe( 206 ); expect( response.headers.get( 'content-range' ) ).toBe( 'bytes 2-9/32' );
		expect( ( await response.arrayBuffer() ).byteLength ).toBe( 8 );
		expect( ( await handlePlateDelivery( request( '/v1/plates/set-1/front-hevc.mp4', { headers: { Cookie, Range: 'bytes=32-50' } } ), api ) ).status ).toBe( 416 );
		for ( const path of [ '/v1/plates/set-2/front-hevc.mp4', '/v1/plates/set-1/secret.txt', '/v1/plates/set-1/../secret.txt' ] ) expect( ( await handlePlateDelivery( request( path, { headers: { Cookie } } ), api ) ).status ).toBe( 404 );
		expect( plateRange( 'bytes=0-2,4-7', 32 ) ).toBeNull();

	} );

} );

describe( 'bounded download client', () => {

	it( 'rejects full responses instead of appending them to a partial file', async () => {

		const client = new PlateCatalogueClient( { fetch: async () => new Response( new Uint8Array( 32 ), { headers: { 'Content-Type': 'video/mp4' } } ) } );
		client.expiresAt = Date.now() + 1000000;
		await expect( client.chunk( manifest, 'front-hevc', 2, 9 ) ).rejects.toThrow( /verified download range/ );

	} );

	it( 'renews an expired session once and validates received range length', async () => {

		const responses = [ new Response( null, { status: 401 } ), new Response( JSON.stringify( { expiresAt: Date.now() + 1000000 } ) ), new Response( new Uint8Array( 8 ), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 2-9/32' } } ) ];
		const fetch = vi.fn( async () => responses.shift() ), client = new PlateCatalogueClient( { fetch } ); client.expiresAt = Date.now() + 1000000;
		expect( ( await client.chunk( manifest, 'front-hevc', 2, 9 ) ).length ).toBe( 8 );
		expect( fetch.mock.calls[ 1 ][ 0 ] ).toBe( '/v1/plates/session' );
		const short = new PlateCatalogueClient( { fetch: async () => new Response( new Uint8Array( 7 ), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 2-9/32' } } ) } ); short.expiresAt = Date.now() + 1000000;
		await expect( short.chunk( manifest, 'front-hevc', 2, 9 ) ).rejects.toThrow( /interrupted/ );

	} );

} );
