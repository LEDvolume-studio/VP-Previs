// Actual bundled studio/SUV/mannequin/LED, WebGPU and streamed H.264/AAC proof.
// --soak renders all 22,500 frames through this same real scene.
import assert from 'node:assert/strict';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const projectRoot = fileURLToPath( new URL( '../../../', import.meta.url ) );
const artifacts = resolve( process.env.PREVIS_ARTIFACT_DIR || `${tmpdir()}/student-previs-real-scene-${Date.now()}` );
await mkdir( artifacts, { recursive: true } );
const previousCwd = process.cwd();
process.chdir( resolve( projectRoot, 'app' ) );
const server = process.env.PREVIS_BASE_URL ? null : await createServer( {
	configFile: resolve( projectRoot, 'app/vite.config.js' ), cacheDir: resolve( artifacts, '.vite' ),
	server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
} );
if ( server ) await server.listen();
const origin = process.env.PREVIS_BASE_URL || server.resolvedUrls.local[ 0 ];
const soak = process.argv.includes( '--soak' );
const frameCount = soak ? 22500 : 250;
const report = { startedAt: new Date().toISOString(), artifactDirectory: artifacts, frameCount, runs: [], pageErrors: [], requestFailures: [] };
let browser;
let outputHandle;
let page;
try {

	browser = await puppeteer.launch( {
		executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		headless: process.env.PREVIS_HEADFUL !== '1',
		protocolTimeout: 1800000,
		args: [ '--enable-unsafe-webgpu', '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ],
	} );
	report.browser = await browser.version();
	page = await browser.newPage();
	await page.setViewport( { width: 1440, height: 1100 } );
	page.setDefaultTimeout( 90000 );
	page.on( 'pageerror', error => report.pageErrors.push( error.message ) );
	page.on( 'requestfailed', request => report.requestFailures.push( { path: new URL( request.url() ).pathname, error: request.failure()?.errorText } ) );
	await page.exposeFunction( 'writeExportChunk', async bytes => outputHandle.writeFile( Buffer.from( bytes ) ) );
	await page.goto( new URL( `/student/scene/${soak ? '?soak' : ''}`, origin ).href, { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( () => window.previsRealScene || window.previsRealSceneError );
	assert.equal( await page.evaluate( () => window.previsRealSceneError ), undefined );
	report.gpu = await page.evaluate( async () => {

		const adapter = await navigator.gpu.requestAdapter();
		return { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description, isFallbackAdapter: adapter.info.isFallbackAdapter, isolated: crossOriginIsolated };

	} );
	assert.equal( report.gpu.isFallbackAdapter, false, 'Actual scene proof requires hardware WebGPU' );
	assert.equal( report.gpu.isolated, true );
	report.initial = await page.evaluate( async () => ( { state: window.previsRealScene.state(), shot: await window.previsRealScene.captureShot() } ) );
	assert.equal( report.initial.state.backend, 'WebGPUBackend' );
	assert.ok( report.initial.state.meshCount >= 90 );
	report.mediaChecks = await page.evaluate( async () => {

		const fixture = window.previsRealScene;
		const raw = Object.assign( document.createElement( 'canvas' ), { width: 1920, height: 1080 } );
		const rawContext = raw.getContext( '2d', { willReadFrequently: true } );
		const composite = fixture.adapter.canvas.getContext( '2d', { willReadFrequently: true } );
		const checks = [];
		await fixture.adapter.prepare();
		try {

			for ( const frame of [ 0, 124, 125, 126, 249, 0 ] ) {

				const evaluation = await fixture.adapter.renderFrame( frame );
				rawContext.drawImage( fixture.renderer.domElement, 0, 0 );
				const ratio = evaluation.shot.snapshot.camera.frameOverlayRatio;
				const positions = ratio === '4:3' ? [ [ 100, 500, true ], [ 1820, 500, true ], [ 960, 800, false ] ] : [ [ 400, 50, true ], [ 400, 1030, true ], [ 960, 800, false ] ];
				const samples = positions.map( ( [ x, y, bar ] ) => ( { x, y, bar, before: Array.from( rawContext.getImageData( x, y, 1, 1 ).data ), after: Array.from( composite.getImageData( x, y, 1, 1 ).data ) } ) );
				const pixels = rawContext.getImageData( 0, 0, 1920, 1080 ).data;
				let greenPixels = 0, yellowPixels = 0, luminanceSum = 0, squareSum = 0, count = 0;
				for ( let index = 0; index < pixels.length; index += 16 ) {

					const [ r, g, b ] = pixels.subarray( index, index + 3 );
					if ( g > 40 && g > r * 1.25 && g > b * 1.25 ) greenPixels ++;
					if ( r > 40 && g > 40 && b < Math.min( r, g ) * 0.7 ) yellowPixels ++;
					luminanceSum += r; squareSum += r * r; count ++;

				}
				checks.push( { frame, ratio, state: fixture.state(), shot: await fixture.captureShot(), media: await fixture.mediaDiagnostics(), samples, greenPixels, yellowPixels, variance: squareSum / count - ( luminanceSum / count ) ** 2 } );

			}

		} finally {

			await fixture.adapter.restore();

		}
		window.realSceneFramingEvidence = checks.map( ( { frame, ratio, samples } ) => ( { frame, ratio, samples } ) );
		return checks;

	} );
	await writeFile( resolve( artifacts, 'frame-checks.json' ), JSON.stringify( report.mediaChecks, null, 2 ) );
	for ( const check of report.mediaChecks ) {

		assert.ok( check.variance > 5, 'GPU capture is blank/uniform' );
		assert.equal( check.state.pose, check.frame < 125 ? 'standing' : 'sitting' );
		assert.equal( check.media[ 0 ].material.attached, true );
		assert.equal( check.media[ 0 ].texture.channel, 1 );
		assert.equal( check.media[ 0 ].texture.flipY, false );
		assert.equal( check.media[ 0 ].material.emissiveIntensity, 2 );
		const expectedTime = check.frame < 125 ? 1 : ( 0.48 + ( check.frame - 125 ) / 25 ) % 3;
		assert.ok( Math.abs( check.media[ 0 ].sourceTimeSeconds - expectedTime ) < 0.000001 );
		assert.ok( check.media[ 0 ].source.centerRGBA.slice( 0, 3 ).some( channel => channel > 20 ) );
		assert.ok( check.media[ 0 ].display.centerRGBA.slice( 0, 3 ).some( channel => channel > 20 ) );
		for ( const sample of check.samples ) for ( let channel = 0; channel < 3; channel ++ ) assert.ok( Math.abs( sample.after[ channel ] - sample.before[ channel ] * ( sample.bar ? 0.5 : 1 ) ) <= 1, `Framing mismatch ${JSON.stringify( sample )}` );

	}
	assert.ok( report.mediaChecks[ 0 ].greenPixels > 1000, 'Frozen green LED frame is not visible through the GPU scene' );
	assert.ok( report.mediaChecks[ 2 ].yellowPixels > 1000, 'Advancing yellow LED frame is not visible through the GPU scene' );
	assert.deepEqual( report.mediaChecks[ 0 ].shot.snapshot, report.mediaChecks.at( - 1 ).shot.snapshot );
	assert.notDeepEqual( report.mediaChecks[ 0 ].state.doors, report.mediaChecks[ 2 ].state.doors );
	assert.notDeepEqual( report.mediaChecks[ 0 ].state.camera, report.mediaChecks[ 2 ].state.camera );
	assert.notDeepEqual( report.mediaChecks[ 0 ].state.poseGeometry, report.mediaChecks[ 2 ].state.poseGeometry );
	assert.deepEqual( report.mediaChecks[ 0 ].state.poseGeometry, report.mediaChecks.at( - 1 ).state.poseGeometry );
	assert.deepEqual( await page.evaluate( async () => ( await window.previsRealScene.captureShot() ).snapshot ), report.initial.shot.snapshot );
	for ( const [ frame, name ] of [ [ 0, 'standing-closed-frozen.png' ], [ 125, 'sitting-open-playing.png' ] ] ) {

		await page.evaluate( async frame => {

			await window.previsRealScene.adapter.prepare(); await window.previsRealScene.adapter.renderFrame( frame );

		}, frame );
		await page.$eval( '.raster-capture', element => element.scrollIntoView() );
		await ( await page.$( '.raster-capture' ) ).screenshot( { path: resolve( artifacts, name ) } );
		await page.evaluate( () => window.previsRealScene.adapter.restore() );

	}
	report.superseded = await page.evaluate( async () => {

		const fixture = window.previsRealScene;
		await fixture.adapter.prepare();
		try {

			const results = await Promise.allSettled( [ fixture.adapter.renderFrame( 0 ), fixture.adapter.renderFrame( 125 ), fixture.adapter.renderFrame( 0 ) ] );
			return { statuses: results.map( result => result.status ), names: results.map( result => result.reason?.name ), state: fixture.state(), shot: await fixture.captureShot() };

		} finally {

			await fixture.adapter.restore();

		}

	} );
	assert.deepEqual( report.superseded.statuses, [ 'rejected', 'rejected', 'fulfilled' ] );
	assert.deepEqual( report.superseded.names.slice( 0, 2 ), [ 'AbortError', 'AbortError' ] );
	assert.deepEqual( report.superseded.shot.snapshot, report.initial.shot.snapshot );
	report.uiRaces = await page.evaluate( async () => {

		const fixture = window.previsRealScene;
		const originalPrepare = fixture.adapter.prepare;
		const originalRender = fixture.adapter.renderFrame;
		const originalMedia = fixture.adapter._renderMedia;
		const results = [];
		let calls = 0;
		fixture.adapter.prepare = function ( ...args ) { calls ++; return originalPrepare.apply( this, args ); };
		try {

			await Promise.all( [ fixture.draw( 24 ), fixture.draw( 124 ), fixture.draw( 126 ) ] );
			results.push( { kind: 'rapid-draw', calls, frame: fixture.state().frame, pose: fixture.state().pose } );
			await fixture.stop();
			for ( const method of [ 'prepare', '_renderMedia' ] ) {

				let release, entered;
				const gate = new Promise( resolve => { release = resolve; } );
				const started = new Promise( resolve => { entered = resolve; } );
				const original = method === 'prepare' ? originalPrepare : originalMedia;
				fixture.adapter[ method ] = async function ( ...args ) { entered(); await gate; return original.apply( this, args ); };
				const drawing = fixture.draw( 125 );
				await started;
				const stopping = fixture.stop();
				release();
				await Promise.all( [ drawing, stopping ] );
				fixture.adapter[ method ] = original;
				results.push( { kind: `stop-during-${method}`, shot: await fixture.captureShot(), state: fixture.state(), position: document.querySelector( '#position' ).textContent } );

			}

		} finally {

			fixture.adapter.prepare = originalPrepare; fixture.adapter.renderFrame = originalRender; fixture.adapter._renderMedia = originalMedia; await fixture.stop();

		}
		return results;

	} );
	assert.equal( report.uiRaces[ 0 ].calls, 1 );
	assert.equal( report.uiRaces[ 0 ].frame, 126 );
	for ( const race of report.uiRaces.slice( 1 ) ) { assert.deepEqual( race.shot.snapshot, report.initial.shot.snapshot ); assert.match( race.position, /Frame 0 \/ / ); }
	await page.evaluate( () => {

		window.encoderPeaks = { video: 0, audio: 0 };
		window.workerPeaks = { pending: 0, audioBlockBytes: 0 };
		const NativeWorker = window.Worker;
		window.Worker = class extends NativeWorker {

			constructor( ...args ) { super( ...args ); this.pendingAudio = new Set(); this.addEventListener( 'message', event => this.pendingAudio.delete( event.data.id ) ); }
			postMessage( message, ...args ) {

				if ( message?.command?.type === 'encode' ) {

					this.pendingAudio.add( message.id ); window.workerPeaks.pending = Math.max( window.workerPeaks.pending, this.pendingAudio.size );
					window.workerPeaks.audioBlockBytes = Math.max( window.workerPeaks.audioBlockBytes, message.command.data.audioData.byteLength );

				}
				return super.postMessage( message, ...args );

			}

		};
		for ( const [ kind, name ] of [ [ 'video', 'VideoEncoder' ], [ 'audio', 'AudioEncoder' ] ] ) {

			const Native = window[ name ];
			window[ name ] = class extends Native {

				encode( ...args ) { super.encode( ...args ); window.encoderPeaks[ kind ] = Math.max( window.encoderPeaks[ kind ], this.encodeQueueSize ); }

			};

		}

	} );
	const session = await page.createCDPSession();
	const retainedHeap = async () => {

		await page.evaluate( async () => { await window.previsRealScene.renderer.backend.device.queue.onSubmittedWorkDone(); } );
		await session.send( 'Runtime.discardConsoleEntries' );
		await session.send( 'HeapProfiler.collectGarbage' );
		report.rendererMemory ||= [];
		report.rendererMemory.push( await page.evaluate( () => ( { ...window.previsRealScene.renderer.info.memory } ) ) );
		return ( await page.metrics() ).JSHeapUsedSize;

	};
	report.coldHeapBeforeWarmup = await retainedHeap();
	report.warmup = await page.evaluate( async soak => {

		window.runShortRealExport = async ( frameCount = 5, { onFile } = {} ) => {

			const { exportRasterMP4, createExportFile } = await import( '/src/previs/export/RasterMP4Exporter.js' );
			const { inspectDiagnostic } = await import( '/src/student/diagnostic/inspectDiagnostic.js' );
			const destination = await createExportFile();
			try {

				const result = await exportRasterMP4( { adapter: window.previsRealScene.adapter, frameCount, writable: destination.writable } );
				const file = await destination.getFile();
				return { ...result, bytes: file.size, state: window.previsRealScene.state(), inspection: onFile ? await onFile( file ) : await inspectDiagnostic( file, frameCount ) };

			} finally { await destination.remove(); }

		};
		return window.runShortRealExport( soak ? 5 : 250 );

	}, soak );
	if ( soak ) {

		outputHandle = await open( resolve( artifacts, 'real-scene-10sec.mp4' ), 'w' );
		try {

			report.shortExport = await page.evaluate( () => window.runShortRealExport( 250, { onFile: async file => {

				const { inspectDiagnostic } = await import( '/src/student/diagnostic/inspectDiagnostic.js' );
				const inspection = await inspectDiagnostic( file, 250, { framingEvidence: window.realSceneFramingEvidence } );
				const reader = file.stream().getReader();
				try {

					for ( ;; ) {

						const { value, done } = await reader.read(); if ( done ) break;
						for ( let offset = 0; offset < value.length; offset += 65536 ) await window.writeExportChunk( Array.from( value.subarray( offset, offset + 65536 ) ) );

					}

				} finally { reader.releaseLock(); }
				return inspection;

			} } ) );
			assert.equal( report.shortExport.inspection.frameCount, 250 );

		} finally { await outputHandle.close(); outputHandle = null; }

	}
	report.retainedHeapBeforeExport = await retainedHeap();
	outputHandle = await open( resolve( artifacts, soak ? 'real-scene-15min.mp4' : 'real-scene-10sec.mp4' ), 'w' );
	try {

		report.export = await page.evaluate( async frameCount => {

			const { inspectDiagnostic } = await import( '/src/student/diagnostic/inspectDiagnostic.js' );
			const memory = [];
			const result = await window.previsRealScene.runExport( {
				onProgress: ( { frame } ) => {

					if ( frame === 1 ) { window.previsRealScene.stop(); window.stopDuringExportGuarded = document.querySelector( '#stop' ).disabled; }
					if ( ( frame - 1 ) % 1000 === 0 || frame === frameCount ) memory.push( { frame, heapBytes: performance.memory?.usedJSHeapSize } );

				},
				onFile: async file => {

					const inspection = await inspectDiagnostic( file, frameCount, { framingEvidence: window.realSceneFramingEvidence } );
					const reader = file.stream().getReader();
					try {

						for ( ;; ) {

							const { value, done } = await reader.read(); if ( done ) break;
							for ( let offset = 0; offset < value.length; offset += 65536 ) await window.writeExportChunk( Array.from( value.subarray( offset, offset + 65536 ) ) );

						}

					} finally { reader.releaseLock(); }
					return inspection;

				},
			} );
			return { ...result, encoderPeaks: window.encoderPeaks, workerPeaks: window.workerPeaks, memory };

		}, frameCount );

	} finally {

		await outputHandle.close(); outputHandle = null;

	}
	assert.equal( report.export.inspection.frameCount, frameCount );
	assert.ok( report.export.inspection.framingPixels.length >= 12 );
	assert.equal( report.export.inspection.clicks.length, Math.ceil( frameCount / 25 ) );
	assert.equal( report.export.state.pose, 'standing' );
	assert.ok( report.export.encoderPeaks.video <= 4 );
	assert.ok( report.export.encoderPeaks.audio <= 4 );
	assert.ok( report.export.workerPeaks.pending <= 1 );
	assert.ok( report.export.workerPeaks.audioBlockBytes <= 4096 );
	assert.equal( await page.evaluate( () => window.stopDuringExportGuarded ), true );
	report.retainedHeapAfterExport = await retainedHeap();
	report.retainedHeapGrowthBytes = report.retainedHeapAfterExport - report.retainedHeapBeforeExport;
	assert.ok( report.retainedHeapGrowthBytes < 16 * 1024 * 1024, 'Retained JS heap grew by over 16 MiB after a complete scene/codec warmup' );
	await page.setViewport( { width: 700, height: 500, deviceScaleFactor: 2 } );
	for ( const options of [ { cancelAtFrame: 26 }, { failAtFrame: 3 } ] ) {

	const failure = await page.evaluate( async options => {

			const render = window.previsRealScene.adapter.renderFrame;
			try { await window.previsRealScene.runExport( options ); return { failed: false }; } catch ( error ) { return { failed: true, name: error.name, message: error.message, identityUnchanged: render === window.previsRealScene.adapter.renderFrame, state: window.previsRealScene.state(), shot: await window.previsRealScene.captureShot() }; }

		}, options );
		assert.equal( failure.failed, true );
		assert.equal( failure.identityUnchanged, true );
		assert.deepEqual( failure.shot.snapshot, report.initial.shot.snapshot );
		report.runs.push( { options, failure } );

	}
	report.cleanupFailure = await page.evaluate( async () => {

		const original = FileSystemDirectoryHandle.prototype.removeEntry;
		let injected = false;
		FileSystemDirectoryHandle.prototype.removeEntry = function ( name, ...args ) {

			if ( ! injected && name.startsWith( 'previs-export-' ) ) { injected = true; return Promise.reject( new Error( 'Injected temporary cleanup failure' ) ); }
			return original.call( this, name, ...args );

		};
		try {

			try { await window.previsRealScene.runExport( { failAtFrame: 3 } ); } catch ( error ) {

				return { name: error.name, errors: error.errors?.map( entry => entry.message ), controlsEnabled: [ 'play', 'stop', 'seek', 'export' ].every( id => ! document.getElementById( id ).disabled ), cancelDisabled: document.getElementById( 'cancel' ).disabled };

			}

		} finally {

			FileSystemDirectoryHandle.prototype.removeEntry = original;
			const directory = await navigator.storage.getDirectory();
			for await ( const name of directory.keys() ) if ( name.startsWith( 'previs-export-' ) ) await directory.removeEntry( name );

		}

	} );
	assert.equal( report.cleanupFailure.name, 'AggregateError' );
	assert.equal( report.cleanupFailure.controlsEnabled, true );
	assert.equal( report.cleanupFailure.cancelDisabled, true );
	assert.deepEqual( report.cleanupFailure.errors, [ 'Injected real scene failure', 'Injected temporary cleanup failure' ] );
	report.retry = await page.evaluate( soak => soak ? window.runShortRealExport() : window.previsRealScene.runExport(), soak );
	assert.equal( report.retry.frameCount, soak ? 5 : frameCount );
	report.retainedHeapAfterRetry = await retainedHeap();
	assert.ok( report.retainedHeapAfterRetry - report.retainedHeapAfterExport < 16 * 1024 * 1024, 'Retained JS heap grew by over 16 MiB across retry' );
	assert.deepEqual( await page.evaluate( async () => ( await window.previsRealScene.captureShot() ).snapshot ), report.initial.shot.snapshot );
	report.leftovers = await page.evaluate( async () => {

		const directory = await navigator.storage.getDirectory(); const names = [];
		for await ( const name of directory.keys() ) if ( name.startsWith( 'previs-export-' ) ) names.push( name ); return names;

	} );
	assert.deepEqual( report.leftovers, [] );
	assert.deepEqual( report.pageErrors, [] );
	assert.deepEqual( report.requestFailures, [] );
	report.passed = true;
	console.log( JSON.stringify( { frames: frameCount, elapsedMs: report.export.elapsedMs, bytes: report.export.bytes, encoderPeaks: report.export.encoderPeaks, artifactDirectory: artifacts } ) );

} catch ( error ) {

	report.error = { name: error.name, message: error.message, stack: error.stack };
	if ( page ) { report.body = await page.$eval( 'body', element => element.innerText.slice( -3500 ) ).catch( () => null ); await page.screenshot( { path: resolve( artifacts, 'failure.png' ), fullPage: true } ).catch( () => {} ); }
	throw error;

} finally {

	report.finishedAt = new Date().toISOString();
	await writeFile( resolve( artifacts, 'report.json' ), JSON.stringify( report, null, 2 ) );
	await outputHandle?.close();
	await browser?.close();
	await server?.close();
	process.chdir( previousCwd );

}
