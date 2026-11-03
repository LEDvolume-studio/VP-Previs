import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock( 'three', () => {

	class EventDispatcher {

		constructor() {

			this._listeners = {};

		}
		addEventListener( t, l ) {

			( this._listeners[ t ] ||= [] ).push( l );

		}
		removeEventListener( t, l ) {

			if ( this._listeners[ t ] ) {

				const i = this._listeners[ t ].indexOf( l ); if ( i > - 1 ) this._listeners[ t ].splice( i, 1 );

			}

		}
		dispatchEvent( e ) {

			( this._listeners[ e.type ] || [] ).forEach( l => l( e ) );

		}

	}

	class PerspectiveCamera {

		constructor( fov = 50, aspect = 1, near = 0.1, far = 1000 ) {

			this.fov = fov;
			this.aspect = aspect;
			this.near = near;
			this.far = far;
			this.position = new Vector3();
			this.quaternion = { copy: vi.fn(), setFromEuler: vi.fn(), clone: vi.fn( function () {

				return { ...this };

			} ) };
			this.name = '';
			this.updateProjectionMatrix = vi.fn();
			this.updateMatrixWorld = vi.fn();

		}

	}

	class Euler {

		constructor( x = 0, y = 0, z = 0, order = 'XYZ' ) {

			this.x = x; this.y = y; this.z = z; this.order = order;

		}
		setFromQuaternion() {

			return this;

		}

	}

	class Vector3 {

		constructor( x = 0, y = 0, z = 0 ) {

			this.x = x; this.y = y; this.z = z;

		}
		set( x, y, z ) {

			this.x = x; this.y = y; this.z = z; return this;

		}
		copy( v ) {

			this.x = v.x; this.y = v.y; this.z = v.z; return this;

		}
		clone() {

			return new Vector3( this.x, this.y, this.z );

		}
		distanceTo( v ) {

			return Math.hypot( this.x - v.x, this.y - v.y, this.z - v.z );

		}
		subVectors( a, b ) {

			this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this;

		}
		normalize() {

			const length = Math.hypot( this.x, this.y, this.z ) || 1;
			this.x /= length; this.y /= length; this.z /= length; return this;

		}
		multiplyScalar( scalar ) {

			this.x *= scalar; this.y *= scalar; this.z *= scalar; return this;

		}
		add( v ) {

			this.x += v.x; this.y += v.y; this.z += v.z; return this;

		}
		addScaledVector( v, scalar ) {

			this.x += v.x * scalar; this.y += v.y * scalar; this.z += v.z * scalar; return this;

		}
		length() {

			return Math.hypot( this.x, this.y, this.z );

		}
		lengthSq() {

			return this.x * this.x + this.y * this.y + this.z * this.z;

		}
		lerp( v, alpha ) {

			this.x += ( v.x - this.x ) * alpha;
			this.y += ( v.y - this.y ) * alpha;
			this.z += ( v.z - this.z ) * alpha; return this;

		}
		applyQuaternion() {

			return this;

		}

	}

	return {
		Euler,
		EventDispatcher,
		MathUtils: { clamp: ( value, min, max ) => Math.min( max, Math.max( min, value ) ) },
		PerspectiveCamera,
		Vector3,
	};

} );

vi.mock( 'three/addons/controls/OrbitControls.js', () => ( {
	OrbitControls: class {

		constructor( camera, domElement ) {

			this.domElement = domElement;
			this.mouseButtons = {};
			this.target = { x: 0, y: 0, z: 0, copy( value ) {

				this.x = value.x; this.y = value.y; this.z = value.z; return this;

			}, clone() {

				return { ...this };

			}, add( value ) {

				this.x += value.x; this.y += value.y; this.z += value.z; return this;

			}, addScaledVector( value, scalar ) {

				this.x += value.x * scalar; this.y += value.y * scalar; this.z += value.z * scalar; return this;

			} };
			this.enabled = true;
			this.screenSpacePanning = false;
			this.zoomToCursor = false;
			this.dispatchEvent = vi.fn();

		}

		update() {}
		saveState() {}
		dispose() {}
		addEventListener() {}
		removeEventListener() {}

	}
} ) );

vi.mock( '@/core/EngineEvents.js', () => ( {
	EngineEvents: { AUTO_FOCUS_UPDATED: 'AUTO_FOCUS_UPDATED' }
} ) );

vi.mock( '@/core/EngineDefaults.js', () => ( {
	AF_DEFAULTS: { SMOOTHING_FACTOR: 0.2, FALLBACK_DISTANCE: 5.0, SNAP_THRESHOLD: 0.5, RESET_THRESHOLD: 0.01 }
} ) );

const { CameraManager } = await import( '@/core/managers/CameraManager.js' );

function createMockCanvas() {

	return { clientWidth: 800, clientHeight: 600, style: {} };

}

describe( 'CameraManager', () => {

	let manager;

	beforeEach( () => {

		manager = new CameraManager( createMockCanvas() );

	} );

	// ── constructor ───────────────────────────────────────────

	describe( 'constructor', () => {

		it( 'stores camera and controls', () => {

			expect( manager.camera ).toBeDefined();
			expect( manager.controls ).toBeDefined();

		} );

		it( 'initializes with default camera in cameras list', () => {

			expect( manager.cameras ).toHaveLength( 1 );
			expect( manager.cameras[ 0 ] ).toBe( manager.camera );

		} );

		it( 'starts at camera index 0', () => {

			expect( manager.currentCameraIndex ).toBe( 0 );

		} );

		it( 'initializes AF state', () => {

			expect( manager.afScreenPoint ).toEqual( { x: 0.5, y: 0.5 } );

		} );

	} );

	// ── viewport navigation ───────────────────────────────────

	describe( 'viewport navigation', () => {

		it( 'accepts movement keys only while RMB is held', () => {

			manager._handleNavigationKeyDown( {
				code: 'KeyW', target: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
			} );
			expect( manager._navigationKeys.has( 'KeyW' ) ).toBe( false );

			manager._handlePointerDown( { button: 2, preventDefault: vi.fn() } );
			manager._handleNavigationKeyDown( {
				code: 'KeyW', target: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
			} );
			expect( manager._navigationKeys.has( 'KeyW' ) ).toBe( true );

		} );

		it( 'moves forward with W and vertically with E while RMB is held', () => {

			manager._handlePointerDown( { button: 2, preventDefault: vi.fn() } );
			manager._navigationKeys.add( 'KeyW' );
			manager._navigationKeys.add( 'KeyE' );
			manager._navigationLastUpdate -= 100;

			manager.update();

			expect( manager.camera.position.z ).toBeLessThan( 5 );
			expect( manager.camera.position.y ).toBeGreaterThan( 0 );

		} );

		it( 'eases out after a movement key is released', () => {

			manager._handlePointerDown( { button: 2, preventDefault: vi.fn() } );
			manager._navigationKeys.add( 'KeyW' );
			manager._navigationLastUpdate -= 100;
			manager.update();
			const positionAfterInput = manager.camera.position.z;

			manager._navigationKeys.clear();
			manager._navigationLastUpdate -= 50;
			manager.update();

			expect( manager.camera.position.z ).toBeLessThan( positionAfterInput );
			expect( manager._velocity.lengthSq() ).toBeGreaterThan( 0 );

		} );

		it( 'uses speed 1 by default and doubles it while Shift is held', () => {

			manager._updateLookDistance();
			const defaultSpeed = manager._getMovementSpeed();
			expect( manager.cameraSpeedLevel ).toBe( 1 );
			expect( defaultSpeed ).toBeCloseTo( 5 * 0.75 * 0.125 );

			manager._handleNavigationKeyDown( { code: 'ShiftLeft' } );
			expect( manager._getMovementSpeed() ).toBe( defaultSpeed * 2 );

			manager._handleNavigationKeyUp( { code: 'ShiftLeft' } );
			expect( manager._getMovementSpeed() ).toBe( defaultSpeed );

		} );

		it( 'looks around while RMB is dragged', () => {

			manager._handlePointerDown( { button: 2, preventDefault: vi.fn() } );
			manager._handlePointerMove( { movementX: 10, movementY: - 5, preventDefault: vi.fn() } );

			expect( manager.camera.quaternion.setFromEuler ).toHaveBeenCalled();
			expect( manager._lookEuler.y ).toBeCloseTo( - 0.02 );
			expect( manager._lookEuler.x ).toBeCloseTo( 0.01 );

		} );

		it( 'dollies with LMB and pans with MMB', () => {

			manager._handlePointerDown( { button: 0, preventDefault: vi.fn() } );
			manager._handlePointerMove( { movementX: 0, movementY: - 10, preventDefault: vi.fn() } );
			expect( manager.camera.position.z ).toBeLessThan( 5 );

			manager._handlePointerUp( { button: 0 } );
			const previousX = manager.camera.position.x;
			manager._handlePointerDown( { button: 1, preventDefault: vi.fn() } );
			manager._handlePointerMove( { movementX: 10, movementY: 0, preventDefault: vi.fn() } );
			expect( manager.camera.position.x ).toBeLessThan( previousX );

		} );

		it( 'pans when LMB and RMB are held together', () => {

			manager._handlePointerDown( { button: 0, preventDefault: vi.fn() } );
			manager._handlePointerDown( { button: 2, preventDefault: vi.fn() } );
			manager._handlePointerMove( { movementX: 10, movementY: 0, preventDefault: vi.fn() } );

			expect( manager.camera.position.x ).toBeLessThan( 0 );
			expect( manager.camera.quaternion.setFromEuler ).not.toHaveBeenCalled();

		} );

		it( 'adjusts the camera speed between levels 1 and 8', () => {

			manager.adjustCameraSpeed( 1 );
			expect( manager.cameraSpeedLevel ).toBe( 2 );

			manager.setCameraSpeedLevel( 20 );
			expect( manager.cameraSpeedLevel ).toBe( 8 );

			manager.setCameraSpeedLevel( - 20 );
			expect( manager.cameraSpeedLevel ).toBe( 1 );

		} );

	} );

	// ── setCameras ────────────────────────────────────────────

	describe( 'setCameras', () => {

		it( 'replaces camera list', () => {

			const cam2 = { name: 'ModelCam' };
			manager.setCameras( [ manager.camera, cam2 ] );
			expect( manager.cameras ).toHaveLength( 2 );

		} );

	} );

	// ── getCameraNames ────────────────────────────────────────

	describe( 'getCameraNames', () => {

		it( 'returns ["Default Camera"] for single camera', () => {

			expect( manager.getCameraNames() ).toEqual( [ 'Default Camera' ] );

		} );

		it( 'returns named cameras', () => {

			const cam2 = { name: 'Front' };
			manager.setCameras( [ manager.camera, cam2 ] );

			const names = manager.getCameraNames();
			expect( names[ 0 ] ).toBe( 'Default Camera' );
			expect( names[ 1 ] ).toBe( 'Front' );

		} );

		it( 'uses "Camera N" for unnamed cameras', () => {

			const cam2 = { name: '' };
			manager.setCameras( [ manager.camera, cam2 ] );

			const names = manager.getCameraNames();
			expect( names[ 1 ] ).toBe( 'Camera 1' );

		} );

		it( 'handles empty cameras list', () => {

			manager.cameras = [];
			expect( manager.getCameraNames() ).toEqual( [ 'Default Camera' ] );

		} );

		it( 'handles null cameras', () => {

			manager.cameras = null;
			expect( manager.getCameraNames() ).toEqual( [ 'Default Camera' ] );

		} );

	} );

	// ── switchCamera guard ────────────────────────────────────

	describe( 'switchCamera', () => {

		it( 'returns early for empty cameras', () => {

			manager.cameras = [];
			// Should not throw
			expect( () => manager.switchCamera( 0, 5, vi.fn(), vi.fn() ) ).not.toThrow();

		} );

		it( 'returns early for null cameras', () => {

			manager.cameras = null;
			expect( () => manager.switchCamera( 0, 5, vi.fn(), vi.fn() ) ).not.toThrow();

		} );

	} );

} );
