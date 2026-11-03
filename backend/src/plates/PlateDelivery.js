import { PLATE_SLOTS, validatePlateManifest } from '../../../app/src/services/plates/PlateSet.js';

const encoder = new TextEncoder();
const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
const json = ( body, status = 200, extra = {} ) => new Response( JSON.stringify( body ), { status, headers: { ...baseHeaders, 'Content-Type': 'application/json', ...extra } } );
const encode = bytes => btoa( String.fromCharCode( ...new Uint8Array( bytes ) ) ).replaceAll( '+', '-' ).replaceAll( '/', '_' ).replace( /=+$/, '' );
const decode = text => Uint8Array.from( atob( text.replaceAll( '-', '+' ).replaceAll( '_', '/' ) ), value => value.charCodeAt( 0 ) );

export function plateRange( raw, size ) {

	const match = /^bytes=(\d+)-(\d*)$/.exec( raw || '' );
	if ( ! match ) return null;
	const start = Number( match[ 1 ] ), end = match[ 2 ] ? Math.min( Number( match[ 2 ] ), size - 1 ) : size - 1;
	return Number.isSafeInteger( start ) && Number.isSafeInteger( end ) && start >= 0 && start < size && end >= start ? { start, end } : null;

}

/** Storage adapter supplies bounded JSON reads and streamed range reads. No R2 URLs escape. */
export async function handlePlateDelivery( request, { secret, readJSON, readObject, development = false } ) {

	const url = new URL( request.url );
	if ( ! url.pathname.startsWith( '/v1/plates' ) ) return null;
	if ( ! /^[a-f0-9]{64}$/i.test( secret || '' ) ) return json( { error: 'Plate delivery is not configured.' }, 503 );
	if ( ! development && url.protocol !== 'https:' ) return json( { error: 'HTTPS required.' }, 403 );
	if ( request.headers.get( 'Sec-Fetch-Site' ) && request.headers.get( 'Sec-Fetch-Site' ) !== 'same-origin' ) return json( { error: 'Open the plate library in the app.' }, 403 );
	const cookieName = development ? 'rayzee-plates-local' : '__Host-rayzee-plates';
	const key = await crypto.subtle.importKey( 'raw', Uint8Array.from( secret.match( /../g ), value => parseInt( value, 16 ) ), { name: 'HMAC', hash: 'SHA-256' }, false, [ 'sign', 'verify' ] );
	if ( url.pathname === '/v1/plates/session' && request.method === 'POST' ) {

		if ( request.headers.get( 'Origin' ) !== url.origin ) return json( { error: 'Open the plate library in the app.' }, 403 );
		const expiresAt = Date.now() + 3600000;
		const payload = encode( encoder.encode( JSON.stringify( { origin: url.origin, expiresAt } ) ) );
		const signature = encode( await crypto.subtle.sign( 'HMAC', key, encoder.encode( payload ) ) );
		return json( { expiresAt }, 200, { 'Set-Cookie': `${cookieName}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${development ? '' : '; Secure'}` } );

	}

	try {

		const value = request.headers.get( 'Cookie' )?.split( ';' ).map( item => item.trim() ).find( item => item.startsWith( `${cookieName}=` ) )?.slice( cookieName.length + 1 );
		if ( ! value || value.length > 1024 ) throw new Error();
		const [ payload, signature, extra ] = value.split( '.' );
		if ( extra || ! await crypto.subtle.verify( 'HMAC', key, decode( signature ), encoder.encode( payload ) ) ) throw new Error();
		const session = JSON.parse( new TextDecoder().decode( decode( payload ) ) );
		if ( session.origin !== url.origin || ! Number.isFinite( session.expiresAt ) || session.expiresAt <= Date.now() || session.expiresAt > Date.now() + 3601000 ) throw new Error();

	} catch {

		return json( { error: 'Refresh the plate download session.' }, 401 );

	}

	if ( ! [ 'GET', 'HEAD' ].includes( request.method ) ) return json( { error: 'Method not allowed.' }, 405 );
	try {

		const catalogue = await readJSON( 'catalogue.json' );
		if ( catalogue?.schemaVersion !== 1 || ! Array.isArray( catalogue.sets ) || catalogue.sets.length > 100 ) throw new Error( 'Invalid catalogue' );
		catalogue.sets.forEach( validatePlateManifest );
		if ( url.pathname === '/v1/plates' ) return json( catalogue );
		const match = /^\/v1\/plates\/([a-zA-Z0-9-]{1,80})\/([a-z0-9.-]+)$/.exec( url.pathname );
		const manifest = match && catalogue.sets.find( item => item.id === match[ 1 ] );
		if ( ! manifest ) return json( { error: 'Plate set unavailable.' }, 404 );
		const filename = match[ 2 ];
		if ( ! [ 'thumbnail.jpg', 'preview.mp4', ...PLATE_SLOTS.map( slot => `${slot}.mp4` ) ].includes( filename ) ) return json( { error: 'Plate file unavailable.' }, 404 );
		const path = `${manifest.id}/${filename}`, metadata = await readObject( path, null, true );
		if ( ! metadata || ! Number.isSafeInteger( metadata.size ) || metadata.size < 1 ) return json( { error: 'Plate file unavailable.' }, 404 );
		if ( [ 'thumbnail.jpg', 'preview.mp4' ].includes( filename ) && metadata.size > 2 * 1024 * 1024 ) throw new Error( 'Browsing asset exceeds size limit.' );
		const fullSize = metadata.size, raw = request.headers.get( 'Range' );
		const range = raw ? plateRange( raw, fullSize ) : null;
		if ( raw && ! range ) return new Response( null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${fullSize}` } } );
		const size = range ? range.end - range.start + 1 : fullSize;
		const object = request.method === 'HEAD' ? null : await readObject( path, range );
		return new Response( object?.body || null, { status: range ? 206 : 200, headers: {
			...baseHeaders, 'Content-Type': filename.endsWith( '.jpg' ) ? 'image/jpeg' : 'video/mp4', 'Content-Length': String( size ), 'Accept-Ranges': 'bytes', ETag: `"${manifest.id}-${filename}"`,
			...( range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${fullSize}` } : {} ),
			...( [ 'thumbnail.jpg', 'preview.mp4' ].includes( filename ) ? { 'Cache-Control': 'private, max-age=3600' } : {} ),
		} } );

	} catch {

		return json( { error: 'The plate library is temporarily unavailable. Saved downloads are still usable.' }, 503 );

	}

}
