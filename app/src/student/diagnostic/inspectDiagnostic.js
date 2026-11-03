import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, VideoSampleSink, AudioSampleSink } from 'mediabunny';

/** Bounded inspection for the harness; independent FFmpeg checks run on the saved file. */
export async function inspectDiagnostic( file, expectedFrames, { inspectSamples = true, framingEvidence = [] } = {} ) {

	const input = new Input( { formats: ALL_FORMATS, source: new BlobSource( file ) } );
	try {

		const video = await input.getPrimaryVideoTrack();
		const audio = await input.getPrimaryAudioTrack();
		if ( ! video || ! audio ) throw new Error( 'Missing video/audio track' );
		const timestamps = new Uint8Array( expectedFrames );
		let frameCount = 0;
		// At most 22,500 bytes of presentation-index metadata, no retained frame data.
		// Quality encoders can reorder decoding packets, so validate presentation indices.
		for await ( const packet of new EncodedPacketSink( video ).packets() ) {

			const frame = Math.round( packet.timestamp * 25 );
			if ( Math.abs( frame / 25 - packet.timestamp ) > 0.000001 || frame < 0 || frame >= expectedFrames ) throw new Error( `Invalid presentation timestamp ${packet.timestamp}` );
			if ( timestamps[ frame ] ) throw new Error( `Repeated presentation timestamp ${packet.timestamp}` );
			timestamps[ frame ] = 1;
			frameCount ++;

		}

		if ( frameCount !== expectedFrames ) throw new Error( `Expected ${expectedFrames} video frames, got ${frameCount}` );
		const width = await video.getCodedWidth();
		const height = await video.getCodedHeight();
		const videoDuration = await video.computeDuration();
		if ( width !== 1920 || height !== 1080 || Math.abs( videoDuration - expectedFrames / 25 ) > 0.000001 ) throw new Error( 'Output dimensions or video duration mismatch' );
		const frames = [];
		const framingPixels = [];
		const clicks = [];
		if ( inspectSamples ) {

			const sink = new VideoSampleSink( video );
			const surface = Object.assign( document.createElement( 'canvas' ), { width: 1920, height: 1080 } );
			const context = surface.getContext( '2d', { willReadFrequently: true } );
			for ( const frame of [ 0, 24, 124, 125, 126, 249 ].filter( value => value < expectedFrames ) ) {

				const sample = await sink.getSample( ( frame + 0.25 ) / 25 );
				if ( ! sample ) throw new Error( `Cannot decode frame ${frame}` );
				try {

					sample.draw( context, 0, 0 );
					// Scene area excludes the diagnostic HUD. A blank capture is a failure.
					const pixels = context.getImageData( 0, 100, 1920, 980 ).data;
					let sum = 0;
					let squared = 0;
					for ( let i = 0; i < pixels.length; i += 16 ) {

						sum += pixels[ i ];
						squared += pixels[ i ] ** 2;

					}

					const count = pixels.length / 16;
					const variance = squared / count - ( sum / count ) ** 2;
					if ( variance < 5 ) throw new Error( 'Raster capture is blank or uniform' );
					frames.push( { frame, timestamp: sample.timestamp, meanRed: sum / count, variance } );
					const proof = framingEvidence.find( item => item.frame === frame );
					if ( proof ) for ( const expected of proof.samples ) {

						const decoded = Array.from( context.getImageData( expected.x, expected.y, 1, 1 ).data );
						// H.264 is lossy: compare flat-area sample colours with a
						// small code-value tolerance, after exact Canvas2D checks.
						if ( decoded.slice( 0, 3 ).some( ( value, channel ) => Math.abs( value - expected.after[ channel ] ) > 12 ) ) throw new Error( `Encoded framing pixel mismatch at frame ${frame}` );
						framingPixels.push( { frame, ratio: proof.ratio, x: expected.x, y: expected.y, expected: expected.after, decoded } );

					}

				} finally {

					sample.close();

				}

			}

			const seconds = Math.ceil( expectedFrames / 25 );
			const onsets = new Array( seconds ).fill( null );
			for await ( const sample of new AudioSampleSink( audio ).samples( 0, expectedFrames / 25 + 0.1 ) ) {

				try {

					const data = new Float32Array( sample.numberOfFrames );
					sample.copyTo( data, { planeIndex: 0, format: 'f32-planar' } );
					for ( let i = 0; i < data.length; i ++ ) {

						if ( Math.abs( data[ i ] ) < 0.03 ) continue;
						const time = sample.timestamp + i / sample.sampleRate;
						const second = Math.round( time );
						if ( second >= 0 && second < seconds && onsets[ second ] === null ) onsets[ second ] = time;

					}

				} finally {

					sample.close();

				}

			}

			for ( let second = 0; second < seconds; second ++ ) {

				const onset = onsets[ second ];
				if ( onset === null || Math.abs( onset - second ) > 1 / 25 ) throw new Error( `Audio click ${second} is missing or more than one video frame late: ${onset}` );
				clicks.push( { second, onset, errorSeconds: onset - second } );

			}

		}

		return { frameCount, width, height, videoDuration, audioDuration: await audio.computeDuration(), videoCodec: await video.getCodec(), audioCodec: await audio.getCodec(), frames, framingPixels, clicks };

	} finally {

		input.dispose();

	}

}
