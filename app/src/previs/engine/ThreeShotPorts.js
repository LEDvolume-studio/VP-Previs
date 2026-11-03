import { Matrix4, Vector3 } from 'three';
import { SENSOR_ASPECT_RATIO } from '../../utils/cameraSensor.js';

const LENS_SETTINGS = [ 'focalLength', 'focusDistance', 'aperture', 'enableDOF', 'apertureScale', 'anamorphicRatio', 'dofMode', 'dofBlur', 'unitsPerMetre' ];
const TYPE_FLAGS = { ambient: 'isAmbientLight', directional: 'isDirectionalLight', point: 'isPointLight', spot: 'isSpotLight', rectArea: 'isRectAreaLight', hemisphere: 'isHemisphereLight' };
const copy = value => structuredClone( value );
const fail = message => {

	throw new Error( `Three shot ports: ${message}` );

};

function transformOf( object ) {

	return { position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), visible: object.visible };

}

function applyTransform( object, transform ) {

	object.position.fromArray( transform.position );
	object.quaternion.fromArray( transform.quaternion );
	object.scale.fromArray( transform.scale );
	object.visible = transform.visible;
	object.updateMatrix();
	object.updateWorldMatrix( true, true );

}

function areaTarget( light, transform = transformOf( light ) ) {

	light.parent?.updateWorldMatrix( true, false );
	const matrix = new Matrix4().compose( new Vector3().fromArray( transform.position ), light.quaternion.clone().fromArray( transform.quaternion ), new Vector3().fromArray( transform.scale ) );
	if ( light.parent ) matrix.premultiply( light.parent.matrixWorld );
	return new Vector3().setFromMatrixPosition( matrix ).add( new Vector3( 0, 0, 1 ).transformDirection( matrix ) ).toArray();

}

function targetOf( light ) {

	if ( light.isSpotLight || light.isDirectionalLight ) return light.target.getWorldPosition( new Vector3() ).toArray();
	return light.isRectAreaLight ? areaTarget( light ) : [ 0, 0, 0 ];

}

function sameVector( a, b ) {

	return Array.isArray( a ) && a.length === b.length && a.every( ( value, index ) => Math.abs( value - b[ index ] ) <= 1e-6 );

}

/**
 * Concrete Three.js camera/node/canonical-light ports. No store, UUID identity,
 * asset loading or GPU allocation. Pose/environment/media services must be
 * explicitly supplied; the loader owns verified version-to-object mappings.
 */
export function createThreeShotPorts( {
	binding, sceneRoot, nodeObjects, lightObjects, cameraManager, settings,
	cameraMetadata, lightManager, updateNodes, pose, environment, media, runtime, rasterAppearance, materials,
	supportedRenderProjections = [ 'perspective' ],
	withoutRecording = operation => operation(),
	onCameraChanged = () => {},
} ) {

	if ( ! sceneRoot?.isObject3D || ! binding?.ready ) fail( 'a ready scene root and binding are required' );
	if ( ! [ 'nodes', 'lights', 'ledWalls', 'assets' ].every( key => Array.isArray( binding[ key ] ) ) ) fail( 'complete ready binding inventories are required' );
	if ( ! ( nodeObjects instanceof Map ) || ! ( lightObjects instanceof Map ) ) fail( 'stable nodeObjects/lightObjects Maps are required' );
	if ( typeof updateNodes !== 'function' ) fail( 'updateNodes callback is required to synchronize engine transforms' );
	if ( ! cameraManager?.camera?.isCamera || ! cameraManager.controls?.target?.isVector3 ) fail( 'camera manager with camera and orbit target is required' );
	for ( const method of [ 'setAutoFocusMode', 'setAFScreenPoint' ] ) if ( typeof cameraManager[ method ] !== 'function' ) fail( `cameraManager.${method} is required` );
	for ( const method of [ 'get', 'setMany' ] ) if ( typeof settings?.[ method ] !== 'function' ) fail( `settings.${method} is required` );
	if ( ! cameraMetadata || ! [ 'sensorWidth', 'sensorHeight', 'frameOverlayRatio' ].every( key => Object.hasOwn( cameraMetadata, key ) ) ) fail( 'sensor dimensions and framing overlay metadata are required' );
	if ( ! lightManager?.scene?.isObject3D || typeof lightManager.updateLights !== 'function' ) fail( 'canonical LightManager scene/updateLights is required' );
	for ( const [ name, port ] of Object.entries( { pose, environment, media, ...( rasterAppearance ? { rasterAppearance } : {} ), ...( materials ? { materials } : {} ) } ) ) for ( const method of [ 'read', 'capture', 'apply', 'restore', 'validate' ] ) if ( typeof port?.[ method ] !== 'function' ) fail( `${name}.${method} service is required` );
	if ( typeof withoutRecording !== 'function' || typeof onCameraChanged !== 'function' ) fail( 'mutation callbacks must be functions' );
	const nodes = new Map( nodeObjects );
	const lights = new Map( lightObjects );
	const camera = cameraManager.camera;
	const renderProjections = new Set( supportedRenderProjections );

	function validateObjects() {

		if ( cameraManager.camera !== camera ) fail( 'active camera was replaced; create new ports/binding' );
		if ( nodes.size !== binding.nodes.length || lights.size !== binding.lights.length ) fail( 'stable object inventory does not match binding' );
		if ( new Set( nodes.values() ).size !== nodes.size || new Set( lights.values() ).size !== lights.size ) fail( 'multiple stable IDs map to one object' );
		for ( const mapped of binding.nodes ) {

			const object = nodes.get( mapped.instanceId );
			if ( ! object?.isObject3D || object.isLight || object.isCamera || ( object !== sceneRoot && sceneRoot.getObjectById( object.id ) !== object ) ) fail( `node ${mapped.instanceId} is missing from its ready scene` );
			if ( object.matrixWorldAutoUpdate === false ) fail( `node ${mapped.instanceId} uses unsupported manually owned world matrices` );

		}

		const canonical = lightManager.scene.getObjectsByProperty( 'isLight', true );
		if ( canonical.length !== lights.size || canonical.some( light => ! [ ...lights.values() ].includes( light ) ) ) fail( 'unmapped canonical lights would leak between shots' );
		for ( const mapped of binding.lights ) {

			const light = lights.get( mapped.lightId );
			if ( ! light?.[ TYPE_FLAGS[ mapped.type ] ] || light.userData?.__rayzeeRasterLightProxy ) fail( `light ${mapped.lightId} is not its mapped canonical light type` );
			if ( light.userData?.gobo || light.userData?.ies || light.map || light.castShadow ) fail( `light ${mapped.lightId} uses unsupported gobo/IES/map/shadow settings` );
			if ( ( light.isSpotLight || light.isDirectionalLight ) && ! light.target?.isObject3D ) fail( `light ${mapped.lightId} has no target` );
			if ( light.matrixWorldAutoUpdate === false || light.target?.matrixWorldAutoUpdate === false ) fail( `light ${mapped.lightId} uses unsupported manually owned world matrices` );
			if ( light.target?.parent ) {

				light.target.parent.updateWorldMatrix( true, false );
				if ( Math.abs( light.target.parent.matrixWorld.determinant() ) < Number.EPSILON ) fail( `light ${mapped.lightId} target has a singular parent transform` );

			}

		}

	}

	function readCamera() {

		validateObjects();
		const projection = { type: camera.isPerspectiveCamera ? 'perspective' : 'orthographic', near: camera.near, far: camera.far, zoom: camera.zoom, clipStart: camera.userData.clipStart ?? 0 };
		const keys = camera.isPerspectiveCamera ? [ 'fov', 'aspect', 'filmGauge', 'filmOffset' ] : [ 'left', 'right', 'top', 'bottom' ];
		for ( const key of keys ) projection[ key ] = camera[ key ];
		if ( camera.isPerspectiveCamera ) projection.aspect = SENSOR_ASPECT_RATIO;
		return {
			transform: transformOf( camera ), target: cameraManager.controls.target.toArray(), projection,
			renderProjection: { type: settings.get( 'cameraProjection' ), panoramaLonRange: copy( settings.get( 'panoramaLonRange' ) ), panoramaLatRange: copy( settings.get( 'panoramaLatRange' ) ), panoramaLevelHorizon: settings.get( 'panoramaLevelHorizon' ) },
			lens: {
				...Object.fromEntries( LENS_SETTINGS.map( key => [ key, settings.get( key ) ] ) ),
				sensorWidth: cameraMetadata.sensorWidth, sensorHeight: cameraMetadata.sensorHeight,
				autoFocusMode: cameraManager.autoFocusMode, afScreenPoint: [ cameraManager.afScreenPoint.x, cameraManager.afScreenPoint.y ], afSmoothingFactor: cameraManager.afSmoothingFactor,
			},
			exposure: settings.get( 'exposure' ), frameOverlayRatio: cameraMetadata.frameOverlayRatio,
		};

	}

	function validateCamera( value ) {

		validateObjects();
		if ( ! camera.isPerspectiveCamera && ! camera.isOrthographicCamera ) fail( 'only perspective and orthographic Three cameras are supported' );
		if ( value.projection.type !== ( camera.isPerspectiveCamera ? 'perspective' : 'orthographic' ) ) fail( 'shot projection requires a different ready camera type' );
		if ( ! renderProjections.has( value.renderProjection.type ) ) fail( `render projection ${value.renderProjection.type} is unsupported by this viewport` );
		if ( ! renderProjections.has( settings.get( 'cameraProjection' ) ) ) fail( 'current render projection is unsupported; cannot guarantee rollback' );
		if ( camera.view?.enabled ) fail( 'camera view offsets are unsupported in the student format' );
		if ( camera.matrixWorldAutoUpdate === false ) fail( 'camera uses unsupported manually owned world matrices' );

	}

	function applyCamera( value ) {

		validateCamera( value );
		return withoutRecording( async () => {

			const updates = Object.fromEntries( LENS_SETTINGS.map( key => [ key, value.lens[ key ] ] ) );
			Object.assign( updates, { exposure: value.exposure, cameraProjection: value.renderProjection.type, panoramaLonRange: copy( value.renderProjection.panoramaLonRange ), panoramaLatRange: copy( value.renderProjection.panoramaLatRange ), panoramaLevelHorizon: value.renderProjection.panoramaLevelHorizon } );
			settings.setMany( updates, { silent: true, reset: false } );
			for ( const [ key, component ] of Object.entries( value.projection ) ) if ( ! [ 'type', 'clipStart' ].includes( key ) ) camera[ key ] = component;
			if ( camera.isPerspectiveCamera ) camera.aspect = SENSOR_ASPECT_RATIO;
			camera.userData.clipStart = value.projection.clipStart;
			camera.updateProjectionMatrix();
			// Settings/controls may derive FOV or rotation; authored values win.
			applyTransform( camera, value.transform );
			cameraManager.controls.target.fromArray( value.target );
			cameraManager.setAutoFocusMode( value.lens.autoFocusMode );
			cameraManager.setAFScreenPoint( ...value.lens.afScreenPoint );
			cameraManager.afSmoothingFactor = value.lens.afSmoothingFactor;
			Object.assign( cameraMetadata, { sensorWidth: value.lens.sensorWidth, sensorHeight: value.lens.sensorHeight, frameOverlayRatio: value.frameOverlayRatio } );
			await onCameraChanged( camera );

		} );

	}

	function readLights() {

		validateObjects();
		return binding.lights.map( ( { lightId, type } ) => {

			const light = lights.get( lightId );
			const parameters = {};
			if ( light.isPointLight || light.isSpotLight ) Object.assign( parameters, { distance: light.distance, decay: light.decay, radius: light.userData.radius ?? 0 } );
			if ( light.isSpotLight ) Object.assign( parameters, { angle: light.angle, penumbra: light.penumbra } );
			if ( light.isDirectionalLight ) parameters.angle = light.userData.angle ?? 0;
			if ( light.isRectAreaLight ) Object.assign( parameters, { width: light.width, height: light.height, normalize: light.userData.normalize ?? true, spread: light.userData.spread ?? Math.PI, shape: light.userData.shape ?? 'rectangle' } );
			if ( light.isHemisphereLight ) parameters.groundColor = light.groundColor.toArray();
			return { lightId, type, transform: transformOf( light ), target: targetOf( light ), color: light.color.toArray(), intensity: light.intensity, emission: { temperature: light.userData.temperature ?? 6500, useTemperature: light.userData.useTemperature ?? false, exposure: light.userData.exposure ?? 0 }, parameters };

		} );

	}

	function validateLights( values ) {

		validateObjects();
		for ( const value of values ) {

			const light = lights.get( value.lightId );
			if ( ! light ) fail( `unknown stable light ID ${value.lightId}` );
			if ( light.isRectAreaLight && ! sameVector( value.target, areaTarget( light, value.transform ) ) ) fail( `area light ${value.lightId} target must match its authored transform direction` );
			if ( ! light.isRectAreaLight && ! light.isSpotLight && ! light.isDirectionalLight && ! sameVector( value.target, [ 0, 0, 0 ] ) ) fail( `light ${value.lightId} has no independently editable target` );

		}

	}

	function applyLights( values ) {

		validateLights( values );
		return withoutRecording( () => {

			for ( const value of values ) {

				const light = lights.get( value.lightId );
				applyTransform( light, value.transform );
				light.color.fromArray( value.color );
				light.intensity = value.intensity;
				Object.assign( light.userData, value.emission );
				for ( const [ key, component ] of Object.entries( value.parameters ) ) {

					if ( [ 'radius', 'normalize', 'spread', 'shape' ].includes( key ) || ( light.isDirectionalLight && key === 'angle' ) ) light.userData[ key ] = component;
					else if ( key === 'groundColor' ) light.groundColor.fromArray( component );
					else light[ key ] = component;

				}

				if ( light.isSpotLight || light.isDirectionalLight ) {

					const target = new Vector3().fromArray( value.target );
					light.target.parent?.updateWorldMatrix( true, false );
					if ( light.target.parent ) light.target.parent.worldToLocal( target );
					light.target.position.copy( target );
					light.target.updateMatrix();
					light.target.updateWorldMatrix( true, false );

				}

			}

			lightManager.updateLights();

		} );

	}

	const scene = {
		getBindings: () => {

			validateObjects();
			return binding;

		},
		validate: validateObjects,
		read: () => Object.fromEntries( [ ...nodes ].map( ( [ id, object ] ) => [ id, transformOf( object ) ] ) ),
		capture: () => Object.fromEntries( [ ...nodes ].map( ( [ id, object ] ) => [ id, transformOf( object ) ] ) ),
		apply: values => withoutRecording( async () => {

			for ( const [ id, node ] of Object.entries( values ) ) applyTransform( nodes.get( id ), node.transform );
			sceneRoot.updateMatrixWorld( true );
			await updateNodes( [ ...nodes.values() ] );

		} ),
		restore: values => withoutRecording( async () => {

			for ( const [ id, transform ] of Object.entries( values ) ) applyTransform( nodes.get( id ), transform );
			sceneRoot.updateMatrixWorld( true );
			await updateNodes( [ ...nodes.values() ] );

		} ),
	};
	validateObjects();
	const guarded = port => ( {
		read: ( ...args ) => port.read( ...args ),
		capture: ( ...args ) => port.capture( ...args ),
		validate: ( ...args ) => port.validate( ...args ),
		apply: ( ...args ) => withoutRecording( () => port.apply( ...args ) ),
		restore: ( ...args ) => withoutRecording( () => port.restore( ...args ) ),
	} );
	return {
		scene, pose: guarded( pose ), environment: guarded( environment ), media: guarded( media ), ...( materials ? { materials: guarded( materials ) } : {} ), ...( runtime ? { runtime } : {} ), ...( rasterAppearance ? { rasterAppearance: guarded( rasterAppearance ) } : {} ),
		camera: { read: readCamera, capture: readCamera, apply: applyCamera, restore: applyCamera, validate: validateCamera },
		lights: { read: readLights, capture: readLights, apply: applyLights, restore: applyLights, validate: validateLights },
	};

}
