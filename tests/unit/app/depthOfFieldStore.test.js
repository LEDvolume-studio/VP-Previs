import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraManager } from '@/core/managers/CameraManager.js';
import { setApp } from '@/lib/appProxy.js';

vi.stubGlobal( 'window', { dispatchEvent: vi.fn() } );
vi.stubGlobal( 'localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } );
const { useCameraStore } = await import( '@/store.js' );
const { ProjectSession } = await import( '@/services/projects/ProjectSession.js' );
const { LEDVideoManager } = await import( '@/services/LEDVideoManager.js' );

let app, values;
beforeEach( () => {

	useCameraStore.setState( useCameraStore.getInitialState() );
	values = { dofMode: 'legacy', focusDistance: 40, dofBlur: 0.05, unitsPerMetre: 1 };
	app = {
		isInitialized: true, assetLoader: { getSceneScale: () => 10 },
		settings: { get: key => values[ key ], set: ( key, value ) => {

			values[ key ] = value;

		}, setMany: updates => Object.assign( values, updates ) },
		cameraManager: { active: new PerspectiveCamera(), setAutoFocusMode: vi.fn(), getProjectState: () => ( { effects: { ...values } } ) },
		renderer: {},
		setCanvasSize: vi.fn(),
		reset: vi.fn(),
	};
	setApp( app );

} );
afterEach( () => {

	LEDVideoManager.detachApp();
	setApp( null );

} );
afterAll( () => vi.unstubAllGlobals() );

describe( 'DOF integration with the VP camera store', () => {

	it( 'switches display units while preserving the live focus distance', () => {

		useCameraStore.setState( { focusDistance: 4 } );
		useCameraStore.getState().handleDofModeChange( 'physical' );
		expect( useCameraStore.getState().focusDistance ).toBe( 40 );
		expect( values.focusDistance ).toBe( 40 );
		useCameraStore.getState().handleFocusDistanceChange( 5 );
		expect( values.focusDistance ).toBe( 5 );
		useCameraStore.getState().handleDofModeChange( 'legacy' );
		expect( useCameraStore.getState().focusDistance ).toBe( 0.5 );
		useCameraStore.getState().handleFocusDistanceChange( 2 );
		expect( values.focusDistance ).toBe( 20 );

	} );

	it( 'keeps sensor, focal length, focus and FOV when selecting a new-model preset', () => {

		useCameraStore.setState( { dofMode: 'look', sensorWidth: 24, sensorHeight: 13.5, fov: 42, focalLength: 75, focusDistance: 12 } );
		const before = { fov: app.cameraManager.active.fov, position: app.cameraManager.active.position.toArray() };
		useCameraStore.getState().handlePresetChange( 'portrait' );
		expect( useCameraStore.getState() ).toMatchObject( { sensorWidth: 24, sensorHeight: 13.5, fov: 42, focalLength: 75, focusDistance: 12, dofBlur: 0.1 } );
		expect( app.cameraManager.active.fov ).toBe( before.fov );
		expect( app.cameraManager.active.position.toArray() ).toEqual( before.position );
		expect( values.focusDistance ).toBe( 40 );

	} );

	it( 'captures model, blur and scale in the camera undo domain', () => {

		useCameraStore.setState( { dofMode: 'physical', dofBlur: 0.08, unitsPerMetre: 100 } );
		const snapshot = new ProjectSession( {} )._captureUndoDomain( 'camera' );
		expect( snapshot.ui ).toMatchObject( { dofMode: 'physical', dofBlur: 0.08, unitsPerMetre: 100 } );

	} );

	it( 'restores model and scale through camera undo together with the sensor state', async () => {

		const cm = Object.create( CameraManager.prototype );
		Object.assign( cm, {
			camera: app.cameraManager.active,
			controls: { target: new Vector3( 0, 0, - 5 ), update: vi.fn() },
			currentCameraIndex: 0,
			afScreenPoint: { x: 0.5, y: 0.5 }, autoFocusMode: 'manual',
			_getSettings: key => values[ key ], _applySettings: updates => Object.assign( values, updates ),
		} );
		cm.cameras = [ cm.camera ];
		app.cameraManager = cm;
		Object.assign( values, { dofMode: 'physical', unitsPerMetre: 100, aperture: 2.8, focalLength: 75, apertureScale: 1, anamorphicRatio: 1 } );
		useCameraStore.setState( { dofMode: 'physical', unitsPerMetre: 100, sensorWidth: 24, sensorHeight: 13.5 } );
		const session = new ProjectSession( {} );
		const snapshot = session._captureUndoDomain( 'camera' );
		values.dofMode = 'look';
		values.unitsPerMetre = 1;
		useCameraStore.setState( { dofMode: 'look', unitsPerMetre: 1, sensorWidth: 36 } );
		await session._restoreUndoDomain( 'camera', snapshot );
		expect( values ).toMatchObject( { dofMode: 'physical', unitsPerMetre: 100 } );
		expect( useCameraStore.getState() ).toMatchObject( { dofMode: 'physical', unitsPerMetre: 100, sensorWidth: 24, sensorHeight: 13.5 } );

	} );

	it( "opening an older project clears the previous project's lens model and scale", () => {

		values.dofMode = 'physical';
		values.unitsPerMetre = 100;
		new ProjectSession( {} ).applyRenderState( { engine: { enableDOF: true, focusDistance: 8 } } );
		expect( values ).toMatchObject( { dofMode: 'legacy', unitsPerMetre: 1, enableDOF: true, focusDistance: 8 } );

	} );

	it( 'restores legacy mode when an old camera effect has no model field', () => {

		useCameraStore.setState( { dofMode: 'look', unitsPerMetre: 100 } );
		useCameraStore.getState().applyCameraEffects( { aperture: 2.8, focusDistance: 3 } );
		expect( useCameraStore.getState() ).toMatchObject( { dofMode: 'legacy', unitsPerMetre: 1, aperture: 2.8, focusDistance: 3 } );

	} );

} );
