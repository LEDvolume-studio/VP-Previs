import { describe, it, expect, vi } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector3, Scene, Mesh, PlaneGeometry, MeshBasicMaterial } from 'three';
import { CameraManager } from '@/core/managers/CameraManager.js';
import { getCameraClipStart, setCameraRayClip } from '@/core/managers/cameraClip.js';
import { cameraClipPlugin } from '@/core/Processor/AssetLoader.js';

const manager = () => {

	const cm = Object.create( CameraManager.prototype );
	Object.assign( cm, {
		camera: new PerspectiveCamera( 60, 1, 0.01, 100 ),
		controls: { target: new Vector3( 0, 0, - 5 ), update: vi.fn() },
		currentCameraIndex: 0, _userCameraCounter: 0,
		afScreenPoint: { x: 0.5, y: 0.5 }, autoFocusMode: 'manual', afSmoothingFactor: 0.5,
	} );
	cm.cameras = [ cm.camera ];
	return cm;

};

describe( 'authored camera clipping', () => {

	it( 'imports camera znear without changing the default viewer clip start', () => {

		const scene = new Scene();
		const imported = new PerspectiveCamera( 60, 1, 1.1, 100 );
		scene.add( imported );
		cameraClipPlugin.afterRoot( { scenes: [ scene ] } );
		expect( imported.userData.clipStart ).toBe( 1.1 );
		expect( getCameraClipStart( new PerspectiveCamera( 60, 1, 0.5, 100 ) ) ).toBe( 0 );

	} );

	it( 'picks beyond a clipped wall and resets picking when clipping is disabled', () => {

		const camera = new PerspectiveCamera( 90, 1, 0.01, 100 );
		camera.userData.clipStart = 1.1;
		camera.updateMatrixWorld();
		const walls = [ 0.5, 3 ].map( distance => {

			const mesh = new Mesh( new PlaneGeometry( 20, 20 ), new MeshBasicMaterial() );
			mesh.position.z = - distance;
			mesh.updateMatrixWorld();
			return mesh;

		} );
		const caster = new Raycaster();
		caster.setFromCamera( { x: 0.8, y: 0 }, camera );
		setCameraRayClip( caster, camera );
		expect( caster.near ).toBeGreaterThan( 1.1 );
		expect( caster.intersectObjects( walls )[ 0 ].object ).toBe( walls[ 1 ] );
		camera.userData.clipStart = 0;
		setCameraRayClip( caster, camera );
		expect( caster.near ).toBe( 0 );
		expect( caster.intersectObjects( walls )[ 0 ].object ).toBe( walls[ 0 ] );
		walls.forEach( mesh => {

			mesh.geometry.dispose(); mesh.material.dispose();

		} );

	} );

	it( 'keeps per-camera clipping when switching and capturing a user view', () => {

		const cm = manager();
		const imported = new PerspectiveCamera( 60, 1, 1.1, 100 );
		imported.userData.clipStart = 1.1;
		cm.setCameras( [ cm.camera, imported ] );
		cm.switchCamera( 1 );
		expect( getCameraClipStart( cm.camera ) ).toBe( 1.1 );
		const index = cm.addCameraFromView( 'Imported framing' );
		expect( getCameraClipStart( cm.cameras[ index ] ) ).toBe( 1.1 );
		cm.switchCamera( 0 );
		expect( getCameraClipStart( cm.camera ) ).toBe( 0 );

	} );

	it( 'round-trips clip start through the fork project snapshot, including user views', () => {

		const original = manager();
		original.camera.userData.clipStart = 1.1;
		original.addCameraFromView();
		const snapshot = JSON.parse( JSON.stringify( original.getProjectState() ) );
		const restored = manager();
		expect( restored.restoreProjectState( snapshot ) ).toBe( true );
		expect( getCameraClipStart( restored.camera ) ).toBe( 1.1 );
		expect( getCameraClipStart( restored.cameras[ 1 ] ) ).toBe( 1.1 );
		delete snapshot.active.clipStart;
		snapshot.cameras.forEach( camera => delete camera.clipStart );
		restored.camera.userData.clipStart = 0;
		restored.restoreProjectState( snapshot );
		expect( getCameraClipStart( restored.camera ) ).toBe( 0 );

	} );

} );
