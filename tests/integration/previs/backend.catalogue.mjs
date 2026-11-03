import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { studentFixture } from '../../unit/previs/studentFixtures.js';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const root = fileURLToPath( new URL( '../../../', import.meta.url ) );
const origin = 'https://catalogue.example.test';
const sha = bytes => createHash( 'sha256' ).update( bytes ).digest( 'hex' );
const password = randomUUID(), salt = randomBytes( 16 );
const verifier = `pbkdf2-sha256$1000$${salt.toString( 'base64url' )}$${pbkdf2Sync( password, salt, 1000, 32, 'sha256' ).toString( 'base64url' )}`;
const settings = {
	ENVIRONMENT: 'test', ENABLE_CATALOGUE_API: 'true', ENABLE_DRAFT_API: 'true', ALLOW_LOCAL_GEO_EXEMPTION: 'false',
	MAX_JSON_BYTES: '65536', MAX_LIBRARY_ASSET_BYTES: '1024', MAX_NARRATION_BYTES: '1024',
	MAX_DRAFT_REVISIONS: '100', MAX_DRAFT_MEDIA: '5', MAX_DRAFT_CREATIONS_PER_MINUTE: '100',
	ADMIN_PASSWORD_VERIFIER: verifier, ADMIN_SESSION_SECRET: randomBytes( 32 ).toString( 'base64url' )
};
let script, migrations;
before( async () => {
	script = ( await build( { entryPoints: [ `${root}backend/src/worker.js` ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[ 0 ].text;
	migrations = await Promise.all( [ '0001_drafts.sql', '0002_narration.sql', '0003_admin_password.sql', '0004_catalogue.sql' ].map( name => readFile( `${root}backend/migrations/${name}`, 'utf8' ) ) );
} );
async function harness( t, { bindings = {}, cf = { country: 'AU' } } = {} ) {
	const instance = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', bindings: { ...settings, ...bindings }, cf, d1Databases: { DB: 'data', ADMIN_AUTH_DB: 'auth' }, r2Buckets: [ 'LIBRARY', 'DOCUMENTS', 'NARRATION' ] } );
	t.after( () => instance.dispose() );
	const db = await instance.getD1Database( 'DB' ), auth = await instance.getD1Database( 'ADMIN_AUTH_DB' );
	for ( const migration of migrations ) await db.batch( splitSql( migration ).map( sql => db.prepare( sql ) ) );
	await auth.batch( splitSql( migrations[ 2 ] ).map( sql => auth.prepare( sql ) ) );
	const raw = ( path, init = {} ) => instance.dispatchFetch( `${origin}${path}`, init );
	let cookie;
	const login = await raw( '/v1/admin/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify( { password } ) } );
	if ( login.status === 200 ) cookie = login.headers.get( 'Set-Cookie' ).split( ';' )[ 0 ];
	const api = async ( path, { method = 'GET', body, bytes, admin = false, key, match, absent, headers = {} } = {} ) => {
		const response = await raw( path, { method, headers: {
			...( admin ? { Cookie: cookie, Origin: origin } : {} ), ...( body !== undefined ? { 'Content-Type': 'application/json' } : {} ),
			...( key ? { 'Idempotency-Key': key } : {} ), ...( match !== undefined ? { 'If-Match': `"${match}"` } : {} ), ...( absent ? { 'If-None-Match': '*' } : {} ), ...headers
		}, ...( body !== undefined ? { body: JSON.stringify( body ) } : bytes !== undefined ? { body: bytes } : {} ) } );
		const contentType = response.headers.get( 'Content-Type' ) || '';
		return { status: response.status, headers: response.headers, body: contentType.includes( 'application/json' ) ? await response.json() : new Uint8Array( await response.arrayBuffer() ) };
	};
	const fixture = studentFixture();
	const contents = { car: new Uint8Array( [ 1, 2, 3, 4, 5, 6 ] ), video: new Uint8Array( [ 6, 5, 4, 3, 2, 1 ] ) };
	for ( const asset of Object.values( fixture.assets ) ) { asset.sha256 = sha( contents[ asset.assetId ] ); asset.byteLength = contents[ asset.assetId ].length; }
	const preset = { format: 'rayzee-student-preset', schemaVersion: 1, presetId: 'wide', version: '1', name: 'Wide', description: 'Fixture', category: 'Studio', defaultDurationFrames: 125, thumbnail: null, assets: fixture.assets, baseScene: fixture.baseScenes[ 'studio@1' ], snapshot: fixture.shots.shotA.snapshot };
	const upload = ( asset, bytes = contents[ asset.assetId ] ) => api( `/v1/admin/catalogue/assets/${asset.assetId}/${asset.version}`, { method: 'PUT', admin: true, bytes, headers: { 'Content-Type': asset.mimeType, 'X-Asset-Metadata': JSON.stringify( asset ) } } );
	const seed = async () => { for ( const asset of Object.values( preset.assets ) ) assert.equal( ( await upload( asset ) ).status, 201 ); };
	const publish = ( value = preset, { key = randomUUID(), match, absent = match === undefined } = {} ) => api( `/v1/admin/catalogue/presets/${value.presetId}/${value.version}`, { method: 'PUT', admin: true, body: value, key, match, absent } );
	return { instance, raw, api, db, bucket: await instance.getR2Bucket( 'LIBRARY' ), cookie, preset, upload, seed, publish, contents };
}

test( 'catalogue defaults and hosted configurations fail closed; AU and admin session/origin checks apply', async t => {
	const app = await harness( t );
	assert.equal( ( await app.api( '/v1/catalogue' ) ).status, 200 );
	assert.equal( ( await app.api( '/v1/admin/catalogue/presets/wide/1', { method: 'PUT', body: app.preset, headers: { Origin: origin } } ) ).status, 401 );
	assert.equal( ( await app.api( '/v1/admin/catalogue/presets/wide/1', { method: 'PUT', admin: true, body: app.preset, headers: { Origin: 'https://elsewhere.test' } } ) ).status, 403 );
	const disabled = await harness( t, { bindings: { ENABLE_CATALOGUE_API: 'false' } } );
	assert.equal( ( await disabled.api( '/v1/catalogue' ) ).status, 503 );
	const hosted = await harness( t, { bindings: { ENVIRONMENT: 'production', ENABLE_CATALOGUE_API: 'true' } } );
	assert.equal( ( await hosted.api( '/v1/catalogue' ) ).status, 503 );
	const overseas = await harness( t, { cf: { country: 'US' } } );
	assert.equal( ( await overseas.api( '/v1/catalogue', { headers: { 'CF-IPCountry': 'AU' } } ) ).status, 403 );
} );

test( 'registered actual bytes are immutable, bounded and verified; metadata claims alone cannot publish', async t => {
	const app = await harness( t );
	assert.equal( ( await app.publish() ).body.error.code, 'ASSET_NOT_VERIFIED' );
	const asset = app.preset.assets[ 'car@1' ];
	assert.equal( ( await app.upload( asset, new Uint8Array( [ 9, 8, 7, 6, 5, 4 ] ) ) ).body.error.code, 'ASSET_MISMATCH' );
	assert.equal( ( await app.upload( asset ) ).status, 201 );
	assert.equal( ( await app.upload( asset ) ).status, 200 );
	assert.equal( ( await app.upload( { ...asset, byteLength: 2048 }, new Uint8Array( 2048 ) ) ).status, 413 );
	assert.equal( ( await app.upload( { ...asset, sha256: sha( new Uint8Array( [ 9 ] ) ), byteLength: 1 }, new Uint8Array( [ 9 ] ) ) ).body.error.code, 'IMMUTABLE_ASSET' );
	assert.equal( ( await app.upload( { ...asset, arbitraryUrl: 'https://evil.test' } ) ).status, 422 );
	const stream = new ReadableStream( { start( controller ) { controller.enqueue( new Uint8Array( 1500 ) ); controller.close(); } } );
	assert.equal( ( await app.raw( '/v1/admin/catalogue/assets/car/1', { method: 'PUT', headers: { Cookie: app.cookie, Origin: origin, 'X-Asset-Metadata': JSON.stringify( asset ), 'Content-Type': asset.mimeType }, body: stream, duplex: 'half' } ) ).status, 413 );
	await assert.rejects( app.db.prepare( 'UPDATE library_assets SET sha256=?' ).bind( '0'.repeat( 64 ) ).run(), /immutable library asset/ );
} );

test( 'publish, hide, replace and replay preserve pinned versions without rolling catalogue heads back', async t => {
	const app = await harness( t ); await app.seed();
	assert.equal( ( await app.publish( app.preset, { absent: false } ) ).status, 428 );
	const first = await app.publish( app.preset, { key: 'first' } );
	assert.equal( first.status, 201, JSON.stringify( first.body ) ); assert.equal( first.headers.get( 'ETag' ), '"0"' );
	assert.equal( ( await app.api( '/v1/catalogue' ) ).body.presets.length, 1 );
	const head = await app.api( '/v1/admin/catalogue/presets/wide', { admin: true } ); assert.equal( head.body.headRevision, 0 );
	for ( const body of [ null, [], 'invalid', { version: 1, available: false }, { version: [ '1' ], available: false }, { version: '1', available: 'false' }, { version: '1', available: false, extra: true } ] ) {
		const malformed = await app.api( '/v1/admin/catalogue/presets/wide/availability', { method: 'POST', admin: true, key: randomUUID(), match: 0, body } );
		assert.equal( malformed.status, 422 );
		assert.equal( malformed.body.error.code, 'INVALID_AVAILABILITY' );
	}
	const hide = () => app.api( '/v1/admin/catalogue/presets/wide/availability', { method: 'POST', admin: true, key: 'hide', match: 0, body: { version: '1', available: false } } );
	assert.equal( ( await hide() ).status, 200 );
	assert.equal( ( await app.api( '/v1/catalogue' ) ).body.presets.length, 0 );
	assert.equal( ( await app.api( '/v1/catalogue/presets/wide/1' ) ).status, 200 );
	const second = { ...app.preset, version: '2', name: 'New wide' };
	assert.equal( ( await app.publish( second, { key: 'second', match: 1 } ) ).status, 201 );
	assert.equal( ( await app.publish( app.preset, { key: 'first' } ) ).body.replayed, true );
	assert.equal( ( await hide() ).body.replayed, true );
	assert.equal( ( await app.api( '/v1/catalogue' ) ).body.presets[ 0 ].version, '2' );
	assert.equal( ( await app.publish( { ...second, name: 'Different' }, { key: 'second', match: 1 } ) ).body.error.code, 'IDEMPOTENCY_CONFLICT' );
	assert.equal( ( await app.publish( app.preset, { match: 2 } ) ).body.error.code, 'IMMUTABLE_PRESET' );
	assert.equal( ( await app.api( '/v1/admin/catalogue/presets/wide/availability', { method: 'POST', admin: true, key: 'stale', match: 2, body: { version: '1', available: false } } ) ).status, 409 );
	assert.equal( ( await app.api( '/v1/catalogue/presets/wide/1' ) ).body.name, 'Wide' );
	await assert.rejects( app.db.prepare( 'UPDATE catalogue_presets SET sha256=?' ).bind( '0'.repeat( 64 ) ).run(), /immutable preset/ );
} );

test( 'concurrent publication has one winner; duplicate retries acknowledge one immutable commit', async t => {
	const app = await harness( t ); await app.seed();
	const duplicate = await Promise.all( [ app.publish( app.preset, { key: 'one' } ), app.publish( app.preset, { key: 'one' } ) ] );
	assert.ok( duplicate.every( item => [ 200, 201 ].includes( item.status ) ), JSON.stringify( duplicate ) );
	assert.equal( duplicate.filter( item => item.body.replayed ).length, 1 );
	const candidates = [ { ...app.preset, version: '2' }, { ...app.preset, version: '3' } ];
	const responses = await Promise.all( candidates.map( value => app.publish( value, { match: 0 } ) ) );
	assert.deepEqual( responses.map( item => item.status ).sort(), [ 201, 409 ] );
	assert.equal( ( await app.db.prepare( 'SELECT count(*) AS count FROM catalogue_presets' ).first() ).count, 2 );
	assert.equal( ( await app.api( '/v1/admin/catalogue/presets/wide', { admin: true } ) ).body.headRevision, 1 );
} );

test( 'immutable base-scene identity is checked across presets, including simultaneous publishers', async t => {
	const app = await harness( t ); await app.seed();
	const changed = structuredClone( app.preset ); changed.presetId = 'other'; changed.baseScene.assets.push( { assetId: 'car', version: '1' } );
	// An identical duplicate ref is invalid at shared-schema level, so introduce a distinct registered model.
	const car2 = { ...app.preset.assets[ 'car@1' ], assetId: 'car2' }; await app.upload( car2, app.contents.car );
	changed.assets[ 'car2@1' ] = car2; changed.baseScene.assets[ 1 ] = { assetId: 'car2', version: '1' };
	const responses = await Promise.all( [ app.publish(), app.publish( changed ) ] );
	assert.deepEqual( responses.map( result => result.status ).sort(), [ 201, 409 ], JSON.stringify( responses ) );
	assert.equal( ( await app.db.prepare( 'SELECT count(*) AS count FROM catalogue_presets' ).first() ).count, 1 );
} );

test( 'asset reads support exact byte ranges, strong ETags and fail closed on missing/corrupt storage', async t => {
	const app = await harness( t ); await app.seed(); await app.publish();
	const path = '/v1/catalogue/assets/car/1';
	const whole = await app.api( path ); assert.deepEqual( whole.body, app.contents.car );
	assert.equal( whole.headers.get( 'Content-Type' ), 'model/gltf-binary' );
	for ( const [ range, expected, contentRange ] of [ [ 'bytes=1-3', [ 2, 3, 4 ], 'bytes 1-3/6' ], [ 'bytes=-2', [ 5, 6 ], 'bytes 4-5/6' ], [ 'bytes=4-', [ 5, 6 ], 'bytes 4-5/6' ], [ 'bytes=0-99', [ 1, 2, 3, 4, 5, 6 ], 'bytes 0-5/6' ] ] ) {
		const response = await app.api( path, { headers: { Range: range } } ); assert.equal( response.status, 206 ); assert.deepEqual( Array.from( response.body ), expected ); assert.equal( response.headers.get( 'Content-Range' ), contentRange );
	}
	for ( const range of [ 'bytes=6-', 'bytes=-0', 'bytes=3-1', 'bytes=0-1,3-4', 'bytes=x-y' ] ) assert.equal( ( await app.api( path, { headers: { Range: range } } ) ).status, 416 );
	assert.equal( ( await app.api( path, { headers: { Range: 'bytes=1-2', 'If-Range': '"different"' } } ) ).status, 200 );
	assert.equal( ( await app.raw( path, { headers: { 'If-None-Match': whole.headers.get( 'ETag' ) } } ) ).status, 304 );
	const listing = await app.api( '/v1/catalogue' ); assert.equal( ( await app.raw( '/v1/catalogue', { headers: { 'If-None-Match': listing.headers.get( 'ETag' ) } } ) ).status, 304 );
	const fullPreset = await app.api( '/v1/catalogue/presets/wide/1' ); assert.equal( ( await app.raw( '/v1/catalogue/presets/wide/1', { headers: { 'If-None-Match': fullPreset.headers.get( 'ETag' ) } } ) ).status, 304 );
	const row = await app.db.prepare( 'SELECT * FROM library_assets WHERE asset_id=?' ).bind( 'car' ).first();
	await app.bucket.put( row.object_key, new Uint8Array( [ 9, 9, 9, 9, 9, 9 ] ), { sha256: sha( new Uint8Array( [ 9, 9, 9, 9, 9, 9 ] ) ) } );
	assert.equal( ( await app.api( path ) ).status, 503 );
	assert.equal( ( await app.api( '/v1/catalogue/presets/wide/1' ) ).status, 503 );
	assert.equal( ( await app.publish( { ...app.preset, version: '2' }, { match: 0 } ) ).status, 503 );
	await app.bucket.delete( row.object_key ); assert.equal( ( await app.api( path ) ).status, 503 );
} );

test( 'the new catalogue does not silently broaden private draft dependency acknowledgements', async t => {
	const app = await harness( t ); await app.seed(); await app.publish();
	const doc = createStudentProjectDocument(); doc.assets = app.preset.assets;
	const response = await app.api( '/v1/drafts', { method: 'POST', body: { draftId: randomUUID(), document: doc }, key: 'draft', headers: { Authorization: `Bearer ${randomBytes( 32 ).toString( 'base64url' )}` } } );
	assert.equal( response.status, 201 ); assert.equal( response.body.dependenciesVerified, false );
} );


test( 'catalogue aggregation fails closed at the configured JSON bound', async t => {
	const app = await harness( t, { bindings: { MAX_JSON_BYTES: '8192' } } ); await app.seed();
	const first = { ...app.preset, description: 'x'.repeat( 4096 ) };
	assert.equal( ( await app.publish( first ) ).status, 201 );
	assert.equal( ( await app.api( '/v1/catalogue' ) ).status, 200 );
	const second = { ...first, presetId: 'another' };
	assert.equal( ( await app.publish( second ) ).status, 201 );
	const list = await app.api( '/v1/catalogue' );
	assert.equal( list.status, 503 ); assert.equal( list.body.error.code, 'CATALOGUE_TOO_LARGE' );
} );
