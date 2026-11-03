import { describe, expect, it, vi } from 'vitest';
import { EventDispatcher, PerspectiveCamera, Vector3 } from 'three';
import { createShotCameraNavigation } from '../../../app/src/student/ShotCameraNavigation.js';

async function flush() {

	for ( let index = 0; index < 10; index ++ ) await Promise.resolve();

}

function fixture( options = {} ) {

	const camera = new PerspectiveCamera();
	const controls = Object.assign( new EventDispatcher(), { enabled: false, target: new Vector3() } );
	const manager = {
		camera, controls, navigationActive: false,
		update: vi.fn(),
		_handleNavigationBlur: vi.fn( () => {

			manager.navigationActive = false;

		} ),
	};
	const frames = new Map();
	let nextFrame = 0;
	const paint = vi.fn( async () => {} ), onStart = vi.fn(), onChange = vi.fn(), onError = vi.fn();
	const navigation = createShotCameraNavigation( {
		cameraManager: manager, paint, onStart, onChange, onError,
		capture: () => ( { position: camera.position.toArray(), target: controls.target.toArray() } ),
		requestFrame: callback => {

			frames.set( ++ nextFrame, callback ); return nextFrame;

		},
		cancelFrame: handle => frames.delete( handle ),
		...options,
	} );
	const step = async time => {

		const [ id, callback ] = frames.entries().next().value || [];
		if ( callback ) {

			frames.delete( id ); callback( time );

		}

		await flush();

	};

	return { navigation, manager, camera, controls, paint, onStart, onChange, onError, frames, step };

}

describe( 'Rayzee shot camera navigation lifecycle', () => {

	it( 'keeps an untouched saved camera idle, including inconsistent authored target/quaternion pairs', async () => {

		const view = fixture();
		view.controls.target.set( 3, 4, 5 );
		view.navigation.setEnabled( true );
		await view.step( 0 ); await view.step( 200 );
		expect( view.manager.update ).not.toHaveBeenCalled();
		expect( view.paint ).not.toHaveBeenCalled();
		expect( view.onStart ).not.toHaveBeenCalled();
		expect( view.onChange ).not.toHaveBeenCalled();
		view.navigation.dispose();

	} );

	it( 'paints camera input and inertia, then emits one detached completed gesture instead of every frame', async () => {

		const view = fixture();
		view.navigation.setEnabled( true );
		view.manager.navigationActive = true;
		view.manager.update.mockImplementation( () => {

			view.camera.position.x += 1;

		} );
		await view.step( 0 ); await view.step( 16 );
		expect( view.paint ).toHaveBeenCalledTimes( 2 );
		expect( view.onStart ).toHaveBeenCalledTimes( 1 );
		expect( view.onStart.mock.invocationCallOrder[ 0 ] ).toBeLessThan( view.paint.mock.invocationCallOrder[ 0 ] );
		expect( view.onChange ).not.toHaveBeenCalled();
		view.manager.navigationActive = false;
		await view.step( 32 ); // Deceleration can still move after pointer release.
		view.manager.update.mockImplementation( () => {} );
		await view.step( 100 );
		expect( view.onChange ).not.toHaveBeenCalled();
		await view.step( 153 ); await view.step( 400 );
		expect( view.onChange ).toHaveBeenCalledTimes( 1 );
		expect( view.onStart ).toHaveBeenCalledTimes( 1 );
		expect( view.onChange.mock.calls[ 0 ][ 0 ].position ).toEqual( [ 3, 0, 0 ] );
		view.camera.position.x = 10;
		expect( view.onChange.mock.calls[ 0 ][ 0 ].position ).toEqual( [ 3, 0, 0 ] );
		view.navigation.dispose();

	} );

	it( 'ignores control notifications that never change the native camera pose', async () => {

		const view = fixture();
		view.navigation.setEnabled( true );
		view.controls.dispatchEvent( { type: 'change' } );
		await view.step( 0 ); await view.step( 200 );
		expect( view.paint ).not.toHaveBeenCalled();
		expect( view.onStart ).not.toHaveBeenCalled();
		expect( view.onChange ).not.toHaveBeenCalled();
		view.navigation.dispose();

	} );

	it( 'bounds pending paints and eventually paints the latest camera before completion', async () => {

		const view = fixture();
		let finish;
		view.paint.mockImplementationOnce( () => new Promise( resolve => {

			finish = resolve;

		} ) );
		view.navigation.setEnabled( true );
		view.manager.navigationActive = true;
		view.manager.update.mockImplementation( () => {

			view.camera.position.x += 1;

		} );
		await view.step( 0 ); await view.step( 16 ); await view.step( 32 );
		expect( view.paint ).toHaveBeenCalledTimes( 1 );
		view.manager.navigationActive = false;
		view.manager.update.mockImplementation( () => {} );
		finish(); await flush();
		await view.step( 160 );
		expect( view.paint ).toHaveBeenCalledTimes( 2 );
		await view.step( 200 );
		expect( view.onChange ).toHaveBeenCalledTimes( 1 );
		view.navigation.dispose();

	} );

	it( 'suspends and clears held input without reverting the camera or emitting a late dirty callback', async () => {

		const view = fixture();
		view.navigation.setEnabled( true );
		view.manager.navigationActive = true;
		view.manager.update.mockImplementationOnce( () => {

			view.camera.position.x = 5;

		} );
		await view.step( 0 );
		view.navigation.setEnabled( false );
		expect( view.controls.enabled ).toBe( false );
		expect( view.manager._handleNavigationBlur ).toHaveBeenCalledOnce();
		expect( view.camera.position.x ).toBe( 5 );
		expect( view.frames.size ).toBe( 0 );
		view.navigation.setEnabled( true );
		await view.step( 200 );
		expect( view.onChange ).not.toHaveBeenCalled();
		view.navigation.dispose();

	} );

	it( 'stops RAF and reports asynchronous paint failure without unhandled rejection', async () => {

		const view = fixture();
		view.paint.mockRejectedValueOnce( new Error( 'GPU frame failed' ) );
		view.navigation.setEnabled( true );
		view.manager.navigationActive = true;
		view.manager.update.mockImplementationOnce( () => {

			view.camera.position.x = 1;

		} );
		await view.step( 0 );
		expect( view.onError ).toHaveBeenCalledOnce();
		expect( view.onError.mock.calls[ 0 ][ 0 ].message ).toBe( 'GPU frame failed' );
		expect( view.controls.enabled ).toBe( false );
		expect( view.frames.size ).toBe( 0 );
		view.navigation.dispose();

	} );

	it( 'does not report an abandoned pending paint as a new navigation failure after disposal', async () => {

		const view = fixture();
		let rejectPaint;
		view.paint.mockImplementationOnce( () => new Promise( ( _resolve, reject ) => {

			rejectPaint = reject;

		} ) );
		view.navigation.setEnabled( true );
		view.manager.navigationActive = true;
		view.manager.update.mockImplementationOnce( () => {

			view.camera.position.x = 1;

		} );
		await view.step( 0 );
		view.navigation.dispose();
		rejectPaint( new Error( 'preview closed' ) ); await flush();
		expect( view.onError ).not.toHaveBeenCalled();
		expect( view.onChange ).not.toHaveBeenCalled();

	} );

	it( 'disposal removes input notifications and any pending RAF callback', async () => {

		const view = fixture();
		view.navigation.setEnabled( true );
		view.navigation.dispose();
		view.controls.dispatchEvent( { type: 'change' } );
		await view.step( 200 );
		expect( view.frames.size ).toBe( 0 );
		expect( view.paint ).not.toHaveBeenCalled();
		expect( view.onChange ).not.toHaveBeenCalled();

	} );

} );
