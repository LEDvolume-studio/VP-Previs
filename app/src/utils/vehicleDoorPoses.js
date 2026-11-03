import { MathUtils, Quaternion, Vector3 } from 'three';

export const MID_SUV_CATALOG_ID = 'kb3d-mid-suv-v1';
export const VEHICLE_DOOR_POSES = Object.freeze( [

	{ id: 'closed', label: 'Doors closed', left: false, right: false },
	{ id: 'left-open', label: 'Left front open', left: true, right: false },
	{ id: 'right-open', label: 'Right front open', left: false, right: true },
	{ id: 'both-open', label: 'Both front open', left: true, right: true },

] );
const up = new Vector3( 0, 1, 0 );

export function vehicleDoorHinges( root ) {

	const hinges = [];
	root?.traverse( node => {

		if ( [ 'left', 'right' ].includes( node.userData?.rayzeeVehicleDoor ) ) hinges.push( node );

	} );
	return hinges.length === 2 && new Set( hinges.map( node => node.userData.rayzeeVehicleDoor ) ).size === 2 ? hinges : [];

}

function doorRotation( hinge, open ) {

	const degrees = Number( hinge.userData.rayzeeDoorOpenDegrees );
	if ( ! Number.isFinite( degrees ) ) throw new Error( 'The door hinge has no opening angle.' );
	return new Quaternion().setFromAxisAngle( up, open ? MathUtils.degToRad( degrees ) : 0 );

}

export function vehicleDoorPose( root ) {

	const hinges = vehicleDoorHinges( root );
	if ( ! hinges.length ) return null;
	return VEHICLE_DOOR_POSES.find( pose => hinges.every( hinge =>
		hinge.quaternion.angleTo( doorRotation( hinge, pose[ hinge.userData.rayzeeVehicleDoor ] ) ) < 1e-4
	) )?.id || 'custom';

}

export function vehicleDoorOpenStates( root ) {

	return Object.fromEntries( vehicleDoorHinges( root ).map( hinge => [
		hinge.userData.rayzeeVehicleDoor,
		hinge.quaternion.angleTo( doorRotation( hinge, false ) ) > 1e-4,
	] ) );

}

export function applyVehicleDoorOpen( root, side, open ) {

	const hinge = vehicleDoorHinges( root ).find( node => node.userData.rayzeeVehicleDoor === side );
	if ( ! hinge ) throw new Error( `Unknown vehicle door: ${side}` );
	hinge.quaternion.copy( doorRotation( hinge, open ) );
	hinge.updateMatrix();
	root.updateWorldMatrix( true, true );

}

export function applyVehicleDoorPose( root, id ) {

	const pose = VEHICLE_DOOR_POSES.find( item => item.id === id );
	if ( ! pose ) throw new Error( `Unknown door pose: ${id}` );
	const hinges = vehicleDoorHinges( root );
	if ( ! hinges.length ) throw new Error( 'Select a vehicle with front-door hinges.' );
	const rotations = hinges.map( hinge => doorRotation( hinge, pose[ hinge.userData.rayzeeVehicleDoor ] ) );
	hinges.forEach( ( hinge, index ) => {

		hinge.quaternion.copy( rotations[ index ] );
		hinge.updateMatrix();

	} );
	root.updateWorldMatrix( true, true );

}
