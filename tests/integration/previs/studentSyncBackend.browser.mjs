// Real Chromium IndexedDB + actual Worker in Miniflare (D1/R2), through a same-origin fault-injecting HTTP proxy.
// No Map repository or fake API is used as persistence/sync evidence.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import puppeteer from 'puppeteer-core';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const root = fileURLToPath( new URL( '../../../', import.meta.url ) );
const bundle = await build( { entryPoints: [ resolve( root, 'backend/src/worker.js' ) ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } );
const mf = new Miniflare( { modules: true, script: bundle.outputFiles[ 0 ].text, compatibilityDate: '2026-07-30', d1Databases: [ 'DB' ], r2Buckets: [ 'DOCUMENTS', 'NARRATION' ], bindings: {
	ENVIRONMENT: 'test', ENABLE_DRAFT_API: 'true', ALLOW_LOCAL_GEO_EXEMPTION: 'true', MAX_JSON_BYTES: '1048576', MAX_NARRATION_BYTES: '16777216',
	MAX_DRAFT_REVISIONS: '10000', MAX_DRAFT_MEDIA: '100', MAX_DRAFT_CREATIONS_PER_MINUTE: '100',
} } );
const db = await mf.getD1Database( 'DB' );
for ( const migration of [ '0001_drafts.sql', '0002_narration.sql' ] ) {

	const sql = await readFile( resolve( root, 'backend/migrations', migration ), 'utf8' );
	await db.batch( splitSql( sql ).map( query => db.prepare( query ) ) );

}
let mode = 'normal';
let held;
let entered;
const requests = [];
const server = createServer( async ( request, response ) => {

	try {

		const pathname = new URL( request.url, 'http://localhost' ).pathname;
		if ( pathname.startsWith( '/v1/' ) ) {

			const chunks = [];
			for await ( const chunk of request ) chunks.push( chunk );
			const body = Buffer.concat( chunks );
			const headers = { ...request.headers };
			delete headers.host;
			delete headers.connection;
			delete headers[ 'content-length' ];
			const document = body.length ? JSON.parse( body ).document : null;
			// Test audit contains only public revision/request IDs; never retain/log capabilities.
			requests.push( { method: request.method, key: headers[ 'idempotency-key' ], revision: document?.revision, match: headers[ 'if-match' ] } );
			if ( mode === 'hold' ) {

				mode = 'normal';
				await new Promise( resolve => { held = resolve; entered(); } );

			}
			const result = await mf.dispatchFetch( `http://localhost${pathname}`, { method: request.method, headers, ...( body.length ? { body } : {} ) } );
			const text = await result.text();
			if ( mode === 'drop' && request.method !== 'GET' && result.ok ) {

				mode = 'normal';
				// The real Worker committed to real emulated D1/R2; only its response is lost.
				response.destroy();
				return;

			}
			response.writeHead( result.status, Object.fromEntries( result.headers ) );
			response.end( text );
			return;

		}
		if ( pathname === '/' ) {

			response.writeHead( 200, { 'content-type': 'text/html' } );
			response.end( '<!doctype html><title>Student sync integration</title>' );
			return;

		}
		const path = resolve( root, `.${decodeURIComponent( pathname )}` );
		if ( ! path.startsWith( `${root.replace( /\/$/, '' )}${sep}` ) ) throw new Error( 'Invalid path' );
		const source = await readFile( path );
		response.writeHead( 200, { 'content-type': 'text/javascript' } );
		response.end( source );

	} catch {

		response.writeHead( 500 );
		response.end();

	}

} );
await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
const origin = `http://127.0.0.1:${server.address().port}`;
const databaseName = `StudentSync-real-backend-${Date.now()}`;
let browser;
const reports = [];
try {

	browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } );
	const page = await browser.newPage();
	const setup = async () => {

		await page.goto( origin );
		await page.evaluate( async databaseName => {

			const { StudentProjectRepository } = await import( '/app/src/previs/persistence/StudentProjectRepository.js' );
			const { DraftApiClient } = await import( '/app/src/previs/api/DraftApiClient.js' );
			const { PrivateDraftBackupService } = await import( '/app/src/previs/sync/PrivateDraftBackupService.js' );
			const { createStudentProjectDocument } = await import( '/app/src/previs/domain/StudentProjectSchema.js' );
			Object.assign( globalThis, { StudentProjectRepository, DraftApiClient, PrivateDraftBackupService, createStudentProjectDocument } );
			globalThis.repo = new StudentProjectRepository( { databaseName } );
			globalThis.client = new DraftApiClient( { baseURL: location.origin, timeoutMs: 5000 } );
			globalThis.events = [];
			globalThis.service = new PrivateDraftBackupService( { repository: globalThis.repo, client: globalThis.client, maxAttempts: 1, onStatus: status => globalThis.events.push( status ) } );
			globalThis.edit = async name => {

				const document = await globalThis.repo.get( 'project' );
				await globalThis.repo.save( { ...document, revision: document.revision + 1, name }, { expectedRevision: document.revision } );

			};

		}, databaseName );

	};
	await setup();
	await page.evaluate( async () => {

		await globalThis.repo.save( globalThis.createStudentProjectDocument( { projectId: 'project' } ), { expectedRevision: null } );
		await globalThis.service.start();

	} );
	assert.equal( requests.length, 0 );
	reports.push( 'Untouched revision zero does not create a remote draft' );

	mode = 'drop';
	await page.evaluate( async () => { await globalThis.edit( 'First meaningful edit' ); await globalThis.service.notifyLocalCommit( 'project' ); } );
	const lost = await page.evaluate( async () => {

		const state = await globalThis.repo.backupState( 'project' );
		return { draftId: state.draftId, requestId: state.inFlight.requestId, revision: state.inFlight.revision, serverRevision: state.serverRevision, status: await globalThis.repo.status( 'project' ) };

	} );
	assert.equal( lost.requestId, 'project:1' );
	assert.equal( lost.serverRevision, null );
	assert.equal( lost.status.backedUp, false );
	assert.equal( ( await db.prepare( 'SELECT count(*) AS count FROM draft_revisions' ).first() ).count, 1 );
	await page.evaluate( async () => { await globalThis.edit( 'Newer local revision while response is lost' ); globalThis.service.stop(); globalThis.repo.close(); } );
	await setup();
	await page.evaluate( async () => globalThis.service.start() );
	assert.deepEqual( await page.evaluate( async () => globalThis.repo.status( 'project' ) ), { localRevision: 2, acknowledgedRevision: 2, backedUp: true } );
	assert.equal( ( await db.prepare( 'SELECT count(*) AS count FROM drafts' ).first() ).count, 1 );
	assert.equal( ( await db.prepare( 'SELECT count(*) AS count FROM draft_revisions' ).first() ).count, 2 );
	assert.ok( requests.filter( item => item.method === 'POST' ).length >= 2 );
	assert.ok( requests.filter( item => item.method === 'POST' ).every( item => item.key === 'project:1' && item.revision === 1 ) );
	assert.equal( requests.find( item => item.method === 'PUT' ).match, '"0"' );
	reports.push( 'Lost creation response + page restart replay exact frozen revision/key/capability, then catch up newer revision with server precondition zero' );

	// Hold an actual PUT before forwarding it to the Worker, edit locally, then observe exact N acknowledgement.
	mode = 'hold';
	const sending = new Promise( resolve => { entered = resolve; } );
	await page.evaluate( async () => {

		await globalThis.edit( 'Frozen revision three' );
		const acknowledge = globalThis.repo.acknowledgeBackup.bind( globalThis.repo );
		globalThis.repo.acknowledgeBackup = async ( projectId, ack ) => {

			const result = await acknowledge( projectId, ack );
			if ( ack.revision === 3 ) globalThis.statusAfterThree = await globalThis.repo.status( projectId );
			return result;

		};
		globalThis.work = globalThis.service.notifyLocalCommit( 'project' );

	} );
	await sending;
	await page.evaluate( async () => { await globalThis.edit( 'Revision four during upload three' ); void globalThis.service.notifyLocalCommit( 'project' ); } );
	held();
	await page.evaluate( async () => globalThis.work );
	assert.deepEqual( await page.evaluate( () => globalThis.statusAfterThree ), { localRevision: 4, acknowledgedRevision: 3, backedUp: false } );
	assert.equal( ( await page.evaluate( async () => globalThis.repo.status( 'project' ) ) ).backedUp, true );
	assert.deepEqual( requests.filter( item => item.method === 'PUT' ).slice( - 2 ).map( item => [ item.revision, item.match ] ), [ [ 3, '"1"' ], [ 4, '"2"' ] ] );
	reports.push( 'Concurrent local N+1 cannot mutate the frozen wire revision N or become backed up by its late acknowledgement' );

	// Abort only the local acknowledgement after the real server has committed revision five.
	await page.evaluate( async () => {

		await globalThis.edit( 'Native ack abort' );
		const nativeDelete = IDBObjectStore.prototype.delete;
		IDBObjectStore.prototype.delete = function ( key ) {

			const result = nativeDelete.call( this, key );
			if ( this.name === 'outbox' && key[ 1 ] === 5 ) this.transaction.abort();
			return result;

		};
		try { await globalThis.service.notifyLocalCommit( 'project' ); } finally { IDBObjectStore.prototype.delete = nativeDelete; }

	} );
	assert.deepEqual( await page.evaluate( async () => {

		const state = await globalThis.repo.backupState( 'project' );
		return { serverRevision: state.serverRevision, acknowledgedRevision: state.acknowledgedRevision, flight: state.inFlight.revision, pending: ( await globalThis.repo.pending( 'project' ) ).some( item => item.revision === 5 ) };

	} ), { serverRevision: 3, acknowledgedRevision: 4, flight: 5, pending: true } );
	assert.equal( ( await db.prepare( 'SELECT count(*) AS count FROM draft_revisions' ).first() ).count, 5 );
	await page.evaluate( async () => globalThis.service.retry( 'project' ) );
	assert.equal( ( await db.prepare( 'SELECT count(*) AS count FROM draft_revisions' ).first() ).count, 5 );
	assert.equal( ( await page.evaluate( async () => globalThis.repo.status( 'project' ) ) ).backedUp, true );
	reports.push( 'Native acknowledgement transaction abort rolls back outbox deletion, server revision and local acknowledgement together; replay creates no duplicate remote revision' );

	// Lose an update response too, preserving its previous If-Match through page restart.
	mode = 'drop';
	await page.evaluate( async () => { await globalThis.edit( 'Lost update response' ); await globalThis.service.notifyLocalCommit( 'project' ); globalThis.service.stop(); globalThis.repo.close(); } );
	await setup();
	await page.evaluate( async () => globalThis.service.start() );
	assert.equal( ( await db.prepare( 'SELECT count(*) AS count FROM draft_revisions' ).first() ).count, 6 );
	assert.equal( ( await page.evaluate( async () => globalThis.repo.status( 'project' ) ) ).backedUp, true );
	assert.ok( requests.filter( item => item.revision === 6 ).length >= 2 );
	assert.ok( requests.filter( item => item.revision === 6 ).every( item => item.match === '"4"' && item.key === 'project:6' ) );
	reports.push( 'Lost PUT response replays original conditional request after restart without appending a duplicate' );

	// A second remote writer advances the same private draft; local changes must be preserved, not overwritten.
	await page.evaluate( async () => {

		const state = await globalThis.repo.backupState( 'project' );
		const remote = await globalThis.client.read( state );
		await globalThis.client.update( { ...state, requestId: 'another-device:7', document: { ...remote.document, revision: 7, name: 'Remote alternate' } } );
		await globalThis.edit( 'My conflicting local work' );
		await globalThis.service.notifyLocalCommit( 'project' );

	} );
	assert.deepEqual( await page.evaluate( async () => {

		const state = await globalThis.repo.backupState( 'project' );
		const copies = await globalThis.repo.recoveries( 'project' );
		const copy = await globalThis.repo.restoreRecovery( state.conflict.recoveryId, { projectId: 'recovered-independent' } );
		const json = await globalThis.repo.exportJSON( 'project' );
		return { local: ( await globalThis.repo.get( 'project' ) ).name, copied: copies[ 0 ].document.name, copyRevision: copy.revision, copyIdentity: ( await globalThis.repo.backupState( copy.projectId ) ).draftId ?? null,
			backedUp: ( await globalThis.repo.status( 'project' ) ).backedUp, portableSecret: json.includes( state.capability ), portableDraftId: json.includes( state.draftId ) };

	} ), { local: 'My conflicting local work', copied: 'My conflicting local work', copyRevision: 0, copyIdentity: null, backedUp: false, portableSecret: false, portableDraftId: false } );
	const beforeBlocked = requests.length;
	await page.evaluate( async () => globalThis.service.retry( 'project' ) );
	assert.equal( requests.length, beforeBlocked );
	reports.push( 'Real conditional conflict preserves local document and durable independent recovery copy; portable JSON excludes capability/draft identity; blocked retries cannot overwrite remote' );

	// A portable claim alone cannot verify a pinned base-scene version.
	const beforeUnverified = requests.length;
	await page.evaluate( async () => {

		const project = globalThis.createStudentProjectDocument( { projectId: 'empty-scene-only' } );
		project.baseScenes = { 'empty@v1': { sceneId: 'empty', version: 'v1', assets: [] } };
		await globalThis.repo.save( project, { expectedRevision: null } );
		await globalThis.repo.save( { ...project, revision: 1, name: 'Metadata-only scene edit' }, { expectedRevision: 0 } );
		await globalThis.service.notifyLocalCommit( project.projectId );

	} );
	const emptyResult = await page.evaluate( async () => ( { status: await globalThis.repo.status( 'empty-scene-only' ), events: globalThis.events.filter( event => event.projectId === 'empty-scene-only' ), retry: ( await globalThis.repo.backupState( 'empty-scene-only' ) ).retry } ) );
	assert.equal( emptyResult.status.backedUp, false );
	assert.ok( emptyResult.events.some( event => event.code === 'DEPENDENCIES_PENDING' ) );
	assert.equal( requests.length, beforeUnverified );
	reports.push( 'Unverified pinned base-scene claims remain pending and do not produce a false whole-project backup acknowledgement' );

	await page.evaluate( async () => { globalThis.service.stop(); globalThis.repo.close(); } );
	console.log( JSON.stringify( { browser: await browser.version(), backend: 'actual Worker / Miniflare D1 + R2', passed: reports.length, checks: reports }, null, 2 ) );

} finally {

	held?.();
	await browser?.close();
	server.closeAllConnections();
	await new Promise( resolve => server.close( resolve ) );
	await mf.dispose();

}
