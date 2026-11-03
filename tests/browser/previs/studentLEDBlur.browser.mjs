import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const origin = process.env.STUDENT_TEST_ORIGIN || 'http://127.0.0.1:5190';
const artifacts = process.env.PREVIS_ARTIFACT_DIR || '/tmp/rayzee-led-blur';
await mkdir( artifacts, { recursive: true } );
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, timeout: 30000, protocolTimeout: 180000, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ] } );
try {

	const page = await browser.newPage(); page.setDefaultTimeout( 180000 );
	const errors = [];
	page.on( 'pageerror', error => { errors.push( error.message ); console.log( 'PAGE ERROR', error.message ); } );
	page.on( 'console', message => { if ( message.type() === 'error' ) console.log( 'CONSOLE', message.text().slice( 0, 1000 ) ); } );
	await page.setViewport( { width: 1400, height: 1000 } );
	await page.setRequestInterception( true );
	page.on( 'request', request => new URL( request.url() ).pathname === '/src/student/main.js' ? request.abort() : request.continue() );
	await page.goto( `${origin}/student/` );
	console.log( 'Creating real demo viewport' );
	await page.evaluate( async () => {

		const { createPublishedShotViewport } = await import( '/src/student/PublishedShotViewport.js' );
		const { createStudentDemoProject } = await import( '/src/student/demo/StudentDemo.js' );
		const { document: project, catalogue } = await createStudentDemoProject( { matchAdmin: true } );
		window.blurProject = project;
		window.blurView = await createPublishedShotViewport( { document: project, shotId: project.clips[ 0 ].shotId, catalogue, onStatus: text => console.log( text ) } );
		document.body.replaceChildren( window.blurView.canvas );
		window.blurView.canvas.style.width = '960px'; window.blurView.canvas.style.height = '540px';
		window.blurWallId = project.shots[ project.clips[ 0 ].shotId ].snapshot.ledWalls[ 0 ].wallId;
		window.blurOriginal = JSON.stringify( project );

	} );
	console.log( 'Viewport ready; testing blur shaders' );
	const images = [];
	for ( const method of [ 'off', 'fast', 'gaussian', 'lens' ] ) {

		await page.evaluate( method => window.blurView.previewLEDBlur( window.blurWallId, { method, amount: 24 } ), method );
		images.push( await page.$eval( 'canvas', canvas => canvas.toDataURL() ) );
		await page.screenshot( { path: `${artifacts}/${method}.png` } );

	}
	assert.equal( new Set( images ).size, 4, 'Every algorithm must produce a distinct rendered screen' );
	await page.evaluate( () => window.blurView.previewLEDBlur( window.blurWallId, null ) );
	assert.equal( await page.$eval( 'canvas', canvas => canvas.toDataURL() ), images[ 0 ], 'Cancelling restores the original frame' );
	const before = await page.evaluate( () => window.blurView.inspect() );
	console.log( 'Comparing 25 fps playback including decoding and GPU completion' );
	const comparison = await page.evaluate( () => window.blurView.compareLEDBlur( window.blurWallId, 12, method => console.log( 'Benchmark', method ) ) );
	const after = await page.evaluate( () => window.blurView.inspect() );
	assert.deepEqual( after.ledResourceIds, before.ledResourceIds, 'Benchmark reuses material and texture resources' );
	assert.equal( await page.evaluate( () => JSON.stringify( window.blurProject ) === window.blurOriginal ), true );
	assert.equal( comparison.length, 4 );
	for ( const result of comparison ) { assert.ok( result.fps > 0 && result.fps <= 25 ); assert.ok( result.meanMs > 0 ); }
	console.log( JSON.stringify( comparison, null, 2 ) );
	await writeFile( `${artifacts}/comparison.json`, JSON.stringify( { browser: await browser.version(), comparison, errors }, null, 2 ) );
	await page.evaluate( async path => {

		const { mountInspector } = await import( path );
		const host = document.createElement( 'div' ); host.style.width = '300px';
		document.body.style.display = 'flex'; document.body.style.alignItems = 'flex-start'; document.body.append( host );
		mountInspector( window.blurView, window.blurProject, host );

	}, `/@fs${process.cwd()}/tests/browser/previs/LEDBlurInspectorHarness.jsx` );
	await page.waitForSelector( '[aria-label="LED blur algorithm"]' );
	assert.equal( await page.$( '[aria-label="Camera height · world Y"]' ), null );
	assert.equal( await page.$eval( '[aria-label="Exposure slider"]', element => element.max ), '2' );
	assert.equal( await page.evaluate( () => document.body.innerText.includes( 'Focal length previews as you adjust it.' ) ), false );
	await page.select( '[aria-label="LED blur algorithm"]', 'lens' );
	await page.waitForFunction( () => window.inspectorDocument.shots[ window.inspectorDocument.clips[ 0 ].shotId ].snapshot.ledWalls[ 0 ].blur?.method === 'lens' );
	await page.waitForSelector( '[aria-label="Blur amount slider"]:enabled' );
	const revision = await page.evaluate( () => window.inspectorDocument.revision );
	const slider = await ( await page.$( '[aria-label="Blur amount slider"]' ) ).boundingBox();
	await page.mouse.move( slider.x + slider.width * 0.4, slider.y + slider.height / 2 ); await page.mouse.down();
	await page.mouse.move( slider.x + slider.width * 0.75, slider.y + slider.height / 2, { steps: 4 } );
	assert.equal( await page.evaluate( () => window.inspectorDocument.revision ), revision, 'Dragging must not save intermediate edits' );
	await page.mouse.up();
	await page.waitForFunction( revision => window.inspectorDocument.revision === revision + 1, {}, revision );
	await page.waitForSelector( '[aria-label="Blur amount slider"]:enabled' );
	await page.click( '.sim-blur-compare' );
	await page.waitForSelector( '[aria-label="LED blur playback comparison"]' );
	assert.equal( await page.$$eval( '.sim-blur-results tbody tr', rows => rows.length ), 4 );
	await page.screenshot( { path: `${artifacts}/inspector.png` } );
	await page.evaluate( () => window.blurView.dispose() );
	assert.deepEqual( errors, [] );
	console.log( 'PASS: real LED blur shaders, video playback, cancellation, stable resources and transient comparison.' );

} finally {

	await browser.close();

}
