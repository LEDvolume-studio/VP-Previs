import { expect, it } from 'vitest';
import { timelineSpans, timelineFrameAt, timelineMoveIndex, timelineTrimDuration, timelineTimecode, timelineZoomAt, timelineHeightLimit } from '../../../app/src/student/editor/TimelineGeometry.js';

const clips = [ { clipId: 'A', durationFrames: 50 }, { clipId: 'B', durationFrames: 100 }, { clipId: 'C', durationFrames: 25 } ];

it( 'keeps the time under a pointer fixed through zooming in and back out on a scrolled timeline', () => {

	const initial = { zoom: 75, scrollLeft: 420, anchor: 137 };
	const enlarged = timelineZoomAt( { ...initial, nextZoom: 180 } );
	expect( ( enlarged.scrollLeft + initial.anchor ) / enlarged.zoom ).toBeCloseTo( ( initial.scrollLeft + initial.anchor ) / initial.zoom );
	expect( timelineZoomAt( { ...enlarged, anchor: initial.anchor, nextZoom: initial.zoom } ).scrollLeft ).toBeCloseTo( initial.scrollLeft );

} );

it( 'anchors using the actual bounded zoom and stops zoom-out at the timeline origin', () => {

	expect( timelineZoomAt( { zoom: 100, nextZoom: 1000, scrollLeft: 100, anchor: 250 } ) ).toEqual( { zoom: 200, scrollLeft: 450 } );
	expect( timelineZoomAt( { zoom: 100, nextZoom: 1, scrollLeft: 0, anchor: 250 } ) ).toEqual( { zoom: 25, scrollLeft: 0 } );
	expect( timelineHeightLimit( 992 ) ).toBe( 640 );
	expect( timelineHeightLimit( 650 ) ).toBe( 310 );

} );

it( 'builds exact consecutive placement spans without changing content', () => {

	expect( timelineSpans( clips ).map( ( { startFrame, endFrame } ) => [ startFrame, endFrame ] ) ).toEqual( [[ 0, 50 ], [ 50, 150 ], [ 150, 175 ]] );
	expect( clips[ 0 ] ).not.toHaveProperty( 'startFrame' );
	expect( timelineSpans( [] ) ).toEqual( [] );

} );

it( 'converts pixel positions to nearest integer frames and clamps timeline endpoints', () => {

	expect( timelineFrameAt( 21, 100, 175 ) ).toBe( 5 );
	expect( timelineFrameAt( - 5, 100, 175 ) ).toBe( 0 );
	expect( timelineFrameAt( 1000, 100, 175 ) ).toBe( 175 );

} );

it( 'calculates insertion index after removing the dragged placement in either direction', () => {

	expect( timelineMoveIndex( clips, 'A', 175 ) ).toBe( 2 );
	expect( timelineMoveIndex( clips, 'C', 0 ) ).toBe( 0 );
	expect( timelineMoveIndex( clips, 'B', 100 ) ).toBe( 1 );
	expect( timelineMoveIndex( clips, 'A', 130 ) ).toBe( 1 );

} );

it( 'resizes by integer frames with minimum one frame and hard total-duration limit', () => {

	const base = { durationFrames: 50, startFrame: 0, totalFrames: 22490 };
	expect( timelineTrimDuration( { ...base, deltaFrames: - 100 } ) ).toBe( 1 );
	expect( timelineTrimDuration( { ...base, deltaFrames: 100 } ) ).toBe( 60 );
	expect( timelineTrimDuration( { ...base, deltaFrames: 1.7 } ) ).toBe( 52 );

} );

it( 'snaps to the nearest reachable boundary while excluding zero duration and overlong targets', () => {

	const base = { durationFrames: 50, startFrame: 50, totalFrames: 22490, deltaFrames: 7, boundaries: [ 50, 100, 106, 109, 120 ], snapThresholdFrames: 3 };
	expect( timelineTrimDuration( base ) ).toBe( 56 );
	expect( timelineTrimDuration( { ...base, snapThresholdFrames: 0 } ) ).toBe( 57 );
	expect( timelineTrimDuration( { ...base, deltaFrames: 100 } ) ).toBe( 59 );

} );

it( 'formats frame-accurate timecode at second, minute and fifteen-minute boundaries', () => {

	expect( timelineTimecode( 24 ) ).toBe( '00:00:24' );
	expect( timelineTimecode( 1500 ) ).toBe( '01:00:00' );
	expect( timelineTimecode( 22500 ) ).toBe( '15:00:00' );

} );
