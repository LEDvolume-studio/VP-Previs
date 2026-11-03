import { afterEach, describe, expect, it, vi } from 'vitest';
import { editVoiceoverClip } from '../../../app/src/student/editor/VoiceoverGeometry.js';
import { LocalNarration } from '../../../app/src/student/editor/LocalNarration.js';
import { studentFixture } from './studentFixtures.js';

afterEach( () => vi.unstubAllGlobals() );

describe( 'Voiceover timeline edits', () => {

	const asset = { sampleRate: 48000, durationSamples: 480000 };
	const clip = { narrationClipId: 'voice', anchor: { type: 'sequence' }, offsetFrames: 25, sourceStartSample: 48000, lengthSamples: 96000 };
	it( 'moves without changing source samples and clamps at the sequence start', () => {

		expect( editVoiceoverClip( clip, asset, 'move', - 100 ) ).toEqual( { ...clip, offsetFrames: 0 } );
		expect( editVoiceoverClip( clip, asset, 'move', 20 ).offsetFrames ).toBe( 45 );

	} );
	it( 'trims the beginning by moving source in and timeline start together', () => {

		expect( editVoiceoverClip( clip, asset, 'left', 25 ) ).toEqual( { ...clip, offsetFrames: 50, sourceStartSample: 96000, lengthSamples: 48000 } );
		const bounded = editVoiceoverClip( clip, asset, 'left', - 1000 );
		expect( bounded.sourceStartSample ).toBe( 0 ); expect( bounded.offsetFrames ).toBe( 0 );

	} );
	it( 'bounds the ending to real source audio and retains at least one sample', () => {

		expect( editVoiceoverClip( clip, asset, 'right', 10000 ).lengthSamples ).toBe( 432000 );
		expect( editVoiceoverClip( clip, asset, 'right', - 10000 ).lengthSamples ).toBe( 1 );

	} );

} );

describe( 'Local narration playback', () => {

	it( 'schedules trimmed source offsets against the playhead, mixes gain and stops all voices', async () => {

		const document = studentFixture(); document.narration.clips = [ document.narration.clips[ 0 ] ];
		const voices = [];
		const context = { currentTime: 10, resume: vi.fn(), createBufferSource: () => {

			const source = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }; voices.push( source ); return source;

		}, createGain: () => ( { gain: {}, connect: vi.fn(), disconnect: vi.fn() } ) };
		const audio = new LocalNarration(); audio.context = context; audio.buffers.set( 'voice@1', {} );
		await audio.play( document, 10 );
		expect( voices ).toHaveLength( 1 );
		expect( voices[ 0 ].start.mock.calls[ 0 ][ 0 ] ).toBe( 10 );
		expect( voices[ 0 ].start.mock.calls[ 0 ][ 1 ] ).toBeCloseTo( 100 / 48000 + 5 / 25 );
		audio.stopPlayback(); expect( voices[ 0 ].stop ).toHaveBeenCalledOnce();

	} );
	it( 'does not start late audio after a seek/pause cancels preparation', async () => {

		let resume;
		const document = studentFixture(), audio = new LocalNarration();
		audio.buffers.set( 'voice@1', {} );
		audio.context = { resume: () => new Promise( resolve => {

			resume = resolve;

		} ), createBufferSource: vi.fn() };
		const playing = audio.play( document, 0 ); audio.stopPlayback(); resume(); await playing;
		expect( audio.context.createBufferSource ).not.toHaveBeenCalled();

	} );
	it( 'handles microphone denial without starting a recorder', async () => {

		vi.stubGlobal( 'navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue( new Error( 'Permission denied' ) ) } } );
		vi.stubGlobal( 'MediaRecorder', vi.fn() );
		vi.stubGlobal( 'AudioContext', vi.fn() );
		const audio = new LocalNarration(); audio.context = { resume: vi.fn() };
		await expect( audio.start( 'project' ) ).rejects.toThrow( 'Permission denied' );
		expect( MediaRecorder ).not.toHaveBeenCalled();

	} );

} );
