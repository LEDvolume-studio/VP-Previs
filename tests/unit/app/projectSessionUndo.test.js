import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted( () => {

	globalThis.window ||= { devicePixelRatio: 2 };
	globalThis.localStorage ||= {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
	};

} );

import { Group } from 'three';
import { editObjectAttribute } from '@/utils/objectAttributes';
import { setApp } from '@/lib/appProxy';
import { ProjectSession } from '@/services/projects/ProjectSession';
import { LEDVideoManager } from '@/services/LEDVideoManager';
import { undoManager } from '@/services/UndoManager';
import { useAnimationStore, usePathTracerStore, useStore } from '@/store';

describe( 'ProjectSession undo integration', () => {

	let app;
	let engineState;
	let originalBounces;
	let originalRendererState;
	let originalAnimation;

	beforeEach( () => {

		originalBounces = usePathTracerStore.getState().bounces;
		originalRendererState = {
			enablePathTracer: usePathTracerStore.getState().enablePathTracer,
			pathTracerActive: usePathTracerStore.getState().pathTracerActive,
		};
		originalAnimation = { ...useAnimationStore.getState() };
		engineState = { maxBounces: 2 };
		app = {
			isInitialized: true,
			settings: {
				getAll: () => ( { ...engineState } ),
				setMany: updates => Object.assign( engineState, updates ),
			},
			cameraManager: {
				getProjectState: () => null,
				getCameraNames: () => [],
				currentCameraIndex: 0,
				controls: {},
			},
			lightManager: { getProjectState: () => [] },
			animationManager: { setSpeed: vi.fn(), setLoop: vi.fn(), play: vi.fn(), pause: vi.fn() },
			sceneMeshes: [],
			renderer: {},
			setCanvasSize: vi.fn(),
			reset: vi.fn(),
		};
		setApp( app );
		useStore.setState( { selectedObject: null } );
		usePathTracerStore.setState( { bounces: 2 } );
		undoManager.clear();

	} );

	afterEach( () => {

		undoManager.clear();
		LEDVideoManager.detachApp();
		usePathTracerStore.setState( { bounces: originalBounces, ...originalRendererState } );
		useAnimationStore.setState( originalAnimation );
		setApp( null );

	} );

	it( 'defaults missing project renderer state to raster and keeps the coordinator aligned', () => {

		const session = new ProjectSession( {} );
		app.pathTracerEnabled = true;
		usePathTracerStore.setState( { enablePathTracer: true, pathTracerActive: true } );

		session.applyRenderState( { ui: {} } );

		expect( usePathTracerStore.getState().enablePathTracer ).toBe( false );
		expect( app.pathTracerEnabled ).toBe( false );
		expect( LEDVideoManager.preferredPathTracing ).toBe( false );

	} );

	it( 'keeps prior undo commands across pose rebuilds and resumes structural invalidation after errors', async () => {

		const session = new ProjectSession( {} );
		const handlers = new Map();
		app.addEventListener = ( type, handler ) => handlers.set( type, handler );
		app.removeEventListener = vi.fn();
		vi.stubGlobal( 'window', { ...window, addEventListener: vi.fn(), removeEventListener: vi.fn() } );
		vi.stubGlobal( 'document', { addEventListener: vi.fn(), removeEventListener: vi.fn() } );
		try {

			session.bindAutosave();
			const undo = vi.fn();
			undoManager.record( { label: 'Earlier edit', undo, redo: vi.fn() } );
			await session.withPreservedUndoHistory( async () => {

				handlers.get( 'SceneRebuild' )();
				await session.withPreservedUndoHistory( async () => handlers.get( 'SceneRebuild' )() );

			} );
			expect( undoManager.canUndo ).toBe( true );
			await undoManager.undo();
			expect( undo ).toHaveBeenCalledOnce();
			await expect( session.withPreservedUndoHistory( async () => {

				throw new Error( 'Upload failed' );

			} ) ).rejects.toThrow( 'Upload failed' );
			expect( session.preserveStructuralUndoDepth ).toBe( 0 );
			handlers.get( 'SceneRebuild' )();
			expect( undoManager.canRedo ).toBe( false );

		} finally {

			session.unsubscribers.forEach( unsubscribe => unsubscribe() );
			vi.unstubAllGlobals();

		}

	} );

	it( 'captures store and engine state after a synchronous UI handler completes', async () => {

		const session = new ProjectSession( {} );
		session._resetUndoHistory();

		usePathTracerStore.setState( { bounces: 5 } );
		session._scheduleUndoCheckpoint( 'render', 'Render settings' );
		engineState.maxBounces = 5;
		await Promise.resolve();

		expect( undoManager.canUndo ).toBe( true );
		await undoManager.undo();
		expect( usePathTracerStore.getState().bounces ).toBe( 2 );
		expect( engineState.maxBounces ).toBe( 2 );

		await undoManager.redo();
		expect( usePathTracerStore.getState().bounces ).toBe( 5 );
		expect( engineState.maxBounces ).toBe( 5 );

	} );

	it( 'preserves playback while restoring animation settings', async () => {

		const session = new ProjectSession( {} );
		useAnimationStore.setState( { selectedClip: 1, isPlaying: true, isPaused: false } );

		await session._restoreUndoDomain( 'animation', {
			selectedClip: 0,
			speed: 0.5,
			loop: false,
			loopCount: 2,
		} );

		expect( app.animationManager.play ).toHaveBeenCalledWith( 0 );
		expect( useAnimationStore.getState() ).toMatchObject( {
			selectedClip: 0,
			isPlaying: true,
			isPaused: false,
		} );

	} );

	it( 'undoes numeric folder edits using the explicit target without a gizmo attachment', async () => {

		const session = new ProjectSession( {} );
		const root = new Group();
		const folder = new Group();
		root.add( folder );
		folder.matrixAutoUpdate = false;
		app.meshScene = root;
		app.transformManager = { applyObjectTransform: vi.fn() };
		session.markDirty = vi.fn();
		app.dispatchEvent = event => {

			if ( event.type === 'engine:objectTransformStart' ) session._beginTransformUndo( event.object );
			if ( event.type === 'engine:objectTransformEnd' ) session._finishTransformUndo();

		};

		editObjectAttribute( app, folder, 'position', 'x', 12 );
		expect( folder.matrix.elements[ 12 ] ).toBe( 12 );
		await undoManager.undo();
		expect( folder.position.x ).toBe( 0 );
		expect( folder.matrix.elements[ 12 ] ).toBe( 0 );
		await undoManager.redo();
		expect( folder.position.x ).toBe( 12 );
		expect( folder.matrix.elements[ 12 ] ).toBe( 12 );
		expect( session.markDirty ).toHaveBeenCalledTimes( 3 );

	} );

} );
