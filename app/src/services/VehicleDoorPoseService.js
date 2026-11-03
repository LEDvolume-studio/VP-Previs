import { getApp } from '@/lib/appProxy';
import { useStore } from '@/store';
import { applyVehicleDoorOpen, applyVehicleDoorPose, vehicleDoorHinges } from '@/utils/vehicleDoorPoses';

export function vehicleDoorState( root ) {

	return vehicleDoorHinges( root ).map( hinge => ( { name: hinge.name, quaternion: hinge.quaternion.toArray() } ) );

}

function changeDoors( root, change ) {

	const app = getApp();
	if ( ! app || app._loadingInProgress || useStore.getState().loading.isLoading ) throw new Error( 'Wait for the current scene update to finish.' );
	const hinges = vehicleDoorHinges( root );
	if ( ! hinges.length ) throw new Error( 'Select a vehicle with front-door hinges.' );
	const parts = new Set();
	hinges.forEach( hinge => hinge.traverse( node => {

		if ( node.isMesh ) parts.add( node );

	} ) );
	const indices = [];
	app.sceneMeshes.forEach( ( mesh, index ) => {

		if ( parts.has( mesh ) ) indices.push( index );

	} );
	if ( ! indices.length || indices.length !== parts.size ) throw new Error( 'The vehicle is not ready in the renderer.' );
	const previous = hinges.map( hinge => hinge.quaternion.clone() );
	try {

		change( hinges );
		// Rigid motion only: update placement matrices and TLAS bounds. Door
		// vertices, material primitives, and BLAS geometry remain untouched.
		app.updateMeshTransforms( indices );

	} catch ( error ) {

		hinges.forEach( ( hinge, index ) => {

			hinge.quaternion.copy( previous[ index ] ); hinge.updateMatrix();

		} );
		root.updateWorldMatrix( true, true );
		app.updateMeshTransforms( indices );
		throw error;

	}

	app.dispatchEvent( { type: 'VehiclePoseChanged', id: root.uuid } );

}

export function setVehicleDoorPose( root, pose ) {

	changeDoors( root, () => applyVehicleDoorPose( root, pose ) );

}

export function setVehicleDoorOpen( root, side, open ) {

	changeDoors( root, () => applyVehicleDoorOpen( root, side, open ) );

}

export function restoreVehicleDoorState( root, values ) {

	changeDoors( root, hinges => {

		if ( values.length !== hinges.length || new Set( values.map( value => value.name ) ).size !== hinges.length ) throw new Error( 'The saved door state is invalid.' );
		const ordered = hinges.map( hinge => values.find( value => value.name === hinge.name ) );
		if ( ordered.some( value => ! value || value.quaternion?.length !== 4 || ! value.quaternion.every( Number.isFinite ) ) ) throw new Error( 'The saved door state is invalid.' );
		hinges.forEach( ( hinge, index ) => {

			hinge.quaternion.fromArray( ordered[ index ].quaternion );
			hinge.updateMatrix();

		} );
		root.updateWorldMatrix( true, true );

	} );

}
