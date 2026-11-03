// Run against the normal admin Vite server from app/, not the isolated proof server.
// Opens the bundled welcome project in a disposable Chrome profile; no content edits.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const origin = process.env.ADMIN_TEST_ORIGIN || 'http://127.0.0.1:5183';
const evidenceDirectory = process.env.ADMIN_EVIDENCE_DIR || tmpdir();
const loadTimeout = Number( process.env.ADMIN_LOAD_TIMEOUT_MS || 120000 );
assert.ok( Number.isSafeInteger( loadTimeout ) && loadTimeout > 0 && loadTimeout <= 300000, 'Admin load timeout must be 1–300000 milliseconds' );
const report = { browser: null, origin, started: new Date().toISOString(), requestFailures: [], blockedRequests: [], pageErrors: [] };
let browser;
let page;
try {

	browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ] } );
	report.browser = await browser.version();
	page = await browser.newPage();
	await page.setViewport( { width: 1440, height: 1000 } );
	await page.evaluateOnNewDocument( () => {

		const NativeWorker = window.Worker;
		const events = [];
		let nextId = 0;
		window.__adminWorkerEvidence = events;
		const record = ( id, direction, data ) => {

			if ( events.length >= 600 ) events.shift();
			events.push( { id, direction, type: data?.type ?? null, triangles: data?.triangleCount ?? null, progress: data?.progress ?? null, error: typeof data?.error === 'string' ? data.error : null, atMs: Math.round( performance.now() ) } );

		};
		window.Worker = class extends NativeWorker {

			constructor( ...args ) {

				super( ...args );
				this.evidenceId = ++ nextId;
				this.addEventListener( 'message', event => record( this.evidenceId, 'received', event.data ) );
				this.addEventListener( 'messageerror', () => record( this.evidenceId, 'messageerror' ) );
				this.addEventListener( 'error', event => record( this.evidenceId, 'error', { error: event.message } ) );

			}

			postMessage( ...args ) {

				record( this.evidenceId, 'sent', args[ 0 ] );
				return super.postMessage( ...args );

			}

			terminate() {

				record( this.evidenceId, 'terminated' );
				return super.terminate();

			}

		};

	} );
	await page.setRequestInterception( true );
	page.on( 'request', request => {

		const url = new URL( request.url() );
		if ( ! [ 'GET', 'HEAD', 'OPTIONS' ].includes( request.method() ) || /(^|\.)(google-analytics\.com|googletagmanager\.com)$/.test( url.hostname ) ) {

			report.blockedRequests.push( { method: request.method(), path: url.pathname } );
			request.abort();

		} else request.continue();

	} );
	page.on( 'requestfailed', request => {

		const path = new URL( request.url() ).pathname;
		if ( report.blockedRequests.some( item => item.path === path && item.method === request.method() ) ) return;
		report.requestFailures.push( { path, error: request.failure()?.errorText } );

	} );
	page.on( 'response', response => {

		if ( response.status() >= 400 ) report.requestFailures.push( { path: new URL( response.url() ).pathname, status: response.status() } );

	} );
	page.on( 'pageerror', error => report.pageErrors.push( error.message ) );
	const loadStarted = Date.now();
	await page.goto( origin, { waitUntil: 'domcontentloaded', timeout: 15000 } );
	await page.waitForFunction( async () => {

		const { getApp } = await import( '/src/lib/appProxy.js' );
		if ( ! getApp() ) return false;
		const { useProjectStore } = await import( '/src/services/projects/projectStore.js' );
		return useProjectStore.getState().status !== 'loading';

	}, { timeout: loadTimeout, polling: 500 } );
	await page.evaluate( () => new Promise( resolve => requestAnimationFrame( () => requestAnimationFrame( resolve ) ) ) );
	report.loadElapsedMs = Date.now() - loadStarted;
	report.state = await page.evaluate( async () => {

		const { getApp } = await import( '/src/lib/appProxy.js' );
		const { useProjectStore } = await import( '/src/services/projects/projectStore.js' );
		const { useStore } = await import( '/src/store.js' );
		const app = getApp();
		const project = useProjectStore.getState();
		const adapter = await navigator.gpu.requestAdapter();
		const info = adapter?.info;
		let meshes = 0;
		app.meshScene.traverse( object => { if ( object.isMesh ) meshes ++; } );
		return {
			initialized: app.isInitialized, renderer: app.renderer.constructor.name, backend: app.renderer.backend.constructor.name,
			gpu: { vendor: info?.vendor, architecture: info?.architecture, isFallbackAdapter: info?.isFallbackAdapter },
			project: { status: project.status, name: project.activeProject?.name, error: project.error, missingMedia: project.missingMedia, warnings: project.warnings },
			loading: useStore.getState().loading, pathTracerEnabled: app.pathTracerEnabled, meshes,
			camera: { names: app.cameraManager.getCameraNames(), type: app.cameraManager.camera.type, position: app.cameraManager.camera.position.toArray(), fov: app.cameraManager.camera.fov },
		};

	} );
	assert.equal( report.state.initialized, true );
	assert.equal( report.state.backend, 'WebGPUBackend' );
	assert.equal( report.state.gpu.isFallbackAdapter, false );
	assert.equal( report.state.project.status, 'saved' );
	assert.equal( report.state.project.name, 'Welcome Project' );
	assert.equal( report.state.loading.isLoading, false );
	assert.ok( report.state.meshes > 0 );
	report.screenshot = join( evidenceDirectory, 'rayzee-admin-baseline-ready.png' );
	await page.screenshot( { path: report.screenshot, fullPage: true } );
	await page.click( '[role="tab"][id$="trigger-camera"]' );
	await page.waitForFunction( () => document.querySelector( '[role="tabpanel"][id$="content-camera"]' )?.innerText.includes( 'Sensor' ), { timeout: 5000, polling: 50 } );
	report.cameraPanel = await page.$eval( '[role="tabpanel"][id$="content-camera"]', element => element.innerText );
	await page.click( '[role="tab"][id$="trigger-poses"]' );
	await page.waitForFunction( () => document.querySelector( '[role="tabpanel"][id$="content-poses"]' )?.innerText.length > 0, { timeout: 5000, polling: 50 } );
	report.posePanel = await page.$eval( '[role="tabpanel"][id$="content-poses"]', element => element.innerText );
	assert.deepEqual( report.pageErrors, [] );
	report.passed = true;

} catch ( error ) {

	report.error = error.message;
	if ( page ) report.body = await page.$eval( 'body', element => element.innerText.slice( -2500 ) ).catch( () => null );
	if ( page ) report.workerEvidence = await page.evaluate( () => window.__adminWorkerEvidence ).catch( () => null );
	throw error;

} finally {

	report.finished = new Date().toISOString();
	await writeFile( join( evidenceDirectory, 'rayzee-admin-baseline-ready-report.json' ), JSON.stringify( report, null, 2 ) );
	console.log( JSON.stringify( report, null, 2 ) );
	await browser?.close();

}
