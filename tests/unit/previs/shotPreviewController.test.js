import { expect, it, vi } from 'vitest';
import { ShotPreviewController } from '../../../app/src/student/ShotPreviewController.js';

const deferred = () => {

	let resolve; const promise = new Promise( done => {

		resolve = done;

	} );
	return { promise, resolve };

};

const input = shotId => ( { document: { shots: { [ shotId ]: { name: shotId } } }, shotId } );
const viewport = () => ( { canvas: { remove: vi.fn() }, dispose: vi.fn().mockResolvedValue() } );

it( 'drains a cancelled late preparation before allowing the next viewport to start', async () => {

	const held = deferred(), entered = deferred(), old = viewport(), next = viewport();
	const calls = [];
	const controller = new ShotPreviewController( { createViewport: async options => {

		calls.push( options.shotId );
		if ( options.shotId === 'A' ) {

			entered.resolve( options ); return held.promise;

		}

		return next;

	} } );
	const first = controller.show( input( 'A' ) );
	const options = await entered.promise;
	const second = controller.show( input( 'B' ) );
	expect( options.signal.aborted ).toBe( true );
	expect( calls ).toEqual( [ 'A' ] );
	held.resolve( old );
	expect( await first ).toBe( false );
	expect( await second ).toBe( true );
	expect( old.dispose ).toHaveBeenCalledOnce();
	expect( controller.runtime ).toBe( next );
	expect( controller.state.shotId ).toBe( 'B' );
	await controller.clear();
	expect( next.canvas.remove ).toHaveBeenCalledOnce();
	expect( next.dispose ).toHaveBeenCalledOnce();

} );

it( 'closing pending preparation prevents late canvas attachment and stale progress messages', async () => {

	const held = deferred(), entered = deferred(), old = viewport();
	const controller = new ShotPreviewController( { createViewport: options => {

		entered.resolve( options ); return held.promise;

	} } );
	const first = controller.show( input( 'A' ) ); const options = await entered.promise;
	const closed = controller.clear( 'Closed by user' );
	options.onStatus( 'Stale decode' );
	held.resolve( old ); await first; await closed;
	expect( controller.runtime ).toBe( null );
	expect( controller.state.status ).toBe( 'Closed by user' );
	expect( old.dispose ).toHaveBeenCalledOnce();

} );

it( 'preparation failures do not retain a runtime and allow a later successful retry', async () => {

	const ready = viewport();
	const controller = new ShotPreviewController( { createViewport: vi.fn().mockRejectedValueOnce( new Error( 'Missing scene version' ) ).mockResolvedValueOnce( ready ) } );
	expect( await controller.show( input( 'A' ) ) ).toBe( false );
	expect( controller.state.phase ).toBe( 'error' );
	expect( controller.runtime ).toBe( null );
	expect( await controller.show( input( 'B' ) ) ).toBe( true );
	await controller.clear();

} );

it( 'freezes input content across preparation and reports failed teardown honestly', async () => {

	const held = deferred(), entered = deferred(), old = viewport();
	const controller = new ShotPreviewController( { createViewport: options => {

		entered.resolve( options ); return held.promise;

	} } );
	const source = input( 'A' ); const pending = controller.show( source );
	await entered.promise; source.document.shots.A.name = 'Later edit'; held.resolve( old ); await pending;
	expect( controller.state.status ).toContain( 'Previewing A at' );
	old.dispose.mockRejectedValueOnce( new Error( 'GPU cleanup failed' ) );
	await controller.clear();
	expect( controller.runtime ).toBe( null );
	expect( controller.state.phase ).toBe( 'error' );
	expect( await controller.show( input( 'A' ) ) ).toBe( false );
	expect( controller.state.status ).toContain( 'Earlier preview cleanup failed' );

} );

it( 'hides a saved picture during persistence and reuses its runtime with detached saved input', async () => {

	const entered = deferred(), held = deferred(), ready = viewport();
	ready.canUpdate = vi.fn().mockReturnValue( true );
	ready.updateDocument = vi.fn( async ( document, shotId, options ) => {

		entered.resolve( { document, shotId, ...options } ); await held.promise;

	} );
	const createViewport = vi.fn().mockResolvedValue( ready );
	const controller = new ShotPreviewController( { createViewport } );
	await controller.show( input( 'A' ) );
	controller.suspend();
	expect( controller.state.phase ).toBe( 'suspended' );
	expect( controller.runtime ).toBe( ready );
	expect( ready.canvas.remove ).toHaveBeenCalledOnce();
	const saved = input( 'A' ).document;
	saved.shots.A.name = 'Saved camera';
	const pending = controller.syncSavedDocument( saved );
	const options = await entered.promise;
	saved.shots.A.name = 'Unsaved next edit';
	expect( controller.state.phase ).toBe( 'loading' );
	expect( options.document.shots.A.name ).toBe( 'Saved camera' );
	expect( options.shotId ).toBe( 'A' );
	held.resolve();
	expect( await pending ).toBe( true );
	expect( controller.state.phase ).toBe( 'ready' );
	expect( controller.state.status ).toContain( 'Saved camera' );
	expect( createViewport ).toHaveBeenCalledOnce();
	expect( ready.dispose ).not.toHaveBeenCalled();
	await controller.clear();

} );

it( 'closing an in-flight saved update drains it before disposal and prevents a late picture', async () => {

	const entered = deferred(), held = deferred(), ready = viewport();
	ready.canUpdate = () => true;
	ready.updateDocument = async ( document, shotId, options ) => {

		entered.resolve( options ); await held.promise;

	};

	const controller = new ShotPreviewController( { createViewport: async () => ready } );
	await controller.show( input( 'A' ) );
	const saved = input( 'A' ).document; saved.shots.A.name = 'Saved change';
	const pending = controller.syncSavedDocument( saved );
	const options = await entered.promise;
	const closed = controller.clear( 'Closed by user' );
	expect( options.signal.aborted ).toBe( true );
	expect( ready.dispose ).not.toHaveBeenCalled();
	held.resolve();
	expect( await pending ).toBe( false );
	await closed;
	expect( ready.dispose ).toHaveBeenCalledOnce();
	expect( controller.runtime ).toBe( null );
	expect( controller.state.status ).toBe( 'Closed by user' );

} );

it( 'superseding a saved update cancels and drains it before applying the next saved revision', async () => {

	const entered = deferred(), held = deferred(), ready = viewport();
	const observed = [];
	ready.canUpdate = () => true;
	ready.updateDocument = async ( document, shotId, options ) => {

		observed.push( document.shots.A.name );
		if ( observed.length === 1 ) {

			entered.resolve( options ); await held.promise;

		}

	};

	const controller = new ShotPreviewController( { createViewport: async () => ready } );
	await controller.show( input( 'A' ) );
	const changed = input( 'A' ).document; changed.shots.A.name = 'First saved revision';
	const first = controller.syncSavedDocument( changed );
	const options = await entered.promise;
	controller.suspend( 'Saving next edit…' );
	const latest = input( 'A' ).document; latest.shots.A.name = 'Latest saved revision';
	const second = controller.syncSavedDocument( latest );
	expect( options.signal.aborted ).toBe( true );
	expect( observed ).toEqual( [ 'First saved revision' ] );
	held.resolve();
	expect( await first ).toBe( false );
	expect( await second ).toBe( true );
	expect( observed ).toEqual( [ 'First saved revision', 'Latest saved revision' ] );
	expect( controller.state.status ).toContain( 'Latest saved revision' );
	await controller.clear();

} );

it.each( [ 'missing', 'incompatible' ] )( 'clears a %s selected shot after saving instead of displaying stale content', async reason => {

	const ready = viewport();
	ready.canUpdate = vi.fn().mockReturnValue( reason !== 'incompatible' );
	ready.updateDocument = vi.fn();
	const controller = new ShotPreviewController( { createViewport: async () => ready } );
	await controller.show( input( 'A' ) );
	const saved = input( 'A' ).document; saved.shots.A.baseScene = 'different version';
	expect( await controller.syncSavedDocument( reason === 'missing' ? { shots: {} } : saved ) ).toBe( false );
	await controller.tail;
	expect( controller.runtime ).toBe( null );
	expect( controller.state.phase ).toBe( 'idle' );
	expect( controller.state.status ).toContain( 'Project saved on this device' );
	expect( ready.updateDocument ).not.toHaveBeenCalled();
	expect( ready.dispose ).toHaveBeenCalledOnce();

} );

it.each( [ 'compatibility', 'render' ] )( 'reports a %s refresh failure without rejecting a completed save and permits explicit retry', async failure => {

	const ready = viewport(), retry = viewport();
	ready.canUpdate = () => {

		if ( failure === 'compatibility' ) throw new Error( 'Unsupported camera' );
		return true;

	};

	ready.updateDocument = vi.fn().mockRejectedValue( new Error( 'Rendering failed' ) );
	const controller = new ShotPreviewController( { createViewport: vi.fn().mockResolvedValueOnce( ready ).mockResolvedValueOnce( retry ) } );
	await controller.show( input( 'A' ) );
	const saved = input( 'A' ).document; saved.shots.A.name = 'Saved change';
	expect( await controller.syncSavedDocument( saved ) ).toBe( false );
	expect( controller.state.phase ).toBe( 'error' );
	expect( controller.state.status ).toContain( 'Project saved on this device' );
	expect( controller.state.status ).toContain( failure === 'compatibility' ? 'Unsupported camera' : 'Rendering failed' );
	expect( await controller.show( input( 'A' ) ) ).toBe( true );
	expect( ready.dispose ).toHaveBeenCalledOnce();
	await controller.clear();

} );

it( 'does not reopen a preview that was closed while persistence was pending', async () => {

	const ready = viewport();
	const controller = new ShotPreviewController( { createViewport: async () => ready } );
	await controller.show( input( 'A' ) );
	controller.suspend();
	await controller.clear( 'Closed during save' );
	expect( await controller.syncSavedDocument( input( 'A' ).document ) ).toBe( false );
	expect( controller.runtime ).toBe( null );
	expect( controller.state.status ).toBe( 'Closed during save' );

} );

it( 'selects another compatible shot and exact timeline frame using the same viewer', async () => {

	const ready = viewport();
	ready.canUpdate = vi.fn().mockReturnValue( true );
	ready.updateDocument = vi.fn().mockResolvedValue();
	ready.renderFrame = vi.fn().mockResolvedValue();
	ready.setInteractive = vi.fn();
	const createViewport = vi.fn().mockResolvedValue( ready );
	const controller = new ShotPreviewController( { createViewport } );
	const document = { shots: { A: { name: 'Wide' }, B: { name: 'Close' } } };
	await controller.show( { document, shotId: 'A' } );
	expect( ready.setInteractive ).toHaveBeenLastCalledWith( true );
	expect( await controller.seek( { document, shotId: 'B', frame: 72 } ) ).toBe( true );
	expect( createViewport ).toHaveBeenCalledOnce();
	expect( ready.dispose ).not.toHaveBeenCalled();
	expect( ready.updateDocument ).toHaveBeenLastCalledWith( document, 'B', { signal: expect.any( AbortSignal ) } );
	expect( ready.renderFrame ).toHaveBeenLastCalledWith( 72, { signal: expect.any( AbortSignal ) } );
	expect( controller.state ).toMatchObject( { phase: 'ready', shotId: 'B', frame: 72, interactive: false } );
	expect( ready.setInteractive ).toHaveBeenLastCalledWith( false );
	await controller.select( { document, shotId: 'B' } );
	expect( ready.setInteractive ).toHaveBeenLastCalledWith( true );
	await controller.clear();

} );

it( 'drains a superseded frame before rendering the latest requested timeline frame', async () => {

	const ready = viewport(), held = deferred(), entered = deferred();
	ready.canUpdate = () => true;
	ready.updateDocument = vi.fn().mockResolvedValue();
	ready.setInteractive = vi.fn();
	const frames = [];
	ready.renderFrame = async ( frame, options ) => {

		frames.push( frame );
		if ( frame === 10 ) {

			entered.resolve( options ); await held.promise;

		}

	};

	const controller = new ShotPreviewController( { createViewport: async () => ready } );
	await controller.show( input( 'A' ) );
	const first = controller.renderFrame( 10 );
	const options = await entered.promise;
	const second = controller.renderFrame( 25 );
	expect( options.signal.aborted ).toBe( true );
	expect( frames ).toEqual( [ 0, 10 ] );
	expect( ready.setInteractive ).toHaveBeenLastCalledWith( false );
	held.resolve();
	expect( await first ).toBe( false );
	expect( await second ).toBe( true );
	expect( frames ).toEqual( [ 0, 10, 25 ] );
	expect( controller.state ).toMatchObject( { phase: 'ready', frame: 25, interactive: false } );
	await controller.clear();

} );

it( 'disposes an incompatible scene before constructing a replacement viewer', async () => {

	const old = viewport(), next = viewport(), cleanup = deferred();
	old.canUpdate = () => false;
	old.dispose.mockReturnValue( cleanup.promise );
	const createViewport = vi.fn().mockResolvedValueOnce( old ).mockResolvedValueOnce( next );
	const controller = new ShotPreviewController( { createViewport } );
	await controller.show( input( 'A' ) );
	const selected = controller.select( input( 'B' ) );
	await Promise.resolve();
	expect( old.dispose ).toHaveBeenCalledOnce();
	expect( createViewport ).toHaveBeenCalledOnce();
	cleanup.resolve();
	expect( await selected ).toBe( true );
	expect( controller.runtime ).toBe( next );
	await controller.clear();

} );

it( 'forwards camera commits only from the current interactive viewer and current selected shot', async () => {

	const old = viewport(), next = viewport(), onCameraChange = vi.fn();
	old.canUpdate = () => true;
	old.updateDocument = vi.fn().mockResolvedValue();
	const callbacks = [];
	const controller = new ShotPreviewController( { onCameraChange, createViewport: async options => {

		callbacks.push( options.onCameraChange ); return callbacks.length === 1 ? old : next;

	} } );
	await controller.show( input( 'A' ) );
	const camera = { transform: { position: [ 1, 2, 3 ] } };
	callbacks[ 0 ]( camera );
	expect( onCameraChange ).toHaveBeenLastCalledWith( camera, { shotId: 'A' } );
	expect( onCameraChange.mock.calls[ 0 ][ 0 ] ).not.toBe( camera );
	controller.suspend(); callbacks[ 0 ]( camera );
	expect( onCameraChange ).toHaveBeenCalledOnce();
	await controller.select( input( 'B' ) );
	callbacks[ 0 ]( camera );
	expect( onCameraChange ).toHaveBeenLastCalledWith( camera, { shotId: 'B' } );
	await controller.seek( { ...input( 'B' ), frame: 15 } );
	callbacks[ 0 ]( camera );
	expect( onCameraChange ).toHaveBeenCalledTimes( 2 );
	await controller.show( input( 'C' ) );
	callbacks[ 0 ]( camera );
	expect( onCameraChange ).toHaveBeenCalledTimes( 2 );
	callbacks[ 1 ]( camera );
	expect( onCameraChange ).toHaveBeenLastCalledWith( camera, { shotId: 'C' } );
	await controller.clear();
	callbacks[ 1 ]( camera );
	expect( onCameraChange ).toHaveBeenCalledTimes( 3 );

} );

it( 'does not commit a camera captured across a selection or close boundary', async () => {

	const ready = viewport(), held = deferred();
	ready.captureCamera = vi.fn().mockReturnValue( held.promise );
	const controller = new ShotPreviewController( { createViewport: async () => ready } );
	await controller.show( input( 'A' ) );
	const captured = controller.captureCamera();
	controller.suspend();
	held.resolve( { transform: { position: [ 1, 2, 3 ] } } );
	expect( await captured ).toBe( null );
	expect( await controller.captureCamera() ).toBe( null );
	await controller.clear();

} );

it( 'renders successive frames without reapplying an unchanged saved revision or shot', async () => {

	const ready = viewport();
	ready.canUpdate = vi.fn().mockReturnValue( true );
	ready.updateDocument = vi.fn().mockResolvedValue();
	ready.renderFrame = vi.fn().mockResolvedValue();
	const controller = new ShotPreviewController( { createViewport: async () => ready } );
	const document = input( 'A' ).document;
	await controller.show( { document, shotId: 'A' } );
	await controller.seek( { document: structuredClone( document ), shotId: 'A', frame: 1 } );
	await controller.seek( { document, shotId: 'A', frame: 2 } );
	expect( ready.updateDocument ).not.toHaveBeenCalled();
	expect( ready.canUpdate ).not.toHaveBeenCalled();
	expect( ready.renderFrame.mock.calls.map( ( [ frame ] ) => frame ) ).toEqual( [ 0, 1, 2 ] );
	document.shots.A.name = 'Saved revision';
	await controller.seek( { document, shotId: 'A', frame: 3 } );
	expect( ready.updateDocument ).toHaveBeenCalledOnce();
	expect( ready.canUpdate ).toHaveBeenCalledOnce();
	await controller.seek( { document, shotId: 'A', frame: 4 } );
	expect( ready.updateDocument ).toHaveBeenCalledOnce();
	expect( ready.canUpdate ).toHaveBeenCalledOnce();
	await controller.clear();

} );

it( 'marks navigation dirty only for the current ready interactive viewer', async () => {

	const old = viewport(), next = viewport(), onNavigationStart = vi.fn();
	old.canUpdate = () => true;
	old.updateDocument = vi.fn().mockResolvedValue();
	const starts = [];
	const controller = new ShotPreviewController( { onNavigationStart, createViewport: async options => {

		starts.push( options.onNavigationStart );
		options.onNavigationStart();
		return starts.length === 1 ? old : next;

	} } );
	await controller.show( input( 'A' ) );
	expect( onNavigationStart ).not.toHaveBeenCalled();
	starts[ 0 ]();
	expect( onNavigationStart ).toHaveBeenLastCalledWith( { shotId: 'A' } );
	controller.suspend(); starts[ 0 ]();
	expect( onNavigationStart ).toHaveBeenCalledOnce();
	await controller.select( input( 'B' ) );
	starts[ 0 ]();
	expect( onNavigationStart ).toHaveBeenLastCalledWith( { shotId: 'B' } );
	await controller.seek( { ...input( 'B' ), frame: 1 } );
	starts[ 0 ]();
	expect( onNavigationStart ).toHaveBeenCalledTimes( 2 );
	await controller.show( input( 'C' ) );
	starts[ 0 ]();
	expect( onNavigationStart ).toHaveBeenCalledTimes( 2 );
	starts[ 1 ]();
	expect( onNavigationStart ).toHaveBeenLastCalledWith( { shotId: 'C' } );
	await controller.clear();
	starts[ 1 ]();
	expect( onNavigationStart ).toHaveBeenCalledTimes( 3 );

} );

it( 'reports current navigation failures after a compatible revision and ignores stale errors', async () => {

	const ready = viewport(), next = viewport(), callbacks = [];
	ready.canUpdate = () => true;
	ready.updateDocument = vi.fn().mockResolvedValue();
	ready.setInteractive = vi.fn();
	const onChange = vi.fn();
	const controller = new ShotPreviewController( { onChange, createViewport: async options => {

		callbacks.push( options.onError );
		options.onError( new Error( 'Not ready yet' ) );
		return callbacks.length === 1 ? ready : next;

	} } );
	await controller.show( input( 'A' ) );
	const saved = input( 'A' ).document; saved.shots.A.name = 'Saved update';
	await controller.syncSavedDocument( saved );
	expect( controller.state.phase ).toBe( 'ready' );
	expect( () => callbacks[ 0 ]( new Error( 'GPU draw failed' ) ) ).not.toThrow();
	expect( controller.state.phase ).toBe( 'error' );
	expect( controller.state.status ).toContain( 'Camera navigation unavailable: GPU draw failed' );
	expect( controller.state.status ).toContain( 'Saved project settings remain on this device' );
	expect( ready.setInteractive ).toHaveBeenLastCalledWith( false );
	expect( controller.document.shots.A.name ).toBe( 'Saved update' );
	await controller.show( input( 'B' ) );
	const calls = onChange.mock.calls.length;
	callbacks[ 0 ]( new Error( 'Old renderer failed' ) );
	expect( onChange ).toHaveBeenCalledTimes( calls );
	expect( controller.state.phase ).toBe( 'ready' );
	await controller.clear();
	callbacks[ 1 ]( new Error( 'Closed renderer failed' ) );
	expect( controller.state.phase ).toBe( 'idle' );

} );
