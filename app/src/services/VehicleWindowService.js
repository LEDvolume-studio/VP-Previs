import { getApp } from '@/lib/appProxy';
import { useStore } from '@/store';

function windowMeshes( root ) {

	const meshes = [];
	root?.traverse( node => {

		if ( node.isMesh && node.material?.userData?.rayzeeVehicleWindowGlass ) meshes.push( node );

	} );
	return meshes;

}

export function vehicleWindowState( root ) {

	return windowMeshes( root ).map( mesh => ( { name: mesh.name, opacity: mesh.material.opacity, transparent: mesh.material.transparent } ) );

}

export function vehicleWindowTransparency( root ) {

	const states = vehicleWindowState( root );
	return states.length ? Math.round( 100 * ( 1 - states.reduce( ( sum, state ) => sum + state.opacity, 0 ) / states.length ) ) : null;

}

export function restoreVehicleWindowState( root, states ) {

	const app = getApp();
	if ( ! app || app._loadingInProgress || useStore.getState().loading.isLoading ) throw new Error( 'Wait for the current scene update to finish.' );
	const meshes = windowMeshes( root );
	if ( ! meshes.length ) throw new Error( 'Re-add the SUV to use its separate window material.' );
	const ordered = meshes.map( mesh => states.find( state => state.name === mesh.name ) );
	if ( states.length !== meshes.length || ordered.some( state => ! state || ! Number.isFinite( state.opacity ) || state.opacity < 0 || state.opacity > 1 || typeof state.transparent !== 'boolean' ) ) throw new Error( 'The saved window state is invalid.' );
	if ( meshes.some( mesh => ! app.sceneMeshes.includes( mesh ) || ! Number.isInteger( mesh.userData.materialIndex ) ) ) throw new Error( 'The vehicle is not ready in the renderer.' );
	const before = vehicleWindowState( root );
	const apply = values => {

		const uploaded = new Set();
		meshes.forEach( ( mesh, index ) => {

			const material = mesh.material;
			const state = values[ index ];
			if ( material.transparent !== state.transparent ) material.needsUpdate = true;
			material.opacity = state.opacity;
			material.transparent = state.transparent;
			const materialIndex = mesh.userData.materialIndex;
			if ( uploaded.has( materialIndex ) ) return;
			app.setMaterialProperty( materialIndex, 'opacity', state.opacity );
			app.setMaterialProperty( materialIndex, 'transparent', Number( state.transparent ) );
			uploaded.add( materialIndex );

		} );

	};

	try {

		apply( ordered );

	} catch ( error ) {

		apply( before );
		throw error;

	}

	app.dispatchEvent( { type: 'VehicleWindowChanged', id: root.uuid } );

}

export function setVehicleWindowTransparency( root, percent ) {

	if ( ! Number.isFinite( percent ) || percent < 0 || percent > 100 ) throw new Error( 'Window transparency must be between 0 and 100.' );
	restoreVehicleWindowState( root, vehicleWindowState( root ).map( state => ( { ...state, opacity: 1 - percent / 100, transparent: true } ) ) );

}
