import { LED_BLUR_METHODS } from './LEDBlur.js';

/** Compare identical two-second, 25 fps samples, including decode and GPU completion.
 * Warm-up is excluded. Values are device/scene dependent, never persisted.
 */
export async function compareLEDBlur( { render, select, complete, signal, onProgress = () => {}, amount = 12 } ) {

	const results = [];
	for ( const method of LED_BLUR_METHODS ) {

		signal?.throwIfAborted(); onProgress( method );
		select( { method, amount } );
		for ( let frame = 0; frame < 3; frame ++ ) {

			await render( frame ); await complete();

		}

		const durations = [], started = performance.now();
		let previousFrame = - 1;
		while ( performance.now() - started < 2000 ) {

			signal?.throwIfAborted();
			const now = await new Promise( resolve => requestAnimationFrame( resolve ) );
			const frame = Math.floor( ( now - started ) / 40 );
			if ( frame >= 50 ) break;
			if ( frame === previousFrame ) continue;
			previousFrame = frame;
			const start = performance.now();
			await render( frame ); await complete();
			durations.push( performance.now() - start );

		}

		const elapsed = performance.now() - started, sorted = [ ...durations ].sort( ( a, b ) => a - b );
		if ( ! durations.length ) throw new Error( 'Keep this tab visible while comparing playback.' );
		results.push( { method, amount, fps: Math.min( 25, durations.length * 1000 / elapsed ), meanMs: durations.reduce( ( a, b ) => a + b, 0 ) / durations.length, p95Ms: sorted[ Math.ceil( sorted.length * 0.95 ) - 1 ], frames: durations.length } );

	}

	return results;

}
