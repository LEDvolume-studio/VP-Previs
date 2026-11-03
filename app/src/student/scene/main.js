import { createSupportedSceneViewport } from './SupportedSceneViewport.js';
import { createExportFile, exportRasterMP4 } from '../../previs/export/RasterMP4Exporter.js';
import '../diagnostic/style.css';

const status = document.querySelector( '#status' );
const seek = document.querySelector( '#seek' );
let prepared = false;
let playing = false;
let exporting = false;
let frame = 0;
let clock;
let controller;
let previewGeneration = 0;
let transportGeneration = 0;
let preparing;
let stopping;
let previewController;
let preparationController;

async function boot() {

	const frameCount = new URLSearchParams( location.search ).has( 'soak' ) ? 22500 : 250;
	const fixture = await createSupportedSceneViewport( document.querySelector( '#viewport' ), { frameCount, onStatus: message => {

		status.textContent = message;

	} } );
	const { adapter } = fixture;
	seek.max = frameCount - 1;
	const show = () => {

		document.querySelector( '#position' ).textContent = `Frame ${frame} / ${frameCount - 1} · ${frame < 125 ? 'Standing / frozen LED' : 'Sitting / advancing LED'}`; seek.value = frame;

	};

	function haltPlayback() {

		playing = false;
		++ transportGeneration;
		cancelAnimationFrame( clock );

	}

	async function ensurePrepared() {

		if ( prepared ) return;
		if ( ! preparing ) {

			preparationController = new AbortController();
			preparing = ( async () => {

				try {

					await adapter.prepare( { signal: preparationController.signal } );
					prepared = true;

				} catch ( error ) {

					// prepare may fail after capturing or allocating host resources.
					try {

						await adapter.restore();

					} catch ( restoreError ) {

						throw new AggregateError( [ error, restoreError ], 'Preview preparation and restoration failed' );

					}

					throw error;

				} finally {

					preparing = null;
					preparationController = null;

				}

			} )();

		}

		await preparing;

	}

	function stop( { forExport = false } = {} ) {

		if ( exporting && ! forExport ) return Promise.resolve();
		haltPlayback();
		++ previewGeneration;
		previewController?.abort();
		preparationController?.abort();
		if ( stopping ) return stopping;
		stopping = ( async () => {

			// Never ask the adapter to restore while its preparation is pending.
			// ensurePrepared already restores partial preparation on failure.
			let prepareError;
			try {

				await preparing;

			} catch ( error ) {

				if ( error.name !== 'AbortError' ) prepareError = error;

			}

			if ( prepared ) {

				try {

					await adapter.restore();

				} finally {

					prepared = false;

				}

			}

			if ( prepareError ) throw prepareError;
			frame = 0;
			show();
			status.textContent = 'Stopped. Editing scene restored.';

		} )().finally( () => {

			stopping = null;

		} );
		return stopping;

	}

	async function draw( requested ) {

		if ( exporting ) return;
		if ( ! Number.isInteger( requested ) || requested < 0 || requested >= frameCount ) throw new RangeError( 'Preview frame is outside the sequence' );
		const generation = ++ previewGeneration;
		previewController?.abort();
		const pending = new AbortController();
		previewController = pending;
		const current = () => generation === previewGeneration && ! pending.signal.aborted && ! exporting;
		try {

			await stopping;
			if ( ! current() ) return;
			await ensurePrepared();
			if ( ! current() ) return;
			await adapter.renderFrame( requested, { signal: pending.signal } );
			if ( current() ) {

				frame = requested;
				show();

			}

		} catch ( error ) {

			if ( error.name !== 'AbortError' ) throw error;

		}

	}

	const action = handler => async () => {

		try {

			await handler();

		} catch ( error ) {

			status.textContent = `${error.name}: ${error.message}`;

		}

	};

	seek.oninput = action( async () => {

		if ( exporting ) return;
		haltPlayback();
		await draw( Number( seek.value ) );

	} );
	document.querySelector( '#play' ).onclick = action( async () => {

		if ( exporting ) return;
		if ( playing ) return stop();
		playing = true;
		const transport = ++ transportGeneration;
		if ( frame === frameCount - 1 ) frame = 0;
		const startFrame = frame;
		const start = performance.now();
		const tick = async () => {

			if ( ! playing || transport !== transportGeneration || exporting ) return;
			try {

				await draw( Math.min( frameCount - 1, startFrame + Math.floor( ( performance.now() - start ) * 25 / 1000 ) ) );
				if ( ! playing || transport !== transportGeneration || exporting ) return;
				if ( frame === frameCount - 1 ) {

					await stop(); return;

				}

				clock = requestAnimationFrame( tick );

			} catch ( error ) {

				if ( transport === transportGeneration ) {

					haltPlayback();
					status.textContent = error.message;

				}

			}

		};

		status.textContent = 'Playing the shared sequence. Slow frames are skipped for preview; export renders every frame.';
		await tick();

	} );
	document.querySelector( '#stop' ).onclick = action( stop );
	async function runExport( { fileHandle, onFile, onProgress, cancelAtFrame, failAtFrame } = {} ) {

		if ( exporting ) throw new Error( 'An export is already running' );
		exporting = true;
		controller = new AbortController();
		for ( const id of [ 'play', 'stop', 'seek', 'export' ] ) document.getElementById( id ).disabled = true;
		document.querySelector( '#cancel' ).disabled = false;
		let destination;
		let failure;
		let evidence;
		try {

			await stop( { forExport: true } );
			destination = fileHandle ? { writable: await fileHandle.createWritable(), getFile: () => fileHandle.getFile(), remove: async () => {} } : await createExportFile();
			// Keep adapter method identity intact across failures and retries.
			const exportAdapter = {
				canvas: adapter.canvas,
				prepare: options => adapter.prepare( options ),
				restore: () => adapter.restore(),
				renderFrame: ( value, options ) => {

					if ( value === failAtFrame ) throw new Error( 'Injected real scene failure' );
					return adapter.renderFrame( value, options );

				},
			};

			const result = await exportRasterMP4( { adapter: exportAdapter, frameCount, writable: destination.writable, signal: controller.signal, onProgress: progress => {

				status.textContent = `Exporting ${progress.frame} / ${frameCount} · ${( progress.elapsedMs / 1000 ).toFixed( 1 )} s`;
				onProgress?.( progress );
				if ( cancelAtFrame !== undefined && progress.frame >= cancelAtFrame ) controller.abort();

			} } );
			const file = await destination.getFile();
			evidence = { ...result, bytes: file.size, state: fixture.state(), inspection: onFile ? await onFile( file ) : null };
			document.querySelector( '#result' ).textContent = JSON.stringify( evidence, null, 2 );
			status.textContent = 'Fixture export complete. Production narration and teacher publishing remain separate work.';

		} catch ( error ) {

			failure = error;

		} finally {

			try {

				await destination?.remove();

			} catch ( cleanupError ) {

				failure = failure ? new AggregateError( [ failure, cleanupError ], 'Export and temporary file cleanup failed' ) : cleanupError;

			} finally {

				exporting = false;
				controller = null;
				for ( const id of [ 'play', 'stop', 'seek', 'export' ] ) document.getElementById( id ).disabled = false;
				document.querySelector( '#cancel' ).disabled = true;

			}

		}

		if ( failure ) throw failure;
		return evidence;

	}

	document.querySelector( '#export' ).onclick = action( async () => {

		if ( ! window.showSaveFilePicker ) throw new Error( 'This fixture requires a desktop browser with Save File support' );
		const fileHandle = await window.showSaveFilePicker( { suggestedName: 'previs-real-scene.mp4', types: [ { description: 'MP4 video', accept: { 'video/mp4': [ '.mp4' ] } } ] } );
		await runExport( { fileHandle } );

	} );
	document.querySelector( '#cancel' ).onclick = () => controller?.abort();
	window.previsRealScene = { ...fixture, runExport, stop, draw };
	for ( const id of [ 'play', 'stop', 'seek', 'export' ] ) document.getElementById( id ).disabled = false;
	status.textContent = 'Ready. Actual verified models and concrete shot/pose/LED ports; no published teacher catalogue.';
	show();

}

boot().catch( error => {

	status.textContent = `${error.name}: ${error.message}`; window.previsRealSceneError = error.message;

} );
