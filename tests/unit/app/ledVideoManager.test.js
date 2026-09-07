import { describe, expect, it, vi } from 'vitest';
import { Group, Mesh, PlaneGeometry, MeshStandardMaterial, Vector2 } from 'three';
import {
	createLEDTextureMatrix,
	fitLEDPlacement,
	LEDVideoManagerImpl,
	nitsToEmission,
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

} );
