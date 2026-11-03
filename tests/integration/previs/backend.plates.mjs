import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PLATE_SLOTS } from '../../../app/src/services/plates/PlateSet.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' ), { build } = require( 'esbuild' );
const origin = 'https://plates.example.test';
const manifest = { format: 'rayzee-driving-plates', schemaVersion: 1, id: 'drive-1', name: 'Drive', frameCount: 50, headingOffset: 0, files: Object.fromEntries( PLATE_SLOTS.map( slot => [ slot, { encoding: slot.split( '-' )[ 1 ], width: 1280, height: 890, fps: 25, frameCount: 50, size: 32, chunks: [ '0'.repeat( 64 ) ] } ] ) ) };
let script;
before( async () => {

	script = ( await build( { entryPoints: [ fileURLToPath( new URL( '../../../backend/src/worker.js', import.meta.url ) ) ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[ 0 ].text;

} );
async function harness( t, { country = 'AU', enabled = true } = {} ) {

	const instance = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', cf: { country }, bindings: { ENVIRONMENT: 'production', ENABLE_PLATE_API: String( enabled ), PLATE_SESSION_SECRET: randomBytes( 32 ).toString( 'hex' ) }, r2Buckets: [ 'LIBRARY' ] } );
	t.after( () => instance.dispose() );
	const bucket = await instance.getR2Bucket( 'LIBRARY' );
	await bucket.put( 'plates/catalogue.json', JSON.stringify( { schemaVersion: 1, sets: [ manifest ] } ) );
	await bucket.put( 'plates/drive-1/front-hevc.mp4', Uint8Array.from( { length: 32 }, ( _, i ) => i ) );
	return { bucket, api: ( path, options ) => instance.dispatchFetch( origin + path, options ) };

}

test( 'R2 plate delivery uses an anonymous secure session and streams an exact range', async t => {

	const { api } = await harness( t );
	assert.equal( ( await api( '/v1/plates' ) ).status, 401 );
	const session = await api( '/v1/plates/session', { method: 'POST', headers: { Origin: origin } } );
	assert.equal( session.status, 200 );
	const rawCookie = session.headers.get( 'set-cookie' ); assert.ok( rawCookie.includes( 'HttpOnly' ) && rawCookie.includes( 'Secure' ) && rawCookie.includes( 'SameSite=Strict' ) );
	const Cookie = rawCookie.split( ';' )[ 0 ];
	assert.equal( ( await api( '/v1/plates', { headers: { Cookie } } ) ).status, 200 );
	const range = await api( '/v1/plates/drive-1/front-hevc.mp4', { headers: { Cookie, Range: 'bytes=8-15' } } );
	assert.equal( range.status, 206 ); assert.equal( range.headers.get( 'content-range' ), 'bytes 8-15/32' );
	assert.deepEqual( Array.from( new Uint8Array( await range.arrayBuffer() ) ), [ 8, 9, 10, 11, 12, 13, 14, 15 ] );
	assert.equal( ( await api( '/v1/plates/drive-1/front-hevc.mp4', { headers: { Cookie, Range: 'bytes=99-' } } ) ).status, 416 );

} );

test( 'plate delivery preserves the app country gate and stays disabled without activation', async t => {

	const foreign = await harness( t, { country: 'US' } );
	assert.equal( ( await foreign.api( '/v1/plates/session', { method: 'POST', headers: { Origin: origin, 'CF-IPCountry': 'AU' } } ) ).status, 403 );
	const disabled = await harness( t, { enabled: false } );
	assert.equal( ( await disabled.api( '/v1/plates/session', { method: 'POST', headers: { Origin: origin } } ) ).status, 503 );

} );

test( 'a full-resolution file accidentally placed at the preview key cannot be served on hover', async t => {

	const { api, bucket } = await harness( t );
	await bucket.put( 'plates/drive-1/preview.mp4', new Uint8Array( 2 * 1024 * 1024 + 1 ) );
	const session = await api( '/v1/plates/session', { method: 'POST', headers: { Origin: origin } } );
	assert.equal( ( await api( '/v1/plates/drive-1/preview.mp4', { headers: { Cookie: session.headers.get( 'set-cookie' ).split( ';' )[ 0 ] } } ) ).status, 503 );

} );
