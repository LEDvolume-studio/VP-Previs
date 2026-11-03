// Local UI and Worker code use the same Cloudflare resources as Pages.
// Startup never seeds, migrates or substitutes a local database.
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import worker from '../../backend/src/worker.js';

export const SHARED_REQUEST_LIMIT = 128 * 1024 * 1024;

export function readCloudflareCredentials( text ) {

	const lines = text.split( /\r?\n/ );
	const value = label => {

		const index = lines.indexOf( label );
		if ( index < 0 || ! lines[ index + 1 ]?.trim() ) throw new Error( 'Cloudflare shared development credentials are unavailable.' );
		return lines[ index + 1 ].trim();

	};

	return { accountId: value( 'Account ID' ), apiToken: value( 'Your API Token' ) };

}

export async function readSharedRequest( request, maximum = SHARED_REQUEST_LIMIT ) {

	const declared = request.headers[ 'content-length' ];
	if ( declared !== undefined && ( ! /^\d+$/.test( declared ) || Number( declared ) > maximum ) ) throw Object.assign( new Error( 'Request exceeds the byte limit.' ), { status: 413 } );
	const chunks = []; let size = 0;
	for await ( const chunk of request ) {

		size += chunk.byteLength;
		if ( size > maximum ) throw Object.assign( new Error( 'Request exceeds the byte limit.' ), { status: 413 } );
		chunks.push( chunk );

	}

	return Buffer.concat( chunks, size );

}

export function isLoopbackPeer( address ) {

	return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

}

export function localStudentBackend( root ) {

	let platform;
	return {
		name: 'shared-cloud-student-backend', apply: 'serve',
		async configureServer( server ) {

			// Workers exposes this extension on SubtleCrypto; the Node dev host uses
			// the native constant-time equivalent rather than a JavaScript comparison.
			if ( ! crypto.subtle.timingSafeEqual ) Object.defineProperty( crypto.subtle, 'timingSafeEqual', { value: ( a, b ) => timingSafeEqual( Buffer.from( a ), Buffer.from( b ) ) } );

			const repo = resolve( root, '..' );
			const require = createRequire( resolve( repo, 'backend/package.json' ) );
			const { getPlatformProxy } = require( 'wrangler' );
			const credentials = readCloudflareCredentials( await readFile( resolve( repo, '../CloudFlareToken.txt' ), 'utf8' ) );
			process.env.CLOUDFLARE_ACCOUNT_ID = credentials.accountId;
			process.env.CLOUDFLARE_API_TOKEN = credentials.apiToken;
			const secrets = JSON.parse( await readFile( resolve( repo, '.local-runtime/cloudflare-production-secrets.json' ), 'utf8' ) );
			platform = await getPlatformProxy( { configPath: resolve( repo, 'backend/wrangler.shared.jsonc' ), remoteBindings: true, persist: false, envFiles: [] } );
			const env = { ...platform.env, ...secrets };
			// Refuse silent local fallback: this query must reach the deployed database.
			const catalogue = await env.DB.prepare( 'SELECT count(*) AS count FROM library_assets' ).first();
			server.config.logger.info( `Shared Cloudflare D1/R2 connected (${catalogue.count} catalogue assets). Local writes affect shared data.` );
			server.middlewares.use( async ( req, res, next ) => {

				if ( ! req.url?.startsWith( '/v1/' ) && ! req.url?.startsWith( '/admin/sign-in' ) ) return next();
				if ( ! isLoopbackPeer( req.socket.remoteAddress ) ) {

					res.writeHead( 403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } );
					res.end( JSON.stringify( { error: { code: 'LOOPBACK_REQUIRED', message: 'The shared development service requires a local connection.' } } ) ); return;

				}

				try {

					const body = await readSharedRequest( req );
					const request = new Request( `http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...( body.length ? { body } : {} ) } );
					const response = await worker.fetch( request, env );
					const headers = Object.fromEntries( response.headers ); delete headers[ 'content-encoding' ]; delete headers[ 'content-length' ];
					res.writeHead( response.status, headers ); res.end( Buffer.from( await response.arrayBuffer() ) );

				} catch ( error ) {

					const tooLarge = error.status === 413;
					if ( ! res.headersSent ) res.writeHead( tooLarge ? 413 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } );
					res.end( JSON.stringify( { error: { code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'SHARED_BACKEND_UNAVAILABLE', message: tooLarge ? 'Request exceeds the byte limit.' : 'The shared Cloudflare service is unavailable.' } } ) );

				}

			} );
			server.httpServer?.once( 'close', () => {

				void platform?.dispose();

			} );

		}
	};

}
