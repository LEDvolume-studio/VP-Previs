import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const origin = process.env.STUDENT_TEST_ORIGIN || 'http://localhost:5173';
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 240000, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ] } );
const report = { checks: [], errors: [] };
try {

	const page = await browser.newPage(); page.setDefaultTimeout( 180000 );
	let rendererURL;
	page.on( 'pageerror', error => report.errors.push( error.message ) );
	page.on( 'request', request => { if ( new URL( request.url() ).pathname.includes( '/three_webgpu.js' ) ) rendererURL = request.url(); } );
	await page.setRequestInterception( true );
	page.on( 'request', request => new URL( request.url() ).pathname === '/src/student/main.js' ? request.abort() : request.continue() );
	await page.goto( `${origin}/student/` );
	await page.evaluate( async () => {

		window.viewportModule = await import( '/src/student/PublishedShotViewport.js' );
		window.demoModule = await import( '/src/student/demo/StudentDemo.js' );

	} );
	assert.ok( rendererURL );
	const measurements = await page.evaluate( async ( { rendererURL, videoURL } ) => {

		const { WebGPURenderer } = await import( rendererURL );
		let pipelines = 0;
		const initialize = WebGPURenderer.prototype.init;
		WebGPURenderer.prototype.init = async function ( ...args ) {

			await initialize.apply( this, args );
			const compile = this.backend.createRenderPipeline;
			this.backend.createRenderPipeline = function ( ...values ) { pipelines ++; return compile.apply( this, values ); };

		};
		const { document: project, catalogue: originalCatalogue } = await window.demoModule.createStudentDemoProject( { matchAdmin: true } );
		const { DecodedLEDSource } = await import( '/src/previs/media/DecodedLEDSource.js' );
		const video = await ( await fetch( videoURL ) ).blob();
		const bytes = new Uint8Array( await video.arrayBuffer() );
		const probe = await DecodedLEDSource.open( video ); const durationUs = Math.round( probe.duration * 1000000 ); probe.dispose();
		const sha256 = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
		project.assets[ 'cut-video@1' ] = { assetId: 'cut-video', version: '1', kind: 'video', sha256, byteLength: bytes.byteLength, mimeType: 'video/mp4', durationUs };
		const first = project.clips[ 0 ].shotId, second = project.clips[ 1 ].shotId;
		project.shots[ second ].snapshot.ledWalls[ 0 ].media = { assetId: 'cut-video', version: '1' };
		project.shots[ second ].snapshot.ledWalls[ 0 ].inPointUs = 0;
		let fetches = 0;
		const catalogue = { getScene: ( ...args ) => originalCatalogue.getScene( ...args ), getAssetBytes: ( asset, options ) => {

			fetches ++; return asset.assetId === 'cut-video' ? bytes : originalCatalogue.getAssetBytes( asset, options );

		} };
		const view = await window.viewportModule.createPublishedShotViewport( { document: project, shotId: first, catalogue } );
		document.body.replaceChildren( view.canvas );
		const initial = view.inspect();
		if ( view.canUpdate( project, second ) ) throw new Error( 'Unprepared new video must not be treated as loaded.' );
		const visibleBeforePreparation = view.canvas.toDataURL();
		// Starting midway must not mark earlier, unseen shots as warmed.
		await view.preparePlayback( project, project.clips[ 0 ].durationFrames );
		const ready = await view.preparePlayback( project, 0 );
		if ( view.canvas.toDataURL() !== visibleBeforePreparation ) throw new Error( 'Playback preparation flashed upcoming shots into the visible preview.' );
		if ( ! ready || ! view.canUpdate( project, second ) || view.inspect().decodedCount !== 2 ) throw new Error( 'Upcoming video was not verified and prepared on the same viewport.' );
		const mediaFetches = fetches;
		const coldPipelines = pipelines, firstCutStart = performance.now();
		await view.updateDocument( project, second, { playback: true } ); await view.renderFrame( 0 );
		const firstPreparedCutMs = Math.round( performance.now() - firstCutStart ), firstCutPipelines = pipelines - coldPipelines;
		await view.updateDocument( project, first, { playback: true } ); await view.renderFrame( 0 );
		const baseline = [], optimized = [];
		for ( let index = 0; index < 4; index ++ ) {

			const id = index % 2 ? first : second;
			const start = performance.now(); await view.updateDocument( project, id ); await view.renderFrame( 0 ); baseline.push( performance.now() - start );

		}
		// Return to each state before the repeated transition measurements.
		await view.updateDocument( project, second, { playback: true } ); await view.renderFrame( 0 );
		await view.updateDocument( project, first, { playback: true } ); await view.renderFrame( 0 );
		const compiled = pipelines;
		for ( let index = 0; index < 8; index ++ ) {

			const id = index % 2 ? first : second;
			const start = performance.now(); await view.updateDocument( project, id, { playback: true } ); await view.renderFrame( 0 ); optimized.push( performance.now() - start );

		}
		const final = view.inspect();
		const result = { firstPreparedCutMs, firstCutPipelines, baselineMs: baseline.map( Math.round ), preparedCutMs: optimized.map( Math.round ), pipelinesDuringCuts: pipelines - compiled, fetchesDuringCuts: fetches - mediaFetches, sameGeometry: JSON.stringify( initial.geometryIds ) === JSON.stringify( final.geometryIds ), sameLED: JSON.stringify( initial.ledResourceIds ) === JSON.stringify( final.ledResourceIds ), decodedSources: final.decodedCount };
		await view.dispose(); return result;

	}, { rendererURL, videoURL: `${origin}/@fs${process.cwd()}/tests/unit/previs/fixtures/led-test-h264.mp4` } );
	Object.assign( report, measurements );
	assert.equal( measurements.sameGeometry, true ); assert.equal( measurements.sameLED, true );
	assert.equal( measurements.decodedSources, 2 ); assert.equal( measurements.fetchesDuringCuts, 0 );
	assert.equal( measurements.pipelinesDuringCuts, 0 );
	assert.equal( measurements.firstCutPipelines, 0 );
	report.checks.push( 'A different verified LED video preloads without rebuilding the viewport' );
	report.checks.push( 'Repeated positional/video cuts keep geometry, LED material and texture identities' );
	report.checks.push( 'Prepared cuts perform no asset fetches and compile no render pipelines' );
	assert.deepEqual( report.errors, [] ); report.passed = true;

} catch ( error ) { report.failure = error.stack; process.exitCode = 1; } finally {

	console.log( JSON.stringify( report, null, 2 ) ); await writeFile( '/tmp/previs-playback-cuts-report.json', JSON.stringify( report, null, 2 ) ); await browser.close();

}
