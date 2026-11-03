import { editVoiceoverClip } from './VoiceoverGeometry.js';
import { useRef, useState } from 'react';
import { Mic, Trash2 } from 'lucide-react';


export default function VoiceoverTrack( { document, spans, pixelsPerFrame, canEdit, onCommand } ) {

	const [ preview, setPreview ] = useState( null );
	const gesture = useRef( null );
	const clips = document.narration.clips;
	const finish = ( event, cancel = false ) => {

		const active = gesture.current;
		if ( ! active || active.pointerId !== event.pointerId ) return;
		gesture.current = null; setPreview( null );
		if ( ! cancel && canEdit && JSON.stringify( active.next ) !== JSON.stringify( active.clip ) ) onCommand( { type: 'replaceNarrationClip', clip: active.next } );

	};

	return <div className="st-timeline-voiceover" aria-label="Independent voiceover track">{clips.map( ( original, index ) => {

		const anchor = original.anchor.type === 'clip' ? spans.find( span => span.clipId === original.anchor.clipId ) : null;
		if ( original.anchor.type === 'clip' && ! anchor ) return null;
		const clip = preview?.narrationClipId === original.narrationClipId ? preview : original;
		const asset = document.narration.assets[ `${clip.media.assetId}@${clip.media.version}` ];
		const begin = ( event, kind ) => {

			if ( ! canEdit || event.button !== 0 || event.target.closest( 'button' ) ) return;
			event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture( event.pointerId );
			gesture.current = { pointerId: event.pointerId, x: event.clientX, clip: original, next: original, kind };

		};

		const key = ( event, kind ) => {

			if ( ! canEdit ) return;
			if ( [ 'Delete', 'Backspace' ].includes( event.key ) ) {

				event.preventDefault(); onCommand( { type: 'removeNarrationClip', narrationClipId: clip.narrationClipId } );

			}

			if ( [ 'ArrowLeft', 'ArrowRight' ].includes( event.key ) ) {

				event.preventDefault(); event.stopPropagation(); onCommand( { type: 'replaceNarrationClip', clip: editVoiceoverClip( original, asset, kind, ( event.key === 'ArrowLeft' ? - 1 : 1 ) * ( event.shiftKey ? 25 : 1 ), anchor?.startFrame || 0 ) } );

			}

		};

		return <div key={clip.narrationClipId} className="st-timeline-audio-clip" role="group" tabIndex={canEdit ? 0 : - 1} aria-label={`Voiceover ${index + 1}`} title="Drag to move · drag either edge to trim · Delete to remove" style={{ left: ( clip.offsetFrames + ( anchor?.startFrame || 0 ) ) * pixelsPerFrame, width: Math.max( 20, clip.lengthSamples / asset.sampleRate * 25 * pixelsPerFrame ), opacity: clip.muted ? 0.45 : 1 }} onPointerDown={event => begin( event, 'move' )} onPointerMove={event => {

			const active = gesture.current; if ( ! active || active.pointerId !== event.pointerId ) return;
			active.next = editVoiceoverClip( original, asset, active.kind, ( event.clientX - active.x ) / pixelsPerFrame, anchor?.startFrame || 0 ); setPreview( active.next );

		}} onPointerUp={event => finish( event )} onPointerCancel={event => finish( event, true )} onLostPointerCapture={event => finish( event, true )} onKeyDown={event => key( event, 'move' )}>
			<span className="st-audio-trim left" role="slider" tabIndex={canEdit ? 0 : - 1} aria-label={`Trim start of voiceover ${index + 1}`} aria-valuemin={0} aria-valuemax={asset.durationSamples} aria-valuenow={clip.sourceStartSample} onPointerDown={event => begin( event, 'left' )} onKeyDown={event => {

				event.stopPropagation(); key( event, 'left' );

			}}/>
			<Mic size={12}/><span>Voiceover {index + 1}</span><button type="button" aria-label={`Delete voiceover ${index + 1}`} disabled={! canEdit} onClick={() => onCommand( { type: 'removeNarrationClip', narrationClipId: clip.narrationClipId } )}><Trash2 size={12}/></button>
			<span className="st-audio-trim right" role="slider" tabIndex={canEdit ? 0 : - 1} aria-label={`Trim end of voiceover ${index + 1}`} aria-valuemin={1} aria-valuemax={asset.durationSamples - clip.sourceStartSample} aria-valuenow={clip.lengthSamples} onPointerDown={event => begin( event, 'right' )} onKeyDown={event => {

				event.stopPropagation(); key( event, 'right' );

			}}/>
		</div>;

	} )}{! clips.length && <span className="st-timeline-voiceover-empty">Record a voiceover at the playhead · saved on this browser</span>}</div>;

}
