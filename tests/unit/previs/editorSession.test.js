import { getPlateLibraryService } from '../../../app/src/services/plates/PlateLibraryService.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorSession } from '../../../app/src/student/editor/EditorSession.js';
import { studentFixture } from './studentFixtures.js';

const deferred = () => {

	let resolve;
	const promise = new Promise( done => {

		resolve = done;

	} );
	return { promise, resolve };

};

let frames;
beforeEach( () => {

	frames = new Map(); let id = 0;
	vi.stubGlobal( 'requestAnimationFrame', callback => {

		frames.set( ++ id, callback ); return id;

	} );
	vi.stubGlobal( 'cancelAnimationFrame', handle => frames.delete( handle ) );
	vi.stubGlobal( 'localStorage', { getItem: vi.fn(), setItem: vi.fn() } );
	vi.spyOn( performance, 'now' ).mockReturnValue( 0 );

} );
afterEach( () => {

	vi.restoreAllMocks(); vi.unstubAllGlobals();

} );

function setup() {

	const document = studentFixture();
	const repository = { save: vi.fn( async document => structuredClone( document ) ), list: vi.fn().mockResolvedValue( [] ) };
	const runtime = {
		shotId: 'shotA', camera: structuredClone( document.shots.shotA.snapshot.camera ), canvas: {},
		canUpdate: vi.fn().mockReturnValue( true ), setInteractive: vi.fn(), dispose: vi.fn().mockResolvedValue(),
		setViewMode: vi.fn().mockResolvedValue(), renderFrame: vi.fn().mockResolvedValue(),
		captureCamera: vi.fn( async () => structuredClone( runtime.camera ) ),
		updateDocument: vi.fn( async ( document, shotId ) => {

			runtime.shotId = shotId; runtime.camera = structuredClone( document.shots[ shotId ].snapshot.camera );

		} ),
	};
	const createViewport = vi.fn().mockResolvedValue( runtime );
	const session = new EditorSession( { repository, presetRepository: null, narration: { stopPlayback: vi.fn(), play: vi.fn(), dispose: vi.fn() }, createViewport, catalogue: {} } );
	session.runtime = runtime; session.runtimeDocument = document;
	session.thumbnail = vi.fn(); session.prepareGallery = vi.fn().mockResolvedValue();
	session.set( { document, ready: true, frame: 0, selectedClipId: 'clipA', mode: 'shot' } );
	return { session, runtime, document, repository, createViewport };

}

it( 'orders local and cloud projects when timestamps use different formats', async () => {

	const { session, repository, document } = setup();
	repository.list.mockResolvedValue( [ { ...document, projectId: 'local', updatedAt: '2026-11-02T01:00:00.000Z' } ] );
	repository.accountSummaries = vi.fn().mockResolvedValue( [ { projectId: 'cloud', name: 'Cloud', updatedAt: Date.parse( '2026-11-02T02:00:00.000Z' ) } ] );
	session.accountContext = {};
	await session.refreshProjects();
	expect( session.state.projects.map( project => project.projectId ) ).toEqual( [ 'cloud', 'local' ] );
	expect( session.state.projects.map( project => project.local ) ).toEqual( [ false, true ] );

} );

it( 'prepares a new angle on the existing viewport while retaining the ready picture and scene resources', async () => {

	const { session, runtime, document, createViewport } = setup();
	runtime.canUpdate.mockReturnValue( false );
	runtime.prepareShot = vi.fn( async () => {

		expect( session.state.ready ).toBe( true );
		expect( session.runtime ).toBe( runtime );
		runtime.canUpdate.mockReturnValue( true );
		return true;

	} );
	await session.showFrame( 26 );
	expect( runtime.prepareShot ).toHaveBeenCalledWith( document, 'shotB' );
	expect( runtime.dispose ).not.toHaveBeenCalled();
	expect( createViewport ).not.toHaveBeenCalled();
	expect( session.state.ready ).toBe( true );
	expect( runtime.renderFrame ).toHaveBeenLastCalledWith( 1, { timelineFrame: 26 } );

} );

it.each( [ 'shot', 'inspection' ] )( 'retains one workspace camera across viewport rebuilds while in %s mode', async mode => {

	const { session, runtime, document, createViewport, repository } = setup();
	const inspection = structuredClone( document.shots.shotA.snapshot.camera );
	inspection.transform.position = [ 12, 8, - 4 ]; inspection.target = [ 2, 1, 0 ];
	runtime.captureInspectionCamera = vi.fn().mockResolvedValue( inspection );
	runtime.canUpdate.mockReturnValue( false );
	session.resolveCatalogue = vi.fn().mockResolvedValue( {} );
	session.set( { mode } );
	const next = { ...runtime, shotId: 'shotB', captureInspectionCamera: vi.fn(), dispose: vi.fn() };
	createViewport.mockResolvedValueOnce( next );
	const authored = structuredClone( document.shots );
	await session.showFrame( 26 );
	expect( createViewport.mock.calls[ 0 ][ 0 ].inspectionCamera ).toEqual( inspection );
	expect( createViewport.mock.calls[ 0 ][ 0 ].inspectionCamera ).not.toBe( inspection );
	expect( runtime.captureInspectionCamera ).toHaveBeenCalledOnce();
	expect( runtime.dispose ).toHaveBeenCalledOnce();

	// Moving the viewport in shot B replaces the single workspace pose. Returning
	// to shot A must use this latest pose, rather than A's earlier viewport pose.
	const latest = structuredClone( inspection ); latest.transform.position = [ 22, 9, 3 ];
	next.captureInspectionCamera.mockResolvedValue( latest );
	createViewport.mockResolvedValueOnce( { ...runtime, shotId: 'shotA' } );
	await session.showFrame( 0 );
	expect( createViewport.mock.calls[ 1 ][ 0 ].inspectionCamera ).toEqual( latest );
	expect( session.state.mode ).toBe( mode );
	expect( document.shots ).toEqual( authored );
	expect( repository.save ).not.toHaveBeenCalled();

} );

it( 'does not destroy the existing viewport if preparing the next video fails', async () => {

	const { session, runtime, createViewport } = setup();
	runtime.canUpdate.mockReturnValue( false );
	runtime.prepareShot = vi.fn().mockRejectedValue( new Error( 'Video integrity check failed' ) );
	await expect( session.showFrame( 26 ) ).rejects.toThrow( 'integrity check' );
	expect( runtime.dispose ).not.toHaveBeenCalled();
	expect( createViewport ).not.toHaveBeenCalled();
	expect( session.runtime ).toBe( runtime );

} );

it( 'flushes a pending authoring camera gesture before Stop restores a frame', async () => {

	const { session, runtime, repository } = setup();
	runtime.camera.transform.position[ 0 ] = 3;
	session.set( { dirty: true } );
	await session.stop();
	expect( repository.save ).toHaveBeenCalledOnce();
	expect( session.state.document.shots.shotA.snapshot.camera.transform.position[ 0 ] ).toBe( 3 );
	expect( session.state.dirty ).toBe( false );
	expect( session.state.pending ).toBe( false );
	expect( runtime.renderFrame ).toHaveBeenCalled();

} );

it( 'builds an inspector command from the latest document after navigation has saved', async () => {

	const { session, runtime, repository } = setup();
	runtime.camera.transform.position[ 1 ] = 2.1;
	const build = vi.fn( document => ( { type: 'renameProject', name: `Camera at ${document.shots.shotA.snapshot.camera.transform.position[ 1 ]}` } ) );
	await session.edit( build );
	expect( build ).toHaveBeenCalledOnce();
	expect( repository.save ).toHaveBeenCalledTimes( 2 );
	expect( session.state.document.name ).toBe( 'Camera at 2.1' );
	expect( session.state.document.revision ).toBe( 2 );

} );

it( 'keeps failed camera saves pending and prevents Stop from replacing the attempted pose', async () => {

	const { session, runtime, repository } = setup();
	runtime.camera.transform.position[ 0 ] = 7;
	repository.save.mockRejectedValueOnce( new Error( 'Device full' ) );
	await session.stop();
	expect( session.state.pending ).toBe( true );
	expect( session.state.ready ).toBe( false );
	expect( session.state.document.shots.shotA.snapshot.camera.transform.position[ 0 ] ).toBe( 7 );
	expect( runtime.renderFrame ).not.toHaveBeenCalled();
	expect( runtime.setInteractive ).toHaveBeenLastCalledWith( false );
	await session.seek( 30 );
	expect( runtime.renderFrame ).not.toHaveBeenCalled();

} );

it( 'serializes a pending playback frame before a newer seek and suppresses its stale selection', async () => {

	const { session, runtime } = setup();
	const held = deferred(), entered = deferred();
	runtime.renderFrame.mockImplementation( async frame => {

		if ( frame === 10 ) {

			entered.resolve(); await held.promise;

		}

	} );
	await session.playPause();
	const tick = [ ...frames.values() ][ 0 ]; frames.clear();
	const playingFrame = tick( 400 );
	await entered.promise;
	const seek = session.seek( 30 );
	expect( runtime.renderFrame.mock.calls.map( ( [ frame ] ) => frame ) ).toEqual( [ 0, 10 ] );
	held.resolve(); await playingFrame; await seek;
	expect( runtime.renderFrame.mock.calls.map( ( [ frame ] ) => frame ) ).toEqual( [ 0, 10, 0, 5 ] );
	expect( session.state.frame ).toBe( 30 );
	expect( session.state.selectedClipId ).toBe( 'clipB' );
	expect( session.state.playing ).toBe( false );
	expect( frames.size ).toBe( 0 );

} );

it( 'keeps the inspection camera during playback and drains frames before Pause without authoring edits', async () => {

	const { session, runtime, repository } = setup();
	session.set( { mode: 'inspection' } );
	const entered = deferred(), held = deferred();
	runtime.renderFrame.mockImplementation( async frame => {

		if ( frame === 4 ) {

			entered.resolve(); await held.promise;

		}

	} );
	await session.playPause();
	const tick = [ ...frames.values() ][ 0 ]; frames.clear();
	const playingFrame = tick( 160 ); await entered.promise;
	const pause = session.playPause();
	expect( runtime.setViewMode ).toHaveBeenLastCalledWith( 'inspection' );
	held.resolve(); await playingFrame; await pause;
	expect( runtime.setViewMode ).toHaveBeenLastCalledWith( 'inspection' );
	expect( session.state.mode ).toBe( 'inspection' );
	expect( session.state.frame ).toBe( 0 );
	expect( runtime.renderFrame ).toHaveBeenLastCalledWith( 0, { timelineFrame: 0 } );
	expect( repository.save ).not.toHaveBeenCalled();
	expect( runtime.setInteractive ).toHaveBeenLastCalledWith( true );

} );

it.each( [ 'shot', 'inspection' ] )( 'retains %s view throughout playback and a shot cut', async mode => {

	const { session, runtime, repository } = setup();
	runtime.viewMode = mode;
	runtime.setViewMode.mockImplementation( async value => {

		runtime.viewMode = value;

	} );
	session.set( { mode } );
	await session.playPause();
	const tick = [ ...frames.values() ][ 0 ]; frames.clear();
	await tick( 1040 );
	expect( session.state.selectedClipId ).toBe( 'clipB' );
	expect( runtime.viewMode ).toBe( mode );
	expect( runtime.setViewMode ).not.toHaveBeenCalledWith( mode === 'shot' ? 'inspection' : 'shot' );
	expect( repository.save ).not.toHaveBeenCalled();
	await session.playPause();

} );

it( 'ignores superseded seeks already waiting in the authoring queue', async () => {

	const { session, runtime } = setup();
	const held = deferred(); session.tail = held.promise;
	const first = session.seek( 30 ), latest = session.seek( 4 );
	held.resolve(); await first; await latest;
	expect( runtime.renderFrame.mock.calls.map( ( [ frame ] ) => frame ) ).toEqual( [ 4 ] );
	expect( session.state.frame ).toBe( 4 );

} );

it( 'reports an empty imported project explicitly instead of leaving an opening spinner message', async () => {

	const { session, runtime, document } = setup();
	const empty = structuredClone( document ); empty.clips = [];
	await session.action( () => session.openDocument( empty ) );
	expect( runtime.dispose ).toHaveBeenCalledOnce();
	expect( session.state.loading ).toContain( 'no timeline placements' );
	expect( session.state.ready ).toBe( false );
	expect( session.state.selectedClipId ).toBe( null );

} );

it( 'guards old runtime errors and keeps a current navigation failure disabled until reload', async () => {

	const { session, runtime, document, createViewport } = setup();
	session.runtime = null;
	await session.showFrame( 0 );
	const callbacks = createViewport.mock.calls[ 0 ][ 0 ];
	callbacks.onNavigationStart();
	expect( session.state.dirty ).toBe( true );
	callbacks.onError( new Error( 'GPU failed' ) );
	expect( session.state.ready ).toBe( false );
	expect( session.state.dirty ).toBe( true );
	expect( session.state.error ).toContain( 'Saved project settings are unchanged' );
	await session.action( async () => {}, { flush: false } );
	expect( runtime.setInteractive ).toHaveBeenLastCalledWith( false );
	await session.action( () => session.openDocument( { ...document, projectId: 'another' } ), { flush: false } );
	const status = session.state.error;
	callbacks.onError( new Error( 'Stale GPU failed' ) );
	expect( session.state.error ).toBe( status );
	expect( session.state.ready ).toBe( true );

} );


it( 'stops a playback start that was queued ahead of a seek request', async () => {

	const { session, runtime } = setup();
	const play = session.playPause();
	const seek = session.seek( 30 );
	await play; await seek;
	expect( session.state.playing ).toBe( false );
	expect( session.state.frame ).toBe( 30 );
	expect( runtime.renderFrame ).toHaveBeenLastCalledWith( 5, { timelineFrame: 30 } );
	expect( frames.size ).toBe( 0 );

} );

it( 'keeps a committed revision saved when only the subsequent scene refresh fails', async () => {

	const { session, runtime, repository } = setup();
	runtime.renderFrame.mockRejectedValueOnce( new Error( 'Missing video frame' ) );
	await session.edit( { type: 'renameProject', name: 'Durable new name' } );
	expect( repository.save ).toHaveBeenCalledOnce();
	expect( session.state.document.name ).toBe( 'Durable new name' );
	expect( session.state.document.revision ).toBe( 1 );
	expect( session.state.pending ).toBe( false );
	expect( session.state.status ).toBe( 'Saved on this device' );
	expect( session.state.error ).toContain( 'Project saved; scene refresh failed' );
	expect( session.state.ready ).toBe( false );
	expect( runtime.setInteractive ).toHaveBeenLastCalledWith( false );

} );

it( 'captures the newly added shot after selection without persisting an extra revision', async () => {

	const { session, runtime, repository } = setup();
	await session.addShot();
	const added = session.state.document.clips.at( - 1 );
	expect( runtime.shotId ).toBe( added.shotId );
	expect( session.state.selectedClipId ).toBe( added.clipId );
	expect( session.thumbnail ).toHaveBeenLastCalledWith( added.shotId );
	expect( repository.save ).toHaveBeenCalledOnce();
	expect( session.state.document.revision ).toBe( 1 );

} );

it( 'captures edited shot thumbnails in shot mode and always restores inspection, including capture failure', async () => {

	const { session, runtime, repository, document } = setup();
	const cameraBefore = structuredClone( document.shots.shotA.snapshot.camera );
	const inspection = { position: [ 8, 6, 4 ], target: [ 1, 0, 0 ] };
	runtime.inspectionCamera = structuredClone( inspection ); runtime.viewMode = 'inspection';
	runtime.setViewMode.mockImplementation( async mode => {

		runtime.viewMode = mode;

	} );
	session.set( { mode: 'inspection' } );
	session.thumbnail.mockImplementation( () => {

		expect( runtime.viewMode ).toBe( 'shot' ); return 'data:image/jpeg;shot';

	} );
	await session.edit( { type: 'renameProject', name: 'Edited while inspecting' } );
	expect( session.thumbnail ).toHaveBeenCalledWith( 'shotA' );
	expect( runtime.viewMode ).toBe( 'inspection' );
	expect( runtime.inspectionCamera ).toEqual( inspection );
	expect( session.state.document.shots.shotA.snapshot.camera ).toEqual( cameraBefore );
	expect( repository.save ).toHaveBeenCalledOnce();
	session.thumbnail.mockImplementationOnce( () => {

		throw new Error( 'Canvas read failed' );

	} );
	await expect( session.captureShotThumbnail() ).rejects.toThrow( 'Canvas read failed' );
	expect( runtime.viewMode ).toBe( 'inspection' );
	expect( runtime.inspectionCamera ).toEqual( inspection );
	expect( repository.save ).toHaveBeenCalledOnce();

} );

function libraryRecord( document, revision = 0 ) {

	return { presetId: 'wide', revision, name: `Admin preset ${revision}`, thumbnail: new Blob( [ 'thumbnail' ], { type: 'image/jpeg' } ), studentPreset: { format: 'rayzee-student-preset', schemaVersion: 1, presetId: 'wide', version: String( revision + 1 ), name: `Admin preset ${revision}`, description: '', category: 'Studio', defaultDurationFrames: 125, thumbnail: null, assets: structuredClone( document.assets ), baseScene: structuredClone( document.baseScenes[ 'studio@1' ] ), snapshot: structuredClone( document.shots.shotA.snapshot ) } };

}

it( 'refreshes renamed admin presets and thumbnails without changing student edits or interrupting playback', async () => {

	const { session, runtime, document, repository } = setup();
	const original = structuredClone( document );
	const first = libraryRecord( document ), next = libraryRecord( document, 1 );
	next.studentPreset.snapshot.camera.transform.position[ 0 ] = 42;
	const create = vi.spyOn( URL, 'createObjectURL' ).mockReturnValueOnce( 'blob:first' ).mockReturnValueOnce( 'blob:next' );
	const revoke = vi.spyOn( URL, 'revokeObjectURL' ).mockImplementation( () => {} );
	session.presetRepository = { list: vi.fn().mockResolvedValueOnce( [ first ] ).mockResolvedValueOnce( [ next ] ) };
	session.set( { playing: true, dirty: true } );
	await session.refreshPresets(); await session.refreshPresets();
	expect( session.state.presets[ 0 ] ).toMatchObject( { name: 'Admin preset 1', revision: 1, thumbnail: 'blob:next' } );
	expect( session.state.presets[ 0 ].camera.transform.position[ 0 ] ).toBe( 42 );
	expect( session.state.document ).toEqual( original );
	expect( session.state.playing ).toBe( true ); expect( session.state.dirty ).toBe( true );
	expect( repository.save ).not.toHaveBeenCalled(); expect( runtime.updateDocument ).not.toHaveBeenCalled();
	expect( create ).toHaveBeenCalledTimes( 2 ); expect( revoke ).toHaveBeenCalledWith( 'blob:first' );
	await session.dispose(); expect( revoke ).toHaveBeenCalledWith( 'blob:next' );

} );

it( 'applies library object transforms and visibility together with the camera in one edit', async () => {

	const { session, document, runtime, createViewport, repository } = setup();
	const record = libraryRecord( document );
	record.studentPreset.snapshot.camera.transform.position[ 0 ] = 12;
	record.studentPreset.snapshot.lights[ 0 ].intensity = 500;
	record.studentPreset.snapshot.nodes.carInstance.transform.position = [ 4, 0, 2 ];
	record.studentPreset.snapshot.nodes.carInstance.transform.visible = false;
	await session.applyPreset( { camera: record.studentPreset.snapshot.camera, studentPreset: record.studentPreset } );
	expect( session.state.document.shots.shotA.snapshot.camera.transform.position[ 0 ] ).toBe( 12 );
	expect( session.state.document.shots.shotA.snapshot.lights ).toEqual( document.shots.shotA.snapshot.lights );
	expect( createViewport ).not.toHaveBeenCalled();
	expect( runtime.dispose ).not.toHaveBeenCalled();
	expect( repository.save ).toHaveBeenCalledOnce();
	expect( session.state.document.shots.shotA.snapshot.nodes.carInstance.transform.position ).toEqual( [ 4, 0, 2 ] );
	expect( session.state.document.shots.shotA.snapshot.nodes.carInstance.transform.visible ).toBe( false );
	expect( session.state.document.shots.shotB ).toEqual( document.shots.shotB );
	expect( session.state.document.clips ).toHaveLength( 2 );

} );

it( 'uses preset transforms as a detached shot while preserving project resources and existing shots', async () => {

	const { session, document, repository } = setup();
	const record = libraryRecord( document, 2 );
	record.studentPreset.snapshot.lights[ 0 ].intensity = 500;
	await session.addScenePreset( { studentPreset: record.studentPreset } );
	const clip = session.state.document.clips.at( - 1 ), added = session.state.document.shots[ clip.shotId ];
	expect( session.state.document.clips ).toHaveLength( 3 );
	expect( clip.durationFrames ).toBe( 125 ); expect( session.state.frame ).toBe( 50 );
	expect( session.state.selectedClipId ).toBe( clip.clipId );
	expect( added.sourcePreset ).toEqual( { presetId: 'wide', version: '3' } );
	expect( added.snapshot.lights[ 0 ].intensity ).toBe( 500 );
	expect( session.state.document.shots.shotA ).toEqual( document.shots.shotA );
	expect( session.state.document.shots.shotB ).toEqual( document.shots.shotB );
	record.studentPreset.snapshot.lights[ 0 ].intensity = 999;
	expect( added.snapshot.lights[ 0 ].intensity ).toBe( 500 );
	expect( repository.save ).toHaveBeenCalledOnce();

} );

it( 'applying placement preserves current video and lights even when the preset requires other resources', async () => {

	const { session, document, repository } = setup();
	const record = libraryRecord( document );
	record.studentPreset.assets[ 'rear@1' ] = { ...document.assets[ 'video@1' ], assetId: 'rear', sha256: 'e'.repeat( 64 ), durationUs: 180000000 };
	Object.assign( record.studentPreset.snapshot.ledWalls[ 0 ], { media: { assetId: 'rear', version: '1' }, mode: 'freeze', inPointUs: 42320000, loop: false } );
	record.studentPreset.snapshot.lights = [];
	record.studentPreset.snapshot.camera.transform.position[ 0 ] += 3;
	await session.applyPreset( { studentPreset: record.studentPreset } );
	expect( session.state.error ).toBe( '' );
	expect( session.state.document.shots.shotA.snapshot.ledWalls ).toEqual( document.shots.shotA.snapshot.ledWalls );
	expect( session.state.document.shots.shotA.snapshot.lights ).toEqual( document.shots.shotA.snapshot.lights );
	expect( session.state.document.assets ).toEqual( document.assets );
	expect( session.state.document.shots.shotB ).toEqual( document.shots.shotB );
	expect( repository.save ).toHaveBeenCalledOnce();
	await session.undoEdit();
	expect( session.state.document.shots ).toEqual( document.shots );
	expect( session.state.document.assets ).toEqual( document.assets );

} );

it( 'includes the authored plate when adding a preset shot to an existing project', async () => {

	const { session, document } = setup(), record = libraryRecord( document );
	record.studentPreset.assets[ 'left@1' ] = { ...document.assets[ 'video@1' ], assetId: 'left' };
	record.studentPreset.snapshot.ledWalls[ 0 ].media = { assetId: 'left', version: '1' };
	await session.addScenePreset( { studentPreset: record.studentPreset } );
	expect( session.state.error ).toBe( '' );
	const added = session.state.document.shots[ session.state.document.clips.at( - 1 ).shotId ];
	expect( added.snapshot.ledWalls[ 0 ].media.assetId ).toBe( 'left' );
	expect( session.state.document.assets[ 'left@1' ] ).toEqual( record.studentPreset.assets[ 'left@1' ] );

} );

it( 'suppresses stale library responses and disposes their subscription', async () => {

	const { session, document } = setup(), held = deferred();
	session.unsubscribePresets = vi.fn();
	session.presetRepository = { list: vi.fn().mockReturnValueOnce( held.promise ).mockResolvedValueOnce( [ { ...libraryRecord( document, 1 ), thumbnail: null } ] ) };
	const old = session.refreshPresets(); await session.refreshPresets();
	held.resolve( [ libraryRecord( document ) ] ); await old;
	expect( session.state.presets[ 0 ].revision ).toBe( 1 );
	await session.dispose(); expect( session.unsubscribePresets ).toHaveBeenCalledOnce();

} );

it( 'starts a new sequence from a published scene preset in one initial save when no project is open', async () => {

	const { session, runtime, repository, document } = setup();
	const record = libraryRecord( document, 4 );
	session.runtime = null; session.set( { document: null, ready: false, presets: [] } );
	await session.addScenePreset( { name: record.name, studentPreset: record.studentPreset } );
	expect( repository.save ).toHaveBeenCalledOnce();
	expect( repository.save.mock.calls[ 0 ][ 1 ] ).toEqual( { expectedRevision: null } );
	const saved = session.state.document, clip = saved.clips[ 0 ], shot = saved.shots[ clip.shotId ];
	expect( saved.name ).toBe( record.name ); expect( saved.revision ).toBe( 0 );
	expect( saved.clips ).toHaveLength( 1 ); expect( clip.durationFrames ).toBe( 125 );
	expect( shot.sourcePreset ).toEqual( { presetId: 'wide', version: '5' } );
	expect( shot.snapshot ).toEqual( record.studentPreset.snapshot );
	expect( session.state.ready ).toBe( true ); expect( session.state.selectedClipId ).toBe( clip.clipId );
	expect( runtime.renderFrame ).toHaveBeenCalledWith( 0, { timelineFrame: 0 } );

} );

it( 'rejects a preset from another project setup without adding assets or opening a viewport', async () => {

	const { session, document, repository, createViewport } = setup();
	const record = libraryRecord( document );
	record.studentPreset.baseScene.sceneId = 'house-setup';
	await session.addScenePreset( { studentPreset: record.studentPreset } );
	expect( session.state.error ).toContain( 'different scene setup' );
	expect( session.state.document ).toEqual( document );
	expect( repository.save ).not.toHaveBeenCalled();
	expect( createViewport ).not.toHaveBeenCalled();

} );

it( 'records from the playhead and commits local audio metadata and placement in one undoable revision', async () => {

	const { session, repository, document } = setup();
	session.playPause = vi.fn();
	session.set( { frame: 10 } );
	session.narration.start = vi.fn();
	session.narration.finish = vi.fn().mockResolvedValue( { ...structuredClone( document.narration.assets[ 'voice@1' ] ), assetId: 'new-voiceover' } );
	await session.recordVoiceover();
	expect( session.state.recording ).toBe( 'recording' );
	expect( session.narration.start ).toHaveBeenCalledWith( document.projectId, expect.any( Function ) );
	await session.finishVoiceover();
	expect( session.state.recording ).toBe( '' );
	expect( repository.save ).toHaveBeenCalledOnce();
	const added = session.state.document.narration.clips.at( - 1 );
	expect( added ).toMatchObject( { media: { assetId: 'new-voiceover', version: '1' }, anchor: { type: 'sequence' }, offsetFrames: 10, sourceStartSample: 0 } );
	await session.undoEdit();
	expect( session.state.document.narration ).toEqual( document.narration );

} );

it( 'keeps a take retryable without adding a clip when saving its audio fails', async () => {

	const { session, repository, document } = setup(); session.playPause = vi.fn();
	session.narration.start = vi.fn(); session.narration.finish = vi.fn().mockRejectedValue( new Error( 'Device storage is full' ) );
	await session.recordVoiceover(); await session.finishVoiceover();
	expect( session.state.recording ).toBe( 'save-error' );
	expect( session.state.error ).toContain( 'storage is full' );
	expect( session.state.document.narration ).toEqual( document.narration );
	expect( repository.save ).not.toHaveBeenCalled();

} );

it( 'reports microphone denial and returns to editing without changing the project', async () => {

	const { session, repository } = setup();
	session.narration.start = vi.fn().mockRejectedValue( new Error( 'Permission denied' ) );
	await session.recordVoiceover();
	expect( session.state.recording ).toBe( '' ); expect( session.state.error ).toContain( 'Permission denied' );
	expect( repository.save ).not.toHaveBeenCalled();

} );

it( 'prepares upcoming playback media before starting and changes shots on the existing runtime without edit writes', async () => {

	const { session, runtime, document, repository, createViewport } = setup();
	runtime.viewMode = 'shot'; runtime.preparePlayback = vi.fn().mockResolvedValue( true );
	await session.playPause();
	expect( runtime.preparePlayback ).toHaveBeenCalledWith( document, 0 );
	expect( session.state.playing ).toBe( true );
	const evaluator = session.sequenceFor();
	await session.showFrame( 26 );
	expect( runtime.updateDocument ).toHaveBeenCalledWith( document, 'shotB', { playback: true, timelineFrame: 26 } );
	expect( runtime.renderFrame ).toHaveBeenLastCalledWith( 1, { timelineFrame: 26 } );
	expect( runtime.setViewMode ).not.toHaveBeenCalled();
	expect( session.sequenceFor() ).toBe( evaluator );
	expect( repository.save ).not.toHaveBeenCalled(); expect( createViewport ).not.toHaveBeenCalled();
	await session.playPause();

} );

it( 'creates a separate local copy of the shared starting project for a new cloud student', async () => {

	const { session, repository, document } = setup();
	session.presetRepository = { storage: 'cloud' };
	session.startPresetLibrary = vi.fn().mockResolvedValue();
	session.refreshProjects = vi.fn().mockImplementation( async () => session.set( { projects: [] } ) );
	session.openDocument = vi.fn().mockResolvedValue();
	vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( new Response( JSON.stringify( document ), { status: 200, headers: { 'Content-Type': 'application/json' } } ) ) );
	await session.boot();
	expect( repository.save ).toHaveBeenCalledOnce();
	const saved = repository.save.mock.calls[ 0 ][ 0 ];
	expect( saved.projectId ).not.toBe( document.projectId );
	expect( saved.clips ).toEqual( document.clips );
	expect( session.openDocument ).toHaveBeenCalledWith( saved );

} );

it( 'reopens an existing cloud student project without replacing it with the shared starting project', async () => {

	const { session, repository, document } = setup();
	session.presetRepository = { storage: 'cloud' };
	session.startPresetLibrary = vi.fn().mockResolvedValue();
	session.refreshProjects = vi.fn().mockImplementation( async () => session.set( { projects: [ { projectId: document.projectId } ] } ) );
	session.openDocument = vi.fn().mockResolvedValue();
	repository.get = vi.fn().mockResolvedValue( document );
	vi.stubGlobal( 'fetch', vi.fn() );
	await session.boot();
	expect( session.openDocument ).toHaveBeenCalledWith( document );
	expect( repository.save ).not.toHaveBeenCalled();
	expect( fetch ).not.toHaveBeenCalled();

} );

it( 'selects a new plate set for the shot while preserving its existing camera angle', async () => {

	const { session } = setup();
	const service = getPlateLibraryService();
	vi.spyOn( service, 'ensure' ).mockResolvedValue( { encoding: 'h264' } );
	vi.spyOn( service, 'findAsset' ).mockResolvedValue( { view: 'rear' } );
	session.commit = vi.fn().mockResolvedValue();
	const manifest = { frameCount: 250, files: { 'rear-h264': { sha256: 'a'.repeat( 64 ), size: 500 } } };
	await session.selectDrivingPlateSet( manifest );
	const command = session.commit.mock.calls[ 0 ][ 0 ];
	const wall = command.shot.snapshot.ledWalls[ 0 ];
	expect( command.assets[ `${wall.media.assetId}@${wall.media.version}` ] ).toMatchObject( { sha256: 'a'.repeat( 64 ), byteLength: 500, durationUs: 10000000 } );
	expect( wall.inPointUs ).toBeLessThan( 10000000 );

} );
