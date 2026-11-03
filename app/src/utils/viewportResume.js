/** Recheck after layout settles on tab return, OS wake, browser zoom or monitor changes. */
export function installViewportResumeRecovery( app, win = window, doc = document ) {

	let frame = null;
	let timer = null;
	const refresh = () => {

		if ( doc.visibilityState !== 'hidden' ) app.refreshViewport();

	};

	const schedule = () => {

		if ( doc.visibilityState === 'hidden' ) return;
		if ( frame !== null ) win.cancelAnimationFrame( frame );
		win.clearTimeout( timer );
		frame = win.requestAnimationFrame( () => {

			frame = null;
			refresh();

		} );
		// Resume events can precede the browser's final restored layout.
		timer = win.setTimeout( refresh, 250 );

	};

	for ( const type of [ 'focus', 'pageshow', 'resize' ] ) win.addEventListener( type, schedule );
	doc.addEventListener( 'visibilitychange', schedule );
	return () => {

		for ( const type of [ 'focus', 'pageshow', 'resize' ] ) win.removeEventListener( type, schedule );
		doc.removeEventListener( 'visibilitychange', schedule );
		if ( frame !== null ) win.cancelAnimationFrame( frame );
		win.clearTimeout( timer );

	};

}
