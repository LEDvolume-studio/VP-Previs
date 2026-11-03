// Built student UI + native IndexedDB + actual local Worker/D1/R2, without a rebuild between publications.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import puppeteer from 'puppeteer-core';
import { studentFixture } from '../../unit/previs/studentFixtures.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const root = fileURLToPath( new URL( '../../../', import.meta.url ) );
const output = resolve( root, 'app/dist' );
const password = randomUUID(), salt = randomBytes( 16 );
const settings = {
	ENVIRONMENT: 'test', ALLOW_LOCAL_GEO_EXEMPTION: 'true', ENABLE_CATALOGUE_API: 'true',
	MAX_JSON_BYTES: '1048576', MAX_LIBRARY_ASSET_BYTES: '67108864',
	ADMIN_PASSWORD_VERIFIER: `pbkdf2-sha256$1000$${salt.toString( 'base64url' )}$${pbkdf2Sync( password, salt, 1000, 32, 'sha256' ).toString( 'base64url' )}`,
	ADMIN_SESSION_SECRET: randomBytes( 32 ).toString( 'base64url' ),
};
const script = ( await build( { entryPoints: [ resolve( root, 'backend/src/worker.js' ) ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[ 0 ].text;
const mf = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', d1Databases: [ 'DB', 'ADMIN_AUTH_DB' ], r2Buckets: [ 'LIBRARY' ], bindings: settings } );
let server, browser;
const checks = [], requests = [], errors = [];
try {

	const db = await mf.getD1Database( 'DB' ), auth = await mf.getD1Database( 'ADMIN_AUTH_DB' );
	for ( const name of ( await readdir( resolve( root, 'backend/migrations' ) ) ).filter( name => /^\d+.*\.sql$/.test( name ) ).sort() ) {

		const sql = await readFile( resolve( root, 'backend/migrations', name ), 'utf8' );
		await db.batch( splitSql( sql ).map( query => db.prepare( query ) ) );
		if ( name === '0003_admin_password.sql' ) await auth.batch( splitSql( sql ).map( query => auth.prepare( query ) ) );

	}
	const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
	server = createServer( async ( request, response ) => {

		try {

			const url = new URL( request.url, `http://${request.headers.host}` );
			if ( url.pathname.startsWith( '/v1/' ) ) {

				const chunks = [];
				for await ( const chunk of request ) chunks.push( chunk );
				const bytes = Buffer.concat( chunks ), headers = { ...request.headers };
				delete headers.host; delete headers.connection; delete headers[ 'content-length' ];
				const result = await mf.dispatchFetch( url.href, { method: request.method, headers, ...( bytes.length ? { body: bytes } : {} ) } );
				// Record only public read paths/statuses, never passwords/cookies or uploaded content.
				if ( request.method === 'GET' && url.pathname.startsWith( '/v1/catalogue' ) ) requests.push( { path: url.pathname, status: result.status } );
				const resultBytes = Buffer.from( await result.arrayBuffer() );
				response.writeHead( result.status, Object.fromEntries( result.headers ) );
				response.end( resultBytes );
				return;

			}
			const path = resolve( output, `.${decodeURIComponent( url.pathname )}${url.pathname.endsWith( '/' ) ? 'index.html' : ''}` );
			if ( ! path.startsWith( `${output}${sep}` ) ) throw new Error( 'Outside build output' );
			const bytes = await readFile( path );
			response.writeHead( 200, { 'Content-Type': mime[ path.slice( path.lastIndexOf( '.' ) ) ] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } );
			response.end( bytes );

		} catch {

			if ( response.headersSent ) response.destroy();
			else { response.writeHead( 404 ); response.end( 'Local integration resource unavailable' ); }

		}

	} );
	await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	const origin = `http://127.0.0.1:${server.address().port}`;
	const login = await fetch( `${origin}/v1/admin/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify( { password } ) } );
	assert.equal( login.status, 200 );
	const cookie = login.headers.get( 'set-cookie' ).split( ';' )[ 0 ];
	await login.arrayBuffer();
	const admin = ( path, { body, raw, headers = {}, method = 'PUT' } = {} ) => fetch( `${origin}/v1/admin/catalogue${path}`, { method, headers: { Origin: origin, Cookie: cookie, ...( body ? { 'Content-Type': 'application/json' } : {} ), ...headers }, body: raw ?? ( body ? JSON.stringify( body ) : undefined ) } );
	const assets = {};
	for ( const [ assetId, source, kind, mimeType, durationUs ] of [ [ 'wall', 'app/public/models/led/main-led-volume-wall.glb', 'model', 'model/gltf-binary', null ], [ 'video', 'tests/unit/previs/fixtures/led-test-h264.mp4', 'video', 'video/mp4', 10000000 ] ] ) {

		const bytes = await readFile( resolve( root, source ) );
		const asset = { assetId, version: '1', kind, sha256: createHash( 'sha256' ).update( bytes ).digest( 'hex' ), byteLength: bytes.byteLength, mimeType, durationUs };
		assets[ `${assetId}@1` ] = asset;
		const result = await admin( `/assets/${assetId}/1`, { raw: bytes, headers: { 'Content-Type': mimeType, 'X-Asset-Metadata': JSON.stringify( asset ) } } );
		assert.ok( result.ok, await result.text() );

	}
	const snapshot = studentFixture().shots.shotA.snapshot;
	snapshot.nodes = {};
	snapshot.ledWalls[ 0 ].inPointUs = 0;
	const preset = { format: 'rayzee-student-preset', schemaVersion: 1, presetId: 'teacher-wide', version: '1', name: 'Wide <studio>', description: 'Teacher description <img src=x onerror=alert(1)>', category: 'Studio', defaultDurationFrames: 125, thumbnail: null, assets, baseScene: { sceneId: 'wall-scene', version: '1', assets: [ { assetId: 'wall', version: '1' } ] }, snapshot };
	const publish = ( content, headers ) => admin( `/presets/${content.presetId}/${content.version}`, { body: content, headers: { 'Idempotency-Key': `publish-${content.version}`, ...headers } } );
	browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } );
	const page = await browser.newPage();
	page.on( 'pageerror', error => errors.push( error.message ) );
	await page.goto( `${origin}/student/` );
	await page.waitForFunction( () => ! document.querySelector( '#new-project' )?.disabled );
	const saved = () => page.waitForFunction( () => document.querySelector( '#save-status' )?.dataset.kind === 'saved' && ! document.querySelector( '#new-project' )?.disabled );
	const documents = () => page.evaluate( () => new Promise( ( resolve, reject ) => {

		const request = indexedDB.open( 'RayzeeStudentDB', 1 );
		request.onerror = () => reject( request.error );
		request.onsuccess = () => {

			const db = request.result, transaction = db.transaction( 'projects', 'readonly' );
			const rows = transaction.objectStore( 'projects' ).getAll();
			transaction.oncomplete = () => { db.close(); resolve( rows.result.map( row => row.document ) ); };
			transaction.onabort = () => { db.close(); reject( transaction.error ); };

		};

	} ) );
	await page.click( '#new-project' ); await saved();
	await page.click( '#refresh-catalogue' );
	await page.waitForFunction( () => document.querySelector( '#catalogue-status' )?.textContent.includes( 'No teacher presets' ) );
	checks.push( 'Fresh student browser reads the real empty catalogue without an admin session' );
	const published = await publish( preset, { 'If-None-Match': '*' } );
	assert.equal( published.status, 201, await published.clone().text() );
	const firstHead = published.headers.get( 'etag' ); await published.arrayBuffer();
	await page.click( '#refresh-catalogue' );
	await page.waitForSelector( '[data-add-preset]' );
	assert.equal( await page.$eval( '[aria-label="Teacher preset library"] img', () => true ).catch( () => false ), false );
	const before = ( await documents() )[ 0 ].revision;
	await page.click( '[data-add-preset]' ); await saved();
	let stored = ( await documents() )[ 0 ];
	assert.equal( stored.revision, before + 1 ); assert.equal( stored.clips.length, 1 );
	assert.equal( Object.keys( stored.assets ).length, 2 );
	assert.equal( Object.values( stored.shots )[ 0 ].sourcePreset.version, '1' );
	assert.deepEqual( Object.values( stored.shots )[ 0 ].snapshot, preset.snapshot );
	assert.ok( requests.some( request => request.status === 304 ) );
	checks.push( 'Admin byte registration/publication appears without rebuild; escaped metadata and ETag revalidation lead to one durable preset-copy revision' );
	await page.click( '#undo' ); await saved();
	stored = ( await documents() )[ 0 ];
	assert.deepEqual( stored.assets, {} ); assert.deepEqual( stored.baseScenes, {} ); assert.deepEqual( stored.shots, {} ); assert.deepEqual( stored.clips, [] );
	await page.click( '#redo' ); await saved();
	checks.push( 'Preset shot, placement and dependencies undo/redo together in native IndexedDB' );
	const next = structuredClone( preset ); next.version = '2'; next.name = 'Updated teacher wide'; next.snapshot.camera.exposure = 2;
	const updated = await publish( next, { 'If-Match': firstHead } );
	assert.equal( updated.status, 201, await updated.clone().text() );
	const nextHead = updated.headers.get( 'etag' ); await updated.arrayBuffer();
	await page.click( '#refresh-catalogue' );
	await page.waitForSelector( '[data-preset-version="2"]' );
	await page.click( '[data-preset-version="2"]' ); await saved();
	stored = ( await documents() )[ 0 ];
	assert.deepEqual( Object.values( stored.shots ).map( shot => shot.sourcePreset.version ), [ '1', '2' ] );
	assert.deepEqual( Object.values( stored.shots ).map( shot => shot.snapshot.camera.exposure ), [ 1, 2 ] );
	const hidden = await admin( `/presets/${preset.presetId}/availability`, { method: 'POST', body: { version: '2', available: false }, headers: { 'If-Match': nextHead, 'Idempotency-Key': 'hide-v2' } } );
	assert.equal( hidden.status, 200, await hidden.clone().text() ); await hidden.arrayBuffer();
	await page.click( '#refresh-catalogue' );
	await page.waitForFunction( () => document.querySelectorAll( '[data-add-preset]' ).length === 0 && document.querySelector( '#catalogue-status' ).textContent.includes( 'No teacher presets' ) );
	assert.equal( ( await fetch( `${origin}/v1/catalogue/presets/${preset.presetId}/1` ) ).status, 200 );
	checks.push( 'Version publication/hide refresh choices while old saved versions and hidden pinned reads remain intact' );
	await page.evaluate( () => navigator.serviceWorker.ready.then( () => true ) );
	await page.reload(); await page.waitForFunction( () => navigator.serviceWorker.controller !== null );
	await page.waitForFunction( () => ! document.querySelector( '#new-project' )?.disabled );
	await page.click( '[data-open]' ); await saved();
	await page.setOfflineMode( true ); await page.reload();
	await page.waitForFunction( () => ! document.querySelector( '#new-project' )?.disabled );
	await page.click( '[data-open]' ); await saved();
	await page.click( '#refresh-catalogue' );
	await page.waitForFunction( () => document.querySelector( '#catalogue-status' ).textContent.includes( 'unavailable' ) );
	assert.deepEqual( Object.values( ( await documents() )[ 0 ].shots ).map( shot => shot.sourcePreset.version ), [ '1', '2' ] );
	assert.match( await page.$eval( '#save-status', element => element.textContent ), /Saved on this device/ );
	checks.push( 'Built offline reload retains both copied versions; unavailable catalogue never changes saved status or claims offline media' );
	assert.deepEqual( errors, [] );
	console.log( JSON.stringify( { passed: checks.length, checks, browser: await browser.version(), publicReadCount: requests.length }, null, 2 ) );

} finally {

	await browser?.close();
	if ( server ) { server.closeAllConnections(); await new Promise( resolve => server.close( resolve ) ); }
	await mf.dispose();

}
