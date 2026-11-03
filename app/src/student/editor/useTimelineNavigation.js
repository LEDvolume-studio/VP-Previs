import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MAX_TIMELINE_ZOOM, MIN_TIMELINE_ZOOM, MIN_TIMELINE_HEIGHT, timelineHeightLimit, timelineZoomAt } from './TimelineGeometry.js';

const defaultHeight = () => window.innerHeight <= 800 ? 225 : 254;

/** Local workspace geometry; navigation never changes project content/history. */
export function useTimelineNavigation() {

	const panelRef = useRef( null ), scrollRef = useRef( null );
	const [ view, setView ] = useState( { zoom: 100, scrollLeft: 0 } );
	const [ height, setHeight ] = useState( defaultHeight );
	const [ maxHeight, setMaxHeight ] = useState( () => timelineHeightLimit( window.innerHeight ) );
	const [ resizing, setResizing ] = useState( false );
	const heightGesture = useRef( null ), currentZoom = useRef( 100 );
	const zoomAt = ( nextZoom, anchor ) => {

		const scroll = scrollRef.current;
		if ( ! scroll ) return;
		const next = timelineZoomAt( { zoom: currentZoom.current, nextZoom, scrollLeft: scroll.scrollLeft, anchor } );
		if ( next.zoom === currentZoom.current ) return;
		currentZoom.current = next.zoom; setView( next );

	};

	useLayoutEffect( () => {

		if ( scrollRef.current ) scrollRef.current.scrollLeft = view.scrollLeft;

	}, [ view ] );
	useEffect( () => {

		const panel = panelRef.current, scroll = scrollRef.current;
		let animation, factor = 1, anchor = 0;
		const wheel = event => {

			// Chromium delivers trackpad pinch as a cancellable Ctrl+wheel event.
			// A non-passive native listener prevents page zoom without eating pans.
			if ( ! event.ctrlKey ) return;
			event.preventDefault(); event.stopPropagation();
			const bounds = scroll.getBoundingClientRect();
			anchor = Math.max( 0, Math.min( scroll.clientWidth, event.clientX - bounds.left - scroll.clientLeft ) );
			const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1;
			factor *= Math.exp( - event.deltaY * units * 0.01 );
			if ( animation ) return;
			animation = requestAnimationFrame( () => {

				animation = null;
				zoomAt( currentZoom.current * factor, anchor ); factor = 1;

			} );

		};

		const observer = new ResizeObserver( () => {

			const maximum = timelineHeightLimit( panel.parentElement.clientHeight );
			setMaxHeight( maximum ); setHeight( value => Math.max( MIN_TIMELINE_HEIGHT, Math.min( maximum, value ) ) );

		} );
		panel.addEventListener( 'wheel', wheel, { passive: false } );
		observer.observe( panel.parentElement );
		return () => {

			panel.removeEventListener( 'wheel', wheel ); cancelAnimationFrame( animation ); observer.disconnect();

		};

	}, [] );

	const clampHeight = value => Math.max( MIN_TIMELINE_HEIGHT, Math.min( maxHeight, value ) );
	const endHeight = ( event, cancelled = false ) => {

		const active = heightGesture.current;
		if ( ! active || active.pointerId !== event.pointerId ) return;
		heightGesture.current = null; setResizing( false );
		if ( cancelled ) setHeight( clampHeight( active.height ) );
		if ( event.currentTarget.hasPointerCapture( event.pointerId ) ) event.currentTarget.releasePointerCapture( event.pointerId );

	};

	return {
		panelRef, scrollRef, zoom: view.zoom, height, resizing,
		// Extra trailing room lets the anchor stay fixed even for a short sequence.
		minimumContentWidth: `calc(100% + ${view.scrollLeft}px)`,
		setZoom: value => zoomAt( value, scrollRef.current.clientWidth / 2 ),
		minZoom: MIN_TIMELINE_ZOOM, maxZoom: MAX_TIMELINE_ZOOM,
		resizeProps: {
			role: 'separator', tabIndex: 0, 'aria-label': 'Timeline height', 'aria-orientation': 'horizontal',
			'aria-valuemin': MIN_TIMELINE_HEIGHT, 'aria-valuemax': maxHeight, 'aria-valuenow': Math.round( height ),
			title: 'Drag to resize timeline. Double-click to reset. Arrow keys adjust height.',
			onPointerDown: event => {

				if ( event.button !== 0 ) return;
				event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture( event.pointerId );
				heightGesture.current = { height, y: event.clientY, pointerId: event.pointerId }; setResizing( true );

			},
			onPointerMove: event => {

				const active = heightGesture.current;
				if ( active?.pointerId === event.pointerId ) setHeight( clampHeight( active.height + active.y - event.clientY ) );

			},
			onPointerUp: event => endHeight( event ), onPointerCancel: event => endHeight( event, true ), onLostPointerCapture: event => endHeight( event, true ),
			onDoubleClick: () => setHeight( clampHeight( defaultHeight() ) ),
			onKeyDown: event => {

				const step = event.shiftKey ? 50 : 10;
				const next = { ArrowUp: height + step, ArrowDown: height - step, Home: MIN_TIMELINE_HEIGHT, End: maxHeight }[ event.key ];
				if ( next !== undefined ) {

					event.preventDefault(); setHeight( clampHeight( next ) );

				}

			},
		},
	};

}
