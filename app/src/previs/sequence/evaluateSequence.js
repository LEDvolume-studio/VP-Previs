import { assetVersionKey, cloneStudentContent, STUDENT_FPS, validateStudentProjectDocument } from '../domain/StudentProjectSchema.js';

const freeze = value => {

	if ( value && typeof value === 'object' && ! Object.isFrozen( value ) ) {

		Object.values( value ).forEach( freeze );
		Object.freeze( value );

	}

	return value;

};

/**
 * Validate and prepare once per document revision, then evaluate cheaply for
 * preview/export. Captures immutable content so later authoring cannot change
 * an export in progress. No engine, clock, media element or store dependency.
 */
export function createSequenceEvaluator( input ) {

	validateStudentProjectDocument( input );
	const document = freeze( cloneStudentContent( input ) );
	let totalFrames = 0;
	const spans = document.clips.map( clip => {

		const span = { ...clip, startFrame: totalFrames, endFrame: totalFrames + clip.durationFrames };
		totalFrames = span.endFrame;
		return freeze( span );

	} );
	const byId = new Map( spans.map( span => [ span.clipId, span ] ) );

	function evaluate( frame, { timelineFrame } = {} ) {

		if ( ! Number.isSafeInteger( frame ) || frame < 0 || frame > totalFrames ) throw new RangeError( `Sequence frame must be an integer from 0 to ${totalFrames}.` );
		if ( timelineFrame !== undefined && ( ! Number.isSafeInteger( timelineFrame ) || timelineFrame < 0 ) ) throw new RangeError( 'Timeline frame must be a nonnegative integer.' );
		// The endpoint is a transport state, never an extra renderable frame.
		if ( frame === totalFrames ) return freeze( { frame, totalFrames, ended: true, activeClip: null, shot: null, localFrame: null, led: [], narration: [] } );
		const activeClip = spans.find( span => frame >= span.startFrame && frame < span.endFrame );
		const shot = document.shots[ activeClip.shotId ];
		const localFrame = frame - activeClip.startFrame;
		const led = shot.snapshot.ledWalls.filter( wall => wall.media !== null ).map( wall => {

			const media = document.assets[ assetVersionKey( wall.media ) ];
			if ( timelineFrame !== undefined ) {

				// The student timeline owns the drive clock across camera cuts. An
				// admin's paused preview/in-point/rate must not freeze or offset it.
				const sourceFrames = Math.max( 1, Math.ceil( media.durationUs * STUDENT_FPS / 1000000 ) );
				const sourceFrame = wall.loop ? timelineFrame % sourceFrames : Math.min( timelineFrame, sourceFrames - 1 );
				const sourceTimeUs = Math.round( sourceFrame * 1000000 / STUDENT_FPS );
				return { wallId: wall.wallId, media: wall.media, mode: 'play', sourceTimeUs, sourceTimeSeconds: sourceTimeUs / 1000000, ended: ! wall.loop && timelineFrame >= sourceFrames };

			}

			const rawUs = wall.inPointUs + ( wall.mode === 'play' ? Math.round( localFrame * 1000000 / STUDENT_FPS * wall.playbackRate ) : 0 );
			// Loop across the complete source, including its beginning after wrap.
			// Nonloop playback holds at the last microsecond inside [0,duration).
			const sourceTimeUs = wall.loop && wall.mode === 'play' ? rawUs % media.durationUs : Math.min( rawUs, media.durationUs - 1 );
			return { wallId: wall.wallId, media: wall.media, mode: wall.mode, sourceTimeUs, sourceTimeSeconds: sourceTimeUs / 1000000, ended: wall.mode === 'play' && ! wall.loop && rawUs >= media.durationUs };

		} );
		const narration = [];
		for ( const clip of document.narration.clips ) {

			if ( clip.muted || clip.gain === 0 ) continue;
			const anchor = clip.anchor.type === 'clip' ? byId.get( clip.anchor.clipId ) : null;
			if ( clip.anchor.type === 'clip' && ( ! anchor || frame < anchor.startFrame || frame >= anchor.endFrame ) ) continue;
			const startFrame = ( anchor?.startFrame || 0 ) + clip.offsetFrames;
			const elapsedFrames = frame - startFrame;
			if ( elapsedFrames < 0 ) continue;
			const media = document.narration.assets[ assetVersionKey( clip.media ) ];
			// Floor only at this explicit frame-to-sample boundary. Sample trims
			// remain integers in the portable content and audio mixer contracts.
			const elapsedSamples = Math.floor( elapsedFrames * media.sampleRate / STUDENT_FPS );
			if ( elapsedSamples >= clip.lengthSamples ) continue;
			// A mixer may schedule this entire remaining span in one operation.
			// Bound it to the placement and sequence, not just the source trim.
			const endFrame = anchor?.endFrame ?? totalFrames;
			const endSample = Math.floor( ( endFrame - startFrame ) * media.sampleRate / STUDENT_FPS );
			const remainingSamples = Math.min( clip.lengthSamples, endSample ) - elapsedSamples;
			narration.push( { narrationClipId: clip.narrationClipId, media: clip.media, sourceSample: clip.sourceStartSample + elapsedSamples, sourceTimeSeconds: ( clip.sourceStartSample + elapsedSamples ) / media.sampleRate, remainingSamples, gain: clip.gain, anchor: clip.anchor } );

		}

		return freeze( { frame, totalFrames, ended: false, activeClip, shot, localFrame, led, narration } );

	}

	return Object.freeze( { totalFrames, spans: freeze( spans ), evaluate } );

}

/** Convenience for occasional seeks. Reuse createSequenceEvaluator for playback. */
export function evaluateSequence( document, frame ) {

	return createSequenceEvaluator( document ).evaluate( frame );

}
