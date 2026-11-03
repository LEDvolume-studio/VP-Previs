import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProjectDocument } from '../../../app/src/services/projects/ProjectSchema';
import { setApp } from '../../../app/src/lib/appProxy';
import { useProjectStore } from '../../../app/src/services/projects/projectStore';
import { Scene } from 'three';

let ProjectSession;
let useStore;
let LEDVideoManager;

beforeAll( async () => {

	vi.stubGlobal( 'window', { devicePixelRatio: 2, dispatchEvent: vi.fn() } );
	vi.stubGlobal( 'localStorage', {
		getItem: vi.fn( () => null ),
		setItem: vi.fn(),
		removeItem: vi.fn(),
	} );
	( { ProjectSession } = await import( '../../../app/src/services/projects/ProjectSession' ) );
	( { useStore } = await import( '../../../app/src/store' ) );
	( { LEDVideoManager } = await import( '../../../app/src/services/LEDVideoManager' ) );

} );

afterAll( () => vi.unstubAllGlobals() );

describe( 'ProjectSession default project protection', () => {

	it( 'opens the default when no active project was saved', async () => {

		const defaultProject = createProjectDocument( { name: 'Default Scene' } );
		const recentBlank = createProjectDocument( { name: 'Untitled Project' } );
		const repository = {
			init: vi.fn().mockResolvedValue(),
			list: vi.fn().mockResolvedValue( [ recentBlank, defaultProject ] ),
			getDefaultProjectId: vi.fn().mockResolvedValue( defaultProject.projectId ),
			getActiveProjectId: vi.fn().mockResolvedValue( null ),
		};
		const session = new ProjectSession( repository );
		session.bindAutosave = vi.fn();
		session.hydrate = vi.fn().mockResolvedValue();

		await session.initialize();

		expect( session.hydrate ).toHaveBeenCalledWith( defaultProject );

	} );

	it( 'restores the bundled default if stored projects have no valid default', async () => {

		const recentBlank = createProjectDocument( { name: 'Untitled Project' } );
		const repository = {
			init: vi.fn().mockResolvedValue(),
			list: vi.fn().mockResolvedValue( [ recentBlank ] ),
			getDefaultProjectId: vi.fn().mockResolvedValue( null ),
			getActiveProjectId: vi.fn().mockResolvedValue( null ),
			save: vi.fn().mockResolvedValue(),
			setDefaultProjectId: vi.fn().mockResolvedValue(),
		};
		const session = new ProjectSession( repository );
		session.bindAutosave = vi.fn();
		session.hydrate = vi.fn().mockResolvedValue();

		await session.initialize();

		const restored = repository.save.mock.calls[ 0 ][ 0 ];
		expect( restored.name ).toBe( 'Welcome Project' );
		expect( restored.scene.assets ).toHaveLength( 5 );
		expect( repository.setDefaultProjectId ).toHaveBeenCalledWith( restored.projectId );
		expect( session.hydrate ).toHaveBeenCalledWith( restored );

	} );

	it( 'forks an edited default instead of overwriting it', async () => {

		const source = createProjectDocument( { name: 'Welcome Project' } );
		const forked = { ...source, projectId: 'working-1', name: 'New Project 01', revision: 0 };
		const repository = {
			list: vi.fn( async () => [ source ] ),
			fork: vi.fn( async () => forked ),
			save: vi.fn(),
		};
		const session = new ProjectSession( repository );
		session.current = source;
		session.defaultProjectId = source.projectId;
		session.dirty = true;
		session.capture = vi.fn( () => ( { ...source } ) );
		session.refreshList = vi.fn();

		await session.flush();

		expect( repository.fork ).toHaveBeenCalledWith(
			source.projectId,
			expect.objectContaining( { projectId: source.projectId, revision: 1 } ),
			'New Project 01'
		);
		expect( repository.save ).not.toHaveBeenCalled();
		expect( session.current ).toBe( forked );
		expect( session.dirty ).toBe( false );

	} );

	it( 'replaces and reopens the default only through the explicit command', async () => {

		const defaultProject = createProjectDocument( { name: 'Welcome Project' } );
		const working = createProjectDocument( { name: 'My Scene' } );
		working.extensions.workingCopyNumber = 4;
		const savedDefault = {
			...working,
			projectId: defaultProject.projectId,
			name: defaultProject.name,
			extensions: {},
		};
		const repository = {
			get: vi.fn( async () => defaultProject ),
			replaceDefault: vi.fn( async () => savedDefault ),
			save: vi.fn(),
		};
		const session = new ProjectSession( repository );
		session.current = working;
		session.defaultProjectId = defaultProject.projectId;
		session.capture = vi.fn( () => ( { ...working } ) );
		session.refreshList = vi.fn();

		await session.saveCurrentAsDefault();

		expect( repository.replaceDefault ).toHaveBeenCalledWith(
			working.projectId,
			defaultProject.projectId,
			expect.objectContaining( {
				projectId: defaultProject.projectId,
				name: 'Welcome Project',
				revision: 1,
				extensions: {},
			} )
		);
		expect( session.current ).toBe( savedDefault );
		expect( session.dirty ).toBe( false );

	} );

} );

describe( 'ProjectSession load failure', () => {

	it( 'clears a partial scene and shows the loading error', async () => {

		const app = {
			isInitialized: true,
			animationManager: { stop: vi.fn() },
			unloadScene: vi.fn(),
			addModels: vi.fn().mockRejectedValue( new Error( 'Asset parse failed' ) ),
		};
		setApp( app );
		const session = new ProjectSession( {} );

		try {

			await expect( session.hydrate( createProjectDocument() ) ).rejects.toThrow( 'Asset parse failed' );
			expect( app.unloadScene ).toHaveBeenCalledTimes( 2 );
			expect( useProjectStore.getState().activeProject ).toBeNull();
			expect( useStore.getState().loading ).toMatchObject( {
				isLoading: true,
				failed: true,
				status: 'Asset parse failed',
			} );

		} finally {

			LEDVideoManager.detachApp();
			setApp( null );
			useStore.getState().resetLoading();

		}

	} );

} );

describe( 'ProjectSession successful load', () => {

	it( 'clears the environment loader progress when hydration completes', async () => {

		const document = createProjectDocument();
		const scene = new Scene();
		const app = {
			isInitialized: true,
			pathTracerEnabled: false,
			animationManager: { stop: vi.fn(), setSpeed: vi.fn(), setLoop: vi.fn() },
			assetLoader: { floorPlane: null },
			unloadScene: vi.fn(),
			addModels: vi.fn().mockResolvedValue( [] ),
			loadSceneData: vi.fn().mockResolvedValue( true ),
			loadEnvironment: vi.fn().mockImplementation( async () => {

				useStore.getState().setLoading( { isLoading: true, status: 'Processing Environment...', progress: 62 } );

			} ),
			getScene: () => scene,
			lightManager: { replaceProjectState: () => [] },
			cameraManager: { restoreProjectState: vi.fn(), getCameraNames: () => [], currentCameraIndex: 0 },
			settings: { setMany: vi.fn() },
			setCanvasSize: vi.fn(),
			renderer: {},
			reset: vi.fn(),
		};
		const repository = {
			setActiveProjectId: vi.fn().mockResolvedValue(),
			list: vi.fn().mockResolvedValue( [ document ] ),
		};
		const session = new ProjectSession( repository );
		session.defaultProjectId = document.projectId;
		setApp( app );

		try {

			await session.hydrate( document );
			expect( useStore.getState().loading.isLoading ).toBe( false );
			expect( useProjectStore.getState().activeProject?.projectId ).toBe( document.projectId );

		} finally {

			LEDVideoManager.detachApp();
			setApp( null );
			useStore.getState().resetLoading();

		}

	} );

} );
