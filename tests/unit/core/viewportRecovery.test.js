import { describe, expect, it, vi } from 'vitest';
import { PathTracerApp } from '@/core/PathTracerApp.js';

function harness() {

	return {
		isInitialized: true,
		pathTracerEnabled: false,
		cameraManager: { camera: { aspect: 2, updateProjectionMatrix: vi.fn() } },
		realtimeRenderer: {
			getPathTracerSize: () => ( { width: 800, height: 800 } ),
			refreshDisplaySize: vi.fn(),
		},
		renderer: { setSize: vi.fn(), getSize: vector => vector.set( 1600, 1600 ) },
		wake: vi.fn(),
	};

}

describe( 'viewport recovery', () => {

	it( 'repairs the photographic aspect from output dimensions on return', () => {

		const app = harness();
		PathTracerApp.prototype.refreshViewport.call( app );
		expect( app.cameraManager.camera.aspect ).toBe( 1 );
		expect( app.realtimeRenderer.refreshDisplaySize ).toHaveBeenCalledOnce();
		expect( app.wake ).toHaveBeenCalledOnce();

	} );

	it( 'keeps orthographic resize events out of the photographic camera and pipeline', () => {

		const app = harness();
		app.editorViewManager = { active: true, update: vi.fn() };
		PathTracerApp.prototype.onResize.call( app );
		expect( app.editorViewManager.update ).toHaveBeenCalledOnce();
		expect( app.cameraManager.camera.aspect ).toBe( 2 );
		expect( app.cameraManager.camera.updateProjectionMatrix ).not.toHaveBeenCalled();
		expect( app.renderer.setSize ).not.toHaveBeenCalled();

	} );

	it( 'redraws completed output at its existing upscaled size without restarting accumulation', () => {

		const app = harness();
		app.pathTracerEnabled = true;
		PathTracerApp.prototype.refreshViewport.call( app );
		expect( app.renderer.setSize ).toHaveBeenCalledWith( 1600, 1600, false );
		expect( app._needsDisplayRefresh ).toBe( true );
		expect( app.realtimeRenderer.refreshDisplaySize ).not.toHaveBeenCalled();

	} );

	it( 'respects explicit pause and lost GPU state', () => {

		for ( const flag of [ '_paused', '_deviceLost' ] ) {

			const app = { ...harness(), [ flag ]: true };
			PathTracerApp.prototype.refreshViewport.call( app );
			expect( app.wake ).not.toHaveBeenCalled();

		}

	} );

} );
