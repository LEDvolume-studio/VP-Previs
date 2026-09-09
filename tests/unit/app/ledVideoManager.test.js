import { describe, expect, it, vi } from 'vitest';
import { BackSide, BufferAttribute, FrontSide, Group, Mesh, PlaneGeometry, MeshStandardMaterial, Vector2 } from 'three';
import {
	createLEDTextureMatrix,
	drawLEDVideoFrame,
	fitLEDPlacement,
	LEDVideoManagerImpl,
	nitsToEmission,
	normalizeLEDDisplayUVs,
	prepareLEDAssetRoot,
	resolveLEDAssetRoot,
} from '@/services/LEDVideoManager.js';

const catalogItem = {
	id: 'test-led-v1',
	name: 'Test LED',
	led: {
		version: 1,
		assetType: 'test-led',
		displayMeshName: 'LED_Display_Test',
		sourceNodeName: 'SourceDisplay',
		physicalDimensions: { width: 8.8, height: 4.1, depth: 1.8 },
		nativeCanvas: { width: 6144, height: 2592 },
		maxBrightnessNits: 600,
		defaultBrightnessNits: 600,
		uvChannel: 1,
		uvBounds: { minU: 0.25, maxU: 0.75, minV: 0.2, maxV: 0.8 },
		flipU: true,
		normalization: { translation: [ 0, 0, 0 ], preserveRotation: true },
	},
};

describe( 'LED asset metadata', () => {

	it( 'bakes a cropped and mirrored display UV island into normalized coordinates', () => {

		const mesh = new Mesh( new PlaneGeometry(), new MeshStandardMaterial() );
		mesh.geometry.setAttribute( 'uv1', new BufferAttribute( new Float32Array( [
			0.25, 0.2,
			0.75, 0.8,
		] ), 2 ) );
		const originalGeometry = mesh.geometry;

		expect( normalizeLEDDisplayUVs( mesh, catalogItem.led ) ).toBe( true );
		expect( mesh.geometry ).not.toBe( originalGeometry );
		expect( mesh.geometry.getAttribute( 'uv1' ).getX( 0 ) ).toBeCloseTo( 1 );
		expect( mesh.geometry.getAttribute( 'uv1' ).getY( 0 ) ).toBeCloseTo( 0 );
		expect( mesh.geometry.getAttribute( 'uv1' ).getX( 1 ) ).toBeCloseTo( 0 );
		expect( mesh.geometry.getAttribute( 'uv1' ).getY( 1 ) ).toBeCloseTo( 1 );

	} );

	it( 'normalizes the source placement and resolves a selected child to its LED root', () => {

		const root = new Group();
		const mesh = new Mesh( new PlaneGeometry(), new MeshStandardMaterial() );
		mesh.name = 'SourceDisplay';
		mesh.position.set( 5.6, 0.1, - 4.9 );
		root.add( mesh );

		prepareLEDAssetRoot( root, catalogItem );

		expect( mesh.position.toArray() ).toEqual( [ 0, 0, 0 ] );
		expect( mesh.name ).toBe( 'LED_Display_Test' );
		expect( mesh.material.emissiveIntensity ).toBe( 0 );
		expect( mesh.material.side ).toBe( FrontSide );
		const rearSurface = mesh.children.find( child => child.name === 'LED_Display_Test_Back' );
		expect( rearSurface ).toBeDefined();
		expect( rearSurface.geometry ).toBe( mesh.geometry );
		expect( rearSurface.material.isMeshBasicMaterial ).toBe( true );
		expect( rearSurface.material.side ).toBe( BackSide );
		expect( rearSurface.material.color.getHex() ).toBe( 0x000000 );
		expect( rearSurface.material.map ).toBeNull();
		expect( root.userData.rayzeeLED ).toMatchObject( {
			version: 1,
			isLEDVolume: true,
			assetType: 'test-led',
			currentBrightnessNits: 600,
		} );
		expect( resolveLEDAssetRoot( mesh ) ).toBe( root );

	} );

} );

describe( 'LED placement conversion', () => {

	it( 'composites a scaled video over black instead of sampling beyond its edges', () => {

		const context = {
			fillRect: vi.fn(),
			save: vi.fn(),
			translate: vi.fn(),
			rotate: vi.fn(),
			drawImage: vi.fn(),
			restore: vi.fn(),
		};
		const video = { tag: 'video' };
		drawLEDVideoFrame( context, video, 1000, 500, {
			position: { x: 0.5, y: 0.5 },
			scale: { x: 0.5, y: 0.4 },
			rotationDegrees: 0,
		} );

		expect( context.fillStyle ).toBe( '#000000' );
		expect( context.fillRect ).toHaveBeenCalledWith( 0, 0, 1000, 500 );
		expect( context.translate ).toHaveBeenCalledWith( 500, 250 );
		expect( context.drawImage ).toHaveBeenCalledWith( video, - 250, - 100, 500, 200 );

	} );

	it( 'normalizes and mirrors authored UV1 into the logical top-left canvas', () => {

		const metadata = {
			...catalogItem.led,
			videoPlacementTransform: {
				position: { x: 0.5, y: 0.5 },
				scale: { x: 1, y: 1 },
				rotationDegrees: 0,
			},
		};
		const matrix = createLEDTextureMatrix( metadata );
		const topLeft = new Vector2( 0.75, 0.2 ).applyMatrix3( matrix );
		const bottomRight = new Vector2( 0.25, 0.8 ).applyMatrix3( matrix );

		expect( topLeft.x ).toBeCloseTo( 0 );
		expect( topLeft.y ).toBeCloseTo( 0 );
		expect( bottomRight.x ).toBeCloseTo( 1 );
		expect( bottomRight.y ).toBeCloseTo( 1 );

	} );

	it( 'computes contain, cover, and stretch in normalized canvas coordinates', () => {

		expect( fitLEDPlacement( 'contain', 1920, 1080, 1, 1 ) ).toEqual( { x: 1, y: 0.5625 } );
		expect( fitLEDPlacement( 'cover', 1920, 1080, 1, 1 ) ).toEqual( { x: 1.7777777777777777, y: 1 } );
		expect( fitLEDPlacement( 'stretch', 1920, 1080, 1, 1 ) ).toEqual( { x: 1, y: 1 } );

	} );

} );

describe( 'LED brightness conversion', () => {

	it( 'keeps the 10000:600 nit ratio before tone mapping', () => {

		expect( nitsToEmission( 100 ) ).toBe( 1 );
		expect( nitsToEmission( 10000 ) / nitsToEmission( 600 ) ).toBeCloseTo( 16.6666667 );

	} );

} );

describe( 'LED renderer arbitration', () => {

	it( 'keeps independently updating walls when one decoded-frame callback stalls', () => {

		vi.useFakeTimers();
		const manager = new LEDVideoManagerImpl();
		manager.app = { pathTracerEnabled: false, reset: vi.fn(), wake: vi.fn() };
		manager.updateRasterVideoFrame = vi.fn();
		manager.updateLivePathTracerFrame = vi.fn();
		const makeRecord = () => ( {
			status: 'playing',
			video: {
				requestVideoFrameCallback: vi.fn( () => 1 ),
				cancelVideoFrameCallback: vi.fn(),
			},
			videoFrameCallbackHandle: null,
			videoFrameWatchdogHandle: null,
			lastVideoFrameCallbackAt: - Infinity,
		} );
		const mainWall = makeRecord();
		const wildWall = makeRecord();

		manager.startVideoFrameNotifications( mainWall );
		manager.startVideoFrameNotifications( wildWall );
		vi.advanceTimersByTime( 200 );

		expect( manager.updateRasterVideoFrame ).toHaveBeenCalledWith( mainWall );
		expect( manager.updateRasterVideoFrame ).toHaveBeenCalledWith( wildWall );
		expect( manager.app.reset ).toHaveBeenCalled();
		manager.cancelVideoFrameNotifications( mainWall );
		manager.cancelVideoFrameNotifications( wildWall );
		vi.useRealTimers();

	} );

	it( 'redraws and wakes immediately when a wall placement changes', () => {

		const root = new Group();
		const mesh = new Mesh( new PlaneGeometry(), new MeshStandardMaterial() );
		mesh.name = 'SourceDisplay';
		root.add( mesh );
		prepareLEDAssetRoot( root, catalogItem );
		const manager = new LEDVideoManagerImpl();
		manager.app = { pathTracerEnabled: false, reset: vi.fn(), wake: vi.fn() };
		const record = manager.register( root );
		record.videoCanvas = {};
		record.videoTexture = { needsUpdate: false };
		manager.composeVideoFrame = vi.fn( () => true );

		manager.setPlacement( root, { position: { x: 0.25 } }, { commit: false } );

		expect( manager.composeVideoFrame ).toHaveBeenCalledWith( record, record.videoCanvas );
		expect( record.videoTexture.needsUpdate ).toBe( true );
		expect( manager.app.reset ).toHaveBeenCalledOnce();

	} );

	it( 'forces raster while any wall plays and restores the latest user preference', async () => {

		const manager = new LEDVideoManagerImpl();
		const app = {
			pathTracerEnabled: true,
			wake: vi.fn(),
			reset: vi.fn(),
			getScene: () => ( { traverse: () => {} } ),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		};
		manager.attachApp( app );
		manager.records.set( 'playing-wall', {
			status: 'playing',
			video: { paused: false, ended: false },
		} );

		manager.setUserPathTracerPreference( true );
		expect( app.pathTracerEnabled ).toBe( false );

		manager.records.get( 'playing-wall' ).status = 'paused';
		manager.records.get( 'playing-wall' ).video.paused = true;
		manager.reconcileRendererMode();
		await Promise.resolve();
		expect( app.pathTracerEnabled ).toBe( true );

	} );

	it( 'keeps the preferred path tracer active only when the experimental override is enabled', () => {

		const manager = new LEDVideoManagerImpl();
		const app = {
			pathTracerEnabled: true,
			wake: vi.fn(),
			getScene: () => ( { traverse: () => {} } ),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		};
		manager.attachApp( app );
		manager.records.set( 'playing-wall', {
			status: 'playing',
			video: { paused: false, ended: false },
			lastLivePathTracerUpload: - Infinity,
		} );

		manager.reconcileRendererMode();
		expect( app.pathTracerEnabled ).toBe( false );

		manager.setExperimentalLivePathTracing( true );
		expect( app.pathTracerEnabled ).toBe( true );

		manager.setUserPathTracerPreference( false );
		expect( app.pathTracerEnabled ).toBe( false );

		manager.setUserPathTracerPreference( true );
		expect( app.pathTracerEnabled ).toBe( true );

		manager.setExperimentalLivePathTracing( false );
		expect( app.pathTracerEnabled ).toBe( false );

	} );

	it( 'uploads a resized decoded frame to the existing path-tracer texture layer', () => {

		const pixels = new Uint8ClampedArray( 4 * 3 * 4 );
		const context = {
			drawImage: vi.fn(),
			getImageData: vi.fn( () => ( { data: pixels } ) ),
		};
		const canvas = { width: 0, height: 0, getContext: vi.fn( () => context ) };
		vi.stubGlobal( 'document', { createElement: vi.fn( () => canvas ) } );

		const manager = new LEDVideoManagerImpl();
		manager.preferredPathTracing = true;
		manager.experimentalLivePathTracing = true;
		manager.app = {
			getMaterialTextureLayerInfo: vi.fn( () => ( { width: 4, height: 3, bucket: 0, layer: 2 } ) ),
			updateMaterialTextureLayer: vi.fn( () => true ),
			wake: vi.fn(),
		};
		const record = {
			status: 'playing',
			video: {},
			pausedTexture: {},
			livePathTracerCanvas: null,
			lastLivePathTracerUpload: - Infinity,
		};

		expect( manager.updateLivePathTracerFrame( record, 100 ) ).toBe( true );
		expect( context.drawImage ).toHaveBeenCalledWith( record.video, 0, 0, 4, 3 );
		expect( manager.app.updateMaterialTextureLayer ).toHaveBeenCalledWith( record.pausedTexture, pixels, true );
		expect( manager.updateLivePathTracerFrame( record, 110 ) ).toBe( false );
		expect( manager.app.updateMaterialTextureLayer ).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();

	} );

} );

describe( 'LED reconnect placeholder', () => {

	it( 'uses a dim authored message instead of a white display', () => {

		const context = {
			fillRect: vi.fn(),
			fillText: vi.fn(),
		};
		vi.stubGlobal( 'document', {
			createElement: () => ( { width: 0, height: 0, getContext: () => context } ),
		} );
		const root = new Group();
		const mesh = new Mesh( new PlaneGeometry(), new MeshStandardMaterial() );
		mesh.name = 'SourceDisplay';
		root.add( mesh );
		prepareLEDAssetRoot( root, catalogItem );
		const manager = new LEDVideoManagerImpl();
		manager.register( root );
		manager.setMissingVideo( root, { assetId: 'video-1', name: 'missing.mp4' } );

		expect( manager.getSnapshot( root ).status ).toBe( 'missing' );
		expect( mesh.material.emissiveIntensity ).toBe( 0.45 );
		expect( context.fillText ).toHaveBeenCalledWith( 'Please reconnect file', 512, expect.any( Number ), expect.any( Number ) );
		vi.unstubAllGlobals();

	} );

} );
