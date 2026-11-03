import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const backend = fileURLToPath( new URL( '../../../backend/', import.meta.url ) );
let script, migrations;
before( async () => {

	script = ( await build( { entryPoints: [ `${backend}src/worker.js` ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[ 0 ].text;
	migrations = await Promise.all( ( await readdir( `${backend}migrations` ) ).filter( file => /^\d+_.*\.sql$/.test( file ) ).sort().map( file => readFile( `${backend}migrations/${file}`, 'utf8' ) ) );

} );
async function harness( t, overrides = {}, country = 'AU' ) {

	const instance = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', cf: { country }, d1Databases: [ 'DB' ], r2Buckets: { DOCUMENTS: 'shared', NARRATION: 'shared', LIBRARY: 'shared' }, bindings: {
		ENVIRONMENT: 'production', ENABLE_DRAFT_API: 'false', ENABLE_ACCOUNT_API: 'true', ENABLE_ACCOUNT_WRITES: 'true', ENABLE_HOSTED_ADMIN_AUTH: 'true', MAX_JSON_BYTES: '2097152', MAX_NARRATION_BYTES: '16777216', MAX_DRAFT_REVISIONS: '10000', MAX_DRAFT_MEDIA: '100', MAX_DRAFT_CREATIONS_PER_MINUTE: '30', ...overrides
	} } );
	t.after( () => instance.dispose() );
	const db = await instance.getD1Database( 'DB' );
	for ( const sql of migrations ) await db.batch( splitSql( sql ).map( query => db.prepare( query ) ) );
	const userId = randomUUID(), credential = randomUUID();
	await db.prepare( 'INSERT INTO student_users (user_id,first_name,last_name,graduation_year,credential_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)' ).bind( userId, 'Hosted', 'Test', 2030, createHash( 'sha256' ).update( credential ).digest( 'hex' ), 1, 1 ).run();
	const call = ( path, options = {} ) => instance.dispatchFetch( `https://school.example${path}`, { ...options, headers: { Authorization: `Bearer ${credential}`, ...options.headers } } );
	return { instance, db, call, credential };

}

test( 'hosted account API activates explicitly while device drafts stay disabled and shared R2 preserves catalogue objects', async t => {

	const h = await harness( t );
	assert.equal( ( await h.call( '/v1/student/me' ) ).status, 200 );
	const library = await h.instance.getR2Bucket( 'LIBRARY' );
	await library.put( 'library/preserved.bin', 'preserved catalogue' );
	const document = createStudentProjectDocument( { projectId: randomUUID(), name: 'Hosted shared bucket' } );
	const response = await h.call( '/v1/student/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify( { projectId: document.projectId, document } ) } );
	assert.equal( response.status, 201, await response.clone().text() );
	assert.equal( ( await response.json() ).dependenciesVerified, true );
	const row = await h.db.prepare( 'SELECT object_key FROM draft_revisions WHERE project_id=?' ).bind( document.projectId ).first();
	assert.match( row.object_key, /^account-projects\// );
	assert.ok( await library.head( row.object_key ) );
	assert.equal( await ( await library.get( 'library/preserved.bin' ) ).text(), 'preserved catalogue' );
	assert.equal( ( await h.call( '/v1/drafts', { method: 'POST' } ) ).status, 503 );
	assert.equal( ( await h.instance.dispatchFetch( 'http://school.example/v1/student/me', { headers: { Authorization: `Bearer ${h.credential}` } } ) ).status, 403 );

} );

test( 'hosted activation fails closed without each explicit security flag', async t => {

	for ( const overrides of [ { ENABLE_ACCOUNT_API: 'false' }, { ENABLE_ACCOUNT_API: '' }, { ENABLE_HOSTED_ADMIN_AUTH: 'false' }, { ENABLE_DRAFT_API: 'true' }, { ENVIRONMENT: 'disabled' } ] ) {

		const h = await harness( t, overrides );
		assert.equal( ( await h.call( '/v1/student/me' ) ).status, 503, JSON.stringify( overrides ) );

	}
	const foreign = await harness( t, {}, 'NZ' );
	assert.equal( ( await foreign.call( '/v1/student/me' ) ).status, 403 );

} );

test( 'account write kill switch retains reads and cloud objects', async t => {

	const h = await harness( t, { ENABLE_ACCOUNT_WRITES: 'false' } );
	assert.equal( ( await h.call( '/v1/student/me' ) ).status, 200 );
	assert.equal( ( await h.call( '/v1/student/projects' ) ).status, 200 );
	const response = await h.call( '/v1/student/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: '{}' } );
	assert.equal( response.status, 503 );
	assert.equal( ( await response.json() ).error.code, 'ACCOUNT_WRITES_DISABLED' );
	assert.equal( ( await h.db.prepare( 'SELECT count(*) AS count FROM student_projects' ).first() ).count, 0 );

} );
