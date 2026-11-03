import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RenderSettings } from '../../../rayzee/src/RenderSettings.js';
import { RealtimeRenderer } from '../../../rayzee/src/managers/RealtimeRenderer.js';
import { captureAdminPreset } from '../../../app/src/services/presets/CaptureAdminPreset.js';
import { prepareRasterMaterial } from '../../../rayzee/src/Processor/RasterMaterialPreparation.js';
import { validateStudentPresetVersion } from '../../../app/src/previs/domain/StudentCatalogueSchema.js';
import { prepareLEDAssetRoot } from '../../../app/src/services/LEDVideoManager.js';
import { prepareMannequin } from '../../../app/src/utils/mannequinPoses.js';
import { GeometryExtractor } from '../../../rayzee/src/Processor/GeometryExtractor.js';

afterEach( () => vi.unstubAllGlobals() );

async function setup( { led = false, duplicates = false, mannequin = false } = {} ) {

	vi.stubGlobal( 'Image', class {} );
	const modelFile = led ? 'models/led/main-led-volume-wall.glb' : mannequin ? 'characters/mannequin/mannequin-presets.glb' : 'models/studio-one.glb';
	const content = await readFile( new URL( `../../../app/public/${modelFile}`, import.meta.url ) );
	const blob = new Blob( [ content ], { type: 'model/gltf-binary' } );
	const catalog = { id: 'test-model', assetVersion: 1, name: 'Test model', url: `/${modelFile}` };
	if ( led ) catalog.led = {
		version: 1, assetType: 'main-led-volume-wall', displayMeshName: 'LED_Display_Main', sourceNodeName: 'QuadWall',
		physicalDimensions: { width: 8.8, height: 4.1, depth: 1.797683 }, nativeCanvas: { width: 6144, height: 2592 }, maxBrightnessNits: 600, defaultBrightnessNits: 600,
		uvChannel: 1, uvBounds: { minU: - 0.000700951, maxU: 1, minV: 0.288818359, maxV: 0.7109375 }, flipU: true, panelThickness: 0.025, normalization: { translation: [ 0, 0, 0 ] },
	};
	const sceneRoot = new Scene(), lightScene = new Scene(), roots = [], sceneAssets = [];
	for ( let index = 0; index < ( duplicates ? 2 : 1 ); index ++ ) {

		const gltf = await new GLTFLoader().parseAsync( await blob.arrayBuffer(), '' );
		const root = gltf.scene;
		root.traverse( object => {

			if ( object.isMesh ) for ( const material of Array.isArray( object.material ) ? object.material : [ object.material ] ) prepareRasterMaterial( material );

		} );
		if ( led ) prepareLEDAssetRoot( root, catalog );
		if ( mannequin ) prepareMannequin( root, 'sitting' );
		Object.assign( root.userData, { __rayzeeProjectInstanceId: `original-instance-${index}`, __rayzeeCatalogId: catalog.id, __rayzeeAssetVersion: 1 } );
		root.position.set( 1 + index, 2, 3 );
		sceneRoot.add( root ); roots.push( root );
		sceneAssets.push( { instanceId: root.userData.__rayzeeProjectInstanceId, catalogId: catalog.id, assetVersion: 1 } );

	}

	const settings = new RenderSettings();
	settings.setMany( { environmentMode: 'hdri', enableEnvironment: false, showBackground: false, environmentIntensity: 1, environmentRotation: 45 }, { silent: true, reset: false } );
	const renderer = { toneMapping: 4, outputColorSpace: 'srgb', shadowMap: {}, domElement: { width: 100, height: 100 } };
	const camera = new PerspectiveCamera( 45, 16 / 9, 0.1, 1000 );
	const cameraManager = { camera, controls: { target: new Vector3() }, autoFocusMode: 'manual', afScreenPoint: { x: 0.5, y: 0.5 }, afSmoothingFactor: 0.15, setAutoFocusMode() {}, setAFScreenPoint() {} };
	const lightManager = { scene: lightScene, updateLights() {} };
	const realtimeRenderer = new RealtimeRenderer( { settings, renderer, scene: sceneRoot, lightScene, camera } );
	const app = { getScene: () => sceneRoot, cameraManager, lightManager, settings, renderer, realtimeRenderer };
	const source = { name: 'Private admin project title', projectId: 'private-source-project', scene: { assets: sceneAssets, environment: {} } };
	const args = { app, source, modelFiles: [ catalog ], cameraMetadata: { sensorWidth: 36, sensorHeight: 20.25, frameOverlayRatio: '16:9' }, loadBlob: vi.fn( async () => blob ) };
	return { args, roots, catalog, sceneRoot, blob };

}

describe( 'native admin preset capture', () => {

	it( 'accepts the admin extractor’s exact snorm16 packing while rejecting an edited packed normal', async () => {

		const { args, roots } = await setup();
		const extractor = new GeometryExtractor();
		extractor._compressed = new Set();
		extractor._compressAttributes( roots[ 0 ] );
		let normal;
		roots[ 0 ].traverse( object => {

			if ( ! normal && object.isMesh && object.geometry.getAttribute( 'normal' )?.array instanceof Int16Array ) normal = object.geometry.getAttribute( 'normal' );

		} );
		expect( normal ).toBeDefined();
		await expect( captureAdminPreset( args ) ).resolves.toMatchObject( { studentPreset: { presetId: 'capture' } } );
		const current = normal.getX( 0 );
		normal.setX( 0, current > 0.5 ? current - 0.1 : current + 0.1 );
		await expect( captureAdminPreset( args ) ).rejects.toThrow( /edited normal geometry/ );

	} );

	it( 'pins real catalogue model bytes and captures all native transforms/materials without modifying the editor', async () => {

		const { args, roots } = await setup();
		let mesh;
		roots[ 0 ].traverse( object => {

			if ( object.isMesh && ! mesh ) mesh = object;

		} );
		mesh.material.roughness = 0.237;
		const before = roots[ 0 ].toJSON();
		const sourceBefore = structuredClone( args.source );
		const result = await captureAdminPreset( args );
		expect( validateStudentPresetVersion( result.studentPreset ) ).toBe( result.studentPreset );
		expect( result.studentPreset.snapshot.nodes[ 'model-0-root' ].transform.position ).toEqual( [ 1, 2, 3 ] );
		expect( result.studentPreset.sceneDefinition.models[ 0 ].nodes ).toHaveLength( 2 );
		expect( Object.values( result.studentPreset.snapshot.materials ).flat().some( entry => entry.state.values.roughness === 0.237 ) ).toBe( true );
		expect( result.assetBlobs ).toHaveLength( 1 );
		expect( result.assetBlobs[ 0 ].asset.byteLength ).toBe( result.assetBlobs[ 0 ].blob.size );
		expect( JSON.stringify( result.studentPreset ) ).not.toContain( 'private-source-project' );
		expect( JSON.stringify( result.studentPreset ) ).not.toContain( 'original-instance' );
		expect( roots[ 0 ].toJSON() ).toEqual( before );
		expect( args.source ).toEqual( sourceBefore );

	} );

	it( 'gives identical model instances distinct stable asset and node inventories', async () => {

		const { args } = await setup( { duplicates: true } );
		const result = await captureAdminPreset( args );
		const assets = Object.values( result.studentPreset.assets );
		expect( assets ).toHaveLength( 2 );
		expect( assets[ 0 ].sha256 ).toBe( assets[ 1 ].sha256 );
		expect( assets[ 0 ].assetId ).not.toBe( assets[ 1 ].assetId );
		expect( Object.keys( result.studentPreset.snapshot.nodes ) ).toHaveLength( 4 );

	} );

	it( 'captures a prepared LED display using original pinned UV presentation and excludes its generated rear mesh', async () => {

		const { args, roots, catalog } = await setup( { led: true } );
		const root = roots[ 0 ], displayMesh = root.children[ 0 ];
		args.ledManager = { getRecord: () => ( { displayMesh, file: null } ), getSnapshot: () => ( { status: 'empty', currentTime: 0, seeking: false } ) };
		const { studentPreset, mediaBindings } = await captureAdminPreset( args );
		expect( studentPreset.snapshot.ledWalls ).toHaveLength( 1 );
		expect( studentPreset.snapshot.ledWalls[ 0 ] ).toMatchObject( { mode: 'freeze', media: null, brightnessNits: 600, surface: { flipU: true, uvBounds: [ catalog.led.uvBounds.minU, 1, catalog.led.uvBounds.minV, catalog.led.uvBounds.maxV ] } } );
		expect( studentPreset.snapshot.materials ).toEqual( {} );
		expect( mediaBindings ).toEqual( { 'original-instance-0': null } );
		expect( displayMesh.children ).toHaveLength( 1 );

	} );

	it( 'captures the supported mannequin pose and complete bone node inventory', async () => {

		const { args } = await setup( { mannequin: true } );
		const { studentPreset } = await captureAdminPreset( args );
		expect( studentPreset.sceneDefinition.humanPoseRoots ).toEqual( [ 'model-0-root' ] );
		expect( studentPreset.snapshot.nodes[ 'model-0-root' ].humanPose ).toBe( 'sitting' );
		expect( Object.keys( studentPreset.snapshot.nodes ).length ).toBeGreaterThan( 60 );

	} );

	it( 'pins LED video bytes and preserves playback intent while the authoring service pauses the decoder', async () => {

		const { args, roots } = await setup( { led: true } );
		const root = roots[ 0 ], displayMesh = root.children[ 0 ];
		const file = new Blob( [ await readFile( new URL( './fixtures/led-test-h264.mp4', import.meta.url ) ) ], { type: 'video/mp4' } );
		args.ledManager = { getRecord: () => ( { displayMesh, file, video: { playbackRate: 1.5 } } ), getSnapshot: () => ( { status: 'paused', currentTime: 1.25, duration: 10, seeking: false, isPlaying: false } ) };
		args.playingWalls = new Set( [ root.uuid ] );
		const { studentPreset, assetBlobs, mediaBindings } = await captureAdminPreset( args );
		const wall = studentPreset.snapshot.ledWalls[ 0 ];
		expect( wall ).toMatchObject( { mode: 'play', inPointUs: 1250000, playbackRate: 1.5 } );
		expect( assetBlobs ).toHaveLength( 2 );
		expect( mediaBindings[ 'original-instance-0' ] ).toEqual( wall.media );
		expect( studentPreset.assets[ `${wall.media.assetId}@${wall.media.version}` ] ).toMatchObject( { kind: 'video', durationUs: 10000000, mimeType: 'video/mp4', byteLength: file.size } );

	} );

	it.each( [
		[ 'an added child', value => value.roots[ 0 ].add( new Group() ), /hierarchy|child/ ],
		[ 'an unregistered model', value => value.sceneRoot.add( new Group().add( new Group() ) ), /unregistered/ ],
		[ 'a stale catalogue version', value => value.args.source.scene.assets[ 0 ].assetVersion = 2, /catalogue version/ ],
		[ 'an edited primitive transform', value => value.roots[ 0 ].children[ 0 ].children[ 0 ].position.x += 1, /unmapped model primitives/ ],
		[ 'a different material type', value => value.roots[ 0 ].children[ 0 ].children[ 0 ].material = new MeshBasicMaterial(), /material types/ ],
		[ 'procedural environment mode', value => value.args.app.settings.setMany( { environmentMode: 'procedural' }, { silent: true } ), /HDRI environment mode/ ],
	] )( 'rejects %s before saving a partial scene', async ( _, mutate, expected ) => {

		const value = await setup();
		mutate( value );
		await expect( captureAdminPreset( value.args ) ).rejects.toThrow( expected );

	} );

	it( 'cancels without fetching or modifying the scene', async () => {

		const { args, roots } = await setup();
		const abort = new AbortController(); abort.abort();
		await expect( captureAdminPreset( { ...args, signal: abort.signal } ) ).rejects.toMatchObject( { name: 'AbortError' } );
		expect( args.loadBlob ).not.toHaveBeenCalled();
		expect( roots[ 0 ].position.toArray() ).toEqual( [ 1, 2, 3 ] );

	} );

} );
