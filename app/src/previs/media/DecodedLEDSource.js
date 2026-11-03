import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';

/** Explicit decoder completion, independent of HTMLVideoElement playback clocks. */
export class DecodedLEDSource {

	static async open( blob ) {

		const input = new Input( { formats: ALL_FORMATS, source: new BlobSource( blob ) } );
		try {

			const track = await input.getPrimaryVideoTrack();
			if ( ! track || ! await track.canDecode() ) throw new Error( 'LED video has no decodable video track' );
			const source = new DecodedLEDSource();
			source.input = input;
			source.sink = new VideoSampleSink( track );
			source.duration = await track.computeDuration();
			source.generation = 0; source.prepared = new Map(); source.closed = false;
			return source;

		} catch ( error ) {

			input.dispose();
			throw error;

		}

	}

	async drawAt( time, context, { signal } = {} ) {

		if ( ! Number.isFinite( time ) || time < 0 || time >= this.duration ) throw new Error( 'LED source time is outside the video' );
		signal?.throwIfAborted();
		const generation = ++ this.generation;
		const key = Math.round( time * 1000000 );
		const prepared = this.prepared.get( key );
		const cached = prepared ? await prepared : null;
		const sample = cached && this.prepared.get( key ) === prepared ? cached.clone() : await this.sink.getSample( time );
		try {

			signal?.throwIfAborted();
			if ( generation !== this.generation ) return false;
			if ( ! sample ) throw new Error( `No decoded LED frame at ${time}s` );
			sample.draw( context, 0, 0, context.canvas.width, context.canvas.height );
			return { timestamp: sample.timestamp, duration: sample.duration };

		} finally {

			sample?.close();

		}

	}

	async prepareFrame( time ) {

		if ( this.closed || ! Number.isFinite( time ) || time < 0 || time >= this.duration ) throw new Error( 'LED source time is outside the video' );
		const key = Math.round( time * 1000000 );
		if ( ! this.prepared.has( key ) ) {

			const sample = this.sink.getSample( time );
			this.prepared.set( key, sample );
			// Bound retained decoded frames. Evicted frames close even if still decoding.
			while ( this.prepared.size > 4 ) {

				const oldest = this.prepared.keys().next().value, pending = this.prepared.get( oldest );
				this.prepared.delete( oldest ); Promise.resolve( pending ).then( frame => frame?.close(), () => {} );

			}

		}

		const pending = this.prepared.get( key );
		try {

			await pending;

		} catch ( error ) {

			if ( this.prepared.get( key ) === pending ) this.prepared.delete( key );
			throw error;

		}

	}

	dispose() {

		++ this.generation; this.closed = true;
		for ( const pending of this.prepared.values() ) Promise.resolve( pending ).then( sample => sample?.close(), () => {} );
		this.prepared.clear();
		this.input.dispose();

	}

}
