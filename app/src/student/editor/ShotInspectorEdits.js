import { cloneStudentContent } from '../../previs/domain/StudentProjectSchema.js';
import { validateLEDBlur } from '../../previs/media/LEDBlur.js';

export function createInspectorLEDBlurEdit( shot, wallId, blur ) {

	validateLEDBlur( blur );
	const replacement = cloneStudentContent( shot );
	const wall = replacement.snapshot.ledWalls.find( item => item.wallId === wallId );
	if ( wall?.presentationVersion !== 1 ) throw new Error( 'Choose a supported LED screen.' );
	wall.blur = { ...blur };
	return replacement;

}

/** Inspector edits preserve all unexposed camera and scene state, including roll. */
export function createInspectorCameraEdit( shot, field, value ) {

	if ( ! Number.isFinite( value ) ) throw new Error( 'Enter a finite camera value.' );
	const replacement = cloneStudentContent( shot );
	const camera = replacement.snapshot.camera;
	if ( field === 'focalLength' ) {

		if ( value <= 0 || camera.projection.type !== 'perspective' ) throw new Error( 'Focal length requires a positive value and perspective camera.' );
		const filmHeight = camera.projection.filmGauge / Math.max( camera.projection.aspect, 1 );
		const fov = 2 * Math.atan( filmHeight / ( 2 * value ) ) * 180 / Math.PI;
		if ( ! Number.isFinite( fov ) || fov < 1 || fov > 179 ) throw new Error( 'Choose a focal length that keeps the vertical field of view between 1° and 179°.' );
		camera.lens.focalLength = value;
		camera.projection.fov = fov;

	} else if ( field === 'height' ) {

		const delta = value - camera.transform.position[ 1 ];
		camera.transform.position[ 1 ] = value;
		camera.target[ 1 ] += delta;
		if ( ! Number.isFinite( camera.target[ 1 ] ) ) throw new Error( 'Camera height exceeds the supported range.' );

	} else if ( field === 'exposure' ) {

		if ( value < 0 ) throw new Error( 'Exposure cannot be negative.' );
		camera.exposure = value;

	} else {

		throw new Error( 'Unsupported inspector camera field.' );

	}

	return replacement;

}
