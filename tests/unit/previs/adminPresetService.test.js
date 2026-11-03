import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectDocument } from '../../../app/src/services/projects/ProjectSchema.js';
import { PerspectiveCamera, Vector3, Scene, Object3D } from 'three';
import { studentFixture } from './studentFixtures.js';

const dependencies = vi.hoisted( () => ( {
	loading: { isLoading: false }, environment: { id: 'fixture-environment' }, camera: { focalLength: 35 },
	records: new Map(), chooseVideo: vi.fn(), missingMedia: [], setMissingMedia: vi.fn(),
} ) );
vi.mock( '../../../app/src/lib/appProxy.js', () => ( { getApp: () => null } ) );
vi.mock( '../../../app/src/Constants.js', () => ( { MODEL_FILES: [], DEFAULT_STATE: { environment: 'fixture-environment' } } ) );
vi.mock( '../../../app/src/store.js', () => ( {
	useStore: { getState: () => ( { loading: dependencies.loading } ) },
	useAssetsStore: { getState: () => ( { environment: dependencies.environment } ) },
	useCameraStore: { getState: () => dependencies.camera },
} ) );
vi.mock( '../../../app/src/services/projects/ProjectSession.js', () => ( { projectSession: {} } ) );
vi.mock( '../../../app/src/services/projects/projectStore.js', () => ( { useProjectStore: { getState: () => ( { missingMedia: dependencies.missingMedia, setMissingMedia: dependencies.setMissingMedia } ) } } ) );
vi.mock( '../../../app/src/services/EnvironmentService.js', () => ( { EnvironmentService: { getEnvironmentById: id => ( { id } ) } } ) );
vi.mock( '../../../app/src/services/LEDVideoManager.js', () => ( { LEDVideoManager: { records: dependencies.records, chooseVideo: dependencies.chooseVideo } } ) );
vi.mock( '../../../app/src/services/presets/LocalPresetSeeds.js', () => ( { ensureLocalPresetSeeds: vi.fn() } ) );
vi.mock( '../../../app/src/services/presets/CaptureAdminPreset.js', () => ( { captureAdminPreset: vi.fn() } ) );

import { AdminPresetService } from '../../../app/src/services/presets/AdminPresetService.js';

function fixture() {

	const originalDocument = createProjectDocument( { projectId: 'original-project', name: 'Original source' } );
	originalDocument.scene.nodes = { 'car:0': { position: [ 1, 2, 3 ], quaternion: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], visible: true } };
	const record = { presetId: 'cabin', revision: 5, name: 'Cabin', adminDocument: originalDocument, studentPreset: { snapshot: { camera: { exposure: 1 } } }, thumbnail: null };
	let notified;
	const repository = {
		subscribe: vi.fn( callback => {

			notified = callback; return vi.fn();

		} ),
		list: vi.fn( async () => [ structuredClone( record ) ] ),
		get: vi.fn( async () => structuredClone( record ) ),
		save: vi.fn( async ( input, { expectedRevision } ) => ( { ...structuredClone( input ), presetId: input.presetId || 'new-preset', revision: expectedRevision === null ? 0 : expectedRevision + 1 } ) ),
		rename: vi.fn( async ( presetId, name, { expectedRevision } ) => ( { ...structuredClone( record ), presetId, name, revision: expectedRevision + 1 } ) ),
		getAsset: vi.fn(),
	};
	const scene = new Scene(), car = new Object3D(); car.userData.__rayzeeProjectInstanceId = 'car'; scene.add( car );
	const app = { cameraManager: { controls: { enabled: true } }, meshScene: scene };
	const session = {
		current: createProjectDocument( { projectId: 'working-project' } ), hydrating: false,
		markDirty: vi.fn(), flush: vi.fn().mockResolvedValue(), capture: vi.fn( () => structuredClone( session.current ) ),
		hydrate: vi.fn( async document => {

			session.current = document;

		} ),
	};
	session.current.extensions = { projectPresets: { cabin: { state: { projectId: 'working-project', nodes: structuredClone( originalDocument.scene.nodes ), lights: [], camera: record.studentPreset.snapshot.camera } } } };
	const captureResult = { studentPreset: structuredClone( record.studentPreset ), assetBlobs: [], mediaBindings: { wall: { assetId: 'media', version: '1' } } };
	const capture = vi.fn().mockResolvedValue( captureResult );
	const thumbnailBlob = new Blob( [ 'thumbnail' ], { type: 'image/jpeg' } );
	const thumbnail = vi.fn().mockResolvedValue( thumbnailBlob );
	const ensureSeeds = vi.fn().mockResolvedValue();
	const service = new AdminPresetService( { repository, session, app: () => app, capture, thumbnail, ensureSeeds } );
	return { service, repository, session, app, record, originalDocument, capture, captureResult, thumbnail, thumbnailBlob, ensureSeeds, notify: () => notified() };

}

function videoRecord( uuid, paused = false ) {

	const video = { paused, pause: vi.fn( () => {

		video.paused = true;

	} ), play: vi.fn( async () => {

		video.paused = false;

	} ) };
	const record = { root: { uuid }, video };
	dependencies.records.set( uuid, record );
	return record;

}

beforeEach( () => {

	dependencies.records.clear();
	dependencies.loading.isLoading = false;
	vi.stubGlobal( 'window', new EventTarget() );

} );
afterEach( () => vi.unstubAllGlobals() );

describe( 'Admin preset editing and atomic capture coordination', () => {

	it( 'retries an uncertain new save with the exact prepared input and preserves subsequent scene edits', async () => {

		const { service, repository, session, app, capture, thumbnail } = fixture();
		const playing = videoRecord( 'playing-wall' );
		repository.save.mockRejectedValueOnce( Object.assign( new Error( 'Acknowledgement lost' ), { retryable: true, code: 'NETWORK' } ) );
		await expect( service.saveCurrent( { name: 'New shot', asNew: true } ) ).rejects.toThrow( 'Acknowledgement lost' );
		const [ preparedInput, preparedOptions ] = repository.save.mock.calls[ 0 ];
		const capturedPosition = structuredClone( preparedInput.adminDocument.scene );
		expect( app.cameraManager.controls.enabled ).toBe( true );
		expect( playing.video.play ).toHaveBeenCalledOnce();
		expect( service.getState() ).toMatchObject( { busy: false, retryPending: true } );
		session.current.scene.nodes = { changedLater: { position: [ 7, 8, 9 ] } };
		session.current.updatedAt = '2026-10-24T01:00:00.000Z';
		await service.retryPendingSave();
		expect( repository.save ).toHaveBeenCalledTimes( 2 );
		expect( repository.save.mock.calls[ 1 ][ 0 ] ).toBe( preparedInput );
		expect( repository.save.mock.calls[ 1 ][ 1 ] ).toBe( preparedOptions );
		expect( preparedInput.adminDocument.scene ).toEqual( capturedPosition );
		expect( capture ).toHaveBeenCalledOnce();
		expect( thumbnail ).toHaveBeenCalledOnce();
		expect( session.flush ).toHaveBeenCalledOnce();
		expect( playing.video.pause ).toHaveBeenCalledOnce();
		expect( playing.video.play ).toHaveBeenCalledOnce();
		expect( session.current.scene.nodes ).toHaveProperty( 'changedLater' );
		expect( service.getState() ).toMatchObject( { busy: false, retryPending: false, selectedPresetId: 'new-preset', error: '' } );
		expect( service.getState().status ).toContain( 'Current scene changes have not been saved' );

	} );

	it( 'blocks a second capture, preset load and rename until an uncertain save is resolved', async () => {

		const { service, repository, capture } = fixture();
		repository.save.mockRejectedValueOnce( Object.assign( new Error( 'Network' ), { retryable: true } ) );
		await expect( service.saveCurrent( { name: 'First', asNew: true } ) ).rejects.toThrow( 'Network' );
		await expect( service.saveCurrent( { name: 'Second', asNew: true } ) ).rejects.toThrow( 'Retry the previous preset save' );
		await expect( service.selectPreset( 'cabin' ) ).rejects.toThrow( 'Retry the previous preset save' );
		await expect( service.renamePreset( 'cabin', 'Rename' ) ).rejects.toThrow( 'Retry the previous preset save' );
		expect( capture ).toHaveBeenCalledOnce();
		expect( repository.save ).toHaveBeenCalledOnce();
		expect( repository.get ).not.toHaveBeenCalled();
		expect( repository.rename ).not.toHaveBeenCalled();
		await service.retryPendingSave();
		expect( service.getState().retryPending ).toBe( false );

	} );

	it( 'does not bind a confirmed previous save to a different current project', async () => {

		const { service, repository, session } = fixture();
		repository.save.mockRejectedValueOnce( Object.assign( new Error( 'Network' ), { retryable: true } ) );
		await expect( service.saveCurrent( { name: 'First', asNew: true } ) ).rejects.toThrow( 'Network' );
		session.current = createProjectDocument( { projectId: 'another-working-project', name: 'Later work' } );
		const later = structuredClone( session.current );
		await service.retryPendingSave();
		expect( session.current ).toEqual( later );
		expect( service.selected ).toBeNull();
		expect( service.editProjectId ).toBeNull();
		expect( service.getState() ).toMatchObject( { retryPending: false, selectedPresetId: null } );
		expect( service.getState().status ).toContain( 'Previous preset save confirmed' );

	} );

	it( 'retains the same retry after another connection failure and releases it on a terminal conflict', async () => {

		const { service, repository, capture, thumbnail } = fixture();
		repository.save.mockRejectedValueOnce( Object.assign( new Error( 'Network' ), { retryable: true } ) ).mockRejectedValueOnce( Object.assign( new Error( 'Still offline' ), { retryable: true } ) ).mockRejectedValueOnce( Object.assign( new Error( 'Another editor changed it' ), { code: 'REVISION_CONFLICT', retryable: false } ) );
		await expect( service.saveCurrent( { name: 'First', asNew: true } ) ).rejects.toThrow( 'Network' );
		await expect( service.retryPendingSave() ).rejects.toThrow( 'Still offline' );
		expect( service.getState().retryPending ).toBe( true );
		await expect( service.retryPendingSave() ).rejects.toThrow( 'Another editor changed it' );
		expect( service.getState().retryPending ).toBe( false );
		expect( service.getState().status ).toContain( 'Reload it before saving again' );
		for ( const call of repository.save.mock.calls ) expect( call ).toEqual( repository.save.mock.calls[ 0 ] );
		expect( capture ).toHaveBeenCalledOnce();
		expect( thumbnail ).toHaveBeenCalledOnce();
		await expect( service.retryPendingSave() ).rejects.toThrow( 'There is no previous preset save' );

	} );

	it( 'treats a failed list refresh after acknowledgement as a confirmed save', async () => {

		const { service, repository } = fixture();
		repository.list.mockRejectedValueOnce( Object.assign( new Error( 'List offline' ), { retryable: true } ) );
		await expect( service.saveCurrent( { name: 'First', asNew: true } ) ).resolves.toMatchObject( { presetId: 'new-preset' } );
		expect( service.getState() ).toMatchObject( { retryPending: false, selectedPresetId: 'new-preset', error: '' } );
		expect( service.getState().status ).toContain( 'Refresh the preset list' );

	} );

	it( 'applies a preset in place without loading a project or changing its identity', async () => {

		const { service, session, record, originalDocument, app } = fixture();
		const before = structuredClone( originalDocument ), project = session.current;
		await service.selectPreset( 'cabin' );
		expect( session.hydrate ).not.toHaveBeenCalled();
		expect( session.current ).toBe( project );
		expect( app.meshScene.children[ 0 ].position.toArray() ).toEqual( [ 1, 2, 3 ] );
		expect( record.adminDocument ).toEqual( before );
		expect( service.selected.revision ).toBe( 5 );
		expect( service.getState() ).toMatchObject( { selectedPresetId: 'cabin', busy: false } );

	} );

	it( 'restores saved camera framing directly without hydrating a project', async () => {

		const { service, repository, record, app, session } = fixture();
		const savedCamera = structuredClone( studentFixture().shots.shotA.snapshot.camera );
		savedCamera.projection = { ...savedCamera.projection, fov: 48, aspect: 0.75, zoom: 1.2, filmGauge: 32, filmOffset: 0.5, clipStart: 0.2 };
		savedCamera.transform.position = [ 4, 3, 2 ]; savedCamera.target = [ 0, 1, 0 ];
		session.current.extensions.projectPresets.cabin.state.camera = savedCamera;
		repository.get.mockResolvedValue( { ...record, studentPreset: { snapshot: { camera: savedCamera } } } );
		const camera = new PerspectiveCamera( 12, 1 );
		app.cameraManager.camera = camera;
		app.cameraManager.controls.target = new Vector3();
		app.cameraManager.controls.update = vi.fn( () => camera.lookAt( app.cameraManager.controls.target ) );
		app.reset = vi.fn();
		session.hydrate.mockImplementation( async document => {

			session.current = document; camera.fov = 12; camera.aspect = 1;

		} );
		await service.selectPreset( 'cabin' );
		expect( camera.fov ).toBe( 48 );
		expect( camera.aspect ).toBe( 16 / 9 );
		expect( camera.zoom ).toBe( 1.2 );
		expect( camera.filmGauge ).toBe( 32 );
		expect( camera.filmOffset ).toBe( 0.5 );
		expect( camera.userData.clipStart ).toBe( 0.2 );
		expect( camera.position.toArray() ).toEqual( savedCamera.transform.position );
		expect( camera.quaternion.toArray() ).toEqual( savedCamera.transform.quaternion );
		expect( camera.scale.toArray() ).toEqual( savedCamera.transform.scale );
		expect( app.cameraManager.controls.target.toArray() ).toEqual( savedCamera.target );
		expect( app.reset ).toHaveBeenCalled();

	} );

	it( 'keeps the selected revision as the update guard after another tab refreshes the list', async () => {

		const { service, repository, record } = fixture();
		await service.selectPreset( 'cabin' );
		repository.list.mockResolvedValue( [ { ...record, revision: 8, name: 'Another editor' } ] );
		await service.refreshList();
		repository.save.mockRejectedValue( new Error( 'Revision conflict' ) );
		await expect( service.saveCurrent( { name: 'My edit' } ) ).rejects.toThrow( 'Revision conflict' );
		expect( repository.save ).toHaveBeenCalledWith( expect.objectContaining( { presetId: 'cabin', name: 'My edit' } ), { expectedRevision: 5 } );
		expect( service.selected.revision ).toBe( 5 );

	} );

	it( 'renames the selected revision with compare-and-swap and keeps selection after a conflict', async () => {

		const { service, repository, record } = fixture();
		await service.selectPreset( 'cabin' );
		repository.list.mockResolvedValue( [ { ...record, revision: 9 } ] );
		await service.refreshList();
		repository.rename.mockRejectedValueOnce( new Error( 'Revision conflict' ) );
		await expect( service.renamePreset( 'cabin', 'Close-up' ) ).rejects.toThrow( 'Revision conflict' );
		expect( repository.rename ).toHaveBeenLastCalledWith( 'cabin', 'Close-up', { expectedRevision: 5 } );
		expect( service.selected.revision ).toBe( 5 );
		await service.renamePreset( 'cabin', 'Close-up' );
		expect( service.selected ).toMatchObject( { name: 'Close-up', revision: 6 } );

	} );

	it( 'captures the scene and thumbnail together and resumes only previously playing videos', async () => {

		const { service, repository, session, app, capture, captureResult, thumbnail, thumbnailBlob } = fixture();
		const playing = videoRecord( 'playing-wall' ), paused = videoRecord( 'paused-wall', true );
		capture.mockImplementation( async options => {

			expect( app.cameraManager.controls.enabled ).toBe( false );
			expect( playing.video.paused ).toBe( true );
			expect( options.playingWalls ).toEqual( new Set( [ 'playing-wall' ] ) );
			return captureResult;

		} );
		const saved = await service.saveCurrent( { name: 'New shot', asNew: true } );
		expect( session.flush ).toHaveBeenCalledOnce();
		expect( thumbnail ).toHaveBeenCalledWith( captureResult.studentPreset, captureResult.assetBlobs, repository, expect.any( Function ) );
		expect( repository.save ).toHaveBeenCalledExactlyOnceWith( expect.objectContaining( {
			name: 'New shot', thumbnail: thumbnailBlob, studentPreset: captureResult.studentPreset,
			adminDocument: expect.objectContaining( { extensions: expect.objectContaining( { localPresetMedia: captureResult.mediaBindings, projectPresetState: expect.objectContaining( { projectId: 'working-project' } ) } ) } ),
		} ), { expectedRevision: null } );
		expect( repository.save.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( 'presetId' );
		expect( saved.presetId ).toBe( 'new-preset' );
		expect( app.cameraManager.controls.enabled ).toBe( true );
		expect( playing.video.play ).toHaveBeenCalledOnce();
		expect( paused.video.play ).not.toHaveBeenCalled();
		expect( service.getState() ).toMatchObject( { busy: false, selectedPresetId: 'new-preset', error: '' } );

	} );

	it.each( [ 'capture', 'thumbnail', 'save' ] )( 'restores controls and playback after a %s failure without committing partial preset data', async stage => {

		const context = fixture();
		const { service, repository, app } = context;
		const playing = videoRecord( 'playing-wall' );
		app.cameraManager.controls.enabled = false;
		const operation = stage === 'save' ? repository.save : context[ stage ];
		operation.mockRejectedValueOnce( new Error( `${stage} failed` ) );
		await expect( service.saveCurrent( { name: 'New shot', asNew: true } ) ).rejects.toThrow( `${stage} failed` );
		if ( stage !== 'save' ) expect( repository.save ).not.toHaveBeenCalled();
		expect( app.cameraManager.controls.enabled ).toBe( false );
		expect( playing.video.play ).toHaveBeenCalledOnce();
		expect( service.getState() ).toMatchObject( { busy: false, selectedPresetId: null, error: `${stage} failed` } );

	} );

	it( 'rejects a scene edit during thumbnail generation before saving anything', async () => {

		const { service, repository, session, thumbnail } = fixture();
		thumbnail.mockImplementation( async () => {

			session.current.scene.nodes = { changed: { position: [ 3, 2, 1 ] } };
			return new Blob( [ 'image' ], { type: 'image/jpeg' } );

		} );
		await expect( service.saveCurrent( { name: 'New shot', asNew: true } ) ).rejects.toThrow( 'scene changed' );
		expect( repository.save ).not.toHaveBeenCalled();
		expect( session.current.scene.nodes ).toHaveProperty( 'changed' );

	} );

	it( 'rejects switching to another project with the same scene during thumbnail generation', async () => {

		const { service, repository, session, thumbnail } = fixture();
		thumbnail.mockImplementation( async () => {

			session.current = { ...session.current, projectId: 'another-project' };
			return new Blob( [ 'image' ], { type: 'image/jpeg' } );

		} );
		await expect( service.saveCurrent( { name: 'New shot', asNew: true } ) ).rejects.toThrow( 'scene changed' );
		expect( repository.save ).not.toHaveBeenCalled();

	} );

} );


it( 'restores the saved plate angle when selecting a preset without changing the selected set', async () => {

	const { service, session } = fixture();
	service.plates = { setView: vi.fn().mockResolvedValue() };
	session.current.extensions.projectPresets.cabin.state.plateView = 'rear';
	await service.selectPreset( 'cabin' );
	expect( service.plates.setView ).toHaveBeenCalledWith( 'rear' );

} );


it( 'saves the live plate direction even if the background project snapshot is older', async () => {

	const { service, session } = fixture();
	session.current.extensions.drivingPlate = { setId: 'a', view: 'front' };
	service.plates = { getSnapshot: () => ( { view: 'rear' } ) };
	const saved = await service.saveCurrent( { name: 'Rear', asNew: true } );
	expect( saved.adminDocument.extensions.projectPresetState.plateView ).toBe( 'rear' );

} );

it( 'opens the actual student library scene without changing the welcome project and adopts previously initialized presets', async () => {

	const { service, repository, session, record } = fixture();
	record.adminDocument.scene.nodes = {};
	record.adminDocument.extensions = { projectPresetsInitialized: true };
	session.repository = { get: vi.fn().mockResolvedValue( null ) };
	await service.openDefaultProject();
	expect( session.repository.get ).toHaveBeenCalledWith( 'student-preset-workspace' );
	expect( session.hydrate ).toHaveBeenCalledWith( expect.objectContaining( {
		projectId: 'student-preset-workspace', name: 'Student default project', scene: record.adminDocument.scene,
		extensions: expect.objectContaining( { studentPresetLibrary: true } ), workspace: expect.objectContaining( { activeTab: 'presets' } ),
	} ) );
	expect( service.getState() ).toMatchObject( { sharedLibrary: true, presets: [ { presetId: 'cabin' } ] } );
	expect( session.current.extensions.projectPresets.cabin.state.projectId ).toBe( 'student-preset-workspace' );
	expect( repository.save ).not.toHaveBeenCalled();
	expect( record.adminDocument.projectId ).toBe( 'original-project' );

} );

it( 'shows all student presets in the shared workspace and permits editing a compatible preset created in another project', async () => {

	const { service, repository, session, record } = fixture();
	session.current.extensions.studentPresetLibrary = true;
	record.adminDocument.scene.nodes = {};
	record.adminDocument.extensions.projectPresetState = { projectId: 'old-workspace', nodes: {}, lights: [], camera: {} };
	repository.list.mockResolvedValue( [ record, { ...record, presetId: 'another-scene' } ] );
	await service.importExistingPresets(); await service.refreshList();
	expect( service.getState().presets ).toHaveLength( 2 );
	await service.selectPreset( 'cabin' );
	expect( session.hydrate ).not.toHaveBeenCalled();
	await service.saveCurrent( { name: 'Student camera' } );
	expect( repository.save ).toHaveBeenCalledWith( expect.objectContaining( { presetId: 'cabin' } ), { expectedRevision: 5 } );

} );

it( 'removes the selected student preset with a revision guard and prunes stale project links', async () => {

	const { service, repository, session } = fixture();
	await service.refreshList(); await service.selectPreset( 'cabin' );
	repository.remove = vi.fn( async () => repository.list.mockResolvedValue( [] ) );
	await service.removePreset( 'cabin' );
	expect( repository.remove ).toHaveBeenCalledWith( 'cabin', { expectedRevision: 5 } );
	expect( service.getState() ).toMatchObject( { presets: [], selectedPresetId: null, error: '' } );
	expect( session.current.extensions.projectPresets ).toEqual( {} );

} );

it( 'keeps the selected preset and scene when another admin has changed the removed revision', async () => {

	const { service, repository, session } = fixture();
	await service.refreshList(); await service.selectPreset( 'cabin' );
	const before = session.current;
	repository.remove = vi.fn().mockRejectedValue( new Error( 'Revision conflict' ) );
	await expect( service.removePreset( 'cabin' ) ).rejects.toThrow( 'Revision conflict' );
	expect( session.current ).toBe( before );
	expect( service.getState().selectedPresetId ).toBe( 'cabin' );

} );

it( 'opens the saved student workspace even after every library preset has been removed', async () => {

	const { service, repository, session } = fixture();
	const savedWorkspace = structuredClone( session.current );
	savedWorkspace.projectId = 'student-preset-workspace';
	savedWorkspace.extensions.studentPresetLibrary = true;
	session.repository = { get: vi.fn().mockResolvedValue( savedWorkspace ) };
	repository.list.mockResolvedValue( [] );
	await service.openDefaultProject();
	expect( session.current.scene ).toEqual( savedWorkspace.scene );
	expect( service.getState() ).toMatchObject( { sharedLibrary: true, presets: [], error: '' } );

} );

it( 'loads a different student preset inventory for editing while preserving the current workspace identity', async () => {

	const { service, repository, session, record } = fixture();
	session.current.extensions.studentPresetLibrary = true;
	session.current.scene.assets = [ { instanceId: 'old', catalogId: 'old-model', assetVersion: 1 } ];
	record.adminDocument.scene.assets = [ { instanceId: 'new', catalogId: 'new-model', assetVersion: 1 } ];
	record.adminDocument.scene.nodes = {};
	repository.list.mockResolvedValue( [ record ] );
	await service.importExistingPresets(); await service.refreshList();
	expect( session.current.extensions.projectPresets ).toEqual( {} );
	await service.selectPreset( 'cabin' );
	expect( session.hydrate ).toHaveBeenCalledOnce();
	expect( session.current.projectId ).toBe( 'working-project' );
	expect( session.current.scene.assets ).toEqual( record.adminDocument.scene.assets );
	expect( service.getState() ).toMatchObject( { selectedPresetId: 'cabin', error: '' } );

} );
