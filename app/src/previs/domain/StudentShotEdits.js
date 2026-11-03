import { cloneStudentContent, STUDENT_FPS } from './StudentProjectSchema.js';
import { SENSOR_ASPECT_RATIO } from '../../utils/cameraSensor.js';

const own = ( value, key ) => Object.hasOwn( value, key );

function fields( value, required, optional = [] ) {

	if ( ! value || typeof value !== 'object' || Array.isArray( value ) || ! [ Object.prototype, null ].includes( Object.getPrototypeOf( value ) ) ) throw new Error( 'Shot edit values must be a plain record.' );
	if ( required.some( key => ! own( value, key ) ) || Object.keys( value ).some( key => ! required.includes( key ) && ! optional.includes( key ) ) ) throw new Error( 'Missing or unsupported shot edit field.' );

}

function finite( value, label, min = - Infinity, max = Infinity ) {

	if ( ! Number.isFinite( value ) || value < min || value > max ) throw new Error( `${label} must be a finite number in [${min}, ${max}].` );

}

function position( value, label ) {

	if ( ! Array.isArray( value ) || value.length !== 3 ) throw new Error( `${label} requires three coordinates.` );
	for ( let index = 0; index < 3; index ++ ) finite( value[ index ], `${label}[${index}]` );

}

function identifier( value, label ) {

	if ( typeof value !== 'string' || ! value.length ) throw new Error( `${label} is required.` );

}

/** Camera -Z points at target, with world Y up. No renderer dependency. */
function lookAtQuaternion( eye, target ) {

	const z = eye.map( ( component, index ) => component - target[ index ] );
	const length = Math.hypot( ...z );
	if ( ! Number.isFinite( length ) || length === 0 ) throw new Error( 'Camera position and target must be distinct finite points.' );
	for ( let index = 0; index < 3; index ++ ) z[ index ] /= length;
	const rightLength = Math.hypot( z[ 2 ], z[ 0 ] );
	if ( rightLength === 0 ) throw new Error( 'A camera target directly above or below the camera has no Y-up heading; move the target sideways.' );
	const x = [ z[ 2 ] / rightLength, 0, - z[ 0 ] / rightLength ];
	const y = [ z[ 1 ] * x[ 2 ], z[ 2 ] * x[ 0 ] - z[ 0 ] * x[ 2 ], - z[ 1 ] * x[ 0 ] ];
	const [ m11, m21, m31 ] = x;
	const [ m12, m22, m32 ] = y;
	const [ m13, m23, m33 ] = z;
	const trace = m11 + m22 + m33;
	let quaternion;
	if ( trace > 0 ) {

		const s = 0.5 / Math.sqrt( trace + 1 );
		quaternion = [ ( m32 - m23 ) * s, ( m13 - m31 ) * s, ( m21 - m12 ) * s, 0.25 / s ];

	} else if ( m11 > m22 && m11 > m33 ) {

		const s = 2 * Math.sqrt( 1 + m11 - m22 - m33 );
		quaternion = [ 0.25 * s, ( m12 + m21 ) / s, ( m13 + m31 ) / s, ( m32 - m23 ) / s ];

	} else if ( m22 > m33 ) {

		const s = 2 * Math.sqrt( 1 + m22 - m11 - m33 );
		quaternion = [ ( m12 + m21 ) / s, 0.25 * s, ( m23 + m32 ) / s, ( m13 - m31 ) / s ];

	} else {

		const s = 2 * Math.sqrt( 1 + m33 - m11 - m22 );
		quaternion = [ ( m13 + m31 ) / s, ( m23 + m32 ) / s, 0.25 * s, ( m21 - m12 ) / s ];

	}

	const quaternionLength = Math.hypot( ...quaternion );
	return quaternion.map( component => component / quaternionLength );

}

/** Build a complete replacement shot; apply replaceShot to validate and commit it. */
export function createCameraShotEdit( shot, values ) {

	fields( values, [ 'position', 'target', 'fov', 'exposure', 'frameOverlayRatio' ] );
	position( values.position, 'Camera position' );
	position( values.target, 'Camera target' );
	finite( values.fov, 'Field of view', 1, 179 );
	finite( values.exposure, 'Exposure', 0 );
	if ( ! [ '16:9', '4:3', '2.40:1' ].includes( values.frameOverlayRatio ) ) throw new Error( 'Unsupported framing ratio.' );
	const projection = shot.snapshot.camera.projection;
	if ( projection.type !== 'perspective' ) throw new Error( 'Simplified camera editing requires a perspective camera.' );
	const quaternion = lookAtQuaternion( values.position, values.target );
	// FOV is vertical: PerspectiveCamera.getFocalLength uses film height,
	// using the fixed photographic gate, independently of zoom or legacy aspect.
	const focalLength = 0.5 * ( projection.filmGauge / SENSOR_ASPECT_RATIO ) / Math.tan( ( Math.PI / 180 ) * 0.5 * values.fov );
	finite( focalLength, 'Focal length', Number.MIN_VALUE );
	const replacement = cloneStudentContent( shot );
	const camera = replacement.snapshot.camera;
	camera.projection.aspect = SENSOR_ASPECT_RATIO;
	const changedAim = values.position.some( ( component, index ) => component !== camera.transform.position[ index ] ) || values.target.some( ( component, index ) => component !== camera.target[ index ] );
	camera.transform.position = [ ...values.position ];
	// Preserve an authored roll when only framing/exposure/lens values change.
	if ( changedAim ) camera.transform.quaternion = quaternion;
	camera.target = [ ...values.target ];
	if ( values.fov !== camera.projection.fov ) camera.lens.focalLength = focalLength;
	camera.projection.fov = values.fov;
	camera.exposure = values.exposure;
	camera.frameOverlayRatio = values.frameOverlayRatio;
	return replacement;

}

/** Position changes preserve rotation, scale, door state and all sibling nodes. */
export function createNodeShotEdit( shot, values ) {

	fields( values, [ 'instanceId', 'position' ], [ 'humanPose' ] );
	identifier( values.instanceId, 'Node instance ID' );
	position( values.position, 'Object position' );
	const node = own( shot.snapshot.nodes, values.instanceId ) ? shot.snapshot.nodes[ values.instanceId ] : null;
	if ( ! node ) throw new Error( 'Unknown node instance.' );
	if ( own( values, 'humanPose' ) && ( ! [ 'standing', 'sitting' ].includes( node.humanPose ) || ! [ 'standing', 'sitting' ].includes( values.humanPose ) ) ) throw new Error( 'Standing/sitting poses require an existing human node.' );
	const replacement = cloneStudentContent( shot );
	const edited = replacement.snapshot.nodes[ values.instanceId ];
	edited.transform.position = [ ...values.position ];
	if ( own( values, 'humanPose' ) ) edited.humanPose = values.humanPose;
	return replacement;

}

export function createLightShotEdit( shot, values ) {

	fields( values, [ 'lightId', 'intensity' ], [ 'color' ] );
	identifier( values.lightId, 'Light ID' );
	finite( values.intensity, 'Light intensity', 0 );
	const index = shot.snapshot.lights.findIndex( light => light.lightId === values.lightId );
	if ( index < 0 ) throw new Error( 'Unknown light.' );
	let color;
	if ( own( values, 'color' ) ) {

		if ( typeof values.color !== 'string' || ! /^#[0-9a-f]{6}$/i.test( values.color ) ) throw new Error( 'Light color must use #rrggbb.' );
		// Saved light components use linear RGB, matching Three Color.setHex.
		color = [ 1, 3, 5 ].map( start => {

			const component = parseInt( values.color.slice( start, start + 2 ), 16 ) / 255;
			return component <= 0.04045 ? component / 12.92 : Math.pow( ( component + 0.055 ) / 1.055, 2.4 );

		} );

	}

	const replacement = cloneStudentContent( shot );
	replacement.snapshot.lights[ index ].intensity = values.intensity;
	if ( color ) replacement.snapshot.lights[ index ].color = color;
	return replacement;

}

export function createLEDShotEdit( shot, values ) {

	fields( values, [ 'wallId', 'mode', 'loop', 'brightnessNits' ], [ 'inPointFrames' ] );
	identifier( values.wallId, 'LED wall ID' );
	if ( ! [ 'freeze', 'play' ].includes( values.mode ) ) throw new Error( 'LED mode must be freeze or play.' );
	if ( typeof values.loop !== 'boolean' ) throw new Error( 'LED loop must be a boolean.' );
	finite( values.brightnessNits, 'LED brightness', 0 );
	const index = shot.snapshot.ledWalls.findIndex( wall => wall.wallId === values.wallId );
	if ( index < 0 ) throw new Error( 'Unknown LED wall.' );
	const wall = shot.snapshot.ledWalls[ index ];
	if ( wall.presentationVersion !== 1 ) throw new Error( 'LED editing requires explicit presentationVersion 1; legacy brightness units cannot be converted implicitly.' );
	// Admin captures can contain sub-frame in-points. An unchanged frame form
	// must not quantize those authored microseconds when another field changes.
	const editsInPoint = own( values, 'inPointFrames' );
	const inPointUs = editsInPoint ? values.inPointFrames * ( 1000000 / STUDENT_FPS ) : wall.inPointUs;
	if ( editsInPoint && ( ! Number.isSafeInteger( values.inPointFrames ) || values.inPointFrames < 0 || ! Number.isSafeInteger( inPointUs ) ) ) throw new Error( 'LED in-point must be a nonnegative frame with a safe integer microsecond timestamp.' );
	if ( wall.media === null && ( values.mode !== 'freeze' || inPointUs !== 0 ) ) throw new Error( 'A blank LED wall must freeze at frame zero.' );
	const replacement = cloneStudentContent( shot );
	Object.assign( replacement.snapshot.ledWalls[ index ], { mode: values.mode, inPointUs, loop: values.loop, brightnessNits: values.brightnessNits } );
	return replacement;

}
