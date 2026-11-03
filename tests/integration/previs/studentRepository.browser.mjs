// Real Chromium IndexedDB tests. Run explicitly with node; this is not a Node/Map IDB mock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = resolve( fileURLToPath( new URL( '../../../', import.meta.url ) ) );
const server = createServer( async ( request, response ) => {

	try {

		const pathname = new URL( request.url, 'http://localhost' ).pathname;
		if ( pathname === '/' ) {

			response.writeHead( 200, { 'content-type': 'text/html' } );
			response.end( '<!doctype html><title>Student IndexedDB integration</title>' );
			return;

		}
		const path = resolve( root, `.${decodeURIComponent( pathname )}` );
		if ( ! path.startsWith( `${root}${sep}` ) ) throw new Error( 'Invalid path' );
		const source = await readFile( path );
		response.writeHead( 200, { 'content-type': 'text/javascript' } );
		response.end( source );

	} catch {

		response.writeHead( 404 );
		response.end();

	}

} );
await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const reports = [];
try {

	browser = await puppeteer.launch( {
		executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		headless: true,
	} );
	const page = await browser.newPage();
	const databaseName = `StudentRepository-test-${Date.now()}`;
	async function setup( target ) {

		await target.goto( origin );
		await target.evaluate( async databaseName => {

			const repositoryModule = await import( '/app/src/previs/persistence/StudentProjectRepository.js' );
			const schema = await import( '/app/src/previs/domain/StudentProjectSchema.js' );
			Object.assign( globalThis, repositoryModule, schema );
			globalThis.repo = new globalThis.StudentProjectRepository( { databaseName } );

		}, databaseName );

	}
	await setup( page );
	assert.equal( await page.evaluate( async () => {

		globalThis.document0 = globalThis.createStudentProjectDocument( { projectId: 'project-a', name: 'Original' } );
		await globalThis.repo.save( globalThis.document0, { expectedRevision: null } );
		const pending = await globalThis.repo.pending( 'project-a' );
		return ( await globalThis.repo.get( 'project-a' ) ).revision === 0 && pending.length === 1 && pending[ 0 ].revision === 0;

	} ), true );
	reports.push( 'Atomic initial document + immutable revision + outbox commit' );
	// Reload the harness first, then disconnect to prove reads do not depend on a server.
	// An offline application-shell reload needs a service worker, outside this repository slice.
	await page.reload();
	await setup( page );
	await page.setOfflineMode( true );
	assert.deepEqual( await page.evaluate( async () => ( { revision: ( await globalThis.repo.get( 'project-a' ) ).revision, pending: ( await globalThis.repo.pending( 'project-a' ) ).length } ) ), { revision: 0, pending: 1 } );
	await page.setOfflineMode( false );
	reports.push( 'Page restart recovers committed document and pending outbox; reads work with network disconnected' );

	assert.equal( await page.evaluate( async () => {

		const current = await globalThis.repo.get( 'project-a' );
		const nativeAdd = IDBObjectStore.prototype.add;
		IDBObjectStore.prototype.add = function ( ...args ) {

			const result = nativeAdd.apply( this, args );
			if ( this.name === 'outbox' ) this.transaction.abort();
			return result;

		};
		let failed = false;
		try {

			await globalThis.repo.save( { ...current, revision: 1, name: 'Must roll back' }, { expectedRevision: 0 } );

		} catch ( error ) {

			failed = error.code === 'TRANSACTION_FAILED';

		} finally {

			IDBObjectStore.prototype.add = nativeAdd;

		}
		return failed && ( await globalThis.repo.get( 'project-a' ) ).revision === 0 && await globalThis.repo.getRevision( 'project-a', 1 ) === null && ( await globalThis.repo.pending( 'project-a' ) ).length === 1;

	} ), true );
	reports.push( 'Real transaction abort rolls back project, revision and outbox together' );

	assert.equal( await page.evaluate( async () => {

		const current = await globalThis.repo.get( 'project-a' );
		const nativeAdd = IDBObjectStore.prototype.add;
		IDBObjectStore.prototype.add = function ( ...args ) {

			if ( this.name === 'outbox' ) throw new DOMException( 'Injected storage quota failure', 'QuotaExceededError' );
			return nativeAdd.apply( this, args );

		};
		let failed = false;
		try {

			await globalThis.repo.save( { ...current, revision: 1 }, { expectedRevision: 0 } );

		} catch ( error ) {

			failed = error.code === 'QUOTA_EXCEEDED';

		} finally {

			IDBObjectStore.prototype.add = nativeAdd;

		}
		return failed && ( await globalThis.repo.get( 'project-a' ) ).revision === 0;

	} ), true );
	reports.push( 'Injected quota exception aborts the native transaction and reports unsaved work' );

	const secondPage = await browser.newPage();
	await setup( secondPage );
	const write = target => target.evaluate( async () => {

		const current = await globalThis.repo.get( 'project-a' );
		try {

			await globalThis.repo.save( { ...current, revision: 1, name: location.href + Math.random() }, { expectedRevision: 0 } );
			return 'saved';

		} catch ( error ) {

			return error.code;

		}

	} );
	assert.deepEqual( ( await Promise.all( [ write( page ), write( secondPage ) ] ) ).sort(), [ 'REVISION_CONFLICT', 'saved' ] );
	assert.equal( await page.evaluate( async () => ( await globalThis.repo.recoveries( 'project-a' ) ).length ), 1 );
	assert.equal( await page.evaluate( async () => {

		const [ recovery ] = await globalThis.repo.recoveries( 'project-a' );
		const copy = await globalThis.repo.restoreRecovery( recovery.recoveryId, { projectId: 'recovery-copy' } );
		return copy.projectId === 'recovery-copy' && copy.revision === 0 && copy.name === recovery.document.name && ( await globalThis.repo.get( 'project-a' ) ).revision === 1;

	} ), true );
	reports.push( 'Concurrent tabs accept exactly one successor and durably preserve the losing edit' );
	await secondPage.close();

	assert.equal( await page.evaluate( async () => {

		const falseAck = await globalThis.repo.acknowledge( 'project-a', { revision: 1, requestId: 'wrong', dependenciesVerified: true } );
		await globalThis.repo.acknowledge( 'project-a', { revision: 0, requestId: 'project-a:0', dependenciesVerified: true } );
		const afterOldAck = await globalThis.repo.status( 'project-a' );
		const pending = await globalThis.repo.pending( 'project-a' );
		await globalThis.repo.acknowledge( 'project-a', { revision: 1, requestId: 'project-a:1', dependenciesVerified: true } );
		return falseAck === false && afterOldAck.backedUp === false && pending.length === 1 && pending[ 0 ].revision === 1 && ( await globalThis.repo.status( 'project-a' ) ).backedUp === true;

	} ), true );
	reports.push( 'Exact acknowledgements cannot mark a newer pending edit backed up' );
	assert.equal( await page.evaluate( async () => {

		await globalThis.repo.save( globalThis.createStudentProjectDocument( { projectId: 'reverse-ack' } ), { expectedRevision: null } );
		await globalThis.repo.save( { ...await globalThis.repo.get( 'reverse-ack' ), revision: 1 }, { expectedRevision: 0 } );
		await globalThis.repo.acknowledge( 'reverse-ack', { revision: 1, requestId: 'reverse-ack:1', dependenciesVerified: true } );
		await globalThis.repo.acknowledge( 'reverse-ack', { revision: 0, requestId: 'reverse-ack:0', dependenciesVerified: true } );
		return ( await globalThis.repo.status( 'reverse-ack' ) ).acknowledgedRevision === 1;

	} ), true );
	reports.push( 'Out-of-order old acknowledgement cannot move the acknowledged revision backwards' );

	assert.equal( await page.evaluate( async () => {

		const db = await globalThis.repo.init();
		await new Promise( ( resolve, reject ) => {

			const tx = db.transaction( 'sync', 'readwrite' );
			tx.objectStore( 'sync' ).put( { projectId: 'project-a', acknowledgedRevision: 1, privateCapability: 'SECRET-NOT-PORTABLE' } );
			tx.oncomplete = resolve;
			tx.onabort = reject;

		} );
		const json = await globalThis.repo.exportJSON( 'project-a' );
		const copy = await globalThis.repo.importJSON( json, { projectId: 'import-copy' } );
		return ! json.includes( 'SECRET-NOT-PORTABLE' ) && copy.projectId === 'import-copy' && copy.revision === 0 && ( await globalThis.repo.pending( 'import-copy' ) ).length === 1;

	} ), true );
	reports.push( 'Portable JSON excludes private sync records and imports with fresh ownership/revision' );
	assert.equal( await page.evaluate( async () => {

		const json = JSON.parse( await globalThis.repo.exportJSON( 'project-a' ) );
		json.privateCapability = 'malicious';
		try {

			await globalThis.repo.importJSON( JSON.stringify( json ), { projectId: 'bad-import' } );
			return false;

		} catch {

			return await globalThis.repo.get( 'bad-import' ) === null;

		}

	} ), true );
	reports.push( 'Credential-bearing portable input is rejected without creating a project' );

	assert.equal( await page.evaluate( async () => {

		await new Promise( ( resolve, reject ) => {

			const request = indexedDB.open( globalThis.repo.databaseName, 2 );
			request.onsuccess = () => { request.result.close(); resolve(); };
			request.onerror = () => reject( request.error );

		} );
		try {

			await globalThis.repo.get( 'project-a' );
			return false;

		} catch ( error ) {

			return error.code === 'VERSION_CHANGED';

		}

	} ), true );
	reports.push( 'Schema upgrade closes old connection and requires reload before further saves' );

	assert.equal( await page.evaluate( async () => {

		const name = `${globalThis.repo.databaseName}-blocked`;
		const old = await new Promise( ( resolve, reject ) => {

			const request = indexedDB.open( name, 1 );
			request.onsuccess = () => resolve( request.result );
			request.onerror = () => reject( request.error );

		} );
		// Delegation changes the target version, while retaining native browser blocking semantics.
		const blocked = new globalThis.StudentProjectRepository( { databaseName: name, databaseFactory: { open: name => indexedDB.open( name, 2 ) } } );
		let rejected = false;
		try {

			await blocked.init();

		} catch ( error ) {

			rejected = error.code === 'BLOCKED';

		} finally {

			old.close();

		}
		return rejected;

	} ), true );
	reports.push( 'Native blocked upgrade rejects with actionable storage error' );
	assert.equal( await page.evaluate( async () => {

		try {

			await new globalThis.StudentProjectRepository( { databaseFactory: null } ).init();
			return false;

		} catch ( error ) {

			return error.code === 'UNAVAILABLE';

		}

	} ), true );
	reports.push( 'Unavailable storage never returns a successful local save' );
	assert.equal( await page.evaluate( async () => {

		try {

			await new globalThis.StudentProjectRepository( { databaseFactory: { open: () => { throw new DOMException( 'Denied', 'SecurityError' ); } } } ).init();
			return false;

		} catch ( error ) {

			return error.code === 'UNAVAILABLE';

		}

	} ), true );
	reports.push( 'Synchronous browser storage denial is normalised to unavailable' );
	console.log( JSON.stringify( { browser: await browser.version(), passed: reports.length, checks: reports }, null, 2 ) );

} finally {

	await browser?.close();
	await new Promise( resolve => server.close( resolve ) );

}
