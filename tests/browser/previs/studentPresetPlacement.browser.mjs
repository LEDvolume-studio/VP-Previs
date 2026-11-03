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
		const runtime = session.runtime, initial = runtime.inspect(), before = clone( project ), shotId = runtime.shotId;
		const preset = { baseScene: clone( project.shots[ shotId ].baseScene ), snapshot: clone( project.shots[ shotId ].snapshot ), assets: clone( project.assets ) };
		preset.snapshot.camera.transform.position[ 0 ] += 1;
		preset.snapshot.nodes[ 'suv-root' ].transform.position[ 0 ] += 2;
		// These resource changes used to replace the renderer and compile a new shot.
		preset.snapshot.lights = [];
		const media = preset.snapshot.ledWalls[ 0 ].media;
		preset.assets[ 'other-video@1' ] = { ...preset.assets[ `${media.assetId}@${media.version}` ], assetId: 'other-video' };
		preset.snapshot.ledWalls[ 0 ].media = { assetId: 'other-video', version: '1' };
		const baseline = { builds, compiles, pipelines, fetches }, status = [];
		const unsubscribe = session.subscribe( () => status.push( session.state.loading ) );
		const pixels = runtime.canvas.toDataURL();
		await session.applyPreset( { studentPreset: preset } );
		if ( session.state.error ) throw new Error( session.state.error );
		const applied = clone( session.state.document );
		const pixelChanged = runtime.canvas.toDataURL() !== pixels;
		await session.undoEdit();
		if ( session.state.error ) throw new Error( session.state.error );
		unsubscribe();
		const final = session.runtime.inspect();
		const result = {
			builds: builds - baseline.builds, compiles: compiles - baseline.compiles, pipelines: pipelines - baseline.pipelines, fetches: fetches - baseline.fetches,
			sameRuntime: session.runtime === runtime, sameGeometry: JSON.stringify( initial.geometryIds ) === JSON.stringify( final.geometryIds ), pixelChanged, saves,
			loadingScreen: status.some( value => /compil|loading verified/i.test( value ) ),
			appliedCamera: applied.shots[ shotId ].snapshot.camera.transform.position,
			appliedObject: applied.shots[ shotId ].snapshot.nodes[ 'suv-root' ].transform.position,
			expectedCamera: preset.snapshot.camera.transform.position, expectedObject: preset.snapshot.nodes[ 'suv-root' ].transform.position,
			resourcesPreserved: JSON.stringify( applied.assets ) === JSON.stringify( before.assets ) && JSON.stringify( applied.shots[ shotId ].snapshot.lights ) === JSON.stringify( before.shots[ shotId ].snapshot.lights ) && JSON.stringify( applied.shots[ shotId ].snapshot.ledWalls ) === JSON.stringify( before.shots[ shotId ].snapshot.ledWalls ),
			undoRestored: JSON.stringify( session.state.document.shots ) === JSON.stringify( before.shots ),
		};
		await session.dispose(); return result;

	}, { rendererURL, repo: process.cwd() } );
	assert.deepEqual( result.appliedCamera, result.expectedCamera ); assert.deepEqual( result.appliedObject, result.expectedObject );
	for ( const key of [ 'builds', 'compiles', 'pipelines', 'fetches' ] ) assert.equal( result[ key ], 0, key );
	for ( const key of [ 'sameRuntime', 'sameGeometry', 'pixelChanged', 'resourcesPreserved', 'undoRestored' ] ) assert.equal( result[ key ], true, key );
	assert.equal( result.loadingScreen, false ); assert.equal( result.saves, 2 ); assert.deepEqual( errors, [] );
	console.log( JSON.stringify( result, null, 2 ) );

} finally {

	await browser.close();

}
