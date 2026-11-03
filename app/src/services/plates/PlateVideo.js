import { PLATE_FPS, PLATE_VIEWS, plateFrameAtTime } from './PlateSet.js';

/** A decoded canvas with the media lifecycle expected by the existing LED manager. */
export async function createPlateVideo( source, { view = 'front', initialTime = 0, canvas = document.createElement( 'canvas' ), now = () => performance.now(), requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame } = {} ) {

	const metadata = source.manifest.files[ 'front-hevc' ];
	canvas.width = metadata.width; canvas.height = metadata.height;
	const context = canvas.getContext( '2d', { alpha: false } );
	let time = 0, paused = true, ended = false, seeking = false, closed = false;
	let activeView = view, operation = 0, animation = null, pending = null, base = 0, nextCallback = 0;
	const callbacks = new Map();
	const emit = type => canvas.dispatchEvent( new Event( type ) );
	const stopWork = () => {

		++ operation; pending?.abort(); pending = null;
		if ( animation !== null ) cancelFrame( animation ); animation = null;

	};

	const notifyFrame = () => {

		const queued = [ ...callbacks.values() ]; callbacks.clear();
		for ( const callback of queued ) callback( now(), { mediaTime: time } );
		emit( 'timeupdate' );

	};

	const draw = async ( target, generation ) => {

		pending = new AbortController();
		const result = await source.drawAt( target, context, { view: activeView, signal: pending.signal } );
		if ( closed || generation !== operation || ! result ) return false;
		time = result.frame / PLATE_FPS; notifyFrame(); return true;

	};

	const fail = error => {

		if ( closed || error.name === 'AbortError' ) return;
		paused = true; canvas.error = { code: 3, message: error.message }; emit( 'error' );

	};

	const schedule = () => {

		if ( closed || paused ) return;
		const generation = operation;
		animation = requestFrame( async () => {

			try {

				const elapsed = Math.max( 0, ( now() - base ) / 1000 * canvas.playbackRate );
				const frame = plateFrameAtTime( elapsed, source.manifest.frameCount, { loop: canvas.loop } );
				if ( frame !== Math.round( time * PLATE_FPS ) ) await draw( frame / PLATE_FPS, generation );
				if ( closed || generation !== operation || paused ) return;
				if ( ! canvas.loop && elapsed >= source.duration ) {

					paused = true; ended = true; emit( 'ended' ); return;

				}

				schedule();

			} catch ( error ) {

				if ( generation === operation ) fail( error );

			}

		} );

	};

	const repaint = async ( target, nextView = activeView ) => {

		if ( closed ) return;
		if ( ! PLATE_VIEWS.includes( nextView ) ) throw new Error( 'Choose Front, Left, Right or Rear.' );
		const resume = ! paused; stopWork(); const generation = operation;
		activeView = nextView; seeking = true; ended = false; emit( 'seeking' );
		try {

			if ( ! await draw( target, generation ) ) return;
			if ( generation !== operation || closed ) return;
			seeking = false; emit( 'seeked' );
			if ( resume ) {

				base = now() - time / canvas.playbackRate * 1000; schedule();

			}

		} catch ( error ) {

			if ( generation === operation ) {

				seeking = false; fail( error );

			}

			throw error;

		}

	};

	Object.defineProperties( canvas, {
		videoWidth: { get: () => metadata.width }, videoHeight: { get: () => metadata.height },
		duration: { get: () => source.duration }, paused: { get: () => paused }, ended: { get: () => ended }, seeking: { get: () => seeking }, readyState: { get: () => 4 },
		currentTime: { get: () => time, set: value => {

			repaint( value ).catch( () => {} );

		} },
		plateView: { get: () => activeView },
	} );
	Object.assign( canvas, {
		plateSource: source, playbackRate: 1, loop: false, muted: true,
		setPlateView: next => repaint( time, next ),
		play: async () => {

			if ( closed ) throw new Error( 'This plate has been released.' );
			if ( ! paused ) return;
			if ( ended ) await repaint( 0 );
			paused = false; ended = false; base = now() - time / canvas.playbackRate * 1000; emit( 'play' ); schedule();

		},
		pause: () => {

			if ( paused ) return; paused = true; stopWork(); seeking = false; emit( 'pause' );

		},
		requestVideoFrameCallback: callback => {

			const id = ++ nextCallback; callbacks.set( id, callback ); return id;

		},
		cancelVideoFrameCallback: id => callbacks.delete( id ),
		load: () => {

			if ( closed ) return; closed = true; paused = true; stopWork(); callbacks.clear(); source.dispose().catch( () => {} );

		},
	} );
	try {

		await repaint( Math.max( 0, initialTime ), view ); return canvas;

	} catch ( error ) {

		canvas.load(); throw error;

	}

}
