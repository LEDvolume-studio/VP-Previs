import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const origin = process.env.STUDENT_TEST_ORIGIN || 'http://localhost:5173';
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 240000, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ] } );
try {

	const page = await browser.newPage(); page.setDefaultTimeout( 180000 );
	const errors = [];
	page.on( 'pageerror', error => errors.push( error.message ) );
	await page.setRequestInterception( true );
	page.on( 'request', request => new URL( request.url() ).pathname === '/src/student/main.js' ? request.abort() : request.continue() );
	await page.goto( `${origin}/student/` );
	await page.evaluate( async () => {

		const { EditorSession } = await import( '/src/student/editor/EditorSession.js' );
		const { createPublishedShotViewport } = await import( '/src/student/PublishedShotViewport.js' );
		const { createStudentDemoProject } = await import( '/src/student/demo/StudentDemo.js' );
		const { document: project, catalogue } = await createStudentDemoProject( { matchAdmin: true } );
		window.cameraBaseline = JSON.stringify( project ); window.viewportCreations = 0;
		const session = window.cameraSession = new EditorSession( {
			presetRepository: null, catalogue, repository: { save() { throw new Error( 'Navigation must not save a shot.' ); } },
			createViewport: async options => {

				const view = await createPublishedShotViewport( options );
				// Exercise the rebuild path used by shots with different scene inventories.
				view.canUpdate = () => false; view.prepareShot = undefined;
				document.body.replaceChildren( view.canvas ); view.canvas.style.width = '960px'; view.canvas.style.height = '540px';
				window.viewportCreations ++; return view;

			},
		} );
		session.resolveCatalogue = async () => catalogue;
		session.set( { document: project, mode: 'inspection' } );
		await session.seek( 0 );
		if ( ! session.runtime ) throw new Error( session.state.error );

	} );
	const capture = () => page.evaluate( () => window.cameraSession.runtime.captureInspectionCamera() );
	const move = async () => {

		const box = await ( await page.$( 'canvas' ) ).boundingBox();
		await page.mouse.move( box.x + box.width / 2, box.y + box.height / 2 );
		await page.mouse.down( { button: 'middle' } );
		await page.mouse.move( box.x + box.width / 2 + 100, box.y + box.height / 2 + 40, { steps: 12 } );
		await page.mouse.up( { button: 'middle' } );
		await new Promise( resolve => setTimeout( resolve, 200 ) );

	};
	const initial = await capture(); await move(); const first = await capture();
	assert.notDeepEqual( first.transform.position, initial.transform.position );
	await page.evaluate( async () => {

		const session = window.cameraSession;
		await session.seek( session.state.document.clips[ 0 ].durationFrames );

	} );
	assert.deepEqual( await capture(), first, 'A rebuilt viewport must retain the previous workspace camera.' );
	await move(); const latest = await capture();
	assert.notDeepEqual( latest.transform.position, first.transform.position );
	await page.evaluate( async () => {

		await window.cameraSession.setMode( 'shot' ); await window.cameraSession.seek( 0 );
		await window.cameraSession.setMode( 'inspection' );

	} );
	assert.deepEqual( await capture(), latest, 'Returning to the earlier shot must retain the latest workspace camera.' );
	assert.equal( await page.evaluate( () => window.viewportCreations ), 3 );
	assert.equal( await page.evaluate( () => JSON.stringify( window.cameraSession.state.document ) === window.cameraBaseline ), true );
	await page.evaluate( () => window.cameraSession.runtime.dispose() );
	assert.deepEqual( errors, [] );
	console.log( 'PASS: native viewport navigation retains one independent camera across shot changes, viewport rebuilds and mode switches without altering saved shots.' );

} finally {

	await browser.close();

}
