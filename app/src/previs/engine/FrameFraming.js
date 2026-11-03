// Shared by student preview and canvas export. Framing dims the full image;
// it never crops, stretches, or changes the camera's 16:9 output surface.
export const FRAMING_BAR_OPACITY = 0.5;
const RATIOS = Object.freeze( { '16:9': 16 / 9, '4:3': 4 / 3, '2.40:1': 2.4 } );

export function getFramingBars( ratio, width, height ) {

	if ( ! Object.hasOwn( RATIOS, ratio ) ) throw new RangeError( `Unsupported framing ratio: ${ratio}` );
	if ( ! Number.isFinite( width ) || width <= 0 || ! Number.isFinite( height ) || height <= 0 ) throw new RangeError( 'Framing requires positive surface dimensions' );
	const target = RATIOS[ ratio ];
	const aspect = width / height;
	if ( Math.abs( target - aspect ) < 1e-10 ) return [];
	if ( target < aspect ) {

		const size = ( width - height * target ) / 2;
		return [ { x: 0, y: 0, width: size, height }, { x: width - size, y: 0, width: size, height } ];

	}

	const size = ( height - width / target ) / 2;
	return [ { x: 0, y: 0, width, height: size }, { x: 0, y: height - size, width, height: size } ];

}

/** Composite once onto a newly rendered Canvas2D frame, after the GPU copy. */
export function drawFramingBars( context, ratio = '16:9', width = context.canvas.width, height = context.canvas.height ) {

	const bars = getFramingBars( ratio, width, height );
	if ( ! bars.length ) return;
	context.save();
	try {

		context.resetTransform();
		context.globalCompositeOperation = 'source-over';
		context.globalAlpha = FRAMING_BAR_OPACITY;
		context.fillStyle = '#000000';
		for ( const bar of bars ) context.fillRect( bar.x, bar.y, bar.width, bar.height );

	} finally {

		context.restore();

	}

}
