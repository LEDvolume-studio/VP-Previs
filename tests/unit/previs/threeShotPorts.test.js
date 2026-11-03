import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmbientLight, DirectionalLight, Group, HemisphereLight, OrthographicCamera, PerspectiveCamera, PointLight, RectAreaLight, Scene, SpotLight, Vector3 } from 'three';
import { CameraManager } from '../../../rayzee/src/managers/CameraManager.js';
import { LightManager } from '../../../rayzee/src/managers/LightManager.js';
import { EngineEvents } from '../../../rayzee/src/EngineEvents.js';
import { RenderSettings } from '../../../rayzee/src/RenderSettings.js';
import { createThreeShotPorts } from '../../../app/src/previs/engine/ThreeShotPorts.js';
import { ShotSceneAdapter } from '../../../app/src/previs/engine/ShotSceneAdapter.js';
import { RealtimeRenderer } from '../../../rayzee/src/managers/RealtimeRenderer.js';
import { createRasterAppearancePort } from '../../../app/src/previs/engine/RasterAppearance.js';
import { studentFixture } from './studentFixtures.js';

const LIGHTS = { ambient: AmbientLight, directional: DirectionalLight, point: PointLight, spot: SpotLight, rectArea: RectAreaLight, hemisphere: HemisphereLight };
const appearance = () => ( { version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb', enableEnvironment: true, showBackground: true, transparentBackground: false, backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#000000' } );
afterEach( () => vi.unstubAllGlobals() );
const clone = value => structuredClone( value );
const service = initial => {

	let state = clone( initial );
	return {
		validate: vi.fn(), read: vi.fn( () => clone( state ) ), capture: vi.fn( () => clone( state ) ),
		apply: vi.fn( value => state = clone( value ) ), restore: vi.fn( value => state = clone( value ) ),
	};

};

async function viewport( document = studentFixture(), options = {} ) {

	const shot = document.shots.shotA;
	const sceneRoot = new Scene();
	const nodeObjects = new Map( Object.keys( shot.snapshot.nodes ).map( id => {

		const object = new Group();
		sceneRoot.add( object );
		return [ id, object ];

	} ) );
	const lightScene = new Scene();
	const targetParent = new Group();
	targetParent.position.set( 3, 1, - 2 );
	lightScene.add( targetParent );
	const lightObjects = new Map( shot.snapshot.lights.map( value => {

		const light = new LIGHTS[ value.type ]();
		lightScene.add( light );
		if ( light.target ) targetParent.add( light.target );
		return [ value.lightId, light ];

	} ) );
	const projection = shot.snapshot.camera.projection;
	const camera = projection.type === 'perspective' ? new PerspectiveCamera() : new OrthographicCamera();
	const cameraManager = Object.assign( Object.create( CameraManager.prototype ), {
		camera, controls: { target: new Vector3(), update: vi.fn() },
		autoFocusMode: 'manual', afScreenPoint: { x: 0.5, y: 0.5 }, afSmoothingFactor: 0.15,
	} );
	const settings = new RenderSettings();
	const settingsChanged = vi.fn();
	settings.addEventListener( EngineEvents.SETTING_CHANGED, settingsChanged );
	const onLightChange = vi.fn();
	const lightManager = new LightManager( lightScene, { visible: false }, null, { onChange: onLightChange } );
	const updateNodes = vi.fn();
	const onCameraChanged = vi.fn();
	let recording = true;
	const withoutRecording = vi.fn( async operation => {

		const previous = recording;
		recording = false;
		try {

			return await operation();

		} finally {

			recording = previous;

		}

	} );
	const binding = {
		ready: true, baseScene: clone( shot.baseScene ), assets: Object.values( document.assets ),
		nodes: Object.entries( shot.snapshot.nodes ).map( ( [ instanceId, node ] ) => ( { instanceId, asset: node.asset, nodeId: node.nodeId } ) ),
		lights: shot.snapshot.lights.map( ( { lightId, type } ) => ( { lightId, type } ) ), ledWalls: shot.snapshot.ledWalls.map( ( { wallId } ) => ( { wallId } ) ),
	};
	const pose = service( Object.fromEntries( Object.entries( shot.snapshot.nodes ).map( ( [ id, node ] ) => [ id, { humanPose: node.humanPose, doorAngles: node.doorAngles } ] ) ) );
	// The concrete pose service must translate node records to its pose-only read form.
	pose.apply.mockImplementation( value => pose.restore( Object.fromEntries( Object.entries( value ).map( ( [ id, node ] ) => [ id, { humanPose: node.humanPose, doorAngles: node.doorAngles } ] ) ) ) );
	const environment = service( shot.snapshot.environment );
	const media = service( shot.snapshot.ledWalls );
	let appearanceHost;
	if ( options.withRasterAppearance ) {

		// Actual post stack/settings, replacing only SMAA's image transport.
		vi.stubGlobal( 'Image', class {} );
		const renderer = { toneMapping: 4, toneMappingExposure: 1, outputColorSpace: 'srgb', shadowMap: {}, domElement: { width: 100, height: 100 } };
		settings.bind( { renderer, stages: {}, resetCallback: vi.fn() } );
		const realtimeRenderer = new RealtimeRenderer( { settings, renderer, scene: sceneRoot, lightScene, camera } );
		appearanceHost = { settings, renderer, realtimeRenderer };

	}

	const args = { binding, sceneRoot, nodeObjects, lightObjects, cameraManager, settings, cameraMetadata: { sensorWidth: 36, sensorHeight: 20.25, frameOverlayRatio: '16:9' }, lightManager, updateNodes, onCameraChanged, withoutRecording, pose, environment, media, ...( appearanceHost ? { rasterAppearance: createRasterAppearancePort( appearanceHost ) } : {} ), ...options };
	const ports = createThreeShotPorts( args );
	const adapter = new ShotSceneAdapter( ports );
	await adapter.applyShot( document, 'shotA' );
	vi.clearAllMocks();
	return { document, binding, args, ports, adapter, camera, cameraManager, settings, settingsChanged, sceneRoot, nodeObjects, lightObjects, lightManager, targetParent, updateNodes, onCameraChanged, onLightChange, withoutRecording, pose, environment, media, appearanceHost, recording: () => recording };

}

function expectNumbersClose( actual, expected ) {

	expect( actual.length ).toBe( expected.length );
	actual.forEach( ( value, index ) => expect( value ).toBeCloseTo( expected[ index ], 10 ) );

}

describe( 'concrete Three.js shot ports', () => {

	it( 'round trips explicit raster appearance through native RenderSettings and the existing post stack without mutating captures', async () => {

		const document = studentFixture();
		for ( const shot of Object.values( document.shots ) ) shot.snapshot.rasterAppearance = appearance();
		Object.assign( document.shots.shotB.snapshot.rasterAppearance, { toneMapping: 6, enableEnvironment: false, showBackground: false, transparentBackground: true, backgroundIntensity: 0.4, backgroundBlurriness: 0.7, backgroundColor: '#336699' } );
		document.shots.shotB.snapshot.environment.background = false;
		const view = await viewport( document, { withRasterAppearance: true } );
		const beforeSettings = view.settings.getAll();
		const beforeMatrix = view.nodeObjects.get( 'carInstance' ).matrixWorld.toArray();
		const a = await view.adapter.captureShot( document, 'shotA' );
		expect( view.settings.getAll() ).toEqual( beforeSettings );
		expect( view.nodeObjects.get( 'carInstance' ).matrixWorld.toArray() ).toEqual( beforeMatrix );
		expect( view.updateNodes ).not.toHaveBeenCalled();
		expect( view.settingsChanged ).not.toHaveBeenCalled();
		a.snapshot.rasterAppearance.backgroundIntensity = 100;
		expect( view.settings.get( 'backgroundIntensity' ) ).toBe( 1 );
		await view.adapter.applyShot( document, 'shotB' );
		expect( ( await view.adapter.captureShot( document, 'shotB' ) ).snapshot.rasterAppearance ).toEqual( document.shots.shotB.snapshot.rasterAppearance );
		expect( view.appearanceHost.renderer.toneMapping ).toBe( 6 );
		expect( view.settings.get( 'backgroundBlurriness' ) ).toBe( 0.7 );
		expect( view.sceneRoot.background ).toBeNull();
		await view.adapter.applyShot( document, 'shotA' );
		expect( ( await view.adapter.captureShot( document, 'shotA' ) ).snapshot.rasterAppearance ).toEqual( appearance() );
		expect( view.appearanceHost.renderer.toneMapping ).toBe( 4 );
		expect( view.recording() ).toBe( true );

	} );

	it( 'restores real raster appearance/settings when downstream media fails after appearance was applied', async () => {

		const document = studentFixture();
		for ( const shot of Object.values( document.shots ) ) shot.snapshot.rasterAppearance = appearance();
		Object.assign( document.shots.shotB.snapshot.rasterAppearance, { toneMapping: 6, backgroundIntensity: 0.2, backgroundBlurriness: 0.6, backgroundColor: '#ff0000' } );
		const view = await viewport( document, { withRasterAppearance: true } );
		const before = await view.adapter.captureShot( document, 'shotA' );
		view.media.apply.mockImplementationOnce( () => {

			expect( view.settings.get( 'backgroundIntensity' ) ).toBe( 0.2 );
			expect( view.appearanceHost.renderer.toneMapping ).toBe( 6 );
			throw new Error( 'decode failed after appearance' );

		} );
		await expect( view.adapter.applyShot( document, 'shotB' ) ).rejects.toThrow( /decode failed after appearance/ );
		expect( await view.adapter.captureShot( document, 'shotA' ) ).toEqual( before );
		expect( view.appearanceHost.renderer.toneMapping ).toBe( 4 );
		expect( view.settings.get( 'backgroundIntensity' ) ).toBe( 1 );
		expect( view.recording() ).toBe( true );

	} );

	it( 'round trips real Three camera/model/canonical light objects A → B → A', async () => {

		const view = await viewport();
		view.onLightChange.mockImplementation( () => expect( view.recording() ).toBe( false ) );
		view.updateNodes.mockImplementation( () => expect( view.recording() ).toBe( false ) );
		view.onCameraChanged.mockImplementation( () => expect( view.recording() ).toBe( false ) );
		const a = await view.adapter.captureShot( view.document, 'shotA' );
		const originalMatrix = view.nodeObjects.get( 'carInstance' ).matrixWorld.toArray();
		const b = view.document.shots.shotB.snapshot;
		b.nodes.carInstance.transform = { position: [ 4, 5, - 6 ], quaternion: [ 0, 0, 1, 0 ], scale: [ 2, 3, 4 ], visible: false };
		b.nodes.carInstance.humanPose = 'sitting';
		b.nodes.carInstance.doorAngles.leftFront = 1.1;
		b.camera.transform.position = [ 3, 4, 9 ];
		b.camera.transform.quaternion = [ 0, 1, 0, 0 ];
		b.camera.transform.scale = [ - 1, 1, 1 ];
		b.camera.target = [ 7, 2, - 3 ];
		b.camera.projection = { ...b.camera.projection, fov: 35, aspect: 1.9, near: 0.2, far: 300, zoom: 1.3, filmGauge: 24, filmOffset: 2, clipStart: 0.4 };
		b.camera.lens = { ...b.camera.lens, sensorWidth: 24, sensorHeight: 13.5, focalLength: 80, focusDistance: 9, aperture: 5.6, apertureScale: 2, anamorphicRatio: 1.5, dofMode: 'look', dofBlur: 0.2, unitsPerMetre: 2, autoFocusMode: 'auto', afScreenPoint: [ 0.3, 0.7 ], afSmoothingFactor: 0.8, enableDOF: false };
		b.camera.exposure = 2;
		b.camera.frameOverlayRatio = '2.40:1';
		b.lights[ 0 ] = { ...b.lights[ 0 ], transform: clone( b.nodes.carInstance.transform ), target: [ - 2, 3, 6 ], intensity: 7, color: [ 0.2, 0.7, 0.9 ], emission: { temperature: 3200, useTemperature: true, exposure: 2 }, parameters: { distance: 30, decay: 1.5, radius: 0.2, angle: 0.3, penumbra: 0.6 } };
		await view.adapter.applyShot( view.document, 'shotB' );
		expect( ( await view.adapter.captureShot( view.document, 'shotB' ) ).snapshot ).toEqual( { ...b, camera: { ...b.camera, projection: { ...b.camera.projection, aspect: 16 / 9 } } } );
		expect( view.cameraManager.camera.aspect ).toBe( 16 / 9 );
		expect( b.camera.projection.aspect ).toBe( 1.9 );
		expect( view.lightObjects.get( 'key' ).target.getWorldPosition( new Vector3() ).toArray() ).toEqual( [ - 2, 3, 6 ] );
		expect( view.cameraManager.controls.update ).not.toHaveBeenCalled();
		expect( view.nodeObjects.get( 'carInstance' ).matrixWorld.toArray() ).not.toEqual( originalMatrix );
		await view.adapter.applyShot( view.document, 'shotA' );
		expect( await view.adapter.captureShot( view.document, 'shotA' ) ).toEqual( a );
		expectNumbersClose( view.nodeObjects.get( 'carInstance' ).matrixWorld.toArray(), originalMatrix );
		expect( view.updateNodes ).toHaveBeenCalledTimes( 2 );
		expect( view.onLightChange ).toHaveBeenCalledTimes( 2 );
		expect( view.settingsChanged ).not.toHaveBeenCalled();
		expect( view.recording() ).toBe( true );
		expect( view.withoutRecording ).toHaveBeenCalled();

	} );
	it( 'restores real Three transforms/settings after a downstream media write fails', async () => {

		const view = await viewport();
		const before = await view.adapter.captureShot( view.document, 'shotA' );
		view.document.shots.shotB.snapshot.camera.projection.fov = 22;
		view.document.shots.shotB.snapshot.nodes.carInstance.transform.position = [ 7, 8, 9 ];
		view.media.apply.mockRejectedValueOnce( new Error( 'decode failed' ) );
		await expect( view.adapter.applyShot( view.document, 'shotB' ) ).rejects.toThrow( /decode failed/ );
		expect( await view.adapter.captureShot( view.document, 'shotA' ) ).toEqual( before );
		expect( view.recording() ).toBe( true );

	} );
	it.each( [
		[ 'orthographic mismatch', view => view.document.shots.shotB.snapshot.camera.projection = { type: 'orthographic', near: 0.01, far: 100, zoom: 1, clipStart: 0, left: - 2, right: 2, bottom: - 1, top: 1 }, /different ready camera/ ],
		[ 'panorama raster mode', view => view.document.shots.shotB.snapshot.camera.renderProjection.type = 'equirectangular', /unsupported/ ],
		[ 'gobo profile', view => view.lightObjects.get( 'key' ).userData.gobo = { name: 'profile' }, /unsupported gobo/ ],
		[ 'IES profile', view => view.lightObjects.get( 'key' ).userData.ies = { name: 'profile' }, /unsupported gobo/ ],
		[ 'unmapped canonical light', view => view.lightManager.scene.add( new PointLight() ), /unmapped canonical/ ],
		[ 'removed node', view => view.nodeObjects.get( 'carInstance' ).removeFromParent(), /missing from/ ],
		[ 'manual node world matrix', view => view.nodeObjects.get( 'carInstance' ).matrixWorldAutoUpdate = false, /manually owned/ ],
		[ 'singular target parent', view => view.targetParent.scale.x = 0, /singular parent/ ],
		[ 'unsupported current panorama', view => view.settings.set( 'cameraProjection', 'equirectangular' ), /current render projection/ ],
		[ 'camera view offset', view => view.camera.setViewOffset( 1920, 1080, 0, 0, 960, 1080 ), /view offsets/ ],
	] )( 'rejects %s before any subsystem write', async ( _, change, error ) => {

		const view = await viewport();
		change( view );
		await expect( view.adapter.applyShot( view.document, 'shotB' ) ).rejects.toThrow( error );
		expect( view.updateNodes ).not.toHaveBeenCalled();
		expect( view.onCameraChanged ).not.toHaveBeenCalled();
		expect( view.media.apply ).not.toHaveBeenCalled();

	} );
	it( 'preflights required injected pose/media/environment services before writes', async () => {

		const view = await viewport();
		view.pose.validate.mockImplementationOnce( () => {

			throw new Error( 'pose mapping missing' );

		} );
		await expect( view.adapter.applyShot( view.document, 'shotB' ) ).rejects.toThrow( /pose mapping missing/ );
		expect( view.updateNodes ).not.toHaveBeenCalled();
		expect( () => createThreeShotPorts( { ...view.args, media: undefined } ) ).toThrow( /media.read/ );
		expect( () => createThreeShotPorts( { ...view.args, updateNodes: undefined } ) ).toThrow( /updateNodes/ );

	} );
	it( 'round trips orthographic camera bounds without replacing its ready object', async () => {

		const document = studentFixture();
		for ( const shot of Object.values( document.shots ) ) shot.snapshot.camera.projection = { type: 'orthographic', near: 0.2, far: 100, zoom: 2, clipStart: 0.3, left: - 3, right: 3, bottom: - 2, top: 2 };
		const view = await viewport( document );
		const initial = view.camera;
		document.shots.shotB.snapshot.camera.projection.left = - 5;
		await view.adapter.applyShot( document, 'shotB' );
		expect( view.camera.left ).toBe( - 5 );
		await view.adapter.applyShot( document, 'shotA' );
		expect( view.camera ).toBe( initial );
		expect( ( await view.adapter.captureShot( document, 'shotA' ) ).snapshot.camera.projection ).toEqual( document.shots.shotA.snapshot.camera.projection );

	} );
	it.each( [
		[ 'ambient', {} ], [ 'directional', { angle: 0.02 } ],
		[ 'point', { distance: 30, decay: 2, radius: 0.4 } ],
		[ 'rectArea', { width: 2, height: 3, normalize: true, spread: Math.PI, shape: 'ellipse' } ],
		[ 'hemisphere', { groundColor: [ 0.2, 0.3, 0.4 ] } ],
	] )( 'captures %s canonical properties in native radians/linear RGB', async ( type, parameters ) => {

		const document = studentFixture();
		for ( const shot of Object.values( document.shots ) ) {

			const light = shot.snapshot.lights[ 0 ];
			Object.assign( light, { type, parameters: clone( parameters ), target: type === 'rectArea' ? [ 0, 0, 1 ] : type === 'directional' ? [ 0, 1, 0 ] : [ 0, 0, 0 ] } );

		}

		const view = await viewport( document );
		expect( ( await view.adapter.captureShot( document, 'shotA' ) ).snapshot.lights ).toEqual( document.shots.shotA.snapshot.lights );

	} );
	it( 'rejects assigning a single runtime object to multiple stable IDs', async () => {

		const view = await viewport();
		const other = { ...view.binding.nodes[ 0 ], instanceId: 'other' };
		const binding = { ...view.binding, nodes: [ ...view.binding.nodes, other ] };
		const nodeObjects = new Map( [ ...view.nodeObjects, [ 'other', view.nodeObjects.get( 'carInstance' ) ]] );
		expect( () => createThreeShotPorts( { ...view.args, binding, nodeObjects } ) ).toThrow( /multiple stable IDs/ );

	} );
	it( 'preserves area rotation/scale and rejects a contradictory derived target', async () => {

		const document = studentFixture();
		for ( const shot of Object.values( document.shots ) ) Object.assign( shot.snapshot.lights[ 0 ], { type: 'rectArea', target: [ 0, 0, 1 ], parameters: { width: 2, height: 1, normalize: false, spread: 2, shape: 'disk' } } );
		const view = await viewport( document );
		const area = document.shots.shotB.snapshot.lights[ 0 ];
		area.transform.position = [ 3, 4, 5 ];
		area.transform.quaternion = [ 0, 1, 0, 0 ];
		area.transform.scale = [ 2, 3, 4 ];
		area.target = [ 3, 4, 4 ];
		await view.adapter.applyShot( document, 'shotB' );
		expect( ( await view.adapter.captureShot( document, 'shotB' ) ).snapshot.lights[ 0 ] ).toEqual( area );
		view.updateNodes.mockClear();
		area.target = [ 3, 4, 6 ];
		await expect( view.adapter.applyShot( document, 'shotB' ) ).rejects.toThrow( /target must match/ );
		expect( view.updateNodes ).not.toHaveBeenCalled();

	} );
	it( 'allows panorama only when the host explicitly declares support', async () => {

		const view = await viewport( studentFixture(), { supportedRenderProjections: [ 'perspective', 'equirectangular' ] } );
		view.document.shots.shotB.snapshot.camera.renderProjection = { type: 'equirectangular', panoramaLonRange: [ - 90, 90 ], panoramaLatRange: [ - 45, 45 ], panoramaLevelHorizon: false };
		await view.adapter.applyShot( view.document, 'shotB' );
		expect( ( await view.adapter.captureShot( view.document, 'shotB' ) ).snapshot.camera.renderProjection ).toEqual( view.document.shots.shotB.snapshot.camera.renderProjection );

	} );

} );
