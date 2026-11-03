/** Separate synthetic soak, deliberately excludes GPU scene/media decoding cost. */
export function createSyntheticRasterAdapter() {

	const canvas = Object.assign( document.createElement( 'canvas' ), { width: 1920, height: 1080 } );
	const context = canvas.getContext( '2d' );
	let restored = true;
	return {
		canvas,
		async prepare() {

			restored = false;

		},
		async renderFrame( frame ) {

			context.fillStyle = frame % 50 < 25 ? '#164c55' : '#823c29';
			context.fillRect( 0, 0, canvas.width, canvas.height );
			context.fillStyle = '#ffffff';
			context.font = '72px monospace';
			context.fillText( `SYNTHETIC FRAME ${frame}`, 100, 400 );

		},
		async restore() {

			restored = true;

		},
		get state() {

			return { restored, backend: 'Canvas2D synthetic soak' };

		},
	};

}
