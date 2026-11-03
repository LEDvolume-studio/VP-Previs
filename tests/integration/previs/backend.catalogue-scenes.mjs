import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createBundledStudentSceneManifest } from '../../../app/src/previs/fixtures/BundledStudentScene.js';
import { studentFixture } from '../../unit/previs/studentFixtures.js';

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
	MAX_JSON_BYTES: '65536', MAX_LIBRARY_ASSET_BYTES: '67108864', MAX_NARRATION_BYTES: '1024',
	MAX_DRAFT_REVISIONS: '100', MAX_DRAFT_MEDIA: '5', MAX_DRAFT_CREATIONS_PER_MINUTE: '100',
	ADMIN_PASSWORD_VERIFIER: verifier, ADMIN_SESSION_SECRET: randomBytes( 32 ).toString( 'base64url' )
};
let script, migrations;
before( async () => {
	script = ( await build( { entryPoints: [ `${root}backend/src/worker.js` ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[ 0 ].text;
	migrations = await Promise.all( [ '0001_drafts.sql', '0002_narration.sql', '0003_admin_password.sql', '0004_catalogue.sql', '0005_supported_scenes.sql' ].map( name => readFile( `${root}backend/migrations/${name}`, 'utf8' ) ) );
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
	const manifest = createBundledStudentSceneManifest( { models: [ 'led' ] } );
	fixture.assets = manifest.assets; fixture.baseScenes = { [ `${manifest.baseScene.sceneId}@${manifest.baseScene.version}` ]: manifest.baseScene };
	const sceneDefinition = { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: manifest.baseScene, models: manifest.models.map( ( { asset, nodes } ) => ( { asset, nodes } ) ), humanPoseRoots: [] };
	const snapshot = fixture.shots.shotA.snapshot;
	snapshot.nodes = Object.fromEntries( sceneDefinition.models[ 0 ].nodes.map( node => [ node.instanceId, { asset: sceneDefinition.models[ 0 ].asset, nodeId: node.nodeId, transform: { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], visible: true }, humanPose: null, doorAngles: {} } ] ) );
	snapshot.ledWalls = []; snapshot.rasterAppearance = { version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb', enableEnvironment: false, showBackground: true, transparentBackground: false, backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#000000' };
	contents[ 'local-fixture-led' ] = new Uint8Array( await readFile( `${root}app/public/models/led/main-led-volume-wall.glb` ) );

	const preset = { format: 'rayzee-student-preset', schemaVersion: 2, sceneDefinition, presetId: 'wide', version: '1', name: 'Wide', description: 'Fixture', category: 'Studio', defaultDurationFrames: 125, thumbnail: null, assets: fixture.assets, baseScene: manifest.baseScene, snapshot: fixture.shots.shotA.snapshot };
	const upload = ( asset, bytes = contents[ asset.assetId ] ) => api( `/v1/admin/catalogue/assets/${asset.assetId}/${asset.version}`, { method: 'PUT', admin: true, bytes, headers: { 'Content-Type': asset.mimeType, 'X-Asset-Metadata': JSON.stringify( asset ) } } );
	const seed = async () => { for ( const asset of Object.values( preset.assets ) ) assert.equal( ( await upload( asset ) ).status, 201 ); };
	const publish = ( value = preset, { key = randomUUID(), match, absent = match === undefined } = {} ) => api( `/v1/admin/catalogue/presets/${value.presetId}/${value.version}`, { method: 'PUT', admin: true, body: value, key, match, absent } );
	return { instance, raw, api, db, bucket: await instance.getR2Bucket( 'LIBRARY' ), cookie, preset, upload, seed, publish, contents };
}


test( 'v2 publishes actual supported GLB mappings and resolves immutable scene definitions with verified model-only metadata', async t => {
 const app = await harness( t ); await app.seed();
 const first = await app.publish(); assert.equal( first.status, 201, JSON.stringify( first.body ) );
 const base = app.preset.baseScene, path = `/v1/catalogue/scenes/${base.sceneId}/${base.version}`;
 const result = await app.api( path ); assert.equal( result.status, 200, JSON.stringify( result.body ) );
 assert.deepEqual( result.body, { sceneDefinition: app.preset.sceneDefinition, assets: app.preset.assets } );
 assert.match( result.headers.get( 'ETag' ), /^"[a-f0-9]{64}"$/ );
 assert.equal( ( await app.raw( path, { headers: { 'If-None-Match': result.headers.get( 'ETag' ) } } ) ).status, 304 );
 assert.equal( ( await app.api( '/v1/catalogue/scenes/unknown/1' ) ).status, 404 );
 const old = structuredClone( app.preset ); old.schemaVersion = 1; delete old.sceneDefinition; old.presetId = 'metadata-only'; old.baseScene.sceneId = 'metadata-scene';
 assert.equal( ( await app.publish( old ) ).status, 201 );
 assert.equal( ( await app.api( '/v1/catalogue/scenes/metadata-scene/fixture-1' ) ).status, 404 );
 await assert.rejects( app.db.prepare( 'UPDATE library_supported_scenes SET sha256=?' ).bind( '0'.repeat( 64 ) ).run(), /immutable supported scene/ );
 await assert.rejects( app.db.prepare( 'DELETE FROM library_supported_scenes' ).run(), /immutable supported scene/ );
 const row = await app.db.prepare( 'SELECT * FROM library_assets' ).first();
 await app.bucket.put( row.object_key, new Uint8Array( row.byte_length ), { sha256: sha( new Uint8Array( row.byte_length ) ) } );
 assert.equal( ( await app.api( path ) ).status, 503 );
 assert.equal( ( await app.raw( path, { headers: { 'If-None-Match': result.headers.get( 'ETag' ) } } ) ).status, 503 );
} );

test( 'competing supported definitions of one base scene commit exactly one complete publication', async t => {
 const app = await harness( t ); await app.seed();
 const other = structuredClone( app.preset ); other.presetId = 'other';
 const mapping = other.sceneDefinition.models[ 0 ].nodes[ 1 ];
 mapping.nodeId = 'different-stable-node'; other.snapshot.nodes[ mapping.instanceId ].nodeId = mapping.nodeId;
 const results = await Promise.all( [ app.publish(), app.publish( other ) ] );
 assert.deepEqual( results.map( item => item.status ).sort(), [ 201, 409 ], JSON.stringify( results ) );
 for ( const table of [ 'catalogue_presets', 'catalogue_operations', 'catalogue_heads', 'library_supported_scenes', 'library_base_scenes' ] ) assert.equal( ( await app.db.prepare( `SELECT count(*) AS count FROM ${table}` ).first() ).count, 1 );
} );

test( 'stale GLB mappings are rejected before a publication leaves any scene, preset, receipt or head', async t => {
 const app = await harness( t ); await app.seed();
 const stale = structuredClone( app.preset ); stale.sceneDefinition.models[ 0 ].nodes[ 1 ].expectedName = 'stale';
 const result = await app.publish( stale ); assert.equal( result.status, 422, JSON.stringify( result.body ) );
 assert.equal( result.body.error.code, 'UNSUPPORTED_SCENE_MODEL' );
 for ( const table of [ 'catalogue_presets', 'catalogue_operations', 'catalogue_heads', 'library_supported_scenes', 'library_base_scenes' ] ) assert.equal( ( await app.db.prepare( `SELECT count(*) AS count FROM ${table}` ).first() ).count, 0 );
} );

function replaceJSON( bytes, change ) {
 const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength ), length = view.getUint32( 12, true );
 const json = JSON.parse( new TextDecoder().decode( bytes.subarray( 20, 20 + length ) ) ); change( json );
 const text = JSON.stringify( json ), encoded = new TextEncoder().encode( text.padEnd( Math.ceil( new TextEncoder().encode( text ).length / 4 ) * 4, ' ' ) );
 const tail = bytes.subarray( 20 + length ), output = new Uint8Array( 20 + encoded.length + tail.length );
 output.set( bytes.subarray( 0, 20 ) ); output.set( encoded, 20 ); output.set( tail, 20 + encoded.length );
 const header = new DataView( output.buffer ); header.setUint32( 8, output.length, true ); header.setUint32( 12, encoded.length, true ); return output;
}

for ( const [ name, change ] of [ [ 'unsupported extension', json => { json.extensionsUsed = [ 'KHR_draco_mesh_compression' ]; } ], [ 'external URI', json => { json.buffers[ 0 ].uri = 'https://example.invalid/model.bin'; } ] ] ) test( `actual registered GLB with ${name} cannot publish supported capabilities`, async t => {
 const app = await harness( t );
 const asset = Object.values( app.preset.assets )[ 0 ], bytes = replaceJSON( app.contents[ asset.assetId ], change );
 asset.byteLength = bytes.length; asset.sha256 = sha( bytes );
 assert.equal( ( await app.upload( asset, bytes ) ).status, 201 );
 const result = await app.publish(); assert.equal( result.status, 422, JSON.stringify( result.body ) );
 assert.equal( result.body.error.code, 'UNSUPPORTED_SCENE_MODEL' );
 assert.equal( ( await app.db.prepare( 'SELECT count(*) AS count FROM catalogue_presets' ).first() ).count, 0 );
} );


test( 'LED display capabilities require an actual available glTF UV channel before publication', async t => {
 const app = await harness( t ); await app.seed();
 app.preset.snapshot.ledWalls = [ { wallId: 'wall', presentationVersion: 1, nodeInstanceId: 'led-instance-0', media: null, mode: 'freeze', inPointUs: 0, loop: false, playbackRate: 1, brightnessNits: 100, placement: { position: [ 0.5, 0.5 ], scale: [ 1, 1 ], rotationDegrees: 0, aspectRatioLocked: true, fitMode: 'contain' }, surface: { nativeCanvas: [ 16, 16 ], uvChannel: 3, uvBounds: [ 0, 1, 0, 1 ], flipU: false } } ];
 const result = await app.publish(); assert.equal( result.status, 422, JSON.stringify( result.body ) );
 assert.equal( result.body.error.code, 'UNSUPPORTED_SCENE_MODEL' );
 assert.equal( ( await app.db.prepare( 'SELECT count(*) AS count FROM catalogue_operations' ).first() ).count, 0 );
} );
