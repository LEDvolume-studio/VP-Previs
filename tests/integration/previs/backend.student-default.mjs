import assert from 'node:assert/strict';
import { randomBytes, randomUUID, pbkdf2Sync, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { studentFixture } from '../../unit/previs/studentFixtures.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const backend = fileURLToPath( new URL( '../../../backend/', import.meta.url ) );
const origin = 'http://localhost';
const password = randomUUID(), salt = randomBytes( 16 ), secret = randomBytes( 32 );
const verifier = `pbkdf2-sha256$1000$${salt.toString( 'base64url' )}$${pbkdf2Sync( password, salt, 1000, 32, 'sha256' ).toString( 'base64url' )}`;
let script, migrations;

before( async () => {
	// Inject a real R2 put failure before the publication can commit a version.
	script = ( await build( { stdin: { resolveDir: backend, contents: `
import app from './src/worker.js';
let failNext = false, holdRead = false, readReady = false;
export default { async fetch(request, env) {
 if (new URL(request.url).pathname === '/__test/fail-put') { failNext = true; return Response.json({ok:true}); }
 if (new URL(request.url).pathname === '/__test/hold-read') { holdRead = true; readReady = false; return Response.json({ok:true}); }
 if (new URL(request.url).pathname === '/__test/read-ready') return Response.json({ready:readReady});
 const bucket = env.DOCUMENTS;
 const wrapped = new Proxy(bucket, {get(target, key) {
  if (key === 'put') return async (...args) => { if (failNext) { failNext = false; throw Error('injected R2 outage'); } return target.put(...args); };
  if (key === 'get') return async (...args) => { const result = await target.get(...args); if (holdRead) { holdRead = false; readReady = true; await new Promise(resolve => setTimeout(resolve,1500)); } return result; };
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
 }});
 return app.fetch(request, {...env, DOCUMENTS: wrapped});
} };
` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[ 0 ].text;
	const names = ( await readdir( `${backend}migrations` ) ).filter( name => /^\d+_.*\.sql$/.test( name ) ).sort();
	migrations = await Promise.all( names.map( name => readFile( `${backend}migrations/${name}`, 'utf8' ) ) );
} );

async function harness( t ) {
	const instance = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', d1Databases: [ 'DB', 'ADMIN_AUTH_DB' ], r2Buckets: [ 'DOCUMENTS', 'NARRATION', 'LIBRARY' ], bindings: {
		ENVIRONMENT: 'test', ENABLE_DRAFT_API: 'true', ENABLE_CATALOGUE_API: 'true', ALLOW_LOCAL_GEO_EXEMPTION: 'true', ADMIN_PASSWORD_VERIFIER: verifier, ADMIN_SESSION_SECRET: secret.toString( 'base64url' ), ADMIN_SESSION_SECONDS: '3600', ADMIN_LOGIN_ATTEMPTS_PER_MINUTE: '30', MAX_JSON_BYTES: '1048576', MAX_LIBRARY_ASSET_BYTES: '67108864', MAX_NARRATION_BYTES: '1024', MAX_DRAFT_REVISIONS: '100', MAX_DRAFT_MEDIA: '5', MAX_DRAFT_CREATIONS_PER_MINUTE: '100'
	} } );
	t.after( () => instance.dispose() );
	const db = await instance.getD1Database( 'DB' ), auth = await instance.getD1Database( 'ADMIN_AUTH_DB' );
	for ( const sql of migrations ) await db.batch( splitSql( sql ).map( query => db.prepare( query ) ) );
	await auth.batch( splitSql( migrations[ 2 ] ).map( query => auth.prepare( query ) ) );
	const call = async ( path, { method = 'GET', body, token, cookie, key, match, headers = {} } = {} ) => {
		const response = await instance.dispatchFetch( `${origin}${path}`, { method, headers: { ...( body !== undefined ? { 'Content-Type': 'application/json' } : {} ), ...( cookie ? { Cookie: cookie } : {} ), ...( token ? { Authorization: `Bearer ${token}` } : {} ), ...( key ? { 'Idempotency-Key': key } : {} ), ...( match !== undefined ? { 'If-Match': `"${match}"` } : {} ), ...( ! [ 'GET', 'HEAD' ].includes( method ) ? { Origin: origin, 'Sec-Fetch-Site': 'same-origin' } : {} ), ...headers }, ...( body !== undefined ? { body: JSON.stringify( body ) } : {} ) } );
		return { status: response.status, headers: response.headers, body: await response.json() };
	};
	const login = await call( '/v1/admin/session', { method: 'POST', body: { password } } );
	assert.equal( login.status, 200, JSON.stringify( login.body ) );
	const cookie = login.headers.get( 'set-cookie' ).split( ';' )[ 0 ];
	const admin = ( path, options = {} ) => call( path, { ...options, cookie } );
	const createUser = async name => {
		const created = await admin( '/v1/admin/users', { method: 'POST', key: randomUUID(), body: { firstName: name, lastName: 'Student', graduationYear: 2030 } } );
		assert.equal( created.status, 201, JSON.stringify( created.body ) );
		const issued = await admin( `/v1/admin/users/${created.body.user.userId}/access-link`, { method: 'POST', key: randomUUID(), body: {} } );
		assert.equal( issued.status, 200, JSON.stringify( issued.body ) );
		return new URLSearchParams( new URL( issued.body.loginUrl ).hash.slice( 1 ) ).get( 'login' );
	};
	const stage = ( document, versionId = randomUUID(), key = randomUUID() ) => admin( '/v1/admin/student-default/versions', { method: 'POST', key, body: { versionId, document } } );
	const activate = ( versionId, match, key = randomUUID() ) => admin( '/v1/admin/student-default', { method: 'PUT', key, match, body: { versionId } } );
	const bootstrap = token => call( '/v1/student/bootstrap', { method: 'POST', token, key: randomUUID(), body: {} } );
	return { instance, db, call, admin, createUser, stage, activate, bootstrap, cookie };
}
const ok = r => assert.ok( r.status >= 200 && r.status < 300, JSON.stringify( r.body ) );

test( 'published versions are immutable, pinned across students, and independent of project edits', async t => {
	const a = await harness( t );
	const document = createStudentProjectDocument( { projectId: randomUUID(), name: 'Default one' } ), version = randomUUID();
	ok( await a.stage( document, version ) );
	ok( await a.activate( version, -1 ) );
	const preview = await a.admin( `/v1/admin/student-default/versions/${version}` ); ok( preview );
	assert.deepEqual( preview.body.document, document );
	const tokenA = await a.createUser( 'First' ), tokenB = await a.createUser( 'Second' );
	const first = await a.bootstrap( tokenA ), second = await a.bootstrap( tokenB ); ok( first ); ok( second );
	assert.equal( first.body.defaultVersionId, version ); assert.equal( second.body.defaultVersionId, version );
	assert.notEqual( first.body.project.projectId, second.body.project.projectId );
	const modified = { ...structuredClone( first.body.document ), name: 'First edit', revision: 1 };
	ok( await a.call( `/v1/student/projects/${modified.projectId}`, { method: 'PUT', token: tokenA, match: 0, key: randomUUID(), body: { document: modified } } ) );
	const other = await a.call( `/v1/student/projects/${second.body.project.projectId}`, { token: tokenB } ); ok( other );
	assert.deepEqual( other.body.document, second.body.document );
	assert.deepEqual( ( await a.admin( `/v1/admin/student-default/versions/${version}` ) ).body.document, document );
	const nextDoc = createStudentProjectDocument( { projectId: randomUUID(), name: 'Default two' } ), next = randomUUID();
	ok( await a.stage( nextDoc, next ) ); ok( await a.activate( next, 0 ) );
	const tokenC = await a.createUser( 'Third' ), third = await a.bootstrap( tokenC ); ok( third );
	assert.equal( third.body.defaultVersionId, next ); assert.equal( third.body.document.name, 'Default two' );
	const existing = await a.bootstrap( tokenB ); ok( existing ); assert.equal( existing.body.defaultVersionId, version );
	assert.deepEqual( existing.body.document, second.body.document );
	assert.equal( ( await a.activate( version, 0 ) ).status, 409 );
} );

test( 'failed staging and missing dependencies cannot replace the live default', async t => {
	const a = await harness( t ), document = createStudentProjectDocument( { projectId: randomUUID(), name: 'Stable' } ), version = randomUUID();
	ok( await a.stage( document, version ) ); ok( await a.activate( version, -1 ) );
	await a.call( '/__test/fail-put' );
	const failed = await a.stage( createStudentProjectDocument( { projectId: randomUUID(), name: 'Interrupted' } ) );
	assert.ok( failed.status >= 400, JSON.stringify( failed.body ) );
	const afterFailure = await a.admin( '/v1/admin/student-default' ); ok( afterFailure );
	assert.equal( afterFailure.body.versionId, version );
	const missing = studentFixture();
	const rejected = await a.stage( missing );
	assert.ok( rejected.status >= 400, JSON.stringify( rejected.body ) );
	const afterMissing = await a.admin( '/v1/admin/student-default' ); ok( afterMissing );
	assert.equal( afterMissing.body.versionId, version );
	const token = await a.createUser( 'Later' ), boot = await a.bootstrap( token ); ok( boot );
	assert.equal( boot.body.defaultVersionId, version );
} );

test( 'a default pointer change during bootstrap keeps the reserved project on one coherent version', async t => {

	const a = await harness( t ), firstVersion = randomUUID(), nextVersion = randomUUID();
	const firstDocument = createStudentProjectDocument( { projectId: randomUUID(), name: 'Pinned before race' } );
	const nextDocument = createStudentProjectDocument( { projectId: randomUUID(), name: 'Published during creation' } );
	ok( await a.stage( firstDocument, firstVersion ) ); ok( await a.activate( firstVersion, - 1 ) );
	ok( await a.stage( nextDocument, nextVersion ) );
	const firstToken = await a.createUser( 'Racing' );
	await a.call( '/__test/hold-read' );
	const pending = a.bootstrap( firstToken );
	for ( let attempt = 0; attempt < 100; attempt ++ ) {

		if ( ( await a.call( '/__test/read-ready' ) ).body.ready ) break;
		await new Promise( resolve => setTimeout( resolve, 10 ) );

	}
	assert.equal( ( await a.call( '/__test/read-ready' ) ).body.ready, true );
	ok( await a.activate( nextVersion, 0 ) );
	const first = await pending; ok( first );
	assert.equal( first.body.defaultVersionId, firstVersion );
	assert.equal( first.body.document.name, firstDocument.name );
	assert.equal( ( await a.db.prepare( 'SELECT default_version_id FROM student_bootstraps WHERE project_id=?' ).bind( first.body.project.projectId ).first() ).default_version_id, firstVersion );
	const later = await a.bootstrap( await a.createUser( 'Later' ) ); ok( later );
	assert.equal( later.body.defaultVersionId, nextVersion ); assert.equal( later.body.document.name, nextDocument.name );
	assert.deepEqual( ( await a.bootstrap( firstToken ) ).body.document, first.body.document );

} );

test( 'published default verifies its pinned scene and catalogue asset bytes on staging and preview', async t => {
	const a = await harness( t ), document = studentFixture(); document.projectId = randomUUID(); document.narration = { assets: {}, clips: [] };
	const bucket = await a.instance.getR2Bucket( 'LIBRARY' );
	let assetKey;
	for ( const asset of Object.values( document.assets ) ) {
		const bytes = Buffer.from( `verified ${asset.assetId} bytes` );
		asset.sha256 = createHash( 'sha256' ).update( bytes ).digest( 'hex' ); asset.byteLength = bytes.length;
		const key = `assets/${asset.assetId}/${asset.version}`; assetKey ||= key;
		await bucket.put( key, bytes, { sha256: asset.sha256, httpMetadata: { contentType: asset.mimeType } } );
		await a.db.prepare( 'INSERT INTO library_assets VALUES (?,?,?,?,?,?)' ).bind( asset.assetId, asset.version, JSON.stringify( asset ), key, asset.sha256, asset.byteLength ).run();
	}
	for ( const scene of Object.values( document.baseScenes ) ) {
		const definition = JSON.stringify( { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: scene, models: [], humanPoseRoots: [] } );
		await a.db.prepare( 'INSERT INTO library_base_scenes VALUES (?,?,?)' ).bind( scene.sceneId, scene.version, JSON.stringify( scene ) ).run();
		await a.db.prepare( 'INSERT INTO library_supported_scenes VALUES (?,?,?,?)' ).bind( scene.sceneId, scene.version, definition, createHash( 'sha256' ).update( definition ).digest( 'hex' ) ).run();
	}
	const version = randomUUID(); ok( await a.stage( document, version ) ); ok( await a.activate( version, -1 ) );
	const preview = await a.admin( `/v1/admin/student-default/versions/${version}` ); ok( preview );
	assert.deepEqual( preview.body.document, document );
	assert.equal( preview.body.dependencies.assets.length, Object.keys( document.assets ).length );
	assert.equal( preview.body.dependencies.scenes.length, Object.keys( document.baseScenes ).length );
	await bucket.put( assetKey, 'corrupted' );
	const corruptedPreview = await a.admin( `/v1/admin/student-default/versions/${version}` );
	assert.ok( corruptedPreview.status >= 400, JSON.stringify( corruptedPreview.body ) );
	const staged = await a.stage( document ); assert.ok( staged.status >= 400, JSON.stringify( staged.body ) );
} );

test( 'a published default preserves and independently copies verified narration even without timeline clips', async t => {
	const a = await harness( t ), token = await a.createUser( 'Narrator' );
	const source = createStudentProjectDocument( { projectId: randomUUID(), name: 'Audio default' } );
	ok( await a.call( '/v1/student/projects', { method: 'POST', token, key: randomUUID(), body: { projectId: source.projectId, document: source } } ) );
	const p = await a.db.prepare( 'SELECT draft_id FROM student_projects WHERE project_id=?' ).bind( source.projectId ).first();
	const bytes = Buffer.from( 'independent test narration' ), sha = createHash( 'sha256' ).update( bytes ).digest( 'hex' );
	const narration = await a.instance.getR2Bucket( 'NARRATION' ), objectKey = `fixture/${randomUUID()}`;
	await narration.put( objectKey, bytes, { sha256: sha, httpMetadata: { contentType: 'audio/webm' } } );
	await a.db.prepare( `INSERT INTO media_objects (draft_id,media_id,request_id,request_hash,object_key,sha256,byte_length,mime_type,state,created_at)
		VALUES (?,?,?,?,?,?,?,?, 'complete',?)` ).bind( p.draft_id, 'recording@1', randomUUID(), 'a'.repeat( 64 ), objectKey, sha, bytes.length, 'audio/webm', Date.now() ).run();
	const withAudio = structuredClone( source ); withAudio.revision = 1;
	withAudio.narration.assets[ 'recording@1' ] = { assetId: 'recording', version: '1', sha256: sha, byteLength: bytes.length, mimeType: 'audio/webm', codec: 'opus', sampleRate: 48000, channels: 1, durationSamples: 48000, segments: [ { index: 0, sha256: sha, byteLength: bytes.length } ] };
	ok( await a.call( `/v1/student/projects/${source.projectId}`, { method: 'PUT', token, match: 0, key: randomUUID(), body: { document: withAudio } } ) );
	const version = randomUUID();
	ok( await a.admin( '/v1/admin/student-default/versions', { method: 'POST', key: randomUUID(), body: { versionId: version, document: withAudio, sourceProjectId: source.projectId } } ) );
	ok( await a.activate( version, -1 ) );
	const current = await a.call( '/v1/student/default', { token } ); ok( current );
	assert.equal( current.body.versionId, version ); assert.deepEqual( current.body.version.document, withAudio );
	assert.equal( current.headers.get( 'cache-control' ), 'no-store' );
	assert.equal( ( await a.call( '/v1/student/default' ) ).status, 401 );
	assert.equal( ( await a.call( '/v1/student/default', { token: randomUUID() } ) ).status, 401 );
	const defaultAudio = await a.instance.dispatchFetch( `${origin}/v1/student/default/versions/${version}/narration/${sha}`, { headers: { Authorization: `Bearer ${token}` } } );
	assert.equal( defaultAudio.status, 200 ); assert.equal( defaultAudio.headers.get( 'cache-control' ), 'no-store' ); assert.deepEqual( Buffer.from( await defaultAudio.arrayBuffer() ), bytes );
	assert.equal( ( await a.instance.dispatchFetch( `${origin}/v1/student/default/versions/${version}/narration/${'0'.repeat( 64 )}`, { headers: { Authorization: `Bearer ${token}` } } ) ).status, 404 );
	const first = await a.createUser( 'AudioFirst' ), second = await a.createUser( 'AudioSecond' );
	const bootA = await a.bootstrap( first ), bootB = await a.bootstrap( second ); ok( bootA ); ok( bootB );
	assert.deepEqual( bootA.body.document.narration, withAudio.narration );
	assert.deepEqual( bootB.body.document.narration, withAudio.narration );
	for ( const [ credential, boot ] of [ [ first, bootA ], [ second, bootB ] ] ) {
		const response = await a.instance.dispatchFetch( `${origin}/v1/student/projects/${boot.body.project.projectId}/narration/recording%401/content`, { headers: { Authorization: `Bearer ${credential}` } } );
		assert.equal( response.status, 200 ); assert.deepEqual( Buffer.from( await response.arrayBuffer() ), bytes );
	}
	const rows = await a.db.prepare( 'SELECT object_key FROM media_objects WHERE media_id=?' ).bind( 'recording@1' ).all();
	assert.equal( new Set( rows.results.map( row => row.object_key ) ).size, rows.results.length );
	// The browser-export source need not already be an account-owned project.
	const uploaded = await a.instance.dispatchFetch( `${origin}/v1/admin/student-default/media/${sha}`, { method: 'PUT', headers: { Cookie: a.cookie, Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'audio/webm' }, body: bytes } );
	assert.ok( uploaded.ok, `media upload: ${uploaded.status} ${await uploaded.text()}` );
	const localVersion = randomUUID(); ok( await a.stage( withAudio, localVersion ) ); ok( await a.activate( localVersion, 0 ) );
	const unpublished = randomUUID(); ok( await a.stage( withAudio, unpublished ) );
	assert.equal( ( await a.instance.dispatchFetch( `${origin}/v1/student/default/versions/${unpublished}/narration/${sha}`, { headers: { Authorization: `Bearer ${token}` } } ) ).status, 404 );
	assert.equal( ( await a.call( '/v1/student/default', { token } ) ).body.versionId, localVersion );
	const oldAudio = await a.instance.dispatchFetch( `${origin}/v1/student/default/versions/${version}/narration/${sha}`, { headers: { Authorization: `Bearer ${token}` } } );
	assert.equal( oldAudio.status, 200 ); assert.deepEqual( Buffer.from( await oldAudio.arrayBuffer() ), bytes );
	const tokenHash = createHash( 'sha256' ).update( token ).digest( 'hex' );
	await a.db.prepare( "UPDATE student_users SET access_state='revoked', access_generation=access_generation+1 WHERE credential_hash=?" ).bind( tokenHash ).run();
	assert.equal( ( await a.call( '/v1/student/default', { token } ) ).status, 403 );
	assert.equal( ( await a.instance.dispatchFetch( `${origin}/v1/student/default/versions/${version}/narration/${sha}`, { headers: { Authorization: `Bearer ${token}` } } ) ).status, 403 );
	const third = await a.createUser( 'LocalSource' ), bootC = await a.bootstrap( third ); ok( bootC );
	const read = await a.instance.dispatchFetch( `${origin}/v1/student/projects/${bootC.body.project.projectId}/narration/recording%401/content`, { headers: { Authorization: `Bearer ${third}` } } );
	assert.equal( read.status, 200 ); assert.deepEqual( Buffer.from( await read.arrayBuffer() ), bytes );
} );
