import { describe, expect, it } from 'vitest';
import { validateStudentPresetVersion } from '../../../app/src/previs/domain/StudentCatalogueSchema.js';
import { validateStudentSceneDefinition } from '../../../app/src/previs/domain/StudentSceneDefinition.js';
import { createBundledStudentSceneManifest } from '../../../app/src/previs/fixtures/BundledStudentScene.js';
import { studentFixture, transform } from './studentFixtures.js';

function fixture() {

	const manifest = createBundledStudentSceneManifest( { models: [ 'led' ] } );
	const sceneDefinition = { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: manifest.baseScene, models: manifest.models.map( ( { asset, nodes } ) => ( { asset, nodes } ) ), humanPoseRoots: [] };
	const snapshot = structuredClone( studentFixture().shots.shotA.snapshot );
	snapshot.nodes = Object.fromEntries( sceneDefinition.models.flatMap( model => model.nodes.map( node => [ node.instanceId, { asset: model.asset, nodeId: node.nodeId, transform: transform(), humanPose: null, doorAngles: {} } ] ) ) );
	snapshot.ledWalls = [ { wallId: 'display', presentationVersion: 1, nodeInstanceId: 'led-instance-0', media: null, mode: 'freeze', inPointUs: 0, loop: false, playbackRate: 1, brightnessNits: 200, placement: { position: [ 0.5, 0.5 ], scale: [ 1, 1 ], rotationDegrees: 0, aspectRatioLocked: true, fitMode: 'contain' }, surface: { nativeCanvas: [ 6144, 2592 ], uvChannel: 0, uvBounds: [ 0, 1, 0, 1 ], flipU: false } } ];
	snapshot.rasterAppearance = { version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb', enableEnvironment: true, showBackground: true, transparentBackground: false, backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#000000' };
	return { format: 'rayzee-student-preset', schemaVersion: 2, presetId: 'display-shot', version: '1', name: 'Display', description: '', category: 'Studio', defaultDurationFrames: 125, thumbnail: null, assets: manifest.assets, baseScene: manifest.baseScene, snapshot, sceneDefinition };

}

describe( 'Supported immutable scene definitions', () => {

	it( 'validates a URL-free complete scene/preset using the actual LED model mapping', () => {

		const preset = fixture();
		expect( validateStudentSceneDefinition( preset.sceneDefinition, preset.assets ) ).toBe( preset.sceneDefinition );
		expect( validateStudentPresetVersion( preset ) ).toBe( preset );

	} );

	it( 'retains schema v1 metadata without pretending it has a render capability', () => {

		const preset = fixture();
		delete preset.sceneDefinition; delete preset.snapshot.rasterAppearance;
		preset.schemaVersion = 1;
		expect( validateStudentPresetVersion( preset ) ).toBe( preset );
		preset.schemaVersion = 2;
		expect( () => validateStudentPresetVersion( preset ) ).toThrow();

	} );

	it.each( [
		value => {

			value.models[ 0 ].source = '/model.glb';

		},
		value => {

			value.models[ 0 ].asset.url = 'https://untrusted.invalid/model.glb';

		},
		value => {

			value.models.push( structuredClone( value.models[ 0 ] ) );

		},
		value => {

			value.models = [];

		},
		value => {

			value.models[ 0 ].nodes.push( structuredClone( value.models[ 0 ].nodes[ 0 ] ) );

		},
		value => {

			value.models[ 0 ].nodes[ 1 ].nodeId = value.models[ 0 ].nodes[ 0 ].nodeId;

		},
		value => {

			value.models[ 0 ].nodes[ 1 ].instanceId = value.models[ 0 ].nodes[ 0 ].instanceId;

		},
		value => {

			value.models[ 0 ].nodes[ 0 ].expectedName = 'Root';

		},
		value => {

			value.models[ 0 ].nodes[ 1 ].gltfNodeIndex = - 1;

		},
		value => {

			value.models[ 0 ].nodes[ 1 ].expectedName = null;

		},
		value => {

			value.models[ 0 ].nodes[ 0 ].instanceId = '../unsafe';

		},
		value => {

			value.humanPoseRoots = [ 'led-instance-0' ];

		},
		value => {

			value.humanPoseRoots = [ 'led-root', 'led-root' ];

		},
	] )( 'rejects unsafe or ambiguous portable scene mappings %#', mutate => {

		const preset = fixture(); mutate( preset.sceneDefinition );
		expect( () => validateStudentSceneDefinition( preset.sceneDefinition, preset.assets ) ).toThrow();

	} );

	it( 'bounds both individual assets and the total scene independently', () => {

		const preset = fixture();
		Object.values( preset.assets )[ 0 ].byteLength = 64 * 1024 * 1024 + 1;
		expect( () => validateStudentSceneDefinition( preset.sceneDefinition, preset.assets ) ).toThrow( /bounded/ );
		const manifest = createBundledStudentSceneManifest();
		const definition = { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: manifest.baseScene, models: manifest.models.map( ( { asset, nodes } ) => ( { asset, nodes } ) ), humanPoseRoots: [ 'mannequin-root' ] };
		for ( const asset of Object.values( manifest.assets ) ) asset.byteLength = 64 * 1024 * 1024;
		expect( () => validateStudentSceneDefinition( definition, manifest.assets ) ).toThrow( /memory limit/ );

	} );

	it.each( [
		preset => {

			delete preset.snapshot.rasterAppearance;

		},
		preset => {

			delete preset.snapshot.nodes[ 'led-root' ];

		},
		preset => {

			preset.snapshot.nodes[ 'led-root' ].nodeId = 'different';

		},
		preset => {

			preset.snapshot.nodes[ 'led-root' ].humanPose = 'sitting';

		},
		preset => {

			preset.snapshot.nodes[ 'led-root' ].doorAngles = { left: 0.5 };

		},
		preset => {

			preset.sceneDefinition.humanPoseRoots = [ 'led-root' ];

		},
		preset => {

			preset.snapshot.ledWalls[ 0 ].nodeInstanceId = 'led-root';

		},
		preset => {

			preset.snapshot.ledWalls.push( { ...preset.snapshot.ledWalls[ 0 ], wallId: 'second' } );

		},
		preset => {

			preset.snapshot.environment.rotation[ 0 ] = 0.1;

		},
		preset => {

			preset.snapshot.camera.renderProjection.type = 'equirectangular';

		},
		preset => {

			preset.baseScene = { ...preset.baseScene, version: 'changed' };

		},
		preset => {

			preset.snapshot.lights = Array.from( { length: 65 }, ( _, index ) => ( { ...preset.snapshot.lights[ 0 ], lightId: `light-${index}` } ) );

		},
	] )( 'rejects presets whose snapshot exceeds the declared raster capability %#', mutate => {

		const preset = fixture(); mutate( preset );
		expect( () => validateStudentPresetVersion( preset ) ).toThrow();

	} );

	it( 'allows declared human roots only with an explicit standing or sitting snapshot', () => {

		const preset = fixture();
		preset.sceneDefinition.humanPoseRoots = [ 'led-root' ];
		preset.snapshot.nodes[ 'led-root' ].humanPose = 'sitting';
		// Byte preflight independently rejects this LED asset as a human rig.
		expect( validateStudentPresetVersion( preset ) ).toBe( preset );

	} );

} );
