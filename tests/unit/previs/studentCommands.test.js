import { describe, expect, it } from 'vitest';
import { applyStudentCommand, createShotFromPreset } from '../../../app/src/previs/domain/StudentCommands.js';
import { studentFixture, TEST_NOW } from './studentFixtures.js';

const apply = ( document, command ) => applyStudentCommand( document, command, { now: TEST_NOW } );

describe( 'student edit commands', () => {

	it( 'creates a custom shot and immutable scene in one revision and undo step', () => {

		const original = studentFixture();
		const scene = { sceneId: 'customScene', version: '1', assets: [ { assetId: 'car', version: '1' } ] };
		const shot = { ...structuredClone( original.shots.shotA ), shotId: 'customShot', baseScene: { sceneId: 'customScene', version: '1' }, sourcePreset: null };
		const created = apply( original, { type: 'addCustomShot', scene, shot } );
		expect( created.document.revision ).toBe( 1 );
		expect( created.document.baseScenes[ 'customScene@1' ] ).toEqual( scene );
		expect( created.document.shots.customShot ).toEqual( shot );
		expect( created.document.baseScenes[ 'studio@1' ] ).toEqual( original.baseScenes[ 'studio@1' ] );
		shot.snapshot.camera.exposure = 12;
		scene.assets.length = 0;
		expect( created.document.shots.customShot.snapshot.camera.exposure ).toBe( 1 );
		expect( created.document.baseScenes[ 'customScene@1' ].assets ).toHaveLength( 1 );
		const undone = apply( created.document, created.inverse );
		expect( undone.document.revision ).toBe( 2 );
		expect( undone.document.shots ).toEqual( original.shots );
		expect( undone.document.baseScenes ).toEqual( original.baseScenes );
		const redone = apply( undone.document, undone.inverse );
		expect( redone.document.revision ).toBe( 3 );
		expect( redone.document.shots ).toEqual( created.document.shots );
		expect( redone.document.baseScenes ).toEqual( created.document.baseScenes );

	} );
	it( 'rejects custom-shot collisions or invalid references without leaving a scene behind', () => {

		const original = studentFixture();
		const before = structuredClone( original );
		const scene = { sceneId: 'customScene', version: '1', assets: [ { assetId: 'car', version: '1' } ] };
		const shot = { ...structuredClone( original.shots.shotA ), shotId: 'customShot', baseScene: { sceneId: 'customScene', version: '1' }, sourcePreset: null };
		for ( const command of [
			{ scene: original.baseScenes[ 'studio@1' ], shot: { ...shot, baseScene: { sceneId: 'studio', version: '1' } } },
			{ scene, shot: { ...shot, shotId: 'shotA' } },
			{ scene, shot: { ...shot, baseScene: { sceneId: 'studio', version: '1' } } },
			{ scene, shot: { ...shot, sourcePreset: { presetId: 'wide', version: '1' } } },
			{ scene: { ...scene, assets: [] }, shot },
		] ) expect( () => apply( original, { type: 'addCustomShot', ...command } ) ).toThrow();
		expect( original ).toEqual( before );

	} );

	it( 'copies preset and duplicate shot state without mutable aliasing', () => {

		const document = studentFixture();
		const preset = { presetId: 'wide', version: '1', ...document.shots.shotA };
		const shot = createShotFromPreset( preset, { shotId: 'copied' } );
		shot.snapshot.camera.target[ 0 ] = 10;
		expect( preset.snapshot.camera.target[ 0 ] ).toBe( 0 );
		const result = apply( document, { type: 'duplicateShot', shotId: 'shotA', newShotId: 'copy' } );
		result.document.shots.copy.snapshot.camera.target[ 0 ] = 20;
		expect( result.document.shots.shotA.snapshot.camera.target[ 0 ] ).toBe( 0 );
		expect( document.revision ).toBe( 0 );

	} );
	it( 'undoes and redoes reorder/duration edits as new revisions', () => {

		const original = studentFixture();
		const moved = apply( original, { type: 'moveClip', clipId: 'clipA', index: 1 } );
		expect( moved.document.clips.map( clip => clip.clipId ) ).toEqual( [ 'clipB', 'clipA' ] );
		const resized = apply( moved.document, { type: 'setClipDuration', clipId: 'clipA', durationFrames: 50 } );
		const undone = apply( resized.document, resized.inverse );
		expect( undone.document.clips ).toEqual( moved.document.clips );
		expect( undone.document.revision ).toBe( 3 );
		const redone = apply( undone.document, undone.inverse );
		expect( redone.document.clips ).toEqual( resized.document.clips );
		expect( redone.document.revision ).toBe( 4 );
		expect( original.clips[ 0 ].durationFrames ).toBe( 25 );

	} );
	it( 'preserves narration after deletion; undo restores the exact placement', () => {

		const document = studentFixture();
		const removed = apply( document, { type: 'removeClip', clipId: 'clipA' } );
		expect( removed.document.narration ).toEqual( document.narration );
		const restored = apply( removed.document, removed.inverse );
		expect( restored.document.clips ).toEqual( document.clips );
		expect( restored.document.narration ).toEqual( document.narration );

	} );
	it( 'duplicates placement without implicitly duplicating shot narration', () => {

		const document = studentFixture();
		const duplicated = apply( document, { type: 'duplicateClip', clipId: 'clipA', newClipId: 'clipCopy' } );
		expect( duplicated.document.clips[ 1 ] ).toEqual( { clipId: 'clipCopy', shotId: 'shotA', durationFrames: 25 } );
		expect( duplicated.document.narration ).toEqual( document.narration );

	} );
	it( 'creates independent narration by default and preserves it through shot edits', () => {

		const original = studentFixture();
		const clip = { ...original.narration.clips[ 0 ], narrationClipId: 'independent' };
		delete clip.anchor;
		const added = apply( original, { type: 'addNarrationClip', clip } ).document;
		expect( added.narration.clips.at( - 1 ).anchor ).toEqual( { type: 'sequence' } );
		for ( const command of [
			{ type: 'moveClip', clipId: 'clipA', index: 1 },
			{ type: 'setClipDuration', clipId: 'clipA', durationFrames: 1 },
			{ type: 'removeClip', clipId: 'clipA' },
		] ) expect( apply( added, command ).document.narration ).toEqual( added.narration );
		expect( () => apply( original, { type: 'addNarrationClip', clip: { ...original.narration.clips[ 0 ], narrationClipId: 'newLegacy' } } ) ).toThrow( /independent/ );

	} );
	it( 'moves explicitly selected narration with a shot block in one undoable edit', () => {

		const original = studentFixture();
		const moved = apply( original, { type: 'moveTimelineSelection', clipIds: [ 'clipA' ], narrationClipIds: [ 'voiceSequence' ], index: 1 } );
		expect( moved.document.clips.map( clip => clip.clipId ) ).toEqual( [ 'clipB', 'clipA' ] );
		expect( moved.document.narration.clips[ 1 ].offsetFrames ).toBe( 25 );
		expect( moved.document.narration.clips[ 0 ] ).toEqual( original.narration.clips[ 0 ] );
		expect( apply( moved.document, moved.inverse ).document.narration ).toEqual( original.narration );
		const audioOnly = apply( original, { type: 'moveTimelineSelection', clipIds: [], narrationClipIds: [ 'voiceSequence' ], deltaFrames: - 10 } );
		expect( audioOnly.document.clips ).toEqual( original.clips );
		expect( audioOnly.document.narration.clips[ 1 ].offsetFrames ).toBe( - 10 );
		expect( audioOnly.document.narration.assets ).toEqual( original.narration.assets );

	} );
	it( 'preserves shot block order and selected narration offsets relative to each other', () => {

		const original = studentFixture();
		original.clips.push( { clipId: 'clipC', shotId: 'shotA', durationFrames: 10 }, { clipId: 'clipD', shotId: 'shotB', durationFrames: 15 } );
		original.narration.clips = original.narration.clips.map( clip => ( { ...clip, anchor: { type: 'sequence' } } ) );
		const moved = apply( original, { type: 'moveTimelineSelection', clipIds: [ 'clipB', 'clipC' ], narrationClipIds: [ 'voiceShot', 'voiceSequence' ], index: 2 } ).document;
		expect( moved.clips.map( clip => clip.clipId ) ).toEqual( [ 'clipA', 'clipD', 'clipB', 'clipC' ] );
		expect( moved.narration.clips.map( clip => clip.offsetFrames ) ).toEqual( [ 20, 15 ] );

	} );
	it( 'rejects ambiguous or out-of-range group moves atomically', () => {

		const original = studentFixture();
		original.clips.push( { clipId: 'clipC', shotId: 'shotA', durationFrames: 25 } );
		const before = structuredClone( original );
		for ( const command of [
			{ clipIds: [ 'clipA', 'clipC' ], narrationClipIds: [], index: 0 },
			{ clipIds: [ 'clipA', 'clipA' ], narrationClipIds: [], index: 0 },
			{ clipIds: [ 'missing' ], narrationClipIds: [], index: 0 },
			{ clipIds: [ 'clipA' ], narrationClipIds: [ 'voiceShot' ], index: 1 },
			{ clipIds: [], narrationClipIds: [ 'voiceSequence' ], deltaFrames: 22501 },
			{ clipIds: [], narrationClipIds: [ 'voiceSequence' ], deltaFrames: 0.5 },
			{ clipIds: [ 'clipA' ], narrationClipIds: [], index: 1, deltaFrames: 10 },
			{ clipIds: [], narrationClipIds: [], deltaFrames: 1 },
		] ) expect( () => apply( original, { type: 'moveTimelineSelection', ...command } ) ).toThrow();
		expect( original ).toEqual( before );

	} );
	it( 'detaches legacy narration explicitly without losing source samples or rewriting imports', () => {

		const original = studentFixture();
		const reordered = apply( original, { type: 'moveClip', clipId: 'clipA', index: 1 } ).document;
		const detached = apply( reordered, { type: 'detachNarrationFromShot', narrationClipId: 'voiceShot' } );
		expect( detached.document.narration.clips[ 0 ] ).toEqual( { ...original.narration.clips[ 0 ], anchor: { type: 'sequence' }, offsetFrames: 30 } );
		expect( apply( detached.document, detached.inverse ).document.narration ).toEqual( reordered.narration );
		const removed = apply( original, { type: 'removeClip', clipId: 'clipA' } ).document;
		expect( () => apply( removed, { type: 'detachNarrationFromShot', narrationClipId: 'voiceShot' } ) ).toThrow( /explicit frame/ );
		expect( apply( removed, { type: 'detachNarrationFromShot', narrationClipId: 'voiceShot', offsetFrames: 7 } ).document.narration.clips[ 0 ].offsetFrames ).toBe( 7 );
		const deletedAudio = apply( detached.document, { type: 'removeNarrationClip', narrationClipId: 'voiceShot' } );
		expect( deletedAudio.document.narration.assets ).toEqual( original.narration.assets );
		expect( apply( deletedAudio.document, deletedAudio.inverse ).document.narration.clips ).toEqual( detached.document.narration.clips );

	} );
	it( 'rejects invalid edits atomically without touching input', () => {

		const document = studentFixture();
		const copy = structuredClone( document );
		for ( const command of [
			{ type: 'setClipDuration', clipId: 'clipA', durationFrames: 22500 },
			{ type: 'moveClip', clipId: 'clipA', index: 3 },
			{ type: 'duplicateClip', clipId: 'clipA', newClipId: 'clipB' },
			{ type: 'duplicateShot', shotId: 'shotA', newShotId: 'shotB' },
			{ type: 'removeShot', shotId: 'shotA' },
			{ type: 'addAssetVersion', asset: document.assets[ 'car@1' ] },
			{ type: 'restoreContent', content: { projectId: 'stolen' } },
		] ) expect( () => apply( document, command ) ).toThrow();
		expect( document ).toEqual( copy );

	} );
	it( 'does not revise or back up no-op edits and has no transport edit command', () => {

		const document = studentFixture();
		expect( apply( document, { type: 'renameProject', name: document.name } ) ).toEqual( { document, changed: false, inverse: null } );
		expect( apply( document, { type: 'moveClip', clipId: 'clipA', index: 0 } ).changed ).toBe( false );
		expect( () => apply( document, { type: 'seek', frame: 1 } ) ).toThrow( /Unknown/ );

	} );

} );
