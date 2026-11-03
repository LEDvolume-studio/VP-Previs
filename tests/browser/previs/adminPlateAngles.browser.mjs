import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const origin = process.env.PLATE_TEST_ORIGIN || 'http://127.0.0.1:5176';
const artifacts = resolve( '.local-runtime/admin-plate-angle-validation' ); await mkdir( artifacts, { recursive: true } );
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 240000, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ] } );
const report = { checks: [], errors: [] };
try {

	const intake = await browser.newPage(); intake.setDefaultTimeout( 180000 );
	await intake.goto( `${origin}/admin/driving-plates/` );
	await intake.waitForSelector( '.plate-card' );
	await intake.evaluate( async () => {

		const { LocalPlateLibrary } = await import( '/src/services/plates/LocalPlateLibrary.js' );
		const { PlateCatalogueClient } = await import( '/src/services/plates/PlateCatalogueClient.js' );
		const { PlateDownloader } = await import( '/src/services/plates/PlateDownloader.js' );
		const library = new LocalPlateLibrary(), client = new PlateCatalogueClient(), [ manifest ] = await client.list();
		const downloader = new PlateDownloader( { library, client } );
		const saved = await downloader.start( manifest ); downloader.dispose();
		if ( ! saved ) throw new Error( 'The real plate set did not download.' );

	} );
	console.log( 'Real plate set downloaded.' );
	const student = await browser.newPage(); student.setDefaultTimeout( 180000 );
	await student.goto( `${origin}/student/?ui=editor` );
	await student.waitForFunction( () => document.querySelectorAll( '.sim-preset' ).length === 6 && ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled );
	const fixtureProjectId = await student.evaluate( async () => {

		const { getLocalPresetRepository } = await import( '/src/services/presets/LocalPresetRepository.js' );
		const { projectRepository } = await import( '/src/services/projects/ProjectRepository.js' );
		const record = await getLocalPresetRepository().get( 'studio-camera-front' );
		await projectRepository.save( record.adminDocument ); await projectRepository.setActiveProjectId( record.adminDocument.projectId ); return record.adminDocument.projectId;

	} );
	await student.close();
	const page = await browser.newPage(); page.setDefaultTimeout( 180000 ); await page.setViewport( { width: 1586, height: 1050 } );
	page.on( 'pageerror', error => report.errors.push( error.message ) );
	await page.goto( `${origin}/` ); await page.bringToFront();
	await page.waitForFunction( async expectedProjectId => {

		const { getApp } = await import( '/src/lib/appProxy.js' );
		const { useProjectStore } = await import( '/src/services/projects/projectStore.js' );
		const { projectSession } = await import( '/src/services/projects/ProjectSession.js' );
		const { useStore } = await import( '/src/store.js' );
		return Boolean( getApp() ) && ! projectSession.hydrating && projectSession.current?.projectId === expectedProjectId && ! useStore.getState().loading.isLoading && useProjectStore.getState().status === 'saved';

	}, { polling: 500 }, fixtureProjectId );
	console.log( 'Admin scene ready.' );
	await page.click( '[role="tab"][id$="trigger-presets"]' );
	await page.waitForSelector( '[aria-label="Plate angle front"]' );
	await page.waitForFunction( () => ! document.querySelector( '[aria-label="Driving plate set"]' ).disabled && [ ...document.querySelectorAll( '[aria-label="Driving plate set"] option' ) ].some( option => option.textContent === 'Advanced' ) );
	const setId = await page.$eval( '[aria-label="Driving plate set"]', node => [ ...node.options ].find( option => option.textContent === 'Advanced' ).value );
	await page.select( '[aria-label="Driving plate set"]', setId );
	await page.waitForFunction( async () => {

		const service = ( await import( '/src/services/presets/AdminPresetService.js' ) ).getAdminPresetService();
		const { LEDVideoManager } = await import( '/src/services/LEDVideoManager.js' );
		return ! service.plates.getSnapshot().busy && service.plates.getSnapshot().playing && LEDVideoManager.getSnapshot( service.plates.getSnapshot().wallId )?.currentTime > 0.3;

	} );
	console.log( 'Selected real set and started LED playback.' );
	const setup = await page.evaluate( async () => {

		const { getAdminPresetService } = await import( '/src/services/presets/AdminPresetService.js' );
		const { LEDVideoManager } = await import( '/src/services/LEDVideoManager.js' );
		const service = getAdminPresetService(), record = LEDVideoManager.getRecord( service.plates.getSnapshot().wallId );
		window.plateAngleProof = { source: record.video.plateSource, mesh: record.displayMesh, material: record.displayMesh.material, geometry: record.displayMesh.geometry };
		LEDVideoManager.pause( record.root ); LEDVideoManager.seek( record.root, 42.32 );
		return { height: record.video.videoHeight, wall: record.root.uuid };

	} );
	assert.equal( setup.height, 890 );
	await page.waitForFunction( async () => {

		const { LEDVideoManager } = await import( '/src/services/LEDVideoManager.js' );
		return [ ...LEDVideoManager.records.values() ].some( record => record.video?.plateSource && ! record.video.seeking && record.video.currentTime === 42.32 );

	} );
	const hashes = [];
	for ( const view of [ 'front', 'left', 'right', 'rear' ] ) {

		await page.waitForSelector( `[aria-label="Plate angle ${view}"]:not([disabled])` );
		await page.click( `[aria-label="Plate angle ${view}"]` );
		await page.waitForFunction( async view => {

			const service = ( await import( '/src/services/presets/AdminPresetService.js' ) ).getAdminPresetService();
			return ! service.plates.getSnapshot().busy && service.plates.getSnapshot().view === view;

		}, {}, view );
		const result = await page.evaluate( async () => {

			const { getAdminPresetService } = await import( '/src/services/presets/AdminPresetService.js' );
			const { LEDVideoManager } = await import( '/src/services/LEDVideoManager.js' );
			const service = getAdminPresetService(), record = LEDVideoManager.getRecord( service.plates.getSnapshot().wallId );
			await LEDVideoManager.materialSyncPromise;
			const image = record.videoCanvas.getContext( '2d' ).getImageData( 0, 0, record.videoCanvas.width, record.videoCanvas.height ).data;
			const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', image ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			return { hash, time: record.video.currentTime, paused: record.video.paused, sameSource: record.video.plateSource === window.plateAngleProof.source, sameMesh: record.displayMesh === window.plateAngleProof.mesh && record.displayMesh.geometry === window.plateAngleProof.geometry && record.displayMesh.material === window.plateAngleProof.material, file: record.file.name, videoView: record.video.plateView, state: service.plates.getSnapshot() };

		} );
		assert.equal( result.time, 42.32 ); assert.equal( result.paused, true ); assert.ok( result.sameSource && result.sameMesh );
		assert.ok( result.file.startsWith( view ), JSON.stringify( { requested: view, ...result } ) ); hashes.push( result.hash );
		await page.evaluate( async view => {

			const service = ( await import( '/src/services/presets/AdminPresetService.js' ) ).getAdminPresetService();
			const saved = await service.saveCurrent( { name: `Plate ${view}`, asNew: true } );
			window.studentPlatePresets ||= {};
			window.studentPlatePresets[ view ] = { id: saved.presetId, wall: saved.studentPreset.snapshot.ledWalls[ 0 ] };

		}, view );

	}
	assert.equal( new Set( hashes ).size, 4 );
	report.checks.push( 'Presets tab switches all four real camera views on the LED wall at 42.32 s, retaining decoders, mesh, geometry and material.' );
	console.log( report.checks.at( -1 ) );
	await page.screenshot( { path: resolve( artifacts, 'admin-preset-rear-angle.png' ), fullPage: true } );
	await page.evaluate( async () => {

		const { getAdminPresetService } = await import( '/src/services/presets/AdminPresetService.js' );
		const service = getAdminPresetService();
		const saved = await service.saveCurrent( { name: 'Rear driving shot', asNew: true } );
		if ( saved.adminDocument.extensions.projectPresetState.plateView !== 'rear' ) throw new Error( `Saved angle mismatch: ${JSON.stringify({saved:saved.adminDocument.extensions.projectPresetState.plateView,live:service.plates.getSnapshot().view,preference:service.session.current.extensions.drivingPlate})}` );
		await service.plates.setView( 'left' ); await service.selectPreset( saved.presetId );
		if ( service.plates.getSnapshot().view !== 'rear' ) throw new Error( 'Applying the preset did not restore its angle.' );
		window.savedPlatePreset = saved.presetId;

	} );
	report.checks.push( 'Saving and reapplying a real preset restores Rear.' ); console.log( report.checks.at( -1 ) );
	await page.evaluate( async () => {

		const { LocalPlateLibrary } = await import( '/src/services/plates/LocalPlateLibrary.js' );
		const { getAdminPresetService } = await import( '/src/services/presets/AdminPresetService.js' );
		const library = new LocalPlateLibrary(), [ { manifest } ] = await library.list(), root = await library.root();
		const from = await root.getDirectoryHandle( manifest.id ), copy = { ...manifest, id: 'second-fixture-set', name: 'Second fixture set' };
		const to = await root.getDirectoryHandle( copy.id, { create: true } );
		for ( const view of [ 'front', 'left', 'right', 'rear' ] ) {

			const filename = `${view}-${manifest.downloadedEncodings[ 0 ]}.mp4`, file = await ( await from.getFileHandle( filename ) ).getFile();
			const writer = await ( await to.getFileHandle( filename, { create: true } ) ).createWritable(); await writer.write( file ); await writer.close();

		}
		const writer = await ( await to.getFileHandle( 'manifest.json', { create: true } ) ).createWritable(); await writer.write( JSON.stringify( copy ) ); await writer.close();
		const service = getAdminPresetService(); await service.plates.refresh(); await service.plates.selectSet( copy.id );
		await service.plates.setView( 'front' ); await service.selectPreset( window.savedPlatePreset );
		if ( service.plates.getSnapshot().setId !== copy.id || service.plates.getSnapshot().view !== 'rear' ) throw new Error( 'The preset must use the newly selected set and restore only its angle.' );

	} );
	report.checks.push( 'The same preset angle works with another selected set; applying a preset does not revert the set selection.' ); console.log( report.checks.at( -1 ) );
	await page.evaluate( async () => {
        const service = ( await import( '/src/services/presets/AdminPresetService.js' ) ).getAdminPresetService();
        await service.session.flush();
    } );
    await page.reload();
    await page.waitForFunction( async () => {
        const { getApp } = await import( '/src/lib/appProxy.js' );
        const { LEDVideoManager } = await import( '/src/services/LEDVideoManager.js' );
        return !! getApp() && [ ...LEDVideoManager.records.values() ].some( record => record.video?.plateSource?.manifest.id === 'second-fixture-set' && record.video.plateView === 'rear' && ! record.video.seeking && record.video.currentTime === 42.32 );
    }, { polling: 500 } );
    report.checks.push( 'Reopening the project restores its selected set, Rear view and exact frame from local storage.' ); console.log( report.checks.at( -1 ) );
	const studentPresets = await page.evaluate( async () => {

		const repository = ( await import( '/src/services/presets/LocalPresetRepository.js' ) ).getLocalPresetRepository();
		const result = {};
		for ( const view of [ 'front', 'left', 'right', 'rear' ] ) result[ view ] = ( await repository.list() ).find( row => row.name === `Plate ${view}` ).studentPreset.snapshot.ledWalls[ 0 ];
		return result;

	} );
	const studentView = await browser.newPage(); studentView.setDefaultTimeout( 180000 ); await studentView.setViewport( { width: 1586, height: 1050 } );
	let studentRendererURL;
	studentView.on( 'request', request => { if ( new URL( request.url() ).pathname.includes( '/three_webgpu.js' ) ) studentRendererURL = request.url(); } );
	studentView.on( 'pageerror', error => report.errors.push( error.message ) );
	await studentView.goto( `${origin}/student/?ui=editor` ); await studentView.bringToFront();
	await studentView.waitForFunction( () => ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled && document.querySelectorAll( '.sim-preset' ).length > 6 );
	await studentView.evaluate( async rendererURL => {

		const { DecodedLEDSource } = await import( '/src/previs/media/DecodedLEDSource.js' );
		window.studentCutMetrics = { rebuilds: 0, loadingScreens: 0, pipelines: 0, decoderOpensDuringPlayback: 0 };
		const open = DecodedLEDSource.open;
		DecodedLEDSource.open = async function ( ...args ) {

			if ( window.trackingStudentCuts ) window.studentCutMetrics.decoderOpensDuringPlayback ++;
			return open.apply( this, args );

		};
		const { WebGPURenderer } = await import( rendererURL );
		const backend = Object.getPrototypeOf( new WebGPURenderer().backend ), pipeline = backend.createRenderPipeline;
		backend.createRenderPipeline = function ( ...args ) {

			if ( window.trackingStudentCuts ) window.studentCutMetrics.pipelines ++;
			return pipeline.apply( this, args );

		};
		new MutationObserver( () => { if ( document.querySelector( '.sim-loading' ) ) window.studentCutMetrics.loadingScreens ++; } ).observe( document.body, { subtree: true, childList: true } );
		const { EditorSession } = await import( '/src/student/editor/EditorSession.js' );
		const ensure = EditorSession.prototype.ensureScene;
		EditorSession.prototype.ensureScene = async function ( ...args ) {

			window.studentPlateSession = this;
			const before = this.runtime;
			window.studentInitialRuntime ||= before;
			const result = await ensure.apply( this, args );
			if ( before && this.runtime !== before ) window.studentCutMetrics.rebuilds ++;
			if ( this.runtime && ! this.runtime.cutProofInstalled ) {

				const runtime = this.runtime, prepare = runtime.preparePlayback;
				runtime.cutProofInstalled = true;
				runtime.preparePlayback = async ( ...options ) => {

					window.trackingStudentCuts = false;
					const prepared = await prepare.apply( runtime, options );
					window.studentPreparedMedia = runtime.inspect();
					window.trackingStudentCuts = true;
					return prepared;

				};

			}
			return result;

		};
		const draw = DecodedLEDSource.prototype.drawAt;
		window.studentPlateFrames = [];
		DecodedLEDSource.prototype.drawAt = async function ( time, context, options ) {

			const result = await draw.call( this, time, context, options );
			if ( result && this.downloadedPlate ) {

				const pixels = context.getImageData( 0, 0, context.canvas.width, context.canvas.height ).data;
				const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', pixels ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
				window.studentPlateFrames.push( { ...this.downloadedPlate, time, timestamp: result.timestamp, hash } );

			}
			return result;

		};
		const { SequenceRasterAdapter } = await import( '/src/previs/engine/SequenceRasterAdapter.js' );
		const render = SequenceRasterAdapter.prototype.renderFrame;
		window.timelineRenderProof = [];
		SequenceRasterAdapter.prototype.renderFrame = async function ( frame, options ) {

			const started = performance.now();
			const evaluation = await render.call( this, frame, options );
			if ( options?.timelineFrame !== undefined ) window.timelineRenderProof.push( { frame: options.timelineFrame, milliseconds: Math.round( performance.now() - started ), sourceTime: evaluation.led[ 0 ]?.sourceTimeSeconds, decoded: window.studentPlateFrames.at( - 1 ) } );
			return evaluation;

		};

	}, studentRendererURL );
	const studentHashes = [];
	for ( const view of [ 'front', 'left', 'right', 'rear' ] ) {

		const placementBaseline = await studentView.evaluate( async () => {

			const session = window.studentPlateSession;
			return session ? structuredClone( session.state.document.shots[ session.runtime.shotId ].snapshot.ledWalls ) : null;

		} );
		await studentView.locator( `.sim-preset::-p-text(Plate ${view})` ).click();
		await studentView.waitForFunction( () => ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled );
		const placementWalls = await studentView.evaluate( () => {

			const session = window.studentPlateSession;
			return session.state.document.shots[ session.runtime.shotId ].snapshot.ledWalls;

		} );
		if ( placementBaseline ) assert.deepEqual( placementWalls, placementBaseline, 'Placement thumbnails preserve the current video.' );
		// Changing plate media is a separate edit, not a side effect of placement.
		await studentView.evaluate( async view => {

			const repository = ( await import( '/src/services/presets/LocalPresetRepository.js' ) ).getLocalPresetRepository();
			const preset = ( await repository.list() ).find( row => row.name === `Plate ${view}` ).studentPreset;
			const session = window.studentPlateSession, shot = structuredClone( session.state.document.shots[ session.runtime.shotId ] );
			const wall = shot.snapshot.ledWalls[ 0 ], identity = { wallId: wall.wallId, nodeInstanceId: wall.nodeInstanceId };
			Object.assign( wall, structuredClone( preset.snapshot.ledWalls[ 0 ] ), identity );
			const { mergePresetMediaAssets } = await import( '/src/student/editor/ApplyProjectPreset.js' );
			await session.edit( { type: 'replaceShot', shot, assets: mergePresetMediaAssets( session.state.document.assets, shot.snapshot, preset.assets ) } );
			if ( session.state.error ) throw new Error( session.state.error );

		}, view );
		await studentView.waitForFunction( view => window.studentPlateFrames.some( frame => frame.view === view && frame.time === 0 ) && ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled, {}, view );
		const saved = await studentView.evaluate( () => new Promise( resolve => {

			const request = indexedDB.open( 'RayzeeStudentDB', 1 );
			request.onsuccess = () => {

				const db = request.result, tx = db.transaction( 'projects', 'readonly' ), rows = tx.objectStore( 'projects' ).getAll();
				tx.oncomplete = () => { db.close(); resolve( rows.result[ 0 ].document ); };

			};

		} ) );
		const wall = saved.shots[ saved.clips[ 0 ].shotId ].snapshot.ledWalls[ 0 ];
		assert.deepEqual( wall.media, studentPresets[ view ].media );
		assert.equal( wall.inPointUs, 42320000 ); assert.equal( wall.mode, 'freeze' );
		studentHashes.push( await studentView.evaluate( view => window.studentPlateFrames.find( frame => frame.view === view ).hash, view ) );
		console.log( `Student applied ${view} from downloaded footage at timeline frame 0.` );

	}
	assert.equal( new Set( studentHashes ).size, 4 );
	await studentView.locator( '[aria-label="Delete shot placement 2"]' ).click();
	await studentView.waitForFunction( () => document.querySelectorAll( '[aria-label^="Delete shot placement"]' ).length === 1 && ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled );
	await studentView.locator( '[aria-label="Use scene preset Plate front"]' ).click();
	await studentView.waitForFunction( () => document.querySelector( '[aria-label="Timeline playhead"]' )?.getAttribute( 'aria-valuenow' ) === '125' && ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled );
	await studentView.waitForFunction( () => window.timelineRenderProof.some( item => item.frame === 125 && item.sourceTime === 5 && item.decoded?.view === 'front' && item.decoded.timestamp === 5 ) );
	for ( const [ view, frame ] of [ [ 'left', 221 ], [ 'right', 317 ] ] ) {

		await studentView.locator( `[aria-label="Use scene preset Plate ${view}"]` ).click();
		await studentView.waitForFunction( frame => document.querySelector( '[aria-label="Timeline playhead"]' )?.getAttribute( 'aria-valuenow' ) === String( frame ) && ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled, {}, frame );

	}
	const seekFrame = async frame => {

		const target = await studentView.$eval( '[aria-label="Timeline playhead"]', ( element, frame ) => {

			const box = element.getBoundingClientRect(), zoom = Number( document.querySelector( '[aria-label="Timeline zoom"]' ).value );
			return { x: box.x + frame * 56 * zoom / 100 / 25, y: box.y + 10 };

		}, frame );
		await studentView.mouse.click( target.x, target.y );
		await studentView.waitForFunction( frame => document.querySelector( '[aria-label="Timeline playhead"]' )?.getAttribute( 'aria-valuenow' ) === String( frame ) && ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled, {}, frame );

	};
	await seekFrame( 120 );
	await studentView.evaluate( () => { window.timelineRenderProof = []; } );
	await studentView.locator( '[aria-label="Play sequence"]' ).click();
	await studentView.waitForFunction( () => Number( document.querySelector( '[aria-label="Timeline playhead"]' )?.getAttribute( 'aria-valuenow' ) ) >= 330 );
	await studentView.locator( '[aria-label="Pause sequence"]' ).click();
	await studentView.waitForSelector( '[aria-label="Play sequence"]:not([disabled])' );
	const playback = await studentView.evaluate( () => window.timelineRenderProof.filter( item => item.frame >= 120 ) );
	report.timelinePlayback = playback;
	assert.ok( playback.some( item => item.frame > 120 && item.frame < 125 && item.decoded?.view === 'rear' ), JSON.stringify( playback ) );
	assert.ok( playback.some( item => item.frame > 125 && item.decoded?.view === 'front' ), JSON.stringify( playback ) );
	assert.ok( playback.some( item => item.frame >= 221 && item.decoded?.view === 'left' ), JSON.stringify( playback ) );
	assert.ok( playback.some( item => item.frame >= 317 && item.decoded?.view === 'right' ), JSON.stringify( playback ) );
	for ( const item of playback ) {

		assert.equal( item.sourceTime, item.frame / 25 );
		assert.equal( item.decoded.timestamp, item.frame / 25 );

	}
	const cutMetrics = await studentView.evaluate( () => ( { ...window.studentCutMetrics, prepared: window.studentPreparedMedia } ) );
	assert.equal( cutMetrics.rebuilds, 0 ); assert.equal( cutMetrics.loadingScreens, 0 );
	assert.equal( cutMetrics.pipelines, 0 ); assert.equal( cutMetrics.decoderOpensDuringPlayback, 0 );
	assert.ok( cutMetrics.prepared.decodedCount >= 4 );
	assert.ok( cutMetrics.prepared.encodedMediaBytes > 128 * 1024 * 1024 );
	assert.ok( cutMetrics.prepared.residentMediaBytes < 128 * 1024 * 1024 );
	report.cutMetrics = cutMetrics;
	report.checks.push( 'Four real plate angles exceeding 128 MiB prepare on one viewport; preset selection/playback create no loading screen, rebuild, cut-time decoder or render pipeline.' );
	await seekFrame( 10 );
	await studentView.waitForFunction( () => window.timelineRenderProof.some( item => item.frame === 10 && item.sourceTime === 0.4 && item.decoded?.timestamp === 0.4 && item.decoded.view === 'rear' ) );
	report.checks.push( 'Actual student playback and scrubbing decode timeline frame N as video frame N at 25 fps, continuing from Rear to Front at the cut without resetting or using the admin paused frame.' );
	await studentView.screenshot( { path: resolve( artifacts, 'student-rear-plate.png' ), fullPage: true } );
	await studentView.reload();
	await studentView.waitForFunction( () => ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled && !! document.querySelector( '#sim-viewport-host canvas' ) );
	report.checks.push( 'Placement thumbnails preserve plate media; explicit plate edits display all four downloaded views and persist through reload.' );
	assert.deepEqual( report.errors, [] ); await writeFile( resolve( artifacts, 'report.json' ), JSON.stringify( report, null, 2 ) );
	console.log( JSON.stringify( report, null, 2 ) );

} catch ( error ) {

	console.error( error ); console.error( JSON.stringify( report ) ); throw error;

} finally { await browser.close(); }
