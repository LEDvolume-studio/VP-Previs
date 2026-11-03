import { createDiagnosticScene } from './DiagnosticScene.js';
import { createExportFile, exportRasterMP4, probeRasterCodecs } from '../../previs/export/RasterMP4Exporter.js';
import './style.css';
import { createSyntheticRasterAdapter } from './SyntheticRasterAdapter.js';

const status = document.querySelector( '#status' );
const short = document.querySelector( '#short' );
const soak = document.querySelector( '#soak' );
const cancel = document.querySelector( '#cancel' );
let controller;
let running = false;

async function boot() {

	const codecs = await probeRasterCodecs();
	if ( ! codecs.video || ! codecs.audio ) throw new Error( `H.264/AAC unavailable: ${JSON.stringify( codecs )}. The export codec preflight failed.` );
	const adapter = await createDiagnosticScene( document.querySelector( '#viewport' ), { postProcessing: ! new URLSearchParams( location.search ).has( 'raw' ) } );
	async function run( frameCount = 250, { synthetic = false, fileHandle, onFile, onProgress, cancelAtFrame, failAtFrame } = {} ) {

		if ( running ) throw new Error( 'An export is already running' );
		running = true;
		controller = new AbortController();
		short.disabled = soak.disabled = true;
		cancel.disabled = false;
		let destination;
		let originalRender;
		const exportAdapter = synthetic ? createSyntheticRasterAdapter() : adapter;
		try {

			destination = fileHandle ? {
				writable: await fileHandle.createWritable(), getFile: () => fileHandle.getFile(), remove: async () => {},
			} : await createExportFile();
			if ( failAtFrame !== undefined ) {

				originalRender = exportAdapter.renderFrame;
				exportAdapter.renderFrame = async ( frame, options ) => {

					if ( frame === failAtFrame ) throw new Error( 'Injected diagnostic render failure' );
					return originalRender( frame, options );

				};

			}

			const result = await exportRasterMP4( {
				adapter: exportAdapter, frameCount, writable: destination.writable, signal: controller.signal,
				onProgress: progress => {

					status.textContent = `Rendering ${progress.frame} / ${progress.frameCount} frames (${( progress.elapsedMs / 1000 ).toFixed( 1 )}s elapsed)`;
					onProgress?.( progress );
					if ( cancelAtFrame !== undefined && progress.frame >= cancelAtFrame ) controller.abort();

				},
			} );
			const file = await destination.getFile();
			const evidence = { ...result, synthetic, bytes: file.size, codecs, state: exportAdapter.state, userAgent: navigator.userAgent };
			// Consume the OPFS file while it exists; File objects become unreadable
			// after their backing entry is removed. Harness inspection is streamed.
			if ( onFile ) evidence.inspection = await onFile( file );
			document.querySelector( '#result' ).textContent = JSON.stringify( evidence, null, 2 );
			status.textContent = 'Export complete. Inspect frame count, LED timing and audio before accepting this proof.';
			// Browser harness may inspect the file before disposing it. No whole output array in JS.
			return evidence;

		} finally {

			if ( originalRender ) exportAdapter.renderFrame = originalRender;
			running = false;
			short.disabled = soak.disabled = false;
			cancel.disabled = true;
			await destination?.remove();

		}

	}

	const start = async count => {

		try {

			if ( ! window.showSaveFilePicker ) throw new Error( 'This diagnostic needs a desktop browser with Save File support.' );
			const fileHandle = await window.showSaveFilePicker( {
				suggestedName: `previs-diagnostic-${count}.mp4`,
				types: [ { description: 'MP4 video', accept: { 'video/mp4': [ '.mp4' ] } } ],
			} );
			await run( count, { fileHandle, synthetic: count === 22500 } );

		} catch ( error ) {

			status.textContent = `${error.name}: ${error.message}`;

		}

	};

	short.onclick = () => start( 250 );
	soak.onclick = () => start( 22500 );
	cancel.onclick = () => controller?.abort();
	window.previsDiagnostic = { run, adapter, codecs };
	short.disabled = soak.disabled = false;
	status.textContent = 'Ready. Output uses H.264/AAC and streams to temporary device storage.';

}

boot().catch( error => {

	status.textContent = `${error.name}: ${error.message}`; window.previsDiagnosticError = error.message;

} );
