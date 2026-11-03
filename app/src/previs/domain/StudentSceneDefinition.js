import { assetVersionKey, baseSceneVersionKey, createStudentProjectDocument, validateStudentProjectDocument } from './StudentProjectSchema.js';

export const MAX_STUDENT_MODEL_BYTES = 64 * 1024 * 1024;
export const MAX_STUDENT_SCENE_BYTES = 128 * 1024 * 1024;
export const MAX_STUDENT_SCENE_NODES = 8192;
const fail = message => {

	throw new Error( `Student scene definition: ${message}` );

};

const shape = ( value, fields ) => {

	if ( ! value || ! [ Object.prototype, null ].includes( Object.getPrototypeOf( value ) ) || Object.keys( value ).length !== fields.length || ! fields.every( key => Object.hasOwn( value, key ) ) ) fail( 'Unexpected record fields.' );

};

const id = value => {

	if ( typeof value !== 'string' || ! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test( value ) ) fail( 'Invalid immutable identifier.' );

};

const reference = value => {

	shape( value, [ 'assetId', 'version' ] ); id( value.assetId ); id( value.version );

};

/** Portable capabilities and exact glTF mappings; runtime source locations never belong here. */
export function validateStudentSceneDefinition( definition, assets ) {

	shape( definition, [ 'format', 'schemaVersion', 'baseScene', 'models', 'humanPoseRoots' ] );
	if ( definition.format !== 'rayzee-student-scene' || definition.schemaVersion !== 1 ) fail( 'Unsupported scene format/version.' );
	const document = createStudentProjectDocument( { projectId: 'scene-definition-validation' } );
	document.assets = assets;
	document.baseScenes = { [ baseSceneVersionKey( definition.baseScene || {} ) ]: definition.baseScene };
	validateStudentProjectDocument( document );
	if ( ! Array.isArray( definition.models ) || ! definition.models.length || definition.models.length > 64 ) fail( 'A bounded nonempty model inventory is required.' );
	const baseKeys = definition.baseScene.assets.map( assetVersionKey );
	const modelKeys = new Set();
	const instances = new Set(), roots = new Set();
	let total = 0;
	for ( const model of definition.models ) {

		shape( model, [ 'asset', 'nodes' ] ); reference( model.asset );
		const key = assetVersionKey( model.asset ), asset = assets[ key ];
		if ( ! baseKeys.includes( key ) || modelKeys.has( key ) ) fail( 'Models must exactly cover the base-scene assets.' );
		modelKeys.add( key );
		if ( asset?.kind !== 'model' || asset.mimeType !== 'model/gltf-binary' || asset.byteLength > MAX_STUDENT_MODEL_BYTES ) fail( 'Only bounded binary model assets are supported.' );
		total += asset.byteLength;
		if ( total > MAX_STUDENT_SCENE_BYTES ) fail( 'Scene exceeds the supported memory limit.' );
		if ( ! Array.isArray( model.nodes ) || ! model.nodes.length || model.nodes.length > MAX_STUDENT_SCENE_NODES ) fail( 'Complete bounded node mappings are required.' );
		const nodeIds = new Set(), indices = new Set();
		let rootCount = 0;
		for ( const node of model.nodes ) {

			shape( node, [ 'instanceId', 'nodeId', 'gltfNodeIndex', 'expectedName' ] );
			id( node.instanceId ); id( node.nodeId );
			if ( instances.has( node.instanceId ) || nodeIds.has( node.nodeId ) ) fail( 'Node IDs must map uniquely within each immutable model and scene instance.' );
			instances.add( node.instanceId ); nodeIds.add( node.nodeId );
			if ( instances.size > MAX_STUDENT_SCENE_NODES ) fail( 'Scene node inventory exceeds the supported limit.' );
			if ( node.gltfNodeIndex === null ) {

				if ( node.expectedName !== null ) fail( 'Scene roots require a null index and name.' );
				roots.add( node.instanceId ); rootCount ++;

			} else {

				if ( ! Number.isSafeInteger( node.gltfNodeIndex ) || node.gltfNodeIndex < 0 || node.gltfNodeIndex >= MAX_STUDENT_SCENE_NODES || indices.has( node.gltfNodeIndex ) ) fail( 'Invalid or duplicate glTF node index.' );
				if ( typeof node.expectedName !== 'string' || node.expectedName.length > 1024 ) fail( 'Invalid expected glTF node name.' );
				indices.add( node.gltfNodeIndex );

			}

		}

		if ( rootCount !== 1 ) fail( 'Exactly one scene root mapping is required per model.' );

	}

	if ( modelKeys.size !== baseKeys.length ) fail( 'Models must exactly cover the base-scene assets.' );
	if ( ! Array.isArray( definition.humanPoseRoots ) || definition.humanPoseRoots.length > definition.models.length || new Set( definition.humanPoseRoots ).size !== definition.humanPoseRoots.length || definition.humanPoseRoots.some( value => ! roots.has( value ) ) ) fail( 'Human pose roots must be unique mapped model roots.' );
	return definition;

}

/** Additional rendering capability checks after the portable preset schema validates. */
export function validateSupportedPresetScene( preset ) {

	validateStudentSceneDefinition( preset.sceneDefinition, preset.assets );
	const definition = preset.sceneDefinition;
	if ( JSON.stringify( definition.baseScene ) !== JSON.stringify( preset.baseScene ) ) {

		const a = definition.baseScene, b = preset.baseScene;
		if ( ! b || a.sceneId !== b.sceneId || a.version !== b.version || JSON.stringify( a.assets.map( assetVersionKey ).sort() ) !== JSON.stringify( b.assets.map( assetVersionKey ).sort() ) ) fail( 'Preset and scene definition must pin the same base scene.' );

	}

	const mapped = new Map( definition.models.flatMap( model => model.nodes.map( node => [ node.instanceId, { ...node, asset: model.asset } ] ) ) );
	const snapshot = preset.snapshot;
	if ( ! snapshot?.rasterAppearance ) fail( 'Supported presets require explicit raster appearance.' );
	if ( snapshot.camera?.projection?.type !== 'perspective' || snapshot.camera?.renderProjection?.type !== 'perspective' ) fail( 'Only perspective raster cameras are supported.' );
	if ( ! snapshot.nodes || Object.keys( snapshot.nodes ).length !== mapped.size ) fail( 'Snapshot must cover the complete mapped node inventory.' );
	const humans = new Set( definition.humanPoseRoots );
	for ( const [ instanceId, node ] of Object.entries( snapshot.nodes ) ) {

		const mapping = mapped.get( instanceId );
		if ( ! mapping || node.nodeId !== mapping.nodeId || assetVersionKey( node.asset || {} ) !== assetVersionKey( mapping.asset ) ) fail( 'Snapshot node mapping differs from the immutable scene.' );
		if ( Object.keys( node.doorAngles || {} ).length ) fail( 'Door hinge transforms are authoritative; scalar door angles are unsupported.' );
		if ( humans.has( instanceId ) ? ! [ 'standing', 'sitting' ].includes( node.humanPose ) : node.humanPose !== null ) fail( 'Human poses require an explicitly supported model root.' );

	}

	if ( snapshot.lights.length > 64 ) fail( 'Light inventory exceeds the supported limit.' );
	const displays = new Set();
	for ( const wall of snapshot.ledWalls ) {

		if ( wall.presentationVersion !== 1 || ! mapped.has( wall.nodeInstanceId ) || mapped.get( wall.nodeInstanceId ).gltfNodeIndex === null || displays.has( wall.nodeInstanceId ) ) fail( 'LED walls require distinct explicitly mapped display nodes.' );
		displays.add( wall.nodeInstanceId );

	}

	if ( snapshot.environment.rotation[ 0 ] !== 0 || snapshot.environment.rotation[ 2 ] !== 0 ) fail( 'This scene capability supports Y rotation only.' );
	return preset;

}
