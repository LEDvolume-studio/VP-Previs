export const SENSOR_ASPECT_RATIO = 16 / 9;

// Sensor gates are expressed at the fixed 16:9 viewport ratio. The widths match
// the familiar formats; the heights describe the portion used by the viewport.
export const SENSOR_PRESETS = {
	'full-frame': { label: 'Full Frame', width: 36, height: 36 / SENSOR_ASPECT_RATIO },
	'super-35': { label: 'Super 35', width: 24.89, height: 24.89 / SENSOR_ASPECT_RATIO },
	'micro-four-thirds': { label: 'Micro 4/3', width: 17.3, height: 17.3 / SENSOR_ASPECT_RATIO },
};

export const FRAME_OVERLAY_PRESETS = {
	'16:9': { label: '16:9', aspect: 16 / 9 },
	'4:3': { label: '4:3', aspect: 4 / 3 },
	'2.40:1': { label: '2.40:1', aspect: 2.4 },
};

export const sensorDimensionsFrom = ( axis, value ) => {

	const numeric = Math.min( 100, Math.max( 1, Number( value ) ) );
	if ( ! Number.isFinite( numeric ) ) return null;
	return axis === 'height'
		? { width: numeric * SENSOR_ASPECT_RATIO, height: numeric }
		: { width: numeric, height: numeric / SENSOR_ASPECT_RATIO };

};

/**
 * Returns the two masks needed to crop a fixed 16:9 viewport to a target ratio.
 * Percentages are relative to the viewport's width or height.
 */
export const getFrameOverlayBars = ratio => {

	const targetAspect = FRAME_OVERLAY_PRESETS[ ratio ]?.aspect;
	if ( ! targetAspect || ratio === '16:9' ) return null;

	if ( targetAspect < SENSOR_ASPECT_RATIO ) {

		const size = ( 1 - targetAspect / SENSOR_ASPECT_RATIO ) * 50;
		return { orientation: 'vertical', size };

	}

	const size = ( 1 - SENSOR_ASPECT_RATIO / targetAspect ) * 50;
	return { orientation: 'horizontal', size };

};
