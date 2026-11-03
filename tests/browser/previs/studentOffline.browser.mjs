// Real built assets, native Service Worker/CacheStorage/IndexedDB and offline navigation.
// Build first. Override STUDENT_BUILD_DIR for the isolated proof output.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { studentOfflinePlugin } from '../../../app/build/studentOfflinePlugin.js';

// Exercise the graph walker with shared static chunks; the real built entry
// below then verifies its emitted artifact against native browser storage.
const graph = {

	'student/index.html': { type: 'asset', source: '<script src="/assets/student.js"></script>' },
	'assets/student.js': { type: 'chunk', isEntry: true, name: 'student', fileName: 'assets/student.js', code: 'import(`./student-facade.js`)', imports: [ 'assets/shared.js' ], viteMetadata: { importedCss: new Set( [ 'assets/student.css' ] ) } },
	'assets/shared.js': { type: 'chunk', code: 'shared', imports: [] },
	'assets/student-facade.js': { type: 'chunk', code: 'export const facade = true;', imports: [] },
	'assets/student.css': { type: 'asset', source: 'body{}' },
	'assets/diagnostic.js': { type: 'chunk', isEntry: true, name: 'studentDiagnostic', code: 'diagnostic', imports: [] },

};
function generate( bundle ) {

	let emitted;
	studentOfflinePlugin().generateBundle.handler.call( { emitFile: asset => { emitted = asset; } }, {}, bundle );
	return emitted.source;

}
const graphWorker = generate( graph );
assert.ok( graphWorker.includes( '/assets/shared.js' ) && graphWorker.includes( '/assets/student.css' ) );
assert.ok( ! graphWorker.includes( '/assets/diagnostic.js' ) );
assert.ok( graphWorker.includes( '/assets/student-facade.js' ), 'Final emitted import facades must be cached even if metadata omits them' );
assert.equal( generate( { ...graph, 'assets/diagnostic.js': { ...graph[ 'assets/diagnostic.js' ], code: 'changed irrelevant entry' } } ), graphWorker );
assert.notEqual( generate( { ...graph, 'assets/student.css': { type: 'asset', source: 'body{color:red}' } } ), graphWorker, 'A shell dependency change versions the worker/cache' );

const root = resolve( process.env.STUDENT_BUILD_DIR || fileURLToPath( new URL( '../../../app/dist/', import.meta.url ) ) );
const publicManifest = JSON.parse( await readFile( resolve( root, 'student/edge-public-assets.json' ), 'utf8' ) );
for ( const entry of publicManifest.files ) {

	const path = resolve( root, `.${entry.path}${entry.path.endsWith( '/' ) ? 'index.html' : ''}` );
	assert.ok( path.startsWith( `${root}${sep}` ) );
	const bytes = await readFile( path );
	assert.equal( bytes.byteLength, entry.byteLength, `Built public asset size changed after manifest generation: ${entry.path}` );
	assert.equal( createHash( 'sha256' ).update( bytes ).digest( 'hex' ), entry.sha256, `Built public bytes changed after manifest generation: ${entry.path}` );

}
const originalWorker = await readFile( resolve( root, 'student/sw.js' ), 'utf8' );
const manifest = JSON.parse( originalWorker.match( /const PRECACHE = (\[[^\n]+\]);/ )[ 1 ] );
const originalCache = JSON.parse( originalWorker.match( /const CACHE_NAME = ("[^\n]+");/ )[ 1 ] );
assert.ok( manifest.includes( '/student/' ) && manifest.includes( '/student/index.html' ) );
assert.ok( manifest.some( path => /\/assets\/student-.*\.js$/.test( path ) ) );
assert.ok( ! manifest.some( path => /diagnostic|\.(?:glb|mp4|webm|hdr)$|\/api\/|\/share\//i.test( path ) ), 'Shell manifest excludes diagnostics/media/API/shares' );
let servedWorker = originalWorker;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = createServer( async ( request, response ) => {

	// Match the application's Vite preview isolation policy. Cached navigation
	// must preserve these headers too; hosted delivery is a separate acceptance gate.
	response.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' );
	response.setHeader( 'Cross-Origin-Embedder-Policy', 'credentialless' );
	try {

		const pathname = new URL( request.url, 'http://localhost' ).pathname;
		if ( pathname === '/student/sw.js' ) {

			response.writeHead( 200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' } );
			response.end( servedWorker );
			return;

		}
		if ( pathname === '/api/offline-boundary' || pathname === '/share/offline-boundary' ) {

			response.writeHead( 200, { 'content-type': 'text/plain' } );
			response.end( 'Network boundary only' );
			return;

		}
		const path = resolve( root, `.${decodeURIComponent( pathname )}${pathname.endsWith( '/' ) ? 'index.html' : ''}` );
		if ( ! path.startsWith( `${root}${sep}` ) ) throw new Error( 'Invalid path' );
		let content;
		try {

			content = await readFile( path );

		} catch ( error ) {

			// Isolated proof builds omit the admin entry: this sentinel checks the
			// registration boundary, and is never evidence of admin rendering.
			if ( pathname !== '/' ) throw error;
			content = '<!doctype html><title>Admin scope boundary probe</title>';

		}
		response.writeHead( 200, { 'content-type': mime[ extname( path ) ] || 'application/octet-stream', 'cache-control': 'no-store' } );
		response.end( content );

	} catch {

		response.writeHead( 404 );
		response.end();

	}

} );
await new Promise( done => server.listen( 0, '127.0.0.1', done ) );
const origin = `http://127.0.0.1:${server.address().port}`;
const reports = [];
let browser;
try {

	browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } );
	const page = await browser.newPage();
	const errors = [];
	page.on( 'pageerror', error => errors.push( error.message ) );
	await page.goto( `${origin}/student/`, { waitUntil: 'domcontentloaded' } );
	console.log('SHELL loaded'); await page.evaluate( () => navigator.serviceWorker.ready ); console.log('SHELL registered');
	await page.reload( { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => !!navigator.serviceWorker.controller );
	assert.equal( await page.evaluate( () => isSecureContext && crossOriginIsolated ), true );
	console.log('SHELL controlled'); const cached = await page.evaluate( async name => ( await ( await caches.open( name ) ).keys() ).map( request => new URL( request.url ).pathname ).sort(), originalCache );
	assert.deepEqual( cached, [ ...manifest ].sort() );
	await page.setOfflineMode( true );
	await page.goto( `${origin}/student/?ui=editor`, { waitUntil: 'domcontentloaded' } );
	assert.equal( await page.evaluate( () => location.search ), '' );
	assert.equal( await page.evaluate( () => isSecureContext && crossOriginIsolated ), true );
	for ( const path of [ '/v1/student/projects', '/api/offline-boundary', '/share/offline-boundary', '/models/not-prepared.glb' ] ) assert.equal( await page.evaluate( async path => { try { await fetch( path ); return false; } catch { return true; } }, path ), true );
	for ( const path of [ '/student/diagnostic/', '/student/?recovery=example', '/' ] ) assert.equal( await page.evaluate( async path => { try { await fetch( path ); return false; } catch { return true; } }, path ), true );
	await page.setOfflineMode( false );
	async function updateWorker( expectedState ) {
		return page.evaluate( async expectedState => {
			const registration = await navigator.serviceWorker.getRegistration();
			return new Promise( ( done, reject ) => {
				const timer = setTimeout( () => reject( new Error( 'Worker update timed out' ) ), 20000 );
				registration.addEventListener( 'updatefound', () => { const worker = registration.installing; const inspect = () => { if ( worker.state === expectedState ) { clearTimeout( timer ); done( worker.state ); } }; worker.addEventListener( 'statechange', inspect ); inspect(); }, { once: true } );
				registration.update().catch( error => { clearTimeout( timer ); reject( error ); } );
			} );
		}, expectedState );
	}
	console.log('SHELL excluded'); const failedCache = 'rayzee-student-shell-failed-install-proof';
	servedWorker = originalWorker.replace( /const CACHE_NAME = "[^\n]+";/, `const CACHE_NAME = ${JSON.stringify( failedCache )};` ).replace( /const PRECACHE = \[[^\n]+\];/, `const PRECACHE = ${JSON.stringify( [ ...manifest, '/missing-install-asset.js' ] )};` );
	assert.equal( await updateWorker( 'redundant' ), 'redundant' );
	assert.equal( await page.evaluate( name => caches.has( name ), originalCache ), true );
	assert.equal( await page.evaluate( name => caches.has( name ), failedCache ), false );
	console.log('SHELL failed update'); const upgradeCache = 'rayzee-student-shell-waiting-update-proof';
	servedWorker = originalWorker.replace( /const CACHE_NAME = "[^\n]+";/, `const CACHE_NAME = ${JSON.stringify( upgradeCache )};` );
	await page.evaluate( () => { globalThis.originalController = navigator.serviceWorker.controller; } );
	assert.equal( await updateWorker( 'installed' ), 'installed' );
	assert.equal( await page.evaluate( async () => { const r = await navigator.serviceWorker.getRegistration(); return Boolean( r.waiting ) && navigator.serviceWorker.controller === globalThis.originalController; } ), true );
	assert.deepEqual( errors, [] );
	reports.push( 'Exact editor graph cached; legacy navigation and isolation work offline; private/admin routes receive no fallback; failed update preserves shell and successful update waits.' );
	console.log( JSON.stringify( { passed: reports, buildDirectory: root, browser: await browser.version(), cache: originalCache }, null, 2 ) );

} finally {

	await browser?.close();
	await new Promise( done => server.close( done ) );

}
