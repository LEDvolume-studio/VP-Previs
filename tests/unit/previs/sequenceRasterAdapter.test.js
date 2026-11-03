import { describe, expect, it, vi } from 'vitest';
import { SequenceRasterAdapter } from '../../../app/src/previs/engine/SequenceRasterAdapter.js';
import { studentFixture } from './studentFixtures.js';

function deferred() {

	let resolve;
	let reject;
	const promise = new Promise( ( yes, no ) => {

		resolve = yes; reject = no;

	} );
	return { promise, resolve, reject };

}

function viewport() {

	const document = studentFixture();
	const token = {};
	const sceneAdapter = { captureState: vi.fn( async () => token ), applyShot: vi.fn( async () => {} ), restoreState: vi.fn( async () => {} ) };
	const context = { save: vi.fn(), restore: vi.fn(), resetTransform: vi.fn(), fillRect: vi.fn() };
	const canvas = { width: 1920, height: 1080, getContext: vi.fn( () => context ) };
	context.canvas = canvas;
	const ports = { document, sceneAdapter, canvas, renderMedia: vi.fn( async () => {} ), render: vi.fn(), prepare: vi.fn( async () => {} ), restore: vi.fn( async () => {} ) };
	return { document, token, sceneAdapter, context, ports, create: () => new SequenceRasterAdapter( ports ) };

}

describe( 'sequence raster preview/export bridge', () => {

	it( 'passes the global timeline frame through to media while the camera uses shot-local frames', async () => {

		const view = viewport();
		view.document.assets[ 'video@1' ].durationUs = 180000000;
		const adapter = view.create();
		await adapter.prepare();
		const result = await adapter.renderFrame( 0, { timelineFrame: 126 } );
		expect( result.localFrame ).toBe( 0 );
		expect( result.led[ 0 ].sourceTimeUs ).toBe( 5040000 );
		expect( view.ports.renderMedia.mock.calls[ 0 ][ 0 ].led[ 0 ].sourceTimeSeconds ).toBe( 5.04 );
		await adapter.restore();

	} );

	it( 'freezes an export revision before the editor is changed', async () => {

		const view = viewport();
		const adapter = view.create();
		view.document.clips[ 0 ].durationFrames = 1;
		view.document.shots.shotA.snapshot.camera.exposure = 9;
		await adapter.prepare();
		const evaluation = await adapter.renderFrame( 10 );
		expect( adapter.evaluator.totalFrames ).toBe( 50 );
		expect( evaluation.shot.snapshot.camera.exposure ).toBe( 1 );
		expect( view.sceneAdapter.captureState.mock.calls[ 0 ][ 0 ].clips[ 0 ].durationFrames ).toBe( 25 );
		expect( view.sceneAdapter.applyShot.mock.calls[ 0 ][ 0 ].shots.shotA.snapshot.camera.exposure ).toBe( 1 );
		expect( Object.isFrozen( evaluation.shot.snapshot.camera ) ).toBe( true );
		await adapter.restore();

	} );
	it( 'applies complete shots only when needed but advances media at every rendered frame', async () => {

		const view = viewport();
		const adapter = view.create();
		await adapter.prepare();
		for ( const frame of [ 0, 1, 24, 25, 26, 0 ] ) await adapter.renderFrame( frame, { width: 1920, height: 1080 } );
		expect( view.sceneAdapter.applyShot.mock.calls.map( call => call[ 1 ] ) ).toEqual( [ 'shotA', 'shotB', 'shotA' ] );
		expect( view.ports.renderMedia.mock.calls.map( call => [ call[ 0 ].frame, call[ 0 ].led[ 0 ].sourceTimeUs ] ) ).toEqual( [[ 0, 800000 ], [ 1, 840000 ], [ 24, 760000 ], [ 25, 800000 ], [ 26, 800000 ], [ 0, 800000 ]] );
		expect( view.ports.render.mock.calls.map( call => call[ 0 ].frame ) ).toEqual( [ 0, 1, 24, 25, 26, 0 ] );
		expect( view.ports.renderMedia.mock.calls[ 0 ][ 1 ] ).toMatchObject( { width: 1920, height: 1080, signal: expect.any( AbortSignal ) } );
		await expect( adapter.renderFrame( 50 ) ).rejects.toThrow( /endpoint/ );
		for ( const frame of [ - 1, 0.5, 51 ] ) await expect( adapter.renderFrame( frame ) ).rejects.toThrow( RangeError );
		expect( view.ports.render ).toHaveBeenCalledTimes( 6 );
		await adapter.restore();

	} );
	it( 'composites shot framing after the synchronous raster copy', async () => {

		const view = viewport();
		view.document.shots.shotA.snapshot.camera.frameOverlayRatio = '4:3';
		const events = [];
		view.ports.render.mockImplementation( () => events.push( 'raster' ) );
		view.context.fillRect.mockImplementation( ( ...rect ) => events.push( rect ) );
		const adapter = view.create();
		await adapter.prepare();
		await adapter.renderFrame( 0 );
		expect( events ).toEqual( [ 'raster', [ 0, 0, 240, 1080 ], [ 1680, 0, 240, 1080 ]] );
		await adapter.restore();

	} );
	it( 'rejects rendering before readiness, including while host preparation is pending', async () => {

		const view = viewport();
		const entered = deferred();
		const ready = deferred();
		view.ports.prepare.mockImplementation( () => {

			entered.resolve(); return ready.promise;

		} );
		const adapter = view.create();
		await expect( adapter.renderFrame( 0 ) ).rejects.toThrow( /prepare|ready/i );
		const preparing = adapter.prepare();
		await entered.promise;
		await expect( adapter.renderFrame( 0 ) ).rejects.toThrow( /prepare|ready/i );
		expect( view.ports.render ).not.toHaveBeenCalled();
		ready.resolve();
		await preparing;
		await adapter.renderFrame( 0 );
		await adapter.restore();

	} );
	it( 'rejects concurrent prepare calls even while capture is pending', async () => {

		const view = viewport();
		const entered = deferred();
		const captured = deferred();
		view.sceneAdapter.captureState.mockImplementation( () => {

			entered.resolve(); return captured.promise;

		} );
		const adapter = view.create();
		const preparing = adapter.prepare();
		await entered.promise;
		await expect( adapter.prepare() ).rejects.toThrow( /prepar|progress/i );
		captured.resolve( view.token );
		await preparing;
		expect( view.sceneAdapter.captureState ).toHaveBeenCalledOnce();
		await adapter.restore();

	} );
	it( 'restores both ports after partial host preparation fails', async () => {

		const view = viewport();
		view.ports.prepare.mockRejectedValueOnce( new Error( 'decoder initialization failed' ) );
		const adapter = view.create();
		await expect( adapter.prepare() ).rejects.toThrow( 'decoder initialization failed' );
		await adapter.restore();
		expect( view.sceneAdapter.restoreState ).toHaveBeenCalledWith( view.token );
		expect( view.ports.restore ).toHaveBeenCalledOnce();
		await adapter.prepare();
		await adapter.renderFrame( 0 );
		await adapter.restore();

	} );
	it( 'does not run preparation or touch the viewport for an already-aborted request', async () => {

		const view = viewport();
		const controller = new AbortController();
		controller.abort( new DOMException( 'cancelled', 'AbortError' ) );
		const adapter = view.create();
		await expect( adapter.prepare( { signal: controller.signal } ) ).rejects.toMatchObject( { name: 'AbortError' } );
		await adapter.restore();
		expect( view.sceneAdapter.captureState ).not.toHaveBeenCalled();
		expect( view.ports.prepare ).not.toHaveBeenCalled();
		expect( view.sceneAdapter.restoreState ).not.toHaveBeenCalled();

	} );
	it( 'lets the latest seek win while an older shot application is pending', async () => {

		const view = viewport();
		const entered = deferred();
		const applied = deferred();
		view.sceneAdapter.applyShot.mockImplementationOnce( () => {

			entered.resolve(); return applied.promise;

		} );
		const adapter = view.create();
		await adapter.prepare();
		const first = adapter.renderFrame( 0 );
		const rejected = expect( first ).rejects.toMatchObject( { name: 'AbortError' } );
		await entered.promise;
		const latest = adapter.renderFrame( 25 );
		expect( view.sceneAdapter.applyShot ).toHaveBeenCalledOnce();
		applied.resolve();
		await rejected;
		await latest;
		expect( view.sceneAdapter.applyShot.mock.calls.map( call => call[ 1 ] ) ).toEqual( [ 'shotA', 'shotB' ] );
		expect( view.ports.renderMedia.mock.calls.map( call => call[ 0 ].frame ) ).toEqual( [ 25 ] );
		expect( view.ports.render.mock.calls.map( call => call[ 0 ].frame ) ).toEqual( [ 25 ] );
		await adapter.restore();

	} );
	it( 'waits for a superseded decoder to settle and never paints its stale frame', async () => {

		const view = viewport();
		const entered = deferred();
		const decoded = deferred();
		view.ports.renderMedia.mockImplementationOnce( () => {

			entered.resolve(); return decoded.promise;

		} );
		const adapter = view.create();
		await adapter.prepare();
		const first = adapter.renderFrame( 0 );
		const rejected = expect( first ).rejects.toMatchObject( { name: 'AbortError' } );
		await entered.promise;
		const latest = adapter.renderFrame( 1 );
		expect( view.ports.renderMedia.mock.calls[ 0 ][ 1 ].signal.aborted ).toBe( true );
		expect( view.ports.renderMedia ).toHaveBeenCalledOnce();
		decoded.resolve();
		await rejected;
		await latest;
		expect( view.sceneAdapter.applyShot ).toHaveBeenCalledOnce();
		expect( view.ports.render.mock.calls.map( call => call[ 0 ].frame ) ).toEqual( [ 1 ] );
		await adapter.restore();

	} );
	it( 'does not paint when an external cancellation arrives during decoding', async () => {

		const view = viewport();
		const entered = deferred();
		const decoded = deferred();
		view.ports.renderMedia.mockImplementationOnce( () => {

			entered.resolve(); return decoded.promise;

		} );
		const controller = new AbortController();
		const adapter = view.create();
		await adapter.prepare();
		const rendering = adapter.renderFrame( 0, { signal: controller.signal } );
		const rejected = expect( rendering ).rejects.toMatchObject( { name: 'AbortError' } );
		await entered.promise;
		controller.abort( new DOMException( 'user cancelled', 'AbortError' ) );
		decoded.resolve();
		await rejected;
		expect( view.ports.render ).not.toHaveBeenCalled();
		await adapter.renderFrame( 1 );
		expect( view.ports.render ).toHaveBeenCalledOnce();
		await adapter.restore();

	} );
	it( 'rejects new render work during restoration and attempts both restore ports', async () => {

		const view = viewport();
		const entered = deferred();
		const restored = deferred();
		view.sceneAdapter.restoreState.mockImplementationOnce( () => {

			entered.resolve(); return restored.promise;

		} );
		const adapter = view.create();
		await adapter.prepare();
		const restoring = adapter.restore();
		await entered.promise;
		await expect( adapter.renderFrame( 0 ) ).rejects.toThrow( /prepar|restor|ready/i );
		restored.resolve();
		await restoring;
		expect( view.ports.render ).not.toHaveBeenCalled();
		expect( view.ports.restore ).toHaveBeenCalledOnce();
		await expect( adapter.renderFrame( 0 ) ).rejects.toThrow( /prepar|ready/i );

	} );
	it( 'attempts both restore ports and fails closed after restoration errors', async () => {

		const view = viewport();
		const sceneError = new Error( 'scene restore failed' );
		const hostError = new Error( 'renderer restore failed' );
		view.sceneAdapter.restoreState.mockRejectedValueOnce( sceneError );
		view.ports.restore.mockRejectedValueOnce( hostError );
		const adapter = view.create();
		await adapter.prepare();
		const error = await adapter.restore().catch( value => value );
		expect( error ).toBeInstanceOf( AggregateError );
		expect( error.errors ).toEqual( [ sceneError, hostError ] );
		expect( view.ports.restore ).toHaveBeenCalledOnce();
		await expect( adapter.prepare() ).rejects.toThrow( /prepared|busy/ );
		await expect( adapter.renderFrame( 0 ) ).rejects.toThrow( /ready/ );

	} );
	it( 'cancels a pending decode before restoring the viewport and never paints afterward', async () => {

		const view = viewport();
		const entered = deferred();
		const decoded = deferred();
		view.ports.renderMedia.mockImplementationOnce( () => {

			entered.resolve(); return decoded.promise;

		} );
		const adapter = view.create();
		await adapter.prepare();
		const rendering = adapter.renderFrame( 0 );
		const rejected = expect( rendering ).rejects.toMatchObject( { name: 'AbortError' } );
		await entered.promise;
		const restoring = adapter.restore();
		expect( view.ports.renderMedia.mock.calls[ 0 ][ 1 ].signal.aborted ).toBe( true );
		expect( view.sceneAdapter.restoreState ).not.toHaveBeenCalled();
		decoded.resolve();
		await rejected;
		await restoring;
		expect( view.sceneAdapter.restoreState ).toHaveBeenCalledOnce();
		expect( view.ports.restore ).toHaveBeenCalledOnce();
		expect( view.ports.render ).not.toHaveBeenCalled();

	} );
	it( 'rejects an already-aborted frame before applying any scene or media changes', async () => {

		const view = viewport();
		const adapter = view.create();
		await adapter.prepare();
		const controller = new AbortController();
		controller.abort( new DOMException( 'already cancelled', 'AbortError' ) );
		await expect( adapter.renderFrame( 0, { signal: controller.signal } ) ).rejects.toMatchObject( { name: 'AbortError' } );
		expect( view.sceneAdapter.applyShot ).not.toHaveBeenCalled();
		expect( view.ports.renderMedia ).not.toHaveBeenCalled();
		expect( view.ports.render ).not.toHaveBeenCalled();
		await adapter.restore();

	} );
	it( 'can retry a failed complete-shot application without trusting the failed state', async () => {

		const view = viewport();
		view.sceneAdapter.applyShot.mockRejectedValueOnce( new Error( 'application failed' ) );
		const adapter = view.create();
		await adapter.prepare();
		await expect( adapter.renderFrame( 0 ) ).rejects.toThrow( 'application failed' );
		expect( view.ports.renderMedia ).not.toHaveBeenCalled();
		await adapter.renderFrame( 0 );
		expect( view.sceneAdapter.applyShot ).toHaveBeenCalledTimes( 2 );
		expect( view.ports.render ).toHaveBeenCalledOnce();
		await adapter.restore();

	} );
	it( 'can retry a media failure while retaining an already applied shot', async () => {

		const view = viewport();
		view.ports.renderMedia.mockRejectedValueOnce( new Error( 'decode failed' ) );
		const adapter = view.create();
		await adapter.prepare();
		await expect( adapter.renderFrame( 0 ) ).rejects.toThrow( 'decode failed' );
		expect( view.ports.render ).not.toHaveBeenCalled();
		await adapter.renderFrame( 0 );
		expect( view.sceneAdapter.applyShot ).toHaveBeenCalledOnce();
		expect( view.ports.render ).toHaveBeenCalledOnce();
		await adapter.restore();

	} );
	it( 'rejects asynchronous GPU copies instead of compositing over an unready canvas', async () => {

		const view = viewport();
		view.ports.render.mockResolvedValueOnce();
		const adapter = view.create();
		await adapter.prepare();
		await expect( adapter.renderFrame( 0 ) ).rejects.toThrow( /synchronously/ );
		expect( view.context.fillRect ).not.toHaveBeenCalled();
		await adapter.restore();

	} );

} );

it( 'retargets a prepared shot without restoring or recapturing its editing baseline', async () => {

	const view = viewport(); view.adapter = view.create();
	await view.adapter.prepare(); await view.adapter.renderFrame( 0 );
	const next = structuredClone( view.document ); next.clips = [ { clipId: 'onlyB', shotId: 'shotB', durationFrames: 25 } ];
	view.adapter.retarget( next, 'shotB' ); await view.adapter.renderFrame( 4 );
	expect( view.sceneAdapter.captureState ).toHaveBeenCalledOnce();
	expect( view.sceneAdapter.restoreState ).not.toHaveBeenCalled();
	expect( view.sceneAdapter.applyShot ).toHaveBeenLastCalledWith( next, 'shotB', { mediaTimes: new Map( [[ 'wall', 0.8 ]] ) } );
	await view.adapter.restore(); expect( view.sceneAdapter.restoreState ).toHaveBeenCalledOnce();

} );
