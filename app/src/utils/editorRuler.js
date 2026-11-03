import { Raycaster, Vector2, Vector3 } from 'three';

// Each orthographic ruler belongs to one camera plane. The third coordinate
// follows the camera target so switching views preserves a meaningful location.
const DEPTH_AXIS = { top: 'y', front: 'z', side: 'x' };
const DEPTH_INDEX = { top: 1, front: 2, side: 0 };

export function rulerPointFromClient( camera, target, mode, rect, clientX, clientY ) {

	const axis = DEPTH_AXIS[ mode ];
	if ( ! camera || ! target || ! axis || ! rect.width || ! rect.height ) return null;
	const ndc = new Vector2(
		( ( clientX - rect.left ) / rect.width ) * 2 - 1,
		1 - ( ( clientY - rect.top ) / rect.height ) * 2
	);
	const raycaster = new Raycaster();
	raycaster.setFromCamera( ndc, camera );
	const direction = raycaster.ray.direction[ axis ];
	if ( Math.abs( direction ) < 1e-9 ) return null;
	const distance = ( target[ axis ] - raycaster.ray.origin[ axis ] ) / direction;
	return raycaster.ray.at( distance, new Vector3() ).toArray();

}

export function constrainRulerPoint( start, end, mode, shiftHeld ) {

	if ( ! shiftHeld ) return end;
	const axes = mode === 'top' ? [ 0, 2 ] : mode === 'front' ? [ 0, 1 ] : [ 2, 1 ];
	const next = [ ...end ];
	next[ DEPTH_INDEX[ mode ] ] = start[ DEPTH_INDEX[ mode ] ];
	const [ first, second ] = axes;
	if ( Math.abs( end[ first ] - start[ first ] ) >= Math.abs( end[ second ] - start[ second ] ) ) next[ second ] = start[ second ];
	else next[ first ] = start[ first ];
	return next;

}

export function rulerLength( start, end ) {

	return new Vector3().fromArray( start ).distanceTo( new Vector3().fromArray( end ) );

}

export function rulerScreenPoint( camera, point, width, height ) {

	const projected = new Vector3().fromArray( point ).project( camera );
	return { x: ( projected.x + 1 ) * width / 2, y: ( 1 - projected.y ) * height / 2 };

}
