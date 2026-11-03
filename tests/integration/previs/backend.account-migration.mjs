import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const migrationNames = [ '0001_drafts.sql', '0002_narration.sql', '0003_admin_password.sql', '0004_catalogue.sql', '0005_supported_scenes.sql', '0006_preset_editor.sql', '0007_student_accounts.sql' ];
const migrations = await Promise.all( migrationNames.map( name => readFile( new URL( `../../../backend/migrations/${name}`, import.meta.url ), 'utf8' ) ) );
const digest = 'a'.repeat( 64 );

for ( const populated of [ false, true ] ) test( `account migration preserves ${populated ? 'populated foundation' : 'fresh database'} and enforces identity constraints`, async t => {
	const instance = new Miniflare( { modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2026-07-30', d1Databases: { DB: 'data' }, r2Buckets: [ 'DOCUMENTS' ] } );
	t.after( () => instance.dispose() );
	const db = await instance.getD1Database( 'DB' );
	const bucket = await instance.getR2Bucket( 'DOCUMENTS' );
	const sql = ( query, ...args ) => db.prepare( query ).bind( ...args ).run();
	const apply = migration => db.batch( splitSql( migration ).map( statement => db.prepare( statement ) ) );
	for ( const migration of migrations.slice( 0, 6 ) ) await apply( migration );
	if ( populated ) {
		await sql( "INSERT INTO object_reservations VALUES ('legacy-doc', 'pending', 1)" );
		await sql( 'INSERT INTO drafts (draft_id, capability_hash, create_request_id, create_request_hash, created_at) VALUES (?, ?, ?, ?, ?)', 'legacy', digest, 'create', digest, 1 );
		await sql( 'INSERT INTO draft_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 'legacy', 0, 0, 'legacy-project', 'revision', digest, 'legacy-doc', digest, 3, 1 );
		await sql( 'INSERT INTO library_assets VALUES (?, ?, ?, ?, ?, ?)', 'asset', '1', '{}', 'asset-object', digest, 3 );
		await bucket.put( 'legacy-doc', 'old' );
	}
	await apply( migrations[ 6 ] );
	if ( populated ) {
		assert.equal( ( await db.prepare( "SELECT head_revision FROM drafts WHERE draft_id='legacy'" ).first() ).head_revision, 0 );
		assert.equal( ( await db.prepare( "SELECT object_key FROM draft_revisions WHERE draft_id='legacy'" ).first() ).object_key, 'legacy-doc' );
		assert.equal( ( await db.prepare( "SELECT metadata_json FROM library_assets WHERE asset_id='asset'" ).first() ).metadata_json, '{}' );
		assert.equal( await ( await bucket.get( 'legacy-doc' ) ).text(), 'old' );
	}
	await assert.rejects( sql( "INSERT INTO student_users VALUES (NULL, 'No', 'Body', 2030, 'active', 1, NULL, 1, 1)" ) );
	await assert.rejects( sql( "INSERT INTO student_default_versions VALUES (NULL, 'missing', ?, 3, '[]', 1)", digest ) );
	await sql( "INSERT INTO student_users VALUES ('u1', 'One', 'Student', 2030, 'active', 1, ?, 1, 1)", digest );
	await sql( "INSERT INTO student_users VALUES ('u2', 'Two', 'Student', 2031, 'active', 1, NULL, 1, 1)" );
	await assert.rejects( sql( "INSERT INTO student_users VALUES ('u3', 'Three', 'Student', 2032, 'active', 1, ?, 1, 1)", digest ) );
	await assert.rejects( sql( "INSERT INTO student_users VALUES ('bad1', '', 'Student', 2030, 'active', 1, NULL, 1, 1)" ) );
	await assert.rejects( sql( "INSERT INTO student_users VALUES ('bad2', 'Test', ' ', 2030, 'active', 1, NULL, 1, 1)" ) );
	await assert.rejects( sql( "INSERT INTO student_users VALUES ('bad3', 'Test', 'Student', NULL, 'active', 1, NULL, 1, 1)" ) );
	await assert.rejects( sql( "INSERT INTO student_users VALUES ('bad4', 'Test', 'Student', 2030.5, 'active', 1, NULL, 1, 1)" ) );
	await sql( "INSERT INTO student_access_issuance_operations VALUES ('u1','issue',?,1,1)", digest );
	await assert.rejects( sql( "INSERT INTO student_access_issuance_operations VALUES ('u1','issue',?,1,1)", digest ) );
	await sql( "INSERT INTO object_reservations VALUES ('default', 'live', 1)" );
	await sql( "INSERT INTO student_default_versions VALUES ('v1', 'default', ?, 3, '[]', 1)", digest );
	await sql( "INSERT INTO student_projects (project_id,user_id,title,created_at,updated_at) VALUES ('p1','u1','Project',1,1)" );
	await sql( "INSERT INTO student_bootstraps VALUES ('u1','p1','v1','reserved',1,1)" );
	await assert.rejects( sql( "INSERT INTO student_bootstraps VALUES ('u1','p1','v1','reserved',1,1)" ) );
	await assert.rejects( sql( "INSERT INTO student_bootstraps VALUES ('u2','p1','v1','reserved',1,1)" ) );
	await assert.rejects( sql( "UPDATE student_projects SET state='live' WHERE project_id='p1'" ) );
	await assert.rejects( sql( "UPDATE student_bootstraps SET state='complete' WHERE user_id='u1'" ) );
	await sql( "INSERT INTO drafts (draft_id,capability_hash,create_request_id,create_request_hash,created_at) VALUES ('new-draft',?,'create',?,1)", digest, digest );
	await sql( "INSERT INTO object_reservations VALUES ('new-doc','pending',1)" );
	await sql( "INSERT INTO draft_revisions VALUES ('new-draft',0,0,'p1','revision',?,'new-doc',?,3,1)", digest, digest );
	await sql( "UPDATE student_projects SET draft_id='new-draft',state='live' WHERE project_id='p1'" );
	await sql( "UPDATE student_bootstraps SET state='complete' WHERE user_id='u1'" );
	await assert.rejects( sql( "UPDATE student_projects SET state='reserved' WHERE project_id='p1'" ) );
	await assert.rejects( sql( "INSERT INTO student_projects (project_id,user_id,title,created_at,updated_at) VALUES (NULL,'u1','Bad',1,1)" ) );
	await assert.rejects( sql( "INSERT INTO student_default_operations VALUES (NULL, ?, 'v1', -1, 0, 1)", digest ) );
	await sql( "INSERT INTO student_project_operations VALUES ('u1','request',?,'p1','create','{}',1)", digest );
	await assert.rejects( sql( "INSERT INTO student_project_operations VALUES ('u1','request',?,'p1','create','{}',1)", digest ) );
	await assert.rejects( sql( "INSERT INTO student_project_operations VALUES ('u2','other',?,'p1','rename','{}',1)", digest ) );
	await assert.rejects( sql( "UPDATE student_default_versions SET dependencies_json='{}' WHERE version_id='v1'" ) );
	const indexes = await db.prepare( "PRAGMA index_list('student_projects')" ).all();
	assert.ok( indexes.results.some( index => index.name === 'student_projects_owner_list' ) );
} );
