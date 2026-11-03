import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const origin = process.env.STUDENT_TEST_ORIGIN || 'http://localhost:5173';
const directory = '/tmp/sim-trav-admin-presets';
await mkdir( directory, { recursive: true } );
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 240000, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ] } );
const report = { checks: [], errors: [] };
let admin, serviceURL;
try {

	const student = await browser.newPage(); student.setDefaultTimeout( 180000 );
	await student.setViewport( { width: 1586, height: 992 } );
	student.on( 'pageerror', error => report.errors.push( error.message ) );
	await student.goto( `${origin}/student/?ui=editor` );
	await student.waitForFunction( () => ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled && document.querySelectorAll( '.sim-preset' ).length === 6 );
	admin = await browser.newPage(); admin.setDefaultTimeout( 180000 ); await admin.setViewport( { width: 1586, height: 992 } );
	admin.on( 'pageerror', error => report.errors.push( error.message ) );
	admin.on( 'request', request => {

		if ( new URL( request.url() ).pathname === '/src/services/presets/AdminPresetService.js' ) serviceURL = request.url();

	} );
	admin.on( 'console', message => { if ( message.type() === 'error' ) console.log( message.text().slice( 0, 400 ) ); } );
	await admin.goto( `${origin}/` );
	await admin.bringToFront(); console.log( 'Admin loaded; waiting for ready scene' );
	await admin.waitForFunction( async () => {

		const { getApp } = await import( '/src/lib/appProxy.js' ), { useProjectStore } = await import( '/src/services/projects/projectStore.js' );
		return Boolean( getApp() ) && useProjectStore.getState().status === 'saved';

	}, { polling: 500 } );
	console.log( 'Admin scene ready' );
	const waitPreset = () => admin.waitForFunction( async path => {

		const { getAdminPresetService } = await import( path );
		return ! getAdminPresetService().getState().busy;

	}, { polling: 500 }, serviceURL || `${origin}/src/services/presets/AdminPresetService.js` );
	await admin.locator( '[role="menubar"] [role="menuitem"]' ).click();
	await admin.locator( '[role="menuitem"]::-p-text(Open Default Project)' ).click();
	await admin.waitForFunction( () => document.querySelectorAll( '[aria-label="Student presets"] [aria-label^="Apply "]' ).length === 6 );
	console.log( 'Student default project opened from File menu' );
	await waitPreset();
	assert.equal( await admin.evaluate( async path => ( await import( path ) ).getAdminPresetService().session.current.extensions.studentPresetLibrary, serviceURL ), true );
	report.checks.push( 'File → Open Default Project opens the full student studio scene and all six student presets without database setup' );
	await admin.evaluate( async path => {

		const app = ( await import( '/src/lib/appProxy.js' ) ).getApp();
		const session = ( await import( path ) ).getAdminPresetService().session;
		window.presetSwitchProof = { projectId: session.current.projectId, roots: [ ...app.meshScene.children ], loads: 0 };
		for ( const key of [ 'loadExampleModels', 'loadSceneData', 'loadEnvironment', 'addModels', 'unloadScene' ] ) {

			const original = app[ key ];
			app[ key ] = function ( ...args ) { window.presetSwitchProof.loads ++; return original.apply( this, args ); };

		}

	}, serviceURL );
	await admin.locator( '[aria-label="Apply Front three-quarter"]' ).click(); await waitPreset();
	console.log( 'Preset loaded for editing' );
	let state = await admin.evaluate( async path => ( await import( path ) ).getAdminPresetService().getState(), serviceURL );
	assert.equal( state.selectedPresetId, 'studio-camera-front' ); assert.equal( state.error, '' );
	await admin.evaluate( async path => {

		const app = ( await import( '/src/lib/appProxy.js' ) ).getApp();
		const session = ( await import( path ) ).getAdminPresetService().session;
		if ( window.presetSwitchProof.loads || session.current.projectId !== window.presetSwitchProof.projectId || window.presetSwitchProof.roots.some( ( root, index ) => app.meshScene.children[ index ] !== root ) ) throw new Error( 'Preset switching reloaded project resources.' );

	}, serviceURL );
	const switches = await admin.evaluate( async path => {

		const service = ( await import( path ) ).getAdminPresetService();
		const app = service.app(), meshes = ( app.sceneMeshes || [] ).map( mesh => ( { mesh, geometry: mesh.geometry, material: mesh.material } ) );
		let compilations = 0;
		const backend = app.renderer.backend, original = backend.createRenderPipeline;
		backend.createRenderPipeline = function ( ...args ) { compilations ++; return original.apply( this, args ); };
		const timings = [];
		for ( const id of [ 'studio-camera-high', 'studio-camera-side', 'studio-camera-front' ] ) {

			const start = performance.now(); await service.selectPreset( id ); timings.push( Math.round( performance.now() - start ) );
			await new Promise( resolve => requestAnimationFrame( () => requestAnimationFrame( resolve ) ) );

		}
		if ( window.presetSwitchProof.loads || meshes.some( ( { mesh, geometry, material } ) => mesh.geometry !== geometry || mesh.material !== material ) ) throw new Error( 'Switching replaced project resources.' );
		backend.createRenderPipeline = original;
		if ( compilations ) throw new Error( `Preset switching compiled ${compilations} render pipelines.` );
		return timings;

	}, serviceURL );
	report.switchMilliseconds = switches;
	report.checks.push( 'Repeated preset switching retains geometry/materials and compiles zero render pipelines' );
	report.checks.push( 'Admin Presets tab applies camera/object transforms within the current project' );
	await admin.evaluate( async () => {

		const app = ( await import( '/src/lib/appProxy.js' ) ).getApp();
		if ( Math.abs( app.cameraManager.camera.fov - 48 ) > 0.01 || Math.abs( app.cameraManager.camera.aspect - 16 / 9 ) > 0.001 ) throw new Error( 'Loading a preset must preserve its saved framing.' );
		app.cameraManager.camera.position.x += 0.6; app.cameraManager.controls.update(); app.reset();
		for ( const [ instanceId, offset ] of [ [ 'seed-suv', 1.5 ], [ 'seed-mannequin', 0.8 ] ] ) {

			const root = app.meshScene.children.find( object => object.userData.__rayzeeProjectInstanceId === instanceId );
			if ( ! root ) throw new Error( `Missing native ${instanceId}` );
			root.position.x += offset; app.transformManager.applyObjectTransform( root );

		}
		const light = app.lightManager.scene.getObjectsByProperty( 'isLight', true )[ 0 ];
		light.position.set( 4, 7, 3 ); light.intensity = 37; light.visible = false;
		light.updateMatrixWorld( true ); app.lightManager.updateLights();

	} );
	await admin.locator( '#admin-preset-name' ).fill( 'Edited front camera' );
	await admin.locator( 'button::-p-text(Update preset)' ).click(); await waitPreset();
	state = await admin.evaluate( async path => ( await import( path ) ).getAdminPresetService().getState(), serviceURL );
	assert.equal( state.error, '', state.error );
	const saved = await admin.evaluate( async () => ( await import( '/src/services/presets/LocalPresetRepository.js' ) ).getLocalPresetRepository().get( 'studio-camera-front' ) );
	assert.equal( saved.revision, 1 ); assert.equal( saved.name, 'Edited front camera' ); assert.ok( saved.studentPreset.thumbnail );
	assert.ok( Math.abs( saved.studentPreset.snapshot.camera.transform.position[ 0 ] - 6.4 ) < 0.01 );
	assert.equal( saved.adminDocument.extensions.projectPresetState.lights[ 0 ].intensity, 37 );
	assert.equal( saved.studentPreset.snapshot.lights[ 0 ].intensity, 37 );
	assert.equal( saved.studentPreset.snapshot.lights[ 0 ].transform.visible, false );
	assert.deepEqual( saved.studentPreset.snapshot.lights[ 0 ].transform.position, [ 4, 7, 3 ] );
	await admin.evaluate( async path => {

		const service = ( await import( path ) ).getAdminPresetService();
		const original = service.app().lightManager.scene.getObjectsByProperty( 'isLight', true )[ 0 ];
		await service.selectPreset( 'studio-camera-side' ); await service.selectPreset( 'studio-camera-front' );
		const light = service.app().lightManager.scene.getObjectsByProperty( 'isLight', true )[ 0 ];
		if ( light !== original || light.intensity !== 37 || light.visible !== false || light.position.toArray().join() !== '4,7,3' ) throw new Error( 'Saved light state was not restored on the existing admin light.' );

	}, serviceURL );
	report.checks.push( 'Save update captures the actual edited camera and full scene, verifies source bytes and automatically renders a new thumbnail' );
	await student.bringToFront();
	await student.waitForFunction( () => [ ...document.querySelectorAll( '.sim-preset' ) ].some( element => element.textContent.includes( 'Edited front camera' ) ) );
	report.checks.push( 'An already-open student view receives the saved preset and thumbnail without reload' );
	const readStudent = () => student.evaluate( () => new Promise( resolve => {

		const request = indexedDB.open( 'RayzeeStudentDB', 1 );
		request.onsuccess = () => {

			const db = request.result, tx = db.transaction( 'projects', 'readonly' ), rows = tx.objectStore( 'projects' ).getAll();
			tx.oncomplete = () => { db.close(); resolve( rows.result[ 0 ].document ); };

		};

	} ) );
	const beforePreset = await readStudent();
	await student.evaluate( () => { window.beforeAdminPresetCanvas = document.querySelector( '#sim-viewport-host canvas' ); } );
	await student.evaluate( () => [ ...document.querySelectorAll( '.sim-preset' ) ].find( item => item.textContent === 'Edited front camera' ).click() );
	await student.waitForFunction( () => document.querySelector( '[aria-label="Focal length"]' )?.value === '35' || ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled );
	let appliedStudent;
	for ( let attempt = 0; attempt < 50; attempt ++ ) {

		appliedStudent = await readStudent();
		if ( appliedStudent.revision > beforePreset.revision ) break;
		await new Promise( resolve => setTimeout( resolve, 100 ) );

	}
	const selectedShot = beforePreset.clips[ 0 ].shotId;
	assert.deepEqual( appliedStudent.shots[ selectedShot ].snapshot.nodes[ 'suv-root' ].transform, saved.studentPreset.snapshot.nodes[ 'model-1-root' ].transform );
	assert.deepEqual( appliedStudent.shots[ selectedShot ].snapshot.nodes[ 'mannequin-root' ].transform, saved.studentPreset.snapshot.nodes[ 'model-2-root' ].transform );
	assert.deepEqual( appliedStudent.shots[ selectedShot ].baseScene, beforePreset.shots[ selectedShot ].baseScene );
	assert.deepEqual( appliedStudent.shots[ selectedShot ].snapshot.lights, beforePreset.shots[ selectedShot ].snapshot.lights );
	assert.deepEqual( appliedStudent.shots[ selectedShot ].snapshot.ledWalls, beforePreset.shots[ selectedShot ].snapshot.ledWalls );
	report.checks.push( 'Admin light state saves and restores; applying student preset placement preserves current lighting and video' );
	assert.equal( await student.evaluate( () => window.beforeAdminPresetCanvas === document.querySelector( '#sim-viewport-host canvas' ) ), true );
	report.checks.push( 'Native admin car/human edits apply in an already-open legacy student scene through verified GLB mapping without replacing its scene or viewport' );
	await admin.bringToFront();
	await admin.locator( '#admin-preset-name' ).fill( 'Renamed front camera' );
	await admin.locator( 'button::-p-text(Rename preset)' ).click(); await waitPreset();
	state = await admin.evaluate( async path => ( await import( path ) ).getAdminPresetService().getState(), serviceURL );
	assert.equal( state.error, '', state.error );
	await admin.locator( '#admin-preset-name' ).fill( 'Independent scene copy' );
	await admin.locator( 'button::-p-text(Save new preset)' ).click(); await waitPreset();
	state = await admin.evaluate( async path => ( await import( path ) ).getAdminPresetService().getState(), serviceURL );
	assert.equal( state.error, '', state.error ); assert.equal( state.presets.length, 7 ); assert.notEqual( state.selectedPresetId, 'studio-camera-front' );
	report.checks.push( 'Rename creates a new revision; Save as new creates a separate named preset without overwriting its source' );
	await admin.screenshot( { path: `${directory}/admin-presets.png`, fullPage: true } );
	await student.bringToFront();
	await student.waitForFunction( () => document.querySelectorAll( '.sim-preset' ).length === 7 );
	await student.screenshot( { path: `${directory}/student-presets.png`, fullPage: true } );
	const beforeRemoval = await readStudent();
	await admin.bringToFront();
	await admin.locator( 'button::-p-text(Delete preset)' ).click();
	await admin.locator( 'button::-p-text(Confirm deletion)' ).click(); await waitPreset();
	await admin.waitForFunction( () => document.querySelectorAll( '[aria-label="Student presets"] [aria-label^="Apply "]' ).length === 6 );
	const selectedBeforeCardDelete = ( await admin.evaluate( async path => ( await import( path ) ).getAdminPresetService().getState(), serviceURL ) ).selectedPresetId;
	await admin.locator( '[aria-label="Delete preset Renamed front camera"]' ).click();
	await admin.locator( '[role="alertdialog"] button::-p-text(Cancel)' ).click();
	assert.equal( ( await admin.evaluate( async path => ( await import( path ) ).getAdminPresetService().getState(), serviceURL ) ).presets.length, 6 );
	await admin.locator( '[aria-label="Delete preset Renamed front camera"]' ).click();
	await admin.locator( 'button::-p-text(Confirm deletion)' ).click(); await waitPreset();
	assert.equal( ( await admin.evaluate( async path => ( await import( path ) ).getAdminPresetService().getState(), serviceURL ) ).selectedPresetId, selectedBeforeCardDelete );
	await student.bringToFront();
	await student.waitForFunction( () => document.querySelectorAll( '.sim-preset' ).length === 5 );
	assert.deepEqual( await readStudent(), beforeRemoval );
	await admin.bringToFront(); await admin.reload();
	await admin.waitForFunction( () => document.querySelectorAll( '[aria-label="Student presets"] [aria-label^="Apply "]' ).length === 5 );
	await waitPreset();
	await student.bringToFront(); await student.reload();
	await student.waitForFunction( () => document.querySelectorAll( '.sim-preset' ).length === 5 && ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled );
	assert.deepEqual( await readStudent(), beforeRemoval );
	report.checks.push( 'Removing new and seeded presets updates both galleries, survives admin/student reload, and preserves existing student shots' );
	assert.deepEqual( report.errors, [] ); report.passed = true; console.log( JSON.stringify( report, null, 2 ) );

} catch ( error ) {

	report.failure = error.stack;
	if ( admin ) {

		report.adminState = await admin.evaluate( async path => ( await import( path ) ).getAdminPresetService().getState(), serviceURL ).catch( () => null );
		await admin.screenshot( { path: `${directory}/failure.png` } ).catch( () => {} );

	}
	console.log( JSON.stringify( report, null, 2 ) ); throw error;

} finally {

	await writeFile( `${directory}/report.json`, JSON.stringify( report, null, 2 ) ); await browser.close();

}
