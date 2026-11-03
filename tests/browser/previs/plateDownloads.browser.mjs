import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const origin = process.env.PLATE_TEST_ORIGIN || 'http://127.0.0.1:5176';
const forceH264 = process.env.PLATE_FORCE_H264 === 'true';
const artifacts = resolve( `.local-runtime/plate-download-validation${forceH264 ? '-h264' : ''}` ); await mkdir( artifacts, { recursive: true } );
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 180000 } );
const report = { checks: [], errors: [], ranges: [] };
const click = async ( page, text ) => {

	const handle = await page.evaluateHandle( text => [ ...document.querySelectorAll( 'button' ) ].find( node => node.textContent === text ), text );
	await handle.asElement().click(); await handle.dispose();

};
try {

	const page = await browser.newPage();
	if ( forceH264 ) await page.evaluateOnNewDocument( () => {
	 const original = VideoDecoder.isConfigSupported.bind( VideoDecoder );
	 VideoDecoder.isConfigSupported = config => /^(hvc1|hev1)/.test( config.codec ) ? Promise.resolve( { supported: false, config } ) : original( config );
	} ); await page.setViewport( { width: 1440, height: 1100 } ); page.setDefaultTimeout( 90000 );
	page.on( 'pageerror', error => report.errors.push( error.message ) );
	let failedOnce = false;
	await page.setRequestInterception( true );
	page.on( 'request', async request => {

		if ( /\/(front|right|rear|left)-(hevc|h264)\.mp4$/.test( new URL( request.url() ).pathname ) ) {

			const range = request.headers().range; report.ranges.push( { path: new URL( request.url() ).pathname, range } );
			if ( ! failedOnce && range?.startsWith( 'bytes=8388608-' ) ) { failedOnce = true; return request.abort( 'failed' ); }
			await new Promise( resolve => setTimeout( resolve, 90 ) );

		}
		request.continue();

	} );
	await page.goto( `${origin}/admin/driving-plates/` ); await page.waitForSelector( '.plate-card img' );
	await page.waitForFunction( () => document.querySelector( '.plate-card img' ).naturalWidth === 640 );
	assert.equal( report.ranges.length, 0 );
	await page.hover( '.plate-card' );
	await page.waitForFunction( () => document.querySelector( '.plate-card video' )?.videoWidth === 480 );
	assert.equal( report.ranges.length, 0 ); await page.mouse.move( 4, 4 );
	report.checks.push( 'Front-camera thumbnail and 480px hover preview load without fetching any full plate file.' ); console.log( report.checks.at( -1 ) );
	await click( page, 'Download set' );
	await page.waitForFunction( () => document.querySelector( '.plate-download-progress progress' )?.value >= 9 );
	await page.screenshot( { path: resolve( artifacts, 'download-progress.png' ), fullPage: true } );
	await click( page, 'Pause download' );
	await page.waitForFunction( () => [ ...document.querySelectorAll( 'button' ) ].some( node => node.textContent === 'Resume download' ) );
	const checkpoint = await page.evaluate( async () => {

		const { LocalPlateLibrary } = await import( '/src/services/plates/LocalPlateLibrary.js' );
		const library = new LocalPlateLibrary(), root = await library.root();
		for await ( const [ id, directory ] of root.entries() ) {

			try {

				const file = await ( await directory.getFileHandle( 'download.json' ) ).getFile();
				const { encoding } = JSON.parse( await file.text() ), parts = [];
				for await ( const [ name, handle ] of directory.entries() ) if ( name.startsWith( 'part-' ) && ( await handle.getFile() ).size > 0 ) parts.push( name );
				return { id, encoding, parts, ready: ( await library.list() ).length };

			} catch { /* Other local directories are irrelevant. */ }

		}

	} );
	assert.ok( checkpoint.parts.length >= 2 ); assert.equal( checkpoint.ready, 0 );
	await page.reload();
	await page.waitForFunction( () => [ ...document.querySelectorAll( 'button' ) ].some( node => node.textContent === 'Resume download' ) );
	const afterReload = report.ranges.length;
	await click( page, 'Resume download' );
	await page.waitForSelector( '.plate-badge.downloaded', { timeout: 180000 } );
	const resumed = report.ranges.slice( afterReload );
	for ( const part of checkpoint.parts ) {

		const match = /^part-(.+)-(\d+)$/.exec( part ), start = Number( match[ 2 ] ) * 4 * 1024 * 1024;
		assert.equal( resumed.some( item => item.path.endsWith( `/${match[ 1 ]}.mp4` ) && item.range.startsWith( `bytes=${start}-` ) ), false, `Verified checkpoint ${part} must not be downloaded again` );

	}
	assert.ok( failedOnce ); report.checks.push( 'Real transfer retries a failed request, pauses, survives reload and resumes without refetching verified chunks.' ); console.log( report.checks.at( -1 ) );
	await page.waitForFunction( () => document.querySelector( '.plate-card img' ).src.startsWith( 'blob:' ) );
	const stored = await page.evaluate( async () => {

		const { LocalPlateLibrary } = await import( '/src/services/plates/LocalPlateLibrary.js' );
		const library = new LocalPlateLibrary(), [ record ] = await library.list();
		const directory = await ( await library.root() ).getDirectoryHandle( record.manifest.id ), names = [];
		for await ( const [ name ] of directory.entries() ) names.push( name );
		return { ready: record.ready, encodings: record.manifest.downloadedEncodings, names };

	} );
	assert.equal( stored.ready, true ); assert.deepEqual( stored.encodings, [ checkpoint.encoding ] );
	assert.equal( stored.names.filter( name => /-(hevc|h264)\.mp4$/.test( name ) ).length, 4 );
	assert.ok( stored.names.includes( 'thumbnail.jpg' ) && stored.names.includes( 'preview.mp4' ) );
	assert.equal( stored.names.some( name => name.startsWith( 'part-' ) ), false );
	await page.screenshot( { path: resolve( artifacts, 'downloaded-gallery.png' ), fullPage: true } );
	await page.reload(); await page.waitForSelector( '.plate-badge.downloaded' );
	await page.waitForFunction( () => document.querySelector( '.plate-card img' ).src.startsWith( 'blob:' ) );
	await page.setOfflineMode( true );
	await click( page, 'Open preview' );
	await page.waitForFunction( () => document.querySelector( '.plate-readout' ).textContent.includes( 'frame 1 / 4500' ) );
	assert.equal( await page.$eval( '[aria-label="Selected driving plate view"]', node => node.height ), 890 );
	const exact = await page.evaluate( async () => {

		const { LocalPlateLibrary } = await import( '/src/services/plates/LocalPlateLibrary.js' );
		const { PlateSetSource } = await import( '/src/services/plates/PlateSetSource.js' );
		const library = new LocalPlateLibrary(), [ { manifest } ] = await library.list(), source = await PlateSetSource.open( library, manifest );
		const context = new OffscreenCanvas( 1280, 890 ).getContext( '2d' ), frames = [];
		for ( const heading of [ 0, 90, 180, 270 ] ) frames.push( await source.drawAt( 179.96, context, { heading } ) );
		await source.dispose(); return frames;

	} );
	assert.ok( exact.every( frame => frame.frame === 4499 && Math.abs( frame.timestamp - 179.96 ) < 0.00005 ) );
	report.checks.push( 'Only four selected-encoding files are stored; cached thumbnail, preview and all four exact final frames work with networking disabled.' ); console.log( report.checks.at( -1 ) );
	await page.screenshot( { path: resolve( artifacts, 'offline-plate-preview.png' ), fullPage: true } );
	await page.setOfflineMode( false ); await page.reload(); await page.waitForSelector( '.plate-badge.downloaded' );
	await page.evaluate( async () => {
	 const { LocalPlateLibrary } = await import( '/src/services/plates/LocalPlateLibrary.js' );
	 const library = new LocalPlateLibrary(), [ { manifest } ] = await library.list();
	 const directory = await ( await library.root() ).getDirectoryHandle( manifest.id );
	 const handle = await directory.getFileHandle( `front-${manifest.downloadedEncodings[0]}.mp4` );
	 const writer = await handle.createWritable( { keepExistingData: true } );
	 await writer.write( new Uint8Array( [ 255 ] ) ); await writer.close();
	} );
	await click( page, 'Open preview' );
	await page.waitForFunction( () => [ ...document.querySelectorAll( 'button' ) ].some( node => node.textContent === 'Repair download' ) );
	const beforeRepair = report.ranges.length;
	await click( page, 'Repair download' ); await page.waitForSelector( '.plate-badge.downloaded' );
	assert.ok( report.ranges.slice( beforeRepair ).every( item => item.path.includes( '/front-' ) ), 'Repair must retain the three intact files' );
	await click( page, 'Open preview' );
	await page.waitForFunction( () => document.querySelector( '.plate-readout' ).textContent.includes( 'frame 1 / 4500' ) );
	report.checks.push( 'Same-length damage becomes Repair download; only the damaged view is fetched again and playback is restored.' );
	console.log( report.checks.at( -1 ) );
	assert.deepEqual( report.errors, [] );
	await writeFile( resolve( artifacts, 'report.json' ), JSON.stringify( report, null, 2 ) );
	console.log( JSON.stringify( { ...report, ranges: `${report.ranges.length} bounded range requests` }, null, 2 ) );

} finally { await browser.close(); }
