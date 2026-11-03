let ready;

/**
 * Use one pinned AAC implementation on supported platforms. Native macOS AAC
 * measured 44 ms priming in our MP4, beyond the one-frame audio tolerance.
 * This also provides AAC on desktop browsers without a native encoder.
 */
export async function ensureAACEncoder() {

	ready ??= import( '@mediabunny/aac-encoder' ).then( ( { registerAacEncoder } ) => {

		registerAacEncoder();
		return 'ffmpeg-wasm-aac';

	} ).catch( error => {

		ready = undefined;
		throw error;

	} );
	return ready;

}
