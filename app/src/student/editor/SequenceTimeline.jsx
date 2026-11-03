import VoiceoverTrack from './VoiceoverTrack.jsx';
import { useRef, useState } from 'react';
import { Undo2, Redo2, Scissors, Play, Pause, SkipBack, SkipForward, Square, Plus, Mic, Trash2, ZoomIn, ChevronsLeft } from 'lucide-react';
import { STUDENT_FPS, MAX_SEQUENCE_FRAMES } from '../../previs/domain/StudentProjectSchema.js';
import { timelineSpans, timelineFrameAt, timelineMoveIndex, timelineTrimDuration, timelineTimecode } from './TimelineGeometry.js';
import { useTimelineNavigation } from './useTimelineNavigation.js';

const seconds = frames => `${( frames / STUDENT_FPS ).toFixed( frames % STUDENT_FPS ? 2 : 0 )}s`;
const thumbnailFor = ( thumbnails, shotId ) => thumbnails instanceof Map ? thumbnails.get( shotId ) : thumbnails?.[ shotId ];

/** Gesture previews stay local; only completed reorder/resize gestures become edits. */
export function SequenceTimeline( {
	document, frame = 0, selectedClipId, playing = false, disabled = false, thumbnails,
	recording = '', onRecord, onDiscardRecording, onSeek, onSelectClip, onPlayPause, onStop, onAddShot, onUndo, onRedo, canUndo, canRedo, onCommand,
} ) {

	const navigation = useTimelineNavigation();
	const { zoom, setZoom } = navigation;
	const [ snap, setSnap ] = useState( true );
	const [ dragging, setDragging ] = useState( null );
	const [ trim, setTrim ] = useState( null );
	const contentRef = useRef( null );
	const gesture = useRef( null );
	const clips = document?.clips || [];
	const originalSpans = timelineSpans( clips );
	const totalFrames = originalSpans.at( - 1 )?.endFrame || 0;
	const visibleClips = trim ? clips.map( clip => clip.clipId === trim.clipId ? { ...clip, durationFrames: trim.durationFrames } : clip ) : clips;
	const spans = timelineSpans( visibleClips );
	const pixelsPerSecond = 56 * zoom / 100;
	const pixelsPerFrame = pixelsPerSecond / STUDENT_FPS;
	const displayFrames = Math.max( ...( document?.narration?.clips || [] ).map( clip => Math.max( 0, clip.offsetFrames ) + clip.lengthSamples / document.narration.assets[ `${clip.media.assetId}@${clip.media.version}` ].sampleRate * STUDENT_FPS ), 20 * STUDENT_FPS, spans.at( - 1 )?.endFrame || 0 );
	const width = displayFrames * pixelsPerFrame;
	const boundaries = originalSpans.flatMap( span => [ span.startFrame, span.endFrame ] );
	const canEdit = ! disabled && ! playing;
	const frameAt = event => timelineFrameAt( event.clientX - contentRef.current.getBoundingClientRect().left, pixelsPerSecond, totalFrames );
	const seek = event => {

		if ( ! disabled && totalFrames ) onSeek?.( frameAt( event ) );

	};

	const moveTrim = event => {

		const active = gesture.current;
		if ( ! active || active.pointerId !== event.pointerId ) return;
		const durationFrames = timelineTrimDuration( { ...active, deltaFrames: ( event.clientX - active.startX ) / pixelsPerFrame, boundaries, snapThresholdFrames: snap ? 8 / pixelsPerFrame : 0 } );
		active.nextDuration = durationFrames;
		setTrim( { clipId: active.clipId, durationFrames } );

	};

	const endTrim = ( event, cancelled = false ) => {

		const active = gesture.current;
		if ( ! active || active.pointerId !== event.pointerId ) return;
		gesture.current = null; setTrim( null );
		if ( ! cancelled && canEdit && active.nextDuration !== active.durationFrames ) onCommand?.( { type: 'setClipDuration', clipId: active.clipId, durationFrames: active.nextDuration } );

	};

	const drop = event => {

		event.preventDefault();
		const clipId = dragging;
		setDragging( null );
		if ( ! canEdit || ! clips.some( clip => clip.clipId === clipId ) ) return;
		const index = timelineMoveIndex( clips, clipId, frameAt( event ) );
		if ( index !== clips.findIndex( clip => clip.clipId === clipId ) ) onCommand?.( { type: 'moveClip', clipId, index } );

	};

	const narration = document?.narration?.clips || [];
	return <section className={`st-timeline${navigation.resizing ? ' is-resizing' : ''}`} ref={navigation.panelRef} style={{ height: navigation.height }} aria-label="Sequence timeline">
		<div className="st-timeline-height-handle" {...navigation.resizeProps}/>
		<div className="st-timeline-toolbar">
			<strong>Timeline</strong>
			<div className="st-timeline-tools"><button type="button" aria-label="Undo" title="Undo" disabled={ ! canEdit || ! canUndo } onClick={ onUndo }><Undo2 size={ 16 } /></button><button type="button" aria-label="Redo" title="Redo" disabled={ ! canEdit || ! canRedo } onClick={ onRedo }><Redo2 size={ 16 } /></button><span title="Split needs placement source offsets so advancing LED video stays continuous."><button type="button" disabled aria-label="Split shot"><Scissors size={ 16 } /><span>Split</span></button></span><label className="st-timeline-snap"><input type="checkbox" checked={ snap } onChange={ event => setSnap( event.target.checked ) } /> Snap</label></div>
			<div className="st-timeline-controls"><button type="button" aria-label="Go to sequence start" disabled={ disabled || ! totalFrames } onClick={ () => onSeek?.( 0 ) }><ChevronsLeft size={ 16 } /></button><button type="button" aria-label="Previous frame" disabled={ disabled || ! totalFrames || playing } onClick={ () => onSeek?.( Math.max( 0, frame - 1 ) ) }><SkipBack size={ 16 } /></button><button type="button" className="st-timeline-play" aria-keyshortcuts="Space" title="Play / pause (Space)" aria-label={ playing ? 'Pause sequence' : 'Play sequence' } disabled={ disabled || ! totalFrames } onClick={ onPlayPause }>{playing ? <Pause size={ 17 } /> : <Play size={ 17 } />}</button><button type="button" aria-label="Next frame" disabled={ disabled || ! totalFrames || playing } onClick={ () => onSeek?.( Math.min( totalFrames, frame + 1 ) ) }><SkipForward size={ 16 } /></button><button type="button" aria-label="Stop and return to editing" disabled={ disabled || ! totalFrames } onClick={ onStop }><Square size={ 14 } /></button><output aria-label="Timeline timecode">{timelineTimecode( frame )} <span>/ {timelineTimecode( totalFrames )}</span></output></div>
			<button type="button" className="st-timeline-add" disabled={ ! canEdit } onClick={ onAddShot }><Plus size={ 16 } /> Add shot</button>
		</div>
		<div className="st-timeline-scroll" ref={navigation.scrollRef} title="Pinch to zoom at the pointer · scroll horizontally to pan">
			<div className="st-timeline-content" ref={ contentRef } style={ { width, minWidth: navigation.minimumContentWidth } } onDragOver={ event => {

				if ( canEdit ) event.preventDefault();

			} } onDrop={ drop }>
				<div className="st-timeline-ruler" role="slider" tabIndex={ disabled ? - 1 : 0 } aria-label="Timeline playhead" aria-valuemin={ 0 } aria-valuemax={ totalFrames } aria-valuenow={ frame } onPointerDown={ event => {

					if ( event.button !== 0 || disabled ) return; event.currentTarget.setPointerCapture( event.pointerId ); seek( event );

				} } onPointerMove={ event => {

					if ( event.currentTarget.hasPointerCapture( event.pointerId ) ) seek( event );

				} } onKeyDown={ event => {

					const next = { ArrowLeft: frame - 1, ArrowRight: frame + 1, Home: 0, End: totalFrames }[ event.key ]; if ( next !== undefined && ! disabled ) {

						event.preventDefault(); onSeek?.( Math.max( 0, Math.min( totalFrames, next ) ) );

					}

				} }>
					{Array.from( { length: Math.ceil( displayFrames / STUDENT_FPS ) + 1 }, ( _, second ) => <span className={ `st-timeline-tick${second % 5 === 0 ? ' is-major' : ''}` } key={ second } style={ { left: second * pixelsPerSecond } }>{second % 5 === 0 ? `${second}s` : ''}</span> )}
				</div>
				<div className="st-timeline-track" aria-label="Shot placements">
					{spans.map( ( span, index ) => <div className={ `st-timeline-clip${selectedClipId === span.clipId ? ' is-selected' : ''}${dragging === span.clipId ? ' is-dragging' : ''}` } key={ span.clipId } style={ { left: span.startFrame * pixelsPerFrame, width: span.durationFrames * pixelsPerFrame } } draggable={ canEdit && ! trim } onDragStart={ event => {

						if ( ! canEdit || trim ) {

							event.preventDefault(); return;

						}

						setDragging( span.clipId ); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData( 'text/plain', span.clipId );

					} } onDragEnd={ () => setDragging( null ) }>
						<button type="button" className="st-timeline-clip-select" disabled={ disabled } aria-pressed={ selectedClipId === span.clipId } title={ `${document.shots[ span.shotId ].name} · ${seconds( span.durationFrames )}. Drag to reorder. Placements of the same setup share edits.` } onClick={ () => onSelectClip?.( span.clipId ) }>{thumbnailFor( thumbnails, span.shotId ) ? <img src={ thumbnailFor( thumbnails, span.shotId ) } alt="" draggable="false" /> : <span className="st-timeline-thumbnail-placeholder">{String( index + 1 ).padStart( 2, '0' )}</span>}<span className="st-timeline-clip-label"><strong>{document.shots[ span.shotId ].name}</strong><small>{seconds( span.durationFrames )}</small></span></button>
						<button type="button" className="st-shot-delete" aria-label={`Delete shot placement ${index + 1}`} disabled={! canEdit} onClick={() => onCommand?.( { type: 'removeClip', clipId: span.clipId } )}><Trash2 size={12}/></button>
						<div className="st-timeline-resize" role="slider" tabIndex={ canEdit ? 0 : - 1 } aria-label={ `Duration of ${document.shots[ span.shotId ].name}, placement ${index + 1}` } aria-valuemin={ 1 } aria-valuemax={ MAX_SEQUENCE_FRAMES - totalFrames + span.durationFrames } aria-valuenow={ span.durationFrames } aria-valuetext={ `${span.durationFrames} frames` } aria-disabled={ ! canEdit } title="Drag to change duration" onPointerDown={ event => {

							if ( ! canEdit || event.button !== 0 ) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture( event.pointerId ); gesture.current = { clipId: span.clipId, durationFrames: span.durationFrames, nextDuration: span.durationFrames, startFrame: span.startFrame, totalFrames, startX: event.clientX, pointerId: event.pointerId };

						} } onPointerMove={ moveTrim } onPointerUp={ event => endTrim( event ) } onPointerCancel={ event => endTrim( event, true ) } onLostPointerCapture={ event => endTrim( event, true ) } onKeyDown={ event => {

							if ( ! canEdit || ! [ 'ArrowLeft', 'ArrowRight' ].includes( event.key ) ) return; event.preventDefault(); const durationFrames = timelineTrimDuration( { durationFrames: span.durationFrames, startFrame: span.startFrame, totalFrames, deltaFrames: event.key === 'ArrowLeft' ? - 1 : 1 } ); if ( durationFrames !== span.durationFrames ) onCommand?.( { type: 'setClipDuration', clipId: span.clipId, durationFrames } );

						} } />
					</div> )}
					{! clips.length && <div className="st-timeline-empty">Add a setup to begin your sequence.</div>}
				</div>
				<VoiceoverTrack document={document} spans={originalSpans} pixelsPerFrame={pixelsPerFrame} canEdit={canEdit} onCommand={onCommand}/>
				<div className="st-timeline-playhead" style={ { left: Math.min( frame, totalFrames ) * pixelsPerFrame } } aria-hidden="true"><span /></div>
			</div>
		</div>
		<div className="st-timeline-footer"><span><button type="button" className={recording ? 'is-recording' : ''} disabled={recording === 'requesting' || recording === 'saving' || ! recording && ( disabled || playing )} onClick={onRecord}><Mic size={14}/>{recording === 'requesting' ? 'Allow microphone…' : recording === 'saving' ? 'Saving voiceover…' : recording === 'save-error' ? 'Retry voiceover save' : recording ? 'Stop recording & save' : 'Record voiceover'}</button>{recording === 'save-error' && <button type="button" onClick={onDiscardRecording}>Discard take</button>}</span><span>{clips.length} placements · {seconds( totalFrames )} / 15 min{narration.some( clip => clip.anchor.type === 'clip' && ! originalSpans.some( span => span.clipId === clip.anchor.clipId ) ) ? ' · orphaned narration retained' : ''}</span><label className="st-timeline-zoom"><ZoomIn size={ 14 } /><span>Zoom</span><input aria-label="Timeline zoom" type="range" min={navigation.minZoom} max={navigation.maxZoom} step="any" value={ zoom } onChange={ event => setZoom( Number( event.target.value ) ) } /><output>{Math.round( zoom )}%</output></label></div>
	</section>;

}

export default SequenceTimeline;
