import {
	AudioSample, AudioSampleSource, CanvasSource, Mp4OutputFormat, Output,
	Quality, StreamTarget, canEncodeAudio, canEncodeVideo,
} from 'mediabunny';
import { ensureAACEncoder } from './AACEncoder.js';

export const RASTER_OUTPUT = Object.freeze( { width: 1920, height: 1080, fps: 25, sampleRate: 48000, maxFrames: 22500 } );

export async function probeRasterCodecs() {

	await ensureAACEncoder();
	const { width, height, fps, sampleRate } = RASTER_OUTPUT;
	const [ video, audio ] = await Promise.all( [
		canEncodeVideo( 'avc', { width, height, frameRate: fps, quality: new Quality( { bitrate: 8e6 } ) } ),
		canEncodeAudio( 'aac', { numberOfChannels: 1, sampleRate, quality: new Quality( { bitrate: 128e3 } ) } ),
	] );
	return { video, audio };

}

/** Diagnostic block provider: one 40 ms PCM block, never a complete sequence mix. */
export function createClickBlock( frame ) {

	const data = new Float32Array( RASTER_OUTPUT.sampleRate / RASTER_OUTPUT.fps );
	if ( frame % 25 === 0 ) {

		for ( let i = 0; i < 480; i ++ ) data[ i ] = 0.35 * Math.sin( 2 * Math.PI * 1000 * i / 48000 ) * ( 1 - i / 480 );

	}

	return data;

}

/**
 * Offline, bounded frame pump. The adapter snapshots/restores editing state and
 * returns a raster canvas immediately after drawing (before any browser yield).
 * PCM blocks are interleaved with video so muxing cannot buffer a whole track.
 */
export async function exportRasterMP4( { adapter, frameCount, writable, audioBlock = createClickBlock, signal, onProgress = () => {} } ) {

	const { width, height, fps, sampleRate } = RASTER_OUTPUT;
	let output;
	let prepared = false;
	let failure;
	let result;
	const started = performance.now();
	try {

		if ( ! Number.isInteger( frameCount ) || frameCount < 1 || frameCount > RASTER_OUTPUT.maxFrames ) throw new Error( 'Export requires 1–22500 frames' );
		signal?.throwIfAborted();
		const codecs = await probeRasterCodecs();
		if ( ! codecs.video || ! codecs.audio ) throw new Error( `H.264/AAC encoding unavailable (H.264: ${codecs.video}, AAC: ${codecs.audio}). Try a supported desktop browser.` );
		prepared = true; // Restore even if preparation fails halfway through.
		await adapter.prepare( { width, height, signal } );
		signal?.throwIfAborted();
		output = new Output( {
			format: new Mp4OutputFormat( { fastStart: 'fragmented', minimumFragmentDuration: 1 } ),
			target: new StreamTarget( writable, { chunked: true, chunkSize: 1024 * 1024 } ),
		} );
		const video = new CanvasSource( adapter.canvas, { codec: 'avc', quality: new Quality( { bitrate: 8e6 } ), latencyMode: 'quality', keyFrameInterval: 1 } );
		const audio = new AudioSampleSource( { codec: 'aac', quality: new Quality( { bitrate: 128e3 } ) } );
		output.addVideoTrack( video, { frameRate: fps } );
		output.addAudioTrack( audio );
		await output.start();
		for ( let frame = 0; frame < frameCount; frame ++ ) {

			signal?.throwIfAborted();
			await adapter.renderFrame( frame, { signal, width, height } );
			signal?.throwIfAborted();
			if ( adapter.canvas.width !== width || adapter.canvas.height !== height ) throw new Error( 'Raster canvas changed output dimensions' );
			await video.add( frame / fps, 1 / fps );
			const data = await audioBlock( frame );
			if ( ! ( data instanceof Float32Array ) || data.length !== sampleRate / fps ) throw new Error( 'Audio provider must return one mono 40 ms PCM block' );
			const sample = new AudioSample( { data, format: 'f32', numberOfChannels: 1, sampleRate, timestamp: frame / fps } );
			try {

				await audio.add( sample );

			} finally {

				sample.close();

			}

			if ( frame % 25 === 0 || frame === frameCount - 1 ) {

				onProgress( { frame: frame + 1, frameCount, elapsedMs: performance.now() - started } );
				await new Promise( resolve => setTimeout( resolve, 0 ) );

			}

		}

		video.close();
		audio.close();
		signal?.throwIfAborted();
		await output.finalize();
		signal?.throwIfAborted();
		result = { frameCount, duration: frameCount / fps, elapsedMs: performance.now() - started, ...RASTER_OUTPUT };

	} catch ( error ) {

		failure = error;
		try {

			if ( output ) await output.cancel();
			else if ( ! writable.locked ) await writable.abort( error );

		} catch { /* Keep the original encoder/disk/cancellation error. */ }


	} finally {

		if ( prepared ) {

			try {

				await adapter.restore();

			} catch ( restoreError ) {

				failure = failure ? new AggregateError( [ failure, restoreError ], 'Export failed and editor state could not be fully restored', { cause: failure } ) : restoreError;

			}

		}

	}

	if ( failure ) throw failure;
	return result;

}

/** Caller consumes the file before removing its backing entry. */
export async function createExportFile() {

	const root = await navigator.storage.getDirectory();
	const name = `previs-export-${crypto.randomUUID()}.mp4`;
	const handle = await root.getFileHandle( name, { create: true } );
	try {

		return { writable: await handle.createWritable(), getFile: () => handle.getFile(), remove: () => root.removeEntry( name ) };

	} catch ( error ) {

		await root.removeEntry( name );
		throw error;

	}

}
