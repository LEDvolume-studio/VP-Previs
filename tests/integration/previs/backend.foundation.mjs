import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { studentFixture } from '../../unit/previs/studentFixtures.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const migrate = ( database, sql ) => database.batch( splitSql( sql ).map( query => database.prepare( query ) ) );
const backend = fileURLToPath( new URL( '../../../backend/', import.meta.url ) );
const settings = {
	ENVIRONMENT: 'test', ENABLE_DRAFT_API: 'true', ALLOW_LOCAL_GEO_EXEMPTION: 'true', MAX_JSON_BYTES: '65536',
	MAX_NARRATION_BYTES: '1024', MAX_DRAFT_REVISIONS: '100', MAX_DRAFT_MEDIA: '5',
	MAX_DRAFT_CREATIONS_PER_MINUTE: '100'
};
let mf, db, documents, narrationBucket, script, migration1, migration2;
const capability = () => randomBytes( 32 ).toString( 'base64url' );
const sha = bytes => createHash( 'sha256' ).update( bytes ).digest( 'hex' );
const fresh = () => ( { draftId: randomUUID(), capability: capability(), key: `${randomUUID()}:0`, document: createStudentProjectDocument() } );
const api = async ( path, { method = 'GET', cap, key, match, body, headers = {} } = {} ) => {
	const response = await mf.dispatchFetch( `http://localhost${path}`, {
		method,
		headers: { ...( cap ? { Authorization: `Bearer ${cap}` } : {} ), ...( key ? { 'Idempotency-Key': key } : {} ), ...( match !== undefined ? { 'If-Match': `"${match}"` } : {} ), ...( body !== undefined ? { 'Content-Type': 'application/json' } : {} ), ...headers },
		...( body !== undefined ? { body: JSON.stringify( body ) } : {} )
	} );
	return { status: response.status, headers: response.headers, body: await response.json() };
};
const create = item => api( '/v1/drafts', { method: 'POST', cap: item.capability, key: item.key, body: { draftId: item.draftId, document: item.document } } );
const edit = ( item, name, revision = 1 ) => ( { ...structuredClone( item.document ), name, revision } );
const update = ( item, document, key = `${item.draftId}:${document.revision}`, match = 0 ) => api( `/v1/drafts/${item.draftId}`, { method: 'PUT', cap: item.capability, key, match, body: { document } } );
const envFrom = async instance => ( { ...settings, DB: await instance.getD1Database( 'DB' ), DOCUMENTS: await instance.getR2Bucket( 'DOCUMENTS' ), NARRATION: await instance.getR2Bucket( 'NARRATION' ) } );

before( async () => {
	const bundle = await build( { entryPoints: [ `${backend}src/worker.js` ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } );
	script = bundle.outputFiles[ 0 ].text;
	[ migration1, migration2 ] = await Promise.all( [ '0001_drafts.sql', '0002_narration.sql' ].map( name => readFile( `${backend}migrations/${name}`, 'utf8' ) ) );
	mf = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', d1Databases: [ 'DB' ], r2Buckets: [ 'DOCUMENTS', 'NARRATION' ], bindings: settings } );
	( { DB: db, DOCUMENTS: documents, NARRATION: narrationBucket } = await envFrom( mf ) );
	await migrate( db, migration1 );
	await migrate( db, migration2 );
} );
after( async () => { await mf?.dispose(); } );

test( 'draft creation is private, immutable, hashed and retryable after losing its response', async () => {
	const item = fresh();
	const first = await create( item );
	assert.equal( first.status, 201, JSON.stringify( first.body ) );
	assert.deepEqual( first.body, { draftId: item.draftId, serverRevision: 0, documentRevision: 0, dependenciesVerified: true, replayed: false } );
	assert.equal( first.headers.get( 'cache-control' ), 'no-store' );
	const replay = await create( item );
	assert.equal( replay.status, 200 );
	assert.equal( replay.body.replayed, true );
	const row = await db.prepare( 'SELECT * FROM drafts WHERE draft_id = ?' ).bind( item.draftId ).first();
	assert.equal( row.capability_hash, sha( item.capability ) );
	assert.ok( ! JSON.stringify( row ).includes( item.capability ) );
	assert.equal( ( await db.prepare( 'SELECT count(*) AS count FROM draft_revisions WHERE draft_id = ?' ).bind( item.draftId ).first() ).count, 1 );
	const read = await api( `/v1/drafts/${item.draftId}`, { cap: item.capability } );
	assert.equal( read.status, 200 );
	assert.deepEqual( read.body.document, item.document );
	assert.equal( read.headers.get( 'etag' ), '"0"' );
	assert.ok( ! JSON.stringify( read.body ).includes( item.capability ) );
	assert.equal( ( await create( { ...item, document: edit( item, 'different' ) } ) ).status, 409 );
	await assert.rejects( db.prepare( 'UPDATE draft_revisions SET document_revision = 99 WHERE draft_id = ?' ).bind( item.draftId ).run(), /immutable revision/ );
} );

test( 'missing, malformed, forged, cross-project and revoked capabilities fail', async () => {
	const item = fresh();
	await create( item );
	for ( const cap of [ undefined, 'forged', capability() ] ) {
		assert.equal( ( await api( `/v1/drafts/${item.draftId}`, { cap } ) ).status, 401 );
		assert.equal( ( await create( { ...item, capability: cap } ) ).status, 401 );
	}
	const second = fresh(); await create( second );
	assert.equal( ( await api( `/v1/drafts/${item.draftId}`, { cap: second.capability } ) ).status, 401 );
	await db.prepare( 'UPDATE drafts SET revoked = 1 WHERE draft_id = ?' ).bind( item.draftId ).run();
	assert.equal( ( await api( `/v1/drafts/${item.draftId}`, { cap: item.capability } ) ).status, 401 );
	assert.equal( ( await update( item, edit( item, 'revoked' ) ) ).status, 401 );
	assert.equal( ( await create( item ) ).status, 401 );
} );

test( 'conditional updates replay the exact acknowledged edit; stale and concurrent writes have one winner', async () => {
	const item = fresh(); await create( item );
	const a = edit( item, 'A' ), b = edit( item, 'B' );
	const responses = await Promise.all( [ update( item, a, 'writer-a' ), update( item, b, 'writer-b' ) ] );
	assert.deepEqual( responses.map( result => result.status ).sort(), [ 200, 409 ] );
	const winner = responses[ 0 ].status === 200 ? a : b;
	const key = responses[ 0 ].status === 200 ? 'writer-a' : 'writer-b';
	assert.equal( ( await update( item, winner, key ) ).body.replayed, true );
	assert.equal( ( await update( item, { ...winner, name: 'key misuse' }, key ) ).body.error.code, 'IDEMPOTENCY_CONFLICT' );
	assert.equal( ( await update( item, edit( item, 'stale', 2 ), 'stale', 0 ) ).body.error.code, 'REVISION_CONFLICT' );
	assert.equal( ( await update( item, edit( item, 'newest', 7 ), 'newer', 1 ) ).body.serverRevision, 2 );
	const replay = await update( item, winner, key );
	assert.equal( replay.body.serverRevision, 1 );
	assert.equal( replay.body.documentRevision, 1 );
	assert.equal( ( await create( item ) ).body.serverRevision, 0 );
	const read = await api( `/v1/drafts/${item.draftId}`, { cap: item.capability } );
	assert.equal( read.body.document.name, 'newest' );
	assert.equal( read.body.documentRevision, 7 );
	assert.equal( ( await db.prepare( 'SELECT count(*) AS count FROM draft_revisions WHERE draft_id = ?' ).bind( item.draftId ).first() ).count, 3 );
} );

test( 'duplicate concurrent creation and update retries cannot create sibling revisions', async () => {
	const item = fresh();
	const responses = await Promise.all( [ create( item ), create( item ) ] );
	assert.ok( responses.every( result => [ 200, 201 ].includes( result.status ) ), JSON.stringify( responses ) );
	assert.ok( responses.some( result => result.body.replayed ) );
	const document = edit( item, 'one successor' );
	const updates = await Promise.all( [ update( item, document ), update( item, document ) ] );
	assert.ok( updates.every( result => result.status === 200 ), JSON.stringify( updates ) );
	assert.ok( updates.some( result => result.body.replayed ) );
} );

test( 'API rejects invalid schema, secret fields, invalid IDs, oversized declared/streamed JSON and absent preconditions', async () => {
	const item = fresh();
	for ( const document of [ { ...item.document, schemaVersion: 999 }, { ...item.document, capability: item.capability }, { ...item.document, output: { width: 1 } } ] ) assert.equal( ( await create( { ...fresh(), document } ) ).status, 422 );
	assert.equal( ( await create( { ...item, draftId: 'bad' } ) ).status, 400 );
	assert.equal( ( await create( { ...fresh(), document: { ...item.document, name: 'x'.repeat( 70000 ) } } ) ).status, 413 );
	const stream = new ReadableStream( { start( controller ) { controller.enqueue( new Uint8Array( 70000 ) ); controller.close(); } } );
	const response = await mf.dispatchFetch( 'http://localhost/v1/drafts', { method: 'POST', headers: { Authorization: `Bearer ${item.capability}`, 'Idempotency-Key': item.key, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } );
	assert.equal( response.status, 413 );
	await create( item );
	assert.equal( ( await api( `/v1/drafts/${item.draftId}`, { method: 'PUT', cap: item.capability, key: 'missing-precondition', body: { document: edit( item, 'x' ) } } ) ).status, 428 );
	assert.equal( ( await update( item, { ...edit( item, 'x' ), projectId: 'changed' } ) ).body.error.code, 'INVALID_SUCCESSOR' );
	assert.equal( ( await update( item, item.document ) ).body.error.code, 'INVALID_SUCCESSOR' );
} );

test( 'unverified library assets never produce a full dependency backup acknowledgement', async () => {
	const item = fresh();
	item.document = studentFixture();
	// This CPU fixture has no narration. Its model/video claims are not a trusted catalogue.
	item.document.narration = { assets: {}, clips: [] };
	const response = await create( item );
	assert.equal( response.status, 201, JSON.stringify( response.body ) );
	assert.equal( response.body.dependenciesVerified, false );
	const sceneOnly = fresh();
	sceneOnly.document.baseScenes[ 'unverified@1' ] = { sceneId: 'unverified', version: '1', assets: [] };
	assert.equal( ( await create( sceneOnly ) ).body.dependenciesVerified, false );
} );

test( 'teacher endpoints always fail closed, including forged auth/provider claims', async () => {
	for ( const method of [ 'GET', 'POST', 'PUT', 'DELETE' ] ) {
		const response = await api( '/v1/admin/presets', { method, cap: capability(), headers: { 'Cf-Access-Authenticated-User-Email': 'teacher@example.test', 'Cf-Access-Jwt-Assertion': 'forged' } } );
		assert.equal( response.status, 503 );
		assert.equal( response.body.error.code, 'ADMIN_AUTH_NOT_CONFIGURED' );
	}
	const disabled = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', cf: { country: 'AU' }, bindings: { ...settings, ENVIRONMENT: 'production' } } );
	try {
		const response = await disabled.dispatchFetch( 'http://localhost/v1/drafts', { method: 'POST' } );
		assert.equal( response.status, 503 );
	} finally { await disabled.dispose(); }
} );

test( 'narration reservation/upload/completion are owner-scoped, immutable and required before draft references', async () => {
	const item = fresh(); await create( item );
	const bytes = Buffer.from( 'synthetic audio bytes; container decoding is a separate gate' );
	const metadata = { mediaId: 'recording@1', sha256: sha( bytes ), byteLength: bytes.length, mimeType: 'audio/webm' };
	const path = `/v1/drafts/${item.draftId}/narration`;
	const initiated = await api( path, { method: 'POST', cap: item.capability, key: 'upload-1', body: metadata } );
	assert.equal( initiated.status, 200 );
	assert.ok( ! JSON.stringify( initiated.body ).includes( item.capability ) );
	assert.equal( ( await api( path, { method: 'POST', cap: item.capability, key: 'upload-1', body: metadata } ) ).body.mediaId, 'recording@1' );
	assert.equal( ( await api( path, { method: 'POST', cap: item.capability, key: 'upload-1', body: { ...metadata, byteLength: 1 } } ) ).status, 409 );
	assert.equal( ( await api( initiated.body.completePath, { method: 'POST', cap: item.capability } ) ).status, 409 );
	const upload = async ( content, cap = item.capability ) => mf.dispatchFetch( `http://localhost${initiated.body.uploadPath}`, { method: 'PUT', headers: { Authorization: `Bearer ${cap}`, 'Content-Type': metadata.mimeType }, body: content } );
	assert.equal( ( await upload( bytes, capability() ) ).status, 401 );
	assert.equal( ( await upload( Buffer.from( 'wrong' ) ) ).status, 422 );
	assert.equal( ( await upload( Buffer.alloc( 2000 ) ) ).status, 413 );
	assert.equal( ( await upload( bytes ) ).status, 200 );
	assert.equal( ( await upload( bytes ) ).status, 200 );
	const reserved = await db.prepare( 'SELECT object_key FROM media_objects WHERE draft_id = ? AND media_id = ?' ).bind( item.draftId, metadata.mediaId ).first();
	await narrationBucket.put( reserved.object_key, 'externally corrupted' );
	assert.equal( ( await upload( bytes ) ).status, 503 );
	assert.equal( ( await api( initiated.body.completePath, { method: 'POST', cap: item.capability } ) ).status, 409 );
	await narrationBucket.delete( reserved.object_key );
	assert.equal( ( await upload( bytes ) ).status, 200 );
	assert.equal( ( await api( initiated.body.completePath, { method: 'POST', cap: item.capability } ) ).status, 200 );
	assert.equal( ( await api( initiated.body.completePath, { method: 'POST', cap: item.capability } ) ).status, 200 );
	const document = edit( item, 'with audio' );
	document.narration.assets[ 'recording@1' ] = { assetId: 'recording', version: '1', sha256: metadata.sha256, byteLength: bytes.length, mimeType: 'audio/webm', codec: 'opus', sampleRate: 48000, channels: 1, durationSamples: 48000, segments: [ { index: 0, sha256: metadata.sha256, byteLength: bytes.length } ] };
	assert.equal( ( await update( item, document ) ).status, 200 );
	assert.equal( ( await db.prepare( 'SELECT count(*) AS count FROM revision_media WHERE draft_id = ?' ).bind( item.draftId ).first() ).count, 1 );
	const other = fresh(); await create( other );
	const otherDocument = { ...structuredClone( document ), projectId: other.document.projectId };
	assert.equal( ( await update( other, otherDocument ) ).body.error.code, 'MEDIA_NOT_READY' );
	assert.equal( ( await api( `/v1/drafts/${other.draftId}/narration/recording%401/complete`, { method: 'POST', cap: other.capability } ) ).status, 404 );
	assert.equal( ( await narrationBucket.list() ).objects.filter( object => object.key.startsWith( `narration/${item.draftId}/` ) ).length, 1 );
} );

test( 'empty database migrations and upgrade from the previous draft-only fixture retain immutable pointers', async () => {
	const instance = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', d1Databases: [ 'DB' ], r2Buckets: [ 'DOCUMENTS', 'NARRATION' ], bindings: settings } );
	try {
		const previous = await instance.getD1Database( 'DB' );
		await migrate( previous, migration1 );
		const draftId = randomUUID();
		await previous.prepare( 'INSERT INTO drafts (draft_id,capability_hash,create_request_id,create_request_hash,created_at) VALUES (?,?,?,?,?)' ).bind( draftId, 'a'.repeat( 64 ), 'old-create', 'b'.repeat( 64 ), 1 ).run();
		await previous.prepare( "INSERT INTO object_reservations VALUES ('fixture.json','pending',1)" ).run();
		await previous.prepare( 'INSERT INTO draft_revisions VALUES (?,?,?,?,?,?,?,?,?,?)' ).bind( draftId, 0, 3, 'old-project', 'old-create', 'b'.repeat( 64 ), 'fixture.json', 'c'.repeat( 64 ), 1024, 1 ).run();
		await migrate( previous, migration2 );
		assert.equal( ( await previous.prepare( 'SELECT head_revision FROM drafts WHERE draft_id = ?' ).bind( draftId ).first() ).head_revision, 0 );
		assert.equal( ( await previous.prepare( 'SELECT document_revision FROM draft_revisions WHERE draft_id = ?' ).bind( draftId ).first() ).document_revision, 3 );
		assert.equal( ( await previous.prepare( 'SELECT count(*) AS count FROM media_objects' ).first() ).count, 0 );
	} finally { await instance.dispose(); }
} );

test( 'cleanup fences only abandoned document reservations and preserves every accepted revision', async () => {
	const { cleanupAbandonedDocuments } = await import( '../../../backend/src/worker.js' );
	const item = fresh(); await create( item );
	await update( item, edit( item, 'winner' ), 'accepted' );
	const env = await envFrom( mf );
	const orphan = `drafts/${randomUUID()}/abandoned.json`;
	await db.prepare( "INSERT INTO object_reservations VALUES (?, 'pending', 1)" ).bind( orphan ).run();
	await documents.put( orphan, 'abandoned' );
	await cleanupAbandonedDocuments( env, { cutoff: Date.now() + 1000 } );
	assert.equal( await documents.head( orphan ), null );
	assert.equal( ( await db.prepare( 'SELECT state FROM object_reservations WHERE object_key = ?' ).bind( orphan ).first() ).state, 'deleting' );
	const { results } = await db.prepare( 'SELECT object_key FROM draft_revisions WHERE draft_id = ?' ).bind( item.draftId ).all();
	for ( const row of results ) assert.ok( await documents.head( row.object_key ) );
	await assert.rejects( db.prepare( 'INSERT INTO draft_revisions VALUES (?,?,?,?,?,?,?,?,?,?)' ).bind( item.draftId, 2, 2, item.document.projectId, 'late-commit', 'a'.repeat( 64 ), orphan, 'b'.repeat( 64 ), 1, 1 ).run(), /object unavailable/ );
	// A delayed upload after the first delete cannot become a committed pointer;
	// recurring tombstone cleanup removes its resurrected unreferenced bytes.
	await documents.put( orphan, 'late bytes' );
	await cleanupAbandonedDocuments( env, { cutoff: Date.now() + 1000 } );
	assert.equal( await documents.head( orphan ), null );
} );

test( 'cleanup rotates tombstone batches instead of starving later abandoned objects', async () => {
	const { cleanupAbandonedDocuments } = await import( '../../../backend/src/worker.js' );
	const env = await envFrom( mf );
	const prefix = randomUUID();
	const keys = Array.from( { length: 3 }, ( _, index ) => `drafts/${prefix}/${index}.json` );
	for ( const key of keys ) {
		await db.prepare( "INSERT INTO object_reservations VALUES (?, 'pending', 1)" ).bind( key ).run();
		await documents.put( key, 'abandoned' );
	}
	for ( let index = 0; index < 10; index ++ ) await cleanupAbandonedDocuments( env, { cutoff: Date.now() + 1000, maximum: 1 } );
	for ( const key of keys ) assert.equal( await documents.head( key ), null );
} );

test( 'cleanup racing a write never removes an accepted immutable pointer', async () => {
	const { cleanupAbandonedDocuments } = await import( '../../../backend/src/worker.js' );
	const env = await envFrom( mf );
	for ( let index = 0; index < 5; index ++ ) {
		const item = fresh(); await create( item );
		const [ response ] = await Promise.all( [ update( item, edit( item, `racing-${index}` ) ), cleanupAbandonedDocuments( env, { cutoff: Date.now() + 1000 } ) ] );
		assert.ok( [ 200, 409 ].includes( response.status ), JSON.stringify( response.body ) );
		const read = await api( `/v1/drafts/${item.draftId}`, { cap: item.capability } );
		assert.equal( read.status, 200 );
		assert.equal( read.body.documentRevision, response.status === 200 ? 1 : 0 );
		const { results } = await db.prepare( 'SELECT object_key FROM draft_revisions WHERE draft_id = ?' ).bind( item.draftId ).all();
		for ( const row of results ) assert.ok( await documents.head( row.object_key ) );
	}
} );

test( 'R2 corruption or missing bytes fail closed instead of returning a successful draft', async () => {
	const item = fresh(); await create( item );
	const row = await db.prepare( 'SELECT object_key FROM draft_revisions WHERE draft_id = ?' ).bind( item.draftId ).first();
	await documents.put( row.object_key, 'corrupted data' );
	assert.equal( ( await api( `/v1/drafts/${item.draftId}`, { cap: item.capability } ) ).body.error.code, 'STORAGE_UNAVAILABLE' );
	await documents.put( row.object_key, Buffer.alloc( 70000 ) );
	assert.equal( ( await api( `/v1/drafts/${item.draftId}`, { cap: item.capability } ) ).status, 503 );
	await documents.delete( row.object_key );
	assert.equal( ( await api( `/v1/drafts/${item.draftId}`, { cap: item.capability } ) ).status, 503 );
} );

test( 'configured development creation/revision budgets enforce bounds without blocking idempotent retries', async () => {
	const instance = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', d1Databases: [ 'DB' ], r2Buckets: [ 'DOCUMENTS', 'NARRATION' ], bindings: { ...settings, MAX_DRAFT_CREATIONS_PER_MINUTE: '1', MAX_DRAFT_REVISIONS: '1' } } );
	try {
		const database = await instance.getD1Database( 'DB' ); await migrate( database, migration1 ); await migrate( database, migration2 );
		const item = fresh();
		const post = candidate => instance.dispatchFetch( 'http://localhost/v1/drafts', { method: 'POST', headers: { Authorization: `Bearer ${candidate.capability}`, 'Idempotency-Key': candidate.key, 'Content-Type': 'application/json' }, body: JSON.stringify( { draftId: candidate.draftId, document: candidate.document } ) } );
		assert.equal( ( await post( item ) ).status, 201 );
		assert.equal( ( await post( item ) ).status, 200 );
		assert.equal( ( await post( fresh() ) ).status, 429 );
		const response = await instance.dispatchFetch( `http://localhost/v1/drafts/${item.draftId}`, { method: 'PUT', headers: { Authorization: `Bearer ${item.capability}`, 'Idempotency-Key': 'new', 'If-Match': '"0"', 'Content-Type': 'application/json' }, body: JSON.stringify( { document: edit( item, 'over budget' ) } ) } );
		assert.equal( response.status, 429 );
	} finally { await instance.dispose(); }
} );
