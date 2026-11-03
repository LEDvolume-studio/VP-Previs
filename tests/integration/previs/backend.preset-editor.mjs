import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { studentFixture } from '../../unit/previs/studentFixtures.js';
import { createProjectDocument } from '../../../app/src/services/projects/ProjectSchema.js';
import { CloudAdminPresetRepository } from '../../../app/src/services/presets/CloudAdminPresetRepository.js';
import { StudentCatalogueClient } from '../../../app/src/previs/api/StudentCatalogueClient.js';
import { createBundledStudentSceneManifest } from '../../../app/src/previs/fixtures/BundledStudentScene.js';

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
	migrations = await Promise.all( [ '0001_drafts.sql', '0002_narration.sql', '0003_admin_password.sql', '0004_catalogue.sql', '0005_supported_scenes.sql', '0006_preset_editor.sql' ].map( name => readFile( `${root}backend/migrations/${name}`, 'utf8' ) ) );
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
	const save = (value, {key=randomUUID(), match, absent=match===undefined, admin=true}={}) => api(`/v1/admin/preset-editor/${value.studentPreset.presetId}`, {method:'PUT',admin,body:value,key,match,absent});
	const document = {name:preset.name,adminDocument:createProjectDocument({projectId:'source-project',name:'Admin source'}),studentPreset:preset};
	return { instance, raw, api, db, bucket: await instance.getR2Bucket( 'LIBRARY' ), cookie, preset, upload, seed, publish, contents,save,document };
}

test( 'editor routes require the shared admin session and trusted origin; public students never read admin documents', async t => {
	const app = await harness( t ); await app.seed();
	assert.equal( ( await app.api( '/v1/admin/preset-editor' ) ).status, 401 );
	assert.equal( ( await app.api( '/v1/admin/preset-editor/wide', { method: 'PUT', body: app.document, absent: true, key: randomUUID(), headers: { Origin: origin } } ) ).status, 401 );
	assert.equal( ( await app.api( '/v1/admin/preset-editor/wide', { method: 'PUT', admin: true, absent: true, key: randomUUID(), body: app.document, headers: { Origin: 'https://elsewhere.test' } } ) ).status, 403 );
	assert.equal( ( await app.save( app.document ) ).status, 201 );
	const publicPreset = await app.api( '/v1/catalogue/presets/wide/1' );
	assert.equal( publicPreset.status, 200 );
	assert.equal( publicPreset.body.adminDocument, undefined );
	assert.equal( JSON.stringify( publicPreset.body ).includes( 'source-project' ), false );
} );

test( 'one D1 commit saves editable scene and publishes detached student preset; renaming retains old versions', async t => {
	const app = await harness( t ); await app.seed();
	const saved = await app.save( app.document, { key: 'create' } );
	assert.equal( saved.status, 201, JSON.stringify( saved.body ) );
	assert.equal( saved.body.revision, 0 );
	assert.equal( saved.headers.get( 'ETag' ), '"0"' );
	assert.equal( saved.body.adminDocument.projectId, 'source-project' );
	assert.equal( ( await app.api( '/v1/admin/preset-editor', { admin: true } ) ).body.presets.length, 1 );
	assert.equal( ( await app.api( '/v1/admin/preset-editor/wide', { admin: true } ) ).body.name, 'Wide' );
	const renamed = structuredClone( app.document );
	renamed.name = 'Driver close-up'; renamed.studentPreset.name = renamed.name; renamed.studentPreset.version = '2';
	assert.equal( ( await app.save( renamed, { match: 0, key: 'rename' } ) ).status, 201 );
	assert.equal( ( await app.api( '/v1/catalogue' ) ).body.presets[ 0 ].name, renamed.name );
	assert.equal( ( await app.api( '/v1/catalogue/presets/wide/1' ) ).body.name, 'Wide' );
	assert.equal( ( await app.api( '/v1/admin/preset-editor/wide', { admin: true } ) ).body.revision, 1 );
	assert.equal( ( await app.db.prepare( 'SELECT count(*) AS n FROM preset_editor_revisions' ).first() ).n, 2 );
	const replay = await app.save( app.document, { key: 'create' } );
	assert.equal( replay.status, 200 ); assert.equal( replay.body.revision, 0 );
	assert.equal( ( await app.api( '/v1/catalogue' ) ).body.presets[ 0 ].version, '2' );
} );

test( 'concurrent editor saves have one successor; replay keys reject different content', async t => {
	const app = await harness( t ); await app.seed(); await app.save( app.document );
	const candidates = [ 'A', 'B' ].map( suffix => ( { ...structuredClone( app.document ), name: `View ${suffix}`, studentPreset: { ...app.preset, version: `2${suffix}`, name: `View ${suffix}` } } ) );
	const result = await Promise.all( candidates.map( body => app.save( body, { match: 0 } ) ) );
	assert.deepEqual( result.map( row => row.status ).sort(), [ 201, 409 ] );
	assert.equal( ( await app.db.prepare( 'SELECT count(*) AS n FROM preset_editor_revisions' ).first() ).n, 2 );
	const next = { ...app.document, studentPreset: { ...app.preset, version: '3' } };
	assert.equal( ( await app.save( next, { match: 1, key: 'same-key' } ) ).status, 201 );
	assert.equal( ( await app.save( { ...next, adminDocument: { ...next.adminDocument, name: 'Different scene' } }, { match: 1, key: 'same-key' } ) ).body.error.code, 'IDEMPOTENCY_CONFLICT' );
} );

test( 'invalid scenes, unverified assets and injected authoring failure cannot partially publish a student preset', async t => {
	const app = await harness( t );
	assert.equal( ( await app.save( app.document ) ).body.error.code, 'ASSET_NOT_VERIFIED' );
	await app.seed();
	assert.equal( ( await app.save( { ...app.document, adminDocument: {} } ) ).body.error.code, 'INVALID_ADMIN_DOCUMENT' );
	assert.equal( ( await app.save( { ...app.document, name: 'Mismatched name' } ) ).body.error.code, 'IDENTITY_MISMATCH' );
	await app.db.prepare( `CREATE TRIGGER inject_editor_failure BEFORE INSERT ON preset_editor_revisions BEGIN SELECT RAISE(ABORT,'injected authoring failure'); END` ).run();
	assert.equal( ( await app.save( app.document ) ).status, 500 );
	for ( const name of [ 'catalogue_heads', 'catalogue_presets', 'catalogue_operations', 'preset_editor_revisions' ] ) assert.equal( ( await app.db.prepare( `SELECT count(*) AS n FROM ${name}` ).first() ).n, 0 );
	await app.db.prepare( 'DROP TRIGGER inject_editor_failure' ).run();
	assert.equal( ( await app.save( app.document ) ).status, 201 );
	await assert.rejects( app.db.prepare( 'UPDATE preset_editor_revisions SET record_json=?' ).bind( '{}' ).run(), /immutable preset editor revision/ );
} );

test( 'explicit hosted catalogue activation permits shared preset data while private draft backup stays disabled', async t => {
	const iterations = 600000;
	const hostedVerifier = `pbkdf2-sha256$${iterations}$${salt.toString( 'base64url' )}$${pbkdf2Sync( password, salt, iterations, 32, 'sha256' ).toString( 'base64url' )}`;
	const app = await harness( t, { bindings: { ENVIRONMENT: 'production', ENABLE_HOSTED_ADMIN_AUTH: 'true', ENABLE_HOSTED_CATALOGUE_API: 'true', ENABLE_DRAFT_API: 'false', ADMIN_PASSWORD_VERIFIER: hostedVerifier } } );
	await app.seed();
	assert.equal( ( await app.save( app.document ) ).status, 201 );
	assert.equal( ( await app.api( '/v1/catalogue' ) ).body.presets.length, 1 );
	assert.equal( ( await app.api( '/v1/drafts', { method: 'POST', body: {} } ) ).status, 503 );
} );

test( 'actual cloud admin and anonymous student clients share durable D1 presets, R2 thumbnails and historical scene definitions', async t => {
	const app = await harness( t, { bindings: { MAX_LIBRARY_ASSET_BYTES: '67108864', MAX_JSON_BYTES: '3145728' } } );
	const manifest = createBundledStudentSceneManifest( { models: [ 'led' ] } );
	const preset = structuredClone( app.preset );
	preset.schemaVersion = 2; preset.assets = manifest.assets; preset.baseScene = manifest.baseScene;
	preset.sceneDefinition = { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: manifest.baseScene, models: manifest.models.map( ( { asset, nodes } ) => ( { asset, nodes } ) ), humanPoseRoots: [] };
	preset.snapshot.nodes = Object.fromEntries( preset.sceneDefinition.models[ 0 ].nodes.map( node => [ node.instanceId, { asset: preset.sceneDefinition.models[ 0 ].asset, nodeId: node.nodeId, transform: { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], visible: true }, humanPose: null, doorAngles: {} } ] ) );
	preset.snapshot.ledWalls = [];
	preset.snapshot.rasterAppearance = { version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb', enableEnvironment: false, showBackground: true, transparentBackground: false, backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#000000' };
	const model = Object.values( manifest.assets )[ 0 ];
	const assetBlobs = [ { asset: model, blob: new Blob( [ await readFile( `${root}app/public/models/led/main-led-volume-wall.glb` ) ], { type: model.mimeType } ) } ];
	const thumbnail = new Blob( [ Uint8Array.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ) ], { type: 'image/png' } );
	const authenticatedFetch = ( url, options = {} ) => app.instance.dispatchFetch( url, { ...options, headers: { ...options.headers, Cookie: app.cookie, Origin: origin } } );
	const anonymousFetch = ( url, options ) => app.instance.dispatchFetch( url, options );
	const repository = new CloudAdminPresetRepository( { baseURL: origin, origin, fetch: authenticatedFetch, channelFactory: () => null } );
	t.after( () => repository.close() );
	const student = new StudentCatalogueClient( { baseURL: origin, origin, fetch: anonymousFetch } );
	const input = { presetId: 'cloud-camera', name: 'Driver', adminDocument: app.document.adminDocument, studentPreset: preset, assetBlobs, thumbnail };
	const saved = await repository.save( input, { expectedRevision: null } );
	assert.equal( saved.revision, 0 );
	assert.equal( saved.thumbnail.size, thumbnail.size );
	assert.equal( ( await student.list() ).presets[ 0 ].name, 'Driver' );
	const portable = await student.getPreset( { presetId: saved.presetId, version: '1' } );
	assert.equal( portable.adminDocument, undefined );
	assert.equal( ( await student.getAssetBytes( portable.assets[ `${portable.thumbnail.assetId}@${portable.thumbnail.version}` ] ) ).byteLength, thumbnail.size );
	const renamed = await repository.rename( saved.presetId, 'Driver close-up', { expectedRevision: 0 } );
	assert.equal( renamed.revision, 1 );
	assert.equal( ( await student.list() ).presets[ 0 ].name, 'Driver close-up' );
	assert.equal( ( await student.getPreset( { presetId: saved.presetId, version: '1' } ) ).name, 'Driver' );
	await assert.rejects( repository.save( { ...saved, name: 'Stale write' }, { expectedRevision: 0 } ), error => error.code === 'REVISION_CONFLICT' );
	const changedInventory = structuredClone( renamed );
	changedInventory.studentPreset.baseScene.version = 'next';
	changedInventory.studentPreset.sceneDefinition.baseScene.version = 'next';
	await repository.save( changedInventory, { expectedRevision: 1 } );
	const historical = await student.getScene( { sceneId: manifest.baseScene.sceneId, version: manifest.baseScene.version } );
	assert.deepEqual( historical.sceneDefinition, preset.sceneDefinition );
	assert.equal( ( await repository.list() )[ 0 ].revision, 2 );
	const reopened = new CloudAdminPresetRepository( { baseURL: origin, origin, fetch: authenticatedFetch, channelFactory: () => null } );
	t.after( () => reopened.close() );
	assert.equal( ( await reopened.get( saved.presetId ) ).name, 'Driver close-up' );
	const oversized = { ...app.document, studentPreset: { ...preset, presetId: 'wide' }, adminDocument: { ...app.document.adminDocument, extensions: { metadata: 'x'.repeat( 1900001 ) } } };
	assert.equal( ( await app.save( oversized ) ).body.error.code, 'PRESET_RECORD_TOO_LARGE' );
	assert.equal( ( await app.api( '/v1/admin/preset-editor/wide', { admin: true } ) ).status, 404 );
} );

test( 'compact editor summaries keep six large scene records within a small list bound and exclude hidden heads', async t => {
	const app = await harness( t, { bindings: { MAX_JSON_BYTES: '1048576' } } ); await app.seed();
	for ( let index = 0; index < 6; index ++ ) {
		const body = structuredClone( app.document );
		body.name = `Camera ${index}`; body.studentPreset.name = body.name; body.studentPreset.presetId = `camera-${index}`;
		body.adminDocument.extensions = { sceneMetadata: 'x'.repeat( 200000 ) };
		assert.equal( ( await app.save( body ) ).status, 201 );
	}
	assert.equal( ( await app.api( '/v1/admin/preset-editor', { admin: true } ) ).status, 503 );
	const summaries = await app.api( '/v1/admin/preset-editor?summary=1', { admin: true } );
	assert.equal( summaries.status, 200 ); assert.equal( summaries.body.presets.length, 6 );
	assert.ok( JSON.stringify( summaries.body ).length < 4096 );
	assert.deepEqual( Object.keys( summaries.body.presets[ 0 ] ).sort(), [ 'createdAt', 'name', 'presetId', 'revision', 'thumbnailAsset', 'updatedAt' ] );
	assert.equal( summaries.body.presets[ 0 ].adminDocument, undefined );
	assert.equal( summaries.body.presets[ 0 ].studentPreset, undefined );
	assert.equal( ( await app.api( '/v1/admin/catalogue/presets/camera-0/availability', { method: 'POST', admin: true, key: randomUUID(), match: 0, body: { version: '1', available: false } } ) ).status, 200 );
	assert.equal( ( await app.api( '/v1/admin/preset-editor?summary=1', { admin: true } ) ).body.presets.length, 5 );
} );


test( 'shared starting project is validated and publicly readable without exposing other bucket objects', async t => {
	const app = await harness( t );
	assert.equal( ( await app.raw( '/v1/student/starting-project' ) ).status, 404 );
	const document = studentFixture();
	await app.bucket.put( 'student/shared-starting-project.json', JSON.stringify( document ) );
	const response = await app.raw( '/v1/student/starting-project' );
	assert.equal( response.status, 200 );
	assert.deepEqual( await response.json(), document );
	assert.equal( ( await app.raw( '/v1/student/starting-project', { method: 'PUT' } ) ).status, 405 );
	await app.bucket.put( 'student/shared-starting-project.json', '{}' );
	assert.equal( ( await app.raw( '/v1/student/starting-project' ) ).status, 503 );
} );
