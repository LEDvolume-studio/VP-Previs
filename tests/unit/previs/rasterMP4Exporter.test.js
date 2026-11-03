// Unit ownership tests replace the browser-only AAC registration.
vi.mock( '../../../app/src/previs/export/AACEncoder.js', () => ( { ensureAACEncoder: async () => 'mock-aac' } ) );
import { beforeEach, describe, expect, it, vi } from 'vitest';

// These mocks test ownership and scheduling only. Real codec/media acceptance is
// exercised separately in the browser diagnostic, never inferred from this suite.
const state = vi.hoisted( () => ( {

	events: [], outputs: [], videos: [], audios: [], samples: [], hooks: {},
	videoSupported: true, audioSupported: true,
	canEncodeVideo: vi.fn(), canEncodeAudio: vi.fn(),

} ) );

vi.mock( 'mediabunny', () => ( {

	Quality: class {

		constructor( options ) {

			Object.assign( this, options );

		}

	},
	Mp4OutputFormat: class {

		constructor( options ) {

			this.options = options;

		}

	},
	StreamTarget: class {

		constructor( writable, options ) {

			Object.assign( this, { writable, options } );

		}

	},
	Output: class {

		constructor( options ) {

			this.options = options;
			state.outputs.push( this );
			this.start = vi.fn( async () => {

				state.events.push( 'start' ); await state.hooks.start?.();

			} );
			this.finalize = vi.fn( async () => {

				state.events.push( 'finalize' ); await state.hooks.finalize?.();

			} );
			this.cancel = vi.fn( async () => {

				state.events.push( 'cancel' ); await state.hooks.cancel?.();

			} );
			this.addVideoTrack = vi.fn();
			this.addAudioTrack = vi.fn();

		}

	},
	CanvasSource: class {

		constructor( canvas, options ) {

			Object.assign( this, { canvas, options } );
			state.videos.push( this );
			this.add = vi.fn( async ( timestamp, duration ) => {

				state.events.push( `video:${timestamp}` );
				await state.hooks.videoAdd?.( timestamp, duration );

			} );
			this.close = vi.fn( () => state.events.push( 'video-close' ) );

		}

	},
	AudioSampleSource: class {

		constructor( options ) {

			this.options = options;
			state.audios.push( this );
			this.add = vi.fn( async sample => {

				state.events.push( `audio:${sample.timestamp}` );
				await state.hooks.audioAdd?.( sample );

			} );
			this.close = vi.fn( () => state.events.push( 'audio-close' ) );

		}

	},
	AudioSample: class {

		constructor( options ) {

			Object.assign( this, options );
			state.samples.push( this );
			this.close = vi.fn( () => state.events.push( `sample-close:${this.timestamp}` ) );

		}

	},
	canEncodeVideo: state.canEncodeVideo,
	canEncodeAudio: state.canEncodeAudio,

} ) );

import { createClickBlock, exportRasterMP4 } from '../../../app/src/previs/export/RasterMP4Exporter.js';

function setup() {

	const adapter = {
		canvas: { width: 1920, height: 1080 },
		prepare: vi.fn( async () => state.events.push( 'prepare' ) ),
		renderFrame: vi.fn( async frame => state.events.push( `render:${frame}` ) ),
		restore: vi.fn( async () => state.events.push( 'restore' ) ),
	};
	const writable = { locked: false, abort: vi.fn( async () => state.events.push( 'abort' ) ) };
	return { adapter, writable, frameCount: 3 };

}

function deferred() {

	let resolve;
	const promise = new Promise( done => {

		resolve = done;

	} );
	return { promise, resolve };

}

beforeEach( () => {

	vi.clearAllMocks();
	for ( const key of [ 'events', 'outputs', 'videos', 'audios', 'samples' ] ) state[ key ] = [];
	state.hooks = {};
	state.videoSupported = state.audioSupported = true;
	state.canEncodeVideo.mockImplementation( async () => state.videoSupported );
	state.canEncodeAudio.mockImplementation( async () => state.audioSupported );

} );

describe( 'raster export lifecycle with mocked codecs', () => {

	it( 'submits exact frame/sample times and restores after finalization', async () => {

		const options = setup();
		const progress = vi.fn();
		const result = await exportRasterMP4( { ...options, onProgress: progress } );
		expect( result ).toMatchObject( { frameCount: 3, duration: 0.12, width: 1920, height: 1080, fps: 25, sampleRate: 48000 } );
		expect( state.videos[ 0 ].add.mock.calls ).toEqual( [[ 0, 0.04 ], [ 0.04, 0.04 ], [ 0.08, 0.04 ]] );
		expect( state.samples.map( sample => [ sample.timestamp, sample.data.length, sample.sampleRate, sample.numberOfChannels ] ) ).toEqual( [[ 0, 1920, 48000, 1 ], [ 0.04, 1920, 48000, 1 ], [ 0.08, 1920, 48000, 1 ]] );
		for ( const sample of state.samples ) expect( sample.close ).toHaveBeenCalledOnce();
		expect( state.events.slice( - 4 ) ).toEqual( [ 'video-close', 'audio-close', 'finalize', 'restore' ] );
		expect( state.outputs[ 0 ].cancel ).not.toHaveBeenCalled();
		expect( options.writable.abort ).not.toHaveBeenCalled();
		expect( options.adapter.restore ).toHaveBeenCalledOnce();
		expect( progress.mock.calls.map( ( [ item ] ) => item.frame ) ).toEqual( [ 1, 3 ] );

	} );

	it.each( [ 0, - 1, 1.5, 22501 ] )( 'aborts the writable before preparing invalid frame count %s', async frameCount => {

		const options = setup();
		await expect( exportRasterMP4( { ...options, frameCount } ) ).rejects.toThrow( '1–22500' );
		expect( options.writable.abort ).toHaveBeenCalledOnce();
		expect( options.adapter.prepare ).not.toHaveBeenCalled();
		expect( options.adapter.restore ).not.toHaveBeenCalled();
		expect( state.canEncodeVideo ).not.toHaveBeenCalled();

	} );

	it( 'aborts a precreated writable for an already cancelled request', async () => {

		const options = setup();
		const controller = new AbortController();
		const reason = new Error( 'Cancelled before start' );
		controller.abort( reason );
		await expect( exportRasterMP4( { ...options, signal: controller.signal } ) ).rejects.toBe( reason );
		expect( options.writable.abort ).toHaveBeenCalledWith( reason );
		expect( options.adapter.prepare ).not.toHaveBeenCalled();

	} );

	it.each( [ 'videoSupported', 'audioSupported' ] )( 'cleans up an unsupported %s codec without editing the scene', async key => {

		const options = setup();
		state[ key ] = false;
		await expect( exportRasterMP4( options ) ).rejects.toThrow( 'encoding unavailable' );
		expect( options.writable.abort ).toHaveBeenCalledOnce();
		expect( options.adapter.prepare ).not.toHaveBeenCalled();
		expect( options.adapter.restore ).not.toHaveBeenCalled();
		expect( state.outputs ).toHaveLength( 0 );

	} );

	it( 'aborts the writable when codec probing itself fails', async () => {

		const options = setup();
		const failure = new Error( 'Codec probe unavailable' );
		state.canEncodeVideo.mockRejectedValueOnce( failure );
		await expect( exportRasterMP4( options ) ).rejects.toBe( failure );
		expect( options.writable.abort ).toHaveBeenCalledWith( failure );

	} );

	it( 'restores partial preparation and preserves its failure if writable cleanup also fails', async () => {

		const options = setup();
		const failure = new Error( 'Partially prepared scene' );
		options.adapter.prepare.mockRejectedValueOnce( failure );
		options.writable.abort.mockRejectedValueOnce( new Error( 'Disk cleanup failed' ) );
		await expect( exportRasterMP4( options ) ).rejects.toBe( failure );
		expect( options.adapter.restore ).toHaveBeenCalledOnce();
		expect( state.outputs ).toHaveLength( 0 );

	} );

	it( 'cancels before encoding a rendered frame when cancellation arrives during render', async () => {

		const options = setup();
		const controller = new AbortController();
		options.adapter.renderFrame.mockImplementationOnce( async () => controller.abort() );
		await expect( exportRasterMP4( { ...options, signal: controller.signal } ) ).rejects.toMatchObject( { name: 'AbortError' } );
		expect( state.videos[ 0 ].add ).not.toHaveBeenCalled();
		expect( state.outputs[ 0 ].cancel ).toHaveBeenCalledOnce();
		expect( options.adapter.restore ).toHaveBeenCalledOnce();

	} );

	it.each( [ 'start', 'videoAdd', 'audioAdd', 'finalize' ] )( 'cancels output and restores on %s failure without masking it', async stage => {

		const options = setup();
		const failure = new Error( `${stage} failed` );
		state.hooks[ stage ] = async () => {

			throw failure;

		};

		state.hooks.cancel = async () => {

			throw new Error( 'Secondary cancellation failure' );

		};

		await expect( exportRasterMP4( options ) ).rejects.toBe( failure );
		expect( state.outputs[ 0 ].cancel ).toHaveBeenCalledOnce();
		expect( options.adapter.restore ).toHaveBeenCalledOnce();
		for ( const sample of state.samples ) expect( sample.close ).toHaveBeenCalledOnce();

	} );

	it( 'rejects output dimensions changed by the adapter before encoding', async () => {

		const options = setup();
		options.adapter.renderFrame.mockImplementationOnce( async () => {

			options.adapter.canvas.width = 1280;

		} );
		await expect( exportRasterMP4( options ) ).rejects.toThrow( 'changed output dimensions' );
		expect( state.videos[ 0 ].add ).not.toHaveBeenCalled();
		expect( state.outputs[ 0 ].cancel ).toHaveBeenCalledOnce();
		expect( options.adapter.restore ).toHaveBeenCalledOnce();

	} );

	it.each( [ new Float32Array( 1919 ), new Float32Array( 1921 ), new Float64Array( 1920 ) ] )( 'rejects an invalid PCM block before submitting an audio sample', async data => {

		const options = setup();
		await expect( exportRasterMP4( { ...options, audioBlock: async () => data } ) ).rejects.toThrow( 'mono 40 ms PCM block' );
		expect( state.samples ).toHaveLength( 0 );
		expect( state.audios[ 0 ].add ).not.toHaveBeenCalled();
		expect( state.outputs[ 0 ].cancel ).toHaveBeenCalledOnce();
		expect( options.adapter.restore ).toHaveBeenCalledOnce();

	} );

	it( 'waits for video and audio backpressure before rendering the next frame', async () => {

		const options = setup();
		const videoGate = deferred();
		const audioGate = deferred();
		state.hooks.videoAdd = timestamp => timestamp === 0 ? videoGate.promise : undefined;
		state.hooks.audioAdd = sample => sample.timestamp === 0 ? audioGate.promise : undefined;
		const pending = exportRasterMP4( { ...options, frameCount: 2 } );
		try {

			await vi.waitFor( () => expect( state.events ).toContain( 'video:0' ) );
			expect( state.samples ).toHaveLength( 0 );
			expect( options.adapter.renderFrame ).toHaveBeenCalledTimes( 1 );
			videoGate.resolve();
			await vi.waitFor( () => expect( state.events ).toContain( 'audio:0' ) );
			expect( state.samples[ 0 ].close ).not.toHaveBeenCalled();
			expect( options.adapter.renderFrame ).toHaveBeenCalledTimes( 1 );

		} finally {

			videoGate.resolve();
			audioGate.resolve();
			await pending;

		}

		expect( state.events.indexOf( 'sample-close:0' ) ).toBeLessThan( state.events.indexOf( 'render:1' ) );
		expect( state.videos[ 0 ].add.mock.calls ).toEqual( [[ 0, 0.04 ], [ 0.04, 0.04 ]] );

	} );

	it( 'preserves export and restore failures together for recovery diagnostics', async () => {

		const options = setup();
		const failure = new Error( 'Render failed' );
		const restoreFailure = new Error( 'Restore failed' );
		options.adapter.renderFrame.mockRejectedValueOnce( failure );
		options.adapter.restore.mockRejectedValueOnce( restoreFailure );
		const error = await exportRasterMP4( options ).catch( caught => caught );
		expect( error ).toBeInstanceOf( AggregateError );
		expect( error.errors ).toEqual( [ failure, restoreFailure ] );
		expect( error.cause ).toBe( failure );
		expect( state.outputs[ 0 ].cancel ).toHaveBeenCalledOnce();

	} );

	it( 'reports restore failure after successfully finalized output', async () => {

		const options = setup();
		const failure = new Error( 'Restore failed' );
		options.adapter.restore.mockRejectedValueOnce( failure );
		await expect( exportRasterMP4( options ) ).rejects.toBe( failure );
		expect( state.outputs[ 0 ].finalize ).toHaveBeenCalledOnce();
		expect( state.outputs[ 0 ].cancel ).not.toHaveBeenCalled();

	} );

	it( 'generates a bounded mono click block and silence between second markers', () => {

		const click = createClickBlock( 25 );
		expect( click ).toBeInstanceOf( Float32Array );
		expect( click ).toHaveLength( 1920 );
		expect( click.slice( 0, 480 ).some( value => value !== 0 ) ).toBe( true );
		expect( click.slice( 480 ).every( value => value === 0 ) ).toBe( true );
		expect( createClickBlock( 26 ).every( value => value === 0 ) ).toBe( true );
		expect( Math.max( ...click.map( Math.abs ) ) ).toBeLessThanOrEqual( 0.35 );

	} );

} );
