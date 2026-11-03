import { Color } from 'three';
import { validateProjectDocument } from '../../services/projects/ProjectSchema.js';
import { assetVersionKey, baseSceneVersionKey, createStudentProjectDocument, validateStudentProjectDocument } from '../domain/StudentProjectSchema.js';
import { classifyRasterRenderSetting } from './RasterAppearance.js';

const preparedScenes = new WeakMap();
const clone = value => structuredClone( value );
const entries = value => Object.entries( value || {} );
const equal = ( left, right ) => {

	if ( left === right ) return true;
	if ( ! left || ! right || typeof left !== 'object' || typeof right !== 'object' ) return false;
	const keys = Object.keys( left );
	return keys.length === Object.keys( right ).length && keys.every( key => Object.hasOwn( right, key ) && equal( left[ key ], right[ key ] ) );

};

const transform = state => ( { position: clone( state.position ), quaternion: clone( state.quaternion ), scale: clone( state.scale ), visible: state.visible } );
const radians = degrees => degrees * Math.PI / 180;

/** Verify the exact immutable bytes before exposing a local scene-preparation token.
 * This is a local integrity receipt, not server-side catalogue authorization.
 * The loader owns resolution, memory limits, decoders and eventual resource cleanup.
 */
export async function prepareStudentSceneConversion( { assets, baseScene }, loadAssetBytes ) {

	if ( typeof loadAssetBytes !== 'function' ) throw new Error( 'A versioned asset byte loader is required.' );
	const document = createStudentProjectDocument( { projectId: 'conversion-validation' } );
	const preparedBaseScene = clone( baseScene );
	const sceneKey = baseSceneVersionKey( preparedBaseScene );
	document.assets = clone( assets );
	document.baseScenes = { [ sceneKey ]: preparedBaseScene };
	validateStudentProjectDocument( document );
	for ( const asset of Object.values( document.assets ) ) {

		const loaded = await loadAssetBytes( Object.freeze( clone( asset ) ) );
		const bytes = loaded instanceof Uint8Array ? loaded : loaded instanceof ArrayBuffer ? new Uint8Array( loaded ) : null;
		if ( ! bytes || bytes.byteLength !== asset.byteLength ) throw new Error( 'Scene asset bytes do not match the immutable manifest size.' );
		const digest = new Uint8Array( await globalThis.crypto.subtle.digest( 'SHA-256', bytes ) );
		const hash = Array.from( digest, value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
		if ( hash !== asset.sha256 ) throw new Error( 'Scene asset bytes do not match the immutable manifest hash.' );

	}

	const token = Object.freeze( {} );
	preparedScenes.set( token, { assets: document.assets, baseScene: document.baseScenes[ sceneKey ] } );
	return token;

}

/** Capture prepared live ports without inventing missing admin JSON defaults.
 * The host must suspend edits, controls and transport around the whole operation.
 * This helper only reads; it never pauses/resumes the shared admin engine.
 */
export async function capturePreparedAdminScene( { source, ports } ) {

	const sourceProjectId = source.projectId;
	const sourceRevision = source.revision;
	const binding = ports.scene.getBindings();
	if ( ! binding?.ready || ! Array.isArray( binding.nodes ) ) throw new Error( 'A ready immutable scene binding is required for capture.' );
	const transforms = await ports.scene.read( binding );
	const poses = await ports.pose.read( binding );
	const nodes = {};
	for ( const node of binding.nodes ) {

		if ( ! Object.hasOwn( transforms, node.instanceId ) || ! Object.hasOwn( poses, node.instanceId ) || Object.hasOwn( nodes, node.instanceId ) ) throw new Error( 'Complete unique mapped node and pose captures are required.' );
		nodes[ node.instanceId ] = { asset: clone( node.asset ), nodeId: node.nodeId, transform: clone( transforms[ node.instanceId ] ), humanPose: poses[ node.instanceId ].humanPose, doorAngles: clone( poses[ node.instanceId ].doorAngles ) };

	}

	if ( Object.keys( transforms ).length !== binding.nodes.length || Object.keys( poses ).length !== binding.nodes.length ) throw new Error( 'Unmapped scene or pose nodes cannot be omitted from capture.' );
	const camera = await ports.camera.read( binding );
	const lights = await ports.lights.read( binding );
	const environment = await ports.environment.read( binding );
	const ledWalls = await ports.media.read( binding );
	const rasterAppearance = ports.rasterAppearance ? await ports.rasterAppearance.read( binding ) : undefined;
	if ( ports.scene.getBindings() !== binding || source.projectId !== sourceProjectId || source.revision !== sourceRevision ) throw new Error( 'The admin revision or scene binding changed during capture.' );
	return clone( { sourceProjectId, sourceRevision, snapshot: { camera, nodes, lights, environment, ledWalls, ...( rasterAppearance ? { rasterAppearance } : {} ) } } );

}

/** Convert one detached admin capture into one validated portable preset shot.
 * Saved admin JSON omits camera/light state; capture must come from prepared
 * complete shot ports, after the same admin revision has finished hydrating.
 * All source paths/UUIDs are conversion inputs only, never portable identity.
 */
export function convertAdminProjectToStudentPreset( {
	source, preparedScene, mapping, capture, preset, projectId, shotId, now,
} ) {

	const diagnostics = [];
	const error = ( code, path, message ) => diagnostics.push( { severity: 'error', code, path, message } );
	const info = ( code, path, message ) => diagnostics.push( { severity: 'info', code, path, message } );
	const reject = () => ( { ok: false, document: null, diagnostics } );
	try {

		validateProjectDocument( source );
		if ( ! Array.isArray( source.scene.lights ) || ! source.scene.nodes || typeof source.scene.nodes !== 'object' || Array.isArray( source.scene.nodes ) || source.scene.units?.length !== 'metre' || source.scene.units.metresPerUnit !== 1 ) throw new Error( 'Complete metre scene inventory required.' );

	} catch {

		error( 'INVALID_ADMIN_PROJECT', 'source', 'A supported metre-based Rayzee admin project is required.' );
		return reject();

	}

	const scene = preparedScenes.get( preparedScene );
	if ( ! scene ) error( 'UNVERIFIED_SCENE', 'preparedScene', 'Prepare the immutable manifest against exact asset bytes first.' );
	if ( ! mapping || ! capture ) error( 'MISSING_CAPTURE', 'capture', 'Complete detached shot capture and explicit source mappings are required.' );
	if ( diagnostics.length ) return reject();
	if ( capture.sourceProjectId !== source.projectId || capture.sourceRevision !== source.revision ) error( 'STALE_CAPTURE', 'capture', 'The capture must identify this exact admin project revision.' );
	let document;
	let snapshot;
	try {

		snapshot = clone( capture.snapshot );
		document = createStudentProjectDocument( { projectId, name: preset.name, now } );
		document.assets = clone( scene.assets );
		document.baseScenes = { [ baseSceneVersionKey( scene.baseScene ) ]: clone( scene.baseScene ) };
		document.shots[ shotId ] = { shotId, name: preset.name, baseScene: { sceneId: scene.baseScene.sceneId, version: scene.baseScene.version }, sourcePreset: { presetId: preset.presetId, version: preset.version }, snapshot };
		validateStudentProjectDocument( document );

	} catch {

		error( 'INVALID_STUDENT_CAPTURE', 'capture.snapshot', 'Complete schema-valid captured state, immutable references and preset identity are required.' );
		return reject();

	}

	const unknown = ( value, allowed, path ) => {

		for ( const key of Object.keys( value || {} ) ) if ( ! allowed.includes( key ) ) error( 'UNSUPPORTED_FIELD', `${path}.${key}`, 'This authored field has no supported student conversion.' );

	};

	unknown( source, [ 'format', 'schemaVersion', 'projectId', 'name', 'createdAt', 'updatedAt', 'revision', 'scene', 'render', 'cameras', 'led', 'animation', 'workspace', 'extensions', 'lastOpenedAt', 'exportedAt', 'importedFromProjectId' ], 'source' );
	unknown( source.scene, [ 'units', 'assets', 'nodes', 'materials', 'lights', 'environment' ], 'scene' );
	if ( entries( source.extensions ).length ) error( 'UNSUPPORTED_EXTENSIONS', 'extensions', 'Admin extensions require a dedicated converter.' );
	const usedAssets = new Set();
	for ( const asset of source.scene.assets ) {

		const mapped = mapping.assets?.[ asset.instanceId ];
		if ( ! mapped?.asset || mapped.catalogId !== asset.catalogId || mapped.assetVersion !== asset.assetVersion || ! scene.assets[ assetVersionKey( mapped.asset ) ] || scene.assets[ assetVersionKey( mapped.asset ) ].kind !== 'model' ) error( 'UNMAPPED_ASSET', 'scene.assets', 'Every admin instance needs an exact catalogue version and verified model mapping.' );
		else usedAssets.add( asset.instanceId );

	}

	for ( const key of Object.keys( mapping.assets || {} ) ) if ( ! usedAssets.has( key ) ) error( 'EXTRA_ASSET_MAPPING', 'mapping.assets', 'The mapping contains an absent or unsupported source asset.' );
	const mappedNodeIds = new Set();
	for ( const [ sourceKey, state ] of entries( source.scene.nodes ) ) {

		if ( ! state || typeof state !== 'object' ) {

			error( 'INVALID_SOURCE_NODE', 'scene.nodes', 'Saved node transforms must be complete records.' );
			continue;

		}

		const mapped = mapping.nodes?.[ sourceKey ];
		const sourceAsset = source.scene.assets.find( asset => sourceKey.startsWith( `${asset.instanceId}:` ) );
		const target = mapped && snapshot.nodes[ mapped.instanceId ];
		unknown( state, [ 'name', 'position', 'quaternion', 'scale', 'visible', 'pose' ], `scene.nodes.${sourceKey}` );
		if ( ! mapped || ! target || ! sourceAsset || ! equal( target.asset, mapping.assets?.[ sourceAsset.instanceId ]?.asset ) || ! equal( target.asset, mapped.asset ) || target.nodeId !== mapped.nodeId || mappedNodeIds.has( mapped.instanceId ) ) {

			error( 'UNMAPPED_NODE', `scene.nodes.${sourceKey}`, 'Every saved node needs a unique explicit immutable node mapping and captured counterpart.' );
			continue;

		}

		mappedNodeIds.add( mapped.instanceId );
		if ( ! equal( target.transform, transform( state ) ) || target.humanPose !== ( state.pose ?? null ) ) error( 'NODE_CAPTURE_MISMATCH', `scene.nodes.${sourceKey}`, 'Captured local transforms and human poses must match the saved admin revision exactly.' );
		if ( entries( target.doorAngles ).length ) error( 'UNSUPPORTED_DOOR_ANGLES', 'capture.snapshot.nodes', 'Saved hinge quaternions are preserved as mapped nodes; scalar door-angle reconstruction needs a rig-specific converter.' );

	}

	if ( mappedNodeIds.size !== Object.keys( snapshot.nodes ).length || Object.keys( mapping.nodes || {} ).length !== Object.keys( source.scene.nodes ).length ) error( 'NODE_INVENTORY_MISMATCH', 'mapping.nodes', 'Node mappings and capture must exactly cover the saved hierarchy.' );
	// A baseline may acknowledge only materials already baked into the verified
	// model bytes. Edited materials still require new immutable model publication.
	if ( ! equal( source.scene.materials || {}, mapping.bakedMaterials || {} ) ) error( 'UNSUPPORTED_MATERIAL_OVERRIDE', 'scene.materials', 'Materials differ from the explicit baked-model baseline; publish new model bytes or add a material converter.' );
	const camera = source.cameras?.active;
	if ( ! camera ) error( 'MISSING_ADMIN_CAMERA', 'cameras.active', 'The saved admin project has no active camera.' );
	else {

		unknown( source.cameras, [ 'activeIndex', 'active', 'cameras', 'autoFocusMode', 'afScreenPoint', 'afSmoothingFactor', 'ui' ], 'cameras' );
		unknown( camera, [ 'name', 'position', 'quaternion', 'fov', 'near', 'far', 'clipStart', 'isUserCamera', 'orbitTarget', 'effects' ], 'cameras.active' );
		const pairs = [[ camera.position, snapshot.camera.transform.position ], [ camera.quaternion, snapshot.camera.transform.quaternion ], [ camera.orbitTarget, snapshot.camera.target ]];
		for ( const field of [ 'fov', 'near', 'far', 'clipStart' ] ) if ( camera[ field ] !== undefined ) pairs.push( [ camera[ field ], snapshot.camera.projection[ field ] ] );
		for ( const [ field, value ] of entries( camera.effects ) ) {

			if ( field === 'afScreenPoint' ) pairs.push( [[ value.x, value.y ], snapshot.camera.lens.afScreenPoint ] );
			else if ( Object.hasOwn( snapshot.camera.lens, field ) ) pairs.push( [ value, snapshot.camera.lens[ field ] ] );
			else error( 'UNSUPPORTED_CAMERA_EFFECT', 'cameras.active.effects', 'An active camera effect has no student representation.' );

		}

		for ( const field of [ 'autoFocusMode', 'afSmoothingFactor' ] ) if ( source.cameras[ field ] !== undefined ) pairs.push( [ source.cameras[ field ], snapshot.camera.lens[ field ] ] );
		if ( source.cameras.afScreenPoint ) pairs.push( [[ source.cameras.afScreenPoint.x, source.cameras.afScreenPoint.y ], snapshot.camera.lens.afScreenPoint ] );
		for ( const [ field, value ] of entries( source.cameras.ui ) ) {

			if ( [ 'cameraNames', 'selectedCameraIndex', 'activePreset', 'zoomToCursor', 'dollyZoom', 'sensorPreset' ].includes( field ) ) continue;
			if ( field === 'fov' ) pairs.push( [ value, snapshot.camera.projection.fov ] );
			else if ( field === 'frameOverlayRatio' ) pairs.push( [ value, snapshot.camera.frameOverlayRatio ] );
			else if ( field === 'afScreenPoint' ) pairs.push( [[ value?.x, value?.y ], snapshot.camera.lens.afScreenPoint ] );
			else if ( Object.hasOwn( snapshot.camera.lens, field ) ) pairs.push( [ value, snapshot.camera.lens[ field ] ] );
			else error( 'UNSUPPORTED_CAMERA_UI', `cameras.ui.${field}`, 'Unknown camera metadata requires a supported conversion.' );

		}

		if ( pairs.some( ( [ left, right ] ) => ! equal( left, right ) ) ) error( 'CAMERA_CAPTURE_MISMATCH', 'capture.snapshot.camera', 'The complete camera capture disagrees with the saved active camera.' );

	}

	const lightTypes = { AmbientLight: 'ambient', DirectionalLight: 'directional', PointLight: 'point', SpotLight: 'spot', RectAreaLight: 'rectArea', HemisphereLight: 'hemisphere' };
	const capturedLightIds = new Set();
	for ( const descriptor of source.scene.lights || [] ) {

		const lightId = mapping.lights?.[ descriptor.uuid ];
		const light = snapshot.lights.find( value => value.lightId === lightId );
		unknown( descriptor, [ 'uuid', 'name', 'type', 'visible', 'intensity', 'color', 'position', 'angle', 'temperature', 'useTemperature', 'exposure', 'radius', 'target', 'distance', 'penumbra', 'decay', 'width', 'height', 'normalize', 'spread', 'shape' ], 'scene.lights' );
		if ( ! light || light.type !== lightTypes[ descriptor.type ] || capturedLightIds.has( lightId ) ) {

			error( 'UNMAPPED_LIGHT', 'scene.lights', 'Every canonical source light needs a unique complete captured light with the same type.' );
			continue;

		}

		capturedLightIds.add( lightId );
		const pairs = [[ descriptor.position, light.transform.position ], [ descriptor.visible, light.transform.visible ], [ descriptor.intensity, light.intensity ]];
		for ( const field of [ 'temperature', 'useTemperature', 'exposure' ] ) if ( descriptor[ field ] !== undefined ) pairs.push( [ descriptor[ field ], light.emission[ field ] ] );
		for ( const field of Object.keys( light.parameters ) ) if ( descriptor[ field ] !== undefined ) pairs.push( [ [ 'angle', 'spread' ].includes( field ) ? radians( descriptor[ field ] ) : descriptor[ field ], light.parameters[ field ] ] );
		// Descriptors quantize to an sRGB hex value. Compare in that same space;
		// keep full captured linear RGB rather than reconstructing from the hex.
		if ( ! /^#[a-f\d]{6}$/i.test( descriptor.color ) || `#${new Color().fromArray( light.color ).getHexString()}`.toLowerCase() !== descriptor.color.toLowerCase() ) error( 'LIGHT_CAPTURE_MISMATCH', 'capture.snapshot.lights', 'Captured light colour disagrees with the saved descriptor.' );
		if ( descriptor.target !== undefined && ! equal( descriptor.target, light.target ) ) error( 'LIGHT_TARGET_REQUIRES_LIVE_CAPTURE', 'capture.snapshot.lights', 'Saved local/derived light targets disagree with the captured world-space target.' );
		if ( pairs.some( ( [ left, right ] ) => ! equal( left, right ) ) ) error( 'LIGHT_CAPTURE_MISMATCH', 'capture.snapshot.lights', 'Captured light emission, placement or parameters disagree with the saved descriptor.' );

	}

	if ( capturedLightIds.size !== snapshot.lights.length || Object.keys( mapping.lights || {} ).length !== source.scene.lights.length ) error( 'LIGHT_INVENTORY_MISMATCH', 'mapping.lights', 'Light mappings and capture must exactly cover the saved light inventory.' );
	const environment = mapping.environments?.[ source.scene.environment?.catalogId ];
	const explicitNoEnvironment = source.scene.environment?.catalogId === null && snapshot.environment.asset === null && entries( mapping.environments ).length === 0;
	if ( ! explicitNoEnvironment && ( ! environment || ! equal( environment, snapshot.environment.asset ) || ! scene.assets[ assetVersionKey( environment ) ] || scene.assets[ assetVersionKey( environment ) ].kind !== 'environment' ) ) error( 'UNMAPPED_ENVIRONMENT', 'scene.environment', 'The source HDRI requires an exact verified immutable environment version, or an explicit null source and capture without environment mappings.' );
	unknown( source.scene.environment, [ 'catalogId' ], 'scene.environment' );
	const capturedWallIds = new Set();
	for ( const saved of source.led ) {

		unknown( saved, [ 'wallInstanceId', 'brightnessNits', 'loop', 'placement', 'video' ], 'led' );
		unknown( saved.placement, [ 'position', 'scale', 'rotationDegrees', 'aspectRatioLocked', 'fitMode' ], 'led.placement' );
		unknown( saved.placement?.position, [ 'x', 'y' ], 'led.placement.position' );
		unknown( saved.placement?.scale, [ 'x', 'y' ], 'led.placement.scale' );
		const mapped = mapping.ledWalls?.[ saved.wallInstanceId ];
		const wall = snapshot.ledWalls.find( item => item.wallId === mapped?.wallId );
		const sourceAsset = source.scene.assets.find( item => item.instanceId === saved.wallInstanceId );
		const node = mapped && snapshot.nodes[ mapped.nodeInstanceId ];
		const sourceNodeMapped = mapped && entries( mapping.nodes ).some( ( [ key, value ] ) => key.startsWith( `${saved.wallInstanceId}:` ) && value.instanceId === mapped.nodeInstanceId );
		if ( ! mapped || ! wall || wall.presentationVersion !== 1 || ! sourceAsset || ! node || ! sourceNodeMapped || ! equal( node.asset, mapping.assets?.[ sourceAsset.instanceId ]?.asset ) || capturedWallIds.has( wall.wallId ) ) {

			error( 'UNMAPPED_LED_WALL', 'led', 'Every source wall needs a unique immutable model-node mapping and a complete versioned presentation capture.' );
			continue;

		}

		capturedWallIds.add( wall.wallId );
		let media = null;
		let inPointUs = 0;
		if ( saved.video !== null ) {

			unknown( saved.video, [ 'assetId', 'name', 'type', 'size', 'lastModified', 'currentTime' ], 'led.video' );
			const identity = Object.fromEntries( entries( saved.video ).filter( ( [ key ] ) => key !== 'currentTime' ) );
			media = mapped.media;
			const manifest = media && scene.assets[ assetVersionKey( media ) ];
			if ( ! saved.video || ! equal( identity, mapped.sourceVideo ) || ! manifest || manifest.kind !== 'video' || saved.video.size !== manifest.byteLength || saved.video.type !== manifest.mimeType || ! Number.isFinite( saved.video.currentTime ) || saved.video.currentTime < 0 ) {

				error( 'UNVERIFIED_LED_MEDIA', 'led.video', 'An explicit exact source-video identity must map to verified immutable video bytes of the same size and MIME type.' );
				continue;

			}

			inPointUs = Math.round( saved.video.currentTime * 1000000 );

		} else if ( mapped.media !== null || mapped.sourceVideo !== null || mapped.mode !== 'freeze' ) {

			error( 'LED_CAPTURE_MISMATCH', 'led', 'A saved blank display must retain null media and freeze at zero.' );
			continue;

		}

		const expected = {
			wallId: mapped.wallId, presentationVersion: 1, nodeInstanceId: mapped.nodeInstanceId,
			media, mode: mapped.mode, inPointUs, loop: saved.loop, playbackRate: mapped.playbackRate,
			brightnessNits: saved.brightnessNits,
			placement: { position: [ saved.placement?.position?.x, saved.placement?.position?.y ], scale: [ saved.placement?.scale?.x, saved.placement?.scale?.y ], rotationDegrees: saved.placement?.rotationDegrees, aspectRatioLocked: saved.placement?.aspectRatioLocked, fitMode: saved.placement?.fitMode },
			surface: mapped.surface,
		};
		if ( ! equal( wall, expected ) ) error( 'LED_CAPTURE_MISMATCH', 'capture.snapshot.ledWalls', 'Captured LED nits, source time, playback policy, placement, UV surface or immutable node/media mapping disagrees with the saved revision and explicit preparation.' );

	}

	if ( capturedWallIds.size !== snapshot.ledWalls.length || Object.keys( mapping.ledWalls || {} ).length !== source.led.length ) error( 'LED_INVENTORY_MISMATCH', 'mapping.ledWalls', 'LED mappings and capture must exactly cover the saved wall inventory, including blank displays.' );
	const supportedEngine = {
		exposure: snapshot.camera.exposure, cameraProjection: snapshot.camera.renderProjection.type, fov: snapshot.camera.projection.fov,
		panoramaLonRange: snapshot.camera.renderProjection.panoramaLonRange, panoramaLatRange: snapshot.camera.renderProjection.panoramaLatRange, panoramaLevelHorizon: snapshot.camera.renderProjection.panoramaLevelHorizon,
		environmentIntensity: snapshot.environment.intensity, environmentRotation: snapshot.environment.rotation[ 1 ] * 180 / Math.PI, showBackground: snapshot.environment.background,
		enableEnvironment: true, backgroundBlurriness: 0, groundProjectionEnabled: false, enableGroundCatcher: false, transparentBackground: false, saturation: 1, autoExposure: false,
		...Object.fromEntries( entries( snapshot.camera.lens ).filter( ( [ key ] ) => ! [ 'afScreenPoint', 'sensorWidth', 'sensorHeight' ].includes( key ) ) ),
		...( snapshot.rasterAppearance ? Object.fromEntries( entries( snapshot.rasterAppearance ).filter( ( [ key ] ) => ! [ 'version', 'postProcessing', 'outputColorSpace' ].includes( key ) ) ) : {} ),
	};
	for ( const [ scope, values ] of entries( source.render ) ) {

		if ( ! [ 'engine', 'ui' ].includes( scope ) ) {

			error( 'UNSUPPORTED_RENDER_STATE', `render.${scope}`, 'Unknown render state requires an explicit converter.' );
			continue;

		}

		for ( const [ key, value ] of entries( values ) ) {

			if ( [ 'enablePathTracer', 'pathTracerActive' ].includes( key ) && value === false ) continue;
			if ( key === 'environmentMode' && value === 'hdri' ) continue;
			// Saved UI defaults can lag the actual engine/camera values. Only an
			// explicit same-key engine value supersedes a UI copy; an unknown UI
			// field remains unsupported rather than silently disappearing.
			if ( snapshot.rasterAppearance ) {

				const classification = classifyRasterRenderSetting( key );
				if ( classification === 'path-only' || classification === 'runtime-only' ) {

					info( classification === 'path-only' ? 'PATH_SETTING_OMITTED' : 'RUNTIME_SETTING_OMITTED', `render.${scope}.${key}`, 'This explicitly classified setting does not alter the fixed admin raster output.' );
					continue;

				}

				if ( classification === 'inactive-hdri-input' && source.render.engine?.environmentMode !== 'procedural' && source.render.ui?.environmentMode === 'hdri' ) continue;
				if ( classification === 'inactive-ground-input' && source.render.engine?.groundProjectionEnabled === false && source.render.engine?.enableGroundCatcher === false ) continue;
				if ( scope === 'ui' && Object.hasOwn( source.render.engine || {}, key ) && Object.hasOwn( supportedEngine, key ) ) continue;
				if ( scope === 'ui' && ( ( key === 'fov' && camera?.fov !== undefined ) || Object.hasOwn( camera?.effects || {}, key ) || Object.hasOwn( source.cameras?.ui || {}, key ) || ( [ 'autoFocusMode', 'afScreenPoint', 'afSmoothingFactor' ].includes( key ) && Object.hasOwn( source.cameras || {}, key ) ) ) ) continue;

			}

			if ( Object.hasOwn( supportedEngine, key ) && equal( value, supportedEngine[ key ] ) ) continue;
			error( 'UNSUPPORTED_RENDER_STATE', `render.${scope}.${key}`, 'This render setting is unsupported or disagrees with complete captured student state.' );

		}

	}

	info( 'ADMIN_WORKSPACE_OMITTED', 'workspace', 'Admin selection, panels, camera list and animation transport are not fixed-shot content.' );
	info( 'CAPTURE_REQUIRED', 'capture', 'Camera projection/scale and light rotation retain full live capture precision; saved admin descriptors alone are insufficient.' );
	if ( diagnostics.some( item => item.severity === 'error' ) ) return reject();
	return { ok: true, document, diagnostics };

}
