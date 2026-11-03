import { useEffect, useRef, useState } from 'react';
import { rulerPointFromClient, constrainRulerPoint, rulerLength, rulerScreenPoint } from '@/utils/editorRuler';

const EMPTY_RULERS = { top: [], front: [], side: [] };
const formatLength = length => length < 0.1 ? `${length.toFixed( 3 )} m` : `${length.toFixed( 2 )} m`;

function RulerLine( { camera, ruler, width, height, pending = false } ) {

	const start = rulerScreenPoint( camera, ruler.start, width, height );
	const end = rulerScreenPoint( camera, ruler.end, width, height );
	const midpoint = { x: ( start.x + end.x ) / 2, y: ( start.y + end.y ) / 2 };
	const label = formatLength( rulerLength( ruler.start, ruler.end ) );
	const labelWidth = label.length * 7 + 12;
	return (
		<g opacity={pending ? 0.8 : 1}>
			<line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#121820" strokeWidth="5" />
			<line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#fcd34d" strokeWidth="2" strokeDasharray={pending ? '5 4' : undefined} />
			{[ start, end ].map( ( point, index ) => <circle key={index} cx={point.x} cy={point.y} r="4" fill="#fcd34d" stroke="#121820" strokeWidth="2" /> )}
			<rect x={midpoint.x - labelWidth / 2} y={midpoint.y - 24} width={labelWidth} height="18" rx="4" fill="#121820" fillOpacity="0.9" />
			<text x={midpoint.x} y={midpoint.y - 11} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="600">{label}</text>
		</g>
	);

}

export default function EditorRulerOverlay( { app, canvas, mode, enabled, onTemporaryChange, clearSignal } ) {

	const [ rulers, setRulers ] = useState( EMPTY_RULERS );
	const [ draft, setDraft ] = useState( null );
	const [ ctrlHeld, setCtrlHeld ] = useState( false );
	const [ middleHeld, setMiddleHeld ] = useState( false );
	const [ viewportSize, setViewportSize ] = useState( { width: 1, height: 1 } );
	const [ , setCameraRevision ] = useState( 0 );
	const draftRef = useRef( null );
	const suppressClickRef = useRef( false );
	const active = mode !== 'perspective';
	const currentRulers = rulers[ mode ] || [];

	useEffect( () => {

		onTemporaryChange?.( ctrlHeld || middleHeld );

	}, [ ctrlHeld, middleHeld, onTemporaryChange ] );

	useEffect( () => {

		setDraft( null );
		draftRef.current = null;
		setMiddleHeld( false );

	}, [ mode ] );

	useEffect( () => {

		setRulers( EMPTY_RULERS );
		setDraft( null );
		draftRef.current = null;

	}, [ clearSignal ] );

	useEffect( () => {

		const onKeyDown = event => {

			if ( event.key === 'Control' && ! event.target?.matches?.( 'input, textarea, [contenteditable="true"]' ) ) setCtrlHeld( true );

		};

		const onKeyUp = event => {

			if ( event.key === 'Control' ) setCtrlHeld( false );

		};

		const onBlur = () => setCtrlHeld( false );
		window.addEventListener( 'keydown', onKeyDown );
		window.addEventListener( 'keyup', onKeyUp );
		window.addEventListener( 'blur', onBlur );
		return () => {

			window.removeEventListener( 'keydown', onKeyDown );
			window.removeEventListener( 'keyup', onKeyUp );
			window.removeEventListener( 'blur', onBlur );

		};

	}, [] );

	useEffect( () => {

		if ( ! canvas ) return;
		const resize = () => setViewportSize( { width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 } );
		resize();
		const observer = new ResizeObserver( resize );
		observer.observe( canvas );
		const cameraChanged = () => setCameraRevision( revision => revision + 1 );
		app?.addEventListener?.( 'editorViewChanged', cameraChanged );
		return () => {

			observer.disconnect();
			app?.removeEventListener?.( 'editorViewChanged', cameraChanged );

		};

	}, [ app, canvas ] );

	useEffect( () => {

		if ( ! canvas || ! app ) return;
		const manager = app.editorViewManager;
		const pointAt = event => rulerPointFromClient(
			manager?.camera, manager?.activeControls?.target, mode,
			canvas.getBoundingClientRect(), event.clientX, event.clientY
		);
		const consume = event => {

			event.preventDefault();
			event.stopImmediatePropagation();

		};

		const pointerDown = event => {

			if ( ! active || ! ( event.button === 1 || ( event.button === 0 && ( enabled || ctrlHeld || event.ctrlKey ) ) ) ) {

				suppressClickRef.current = false;
				return;

			}

			const start = pointAt( event );
			if ( ! start ) return;
			consume( event );
			canvas.setPointerCapture( event.pointerId );
			const next = { pointerId: event.pointerId, mode, start, end: start };
			draftRef.current = next;
			setDraft( next );
			if ( event.button === 1 ) setMiddleHeld( true );
			suppressClickRef.current = event.button === 0;

		};

		const pointerMove = event => {

			const current = draftRef.current;
			if ( ! current || current.pointerId !== event.pointerId ) return;
			consume( event );
			const end = pointAt( event );
			if ( ! end ) return;
			const next = { ...current, end: constrainRulerPoint( current.start, end, current.mode, event.shiftKey ) };
			draftRef.current = next;
			setDraft( next );

		};

		const finish = event => {

			const current = draftRef.current;
			if ( ! current || current.pointerId !== event.pointerId ) return;
			consume( event );
			const end = pointAt( event );
			const final = end ? { ...current, end: constrainRulerPoint( current.start, end, current.mode, event.shiftKey ) } : current;
			if ( event.type === 'pointerup' && rulerLength( final.start, final.end ) > 1e-6 ) {

				setRulers( previous => ( { ...previous, [ current.mode ]: [ ...previous[ current.mode ], final ] } ) );

			}

			draftRef.current = null;
			setDraft( null );
			setMiddleHeld( false );
			if ( canvas.hasPointerCapture?.( event.pointerId ) ) canvas.releasePointerCapture( event.pointerId );

		};

		const suppressClick = event => {

			if ( ! suppressClickRef.current ) return;
			suppressClickRef.current = false;
			consume( event );

		};

		const suppressDoubleClick = event => {

			if ( active && ( enabled || ctrlHeld || event.ctrlKey ) ) consume( event );

		};

		const suppressAux = event => {

			if ( event.button === 1 && active ) consume( event );

		};

		canvas.addEventListener( 'pointerdown', pointerDown, true );
		canvas.addEventListener( 'pointermove', pointerMove, true );
		canvas.addEventListener( 'pointerup', finish, true );
		canvas.addEventListener( 'pointercancel', finish, true );
		canvas.addEventListener( 'click', suppressClick, true );
		canvas.addEventListener( 'dblclick', suppressDoubleClick, true );
		canvas.addEventListener( 'auxclick', suppressAux, true );
		return () => {

			canvas.removeEventListener( 'pointerdown', pointerDown, true );
			canvas.removeEventListener( 'pointermove', pointerMove, true );
			canvas.removeEventListener( 'pointerup', finish, true );
			canvas.removeEventListener( 'pointercancel', finish, true );
			canvas.removeEventListener( 'click', suppressClick, true );
			canvas.removeEventListener( 'dblclick', suppressDoubleClick, true );
			canvas.removeEventListener( 'auxclick', suppressAux, true );

		};

	}, [ app, canvas, active, enabled, ctrlHeld, mode ] );

	if ( ! active ) return null;
	const camera = app?.editorViewManager?.camera;
	if ( ! camera ) return null;
	return (
		<svg className="pointer-events-none absolute inset-0 z-20 h-full w-full" width={viewportSize.width} height={viewportSize.height} aria-label="Ruler measurements">
			{currentRulers.map( ( ruler, index ) => <RulerLine key={index} camera={camera} ruler={ruler} width={viewportSize.width} height={viewportSize.height} /> )}
			{draft && draft.mode === mode && <RulerLine camera={camera} ruler={draft} width={viewportSize.width} height={viewportSize.height} pending />}
		</svg>
	);

}
