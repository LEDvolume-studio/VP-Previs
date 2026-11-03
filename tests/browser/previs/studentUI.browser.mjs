// Requires the isolated Vite server, e.g. npx vite --config app/vite.previs.config.js --port 5177.
// Uses real Chromium DOM interactions and IndexedDB, including injected native transaction failure.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const origin = process.env.STUDENT_TEST_ORIGIN || 'http://127.0.0.1:5177';
const downloadDirectory = await mkdtemp( join( tmpdir(), 'rayzee-student-ui-' ) );
const reports = [];
const errors = [];
let browser;
try {

	browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: [ '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ] } );
	const page = await browser.newPage();
	page.on( 'pageerror', error => errors.push( error.message ) );
	await page.setViewport( { width: 1440, height: 1000 } );
	await page.goto( `${origin}/student/` );
	await page.waitForFunction( () => ! document.querySelector( '#new-project' )?.disabled );
	const connection = await page.createCDPSession();
	await connection.send( 'Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory } );
	const saved = async target => target.waitForFunction( () => document.querySelector( '#save-status' )?.dataset.kind === 'saved' && ! document.querySelector( '#new-project' )?.disabled, { polling: 50 } );
	const projects = target => target.evaluate( () => new Promise( ( resolve, reject ) => {

		const request = indexedDB.open( 'RayzeeStudentDB', 1 );
		request.onerror = () => reject( request.error );
		request.onsuccess = () => {

			const db = request.result;
			const transaction = db.transaction( 'projects', 'readonly' );
			const rows = transaction.objectStore( 'projects' ).getAll();
			transaction.oncomplete = () => { db.close(); resolve( rows.result.map( row => row.document ) ); };
			transaction.onabort = () => { db.close(); reject( transaction.error ); };

		};

	} ) );
	const rename = async ( target, name, shouldSave = true ) => {

		await target.bringToFront();
		await target.$eval( '#project-name', ( element, name ) => { element.value = name; }, name );
		await target.$eval( '#rename-form', form => form.requestSubmit() );
		if ( shouldSave ) await saved( target );

	};
	await page.click( '#new-project' );
	await saved( page );
	assert.equal( ( await projects( page ) ).length, 1 );
	const originalId = ( await projects( page ) )[ 0 ].projectId;
	await rename( page, 'Morning <sequence> & test' );
	assert.equal( ( await projects( page ) )[ 0 ].name, 'Morning <sequence> & test' );
	assert.match( await page.$eval( '#save-status', element => element.textContent ), /Cloud backup is not connected/ );
	reports.push( 'Create and rename save actual native IndexedDB revisions; unconnected cloud status is explicit' );

	const beforeCustomRevision = ( await projects( page ) )[ 0 ].revision;
	await page.click( '#add-empty-shot' );
	await saved( page );
	let customDocument = ( await projects( page ) )[ 0 ];
	assert.equal( customDocument.revision, beforeCustomRevision + 1 );
	assert.equal( Object.keys( customDocument.baseScenes ).length, 1 );
	await page.click( '#undo' );
	await saved( page );
	customDocument = ( await projects( page ) )[ 0 ];
	assert.equal( Object.keys( customDocument.shots ).length, 0 );
	assert.equal( Object.keys( customDocument.baseScenes ).length, 0 );
	await page.click( '#redo' );
	await saved( page );
	customDocument = ( await projects( page ) )[ 0 ];
	assert.equal( Object.keys( customDocument.shots ).length, 1 );
	assert.equal( Object.keys( customDocument.baseScenes ).length, 1 );
	await page.waitForSelector( '[data-add-placement]' );
	await page.click( '[data-add-placement]' );
	await saved( page );
	await page.click( '[data-duplicate-shot]' );
	await saved( page );
	const shots = ( await projects( page ) )[ 0 ].shots;
	assert.equal( Object.keys( shots ).length, 2 );
	assert.equal( Object.values( shots )[ 0 ].sourcePreset, null );
	await page.click( '[data-duplicate-clip]' );
	await saved( page );
	assert.equal( ( await projects( page ) )[ 0 ].clips.length, 2 );
	await page.$eval( '[data-duration-form] input', element => { element.value = '1'; } );
	await page.$eval( '[data-duration-form]', form => form.requestSubmit() );
	await saved( page );
	assert.equal( ( await projects( page ) )[ 0 ].clips[ 0 ].durationFrames, 1 );
	await page.click( '[data-move][data-index="1"]' );
	await saved( page );
	assert.equal( ( await projects( page ) )[ 0 ].clips[ 1 ].durationFrames, 1 );
	await page.click( '#undo' );
	await saved( page );
	assert.equal( ( await projects( page ) )[ 0 ].clips[ 0 ].durationFrames, 1 );
	const undoRevision = ( await projects( page ) )[ 0 ].revision;
	await page.click( '#redo' );
	await saved( page );
	assert.equal( ( await projects( page ) )[ 0 ].clips[ 1 ].durationFrames, 1 );
	assert.equal( ( await projects( page ) )[ 0 ].revision, undoRevision + 1 );
	await page.click( '#seek-end' );
	assert.match( await page.$eval( '#transport-position', element => element.textContent ), /Frame 126 \/ 126.*End of sequence/ );
	assert.equal( await page.$eval( '#play', button => button.disabled ), true, 'Empty custom setups must not pretend to render scene playback' );
	reports.push( 'Independent empty shot snapshots, placement duration/order, monotonic undo/redo, and exact transport endpoint' );

	await page.click( '#download-project' );
	let downloadPath;
	for ( let attempt = 0; attempt < 100; attempt ++ ) {

		const files = ( await readdir( downloadDirectory ) ).filter( name => name.endsWith( '.json' ) );
		if ( files.length ) { downloadPath = join( downloadDirectory, files[ 0 ] ); break; }
		await new Promise( resolve => setTimeout( resolve, 50 ) );

	}
	assert.ok( downloadPath, 'A real portable download was created' );
	const downloaded = JSON.parse( await readFile( downloadPath, 'utf8' ) );
	assert.equal( downloaded.projectId, originalId );
	assert.equal( downloaded.clips.length, 2 );
	await ( await page.$( '#import-file' ) ).uploadFile( downloadPath );
	await saved( page );
	const afterImport = await projects( page );
	assert.equal( afterImport.length, 2 );
	const imported = afterImport.find( value => value.projectId !== originalId );
	assert.equal( imported.revision, 0 );
	assert.deepEqual( imported.shots, downloaded.shots );
	await page.click( '#duplicate-project' );
	await saved( page );
	assert.equal( ( await projects( page ) ).length, 3 );
	assert.ok( ( await projects( page ) ).some( value => value.name.endsWith( ' copy' ) && value.revision === 0 ) );
	const invalidPath = join( downloadDirectory, 'invalid.json' );
	await writeFile( invalidPath, JSON.stringify( { format: 'rayzee-project', token: 'should-not-import' } ) );
	await ( await page.$( '#import-file' ) ).uploadFile( invalidPath );
	await page.waitForFunction( () => document.querySelector( '#operation-error' ).textContent.length > 0 && ! document.querySelector( '#new-project' ).disabled );
	assert.equal( ( await projects( page ) ).length, 3 );
	reports.push( 'Actual JSON download, validated import with fresh project identity, duplicate, and invalid import rejection' );

	await page.reload();
	await page.waitForSelector( `[data-open="${originalId}"]` );
	await page.click( `[data-open="${originalId}"]` );
	await saved( page );
	assert.equal( await page.$eval( '#project-name', element => element.value ), downloaded.name );
	await projects( page );
	await page.setOfflineMode( true );
	await rename( page, 'Edited with network disconnected' );
	assert.equal( ( await projects( page ) ).find( value => value.projectId === originalId ).name, 'Edited with network disconnected' );
	await page.setOfflineMode( false );
	reports.push( 'Reload restores local documents and network-disconnected completed edits still save' );

	await page.evaluate( () => {

		globalThis.studentNativeAdd = IDBObjectStore.prototype.add;
		IDBObjectStore.prototype.add = function ( ...arguments_ ) {

			if ( this.name === 'outbox' ) throw new DOMException( 'Injected quota failure', 'QuotaExceededError' );
			return globalThis.studentNativeAdd.apply( this, arguments_ );

		};

	} );
	await rename( page, 'Preserve attempted quota edit', false );
	await page.waitForFunction( () => document.querySelector( '#save-status' ).dataset.kind === 'error' );
	assert.match( await page.$eval( '#save-status', element => element.textContent ), /Not saved/ );
	assert.equal( await page.$eval( '#new-project', element => element.disabled ), true );
	assert.equal( await page.$eval( '#import-file', element => element.disabled ), true );
	assert.equal( ( await projects( page ) ).find( value => value.projectId === originalId ).name, 'Edited with network disconnected' );
	await page.evaluate( () => { IDBObjectStore.prototype.add = globalThis.studentNativeAdd; } );
	await page.click( '#retry-save' );
	await saved( page );
	assert.equal( ( await projects( page ) ).find( value => value.projectId === originalId ).name, 'Preserve attempted quota edit' );
	reports.push( 'Injected real transaction quota failure never reports saved; pending edit survives and retry commits it' );

	const second = await browser.newPage();
	second.on( 'pageerror', error => errors.push( error.message ) );
	await second.goto( `${origin}/student/` );
	await second.waitForSelector( `[data-open="${originalId}"]` );
	await second.click( `[data-open="${originalId}"]` );
	await saved( second );
	await rename( page, 'Other tab wins' );
	await rename( second, 'Losing edit is recoverable', false );
	await second.waitForFunction( () => document.querySelector( '#save-status' ).dataset.kind === 'conflict' );
	assert.equal( ( await projects( page ) ).find( value => value.projectId === originalId ).name, 'Other tab wins' );
	await second.click( '#restore-conflict' );
	await saved( second );
	assert.equal( ( await projects( second ) ).length, 4 );
	assert.ok( ( await projects( second ) ).some( value => value.projectId !== originalId && value.name === 'Losing edit is recoverable' ) );
	await page.bringToFront();
	await page.reload();
	await page.waitForSelector( `[data-open="${originalId}"]` );
	await page.click( `[data-open="${originalId}"]` );
	await saved( page );
	await page.waitForSelector( '[data-restore]' );
	reports.push( 'Two real tabs preserve conflicting edits, restore to a fresh project, and expose durable recovery copies after reload' );

	await page.setViewport( { width: 390, height: 844 } );
	assert.equal( await page.evaluate( () => document.documentElement.scrollWidth <= innerWidth ), true );
	assert.deepEqual( errors, [] );
	console.log( JSON.stringify( { browser: await browser.version(), passed: reports.length, checks: reports }, null, 2 ) );

} catch ( error ) {

	console.error( JSON.stringify( { completed: reports, errors, pages: await Promise.all( ( await browser?.pages() || [] ).map( async page => ( { url: page.url(), state: await page.evaluate( () => ( { status: document.querySelector( '#save-status' )?.textContent, message: document.querySelector( '#operation-error' )?.textContent, transport: document.querySelector( '#transport-position' )?.textContent } ) ).catch( () => null ) } ) ) ) }, null, 2 ) );
	throw error;

} finally {

	await browser?.close();
	await rm( downloadDirectory, { recursive: true, force: true } );

}
