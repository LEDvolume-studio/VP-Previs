import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const server = await createServer( { configFile: resolve( 'app/vite.previs.config.js' ), server: { port: 0, hmr: false } } );
let browser;
try {

	await server.listen();
	browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, timeout: 30000 } );
	const page = await browser.newPage(), errors = [];
	page.on( 'pageerror', error => errors.push( error.message ) );
	await page.setRequestInterception( true );
	page.on( 'request', request => new URL( request.url() ).pathname === '/src/student/main.js' ? request.abort() : request.continue() );
	await page.goto( new URL( '/student/', server.resolvedUrls.local[ 0 ] ).href );
	await page.evaluate( async path => {

		const { checkInspectorLoadingStates } = await import( path );
		const host = document.createElement( 'div' ); document.body.append( host );
		checkInspectorLoadingStates( host );

	}, `/@fs${resolve( 'tests/browser/previs/LEDBlurInspectorHarness.jsx' )}` );
	assert.deepEqual( errors, [] );
	console.log( 'PASS: inspector renders before a shot loads with missing, null and stale blur comparisons.' );

} finally {

	await browser?.close(); await server.close();

}
