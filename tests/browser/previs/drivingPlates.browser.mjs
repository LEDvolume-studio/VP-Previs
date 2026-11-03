import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const origin = process.env.PLATE_TEST_ORIGIN || 'http://127.0.0.1:5176';
const fixtures = resolve( process.env.PLATE_FIXTURE_DIR || '.local-runtime/plate-fixtures' );
const artifacts = resolve( '.local-runtime/plate-validation' );
await mkdir( artifacts, { recursive: true } );
const views = [ 'front', 'right', 'rear', 'left' ];
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } );
const report = { checks: [], errors: [] };
const clickButton = async ( page, text ) => {
 const handle = await page.evaluateHandle( text => [ ...document.querySelectorAll( 'button' ) ].find( node => node.textContent === text ), text );
 await handle.asElement().click(); await handle.dispose();
};
try {

	const page = await browser.newPage();
	await page.setViewport( { width: 1440, height: 1100 } ); page.setDefaultTimeout( 60000 );
	page.on( 'pageerror', error => report.errors.push( error.message ) );
	await page.goto( `${origin}/admin/driving-plates/` );
	await page.waitForSelector( '[aria-label="Prepared plate videos"]' );
	await page.type( '[aria-label="Plate location name"]', 'Synthetic four-view drive' );
	const input = await page.$( '[aria-label="Prepared plate videos"]' );
	await input.uploadFile( ...[ 'hevc', 'h264' ].flatMap( encoding => views.map( view => resolve( fixtures, `${view}-${encoding}.mp4` ) ) ) );
	await clickButton( page, 'Validate and save local set' );
	await page.waitForFunction( () => document.querySelector( '[role="status"]' ).textContent.includes( 'saved and ready' ) || document.querySelector( '[role="alert"]' ) );
	assert.equal( await page.$eval( '[role="status"]', node => node.textContent.includes( 'saved and ready' ) ), true, await page.$eval( 'body', node => node.textContent ) );
	report.checks.push( 'Eight real 720p25 MP4s pass inspection and commit to OPFS.' );
	await clickButton( page, 'Open preview' );
	await page.waitForFunction( () => document.querySelector( '.plate-readout' ).textContent.includes( 'frame 1 / 50' ) );
	const details = await page.evaluate( async () => {

		const { LocalPlateLibrary } = await import( '/src/services/plates/LocalPlateLibrary.js' );
		const { PlateSetSource } = await import( '/src/services/plates/PlateSetSource.js' );
		const library = new LocalPlateLibrary(), [ { manifest } ] = await library.list();
		const source = await PlateSetSource.open( library, manifest );
		const canvas = new OffscreenCanvas( 1280, 720 ), context = canvas.getContext( '2d' );
		const frames = [];
		for ( const heading of [ 0, 90, 180, 270 ] ) {

			const result = await source.drawAt( 17 / 25, context, { heading } );
			const pixels = context.getImageData( 0, 0, 1280, 720 ).data;
			const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', pixels ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			frames.push( { ...result, hash } );

		}
		let deletionBlocked = false;
		try { await library.remove( manifest.id ); } catch ( error ) { deletionBlocked = error.message.includes( 'another tab' ); }
		const encoding = source.encoding; await source.dispose();
		return { frames, encoding, deletionBlocked };

	} );
	assert.deepEqual( details.frames.map( frame => frame.view ), views );
	assert.ok( details.frames.every( frame => frame.frame === 17 && Math.abs( frame.timestamp - 0.68 ) < 0.00005 ) );
	assert.equal( new Set( details.frames.map( frame => frame.hash ) ).size, 4 );
	assert.equal( details.deletionBlocked, true );
	report.checks.push( `All angles decode source frame 17 at 0.68 s (${details.encoding}); distinct view pixels and playback leases verified.` );
	await page.screenshot( { path: resolve( artifacts, 'admin-plate-library.png' ), fullPage: true } );
	await page.reload();
	await page.waitForSelector( '.plate-card' );
	await page.select( 'select', 'h264' );
	await clickButton( page, 'Open preview' );
	await page.waitForFunction( () => document.querySelector( '.plate-readout' ).textContent.includes( 'H264 · front · frame 1' ) );
	await clickButton( page, 'Play plates' );
	await page.waitForFunction( () => document.querySelector( '.plate-readout' ).textContent.includes( 'frame 50 / 50' ) );
	report.checks.push( 'OPFS set survives reload; explicit H.264 playback reaches its exact last frame.' );
	const second = await browser.newPage();
	await second.goto( `${origin}/admin/driving-plates/` );
	await second.waitForSelector( '.plate-card' );
	assert.equal( await second.$$eval( '.plate-card.is-downloaded', nodes => nodes.length ), 1 );
	await second.close();
	report.checks.push( 'A second tab sees the same completed set.' );
	const student = await browser.newPage();
	await student.goto( `${origin}/student/?ui=editor`, { waitUntil: 'domcontentloaded' } );
	await student.waitForSelector( '.sim-header-actions' );
	await clickButton( student, 'Driving plates' );
	await student.waitForSelector( 'dialog[open] .plate-card' );
	assert.equal( await student.$( '[aria-label="Prepared plate videos"]' ), null );
	await student.keyboard.press( 'Escape' );
	await student.waitForFunction( () => ! document.querySelector( 'dialog[open]' ) );
	await student.close();
	report.checks.push( 'Student editor opens a read-only shared library; Escape closes the native modal.' );

	await page.reload();
	await page.waitForSelector( '.plate-card' );
	const integrity = await page.evaluate( async () => {

		const { LocalPlateLibrary } = await import( '/src/services/plates/LocalPlateLibrary.js' );
		const library = new LocalPlateLibrary(), [ { manifest } ] = await library.list();
		const directory = await ( await library.root() ).getDirectoryHandle( manifest.id );
		const handle = await directory.getFileHandle( 'front-h264.mp4' );
		const writer = await handle.createWritable( { keepExistingData: true } );
		await writer.write( new Uint8Array( [ 255 ] ) ); await writer.close();
		let failed = false;
		try { await library.filesFor( manifest, 'h264' ); } catch ( error ) { failed = error.message.includes( 'integrity' ); }
		await library.remove( manifest.id );
		return { failed, remaining: ( await library.list() ).length };

	} );
	assert.equal( integrity.failed, true ); assert.equal( integrity.remaining, 0 );
	report.checks.push( 'Same-length corruption is detected by chunk hashes; local removal cleans the set.' );
	assert.deepEqual( report.errors, [] );
	await writeFile( resolve( artifacts, 'report.json' ), JSON.stringify( report, null, 2 ) );
	console.log( JSON.stringify( report, null, 2 ) );

} finally {

	await browser.close();

}
