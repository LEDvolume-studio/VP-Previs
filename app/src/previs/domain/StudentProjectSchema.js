// Portable student content only. Device credentials, URLs, handles and sync state
// belong in separate repository records; admin rayzee-project files are unchanged.
import { validateStudentMaterials } from './StudentMaterialState.js';
import { validateRasterAppearance } from '../engine/RasterAppearance.js';

export const STUDENT_PROJECT_FORMAT = 'rayzee-student-project';
export const STUDENT_PROJECT_SCHEMA_VERSION = 1;
export const STUDENT_FPS = 25;
export const MAX_SEQUENCE_FRAMES = 22500;
export const STUDENT_OUTPUT = Object.freeze( { width: 1920, height: 1080, fps: STUDENT_FPS } );
export const STUDENT_WORLD_UNITS = Object.freeze( { length: 'metre', metresPerUnit: 1, up: 'Y' } );

const fail = ( path, message ) => {

	throw new Error( `${path}: ${message}` );

};

const own = ( object, key ) => Object.hasOwn( object, key );
const record = ( value, path ) => {

	if ( ! value || typeof value !== 'object' || Array.isArray( value ) || ! [ Object.prototype, null ].includes( Object.getPrototypeOf( value ) ) ) fail( path, 'expected a plain record' );

};

const shape = ( value, keys, path ) => {

	record( value, path );
	for ( const key of Object.keys( value ) ) if ( ! keys.includes( key ) ) fail( `${path}.${key}`, 'unsupported field' );
	for ( const key of keys ) if ( ! own( value, key ) ) fail( `${path}.${key}`, 'missing field' );

};

const string = ( value, path ) => {

	if ( typeof value !== 'string' || ! value.trim() || value.length > 1024 ) fail( path, 'expected a nonempty string of at most 1024 characters' );

};

const id = ( value, path ) => {

	if ( typeof value !== 'string' || ! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test( value ) ) fail( path, 'invalid stable ID' );

};

const number = ( value, path, min = - Infinity, max = Infinity ) => {

	if ( ! Number.isFinite( value ) || value < min || value > max ) fail( path, `expected a finite number in [${min}, ${max}]` );

};

const integer = ( value, path, min = 0, max = Number.MAX_SAFE_INTEGER ) => {

	if ( ! Number.isSafeInteger( value ) || value < min || value > max ) fail( path, `expected an integer in [${min}, ${max}]` );

};

const boolean = ( value, path ) => {

	if ( typeof value !== 'boolean' ) fail( path, 'expected a boolean' );

};

const choice = ( value, values, path ) => {

	if ( ! values.includes( value ) ) fail( path, `expected ${values.join( ', ' )}` );

};

const array = ( value, path ) => {

	if ( ! Array.isArray( value ) ) fail( path, 'expected an array' );

};

const vector = ( value, size, path ) => {

	array( value, path );
	if ( value.length !== size ) fail( path, `expected ${size} components` );
	value.forEach( ( component, index ) => number( component, `${path}[${index}]` ) );

};

const timestamp = ( value, path ) => {

	if ( typeof value !== 'string' || ! /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test( value ) || ! Number.isFinite( Date.parse( value ) ) || new Date( value ).toISOString() !== value ) fail( path, 'expected an ISO UTC timestamp' );

};

export const cloneStudentContent = value => structuredClone( value );
export const createStudentId = () => globalThis.crypto.randomUUID();
export const assetVersionKey = reference => `${reference.assetId}@${reference.version}`;
export const baseSceneVersionKey = reference => `${reference.sceneId}@${reference.version}`;

function assetReference( reference, assets, path, kind ) {

	shape( reference, [ 'assetId', 'version' ], path );
	id( reference.assetId, `${path}.assetId` );
	id( reference.version, `${path}.version` );
	const asset = assets[ assetVersionKey( reference ) ];
	if ( ! asset || ( kind && asset.kind !== kind ) ) fail( path, `unresolved ${kind || 'asset'} version` );
	return asset;

}

function sceneReference( reference, scenes, path ) {

	shape( reference, [ 'sceneId', 'version' ], path );
	id( reference.sceneId, `${path}.sceneId` );
	id( reference.version, `${path}.version` );
	const scene = scenes[ baseSceneVersionKey( reference ) ];
	if ( ! scene ) fail( path, 'unresolved base scene version' );
	return scene;

}

function transform( value, path ) {

	shape( value, [ 'position', 'quaternion', 'scale', 'visible' ], path );
	vector( value.position, 3, `${path}.position` );
	vector( value.quaternion, 4, `${path}.quaternion` );
	if ( Math.abs( Math.hypot( ...value.quaternion ) - 1 ) > 0.0001 ) fail( `${path}.quaternion`, 'expected a unit quaternion' );
	vector( value.scale, 3, `${path}.scale` );
	if ( value.scale.some( component => component === 0 ) ) fail( `${path}.scale`, 'zero scale is not supported' );
	boolean( value.visible, `${path}.visible` );

}

function camera( value, path ) {

	shape( value, [ 'transform', 'target', 'projection', 'renderProjection', 'lens', 'exposure', 'frameOverlayRatio' ], path );
	transform( value.transform, `${path}.transform` );
	vector( value.target, 3, `${path}.target` );
	const projection = value.projection;
	const common = [ 'type', 'near', 'far', 'zoom', 'clipStart' ];
	choice( projection?.type, [ 'perspective', 'orthographic' ], `${path}.projection.type` );
	shape( projection, common.concat( projection.type === 'perspective' ? [ 'fov', 'aspect', 'filmGauge', 'filmOffset' ] : [ 'left', 'right', 'top', 'bottom' ] ), `${path}.projection` );
	number( projection.near, `${path}.projection.near`, Number.MIN_VALUE );
	number( projection.far, `${path}.projection.far`, projection.near + Number.EPSILON );
	if ( projection.far <= projection.near ) fail( `${path}.projection.far`, 'must exceed near' );
	number( projection.zoom, `${path}.projection.zoom`, Number.MIN_VALUE );
	number( projection.clipStart, `${path}.projection.clipStart`, 0 );
	if ( projection.type === 'perspective' ) {

		number( projection.fov, `${path}.projection.fov`, Number.MIN_VALUE, 179.999 );
		number( projection.aspect, `${path}.projection.aspect`, Number.MIN_VALUE );
		number( projection.filmGauge, `${path}.projection.filmGauge`, Number.MIN_VALUE );
		number( projection.filmOffset, `${path}.projection.filmOffset` );

	} else {

		for ( const key of [ 'left', 'right', 'top', 'bottom' ] ) number( projection[ key ], `${path}.projection.${key}` );
		if ( projection.right <= projection.left || projection.top <= projection.bottom ) fail( `${path}.projection`, 'invalid orthographic bounds' );

	}

	const renderProjection = value.renderProjection;
	shape( renderProjection, [ 'type', 'panoramaLonRange', 'panoramaLatRange', 'panoramaLevelHorizon' ], `${path}.renderProjection` );
	choice( renderProjection.type, [ 'perspective', 'equirectangular' ], `${path}.renderProjection.type` );
	for ( const [ field, limit ] of [[ 'panoramaLonRange', 180 ], [ 'panoramaLatRange', 90 ]] ) {

		vector( renderProjection[ field ], 2, `${path}.renderProjection.${field}` );
		for ( const component of renderProjection[ field ] ) number( component, `${path}.renderProjection.${field}`, - limit, limit );
		if ( renderProjection[ field ][ 0 ] >= renderProjection[ field ][ 1 ] ) fail( `${path}.renderProjection.${field}`, 'range must increase' );

	}

	boolean( renderProjection.panoramaLevelHorizon, `${path}.renderProjection.panoramaLevelHorizon` );
	const lens = value.lens;
	shape( lens, [ 'focalLength', 'sensorWidth', 'sensorHeight', 'focusDistance', 'aperture', 'enableDOF', 'dofMode', 'dofBlur', 'apertureScale', 'anamorphicRatio', 'autoFocusMode', 'afScreenPoint', 'afSmoothingFactor', 'unitsPerMetre' ], `${path}.lens` );
	for ( const key of [ 'focalLength', 'sensorWidth', 'sensorHeight', 'aperture', 'apertureScale', 'anamorphicRatio', 'unitsPerMetre' ] ) number( lens[ key ], `${path}.lens.${key}`, Number.MIN_VALUE );
	number( lens.focusDistance, `${path}.lens.focusDistance`, 0 );
	number( lens.dofBlur, `${path}.lens.dofBlur`, 0 );
	number( lens.afSmoothingFactor, `${path}.lens.afSmoothingFactor`, 0, 1 );
	boolean( lens.enableDOF, `${path}.lens.enableDOF` );
	choice( lens.dofMode, [ 'legacy', 'physical', 'look' ], `${path}.lens.dofMode` );
	choice( lens.autoFocusMode, [ 'manual', 'auto' ], `${path}.lens.autoFocusMode` );
	vector( lens.afScreenPoint, 2, `${path}.lens.afScreenPoint` );
	for ( const component of lens.afScreenPoint ) number( component, `${path}.lens.afScreenPoint`, 0, 1 );
	number( value.exposure, `${path}.exposure`, 0 );
	choice( value.frameOverlayRatio, [ '16:9', '4:3', '2.40:1' ], `${path}.frameOverlayRatio` );

}

function snapshot( value, document, baseScene, path ) {

	shape( value, [ 'camera', 'nodes', 'lights', 'ledWalls', 'environment', ...( own( value, 'rasterAppearance' ) ? [ 'rasterAppearance' ] : [] ), ...( own( value, 'materials' ) ? [ 'materials' ] : [] ) ], path );
	if ( own( value, 'rasterAppearance' ) ) validateRasterAppearance( value.rasterAppearance );
	camera( value.camera, `${path}.camera` );
	record( value.nodes, `${path}.nodes` );
	for ( const [ nodeId, node ] of Object.entries( value.nodes ) ) {

		id( nodeId, `${path}.nodes key` );
		shape( node, [ 'asset', 'nodeId', 'transform', 'humanPose', 'doorAngles' ], `${path}.nodes.${nodeId}` );
		assetReference( node.asset, document.assets, `${path}.nodes.${nodeId}.asset`, 'model' );
		if ( ! baseScene.assets.some( reference => assetVersionKey( reference ) === assetVersionKey( node.asset ) ) ) fail( `${path}.nodes.${nodeId}.asset`, 'asset is outside the base scene' );
		id( node.nodeId, `${path}.nodes.${nodeId}.nodeId` );
		transform( node.transform, `${path}.nodes.${nodeId}.transform` );
		if ( node.humanPose !== null ) choice( node.humanPose, [ 'standing', 'sitting' ], `${path}.nodes.${nodeId}.humanPose` );
		record( node.doorAngles, `${path}.nodes.${nodeId}.doorAngles` );
		for ( const [ doorId, angle ] of Object.entries( node.doorAngles ) ) {

			id( doorId, `${path}.nodes.${nodeId}.doorAngles key` );
			number( angle, `${path}.nodes.${nodeId}.doorAngles.${doorId}`, - Math.PI * 2, Math.PI * 2 );

		}

	}

	if ( own( value, 'materials' ) ) validateStudentMaterials( value.materials, value.nodes );

	array( value.lights, `${path}.lights` );
	const lightIds = new Set();
	for ( const light of value.lights ) {

		shape( light, [ 'lightId', 'type', 'transform', 'target', 'color', 'intensity', 'emission', 'parameters' ], `${path}.lights` );
		id( light.lightId, `${path}.lights.lightId` );
		if ( lightIds.has( light.lightId ) ) fail( `${path}.lights`, 'duplicate light ID' );
		lightIds.add( light.lightId );
		choice( light.type, [ 'ambient', 'directional', 'point', 'spot', 'rectArea', 'hemisphere' ], `${path}.lights.type` );
		transform( light.transform, `${path}.lights.transform` );
		vector( light.target, 3, `${path}.lights.target` );
		vector( light.color, 3, `${path}.lights.color` );
		for ( const component of light.color ) number( component, `${path}.lights.color`, 0 );
		number( light.intensity, `${path}.lights.intensity`, 0 );
		shape( light.emission, [ 'temperature', 'useTemperature', 'exposure' ], `${path}.lights.emission` );
		number( light.emission.temperature, `${path}.lights.emission.temperature`, Number.MIN_VALUE );
		boolean( light.emission.useTemperature, `${path}.lights.emission.useTemperature` );
		number( light.emission.exposure, `${path}.lights.emission.exposure` );
		const fields = { ambient: [], directional: [ 'angle' ], point: [ 'distance', 'decay', 'radius' ], spot: [ 'distance', 'decay', 'radius', 'angle', 'penumbra' ], rectArea: [ 'width', 'height', 'normalize', 'spread', 'shape' ], hemisphere: [ 'groundColor' ] }[ light.type ];
		shape( light.parameters, fields, `${path}.lights.parameters` );
		for ( const field of fields ) {

			if ( field === 'groundColor' ) {

				vector( light.parameters[ field ], 3, `${path}.lights.parameters.${field}` );
				for ( const component of light.parameters[ field ] ) number( component, `${path}.lights.parameters.${field}`, 0 );

			} else if ( field === 'normalize' ) boolean( light.parameters[ field ], `${path}.lights.parameters.${field}` );
			else if ( field === 'shape' ) choice( light.parameters[ field ], [ 'square', 'rectangle', 'disk', 'ellipse' ], `${path}.lights.parameters.${field}` );
			else number( light.parameters[ field ], `${path}.lights.parameters.${field}`, [ 'width', 'height' ].includes( field ) ? Number.MIN_VALUE : 0, field === 'penumbra' ? 1 : field === 'angle' ? ( light.type === 'spot' ? Math.PI / 2 : Math.PI ) : field === 'spread' ? Math.PI : Infinity );

		}

	}

	array( value.ledWalls, `${path}.ledWalls` );
	const wallIds = new Set();
	for ( const wall of value.ledWalls ) {

		const presented = wall.presentationVersion === 1;
		shape( wall, presented ? [ 'wallId', 'presentationVersion', 'nodeInstanceId', 'media', 'mode', 'inPointUs', 'loop', 'playbackRate', 'brightnessNits', 'placement', 'surface', ...( own( wall, 'blur' ) ? [ 'blur' ] : [] ) ] : [ 'wallId', 'media', 'mode', 'inPointUs', 'loop', 'playbackRate', 'brightness', 'transform' ], `${path}.ledWalls` );
		if ( presented && own( wall, 'blur' ) ) {

			shape( wall.blur, [ 'method', 'amount' ], `${path}.ledWalls.blur` );
			choice( wall.blur.method, [ 'off', 'fast', 'gaussian', 'lens' ], `${path}.ledWalls.blur.method` );
			number( wall.blur.amount, `${path}.ledWalls.blur.amount`, 0, 40 );

		}

		id( wall.wallId, `${path}.ledWalls.wallId` );
		if ( wallIds.has( wall.wallId ) ) fail( `${path}.ledWalls`, 'duplicate wall ID' );
		wallIds.add( wall.wallId );
		const media = presented && wall.media === null ? null : assetReference( wall.media, document.assets, `${path}.ledWalls.media`, 'video' );
		choice( wall.mode, [ 'freeze', 'play' ], `${path}.ledWalls.mode` );
		integer( wall.inPointUs, `${path}.ledWalls.inPointUs`, 0, media ? media.durationUs - 1 : 0 );
		if ( ! media && wall.mode !== 'freeze' ) fail( `${path}.ledWalls.mode`, 'a blank wall must freeze at zero' );
		boolean( wall.loop, `${path}.ledWalls.loop` );
		number( wall.playbackRate, `${path}.ledWalls.playbackRate`, Number.MIN_VALUE, 16 );
		if ( presented ) {

			id( wall.nodeInstanceId, `${path}.ledWalls.nodeInstanceId` );
			if ( ! own( value.nodes, wall.nodeInstanceId ) ) fail( `${path}.ledWalls.nodeInstanceId`, 'unresolved immutable model node' );
			number( wall.brightnessNits, `${path}.ledWalls.brightnessNits`, 0 );
			shape( wall.placement, [ 'position', 'scale', 'rotationDegrees', 'aspectRatioLocked', 'fitMode' ], `${path}.ledWalls.placement` );
			vector( wall.placement.position, 2, `${path}.ledWalls.placement.position` );
			vector( wall.placement.scale, 2, `${path}.ledWalls.placement.scale` );
			for ( const component of wall.placement.scale ) number( component, `${path}.ledWalls.placement.scale`, 1e-4 );
			number( wall.placement.rotationDegrees, `${path}.ledWalls.placement.rotationDegrees` );
			boolean( wall.placement.aspectRatioLocked, `${path}.ledWalls.placement.aspectRatioLocked` );
			choice( wall.placement.fitMode, [ 'contain', 'cover', 'stretch' ], `${path}.ledWalls.placement.fitMode` );
			shape( wall.surface, [ 'nativeCanvas', 'uvChannel', 'uvBounds', 'flipU' ], `${path}.ledWalls.surface` );
			vector( wall.surface.nativeCanvas, 2, `${path}.ledWalls.surface.nativeCanvas` );
			for ( const dimension of wall.surface.nativeCanvas ) integer( dimension, `${path}.ledWalls.surface.nativeCanvas`, 1 );
			integer( wall.surface.uvChannel, `${path}.ledWalls.surface.uvChannel`, 0, 3 );
			vector( wall.surface.uvBounds, 4, `${path}.ledWalls.surface.uvBounds` );
			const [ minU, maxU, minV, maxV ] = wall.surface.uvBounds;
			if ( maxU <= minU || maxV <= minV ) fail( `${path}.ledWalls.surface.uvBounds`, 'UV bounds must have positive width and height' );
			boolean( wall.surface.flipU, `${path}.ledWalls.surface.flipU` );

		} else {

			// Unreleased legacy v1 records retain their original brightness units
			// and independent wall transform; never reinterpret them as nits.
			number( wall.brightness, `${path}.ledWalls.brightness`, 0 );
			transform( wall.transform, `${path}.ledWalls.transform` );

		}

	}

	shape( value.environment, [ 'asset', 'intensity', 'rotation', 'background' ], `${path}.environment` );
	if ( value.environment.asset !== null ) assetReference( value.environment.asset, document.assets, `${path}.environment.asset`, 'environment' );
	number( value.environment.intensity, `${path}.environment.intensity`, 0 );
	vector( value.environment.rotation, 3, `${path}.environment.rotation` );
	boolean( value.environment.background, `${path}.environment.background` );
	if ( own( value, 'rasterAppearance' ) && value.rasterAppearance.showBackground !== value.environment.background ) fail( `${path}.rasterAppearance.showBackground`, 'must match environment.background' );

}

export function createStudentProjectDocument( { name = 'Untitled sequence', projectId = createStudentId(), now = new Date().toISOString() } = {} ) {

	const document = {
		format: STUDENT_PROJECT_FORMAT, schemaVersion: STUDENT_PROJECT_SCHEMA_VERSION,
		projectId, name, createdAt: now, updatedAt: now, revision: 0,
		units: { ...STUDENT_WORLD_UNITS }, output: { ...STUDENT_OUTPUT },
		assets: {}, baseScenes: {}, shots: {}, clips: [], narration: { assets: {}, clips: [] },
	};
	validateStudentProjectDocument( document );
	return document;

}

export function validateStudentProjectDocument( document ) {

	shape( document, [ 'format', 'schemaVersion', 'projectId', 'name', 'createdAt', 'updatedAt', 'revision', 'units', 'output', 'assets', 'baseScenes', 'shots', 'clips', 'narration' ], 'project' );
	if ( document.format !== STUDENT_PROJECT_FORMAT ) fail( 'project.format', 'not a student previs document' );
	if ( document.schemaVersion !== STUDENT_PROJECT_SCHEMA_VERSION ) fail( 'project.schemaVersion', 'unsupported student schema version' );
	id( document.projectId, 'project.projectId' );
	string( document.name, 'project.name' );
	timestamp( document.createdAt, 'project.createdAt' );
	timestamp( document.updatedAt, 'project.updatedAt' );
	integer( document.revision, 'project.revision' );
	for ( const [ field, expected ] of [[ 'units', STUDENT_WORLD_UNITS ], [ 'output', STUDENT_OUTPUT ]] ) {

		shape( document[ field ], Object.keys( expected ), `project.${field}` );
		for ( const [ key, value ] of Object.entries( expected ) ) if ( document[ field ][ key ] !== value ) fail( `project.${field}.${key}`, `must be ${value}` );

	}

	record( document.assets, 'project.assets' );
	for ( const [ key, asset ] of Object.entries( document.assets ) ) {

		const path = `project.assets.${key}`;
		shape( asset, [ 'assetId', 'version', 'kind', 'sha256', 'byteLength', 'mimeType', 'durationUs' ], path );
		id( asset.assetId, `${path}.assetId` );
		id( asset.version, `${path}.version` );
		if ( key !== assetVersionKey( asset ) ) fail( path, 'manifest key must match assetId@version' );
		choice( asset.kind, [ 'model', 'environment', 'video', 'image' ], `${path}.kind` );
		if ( typeof asset.sha256 !== 'string' || ! /^[a-f0-9]{64}$/.test( asset.sha256 ) ) fail( `${path}.sha256`, 'expected lowercase SHA-256 hex' );
		integer( asset.byteLength, `${path}.byteLength`, 1 );
		string( asset.mimeType, `${path}.mimeType` );
		if ( asset.kind === 'video' ) integer( asset.durationUs, `${path}.durationUs`, 1 );
		else if ( asset.durationUs !== null ) fail( `${path}.durationUs`, 'non-video assets use null duration' );

	}

	record( document.baseScenes, 'project.baseScenes' );
	for ( const [ key, scene ] of Object.entries( document.baseScenes ) ) {

		const path = `project.baseScenes.${key}`;
		shape( scene, [ 'sceneId', 'version', 'assets' ], path );
		id( scene.sceneId, `${path}.sceneId` );
		id( scene.version, `${path}.version` );
		if ( key !== baseSceneVersionKey( scene ) ) fail( path, 'manifest key must match sceneId@version' );
		array( scene.assets, `${path}.assets` );
		const seen = new Set();
		for ( const reference of scene.assets ) {

			assetReference( reference, document.assets, `${path}.assets` );
			const assetKey = assetVersionKey( reference );
			if ( seen.has( assetKey ) ) fail( `${path}.assets`, 'duplicate asset version' );
			seen.add( assetKey );

		}

	}

	record( document.shots, 'project.shots' );
	for ( const [ key, shot ] of Object.entries( document.shots ) ) {

		const path = `project.shots.${key}`;
		shape( shot, [ 'shotId', 'name', 'baseScene', 'sourcePreset', 'snapshot' ], path );
		id( shot.shotId, `${path}.shotId` );
		if ( key !== shot.shotId ) fail( path, 'shot key must match shotId' );
		string( shot.name, `${path}.name` );
		const scene = sceneReference( shot.baseScene, document.baseScenes, `${path}.baseScene` );
		if ( shot.sourcePreset !== null ) {

			shape( shot.sourcePreset, [ 'presetId', 'version' ], `${path}.sourcePreset` );
			id( shot.sourcePreset.presetId, `${path}.sourcePreset.presetId` );
			id( shot.sourcePreset.version, `${path}.sourcePreset.version` );

		}

		snapshot( shot.snapshot, document, scene, `${path}.snapshot` );

	}

	array( document.clips, 'project.clips' );
	let totalFrames = 0;
	const clipIds = new Set();
	for ( const clip of document.clips ) {

		shape( clip, [ 'clipId', 'shotId', 'durationFrames' ], 'project.clips' );
		id( clip.clipId, 'project.clips.clipId' );
		if ( clipIds.has( clip.clipId ) ) fail( 'project.clips', 'duplicate clip ID' );
		clipIds.add( clip.clipId );
		if ( ! own( document.shots, clip.shotId ) ) fail( 'project.clips.shotId', 'unresolved shot ID' );
		integer( clip.durationFrames, 'project.clips.durationFrames', 1, MAX_SEQUENCE_FRAMES );
		totalFrames += clip.durationFrames;

	}

	if ( totalFrames > MAX_SEQUENCE_FRAMES ) fail( 'project.clips', `sequence exceeds ${MAX_SEQUENCE_FRAMES} frames` );
	shape( document.narration, [ 'assets', 'clips' ], 'project.narration' );
	record( document.narration.assets, 'project.narration.assets' );
	for ( const [ key, media ] of Object.entries( document.narration.assets ) ) {

		const path = `project.narration.assets.${key}`;
		shape( media, [ 'assetId', 'version', 'sha256', 'byteLength', 'mimeType', 'codec', 'sampleRate', 'channels', 'durationSamples', 'segments' ], path );
		id( media.assetId, `${path}.assetId` );
		id( media.version, `${path}.version` );
		if ( key !== assetVersionKey( media ) ) fail( path, 'manifest key must match assetId@version' );
		if ( typeof media.sha256 !== 'string' || ! /^[a-f0-9]{64}$/.test( media.sha256 ) ) fail( `${path}.sha256`, 'expected lowercase SHA-256 hex' );
		integer( media.byteLength, `${path}.byteLength`, 1 );
		string( media.mimeType, `${path}.mimeType` );
		string( media.codec, `${path}.codec` );
		integer( media.sampleRate, `${path}.sampleRate`, 8000, 384000 );
		integer( media.channels, `${path}.channels`, 1, 8 );
		integer( media.durationSamples, `${path}.durationSamples`, 1 );
		array( media.segments, `${path}.segments` );
		// Segment entries describe ordered bytes of one container; they do not
		// promise that individual MediaRecorder chunks are independently decodable.
		let bytes = 0;
		media.segments.forEach( ( segment, index ) => {

			shape( segment, [ 'index', 'sha256', 'byteLength' ], `${path}.segments` );
			if ( segment.index !== index ) fail( `${path}.segments`, 'segments must be contiguous and ordered from zero' );
			if ( typeof segment.sha256 !== 'string' || ! /^[a-f0-9]{64}$/.test( segment.sha256 ) ) fail( `${path}.segments.sha256`, 'expected lowercase SHA-256 hex' );
			integer( segment.byteLength, `${path}.segments.byteLength`, 1 );
			bytes += segment.byteLength;

		} );
		if ( ! media.segments.length || bytes !== media.byteLength ) fail( `${path}.segments`, 'segment byte lengths must sum to media byteLength' );

	}

	array( document.narration.clips, 'project.narration.clips' );
	const narrationIds = new Set();
	for ( const clip of document.narration.clips ) {

		const path = 'project.narration.clips';
		shape( clip, [ 'narrationClipId', 'media', 'anchor', 'offsetFrames', 'sourceStartSample', 'lengthSamples', 'gain', 'muted' ], path );
		id( clip.narrationClipId, `${path}.narrationClipId` );
		if ( narrationIds.has( clip.narrationClipId ) ) fail( path, 'duplicate narration clip ID' );
		narrationIds.add( clip.narrationClipId );
		const media = assetReference( clip.media, document.narration.assets, `${path}.media` );
		choice( clip.anchor?.type, [ 'sequence', 'clip' ], `${path}.anchor.type` );
		shape( clip.anchor, clip.anchor.type === 'clip' ? [ 'type', 'clipId' ] : [ 'type' ], `${path}.anchor` );
		// Missing placement IDs intentionally preserve orphaned recordings for
		// restore/reattach. The evaluator never plays an unresolved anchor.
		if ( clip.anchor.type === 'clip' ) id( clip.anchor.clipId, `${path}.anchor.clipId` );
		integer( clip.offsetFrames, `${path}.offsetFrames`, - MAX_SEQUENCE_FRAMES, MAX_SEQUENCE_FRAMES );
		integer( clip.sourceStartSample, `${path}.sourceStartSample` );
		integer( clip.lengthSamples, `${path}.lengthSamples`, 1 );
		if ( clip.sourceStartSample + clip.lengthSamples > media.durationSamples ) fail( path, 'narration trim exceeds media duration' );
		number( clip.gain, `${path}.gain`, 0, 16 );
		boolean( clip.muted, `${path}.muted` );

	}

	return true;

}

export function migrateStudentProjectDocument( input ) {

	// Version 1 has no predecessor. Reject future versions instead of guessing
	// or importing admin documents into the student format.
	validateStudentProjectDocument( input );
	return cloneStudentContent( input );

}

export function prepareStudentProjectExport( document ) {

	return migrateStudentProjectDocument( document );

}

export function importStudentProjectDocument( input, { projectId = createStudentId(), now = new Date().toISOString() } = {} ) {

	const imported = migrateStudentProjectDocument( input );
	Object.assign( imported, { projectId, createdAt: now, updatedAt: now, revision: 0 } );
	validateStudentProjectDocument( imported );
	return imported;

}
