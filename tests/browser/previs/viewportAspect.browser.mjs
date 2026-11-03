import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const origin = process.env.STUDENT_TEST_ORIGIN || 'http://127.0.0.1:5178';
const directory = '.local-runtime/viewport-aspect-validation';
await mkdir( directory, { recursive: true } );
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 240000, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ] } );
const report = { checks: [], errors: [], sizes: [] };
try {

	const page = await browser.newPage(); page.setDefaultTimeout( 180000 );
	page.on( 'pageerror', error => report.errors.push( error.message ) );
	await page.setViewport( { width: 1586, height: 992 } );
	await page.goto( origin ); await page.bringToFront();
	await page.waitForFunction( async () => {

		const { projectSession } = await import( '/src/services/projects/ProjectSession.js' );
		return !! projectSession.current && ! projectSession.hydrating;

	} );
	await page.locator( '[role="menubar"] [role="menuitem"]' ).click();
	await page.locator( '[role="menuitem"]::-p-text(Open Default Project)' ).click();
	await page.waitForFunction( () => document.querySelectorAll( '[aria-label="Student presets"] [aria-label^="Apply "]' ).length === 6 );
	await page.waitForFunction( async () => ! ( await import( '/src/services/presets/AdminPresetService.js' ) ).getAdminPresetService().getState().busy );
	console.log( 'Admin student default scene ready.' );
	const inspect = () => page.evaluate( async () => {

		const { getApp } = await import( '/src/lib/appProxy.js' );
		const app = getApp(), rect = app.canvas.getBoundingClientRect(), parent = app.canvas.parentElement.getBoundingClientRect();
		const { usePathTracerStore } = await import( '/src/store.js' );
		const state = usePathTracerStore.getState(), camera = app.cameraManager.camera;
		return { width: rect.width, height: rect.height, parentWidth: parent.width, parentHeight: parent.height, aspect: camera.aspect, matrixAspect: camera.projectionMatrix.elements[ 5 ] / camera.projectionMatrix.elements[ 0 ], output: [ state.canvasWidth, state.canvasHeight ], fov: camera.fov };

	} );
	for ( const [ width, height ] of [ [ 1586, 992 ], [ 1100, 850 ], [ 1900, 720 ], [ 1280, 1100 ] ] ) {

		await page.setViewport( { width, height } );
		await page.waitForFunction( async () => {

			const app = ( await import( '/src/lib/appProxy.js' ) ).getApp(), rect = app.canvas.getBoundingClientRect();
			const available = app.canvas.parentElement.parentElement.parentElement.getBoundingClientRect();
			return Math.abs( rect.width / rect.height - 16 / 9 ) < 0.001 && rect.width <= available.width - 39 && rect.height <= available.height - 39;

		} );
		const measured = await inspect(); report.sizes.push( { window: [ width, height ], ...measured } );
		assert.ok( Math.abs( measured.width / measured.height - 16 / 9 ) < 0.001 );
		assert.ok( Math.abs( measured.parentWidth / measured.parentHeight - 16 / 9 ) < 0.001 );
		assert.equal( measured.aspect, 16 / 9 ); assert.equal( measured.matrixAspect, 16 / 9 );
		assert.equal( measured.output[ 0 ] / measured.output[ 1 ], 16 / 9 );

	}
	report.checks.push( 'Admin display, output and camera gate remain 16:9 across wide, narrow, short and tall browser layouts.' );
	await page.evaluate( async () => {

		const { getApp } = await import( '/src/lib/appProxy.js' ), { useCameraStore, usePathTracerStore } = await import( '/src/store.js' );
		useCameraStore.getState().setFrameOverlayRatio( '4:3' );
		usePathTracerStore.getState().handleAspectPresetChange( '1:1' );
		usePathTracerStore.getState().handleOrientationToggle();
		getApp().refreshViewport();

	} );
	const overlay = await page.evaluate( () => [ ...document.querySelectorAll( '.bg-black\\/50' ) ].filter( element => element.style.width === '12.5%' ).map( element => getComputedStyle( element ).backgroundColor ) );
	assert.equal( overlay.length, 2 ); assert.ok( overlay.every( color => /0\.5/.test( color ) ) );
	assert.equal( ( await inspect() ).aspect, 16 / 9 );
	report.checks.push( '4:3 framing is a pair of 50% masks; legacy output ratio/orientation controls cannot change the photographic gate.' );
	await page.evaluate( async () => {

		const service = ( await import( '/src/services/presets/AdminPresetService.js' ) ).getAdminPresetService();
		await service.selectPreset( 'studio-camera-rear' );
		const record = await service.repository.get( 'studio-camera-rear' );
		record.adminDocument.extensions.projectPresetState ||= service.session.current.extensions.projectPresets[ record.presetId ].state;
		record.adminDocument.extensions.projectPresetState.camera.projection.aspect = 0.75;
		record.studentPreset.snapshot.camera.projection.aspect = 0.75;
		await service.repository.save( record, { expectedRevision: record.revision } );
		await service.refresh(); await service.selectPreset( record.presetId );

	} );
	assert.equal( ( await inspect() ).aspect, 16 / 9 );
	const saved = await page.evaluate( async () => {

		const service = ( await import( '/src/services/presets/AdminPresetService.js' ) ).getAdminPresetService();
		await new Promise( resolve => setTimeout( resolve, 1000 ) );
		const captures = [], capture = service.session.capture.bind( service.session );
		service.session.capture = () => {

			const source = capture(); captures.push( structuredClone( source ) ); return source;

		};
		let record;
		try {

			record = await service.saveCurrent( { name: 'Close Up rear view' } );

		} catch ( error ) {

			const before = captures.at( - 2 ), after = captures.at( - 1 ), differences = [];
			const compare = ( a, b, path = '' ) => {

				if ( JSON.stringify( a ) === JSON.stringify( b ) ) return;
				if ( a && b && typeof a === 'object' && typeof b === 'object' ) for ( const key of new Set( [ ...Object.keys( a ), ...Object.keys( b ) ] ) ) compare( a[ key ], b[ key ], `${path}.${key}` );
				else differences.push( { path, before: a, after: b } );

			};
			compare( before, after ); throw new Error( `${error.message}: ${JSON.stringify( differences )}` );

		} finally { service.session.capture = capture; }

		const image = await createImageBitmap( record.thumbnail );
		const result = { aspect: record.studentPreset.snapshot.camera.projection.aspect, width: image.width, height: image.height };
		image.close(); return result;

	} );
	assert.equal( saved.aspect, 16 / 9 ); assert.equal( saved.width / saved.height, 16 / 9 );
	report.checks.push( 'An old 3:4 camera preset opens without stretching and saves a normalized 16:9 camera and thumbnail.' );
	await page.screenshot( { path: `${directory}/admin-16x9.png` } );
	const student = await browser.newPage(); student.setDefaultTimeout( 180000 );
	student.on( 'pageerror', error => report.errors.push( error.message ) );
	await student.setRequestInterception( true );
	student.on( 'request', request => new URL( request.url() ).pathname === '/src/student/main.js' ? request.abort() : request.continue() );
	await student.goto( `${origin}/student/` ); await student.bringToFront();
	const compared = await student.evaluate( async () => {

		const { getLocalPresetRepository } = await import( '/src/services/presets/LocalPresetRepository.js' );
		const { createLocalPresetCatalogue } = await import( '/src/services/presets/LocalPresetCatalogue.js' );
		const { createPublishedShotViewport } = await import( '/src/student/PublishedShotViewport.js' );
		const { createStudentProjectDocument } = await import( '/src/previs/domain/StudentProjectSchema.js' );
		const { applyStudentCommand } = await import( '/src/previs/domain/StudentCommands.js' );
		const repository = getLocalPresetRepository(), record = await repository.get( 'studio-camera-rear' );
		const project = applyStudentCommand( createStudentProjectDocument(), { type: 'addPresetShot', preset: record.studentPreset, shotId: 'rear', clipId: 'rear' } ).document;
		project.shots.rear.snapshot.camera.projection.aspect = 0.75;
		const view = await createPublishedShotViewport( { document: project, shotId: 'rear', catalogue: createLocalPresetCatalogue( repository ) } );
		document.body.replaceChildren( view.canvas );
		await view.renderFrame( 0 );
		const bad = view.canvas.toDataURL(), actual = ( await view.captureCamera() ).projection.aspect;
		const corrected = structuredClone( project ); corrected.shots.rear.snapshot.camera.projection.aspect = 16 / 9;
		await view.updateDocument( corrected, 'rear' ); await view.renderFrame( 0 );
		const good = view.canvas.toDataURL();
		const result = { actual, identicalPixels: good === bad, width: view.canvas.width, height: view.canvas.height };
		window.aspectViewport = view;
		return result;

	} );
	assert.equal( compared.actual, 16 / 9 ); assert.equal( compared.identicalPixels, true );
	assert.equal( compared.width / compared.height, 16 / 9 );
	report.checks.push( 'Student rendering of an existing distorted rear preset is pixel-identical to the corrected 16:9 reference, without editing its saved camera data.' );
	await student.screenshot( { path: `${directory}/student-corrected-rear.png` } );
	await student.evaluate( () => window.aspectViewport.dispose() );
	assert.deepEqual( report.errors, [] ); report.passed = true;

} catch ( error ) { report.failure = error.stack; process.exitCode = 1; } finally {

	console.log( JSON.stringify( report, null, 2 ) );
	await writeFile( `${directory}/report.json`, JSON.stringify( report, null, 2 ) );
	await browser.close();

}
