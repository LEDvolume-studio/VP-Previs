import assert from 'node:assert/strict';
import { randomBytes, randomUUID, pbkdf2Sync, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const backend = fileURLToPath( new URL( '../../../backend/', import.meta.url ) );
const origin = 'http://localhost';
const password = randomUUID(), salt = randomBytes( 16 ), secret = randomBytes( 32 );
const verifier = `pbkdf2-sha256$1000$${salt.toString( 'base64url' )}$${pbkdf2Sync( password, salt, 1000, 32, 'sha256' ).toString( 'base64url' )}`;
let script, guardScript, migrations;

before( async () => {
	script = ( await build( { entryPoints: [ `${backend}src/worker.js` ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[ 0 ].text;
	guardScript = ( await build( { stdin: { resolveDir: backend, contents: `
import app from './src/worker.js';
import { authenticateStudent, studentProjectWriteGuard } from './src/security/StudentAccounts.js';
let ready = false;
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/__test/ready') return Response.json({ready});
  if (url.pathname === '/__test/write') {
    try {
      const principal = await authenticateStudent(request, env);
      if (url.searchParams.get('hold') === '1') {
        ready = true;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      const id = url.searchParams.get('project');
      const guard = studentProjectWriteGuard(principal, id);
      const result = await env.DB.prepare('UPDATE student_projects SET title = ? WHERE project_id = ? AND ' + guard.sql).bind('guarded write', id, ...guard.bindings).run();
      return Response.json({changes:result.meta.changes});
    } catch (error) { return Response.json({error:{code:error.code}}, {status:error.status || 500}); }
  }
  return app.fetch(request, env);
} };
` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[ 0 ].text;
	const names = ( await readdir( `${backend}migrations` ) ).filter( name => /^\d+_.*\.sql$/.test( name ) ).sort();
	migrations = await Promise.all( names.map( name => readFile( `${backend}migrations/${name}`, 'utf8' ) ) );
} );

async function harness( t, workerScript = script ) {
	const instance = new Miniflare( { modules: true, script: workerScript, compatibilityDate: '2026-07-30', d1Databases: [ 'DB', 'ADMIN_AUTH_DB' ], r2Buckets: [ 'DOCUMENTS', 'NARRATION' ], bindings: {
		ENVIRONMENT: 'test', ENABLE_DRAFT_API: 'true', ALLOW_LOCAL_GEO_EXEMPTION: 'true', ADMIN_PASSWORD_VERIFIER: verifier, ADMIN_SESSION_SECRET: secret.toString( 'base64url' ), ADMIN_SESSION_SECONDS: '3600', ADMIN_LOGIN_ATTEMPTS_PER_MINUTE: '30', MAX_JSON_BYTES: '65536', MAX_NARRATION_BYTES: '1024', MAX_DRAFT_REVISIONS: '100', MAX_DRAFT_MEDIA: '5', MAX_DRAFT_CREATIONS_PER_MINUTE: '100'
	} } );
	t.after( () => instance.dispose() );
	const db = await instance.getD1Database( 'DB' ), auth = await instance.getD1Database( 'ADMIN_AUTH_DB' );
	for ( const sql of migrations ) await db.batch( splitSql( sql ).map( query => db.prepare( query ) ) );
	await auth.batch( splitSql( migrations[ 2 ] ).map( query => auth.prepare( query ) ) );
	const call = async ( path, { method = 'GET', body, token, cookie, key, headers = {} } = {} ) => {
		const response = await instance.dispatchFetch( `${origin}${path}`, { method, headers: { ...( body !== undefined ? { 'Content-Type': 'application/json' } : {} ), ...( cookie ? { Cookie: cookie } : {} ), ...( token ? { Authorization: `Bearer ${token}` } : {} ), ...( key ? { 'Idempotency-Key': key } : {} ), ...( ! [ 'GET', 'HEAD' ].includes( method ) ? { Origin: origin, 'Sec-Fetch-Site': 'same-origin' } : {} ), ...headers }, ...( body !== undefined ? { body: JSON.stringify( body ) } : {} ) } );
		return { status: response.status, headers: response.headers, body: await response.json() };
	};
	const login = await call( '/v1/admin/session', { method: 'POST', body: { password } } );
	assert.equal( login.status, 200, JSON.stringify( login.body ) );
	const cookie = login.headers.get( 'set-cookie' ).split( ';' )[ 0 ];
	const admin = ( path, options = {} ) => call( path, { ...options, cookie } );
	const create = async ( name = 'Ada' ) => {
		const response = await admin( '/v1/admin/users', { method: 'POST', key: randomUUID(), body: { firstName: name, lastName: 'Student', graduationYear: 2030 } } );
		assert.equal( response.status, 201, JSON.stringify( response.body ) );
		return response.body.user;
	};
	const issue = async ( userId, key = randomUUID() ) => {
		const response = await admin( `/v1/admin/users/${userId}/access-link`, { method: 'POST', key, body: {} } );
		assert.equal( response.status, 200, JSON.stringify( response.body ) );
		const url = new URL( response.body.loginUrl, origin );
		const token = new URLSearchParams( url.hash.slice( 1 ) ).get( 'login' );
		assert.match( token, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/ );
		return { token, key, response };
	};
	return { instance, db, call, admin, create, issue };
}

test( 'admin users require account fields, session and same-origin; student credentials do not grant admin access', async t => {
	const a = await harness( t );
	for ( const body of [ {}, { firstName: '', lastName: 'S', graduationYear: 2030 }, { firstName: 'A', lastName: ' ', graduationYear: 2030 }, { firstName: 'A', lastName: 'S' }, { firstName: 'A', lastName: 'S', graduationYear: '2030' } ] ) {
		const result = await a.admin( '/v1/admin/users', { method: 'POST', key: randomUUID(), body } );
		assert.ok( [ 400, 422 ].includes( result.status ), JSON.stringify( result.body ) );
	}
	const user = await a.create();
	assert.deepEqual( [ user.firstName, user.lastName, user.graduationYear ], [ 'Ada', 'Student', 2030 ] );
	const { token } = await a.issue( user.userId );
	assert.equal( ( await a.call( '/v1/admin/users', { token } ) ).status, 401 );
	assert.equal( ( await a.call( '/v1/admin/users', { method: 'POST', token, key: randomUUID(), body: { firstName: 'B', lastName: 'S', graduationYear: 2030 } } ) ).status, 401 );
	assert.equal( ( await a.admin( '/v1/admin/users', { method: 'POST', headers: { Origin: 'https://evil.example' }, key: randomUUID(), body: { firstName: 'B', lastName: 'S', graduationYear: 2030 } } ) ).status, 403 );
	const list = await a.admin( '/v1/admin/users' );
	assert.equal( list.status, 200 );
	assert.ok( list.body.items.some( item => item.userId === user.userId ) );
	assert.ok( ! JSON.stringify( list.body ).includes( token ) );
	assert.equal( ( await a.admin( `/v1/admin/users/${randomUUID()}` ) ).status, 404 );
} );

test( 'link validation, rotation, lost response replay, revoke and restore preserve identity', async t => {
	const a = await harness( t );
	const user = await a.create(), first = await a.issue( user.userId );
	const invalid = [ undefined, 'forged', randomUUID(), '00000000-0000-0000-0000-000000000000', first.token.toUpperCase() ];
	for ( const token of invalid ) {
		const response = await a.call( '/v1/student/me', { token } );
		assert.equal( response.status, 401, JSON.stringify( response.body ) );
		if ( token ) assert.ok( ! JSON.stringify( response.body ).includes( token ) );
	}
	const me = await a.call( '/v1/student/me', { token: first.token } );
	assert.equal( me.status, 200, JSON.stringify( me.body ) );
	assert.equal( me.body.user.userId, user.userId );
	assert.equal( me.headers.get( 'cache-control' ), 'no-store' );
	assert.ok( ! JSON.stringify( me.body ).includes( first.token ) );
	const row = await a.db.prepare( 'SELECT * FROM student_users WHERE user_id = ?' ).bind( user.userId ).first();
	assert.equal( row.credential_hash, createHash( 'sha256' ).update( first.token ).digest( 'hex' ) );
	assert.ok( ! JSON.stringify( row ).includes( first.token ) );
	const replay = await a.admin( `/v1/admin/users/${user.userId}/access-link`, { method: 'POST', key: first.key, body: {} } );
	assert.equal( replay.status, 409 );
	assert.equal( replay.body.error.code, 'LINK_ALREADY_ISSUED' );
	assert.equal( ( await a.call( '/v1/student/me', { token: first.token } ) ).status, 200 );
	const second = await a.issue( user.userId );
	assert.equal( ( await a.call( '/v1/student/me', { token: first.token } ) ).status, 401 );
	assert.equal( ( await a.call( '/v1/student/me', { token: second.token } ) ).status, 200 );
	const revoke = await a.admin( `/v1/admin/users/${user.userId}`, { method: 'PATCH', key: randomUUID(), body: { active: false } } );
	assert.equal( revoke.status, 200, JSON.stringify( revoke.body ) );
	assert.ok( [ 401, 403 ].includes( ( await a.call( '/v1/student/me', { token: second.token } ) ).status ) );
	const restore = await a.admin( `/v1/admin/users/${user.userId}`, { method: 'PATCH', key: randomUUID(), body: { active: true } } );
	assert.equal( restore.status, 200, JSON.stringify( restore.body ) );
	assert.equal( ( await a.call( '/v1/student/me', { token: second.token } ) ).status, 401 );
	const third = await a.issue( user.userId );
	assert.equal( ( await a.call( '/v1/student/me', { token: third.token } ) ).body.user.userId, user.userId );
	const operations = await a.db.prepare( 'SELECT * FROM student_access_issuance_operations WHERE user_id = ?' ).bind( user.userId ).all();
	assert.ok( ! JSON.stringify( operations ).includes( first.token ) );
	assert.ok( ! JSON.stringify( operations ).includes( second.token ) );
	assert.ok( ! JSON.stringify( operations ).includes( third.token ) );
} );

test( 'owner and active-generation predicate fences writes after a concurrent revoke', async t => {
	const a = await harness( t, guardScript );
	const user = await a.create(), other = await a.create( 'Other' );
	const first = await a.issue( user.userId ), second = await a.issue( other.userId );
	const projectId = randomUUID(), draftId = randomUUID();
	await a.db.prepare( 'INSERT INTO drafts (draft_id,capability_hash,create_request_id,create_request_hash,created_at) VALUES (?,?,?,?,?)' ).bind( draftId, 'a'.repeat( 64 ), randomUUID(), 'b'.repeat( 64 ), 1 ).run();
	await a.db.prepare( "INSERT INTO student_projects (project_id,user_id,draft_id,state,title,created_at,updated_at) VALUES (?,?,?,'live','original',1,1)" ).bind( projectId, user.userId, draftId ).run();
	const path = `/__test/write?project=${projectId}`;
	assert.equal( ( await a.call( path, { token: second.token } ) ).body.changes, 0 );
	assert.equal( ( await a.call( `/__test/write?project=${randomUUID()}`, { token: first.token } ) ).body.changes, 0 );
	assert.equal( ( await a.call( path, { token: first.token } ) ).body.changes, 1 );
	await a.db.prepare( "UPDATE student_projects SET title = 'before revoke' WHERE project_id = ?" ).bind( projectId ).run();
	const pending = a.call( `${path}&hold=1`, { token: first.token } );
	let ready = false;
	for ( let attempt = 0; attempt < 100 && ! ready; attempt ++ ) {
		ready = ( await a.call( '/__test/ready' ) ).body.ready;
		if ( ! ready ) await new Promise( resolve => setTimeout( resolve, 10 ) );
	}
	assert.equal( ready, true, 'write reached the post-authentication barrier' );
	const revoked = await a.admin( `/v1/admin/users/${user.userId}`, { method: 'PATCH', key: randomUUID(), body: { active: false } } );
	assert.equal( revoked.status, 200, JSON.stringify( revoked.body ) );
	assert.equal( ( await pending ).body.changes, 0 );
	assert.equal( ( await a.db.prepare( 'SELECT title FROM student_projects WHERE project_id = ?' ).bind( projectId ).first() ).title, 'before revoke' );
} );

test( 'concurrent profile edit and revocation cannot restore access or report an uncommitted state', async t => {
	const a = await harness( t );
	const user = await a.create(), link = await a.issue( user.userId );
	const path = `/v1/admin/users/${user.userId}`;
	const [ edited, revoked ] = await Promise.all( [
		a.admin( path, { method: 'PATCH', key: randomUUID(), body: { firstName: 'Grace' } } ),
		a.admin( path, { method: 'PATCH', key: randomUUID(), body: { active: false } } )
	] );
	assert.equal( edited.status, 200, JSON.stringify( edited.body ) );
	assert.equal( revoked.status, 200, JSON.stringify( revoked.body ) );
	assert.equal( edited.body.user.firstName, 'Grace' );
	assert.equal( revoked.body.user.active, false );
	const after = await a.admin( path );
	assert.equal( after.body.user.firstName, 'Grace' );
	assert.equal( after.body.user.active, false );
	assert.ok( [ 401, 403 ].includes( ( await a.call( '/v1/student/me', { token: link.token } ) ).status ) );
} );
