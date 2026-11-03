import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { handlePlateDelivery } from '../../backend/src/plates/PlateDelivery.js';

/** Local adapter for the exact private download route used by the Worker. Never bundled. */
export function plateCataloguePlugin( directory ) {

	const secret = randomBytes( 32 ).toString( 'hex' );
	return { name: 'local-private-plate-catalogue', apply: 'serve', configureServer( server ) {

		server.middlewares.use( async ( req, res, next ) => {

			if ( ! req.url?.startsWith( '/v1/plates' ) ) return next();
			try {

				const response = await handlePlateDelivery( new Request( `http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers } ), {
					secret, development: true,
					readJSON: async path => {

						try {

							if ( ( await stat( resolve( directory, path ) ) ).size > 2 * 1024 * 1024 ) throw new Error();
							return JSON.parse( await readFile( resolve( directory, path ), 'utf8' ) );

						} catch ( error ) {

							if ( error.code === 'ENOENT' ) return { schemaVersion: 1, sets: [] };
							throw error;

						}

					},
					readObject: async ( path, range, head = false ) => {

						const file = resolve( directory, path ), info = await stat( file );
						return { size: info.size, body: head ? null : Readable.toWeb( createReadStream( file, range || undefined ) ) };

					},
				} );
				res.statusCode = response.status;
				response.headers.forEach( ( value, key ) => res.setHeader( key, value ) );
				if ( ! response.body ) return res.end();
				const stream = Readable.fromWeb( response.body );
				res.on( 'close', () => stream.destroy() ); stream.on( 'error', () => res.destroy() ); stream.pipe( res );

			} catch {

				res.statusCode = 503; res.end( 'Plate library unavailable.' );

			}

		} );

	} };

}
