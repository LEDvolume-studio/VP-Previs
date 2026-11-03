import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathTracerApp } from '@/core/PathTracerApp.js';
import { EngineEvents } from '@/core/EngineEvents.js';

afterEach( () => {

	vi.unstubAllGlobals();

} );

describe( 'PathTracerApp camera navigation loop', () => {

	it( 'updates the camera manager so Unreal-style keyboard movement runs each frame', () => {

		vi.stubGlobal( 'requestAnimationFrame', vi.fn( () => 1 ) );
		const update = vi.fn();
		const updateMatrixWorld = vi.fn();
		const app = {
			_deviceLost: false,
			_loadingInProgress: false,
			_sdf: null,
			animationManager: null,
			needsReset: false,
			cameraManager: {
				update,
				camera: { updateMatrixWorld },
			},
			pathTracerEnabled: false,
			realtimeRenderer: { render: vi.fn() },
			_renderHelperOverlay: vi.fn(),
			animate: PathTracerApp.prototype.animate,
		};

		app.animate();

		expect( update ).toHaveBeenCalledOnce();
		expect( updateMatrixWorld ).toHaveBeenCalledOnce();

	} );

} );

describe( 'PathTracerApp renderer mode', () => {

	it( 'publishes the effective path-tracer state whenever the renderer changes', () => {

		const app = {
			_pathTracerEnabled: true,
			realtimeRenderer: { activate: vi.fn(), deactivate: vi.fn(), syncScene: vi.fn() },
			precompileRaster: vi.fn(),
			wake: vi.fn(),
			dispatchEvent: vi.fn(),
		};
		const setter = Object.getOwnPropertyDescriptor( PathTracerApp.prototype, 'pathTracerEnabled' ).set;

		setter.call( app, false );

		expect( app._pathTracerEnabled ).toBe( false );
		expect( app.realtimeRenderer.activate ).toHaveBeenCalledOnce();
		expect( app.dispatchEvent ).toHaveBeenCalledWith( {
			type: EngineEvents.PATH_TRACER_ENABLED_CHANGED,
			enabled: false,
		} );

	} );

} );
