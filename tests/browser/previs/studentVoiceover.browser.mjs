import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const origin = process.env.STUDENT_TEST_ORIGIN || 'http://localhost:5173';
const artifacts = '/tmp/sim-trav-voiceover'; await mkdir( artifacts, { recursive: true } );
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 180000, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream' ] } );
const report = { checks: [], errors: [] };
let page;
try {

	page = await browser.newPage(); page.setDefaultTimeout( 120000 ); await page.setViewport( { width: 1586, height: 992 } );
	page.on( 'pageerror', error => report.errors.push( error.message ) );
	await page.goto( `${origin}/student/?ui=editor` );
	const ready = () => page.waitForFunction( () => ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled && !! document.querySelector( '#sim-viewport-host canvas' ) );
	const stored = () => page.evaluate( () => new Promise( resolve => {

		const request = indexedDB.open( 'RayzeeStudentDB', 1 ); request.onsuccess = () => {

			const db = request.result, tx = db.transaction( 'projects', 'readonly' ), rows = tx.objectStore( 'projects' ).getAll();
			tx.oncomplete = () => { db.close(); resolve( rows.result[ 0 ].document ); };

		};

	} ) );
	await ready();
	await page.locator( 'button::-p-text(Record voiceover)' ).click();
	await page.waitForFunction( () => [ ...document.querySelectorAll( 'button' ) ].some( button => button.textContent === 'Stop recording & save' ) );
	await new Promise( resolve => setTimeout( resolve, 1700 ) );
	await page.locator( 'button::-p-text(Stop recording & save)' ).click(); await ready();
	await page.waitForSelector( '.st-timeline-audio-clip' );
	const recorded = await stored(), clip = recorded.narration.clips[ 0 ];
	assert.ok( clip.lengthSamples > 0 ); assert.equal( clip.offsetFrames, 0 );
	const file = await page.evaluate( id => new Promise( resolve => {

		const request = indexedDB.open( 'RayzeeNarrationDB', 1 ); request.onsuccess = () => {

			const db = request.result, tx = db.transaction( 'recordings', 'readonly' ), row = tx.objectStore( 'recordings' ).get( id );
			tx.oncomplete = () => { db.close(); resolve( { size: row.result.blob.size, asset: row.result.asset } ); };

		};

	} ), clip.media.assetId );
	assert.ok( file.size > 0 ); assert.equal( file.asset.durationSamples, clip.lengthSamples );
	report.checks.push( 'Native MediaRecorder fake microphone produces a verified local IndexedDB audio file and a saved narration placement' );
	await page.reload(); await ready(); await page.waitForSelector( '.st-timeline-audio-clip' );
	assert.deepEqual( ( await stored() ).narration, recorded.narration );
	report.checks.push( 'Recording bytes and timeline placement survive reload' );
	await page.focus( '[aria-label="Voiceover 1"]' ); await page.keyboard.press( 'ArrowRight' ); await ready();
	assert.equal( ( await stored() ).narration.clips[ 0 ].offsetFrames, 1 );
	await page.focus( '[aria-label="Trim start of voiceover 1"]' ); await page.keyboard.press( 'ArrowRight' ); await ready();
	const leftTrim = ( await stored() ).narration.clips[ 0 ]; assert.ok( leftTrim.sourceStartSample > 0 ); assert.ok( leftTrim.lengthSamples < clip.lengthSamples );
	await page.focus( '[aria-label="Trim end of voiceover 1"]' ); await page.keyboard.press( 'ArrowLeft' ); await ready();
	assert.ok( ( await stored() ).narration.clips[ 0 ].lengthSamples < leftTrim.lengthSamples );
	report.checks.push( 'Reposition and both trim edges save bounded source offsets and lengths' );
	const beforeDrag = ( await stored() ).narration.clips[ 0 ];
	const audioBox = await ( await page.$( '.st-timeline-audio-clip' ) ).boundingBox();
	await page.mouse.move( audioBox.x + 16, audioBox.y + 16 ); await page.mouse.down(); await page.mouse.move( audioBox.x + 56, audioBox.y + 16, { steps: 8 } ); await page.mouse.up(); await ready();
	assert.ok( ( await stored() ).narration.clips[ 0 ].offsetFrames > beforeDrag.offsetFrames );
	const beforePointerTrim = ( await stored() ).narration.clips[ 0 ];
	const edge = await ( await page.$( '[aria-label="Trim end of voiceover 1"]' ) ).boundingBox();
	await page.mouse.move( edge.x + 4, edge.y + 12 ); await page.mouse.down(); await page.mouse.move( edge.x - 12, edge.y + 12, { steps: 5 } ); await page.mouse.up(); await ready();
	assert.ok( ( await stored() ).narration.clips[ 0 ].lengthSamples < beforePointerTrim.lengthSamples );
	report.checks.push( 'Native pointer dragging repositions audio and trims its right edge' );
	await page.evaluate( () => {

		window.voiceoverStarts = [];
		const original = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function ( ...args ) { window.voiceoverStarts.push( args ); return original.apply( this, args ); };

	} );
	await page.click( 'button[aria-label="Play sequence"]' );
	await page.waitForSelector( 'button[aria-label="Pause sequence"]' );
	await new Promise( resolve => setTimeout( resolve, 400 ) );
	await page.click( 'button[aria-label="Pause sequence"]' ); await ready();
	assert.deepEqual( await page.$$eval( '[role="alert"]', nodes => nodes.map( node => node.textContent ) ), [] );
	assert.ok( ( await page.evaluate( () => window.voiceoverStarts ) ).length > 0, 'Sequence playback must schedule decoded local audio' );
	report.checks.push( 'Saved local audio decodes and plays with sequence transport after reload' );
	await page.click( '[aria-label="Delete voiceover 1"]' ); await ready();
	assert.equal( ( await stored() ).narration.clips.length, 0 );
	await page.click( '[aria-label="Undo"]' ); await ready();
	assert.equal( ( await stored() ).narration.clips.length, 1 );
	report.checks.push( 'Delete and Undo restore the recording without losing its local file' );
	await page.evaluate( () => {

		window.originalNarrationPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function ( value, ...args ) {

			if ( value?.blob instanceof Blob ) throw new DOMException( 'Local voiceover storage is full', 'QuotaExceededError' );
			return window.originalNarrationPut.call( this, value, ...args );

		};

	} );
	await page.locator( 'button::-p-text(Record voiceover)' ).click();
	await page.waitForFunction( () => [ ...document.querySelectorAll( 'button' ) ].some( button => button.textContent === 'Stop recording & save' ) );
	await new Promise( resolve => setTimeout( resolve, 600 ) );
	await page.locator( 'button::-p-text(Stop recording & save)' ).click();
	await page.waitForFunction( () => [ ...document.querySelectorAll( 'button' ) ].some( button => button.textContent === 'Retry voiceover save' ) );
	assert.equal( ( await stored() ).narration.clips.length, 1, 'Failed audio persistence must not create a dangling placement' );
	await page.evaluate( () => { IDBObjectStore.prototype.put = window.originalNarrationPut; } );
	await page.locator( 'button::-p-text(Retry voiceover save)' ).click(); await ready();
	await page.waitForFunction( () => document.querySelectorAll( '.st-timeline-audio-clip' ).length === 2 );
	assert.equal( ( await stored() ).narration.clips.length, 2 );
	report.checks.push( 'A real IndexedDB write failure retains the take for retry and creates no dangling clip before audio saves' );
	const shotCount = ( await stored() ).clips.length;
	await page.click( '[aria-label="Delete shot placement 1"]' ); await ready();
	assert.equal( ( await stored() ).clips.length, shotCount - 1 );
	await page.click( '[aria-label="Undo"]' ); await ready();
	assert.equal( ( await stored() ).clips.length, shotCount );
	report.checks.push( 'Shot placements can also be deleted and restored with Undo' );
	await page.screenshot( { path: `${artifacts}/voiceover.png`, fullPage: true } );
	assert.deepEqual( report.errors, [] ); report.passed = true;

} catch ( error ) {

	report.failure = error.stack; report.alerts = await page?.$$eval( '[role="alert"]', nodes => nodes.map( node => node.textContent ) );
	await page?.screenshot( { path: `${artifacts}/failure.png` } ); process.exitCode = 1;

} finally {

	console.log( JSON.stringify( report, null, 2 ) ); await writeFile( `${artifacts}/report.json`, JSON.stringify( report, null, 2 ) ); await browser.close();

}
