import { DecodedLEDSource } from '../../previs/media/DecodedLEDSource.js';
import { PLATE_FPS, PLATE_VIEWS, plateFrameAtTime, plateViewAtHeading, validatePlateManifest } from './PlateSet.js';

/** Shared frame source for both editors. Opening is transactional across four decoders. */
export class PlateSetSource {

	static async open( library, manifest, { encoding = 'auto', signal, onProgress, openSource = blob => DecodedLEDSource.open( blob ) } = {} ) {

		validatePlateManifest( manifest );
		const release = await library.lease( manifest.id );
		try {

			let lastError;
			for ( const candidate of encoding === 'auto' ? ( manifest.downloadedEncodings || [ 'hevc', 'h264' ] ) : [ encoding ] ) {

				const sources = new Map();
				try {

					const files = await library.filesFor( manifest, candidate, { signal, onProgress } );
					for ( const view of PLATE_VIEWS ) {

						signal?.throwIfAborted(); sources.set( view, await openSource( files[ view ] ) );

					}

					const source = new PlateSetSource();
					Object.assign( source, { manifest, sources, files, encoding: candidate, release, duration: manifest.frameCount / PLATE_FPS, generation: 0, closed: false, tail: Promise.resolve() } );
					// Match the student LED media port without importing any editor globals.
					source.input = { getPrimaryVideoTrack: async () => ( { displayWidth: manifest.files[ 'front-hevc' ].width, displayHeight: manifest.files[ 'front-hevc' ].height } ) };
					return source;

				} catch ( error ) {

					for ( const source of sources.values() ) source.dispose();
					if ( signal?.aborted ) throw error;
					lastError = error;

				}

			}

			throw lastError;

		} catch ( error ) {

			await release(); throw error;

		}

	}

	/** Draw into staging, then commit only the newest request, even across angle changes. */
	drawAt( time, context, { heading = 0, signal, view = plateViewAtHeading( heading, this.manifest.headingOffset ), loop = false } = {} ) {

		const generation = ++ this.generation;
		const job = this.tail.catch( () => {} ).then( async () => {

			if ( this.closed || generation !== this.generation ) return false;
			signal?.throwIfAborted();
			const frame = plateFrameAtTime( time, this.manifest.frameCount, { loop } );
			if ( ! this.sources.has( view ) ) throw new Error( 'Unknown plate view.' );
			const staging = new OffscreenCanvas( context.canvas.width, context.canvas.height );
			const target = staging.getContext( '2d', { alpha: false } );
			try {

				const result = await this.sources.get( view ).drawAt( frame / PLATE_FPS, target, { signal } );
				if ( ! result || this.closed || generation !== this.generation ) return false;
				signal?.throwIfAborted();
				if ( Math.abs( result.timestamp - frame / PLATE_FPS ) > 0.00005 ) throw new Error( 'Decoded plate frame does not match the shared timeline.' );
				context.drawImage( staging, 0, 0 );
				return { ...result, frame, view, encoding: this.encoding };

			} finally {

				staging.width = 0; staging.height = 0;

			}

		} );
		this.tail = job;
		return job;

	}

	async dispose() {

		if ( this.closed ) return;
		this.closed = true; ++ this.generation;
		await this.tail.catch( () => {} );
		for ( const source of this.sources.values() ) source.dispose();
		this.sources.clear(); await this.release();

	}

}
