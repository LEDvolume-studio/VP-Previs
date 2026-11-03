import { describe, expect, it } from 'vitest';
import { applyProjectPresetSnapshot, mergePresetMediaAssets } from '../../../app/src/student/editor/ApplyProjectPreset.js';
import { studentFixture } from './studentFixtures.js';

function fixture() {

	const document = studentFixture(), active = document.shots.shotA;
	const preset = { baseScene: structuredClone( active.baseScene ), snapshot: structuredClone( active.snapshot ), assets: structuredClone( document.assets ) };
	return { document, active, preset };

}

describe( 'Student project preset state', () => {

	it( 'applies authored video, timing and LED presentation while retaining the current mesh binding', () => {

		const { document, active, preset } = fixture();
		const wall = { wallId: 'current-wall', presentationVersion: 1, nodeInstanceId: 'carInstance', media: { assetId: 'video', version: '1' }, mode: 'play', inPointUs: 0, loop: true, playbackRate: 1, brightnessNits: 100, placement: { position: [ 0.5, 0.5 ], scale: [ 1, 1 ], rotationDegrees: 0, aspectRatioLocked: true, fitMode: 'contain' }, surface: { nativeCanvas: [ 16000, 4000 ], uvChannel: 0, uvBounds: [ 0, 1, 0, 1 ], flipU: true } };
		active.snapshot.ledWalls = [ wall ];
		preset.snapshot.ledWalls = [ { ...structuredClone( wall ), wallId: 'published-wall', media: { assetId: 'rear', version: '1' }, mode: 'freeze', inPointUs: 42320000, brightnessNits: 60 } ];
		preset.snapshot.ledWalls[ 0 ].placement.rotationDegrees = 15;
		preset.assets[ 'rear@1' ] = { ...document.assets[ 'video@1' ], assetId: 'rear', durationUs: 180000000 };
		const snapshot = applyProjectPresetSnapshot( active, preset, document.assets );
		expect( snapshot.ledWalls[ 0 ] ).toMatchObject( { wallId: 'current-wall', nodeInstanceId: 'carInstance', media: { assetId: 'rear', version: '1' }, mode: 'freeze', inPointUs: 42320000, brightnessNits: 60, placement: { rotationDegrees: 15 } } );
		expect( active.snapshot.ledWalls[ 0 ].media.assetId ).toBe( 'video' );
		const assets = mergePresetMediaAssets( document.assets, snapshot, preset.assets );
		expect( assets[ 'rear@1' ] ).toEqual( preset.assets[ 'rear@1' ] );
		expect( document.assets ).not.toHaveProperty( 'rear@1' );
		assets[ 'rear@1' ].sha256 = 'f'.repeat( 64 );
		expect( () => mergePresetMediaAssets( assets, snapshot, preset.assets ) ).toThrow( 'conflicts' );

	} );

	it( 'applies car and human transforms/visibility while retaining materials, media, poses and asset bindings', () => {

		const { document, active, preset } = fixture();
		active.snapshot.nodes.human = structuredClone( active.snapshot.nodes.carInstance );
		active.snapshot.nodes.human.nodeId = 'human'; active.snapshot.nodes.human.humanPose = 'sitting';
		preset.snapshot.nodes.human = structuredClone( active.snapshot.nodes.human );
		preset.snapshot.nodes.carInstance.transform.position = [ 7, 0, 0 ];
		preset.snapshot.nodes.human.transform.position = [ 7, 1, 0 ];
		preset.snapshot.nodes.human.transform.visible = false; preset.snapshot.nodes.human.humanPose = 'standing';
		preset.snapshot.lights[ 0 ].intensity = 999;
		const original = structuredClone( active );
		const applied = applyProjectPresetSnapshot( active, preset, document.assets );
		expect( applied.nodes.carInstance.transform.position ).toEqual( [ 7, 0, 0 ] );
		expect( applied.nodes.human.transform.visible ).toBe( false );
		expect( applied.nodes.human.transform.position ).toEqual( [ 7, 1, 0 ] );
		expect( applied.nodes.human.humanPose ).toBe( 'sitting' );
		expect( applied.nodes.carInstance.asset ).toEqual( original.snapshot.nodes.carInstance.asset );
		expect( applied.ledWalls ).toEqual( original.snapshot.ledWalls );
		expect( applied.lights[ 0 ].intensity ).toBe( 999 );
		expect( active ).toEqual( original );

	} );

	it( 'maps legacy scene and node IDs using verified model bytes and glTF indices', () => {

		const { document, active, preset } = fixture();
		preset.baseScene.sceneId = 'admin-export';
		const node = preset.snapshot.nodes.carInstance;
		delete preset.snapshot.nodes.carInstance;
		node.asset = { assetId: 'exported-car', version: '1' }; node.nodeId = 'new-root'; node.transform.position = [ 8, 0, 1 ];
		preset.snapshot.nodes.newCar = node;
		preset.assets[ 'exported-car@1' ] = { ...document.assets[ 'car@1' ], assetId: 'exported-car' };
		preset.sceneDefinition = { models: [ { asset: node.asset, nodes: [ { instanceId: 'newCar', gltfNodeIndex: null } ] } ] };
		const definition = { models: [ { asset: { assetId: 'car', version: '1' }, nodes: [ { instanceId: 'carInstance', gltfNodeIndex: null } ] } ] };
		const result = applyProjectPresetSnapshot( active, preset, document.assets, definition );
		expect( result.nodes.carInstance.transform.position ).toEqual( [ 8, 0, 1 ] );
		expect( result.nodes.carInstance.nodeId ).toBe( 'root' );
		expect( result.nodes ).not.toHaveProperty( 'newCar' );
		preset.assets[ 'exported-car@1' ].sha256 = 'f'.repeat( 64 );
		expect( () => applyProjectPresetSnapshot( active, preset, document.assets, definition ) ).toThrow( 'different scene setup' );

	} );

	it( 'rejects missing objects atomically rather than importing them', () => {

		const { document, active, preset } = fixture(), original = structuredClone( active );
		preset.snapshot.nodes.missing = structuredClone( preset.snapshot.nodes.carInstance );
		expect( () => applyProjectPresetSnapshot( active, preset, document.assets ) ).toThrow( 'outside the current project' );
		expect( active ).toEqual( original );

	} );

} );

it( 'restores light position, intensity and visibility independently, including a visible zero-intensity light', () => {

	const { document, active, preset } = fixture();
	const incoming = preset.snapshot.lights[ 0 ];
	incoming.transform.position = [ 3, 6, 5 ]; incoming.transform.visible = false; incoming.intensity = 37;
	const hidden = applyProjectPresetSnapshot( active, preset, document.assets );
	expect( hidden.lights[ 0 ].transform.position ).toEqual( [ 3, 6, 5 ] );
	expect( hidden.lights[ 0 ].transform.visible ).toBe( false );
	expect( hidden.lights[ 0 ].intensity ).toBe( 37 );
	incoming.transform.visible = true; incoming.intensity = 0;
	const dark = applyProjectPresetSnapshot( active, preset, document.assets );
	expect( dark.lights[ 0 ].transform.visible ).toBe( true );
	expect( dark.lights[ 0 ].intensity ).toBe( 0 );
	expect( dark.lights[ 0 ].lightId ).toBe( active.snapshot.lights[ 0 ].lightId );
	expect( dark.lights[ 0 ].parameters ).toEqual( active.snapshot.lights[ 0 ].parameters );
	expect( active.snapshot.lights[ 0 ].intensity ).toBe( 5 );

} );

it( 'removes obsolete lights when a preset has no lights', () => {

	const { document, active, preset } = fixture();
	preset.snapshot.lights = [];
	expect( active.snapshot.lights.length ).toBeGreaterThan( 0 );
	expect( applyProjectPresetSnapshot( active, preset, document.assets ).lights ).toEqual( [] );
	expect( active.snapshot.lights.length ).toBeGreaterThan( 0 );

} );
