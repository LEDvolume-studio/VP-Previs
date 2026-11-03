import assert from 'node:assert/strict';
import { randomBytes, randomUUID, pbkdf2Sync, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const backend = fileURLToPath( new URL( '../../../backend/', import.meta.url ) );
const origin = 'http://localhost';
const password = randomUUID(), salt = randomBytes( 16 ), secret = randomBytes( 32 );
const verifier = `pbkdf2-sha256$1000$${salt.toString( 'base64url' )}$${pbkdf2Sync( password, salt, 1000, 32, 'sha256' ).toString( 'base64url' )}`;
const hash = data => createHash( 'sha256' ).update( data ).digest( 'hex' );
let script, migrations;

before( async () => {
	// Exercise the actual Worker. The test-only wrapper delays one R2 put after
	// authentication and upload, letting the test revoke before D1 head commit.
	script = ( await build( { stdin: { resolveDir: backend, contents: `
import app from './src/worker.js';
let armed = false, mediaArmed = false, ready = false;
export default { async fetch(request, env) {
 const path = new URL(request.url).pathname;
 if (path === '/__test/arm') { armed = true; ready = false; return Response.json({ok:true}); }
 if (path === '/__test/ready') return Response.json({ready});
 if (path === '/__test/arm-media') { mediaArmed = true; ready = false; return Response.json({ok:true}); }
 const bucket = env.DOCUMENTS;
 const wrapped = new Proxy(bucket, {get(target, key) {
  if (key === 'put') return async (...args) => {
   const result = await target.put(...args);
   if (armed) { armed = false; ready = true; await new Promise(resolve => setTimeout(resolve, 1500)); }
   return result;
  };
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
 }});
 const media = new Proxy(env.NARRATION, {get(target, key) {
  if (key === 'get') return async (...args) => {
   const result = await target.get(...args);
   if (mediaArmed) { mediaArmed = false; ready = true; await new Promise(resolve => setTimeout(resolve, 1500)); }
   return result;
  };
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
 }});
 return app.fetch(request, {...env, DOCUMENTS: wrapped, NARRATION: media});
} };
` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[ 0 ].text;
	const names = ( await readdir( `${backend}migrations` ) ).filter( name => /^\d+_.*\.sql$/.test( name ) ).sort();
	migrations = await Promise.all( names.map( name => readFile( `${backend}migrations/${name}`, 'utf8' ) ) );
} );

async function harness( t ) {
	const instance = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', d1Databases: [ 'DB', 'ADMIN_AUTH_DB' ], r2Buckets: [ 'DOCUMENTS', 'NARRATION', 'LIBRARY' ], bindings: {
		ENVIRONMENT: 'test', ENABLE_DRAFT_API: 'true', ENABLE_CATALOGUE_API: 'true', ALLOW_LOCAL_GEO_EXEMPTION: 'true', ADMIN_PASSWORD_VERIFIER: verifier, ADMIN_SESSION_SECRET: secret.toString( 'base64url' ), ADMIN_SESSION_SECONDS: '3600', ADMIN_LOGIN_ATTEMPTS_PER_MINUTE: '30', MAX_JSON_BYTES: '65536', MAX_NARRATION_BYTES: '1024', MAX_DRAFT_REVISIONS: '100', MAX_DRAFT_MEDIA: '5', MAX_DRAFT_CREATIONS_PER_MINUTE: '100'
	} } );
	t.after( () => instance.dispose() );
	const db = await instance.getD1Database( 'DB' ), auth = await instance.getD1Database( 'ADMIN_AUTH_DB' );
	const documents = await instance.getR2Bucket( 'DOCUMENTS' );
	for ( const sql of migrations ) await db.batch( splitSql( sql ).map( query => db.prepare( query ) ) );
	await auth.batch( splitSql( migrations[ 2 ] ).map( query => auth.prepare( query ) ) );
	const defaultDocument = createStudentProjectDocument( { name: 'Pinned starter', projectId: randomUUID() } );
	const bytes = JSON.stringify( defaultDocument ), sha = hash( bytes ), objectKey = `defaults/${randomUUID()}.json`, version = randomUUID();
	await documents.put( objectKey, bytes, { sha256: sha, httpMetadata: { contentType: 'application/json' } } );
	await db.prepare( "INSERT INTO object_reservations VALUES (?, 'pending', ?)" ).bind( objectKey, Date.now() ).run();
	await db.prepare( 'INSERT INTO student_default_versions VALUES (?,?,?,?,?,?)' ).bind( version, objectKey, sha, Buffer.byteLength( bytes ), '[]', Date.now() ).run();
	await db.prepare( 'INSERT INTO student_default_head VALUES (1,?,0,?)' ).bind( version, Date.now() ).run();
	const call = async ( path, { method = 'GET', body, token, cookie, key, match, headers = {} } = {} ) => {
		const response = await instance.dispatchFetch( `${origin}${path}`, { method, headers: { ...( body !== undefined ? { 'Content-Type': 'application/json' } : {} ), ...( cookie ? { Cookie: cookie } : {} ), ...( token ? { Authorization: `Bearer ${token}` } : {} ), ...( key ? { 'Idempotency-Key': key } : {} ), ...( match !== undefined ? { 'If-Match': `"${match}"` } : {} ), ...( ! [ 'GET', 'HEAD' ].includes( method ) ? { Origin: origin, 'Sec-Fetch-Site': 'same-origin' } : {} ), ...headers }, ...( body !== undefined ? { body: JSON.stringify( body ) } : {} ) } );
		return { status: response.status, headers: response.headers, body: await response.json() };
	};
	const login = await call( '/v1/admin/session', { method: 'POST', body: { password } } );
	assert.equal( login.status, 200, JSON.stringify( login.body ) );
	const cookie = login.headers.get( 'set-cookie' ).split( ';' )[ 0 ];
	const admin = ( path, options = {} ) => call( path, { ...options, cookie } );
	const createUser = async name => {
		const result = await admin( '/v1/admin/users', { method: 'POST', key: randomUUID(), body: { firstName: name, lastName: 'Student', graduationYear: 2030 } } );
		assert.equal( result.status, 201, JSON.stringify( result.body ) );
		const user = result.body.user;
		const issued = await admin( `/v1/admin/users/${user.userId}/access-link`, { method: 'POST', key: randomUUID(), body: {} } );
		assert.equal( issued.status, 200, JSON.stringify( issued.body ) );
		return { user, token: new URLSearchParams( new URL( issued.body.loginUrl ).hash.slice( 1 ) ).get( 'login' ) };
	};
	const bootstrap = ( token, key = randomUUID() ) => call( '/v1/student/bootstrap', { method: 'POST', token, key, body: {} } );
	const create = ( token, document, key = randomUUID() ) => call( '/v1/student/projects', { method: 'POST', token, key, body: { projectId: document.projectId, document } } );
	const update = ( token, document, match = 0, key = randomUUID() ) => call( `/v1/student/projects/${document.projectId}`, { method: 'PUT', token, key, match, body: { document } } );
	return { instance, db, documents, call, admin, createUser, bootstrap, create, update, version, defaultDocument };
}
const edit = ( doc, name, revision = 1 ) => ( { ...structuredClone( doc ), name, revision, updatedAt: new Date().toISOString() } );
const ok = result => assert.ok( result.status >= 200 && result.status < 300, JSON.stringify( result ) );

test( 'concurrent bootstrap and lost response converge on one pinned starter and independent owners', async t => {
	const a = await harness( t );
	const first = await a.createUser( 'First' ), second = await a.createUser( 'Second' );
	const lostKey = randomUUID();
	const [ one, two ] = await Promise.all( [ a.bootstrap( first.token, lostKey ), a.bootstrap( first.token ) ] );
	ok( one ); ok( two );
	assert.equal( one.body.project.projectId, two.body.project.projectId );
	assert.equal( one.body.defaultVersionId, a.version );
	assert.equal( one.body.project.serverRevision, 0 );
	assert.equal( one.body.document.projectId, one.body.project.projectId );
	const retry = await a.bootstrap( first.token, lostKey ); ok( retry );
	assert.equal( retry.body.project.projectId, one.body.project.projectId );
	const other = await a.bootstrap( second.token ); ok( other );
	assert.notEqual( other.body.project.projectId, one.body.project.projectId );
	assert.equal( ( await a.db.prepare( 'SELECT count(*) AS n FROM student_projects WHERE user_id=?' ).bind( first.user.userId ).first() ).n, 1 );
	const fromFreshClient = await a.call( '/v1/student/projects', { token: first.token } ); ok( fromFreshClient );
	assert.deepEqual( fromFreshClient.body.items.map( p => p.projectId ), [ one.body.project.projectId ] );
	const admin = await a.admin( `/v1/admin/users/${first.user.userId}/projects` ); ok( admin );
	assert.deepEqual( admin.body.items.map( p => p.projectId ), [ one.body.project.projectId ] );
	const adminRead = await a.admin( `/v1/admin/projects/${one.body.project.projectId}` ); ok( adminRead );
	assert.deepEqual( adminRead.body.document, one.body.document );
	const crossRead = await a.call( `/v1/student/projects/${one.body.project.projectId}`, { token: second.token } );
	assert.equal( crossRead.status, 404 );
	assert.equal( ( await a.call( `/v1/student/projects/${one.body.project.projectId}/revisions/0`, { token: second.token } ) ).status, 404 );
	assert.equal( ( await a.call( `/v1/student/projects/${one.body.project.projectId}/narration/recording%401/content`, { token: second.token } ) ).status, 404 );
} );

test( 'revision-zero creation, exact replay, competing heads and independent duplicate', async t => {
	const a = await harness( t ), owner = await a.createUser( 'Owner' ), stranger = await a.createUser( 'Stranger' );
	const doc = createStudentProjectDocument( { projectId: randomUUID(), name: 'New' } ), createKey = randomUUID();
	const concurrent = await Promise.all( [ a.create( owner.token, doc, createKey ), a.create( owner.token, doc, createKey ) ] );
	concurrent.forEach( ok );
	const created = concurrent[ 0 ];
	assert.equal( created.body.serverRevision, 0 );
	const replay = await a.create( owner.token, doc, createKey ); ok( replay );
	assert.equal( replay.body.serverRevision, 0 );
	assert.equal( ( await a.create( owner.token, edit( doc, 'different' ), createKey ) ).status, 409 );
	assert.equal( ( await a.create( stranger.token, doc ) ).status, 409 );
	const first = edit( doc, 'First edit' ), second = edit( doc, 'Second edit' );
	const key1 = randomUUID(), key2 = randomUUID();
	const writes = await Promise.all( [ a.update( owner.token, first, 0, key1 ), a.update( owner.token, second, 0, key2 ) ] );
	assert.deepEqual( writes.map( r => r.status ).sort(), [ 200, 409 ] );
	const winner = writes[ 0 ].status === 200 ? first : second, winnerKey = writes[ 0 ].status === 200 ? key1 : key2;
	const again = await a.update( owner.token, winner, 0, winnerKey ); ok( again );
	assert.equal( again.body.serverRevision, 1 );
	const duplicateId = randomUUID();
	const duplicate = await a.call( `/v1/student/projects/${doc.projectId}/duplicate`, { method: 'POST', token: owner.token, key: randomUUID(), body: { projectId: duplicateId, sourceServerRevision: 1 } } ); ok( duplicate );
	const copied = await a.call( `/v1/student/projects/${duplicateId}`, { token: owner.token } ); ok( copied );
	assert.equal( copied.body.project.serverRevision, 0 );
	assert.equal( copied.body.document.projectId, duplicateId );
	assert.equal( copied.body.document.name, winner.name );
	const changed = edit( copied.body.document, 'Copy changed', copied.body.document.revision + 1 );
	ok( await a.update( owner.token, changed ) );
	const original = await a.call( `/v1/student/projects/${doc.projectId}`, { token: owner.token } ); ok( original );
	assert.deepEqual( original.body.document, winner );
} );

test( 'pagination, conditional metadata and archive races retain ownership and prevent resurrection', async t => {
	const a = await harness( t ), owner = await a.createUser( 'Owner' ), other = await a.createUser( 'Other' );
	const docs = Array.from( { length: 3 }, ( _, i ) => createStudentProjectDocument( { projectId: randomUUID(), name: `Project ${i}` } ) );
	for ( const doc of docs ) ok( await a.create( owner.token, doc ) );
	const first = await a.call( '/v1/student/projects?limit=2', { token: owner.token } ); ok( first );
	assert.equal( first.body.items.length, 2 ); assert.ok( first.body.nextCursor );
	const next = await a.call( `/v1/student/projects?limit=2&cursor=${encodeURIComponent( first.body.nextCursor )}`, { token: owner.token } ); ok( next );
	assert.equal( new Set( [ ...first.body.items, ...next.body.items ].map( p => p.projectId ) ).size, 3 );
	const path = `/v1/student/projects/${docs[ 0 ].projectId}/metadata`;
	const patch = ( token, body, match, key = randomUUID() ) => a.call( path, { method: 'PATCH', token, key, match, body } );
	assert.equal( ( await patch( other.token, { name: 'Stolen' }, 0 ) ).status, 404 );
	const race = await Promise.all( [ patch( owner.token, { name: 'Renamed' }, 0 ), patch( owner.token, { archived: true }, 0 ) ] );
	assert.deepEqual( race.map( r => r.status ).sort(), [ 200, 409 ] );
	const read = await a.call( `/v1/student/projects/${docs[ 0 ].projectId}`, { token: owner.token } ); ok( read );
	if ( ! read.body.project.archived ) ok( await patch( owner.token, { archived: true }, read.body.project.metadataRevision ) );
	const blocked = await a.update( owner.token, edit( docs[ 0 ], 'Offline edit' ) );
	assert.equal( blocked.status, 409 );
	assert.equal( blocked.body.error.code, 'PROJECT_ARCHIVED' );
	const archived = await a.call( `/v1/student/projects/${docs[ 0 ].projectId}`, { token: owner.token } ); ok( archived );
	assert.equal( archived.body.project.archived, true );
	ok( await patch( owner.token, { archived: false }, archived.body.project.metadataRevision ) );
	ok( await a.update( owner.token, edit( docs[ 0 ], 'After restore' ) ) );
} );

test( 'actual document write cannot commit after concurrent revocation', async t => {
	const a = await harness( t ), owner = await a.createUser( 'Race' );
	const doc = createStudentProjectDocument( { projectId: randomUUID(), name: 'Original' } ); ok( await a.create( owner.token, doc ) );
	await a.call( '/__test/arm' );
	const pending = a.update( owner.token, edit( doc, 'Must not commit' ) );
	let ready = false;
	for ( let attempt = 0; attempt < 100 && ! ready; attempt ++ ) {
		ready = ( await a.call( '/__test/ready' ) ).body.ready;
		if ( ! ready ) await new Promise( resolve => setTimeout( resolve, 10 ) );
	}
	assert.equal( ready, true, 'actual document upload reached the post-authorization barrier' );
	ok( await a.admin( `/v1/admin/users/${owner.user.userId}`, { method: 'PATCH', key: randomUUID(), body: { active: false } } ) );
	const denied = await pending;
	assert.ok( denied.status >= 400, JSON.stringify( denied ) );
	const admin = await a.admin( `/v1/admin/projects/${doc.projectId}` ); ok( admin );
	assert.equal( admin.body.project.serverRevision, 0 );
	assert.deepEqual( admin.body.document, doc );
} );

test( 'archive committed during an upload blocks the offline edit without restoring the project', async t => {
	const a = await harness( t ), owner = await a.createUser( 'Archive race' );
	const doc = createStudentProjectDocument( { projectId: randomUUID(), name: 'Before archive' } ); ok( await a.create( owner.token, doc ) );
	await a.call( '/__test/arm' );
	const pending = a.update( owner.token, edit( doc, 'Offline edit' ) );
	let ready = false;
	for ( let attempt = 0; attempt < 100 && ! ready; attempt ++ ) {
		ready = ( await a.call( '/__test/ready' ) ).body.ready;
		if ( ! ready ) await new Promise( resolve => setTimeout( resolve, 10 ) );
	}
	assert.equal( ready, true );
	ok( await a.call( `/v1/student/projects/${doc.projectId}/metadata`, { method: 'PATCH', token: owner.token, key: randomUUID(), match: 0, body: { archived: true } } ) );
	const blocked = await pending;
	assert.equal( blocked.status, 409 );
	assert.equal( blocked.body.error.code, 'PROJECT_ARCHIVED' );
	const read = await a.call( `/v1/student/projects/${doc.projectId}`, { token: owner.token } ); ok( read );
	assert.equal( read.body.project.archived, true );
	assert.equal( read.body.project.serverRevision, 0 );
	assert.deepEqual( read.body.document, doc );
} );

test( 'completed narration is readable by its owner and admin but not another student', async t => {
	const a = await harness( t ), owner = await a.createUser( 'Audio' ), stranger = await a.createUser( 'Stranger' );
	const doc = createStudentProjectDocument( { projectId: randomUUID(), name: 'Audio project' } ); ok( await a.create( owner.token, doc ) );
	const project = await a.db.prepare( 'SELECT draft_id FROM student_projects WHERE project_id=?' ).bind( doc.projectId ).first();
	const bytes = Buffer.from( 'verified narration fixture' ), sha = hash( bytes ), objectKey = `audio/${randomUUID()}`;
	const bucket = await a.instance.getR2Bucket( 'NARRATION' );
	await bucket.put( objectKey, bytes, { sha256: sha, httpMetadata: { contentType: 'audio/webm' } } );
	await a.db.prepare( `INSERT INTO media_objects (draft_id,media_id,request_id,request_hash,object_key,sha256,byte_length,mime_type,state,created_at)
		VALUES (?,? ,?,?,?, ?,?,?,'complete',?)` ).bind( project.draft_id, 'recording@1', randomUUID(), 'a'.repeat( 64 ), objectKey, sha, bytes.length, 'audio/webm', Date.now() ).run();
	const path = `/v1/student/projects/${doc.projectId}/narration/recording%401/content`;
	const read = ( url, headers ) => a.instance.dispatchFetch( `${origin}${url}`, { headers } );
	const owned = await read( path, { Authorization: `Bearer ${owner.token}` } );
	assert.equal( owned.status, 200 ); assert.deepEqual( Buffer.from( await owned.arrayBuffer() ), bytes );
	const denied = await read( path, { Authorization: `Bearer ${stranger.token}` } ); assert.equal( denied.status, 404 );
	// Use the existing admin session rather than any student credential.
	const login = await a.call( '/v1/admin/session', { method: 'POST', body: { password } } );
	const cookie = login.headers.get( 'set-cookie' ).split( ';' )[ 0 ];
	const admin = await read( `/v1/admin/projects/${doc.projectId}/narration/recording%401/content`, { Cookie: cookie } );
	assert.equal( admin.status, 200 ); assert.deepEqual( Buffer.from( await admin.arrayBuffer() ), bytes );
	const withAudio = edit( doc, 'With audio' );
	withAudio.narration.assets[ 'recording@1' ] = { assetId: 'recording', version: '1', sha256: sha, byteLength: bytes.length, mimeType: 'audio/webm', codec: 'opus', sampleRate: 48000, channels: 1, durationSamples: 48000, segments: [ { index: 0, sha256: sha, byteLength: bytes.length } ] };
	await bucket.put( objectKey, 'corrupted audio' );
	const corrupt = await a.update( owner.token, withAudio );
	assert.ok( corrupt.status >= 400, JSON.stringify( corrupt ) );
	const unchanged = await a.call( `/v1/student/projects/${doc.projectId}`, { token: owner.token } ); ok( unchanged );
	assert.equal( unchanged.body.project.serverRevision, 0 );
	await bucket.put( objectKey, bytes, { sha256: sha, httpMetadata: { contentType: 'audio/webm' } } );
	const saved = await a.update( owner.token, withAudio ); ok( saved );
	const duplicateId = randomUUID();
	ok( await a.call( `/v1/student/projects/${doc.projectId}/duplicate`, { method: 'POST', token: owner.token, key: randomUUID(), body: { projectId: duplicateId, sourceServerRevision: 1 } } ) );
	const copied = await read( `/v1/student/projects/${duplicateId}/narration/recording%401/content`, { Authorization: `Bearer ${owner.token}` } );
	assert.equal( copied.status, 200 ); assert.deepEqual( Buffer.from( await copied.arrayBuffer() ), bytes );
	const duplicateDocument = await a.call( `/v1/student/projects/${duplicateId}`, { token: owner.token } ); ok( duplicateDocument );
	assert.deepEqual( duplicateDocument.body.document.narration, withAudio.narration );
} );

test( 'revision-zero audio reservation is resumable and media completion is fenced by revocation', async t => {
	const a = await harness( t ), owner = await a.createUser( 'Recording' );
	const doc = createStudentProjectDocument( { projectId: randomUUID(), name: 'Recorded' } );
	const bytes = Buffer.from( 'revision zero audio' ), sha = hash( bytes );
	doc.narration.assets[ 'recording@1' ] = { assetId: 'recording', version: '1', sha256: sha, byteLength: bytes.length, mimeType: 'audio/webm;codecs=opus', codec: 'opus', sampleRate: 48000, channels: 1, durationSamples: 48000, segments: [ { index: 0, sha256: sha, byteLength: bytes.length } ] };
	const key = randomUUID(), body = { projectId: doc.projectId, document: doc };
	ok( await a.call( `/v1/student/projects/${doc.projectId}/reservation`, { method: 'POST', token: owner.token, key, body } ) );
	const metadata = { mediaId: 'recording@1', sha256: sha, byteLength: bytes.length, mimeType: 'audio/webm;codecs=opus' }, mediaKey = randomUUID();
	const initiate = () => a.call( `/v1/student/projects/${doc.projectId}/narration`, { method: 'POST', token: owner.token, key: mediaKey, body: metadata } );
	const reserved = await initiate(); ok( reserved ); assert.equal( reserved.body.state, 'pending' );
	assert.equal( ( await initiate() ).body.uploadPath, reserved.body.uploadPath );
	const alternateKey = randomUUID();
	const sameMedia = await a.call( `/v1/student/projects/${doc.projectId}/narration`, { method: 'POST', token: owner.token, key: alternateKey, body: metadata } ); ok( sameMedia );
	assert.equal( sameMedia.body.uploadPath, reserved.body.uploadPath );
	const reusedKey = await a.call( `/v1/student/projects/${doc.projectId}/narration`, { method: 'POST', token: owner.token, key: alternateKey, body: { ...metadata, mediaId: 'other@1' } } );
	assert.equal( reusedKey.status, 409 );
	const upload = () => a.instance.dispatchFetch( `${origin}${reserved.body.uploadPath}`, { method: 'PUT', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': metadata.mimeType }, body: bytes } );
	assert.equal( ( await upload() ).status, 200 ); assert.equal( ( await upload() ).status, 200 );
	const complete = () => a.call( reserved.body.completePath, { method: 'POST', token: owner.token } );
	await a.call( '/__test/arm-media' ); const pending = complete();
	let ready = false;
	for ( let attempt = 0; attempt < 100 && ! ready; attempt ++ ) {
		ready = ( await a.call( '/__test/ready' ) ).body.ready;
		if ( ! ready ) await new Promise( resolve => setTimeout( resolve, 10 ) );
	}
	assert.equal( ready, true );
	ok( await a.admin( `/v1/admin/users/${owner.user.userId}`, { method: 'PATCH', key: randomUUID(), body: { active: false } } ) );
	assert.ok( ( await pending ).status >= 400 );
	assert.equal( ( await a.db.prepare( 'SELECT state FROM media_objects WHERE media_id=?' ).bind( metadata.mediaId ).first() ).state, 'pending' );
	ok( await a.admin( `/v1/admin/users/${owner.user.userId}`, { method: 'PATCH', key: randomUUID(), body: { active: true } } ) );
	const issue = await a.admin( `/v1/admin/users/${owner.user.userId}/access-link`, { method: 'POST', key: randomUUID(), body: {} } ); ok( issue );
	const newToken = new URLSearchParams( new URL( issue.body.loginUrl ).hash.slice( 1 ) ).get( 'login' );
	ok( await a.call( reserved.body.completePath, { method: 'POST', token: newToken } ) );
	const completed = await a.call( `/v1/student/projects/${doc.projectId}/narration`, { method: 'POST', token: newToken, key: randomUUID(), body: metadata } );
	ok( completed ); assert.equal( completed.body.state, 'complete' );
	const result = await a.create( newToken, doc, key ); ok( result );
	assert.equal( result.body.serverRevision, 0 ); assert.equal( result.body.dependenciesVerified, true );
	const loaded = await a.call( `/v1/student/projects/${doc.projectId}`, { token: newToken } ); ok( loaded ); assert.deepEqual( loaded.body.document, doc );
} );

test( 'bounded narration cleanup revisits only abandoned copies and preserves pending and live bytes', async t => {
	const a = await harness( t );
	const bucket = await a.instance.getR2Bucket( 'NARRATION' );
	const { cleanupAbandonedNarrationCopies } = await import( '../../../backend/src/projects/NarrationCopyReservations.js' );
	const keys = [ 'pending', 'live', 'abandoned-a', 'abandoned-b' ].map( name => `${randomUUID()}/${name}` );
	for ( const [ index, state ] of [ 'pending', 'live', 'abandoned', 'abandoned' ].entries() ) {
		await a.db.prepare( 'INSERT INTO narration_copy_reservations (object_key,state,created_at) VALUES (?,?,?)' ).bind( keys[ index ], state, index + 1 ).run();
		await bucket.put( keys[ index ], 'bytes' );
	}
	for ( let attempt = 0; attempt < 5; attempt ++ ) await cleanupAbandonedNarrationCopies( { DB: a.db, NARRATION: bucket }, { maximum: 1 } );
	assert.ok( await bucket.head( keys[ 0 ] ) ); assert.ok( await bucket.head( keys[ 1 ] ) );
	assert.equal( await bucket.head( keys[ 2 ] ), null ); assert.equal( await bucket.head( keys[ 3 ] ), null );
	await bucket.put( keys[ 2 ], 'late write' );
	for ( let attempt = 0; attempt < 5; attempt ++ ) await cleanupAbandonedNarrationCopies( { DB: a.db, NARRATION: bucket }, { maximum: 1 } );
	assert.equal( await bucket.head( keys[ 2 ] ), null );
} );
