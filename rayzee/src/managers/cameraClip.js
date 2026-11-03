import { Vector3 } from 'three';

export function getCameraClipStart( camera ) {

	const value = camera?.userData?.clipStart;
	return Number.isFinite( value ) ? Math.max( 0, value ) : 0;

}

/** Keep picking/focus on the same side of an authored clip plane as rendering. */
export function setCameraRayClip( raycaster, camera ) {

	const clipStart = getCameraClipStart( camera );
	// Three.js orthographic rays already start on their near plane.
	raycaster.near = clipStart > 0 && ! camera.isOrthographicCamera
		? clipStart / Math.max( raycaster.ray.direction.dot( camera.getWorldDirection( new Vector3() ) ), 1e-4 )
		: 0;

}

/** World-space depth of a point along the camera axis, for a flat focal plane. */
export function viewDepth( point, camera ) {

	const position = camera.getWorldPosition( new Vector3() );
	return new Vector3().subVectors( point, position ).dot( camera.getWorldDirection( new Vector3() ) );

}
