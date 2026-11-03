const clone = value => structuredClone( value );

// Runtime scene resources belong to the project. Presets carry only these fields.
export function captureProjectPresetState( source, camera ) {

	return {
		version: 1,
		projectId: source.projectId,
		nodes: Object.fromEntries( Object.entries( source.scene.nodes || {} ).map( ( [ key, node ] ) => [ key, {
			position: clone( node.position ), quaternion: clone( node.quaternion ), scale: clone( node.scale ), visible: node.visible !== false,
		} ] ) ),
		lights: ( source.scene.lights || [] ).map( light => ( { type: light.type, intensity: light.intensity, position: clone( light.position ), target: clone( light.target ), visible: light.visible !== false } ) ),
		camera: clone( camera ),
		...( source.extensions?.drivingPlate?.view ? { plateView: source.extensions.drivingPlate.view } : {} ),
	};

}

function entity( roots, key ) {

	const separator = key.indexOf( ':' );
	const root = roots.find( object => object.userData?.__rayzeeProjectInstanceId === key.slice( 0, separator ) );
	let node = root;
	for ( const index of key.slice( separator + 1 ).split( '/' ).slice( 1 ) ) node = node?.children?.[ Number( index ) ];
	return node;

}

// Resolve everything before writing. Never load a missing object as a side effect.
export function applyProjectPresetState( app, state, projectId ) {

	if ( state.projectId !== projectId ) throw new Error( 'This preset belongs to a different project.' );
	const scene = app.getScene?.() || app.meshScene;
	const roots = scene?.children || [];
	const nodes = Object.entries( state.nodes ).map( ( [ key, transform ] ) => {

		const object = entity( roots, key );
		if ( ! object ) throw new Error( 'An object used by this preset is no longer in this project. Update the preset from the current scene.' );
		return { object, transform };

	} );
	const lights = scene?.getObjectsByProperty?.( 'isLight', true ) || [];
	if ( state.lights.length !== lights.length || state.lights.some( ( light, index ) => light.type !== lights[ index ].type ) ) throw new Error( 'The project lights have changed. Update this preset before applying it.' );
	const movedRoots = new Set();
	for ( const { object, transform } of nodes ) {

		const differs = ( vector, values ) => vector.toArray().some( ( value, index ) => value !== values[ index ] );
		if ( differs( object.position, transform.position ) || differs( object.quaternion, transform.quaternion ) || differs( object.scale, transform.scale ) ) {

			let root = object;
			while ( root.parent && ! root.userData?.__rayzeeProjectInstanceId ) root = root.parent;
			movedRoots.add( root );

		}

		object.position.fromArray( transform.position ); object.quaternion.fromArray( transform.quaternion ); object.scale.fromArray( transform.scale );
		object.visible = transform.visible; object.updateMatrix();

	}

	scene.updateMatrixWorld?.( true );
	for ( const root of movedRoots ) app.transformManager?.applyObjectTransform?.( root );
	state.lights.forEach( ( saved, index ) => {

		const light = lights[ index ]; light.visible = saved.visible;
		if ( Number.isFinite( saved.intensity ) ) light.intensity = saved.intensity;
		if ( saved.position ) light.position.fromArray( saved.position );
		if ( saved.target && light.target ) light.target.position.fromArray( saved.target );
		else if ( saved.target && light.isRectAreaLight ) light.lookAt( ...saved.target );
		light.updateMatrixWorld( true ); light.target?.updateMatrixWorld( true );

	} );
	if ( lights.length ) app.lightManager?.updateLights?.();
	app.updateAllMeshVisibility?.();
	app.reset?.();

}

// Legacy library scenes can be adopted only if every asset is already present.
// Map catalogue occurrences to existing instance IDs; no model is ever imported.
export function adoptLegacyPresetState( record, source ) {

	const available = [ ...source.scene.assets ], mapping = new Map();
	const assets = record.adminDocument.scene.assets;
	if ( assets.length !== available.length ) return null;
	for ( const asset of assets ) {

		const index = available.findIndex( item => item.catalogId === asset.catalogId && item.assetVersion === asset.assetVersion );
		if ( index < 0 ) return null;
		mapping.set( asset.instanceId, available.splice( index, 1 )[ 0 ].instanceId );

	}

	const state = captureProjectPresetState( record.adminDocument, record.studentPreset.snapshot.camera );
	state.projectId = source.projectId;
	state.nodes = Object.fromEntries( Object.entries( state.nodes ).map( ( [ key, value ] ) => {

		const split = key.indexOf( ':' ); return [ `${mapping.get( key.slice( 0, split ) )}:${key.slice( split + 1 )}`, value ];

	} ) );
	if ( Object.keys( state.nodes ).some( key => ! source.scene.nodes[ key ] ) ) return null;
	return state;

}

// Older lightweight states omitted intensity, but their immutable editing document
// already captured it. Restore that saved value rather than using today's scene.
export function restorePresetLightIntensities( state, source ) {

	return { ...state, lights: state.lights.map( ( light, index ) => {

		const saved = source?.scene?.lights?.[ index ];
		return ! Number.isFinite( light.intensity ) && saved?.type === light.type && Number.isFinite( saved.intensity )
			? { ...light, intensity: saved.intensity } : light;

	} ) };

}
