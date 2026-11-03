import { handlePlateDelivery } from './PlateDelivery.js';

export function handleR2Plates( request, env ) {

	if ( ! new URL( request.url ).pathname.startsWith( '/v1/plates' ) ) return null;
	if ( env.ENABLE_PLATE_API !== 'true' || ! env.LIBRARY ) return new Response( JSON.stringify( { error: 'Plate library unavailable.' } ), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } } );
	return handlePlateDelivery( request, {
		secret: env.PLATE_SESSION_SECRET,
		development: [ 'local', 'test' ].includes( env.ENVIRONMENT ),
		readJSON: async path => {

			const object = await env.LIBRARY.get( `plates/${path}` );
			if ( ! object || object.size > 2 * 1024 * 1024 ) throw new Error( 'Catalogue unavailable' );
			return object.json();

		},
		readObject: async ( path, range, head ) => {

			if ( head ) return env.LIBRARY.head( `plates/${path}` );
			return env.LIBRARY.get( `plates/${path}`, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined );

		},
	} );

}
