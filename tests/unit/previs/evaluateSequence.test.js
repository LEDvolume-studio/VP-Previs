import { describe, expect, it } from 'vitest';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { applyStudentCommand } from '../../../app/src/previs/domain/StudentCommands.js';
import { createSequenceEvaluator, evaluateSequence } from '../../../app/src/previs/sequence/evaluateSequence.js';
import { studentFixture } from './studentFixtures.js';

describe( 'pure frame evaluation', () => {

	it( 'locks student timeline media to the absolute 25 fps frame across cuts, regardless of admin preview pause, offset and speed', () => {

		const document = studentFixture();
		document.assets[ 'video@1' ].durationUs = 180000000;
		for ( const shot of Object.values( document.shots ) ) Object.assign( shot.snapshot.ledWalls[ 0 ], { mode: 'freeze', inPointUs: 42320000, playbackRate: 2, loop: false } );
		const evaluator = createSequenceEvaluator( document );
		for ( const frame of [ 0, 1, 24, 25, 26, 49 ] ) {

			expect( evaluator.evaluate( frame, { timelineFrame: frame } ).led[ 0 ] ).toMatchObject( { sourceTimeUs: frame * 40000, mode: 'play', ended: false } );

		}

		expect( evaluator.evaluate( 26 ).led[ 0 ].sourceTimeUs ).toBe( 42320000 );
		expect( document.shots.shotB.snapshot.ledWalls[ 0 ].mode ).toBe( 'freeze' );

	} );

	it( 'holds the final exact video frame or wraps only when the wall loops', () => {

		const document = studentFixture();
		document.shots.shotA.snapshot.ledWalls[ 0 ].loop = false;
		expect( createSequenceEvaluator( document ).evaluate( 0, { timelineFrame: 25 } ).led[ 0 ] ).toMatchObject( { sourceTimeUs: 960000, ended: true } );
		document.shots.shotA.snapshot.ledWalls[ 0 ].loop = true;
		expect( createSequenceEvaluator( document ).evaluate( 0, { timelineFrame: 26 } ).led[ 0 ].sourceTimeUs ).toBe( 40000 );
		for ( const timelineFrame of [ - 1, 0.5, NaN, Infinity ] ) expect( () => createSequenceEvaluator( document ).evaluate( 0, { timelineFrame } ) ).toThrow( RangeError );

	} );

	it( 'handles empty and one-frame sequences without evaluating an endpoint shot', () => {

		expect( evaluateSequence( createStudentProjectDocument(), 0 ) ).toMatchObject( { ended: true, totalFrames: 0, shot: null, localFrame: null } );
		const document = studentFixture();
		document.clips = [ { clipId: 'single', shotId: 'shotA', durationFrames: 1 } ];
		expect( evaluateSequence( document, 0 ) ).toMatchObject( { ended: false, localFrame: 0, shot: { shotId: 'shotA' } } );
		expect( evaluateSequence( document, 1 ) ).toMatchObject( { ended: true, shot: null, led: [], narration: [] } );

	} );
	it.each( [[ 0, 'clipA', 0 ], [ 24, 'clipA', 24 ], [ 25, 'clipB', 0 ], [ 49, 'clipB', 24 ], [ 50, null, null ]] )( 'evaluates frame %i at half-open cut boundaries', ( frame, clipId, localFrame ) => {

		const evaluation = evaluateSequence( studentFixture(), frame );
		expect( evaluation.activeClip?.clipId || null ).toBe( clipId );
		expect( evaluation.localFrame ).toBe( localFrame );

	} );
	it( 'accepts the 22500-frame limit and rejects nonexistent/out-of-range frames', () => {

		const document = studentFixture();
		document.clips = [ { clipId: 'long', shotId: 'shotA', durationFrames: 22500 } ];
		const evaluator = createSequenceEvaluator( document );
		expect( evaluator.evaluate( 22499 ).localFrame ).toBe( 22499 );
		expect( evaluator.evaluate( 22500 ).ended ).toBe( true );
		for ( const frame of [ - 1, 0.5, 22501, Infinity, NaN ] ) expect( () => evaluator.evaluate( frame ) ).toThrow( RangeError );

	} );
	it( 'uses saved LED in-points and rates with explicit loop/end rules', () => {

		const document = studentFixture();
		const evaluator = createSequenceEvaluator( document );
		expect( evaluator.evaluate( 0 ).led[ 0 ].sourceTimeUs ).toBe( 800000 );
		expect( evaluator.evaluate( 5 ).led[ 0 ].sourceTimeUs ).toBe( 0 );
		expect( evaluator.evaluate( 6 ).led[ 0 ].sourceTimeUs ).toBe( 40000 );
		for ( const frame of [ 25, 30, 49 ] ) expect( evaluator.evaluate( frame ).led[ 0 ].sourceTimeUs ).toBe( 800000 );
		const wall = document.shots.shotA.snapshot.ledWalls[ 0 ];
		wall.loop = false;
		wall.playbackRate = 2;
		expect( evaluateSequence( document, 2 ).led[ 0 ] ).toMatchObject( { sourceTimeUs: 960000, ended: false } );
		expect( evaluateSequence( document, 3 ).led[ 0 ] ).toMatchObject( { sourceTimeUs: 999999, ended: true } );

	} );
	it( 'keeps explicit legacy shot anchors compatible while sequence narration stays absolute', () => {

		const document = studentFixture();
		const before = evaluateSequence( document, 5 );
		expect( before.narration.map( item => [ item.narrationClipId, item.sourceSample ] ) ).toEqual( [[ 'voiceShot', 100 ], [ 'voiceSequence', 10600 ]] );
		const moved = applyStudentCommand( document, { type: 'moveClip', clipId: 'clipA', index: 1 } ).document;
		expect( evaluateSequence( moved, 5 ).narration.map( item => item.narrationClipId ) ).toEqual( [ 'voiceSequence' ] );
		expect( evaluateSequence( moved, 30 ).narration.map( item => [ item.narrationClipId, item.sourceSample ] ) ).toEqual( [[ 'voiceShot', 100 ], [ 'voiceSequence', 58600 ]] );
		expect( evaluateSequence( moved, 25 ).led[ 0 ].sourceTimeUs ).toBe( 800000 );

	} );
	it( 'plays independent recordings across shot cuts without moving or trimming their sources', () => {

		const original = studentFixture();
		original.narration.clips = original.narration.clips.map( clip => ( { ...clip, anchor: { type: 'sequence' } } ) );
		for ( const command of [
			{ type: 'moveClip', clipId: 'clipA', index: 1 },
			{ type: 'setClipDuration', clipId: 'clipA', durationFrames: 5 },
			{ type: 'removeClip', clipId: 'clipA' },
		] ) {

			const changed = applyStudentCommand( original, command ).document;
			expect( changed.narration ).toEqual( original.narration );
			expect( evaluateSequence( changed, 10 ).narration.map( item => [ item.narrationClipId, item.sourceSample ] ) ).toEqual( [[ 'voiceShot', 9700 ], [ 'voiceSequence', 20200 ]] );

		}

		const atCut = evaluateSequence( original, 25 ).narration;
		expect( atCut.map( item => item.sourceSample ) ).toEqual( [ 38500, 49000 ] );
		expect( atCut.map( item => item.remainingSamples ) ).toEqual( [ 48000, 48000 ] );

	} );
	it( 'retains independent narration outside the visual sequence for later recovery', () => {

		const original = studentFixture();
		original.narration.clips = [ { ...original.narration.clips[ 1 ], offsetFrames: 40 } ];
		const shortened = applyStudentCommand( original, { type: 'removeClip', clipId: 'clipA' } ).document;
		expect( shortened.narration ).toEqual( original.narration );
		expect( evaluateSequence( shortened, 24 ).narration ).toEqual( [] );
		const extended = applyStudentCommand( shortened, { type: 'setClipDuration', clipId: 'clipB', durationFrames: 50 } ).document;
		expect( evaluateSequence( extended, 40 ).narration[ 0 ].sourceSample ).toBe( 1000 );

	} );
	it( 'clamps shortened placement narration, preserves orphan data and excludes muted audio', () => {

		const document = studentFixture();
		const shortened = applyStudentCommand( document, { type: 'setClipDuration', clipId: 'clipA', durationFrames: 6 } ).document;
		expect( evaluateSequence( shortened, 5 ).narration.some( item => item.narrationClipId === 'voiceShot' ) ).toBe( true );
		expect( evaluateSequence( shortened, 6 ).narration.some( item => item.narrationClipId === 'voiceShot' ) ).toBe( false );
		const removed = applyStudentCommand( document, { type: 'removeClip', clipId: 'clipA' } ).document;
		expect( removed.narration.clips ).toHaveLength( 2 );
		expect( evaluateSequence( removed, 5 ).narration.map( item => item.narrationClipId ) ).toEqual( [ 'voiceSequence' ] );
		document.narration.clips[ 0 ].muted = true;
		document.narration.clips[ 1 ].gain = 0;
		expect( evaluateSequence( document, 5 ).narration ).toEqual( [] );

	} );
	it( 'uses integer sample trims, including negative offsets and exclusive audio ends', () => {

		const document = studentFixture();
		document.narration.clips = [ { ...document.narration.clips[ 0 ], offsetFrames: - 1, lengthSamples: 3840 } ];
		expect( evaluateSequence( document, 0 ).narration[ 0 ].sourceSample ).toBe( 2020 );
		expect( evaluateSequence( document, 1 ).narration ).toEqual( [] );

	} );
	it( 'bounds scheduled narration tails to shortened placements and the sequence end', () => {

		const document = studentFixture();
		const shortened = applyStudentCommand( document, { type: 'setClipDuration', clipId: 'clipA', durationFrames: 6 } ).document;
		const active = evaluateSequence( shortened, 5 ).narration;
		expect( active.find( item => item.narrationClipId === 'voiceShot' ).remainingSamples ).toBe( 1920 );
		expect( active.find( item => item.narrationClipId === 'voiceSequence' ).remainingSamples ).toBe( ( 31 - 5 ) * 1920 );
		expect( evaluateSequence( shortened, 30 ).narration[ 0 ].remainingSamples ).toBe( 1920 );

	} );
	it( 'keeps fractional sample boundaries continuous through negative narration offsets', () => {

		const document = studentFixture();
		document.narration.assets[ 'voice@1' ].sampleRate = 44101;
		document.narration.clips = [ { ...document.narration.clips[ 0 ], offsetFrames: - 2 } ];
		const evaluator = createSequenceEvaluator( document );
		const first = evaluator.evaluate( 0 ).narration[ 0 ];
		const last = evaluator.evaluate( 24 ).narration[ 0 ];
		const expectedEndSample = 100 + Math.floor( 27 * 44101 / 25 );
		expect( first.sourceSample ).toBe( 100 + Math.floor( 2 * 44101 / 25 ) );
		expect( first.sourceSample + first.remainingSamples ).toBe( expectedEndSample );
		expect( last.sourceSample + last.remainingSamples ).toBe( expectedEndSample );
		expect( evaluator.evaluate( 25 ).narration ).toEqual( [] );

	} );
	it( 'isolates a prepared revision from concurrent edits and never mutates authoring state', () => {

		const document = studentFixture();
		const original = structuredClone( document );
		const evaluator = createSequenceEvaluator( document );
		expect( evaluator.evaluate( 10 ).shot.snapshot.camera.target ).toEqual( [ 0, 0, - 1 ] );
		expect( document ).toEqual( original );
		document.shots.shotA.snapshot.camera.target[ 0 ] = 99;
		expect( evaluator.evaluate( 10 ).shot.snapshot.camera.target[ 0 ] ).toBe( 0 );
		expect( () => evaluator.evaluate( 10 ).shot.snapshot.camera.target.push( 4 ) ).toThrow();

	} );

} );
