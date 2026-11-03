import { describe, it, expect, vi } from 'vitest';
import { PerspectiveCamera, Vector3, Scene, Mesh, PlaneGeometry, MeshBasicMaterial, Raycaster } from 'three';
import { RenderSettings } from '@/core/RenderSettings.js';
import { CameraManager } from '@/core/managers/CameraManager.js';
import { viewDepth } from '@/core/managers/cameraClip.js';

function manager() {

	const cm = Object.create( CameraManager.prototype );
	const values = { dofMode: 'physical', unitsPerMetre: 100, dofBlur: 0.08, focusDistance: 5, aperture: 2.8, focalLength: 50 };
	Object.assign( cm, {
		camera: new PerspectiveCamera( 90, 1, 0.01, 100 ),
		controls: { target: new Vector3( 0, 0, - 5 ), update: vi.fn() },
		currentCameraIndex: 0, _userCameraCounter: 0,
		afScreenPoint: { x: 0.9, y: 0.5 }, autoFocusMode: 'auto', afSmoothingFactor: 0.5,
		interactionManager: { raycaster: new Raycaster() },
		_getSettings: key => values[ key ], _applySettings: updates => Object.assign( values, updates ),
	} );
	cm.cameras = [ cm.camera ];
	cm.resetAutoFocus();
	return { cm, values };

}

describe( 'depth of field models', () => {

	it( 'defaults to legacy and routes physical/look without changing lens nodes', () => {

		const settings = new RenderSettings();
		expect( settings.get( 'dofMode' ) ).toBe( 'legacy' );
		const setUniform = vi.fn();
		settings.bind( { stages: { pathTracer: { setUniform } }, resetCallback: vi.fn() } );
		setUniform.mockClear();
		settings.set( 'dofMode', 'physical' );
		expect( setUniform ).toHaveBeenCalledWith( 'dofMode', 0 );
		settings.set( 'dofMode', 'look' );
		expect( setUniform ).toHaveBeenCalledWith( 'dofMode', 1 );
		settings.set( 'dofMode', 'legacy' );
		expect( setUniform ).toHaveBeenCalledWith( 'dofMode', 2 );
		settings.set( 'unitsPerMetre', 100 );
		expect( setUniform ).toHaveBeenCalledWith( 'unitsPerMetre', 100 );

	} );

	it( 'measures flat focus along the view axis, including camera transforms', () => {

		const camera = new PerspectiveCamera();
		camera.position.set( 2, 1, 0 );
		camera.updateMatrixWorld();
		expect( viewDepth( new Vector3( 6, 1, - 3 ), camera ) ).toBeCloseTo( 3 );

	} );

	it( 'uses axial autofocus in the new models and keeps radial focus for legacy', () => {

		const { cm } = manager();
		const scene = new Scene();
		const plane = new Mesh( new PlaneGeometry( 20, 20 ), new MeshBasicMaterial() );
		plane.position.z = - 3;
		scene.add( plane );
		scene.updateMatrixWorld();
		cm.camera.updateMatrixWorld();
		const setFocusDistance = vi.fn();
		const ctx = {
			meshScene: scene, assetLoader: { getSceneScale: () => 10 }, currentFocusDistance: 10,
			pathTracer: { enableDOF: { value: true }, dofMode: { value: 0 }, cameraProjection: { value: 0 } },
			setFocusDistance, hardReset: vi.fn(),
		};
		cm.updateAutoFocus( ctx );
		expect( setFocusDistance.mock.calls.at( - 1 )[ 0 ] ).toBeCloseTo( 3 );
		ctx.pathTracer.dofMode.value = 2;
		cm.resetAutoFocus();
		cm.updateAutoFocus( ctx );
		expect( setFocusDistance.mock.calls.at( - 1 )[ 0 ] ).toBeCloseTo( Math.hypot( 2.4, 3 ) );
		plane.geometry.dispose();
		plane.material.dispose();

	} );

	it( 'pauses autofocus for panorama without losing the preference', () => {

		const { cm } = manager();
		const setFocusDistance = vi.fn();
		cm.updateAutoFocus( {
			meshScene: new Scene(), pathTracer: { enableDOF: { value: true }, cameraProjection: { value: 1 } }, setFocusDistance,
		} );
		expect( cm.autoFocusMode ).toBe( 'auto' );
		expect( setFocusDistance ).not.toHaveBeenCalled();
		expect( cm._afSuspended ).toBe( true );

	} );

	it( 'round-trips the new model and units per camera and migrates older effects to legacy', () => {

		const { cm, values } = manager();
		cm.addCameraFromView( 'Centimetre lens' );
		const snapshot = JSON.parse( JSON.stringify( cm.getProjectState() ) );
		values.dofMode = 'look';
		values.unitsPerMetre = 1;
		cm.restoreProjectState( snapshot );
		expect( values ).toMatchObject( { dofMode: 'physical', unitsPerMetre: 100, dofBlur: 0.08 } );
		expect( cm.cameras[ 1 ].userData.__rayzeeEffects.dofMode ).toBe( 'physical' );
		cm._applyEffects( { focusDistance: 8, aperture: 5.6, focalLength: 75 } );
		expect( values ).toMatchObject( { dofMode: 'legacy', unitsPerMetre: 1, focusDistance: 8 } );

	} );

} );
