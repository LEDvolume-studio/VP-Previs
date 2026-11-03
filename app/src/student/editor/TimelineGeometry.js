import { MAX_SEQUENCE_FRAMES, STUDENT_FPS } from '../../previs/domain/StudentProjectSchema.js';

export const MIN_TIMELINE_ZOOM = 25, MAX_TIMELINE_ZOOM = 200;
export const MIN_TIMELINE_HEIGHT = 224;

/** Preserve the timeline coordinate beneath an anchor measured inside the scrollport. */
export function timelineZoomAt( { zoom, nextZoom, scrollLeft, anchor } ) {

	const bounded = Math.max( MIN_TIMELINE_ZOOM, Math.min( MAX_TIMELINE_ZOOM, nextZoom ) );
	return { zoom: bounded, scrollLeft: Math.max( 0, ( scrollLeft + anchor ) * bounded / zoom - anchor ) };

}

export function timelineHeightLimit( workspaceHeight ) {

	return Math.max( MIN_TIMELINE_HEIGHT, Math.min( 640, workspaceHeight - 340 ) );

}

export function timelineSpans( clips ) {

	let startFrame = 0;
	return clips.map( clip => {

		const span = { ...clip, startFrame, endFrame: startFrame + clip.durationFrames };
		startFrame = span.endFrame;
		return span;

	} );

}

export function timelineFrameAt( pixels, pixelsPerSecond, totalFrames ) {

	return Math.max( 0, Math.min( totalFrames, Math.round( pixels / pixelsPerSecond * STUDENT_FPS ) ) );

}

/** Index in the list AFTER removing the dragged placement, matching moveClip. */
export function timelineMoveIndex( clips, clipId, targetFrame ) {

	return timelineSpans( clips ).filter( span => span.clipId !== clipId && ( span.startFrame + span.endFrame ) / 2 < targetFrame ).length;

}

export function timelineTrimDuration( { durationFrames, startFrame, totalFrames, deltaFrames, boundaries = [], snapThresholdFrames = 0 } ) {

	const maximum = MAX_SEQUENCE_FRAMES - totalFrames + durationFrames;
	let end = startFrame + Math.max( 1, Math.min( maximum, Math.round( durationFrames + deltaFrames ) ) );
	const target = end;
	let distance = snapThresholdFrames;
	for ( const boundary of boundaries ) {

		if ( boundary <= startFrame || boundary > startFrame + maximum ) continue;
		const difference = Math.abs( target - boundary );
		if ( difference <= distance ) {

			end = boundary; distance = difference;

		}

	}

	return Math.max( 1, Math.min( maximum, end - startFrame ) );

}

export function timelineTimecode( frame ) {

	return `${String( Math.floor( frame / 1500 ) ).padStart( 2, '0' )}:${String( Math.floor( frame / STUDENT_FPS ) % 60 ).padStart( 2, '0' )}:${String( frame % STUDENT_FPS ).padStart( 2, '0' )}`;

}
