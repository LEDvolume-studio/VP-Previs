// Normalise legacy editor links without dropping a login fragment or unrelated
// parameters. The worker also recognises this exact legacy navigation offline.
const url = new URL( location.href );
if ( url.searchParams.get( 'ui' ) === 'editor' ) {

	url.searchParams.delete( 'ui' );
	history.replaceState( history.state, '', `${url.pathname}${url.search}${url.hash}` );

}

// Register independently of editor startup and never force an update or reload.
if ( import.meta.env.PROD && 'serviceWorker' in navigator ) {

	const register = () => navigator.serviceWorker.register( '/student/sw.js', { scope: '/student/' } ).catch( () => {} );
	if ( document.readyState === 'complete' ) void register();
	else window.addEventListener( 'load', register, { once: true } );

}

import( './editor/main.jsx' );
