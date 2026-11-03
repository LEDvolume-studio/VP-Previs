import { describe, expect, it } from 'vitest';
import { createShotViewportCompatibility } from '../../../app/src/previs/engine/ShotViewportCompatibility.js';
import { createBundledStudentSceneManifest } from '../../../app/src/previs/fixtures/BundledStudentScene.js';
import { studentFixture, transform } from './studentFixtures.js';

function fixture() {

	const document = studentFixture();
	const manifest = createBundledStudentSceneManifest( { models: [ 'led' ] } );
	const sceneDefinition = { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: manifest.baseScene, models: manifest.models.map( ( { asset, nodes } ) => ( { asset, nodes } ) ), humanPoseRoots: [] };
	document.assets = { ...manifest.assets, 'video@1': document.assets[ 'video@1' ] };
	document.baseScenes = { [ `${manifest.baseScene.sceneId}@${manifest.baseScene.version}` ]: manifest.baseScene };
	const shot = document.shots.shotA;
	shot.baseScene = { sceneId: manifest.baseScene.sceneId, version: manifest.baseScene.version };
	shot.snapshot.nodes = Object.fromEntries( sceneDefinition.models.flatMap( model => model.nodes.map( node => [ node.instanceId, { asset: model.asset, nodeId: node.nodeId, transform: transform(), humanPose: null, doorAngles: {} } ] ) ) );
	shot.snapshot.ledWalls = [ { wallId: 'display', presentationVersion: 1, nodeInstanceId: 'led-instance-0', media: { assetId: 'video', version: '1' }, mode: 'freeze', inPointUs: 0, loop: false, playbackRate: 1, brightnessNits: 200, placement: { position: [ 0.5, 0.5 ], scale: [ 1, 1 ], rotationDegrees: 0, aspectRatioLocked: true, fitMode: 'contain' }, surface: { nativeCanvas: [ 6144, 2592 ], uvChannel: 0, uvBounds: [ 0, 1, 0, 1 ], flipU: false } } ];
	shot.snapshot.rasterAppearance = { version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb', enableEnvironment: true, showBackground: true, transparentBackground: false, backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#000000' };
	document.shots.shotB = { ...structuredClone( shot ), shotId: 'shotB', name: 'Another copy' };
	const compatible = createShotViewportCompatibility( { document, shotId: 'shotA', sceneDefinition } );
	return { document, sceneDefinition, compatible };

}

describe( 'Prepared shot viewport compatibility', () => {

	it( 'reuses an immutable scene for saved camera, node, light, appearance and LED presentation edits', () => {

		const { document, compatible } = fixture();
		const snapshot = document.shots.shotA.snapshot;
		snapshot.camera.transform.position = [ 3, 4, 5 ]; snapshot.camera.exposure = 1.5;
		snapshot.nodes[ 'led-root' ].transform.position = [ 2, 0, - 3 ];
		snapshot.lights[ 0 ].intensity = 120;
		snapshot.rasterAppearance.toneMapping = 0;
		snapshot.ledWalls[ 0 ].brightnessNits = 1000;
		snapshot.ledWalls[ 0 ].mode = 'play'; snapshot.ledWalls[ 0 ].inPointUs = 500000;
		snapshot.ledWalls[ 0 ].placement.position = [ 0.6, 0.4 ];
		expect( compatible( document, 'shotA' ) ).toBe( true );

	} );

	it( 'accepts another compatible shot, changed names/source metadata and unrelated new library assets', () => {

		const { document, compatible } = fixture();
		document.shots.shotB.name = 'Renamed';
		document.shots.shotB.sourcePreset = { presetId: 'different-origin', version: '2' };
		document.assets[ 'unused@2' ] = { ...document.assets[ 'video@1' ], assetId: 'unused', version: '2' };
		expect( compatible( document, 'shotB' ) ).toBe( true );

	} );

	it( 'can blank a prepared display and later reuse its already prepared source', () => {

		const { document, compatible } = fixture();
		const wall = document.shots.shotA.snapshot.ledWalls[ 0 ];
		wall.media = null;
		expect( compatible( document, 'shotA' ) ).toBe( true );
		wall.media = { assetId: 'video', version: '1' };
		expect( compatible( document, 'shotA' ) ).toBe( true );

	} );

	it.each( [
		value => {

			value.shots.shotA.snapshot.lights[ 0 ].lightId = 'new-light';

		},
		value => {

			value.shots.shotA.snapshot.lights = [];

		},
		value => {

			value.shots.shotA.snapshot.ledWalls[ 0 ].wallId = 'new-wall';

		},
		value => {

			value.shots.shotA.snapshot.ledWalls = [];

		},
		value => {

			value.shots.shotA.snapshot.nodes[ 'led-root' ].nodeId = 'unmapped';

		},
		value => {

			delete value.shots.shotA.snapshot.nodes[ 'led-root' ];

		},
		value => {

			value.shots.shotA.snapshot.ledWalls[ 0 ].nodeInstanceId = 'led-root';

		},
		value => {

			value.shots.shotA.baseScene.version = 'changed';

		},
		value => {

			value.assets[ Object.keys( value.assets )[ 0 ] ].sha256 = 'f'.repeat( 64 );

		},
		value => {

			value.assets[ 'video@1' ].durationUs = 2000000;

		},
		value => {

			value.assets[ 'video@1' ].sha256 = 'f'.repeat( 64 );

		},
		value => {

			value.assets[ 'video@2' ] = { ...value.assets[ 'video@1' ], version: '2' };
			value.shots.shotA.snapshot.ledWalls[ 0 ].media.version = '2';

		},
		value => {

			value.shots.shotB.snapshot.camera.exposure = NaN;

		},
	] )( 'requires reload for changed immutable capabilities or invalid complete documents %#', mutate => {

		const { document, compatible } = fixture(); mutate( document );
		expect( compatible( document, 'shotA' ) ).toBe( false );

	} );

	it( 'captures trusted capabilities independently of later mutations to the initial document/definition', () => {

		const { document, sceneDefinition, compatible } = fixture();
		const pristine = structuredClone( document );
		sceneDefinition.models[ 0 ].nodes[ 0 ].nodeId = 'tampered';
		document.assets[ 'video@1' ].sha256 = 'f'.repeat( 64 );
		expect( compatible( pristine, 'shotA' ) ).toBe( true );
		expect( compatible( document, 'shotA' ) ).toBe( false );
		expect( compatible( pristine, 'missing' ) ).toBe( false );

	} );

} );

it( 'accepts an additional video only after the host registers its verified metadata', () => {

	const { document, compatible } = fixture();
	const asset = { ...document.assets[ 'video@1' ], assetId: 'next-video' };
	document.assets[ 'next-video@1' ] = asset;
	document.shots.shotB.snapshot.ledWalls[ 0 ].media = { assetId: 'next-video', version: '1' };
	expect( compatible.canPrepare( document, 'shotB' ) ).toBe( true );
	expect( compatible( document, 'shotB' ) ).toBe( false );
	compatible.registerPreparedAsset( asset );
	expect( compatible( document, 'shotB' ) ).toBe( true );
	expect( () => compatible.registerPreparedAsset( { ...asset, sha256: 'f'.repeat( 64 ) } ) ).toThrow( 'metadata changed' );

} );

it( 'reuses a prepared light pool across shots with different light inventories', () => {

	const { document, sceneDefinition } = fixture();
	const lights = structuredClone( document.shots.shotA.snapshot.lights );
	lights.push( { ...structuredClone( lights[ 0 ] ), lightId: 'other-light' } );
	const compatible = createShotViewportCompatibility( { document, shotId: 'shotA', sceneDefinition, lightInventory: lights } );
	document.shots.shotB.snapshot.lights = [];
	expect( compatible( document, 'shotB' ) ).toBe( true );
	document.shots.shotB.snapshot.lights = [ lights[ 1 ] ];
	expect( compatible( document, 'shotB' ) ).toBe( true );
	document.shots.shotB.snapshot.lights[ 0 ].lightId = 'unprepared';
	expect( compatible( document, 'shotB' ) ).toBe( false );

} );
