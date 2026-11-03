// Real WebGPU/WebCodecs/OPFS proof. Optional --soak encodes all 22,500 synthetic frames.
import assert from 'node:assert/strict';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const artifacts = resolve( process.env.PREVIS_ARTIFACT_DIR || `${tmpdir()}/student-previs-proof-${Date.now()}` );
await mkdir( artifacts, { recursive: true } );
const server = process.env.PREVIS_BASE_URL ? null : await createServer( {
	configFile: resolve( 'app/vite.previs.config.js' ), server: { port: 0, strictPort: false, hmr: false },
} );
if ( server ) await server.listen();
const origin = process.env.PREVIS_BASE_URL || server.resolvedUrls.local[ 0 ];
let browser;
let outputHandle;
try {

	browser = await puppeteer.launch( {
		executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		headless: process.env.PREVIS_HEADFUL !== '1',
		args: [ '--enable-unsafe-webgpu', '--enable-precise-memory-info' ],
	} );
	const page = await browser.newPage();
	page.setDefaultTimeout( 60000 );
	const pageErrors = [];
	page.on( 'pageerror', error => pageErrors.push( error.message ) );
	await page.exposeFunction( 'writeExportChunk', async bytes => outputHandle.writeFile( Buffer.from( bytes ) ) );
	await page.goto( new URL( process.argv.includes( '--raw' ) ? '/student/diagnostic/?raw' : '/student/diagnostic/', origin ).href );
	await page.waitForFunction( () => window.previsDiagnostic || window.previsDiagnosticError );
	assert.equal( await page.evaluate( () => window.previsDiagnosticError ), undefined );
	await page.evaluate( () => {

		window.encoderPeaks = { video: 0, audio: 0 };
		window.workerPeaks = { pending: 0, audioBlockBytes: 0 };
		const NativeWorker = window.Worker;
		window.Worker = class extends NativeWorker {

			constructor( ...args ) {

				super( ...args );
				this.pendingAudio = new Set();
				this.addEventListener( 'message', event => this.pendingAudio.delete( event.data.id ) );

			}

			postMessage( message, ...args ) {

				if ( message?.command?.type === 'encode' ) {

					this.pendingAudio.add( message.id );
					window.workerPeaks.pending = Math.max( window.workerPeaks.pending, this.pendingAudio.size );
					window.workerPeaks.audioBlockBytes = Math.max( window.workerPeaks.audioBlockBytes, message.command.data.audioData.byteLength );

				}
				return super.postMessage( message, ...args );

			}

		};
		for ( const [ kind, name ] of [ [ 'video', 'VideoEncoder' ], [ 'audio', 'AudioEncoder' ] ] ) {

			const Native = window[ name ];
			window[ name ] = class extends Native {

				encode( ...args ) {

					super.encode( ...args );
					window.encoderPeaks[ kind ] = Math.max( window.encoderPeaks[ kind ], this.encodeQueueSize );

				}

			};

		}

	} );
	const session = await page.createCDPSession();
	const retainedHeap = async () => {

		await session.send( 'HeapProfiler.collectGarbage' );
		const metrics = await page.metrics();
		return metrics.JSHeapUsedSize;

	};
	const report = { browser: await browser.version(), startedAt: new Date().toISOString(), artifactDirectory: artifacts, runs: [] };
	const mediaChecks = await page.evaluate( async () => {

		const adapter = window.previsDiagnostic.adapter;
		const results = [];
		await adapter.prepare();
		try {

			for ( const frame of [ 0, 124, 125, 126, 249, 0 ] ) results.push( { frame, ...await adapter.renderFrame( frame ) } );

		} finally {

			await adapter.restore();

		}
		return results;

	} );
	for ( const result of mediaChecks ) assert.ok( Math.abs( result.decodedTimestamp - result.sourceFrame / 25 ) < 0.000001, JSON.stringify( result ) );
	for ( const result of mediaChecks ) for ( const sample of result.framing.samples ) {

		for ( let channel = 0; channel < 3; channel ++ ) assert.ok( Math.abs( sample.after[ channel ] - sample.before[ channel ] * ( sample.bar ? 0.5 : 1 ) ) <= 1, `Framing opacity mismatch: ${JSON.stringify( result )}` );
		assert.equal( sample.after[ 3 ], 255 );

	}
	assert.equal( mediaChecks[ 0 ].framing.ratio, '4:3' );
	assert.equal( mediaChecks[ 2 ].framing.ratio, '2.40:1' );
	assert.equal( mediaChecks[ 0 ].shotApplications, mediaChecks[ 1 ].shotApplications );
	assert.equal( mediaChecks[ 2 ].shotApplications, mediaChecks[ 3 ].shotApplications );
	assert.equal( mediaChecks[ 0 ].sourceFrame, mediaChecks[ 1 ].sourceFrame );
	assert.equal( mediaChecks[ 3 ].sourceFrame, mediaChecks[ 2 ].sourceFrame + 1 );
	report.mediaChecks = mediaChecks;
	async function run( frameCount, synthetic ) {

		const name = synthetic ? 'synthetic-15min.mp4' : 'raster-10sec.mp4';
		outputHandle = await open( resolve( artifacts, name ), 'w' );
		try {

			const result = await page.evaluate( async ( { frameCount, synthetic } ) => {

				const { inspectDiagnostic } = await import( '/src/student/diagnostic/inspectDiagnostic.js' );
				const memory = [];
				const result = await window.previsDiagnostic.run( frameCount, {
					synthetic,
					onProgress: ( { frame } ) => {

						if ( ( frame - 1 ) % 1000 === 0 || frame === frameCount ) memory.push( { frame, heapBytes: performance.memory?.usedJSHeapSize } );

					},
					onFile: async file => {

						const inspection = await inspectDiagnostic( file, frameCount, { inspectSamples: ! synthetic, framingEvidence: window.previsDiagnostic.adapter.state.framingEvidence } );
						const reader = file.stream().getReader();
						try {

							for ( ;; ) {

								const { value, done } = await reader.read();
								if ( done ) break;
								for ( let offset = 0; offset < value.length; offset += 65536 ) await window.writeExportChunk( Array.from( value.subarray( offset, offset + 65536 ) ) );

							}

						} finally {

							reader.releaseLock();

						}
						return inspection;

					},
				} );
				return { ...result, encoderPeaks: window.encoderPeaks, workerPeaks: window.workerPeaks, memory };

			}, { frameCount, synthetic } );
			assert.equal( result.inspection.frameCount, frameCount );
			if ( ! synthetic ) assert.equal( result.inspection.framingPixels.length, 12 );
			assert.equal( result.state.restored, true );
			assert.ok( result.encoderPeaks.video <= 4, `Unbounded video encoder queue: ${result.encoderPeaks.video}` );
			assert.ok( result.encoderPeaks.audio <= 4, `Unbounded audio encoder queue: ${result.encoderPeaks.audio}` );
			assert.ok( result.workerPeaks.pending <= 1, 'Unbounded AAC worker command queue' );
			assert.ok( result.workerPeaks.audioBlockBytes <= 4096, 'Unbounded AAC PCM block' );
			report.runs.push( result );
			console.log( JSON.stringify( { file: name, frames: frameCount, elapsedMs: result.elapsedMs, bytes: result.bytes, encoderPeaks: result.encoderPeaks } ) );

		} finally {

			await outputHandle.close();
			outputHandle = null;

		}

	}
	await run( 250, false );
	// DPR/CSS changes cannot alter the physical dimensions required by the frame pump.
	await page.setViewport( { width: 700, height: 500, deviceScaleFactor: 2 } );
	for ( const options of [ { cancelAtFrame: 26 }, { failAtFrame: 3 } ] ) {

		const failure = await page.evaluate( async options => {

			try {

				await window.previsDiagnostic.run( 250, options );
				return { failed: false };

			} catch ( error ) {

				return { failed: true, name: error.name, message: error.message, state: window.previsDiagnostic.adapter.state };

			}

		}, options );
		assert.equal( failure.failed, true );
		assert.equal( failure.state.restored, true );
		report.runs.push( { options, failure } );

	}
	const retried = await page.evaluate( () => window.previsDiagnostic.run( 5 ) );
	assert.equal( retried.frameCount, 5 );
	assert.equal( retried.state.restored, true );
	report.runs.push( { retryAfterFailures: retried } );
	if ( process.argv.includes( '--soak' ) ) {

		report.retainedHeapBeforeSoak = await retainedHeap();
		await run( 22500, true );
		report.retainedHeapAfterSoak = await retainedHeap();
		assert.ok( report.retainedHeapAfterSoak - report.retainedHeapBeforeSoak < 16 * 1024 * 1024, 'Retained JS heap grew by over16MiB after resource cleanup' );
		const rerun = await page.evaluate( () => window.previsDiagnostic.run( 5, { synthetic: true } ) );
		assert.equal( rerun.state.restored, true );
		report.runs.push( { retryAfterSoak: rerun } );

	}
	assert.deepEqual( pageErrors, [] );
	const leftovers = await page.evaluate( async () => {

		const directory = await navigator.storage.getDirectory();
		const names = [];
		for await ( const name of directory.keys() ) if ( name.startsWith( 'previs-export-' ) ) names.push( name );
		return names;

	} );
	assert.deepEqual( leftovers, [] );
	await page.screenshot( { path: resolve( artifacts, 'restored-preview.png' ) } );
	await writeFile( resolve( artifacts, 'report.json' ), JSON.stringify( report, null, 2 ) );
	console.log( `PASS real raster/MP4 diagnostic; evidence ${artifacts}/report.json` );

} finally {

	await outputHandle?.close();
	await browser?.close();
	await server?.close();

}
