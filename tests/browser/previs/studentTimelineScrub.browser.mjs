import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const origin = process.env.STUDENT_TEST_ORIGIN || 'http://localhost:5173';
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 240000, args: [ '--enable-unsafe-webgpu' ] } );
try {

	const page = await browser.newPage(); page.setDefaultTimeout( 180000 );
	const errors = []; let rendererURL;
	page.on( 'pageerror', error => errors.push( error.message ) );
	page.on( 'request', request => { if ( new URL( request.url() ).pathname.includes( '/three_webgpu.js' ) ) rendererURL = request.url(); } );
	await page.setRequestInterception( true );
	page.on( 'request', request => new URL( request.url() ).pathname === '/src/student/main.js' ? request.abort() : request.continue() );
	await page.goto( `${origin}/student/` );
	await page.evaluate( () => import( '/src/student/PublishedShotViewport.js' ) );
	assert.ok( rendererURL );
	const result = await page.evaluate( async ( { rendererURL, repo } ) => {

		const { WebGPURenderer } = await import( rendererURL );
		const { RealtimeRenderer } = await import( `/@fs${repo}/rayzee/src/managers/RealtimeRenderer.js` );
		const { EditorSession } = await import( '/src/student/editor/EditorSession.js' );
		const { createPublishedShotViewport } = await import( '/src/student/PublishedShotViewport.js' );
		const { createStudentDemoProject } = await import( '/src/student/demo/StudentDemo.js' );
		const { document: project, catalogue } = await createStudentDemoProject( { matchAdmin: true } );
		const clone = value => structuredClone( value );
		const firstId = project.clips[ 0 ].shotId, secondId = project.clips[ 1 ].shotId;
		const firstShot = project.shots[ firstId ];
		project.shots[ secondId ].snapshot.lights = [];
		project.shots[ secondId ].snapshot.ledWalls = clone( firstShot.snapshot.ledWalls );
		const third = clone( firstShot ); third.shotId = 'third'; third.name = 'Different saved lights';
		third.snapshot.lights = [ { ...clone( firstShot.snapshot.lights[ 0 ] ), lightId: 'other-light' } ];
		third.snapshot.camera.transform.position[ 0 ] += 2;
		third.snapshot.nodes[ 'suv-root' ].transform.position[ 0 ] += 1;
		project.shots.third = third;
		project.clips.push( { clipId: 'third', shotId: 'third', durationFrames: 100 } );
		let builds = 0, compiles = 0, pipelines = 0, fetches = 0, saves = 0;
		const compile = RealtimeRenderer.prototype.precompile;
		RealtimeRenderer.prototype.precompile = function ( ...args ) { compiles ++; return compile.apply( this, args ); };
		const initialize = WebGPURenderer.prototype.init;
		WebGPURenderer.prototype.init = async function ( ...args ) {

			await initialize.apply( this, args );
			const pipeline = this.backend.createRenderPipeline;
			this.backend.createRenderPipeline = function ( ...values ) { pipelines ++; return pipeline.apply( this, values ); };

		};
		const assetBytes = catalogue.getAssetBytes.bind( catalogue );
		catalogue.getAssetBytes = ( ...args ) => { fetches ++; return assetBytes( ...args ); };
		const session = new EditorSession( {
			presetRepository: null, catalogue,
			repository: { save: async value => { saves ++; return clone( value ); }, list: async () => [] },
			createViewport: async options => {

				builds ++; const view = await createPublishedShotViewport( options );
				document.body.replaceChildren( view.canvas ); return view;

			},
		} );
		session.resolveCatalogue = async () => catalogue;
		session.set( { document: project } ); await session.seek( 0 );
		if ( ! session.runtime ) throw new Error( session.state.error );
		const runtime = session.runtime, initial = runtime.inspect(), before = clone( project );
		const baseline = { builds, compiles, pipelines, fetches }, status = [], frames = [];
		const unsubscribe = session.subscribe( () => status.push( session.state.loading ) );
		const starts = [ 0, project.clips[ 0 ].durationFrames, project.clips[ 0 ].durationFrames + project.clips[ 1 ].durationFrames ];
		const initialPixels = runtime.canvas.toDataURL();
		for ( const mode of [ 'shot', 'inspection' ] ) {

			await session.setMode( mode );
			for ( const index of [ 1, 2, 0, 2, 1, 0 ] ) {

				await session.seek( starts[ index ] );
				if ( session.state.error ) throw new Error( session.state.error );
				const camera = await session.runtime.captureCamera();
				const expected = project.shots[ project.clips[ index ].shotId ].snapshot.camera;
				if ( JSON.stringify( camera.transform.position ) !== JSON.stringify( expected.transform.position ) ) throw new Error( 'Saved shot camera was not applied.' );
				frames.push( session.runtime.canvas.toDataURL() );

			}

		}
		await session.setMode( 'shot' );
		const roundtripPixels = runtime.canvas.toDataURL();
		unsubscribe();
		const final = session.runtime.inspect();
		const result = {
			builds: builds - baseline.builds, compiles: compiles - baseline.compiles, pipelines: pipelines - baseline.pipelines, fetches: fetches - baseline.fetches,
			sameRuntime: session.runtime === runtime, sameGeometry: JSON.stringify( initial.geometryIds ) === JSON.stringify( final.geometryIds ), saves,
			loadingScreen: status.some( value => /compil|loading verified/i.test( value ) ),
			distinctShots: new Set( frames ).size >= 3,
			originalFrameRestored: initialPixels === roundtripPixels,
			documentUnchanged: JSON.stringify( session.state.document ) === JSON.stringify( before ),
			scrubs: frames.length,
		};
		await session.dispose(); return result;

	}, { rendererURL, repo: process.cwd() } );
	for ( const key of [ 'builds', 'compiles', 'pipelines', 'fetches', 'saves' ] ) assert.equal( result[ key ], 0, key );
	for ( const key of [ 'sameRuntime', 'sameGeometry', 'distinctShots', 'originalFrameRestored', 'documentUnchanged' ] ) assert.equal( result[ key ], true, key );
	assert.equal( result.loadingScreen, false ); assert.deepEqual( errors, [] );
	console.log( JSON.stringify( result, null, 2 ) );

} finally {

	await browser.close();

}
