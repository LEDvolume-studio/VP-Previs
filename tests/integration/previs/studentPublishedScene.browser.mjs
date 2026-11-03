// Built main student workspace -> actual Worker/D1/R2 -> verified models/media -> hardware GPU pixels.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import { createBundledStudentSceneManifest } from '../../../app/src/previs/fixtures/BundledStudentScene.js';
import { validateStudentPresetVersion } from '../../../app/src/previs/domain/StudentCatalogueSchema.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare, Response: LocalResponse } = require( 'miniflare' ), { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const root = fileURLToPath( new URL( '../../../', import.meta.url ) );
const output = resolve( root, 'app/dist' );
const artifacts = resolve( process.env.PREVIS_ARTIFACT_DIR || `${tmpdir()}/student-previs-published-scene-${Date.now()}` );
await mkdir( artifacts, { recursive: true } );
const password = randomUUID(), salt = randomBytes( 16 );
const settings = {
	ENVIRONMENT: 'test', ALLOW_LOCAL_GEO_EXEMPTION: 'true', ENABLE_CATALOGUE_API: 'true', MAX_JSON_BYTES: '1048576', MAX_LIBRARY_ASSET_BYTES: '67108864',
	ADMIN_PASSWORD_VERIFIER: `pbkdf2-sha256$1000$${salt.toString( 'base64url' )}$${pbkdf2Sync( password, salt, 1000, 32, 'sha256' ).toString( 'base64url' )}`,
	ADMIN_SESSION_SECRET: randomBytes( 32 ).toString( 'base64url' ),
};
const script = ( await build( { stdin: { contents: `import {onRequest} from './functions/_middleware.js'; export default {fetch(request,env){return onRequest({request,env,next:()=>env.ASSETS.fetch(request)});}};`, resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } ) ).outputFiles[ 0 ].text;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png' };
const mf = new Miniflare( { modules: true, script, compatibilityDate: '2026-07-30', d1Databases: [ 'DB', 'ADMIN_AUTH_DB' ], r2Buckets: [ 'LIBRARY' ], bindings: settings, serviceBindings: { ASSETS: async request => {

 const url = new URL( request.url );
 const path = resolve( output, `.${decodeURIComponent( url.pathname )}${url.pathname.endsWith( '/' ) ? 'index.html' : ''}` );
 if ( ! path.startsWith( `${output}${sep}` ) ) return new LocalResponse( null, { status: 404 } );
 try { return new LocalResponse( await readFile( path ), { headers: { 'Content-Type': mime[ extname( path ) ] || 'application/octet-stream' } } ); }
 catch { return new LocalResponse( null, { status: 404 } ); }

} } } );
const report = { checks: [], errors: [], previewImages: [], delivery: 'Actual all-route Pages middleware and final built public/private assets' };
let server, browser, holdModel = false, entered, release, dropPublication = false;
const publicationAttempts = [];
try {

	const db = await mf.getD1Database( 'DB' ), auth = await mf.getD1Database( 'ADMIN_AUTH_DB' );
	for ( const name of ( await readdir( resolve( root, 'backend/migrations' ) ) ).filter( name => /^\d+.*\.sql$/.test( name ) ).sort() ) {

		const sql = await readFile( resolve( root, 'backend/migrations', name ), 'utf8' );
		await db.batch( splitSql( sql ).map( query => db.prepare( query ) ) );
		if ( name === '0003_admin_password.sql' ) await auth.batch( splitSql( sql ).map( query => auth.prepare( query ) ) );

	}
	server = createServer( async ( request, response ) => {

		try {

			const url = new URL( request.url, `http://${request.headers.host}` );

				if ( holdModel && request.method === 'GET' && url.pathname.includes( '/catalogue/assets/local-fixture-' ) ) {

					holdModel = false; entered(); await new Promise( resolve => { release = resolve; } );

				}
				const chunks = []; for await ( const chunk of request ) chunks.push( chunk );
				const body = Buffer.concat( chunks ), headers = { ...request.headers };
				delete headers.host; delete headers.connection; delete headers[ 'content-length' ];
				const result = await mf.dispatchFetch( url.href, { method: request.method, headers, ...( body.length ? { body } : {} ) } );
				const bytes = Buffer.from( await result.arrayBuffer() );
				if ( request.method === 'PUT' && url.pathname === '/v1/admin/catalogue/presets/supported-wide/1' ) {

					publicationAttempts.push( { requestId: headers[ 'idempotency-key' ], precondition: headers[ 'if-none-match' ], body: body.toString( 'utf8' ) } );
					if ( dropPublication && result.ok ) { response.destroy(); return; }

				}
				response.writeHead( result.status, Object.fromEntries( result.headers ) ); response.end( bytes ); return;


		} catch {

			if ( response.headersSent ) response.destroy();
			else { response.writeHead( 404 ); response.end( 'Local integration resource unavailable' ); }

		}

	} );
	await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
	const origin = `http://127.0.0.1:${server.address().port}`;
	browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 180000, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ] } );
	report.browser = await browser.version();
	const fixtureContext = await browser.createBrowserContext();
	const fixturePage = await fixtureContext.newPage(); fixturePage.setDefaultTimeout( 90000 );
	fixturePage.on( 'pageerror', error => report.errors.push( error.message ) );
	await fixturePage.goto( `${origin}/student/` );
	assert.equal( await fixturePage.evaluate( async password => ( await fetch( '/v1/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { password } ) } ) ).status, password ), 200 );
	await fixturePage.goto( `${origin}/student/scene/`, { waitUntil: 'domcontentloaded' } );
	await fixturePage.waitForFunction( () => window.previsRealScene || window.previsRealSceneError );
	assert.equal( await fixturePage.evaluate( () => window.previsRealSceneError ), undefined );
	const captured = await fixturePage.evaluate( async () => {

		const fixture = window.previsRealScene, frames = [];
		await fixture.adapter.prepare();
		try {

			for ( const frame of [ 0, 125 ] ) { await fixture.adapter.renderFrame( frame ); frames.push( fixture.adapter.canvas.toDataURL( 'image/png' ) ); }

		} finally { await fixture.adapter.restore(); }
		const adapter = await navigator.gpu.requestAdapter();
		return { document: fixture.document, video: Array.from( await fixture.readFixtureVideo() ), frames, meshCount: fixture.state().meshCount, gpu: { vendor: adapter.info.vendor, isFallbackAdapter: adapter.info.isFallbackAdapter, isolated: crossOriginIsolated } };

	} );
	report.gpu = captured.gpu; report.meshCount = captured.meshCount;
	assert.equal( captured.gpu.isFallbackAdapter, false ); assert.equal( captured.gpu.isolated, true ); assert.equal( captured.meshCount, 97 );
	await fixturePage.evaluate( () => window.previsRealScene.dispose() ); await fixtureContext.close();
	const login = await fetch( `${origin}/v1/admin/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify( { password } ) } );
	assert.equal( login.status, 200 ); const cookie = login.headers.get( 'set-cookie' ).split( ';' )[ 0 ]; await login.arrayBuffer();
	const admin = ( path, body, headers = {} ) => fetch( `${origin}/v1/admin/catalogue${path}`, { method: 'PUT', headers: { Origin: origin, Cookie: cookie, ...headers }, body } );
	const manifest = createBundledStudentSceneManifest( { models: [ 'studio', 'suv', 'mannequin', 'led' ] } );
	const sceneDefinition = { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: manifest.baseScene, models: manifest.models.map( ( { asset, nodes } ) => ( { asset, nodes } ) ), humanPoseRoots: [ 'mannequin-root' ] };
	const assets = captured.document.assets;
	const videoBytes = Buffer.from( captured.video );
	for ( const asset of Object.values( assets ) ) {

		const model = manifest.models.find( model => model.asset.assetId === asset.assetId );
		const bytes = model ? await readFile( resolve( root, 'app/public', model.source.slice( 1 ) ) ) : videoBytes;
		const result = await admin( `/assets/${asset.assetId}/${asset.version}`, bytes, { 'Content-Type': asset.mimeType, 'X-Asset-Metadata': JSON.stringify( asset ) } );
		assert.ok( result.ok, await result.text() );

	}
	for ( const [ id, source ] of [ [ 'supported-wide', captured.document.shots.wide ], [ 'supported-close', captured.document.shots.close ] ] ) {

		const preset = { format: 'rayzee-student-preset', schemaVersion: 2, presetId: id, version: '1', name: source.name, description: 'Actual supported scene captured for a local integration proof.', category: 'Studio', defaultDurationFrames: 125, thumbnail: null, assets, baseScene: manifest.baseScene, snapshot: source.snapshot, sceneDefinition };
		validateStudentPresetVersion( preset );
		if ( id === 'supported-wide' ) {

			// The publisher has its own cookie jar; the student stays anonymous.
			const adminContext = await browser.createBrowserContext();
			const adminPage = await adminContext.newPage();
			adminPage.on( 'pageerror', error => report.errors.push( error.message ) );
				await adminPage.goto( `${origin}/student/` );
			const loginStatus = await adminPage.evaluate( async password => ( await fetch( '/v1/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( { password } ) } ) ).status, password );
			assert.equal( loginStatus, 200 );
				await adminPage.goto( `${origin}/admin/student-presets/` );
			const presetPath = resolve( artifacts, 'supported-wide.preset.json' ), videoPath = resolve( artifacts, 'timecode.mp4' );
			await writeFile( presetPath, JSON.stringify( preset ) ); await writeFile( videoPath, videoBytes );
			await ( await adminPage.$( '#prepared-preset' ) ).uploadFile( presetPath );
			await adminPage.waitForSelector( '#preset-assets' );
			await ( await adminPage.$( '#preset-assets' ) ).uploadFile( ...manifest.models.map( model => resolve( root, 'app/public', model.source.slice( 1 ) ) ), videoPath );
			await adminPage.waitForFunction( () => ! document.querySelector( '#prepare-publication' ).disabled );
			await adminPage.click( '#prepare-publication' );
			await adminPage.waitForFunction( () => document.querySelector( '#publisher-status' ).dataset.phase === 'prepared' || document.querySelector( '#publisher-error' ).textContent.length > 0 );
			assert.equal( await adminPage.$eval( '#publisher-error', element => element.textContent ), '' );
			dropPublication = true;
			await adminPage.click( '#publish-preset' );
			await adminPage.waitForFunction( () => document.querySelector( '#publisher-error' ).textContent.length > 0 );
			assert.match( await adminPage.$eval( '#publish-preset', element => element.textContent ), /Retry exact/ );
				dropPublication = false;
			await adminPage.click( '#publish-preset' );
			await adminPage.waitForFunction( () => document.querySelector( '#publisher-status' ).dataset.phase === 'published' || document.querySelector( '#publisher-error' ).textContent.length > 0 );
			assert.equal( await adminPage.$eval( '#publisher-error', element => element.textContent ), '' );
				assert.ok( publicationAttempts.length >= 2 );
				for ( const attempt of publicationAttempts ) assert.deepEqual( attempt, publicationAttempts[ 0 ] );
			assert.equal( ( await db.prepare( 'SELECT count(*) AS count FROM catalogue_presets WHERE preset_id=?' ).bind( id ).first() ).count, 1 );
			await adminPage.click( '#refresh-preset-head' );
			await adminPage.waitForFunction( () => document.querySelector( '#publisher-status' ).textContent.includes( 'is available' ) );
			await adminPage.click( '#toggle-preset-availability' );
			await adminPage.waitForFunction( () => document.querySelector( '#publisher-status' ).textContent.includes( 'availability change confirmed' ) );
			await adminPage.click( '#refresh-preset-head' );
			await adminPage.waitForFunction( () => document.querySelector( '#publisher-status' ).textContent.includes( 'is hidden' ) );
			await adminPage.click( '#toggle-preset-availability' );
			await adminPage.waitForFunction( () => document.querySelector( '#publisher-status' ).textContent.includes( 'availability change confirmed' ) );
			await adminPage.click( '#refresh-preset-head' );
			await adminPage.waitForFunction( () => document.querySelector( '#publisher-status' ).textContent.includes( 'is available' ) );
			await writeFile( resolve( artifacts, 'admin-publisher.png' ), await adminPage.screenshot( { fullPage: true } ) );
			await adminContext.close();
			report.checks.push( 'Separate admin browser reviews files, publishes with its shared-password cookie, retries a genuinely lost committed response unchanged, then hides/restores availability' );
			continue;

		}
		const result = await admin( `/presets/${id}/1`, JSON.stringify( preset ), { 'Content-Type': 'application/json', 'If-None-Match': '*', 'Idempotency-Key': `${id}:1` } );
		assert.equal( result.status, 201, await result.clone().text() ); await result.arrayBuffer();

	}
	report.checks.push( 'Actual 97-mesh fixture snapshots publish as mapped v2 presets against verified GLB/video bytes in real D1/R2' );
	const page = await browser.newPage(); page.setDefaultTimeout( 90000 ); await page.setViewport( { width: 1440, height: 1100 } );
	page.on( 'pageerror', error => report.errors.push( error.message ) );
	const publicReads = [];
	page.on( 'request', request => {

		if ( new URL( request.url() ).pathname.startsWith( '/v1/catalogue' ) ) publicReads.push( { path: new URL( request.url() ).pathname, cookie: Boolean( request.headers().cookie ) } );

	} );
	await page.goto( `${origin}/student/` ); await page.waitForFunction( () => ! document.querySelector( '#new-project' )?.disabled );
	const saved = () => page.waitForFunction( () => document.querySelector( '#save-status' )?.dataset.kind === 'saved' && ! document.querySelector( '#new-project' )?.disabled );
	const stored = () => page.evaluate( () => new Promise( ( resolve, reject ) => {

		const request = indexedDB.open( 'RayzeeStudentDB', 1 ); request.onerror = () => reject( request.error );
		request.onsuccess = () => {

			const db = request.result, transaction = db.transaction( 'projects', 'readonly' ), rows = transaction.objectStore( 'projects' ).getAll();
			transaction.oncomplete = () => { db.close(); resolve( rows.result[ 0 ].document ); }; transaction.onabort = () => { db.close(); reject( transaction.error ); };

		};

	} ) );
	await page.click( '#new-project' ); await saved(); await page.click( '#refresh-catalogue' ); await page.waitForSelector( '[data-add-preset="supported-wide"]' );
	for ( const [ index, presetId ] of [ 'supported-wide', 'supported-close' ].entries() ) {

		await page.locator( `[data-add-preset="${presetId}"]` ).click(); await saved();
		const document = await stored(), shot = Object.values( document.shots ).find( shot => shot.sourcePreset.presetId === presetId );
		await page.locator( `[data-preview-shot="${shot.shotId}"]` ).click();
		await page.waitForFunction( () => document.querySelector( '#shot-preview-status' ).dataset.phase !== 'loading' );
		assert.equal( await page.$eval( '#shot-preview-status', element => element.dataset.phase ), 'ready', await page.$eval( '#shot-preview-status', element => element.textContent ) );
		assert.equal( ( await stored() ).revision, document.revision, 'Preview must not create an edit revision' );
		const data = await page.$eval( '.published-shot-canvas', canvas => canvas.toDataURL( 'image/png' ) );
		const bytes = Buffer.from( data.split( ',' )[ 1 ], 'base64' ), actual = PNG.sync.read( bytes ), expected = PNG.sync.read( Buffer.from( captured.frames[ index ].split( ',' )[ 1 ], 'base64' ) );
		assert.equal( actual.width, 1920 ); assert.equal( actual.height, 1080 );
		let difference = 0, count = 0, green = 0, yellow = 0;
		for ( let offset = 0; offset < actual.data.length; offset += 16 ) {

			const [ r, g, b ] = actual.data.subarray( offset, offset + 3 );
			for ( let c = 0; c < 3; c ++ ) { difference += Math.abs( actual.data[ offset + c ] - expected.data[ offset + c ] ); count ++; }
			if ( g > 40 && g > r * 1.25 && g > b * 1.25 ) green ++;
			if ( r > 40 && g > 40 && b < Math.min( r, g ) * 0.7 ) yellow ++;

		}
		const meanPixelDifference = difference / count;
		assert.ok( meanPixelDifference < 6, `Published shot differs from independent fixture: ${meanPixelDifference}` );
		assert.ok( index === 0 ? green > 100 : yellow > 100, 'Actual LED pixels must be visible' );
		await writeFile( resolve( artifacts, `${presetId}.png` ), bytes );
		report.previewImages.push( { presetId, meanPixelDifference, greenPixels: green, yellowPixels: yellow } );
		await page.click( '#close-shot-preview' ); await saved();

	}
	assert.ok( publicReads.filter( request => request.path.includes( '/assets/' ) ).length >= 10 );
	assert.ok( publicReads.every( request => ! request.cookie ) );
	report.checks.push( 'Main student previews render standing/closed/frozen and seated/open/playing shots through anonymous catalogue assets, with matching reference pixels and no edit revision' );
	const current = await stored(), shotId = Object.keys( current.shots )[ 0 ];
	holdModel = true; const held = new Promise( resolve => { entered = resolve; } );
	await page.click( `[data-preview-shot="${shotId}"]` ); await held; await page.click( '#close-shot-preview' ); release(); release = null;
	await saved(); assert.equal( await page.$( '.published-shot-canvas' ), null );
	assert.equal( ( await stored() ).revision, current.revision );
	report.checks.push( 'Closing a held model load cancels preparation, drains it and prevents a late canvas without changing project content' );
	const videoRef = Object.values( assets ).find( asset => asset.kind === 'video' );
	const row = await db.prepare( 'SELECT object_key FROM library_assets WHERE asset_id=? AND version=?' ).bind( videoRef.assetId, videoRef.version ).first();
	await ( await mf.getR2Bucket( 'LIBRARY' ) ).delete( row.object_key );
	await page.click( `[data-preview-shot="${shotId}"]` );
	await page.waitForFunction( () => document.querySelector( '#shot-preview-status' ).dataset.phase === 'error' ); await saved();
	assert.equal( await page.$( '.published-shot-canvas' ), null ); assert.equal( ( await stored() ).revision, current.revision );
	const restored = await admin( `/assets/${videoRef.assetId}/${videoRef.version}`, videoBytes, { 'Content-Type': videoRef.mimeType, 'X-Asset-Metadata': JSON.stringify( videoRef ) } ); assert.ok( restored.ok ); await restored.arrayBuffer();
	await page.click( `[data-preview-shot="${shotId}"]` ); await page.waitForFunction( () => document.querySelector( '#shot-preview-status' ).dataset.phase === 'ready' ); await saved();
	await page.$eval( '#project-name', element => { element.value = 'Renamed after preview'; } ); await page.$eval( '#rename-form', form => form.requestSubmit() ); await saved();
	assert.ok( await page.$( '.published-shot-canvas' ) );
	report.checks.push( 'Missing media fails without a stale picture or revision; repaired bytes permit retry; compatible revisions retain the prepared preview' );
	const readsBeforeEditing = publicReads.length;
	await page.evaluate( () => { globalThis.originalShotCanvas = document.querySelector( '.published-shot-canvas' ); } );
	const image = () => page.$eval( '.published-shot-canvas', canvas => canvas.toDataURL() );
	const baselineImage = await image();
	const baselineShot = structuredClone( ( await stored() ).shots[ shotId ] );
	const submit = async ( selector, values ) => {

		await page.$eval( selector, ( form, values ) => {

			for ( const [ name, value ] of Object.entries( values ) ) {

				const input = form.elements.namedItem( name );
				if ( input.type === 'checkbox' ) input.checked = value;
				else input.value = value;

			}
			form.requestSubmit();

		}, values );
		await saved();
		assert.equal( await page.$eval( '#shot-preview-status', element => element.dataset.phase ), 'ready', await page.$eval( '#shot-preview-status', element => element.textContent ) );
		assert.equal( await page.evaluate( () => globalThis.originalShotCanvas === document.querySelector( '.published-shot-canvas' ) ), true, 'Compatible edits must reuse the same prepared viewport' );

	};
	await submit( '#shot-camera-form', { exposure: baselineShot.snapshot.camera.exposure * 0.4 } );
	assert.notEqual( await image(), baselineImage, 'Exposure edit must affect rendered pixels' );
	assert.equal( ( await stored() ).shots[ shotId ].snapshot.camera.exposure, baselineShot.snapshot.camera.exposure * 0.4 );
	await page.click( '#undo' ); await saved();
	assert.deepEqual( ( await stored() ).shots[ shotId ], baselineShot );
	assert.equal( await image(), baselineImage, 'Undo must restore exact preview pixels' );
	await page.click( '#redo' ); await saved();
	assert.notEqual( await image(), baselineImage );
	await page.click( '#undo' ); await saved();
	const humanId = 'mannequin-root';
	await page.select( '#shot-node-select', humanId );
	await submit( '#shot-node-form', { position0: baselineShot.snapshot.nodes[ humanId ].transform.position[ 0 ] + 0.5, humanPose: 'sitting' } );
	assert.equal( ( await stored() ).shots[ shotId ].snapshot.nodes[ humanId ].humanPose, 'sitting' );
	assert.notEqual( await image(), baselineImage, 'Object position and human pose edit must affect rendered pixels' );
	await page.click( '#undo' ); await saved();
	const lightId = baselineShot.snapshot.lights[ 0 ].lightId;
	await submit( '#shot-light-form', { intensity: baselineShot.snapshot.lights[ 0 ].intensity * 0.5 } );
	assert.equal( ( await stored() ).shots[ shotId ].snapshot.lights.find( light => light.lightId === lightId ).intensity, baselineShot.snapshot.lights[ 0 ].intensity * 0.5 );
	await page.click( '#undo' ); await saved();
	await submit( '#shot-led-form', { inPointFrames: 25, mode: 'play', loop: true, brightnessNits: 300 } );
	assert.equal( ( await stored() ).shots[ shotId ].snapshot.ledWalls[ 0 ].inPointUs, 1000000 );
	assert.notEqual( await image(), baselineImage, 'LED in-point/brightness edit must affect rendered pixels' );
	await page.click( '#undo' ); await saved();
	assert.deepEqual( ( await stored() ).shots[ shotId ], baselineShot );
	for ( let index = 0; index < 12; index ++ ) await submit( '#shot-camera-form', { exposure: baselineShot.snapshot.camera.exposure * ( index % 2 ? 1 : 0.8 ) } );
	assert.equal( await image(), baselineImage );
	assert.equal( publicReads.length, readsBeforeEditing, 'Repeated compatible edits/undo/redo must not reload scene metadata, models or media' );
	const sourceResponse = await fetch( `${origin}/v1/catalogue/presets/supported-wide/1` );
	assert.ok( sourceResponse.ok );
	assert.deepEqual( ( await sourceResponse.json() ).snapshot, baselineShot.snapshot, 'Editing a copied shot must leave the published source untouched' );
	report.checks.push( 'Camera/exposure, object position/human pose, light intensity and LED controls persist completed edits; undo/redo restore pixels and 12 repeated edits reuse the same canvas without catalogue/model/media reads' );
	// Real pointer and keyboard events must drive Rayzee's existing CameraManager.
	const beforeNavigation = await stored(), navigationReference = await image();
	await page.$eval( '.published-shot-canvas', canvas => canvas.scrollIntoView( { block: 'center' } ) );
	const bounds = await ( await page.$( '.published-shot-canvas' ) ).boundingBox();
	await page.mouse.move( bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 );
	await page.mouse.down( { button: 'right' } ); await page.keyboard.down( 'w' );
	await new Promise( resolve => setTimeout( resolve, 400 ) );
	assert.equal( await page.$eval( '#save-status', element => element.dataset.kind ), 'editing', 'Live navigation must not claim the moving camera is already saved' );
	assert.equal( ( await stored() ).revision, beforeNavigation.revision );
	await page.keyboard.up( 'w' ); await page.mouse.up( { button: 'right' } );
	await page.waitForFunction( revision => document.querySelector( '#save-status' ).textContent.includes( `revision ${revision}` ), {}, beforeNavigation.revision + 1 ); await saved();
	const afterNavigation = await stored();
	assert.equal( afterNavigation.revision, beforeNavigation.revision + 1, 'One settled WASD gesture is one durable command' );
	assert.notDeepEqual( afterNavigation.shots[ shotId ].snapshot.camera.transform.position, beforeNavigation.shots[ shotId ].snapshot.camera.transform.position );
	assert.notEqual( await image(), navigationReference, 'WASD must change actual scene pixels' );
	assert.deepEqual( afterNavigation.shots[ shotId ].snapshot.nodes, beforeNavigation.shots[ shotId ].snapshot.nodes );
	assert.equal( publicReads.length, readsBeforeEditing, 'Navigating must not refetch scene/media' );
	await page.click( '#undo' ); await saved();
	assert.deepEqual( ( await stored() ).shots[ shotId ], beforeNavigation.shots[ shotId ] );
	assert.equal( await image(), navigationReference );
	// Submitting another control before the settle callback must flush, preserve
	// and undo the live pose rather than overwrite it with stale form values.
	const beforeImmediateEdit = await stored();
	await page.$eval( '.published-shot-canvas', canvas => canvas.scrollIntoView( { block: 'center' } ) );
	const immediateBounds = await ( await page.$( '.published-shot-canvas' ) ).boundingBox();
	await page.mouse.move( immediateBounds.x + immediateBounds.width / 2, immediateBounds.y + immediateBounds.height / 2 );
	await page.mouse.down( { button: 'right' } ); await page.keyboard.down( 'd' );
	await new Promise( resolve => setTimeout( resolve, 250 ) );
	await page.keyboard.up( 'd' ); await page.mouse.up( { button: 'right' } );
	await page.$eval( '#shot-camera-form', form => { form.elements.namedItem( 'exposure' ).value = Number( form.elements.namedItem( 'exposure' ).value ) + 0.1; form.requestSubmit(); } );
	await page.waitForFunction( revision => document.querySelector( '#save-status' ).textContent.includes( `revision ${revision}` ), {}, beforeImmediateEdit.revision + 2 ); await saved();
	const immediatelyEdited = await stored();
	assert.notDeepEqual( immediatelyEdited.shots[ shotId ].snapshot.camera.transform.position, beforeImmediateEdit.shots[ shotId ].snapshot.camera.transform.position, 'Exposure submission must preserve the unsaved live camera pose' );
	assert.equal( immediatelyEdited.shots[ shotId ].snapshot.camera.exposure, beforeImmediateEdit.shots[ shotId ].snapshot.camera.exposure + 0.1 );
	await page.click( '#undo' ); await saved();
	assert.notDeepEqual( ( await stored() ).shots[ shotId ].snapshot.camera.transform.position, beforeImmediateEdit.shots[ shotId ].snapshot.camera.transform.position );
	await page.click( '#undo' ); await saved();
	assert.deepEqual( ( await stored() ).shots[ shotId ], beforeImmediateEdit.shots[ shotId ] );
	report.checks.push( 'Real RMB + W navigates the shared Rayzee camera and scene pixels; settled movement is one saved undoable edit without reloading models/media' );
	const beforeTransport = await stored(), firstName = beforeTransport.shots[ shotId ].name;
	const seekTo = async frame => {

		await page.$eval( '#seek', ( input, frame ) => { input.value = frame; input.dispatchEvent( new Event( 'input', { bubbles: true } ) ); }, frame );
		await page.waitForFunction( () => document.querySelector( '#shot-preview-status' ).dataset.phase === 'ready' && ! document.querySelector( '#shot-editor-host > section > fieldset' ).disabled );

	};
	await seekTo( 25 ); const frozen25 = await image();
	await seekTo( 50 ); assert.equal( await image(), frozen25, 'Frozen LED stays fixed while timeline local time advances' );
	await seekTo( 125 ); const cut = await image();
	assert.notEqual( cut, frozen25, 'Timeline hard cut must apply the second shot camera, lights and poses' );
	await seekTo( 150 ); assert.notEqual( await image(), cut, 'Playing LED source advances with timeline local time' );
	await page.$eval( '#seek', input => {

		for ( const frame of [ 25, 175, 50 ] ) { input.value = frame; input.dispatchEvent( new Event( 'input', { bubbles: true } ) ); }

	} );
	await page.waitForFunction( name => document.querySelector( '#shot-preview-status' ).dataset.phase === 'ready' && document.querySelector( '#shot-preview-status' ).textContent.includes( name ) && document.querySelector( '#transport-position' ).textContent.includes( 'Frame 50 /' ), {}, firstName );
	assert.equal( await image(), frozen25, 'Rapid A/B/A seeks must not attach stale B state' );
	await seekTo( 0 ); await page.click( '#play' );
	await page.waitForFunction( () => document.querySelector( '#transport-position' ).textContent.includes( 'Sitting / open doors / advancing LED' ) && document.querySelector( '#shot-preview-status' ).dataset.phase === 'ready', { timeout: 20000 } );
	await page.click( '#play' );
	await page.waitForFunction( () => document.querySelector( '#play' ).textContent === 'Play sequence' && document.querySelector( '#shot-preview-status' ).dataset.phase === 'ready' );
	await page.click( '#stop' ); await saved();
	assert.match( await page.$eval( '#shot-preview-status', element => element.textContent ), new RegExp( firstName.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) ) );
	assert.deepEqual( await stored(), beforeTransport, 'Selection, scrub, play, pause and stop must never author revisions' );
	assert.equal( publicReads.length, readsBeforeEditing, 'Compatible timeline cuts must keep prepared models/media' );
	report.checks.push( 'Shared scene viewer applies real timeline cuts, frozen/playing media, latest rapid seeks and bounded real-time playback; pause/stop restore editing without revisions or asset reads' );
	const acknowledged = await stored(), attemptedExposure = acknowledged.shots[ shotId ].snapshot.camera.exposure + 0.35;
	await page.evaluate( () => {

		globalThis.studentNativeAdd = IDBObjectStore.prototype.add;
		IDBObjectStore.prototype.add = function ( ...arguments_ ) {

			if ( this.name === 'outbox' ) throw new DOMException( 'Injected quota failure', 'QuotaExceededError' );
			return globalThis.studentNativeAdd.apply( this, arguments_ );

		};

	} );
	await page.$eval( '#shot-camera-form', ( form, exposure ) => { form.elements.namedItem( 'exposure' ).value = exposure; form.requestSubmit(); }, attemptedExposure );
	await page.waitForFunction( () => document.querySelector( '#save-status' ).dataset.kind === 'error' );
	assert.equal( await page.$( '.published-shot-canvas' ), null, 'Failed save must hide the old acknowledged picture' );
	assert.equal( ( await stored() ).revision, acknowledged.revision );
	assert.equal( await page.$eval( '#shot-editor-host > section > fieldset', element => element.disabled ), true );
	await page.evaluate( () => { IDBObjectStore.prototype.add = globalThis.studentNativeAdd; } );
	await page.click( '#retry-save' ); await saved();
	assert.equal( ( await stored() ).shots[ shotId ].snapshot.camera.exposure, attemptedExposure );
	assert.equal( await page.evaluate( () => globalThis.originalShotCanvas === document.querySelector( '.published-shot-canvas' ) ), true );
	const persisted = await stored();
	await page.reload(); await page.waitForSelector( '[data-open]' );
	await page.click( `[data-open="${persisted.projectId}"]` ); await saved();
	assert.deepEqual( ( await stored() ), persisted );
	await page.click( `[data-preview-shot="${shotId}"]` ); await page.waitForFunction( () => document.querySelector( '#shot-preview-status' ).dataset.phase === 'ready' ); await saved();
	assert.equal( await page.$eval( '#shot-camera-form [name="exposure"]', input => Number( input.value ) ), attemptedExposure );
	report.checks.push( 'Failed IDB transaction preserves the attempted edit, hides stale pixels and disables editing; retry reuses the viewport and an origin reload restores the exact acknowledged edit' );
	await writeFile( resolve( artifacts, 'student-workspace.png' ), await page.screenshot( { fullPage: true } ) );
	await page.click( '#close-shot-preview' );
	const viewportChunk = ( await readdir( resolve( output, 'assets' ) ) ).find( name => /^PublishedShotViewport-.*\.js$/.test( name ) );
	assert.ok( viewportChunk );
	report.repeatedRuntime = await page.evaluate( async ( chunk, document, shotId ) => {

		const { createPublishedShotViewport } = await import( chunk );
		// Direct runtime checks use the same final public chunk and actual service.
		// Anonymous UI above separately proves the production client's verification.
		const catalogue = {
			async getScene( { sceneId, version }, { signal } ) {

				const response = await fetch( `/v1/catalogue/scenes/${sceneId}/${version}`, { signal, credentials: 'omit' } );
				if ( ! response.ok ) throw new Error( 'Scene unavailable' );
				return response.json();

			},
			async getAssetBytes( { assetId, version }, { signal } ) {

				const response = await fetch( `/v1/catalogue/assets/${assetId}/${version}`, { signal, credentials: 'omit' } );
				if ( ! response.ok ) throw new Error( 'Asset unavailable' );
				return new Uint8Array( await response.arrayBuffer() );

			},
		};
		const runtime = await createPublishedShotViewport( { document, shotId, catalogue } );
		try {

			const firstPixels = runtime.canvas.getContext( '2d' ).getImageData( 0, 0, 1920, 1080 ).data;
			await runtime.renderFrame( 0 );
			const repeatedFramePixels = runtime.canvas.getContext( '2d' ).getImageData( 0, 0, 1920, 1080 ).data;
			let repeatedFrameDifference = 0;
			for ( let offset = 0; offset < firstPixels.length; offset += 4 ) for ( let c = 0; c < 3; c ++ ) repeatedFrameDifference += Math.abs( firstPixels[ offset + c ] - repeatedFramePixels[ offset + c ] );
			const firstToRepeatedFrameMeanRGB = repeatedFrameDifference / ( 1920 * 1080 * 3 );
			if ( firstToRepeatedFrameMeanRGB >= 1 ) throw new Error( `Unchanged repeated frame changed visible pixels: ${firstToRepeatedFrameMeanRGB}` );
			await runtime.updateDocument( document, shotId );
			const warmedPixels = runtime.canvas.getContext( '2d' ).getImageData( 0, 0, 1920, 1080 ).data;
			let warmDifference = 0;
			for ( let offset = 0; offset < firstPixels.length; offset += 4 ) for ( let c = 0; c < 3; c ++ ) warmDifference += Math.abs( firstPixels[ offset + c ] - warmedPixels[ offset + c ] );
			const initialToWarmMeanRGB = warmDifference / ( 1920 * 1080 * 3 );
			if ( initialToWarmMeanRGB >= 1 ) throw new Error( `Unchanged first revision changed visible pixels: ${initialToWarmMeanRGB}` );
			const initial = runtime.inspect(), reference = runtime.canvas.toDataURL();
			for ( let index = 0; index < 24; index ++ ) {

				const next = structuredClone( document );
				next.shots[ shotId ].snapshot.camera.exposure *= index % 2 ? 1 : 0.8;
				if ( ! runtime.canUpdate( next, shotId ) ) throw new Error( 'Compatible exposure edit rejected' );
				await runtime.updateDocument( next, shotId );

			}
			const after = runtime.inspect();
			if ( runtime.canvas.toDataURL() !== reference ) throw new Error( 'Repeated alternating revisions did not restore exact pixels' );
			const controller = new AbortController(), abortedRevision = structuredClone( document );
			abortedRevision.shots[ shotId ].snapshot.camera.exposure = 0.01;
			const aborted = runtime.updateDocument( abortedRevision, shotId, { signal: controller.signal } );
			controller.abort();
			let abortName;
			try { await aborted; } catch ( error ) { abortName = error.name; }
			if ( abortName !== 'AbortError' || runtime.canvas.toDataURL() !== reference ) throw new Error( 'Aborted queued revision changed pixels' );
			const invalid = structuredClone( document ); invalid.shots[ shotId ].snapshot.camera.exposure = NaN;
			if ( runtime.canUpdate( invalid, shotId ) ) throw new Error( 'Invalid revision accepted' );
			let rejected = false;
			try { await runtime.updateDocument( invalid, shotId ); } catch { rejected = true; }
			if ( ! rejected || runtime.canvas.toDataURL() !== reference ) throw new Error( 'Rejected revision changed pixels' );
			return { initial, after, abortName, initialToWarmMeanRGB, firstToRepeatedFrameMeanRGB };

		} finally { await runtime.dispose(); }

	}, `/assets/${viewportChunk}`, persisted, shotId );
	assert.equal( report.repeatedRuntime.initial.meshCount, 97 );
	assert.deepEqual( report.repeatedRuntime.after.rendererInfo.memory, report.repeatedRuntime.initial.rendererInfo.memory, 'Repeated camera revisions must keep tracked renderer resource counts stable' );
	assert.equal( report.repeatedRuntime.after.decodedCount, report.repeatedRuntime.initial.decodedCount );
	report.checks.push( 'Final public viewport module survives 24 alternating revisions with exact pixel restoration after an unchanged revision, stable tracked resources/decoder count, atomic invalid-input rejection and queued-abort cleanup' );
	assert.deepEqual( report.errors, [] ); report.passed = true;
	console.log( JSON.stringify( { ...report, artifactDirectory: artifacts }, null, 2 ) );

} finally {

	release?.(); await browser?.close();
	if ( server ) { server.closeAllConnections(); await new Promise( resolve => server.close( resolve ) ); }
	await mf.dispose(); await writeFile( resolve( artifacts, 'report.json' ), JSON.stringify( report, null, 2 ) );

}
