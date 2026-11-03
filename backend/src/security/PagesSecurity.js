import worker from '../worker.js';
import { assertAustralianRequest, handleAdminSessionRoute, requireAdminSession, SecurityError, securityErrorResponse, securityResponse } from './AdminSecurity.js';

const manifestPath = '/student/edge-public-assets.json';
const digest = async bytes => Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const deny = () => {

	throw new SecurityError( 503, 'PUBLIC_ASSETS_UNAVAILABLE', 'The student asset manifest is unavailable or does not match the deployed files.' );

};

const isolation = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'credentialless',
	'X-Content-Type-Options': 'nosniff'
};

async function bounded( response, maximum ) {

	if ( Number( response.headers.get( 'Content-Length' ) ) > maximum ) deny();
	const reader = response.body?.getReader();
	if ( ! reader ) deny();
	const chunks = [];
	let total = 0;
	try {

		while ( true ) {

			const { value, done } = await reader.read();
			if ( done ) break;
			total += value.byteLength;
			if ( total > maximum ) {

				await reader.cancel(); deny();

			}

			chunks.push( value );

		}

	} finally {

		reader.releaseLock();

	}

	const bytes = new Uint8Array( total );
	let offset = 0;
	for ( const chunk of chunks ) {

		bytes.set( chunk, offset ); offset += chunk.byteLength;

	}

	return bytes;

}

async function publicManifest( request, env ) {

	if ( ! env.ASSETS ) deny();
	const url = new URL( manifestPath, request.url );
	const response = await env.ASSETS.fetch( new Request( url, { method: 'GET' } ) );
	if ( response.status !== 200 || ! /^application\/json(?:;|$)/i.test( response.headers.get( 'Content-Type' ) || '' ) ) deny();
	let value;
	try {

		value = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( await bounded( response, 262144 ) ) );

	} catch {

		deny();

	}

	if ( value.version !== 1 || ! Array.isArray( value.files ) || value.files.length > 1000 || Object.keys( value ).length !== 2 ) deny();
	const entries = new Map();
	for ( const entry of value.files ) {

		if ( ! entry || Object.keys( entry ).length !== 3 || typeof entry.path !== 'string' || ! /^\/[A-Za-z0-9_./-]+$/.test( entry.path ) || new URL( entry.path, request.url ).pathname !== entry.path || entries.has( entry.path ) || ! /^[a-f0-9]{64}$/.test( entry.sha256 ) || ! Number.isSafeInteger( entry.byteLength ) || entry.byteLength <= 0 || entry.byteLength > 25 * 1024 * 1024 ) deny();
		if ( ! [ '/student/', '/student/index.html', '/student/sw.js' ].includes( entry.path ) && ! /^\/assets\/[^/]+$/.test( entry.path ) ) deny();
		entries.set( entry.path, entry );

	}

	if ( ! entries.has( '/student/' ) || ! entries.has( '/student/index.html' ) || ! entries.has( '/student/sw.js' ) ) deny();
	// No cross-request allowlist cache: a missing/malformed/stale deployment
	// cannot preserve permissions from a previous successful request.
	return entries;

}

async function publicAsset( request, env, entries, entry ) {

	if ( request.method !== 'GET' ) return securityResponse( { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } }, 405 );
	// Always fetch the complete representation for integrity verification.
	// Browser validators or byte ranges can otherwise make Pages return 304 or
	// 206 without the bytes required by the manifest check.
	const fetchHeaders = new Headers( request.headers );
	for ( const name of [ 'If-None-Match', 'If-Modified-Since', 'If-Match', 'If-Unmodified-Since', 'Range', 'If-Range' ] ) fetchHeaders.delete( name );
	const response = await env.ASSETS.fetch( new Request( request, { headers: fetchHeaders } ) );
	if ( [ 301, 302, 303, 307, 308 ].includes( response.status ) ) {

		const location = new URL( response.headers.get( 'Location' ) || '/', request.url );
		if ( location.origin !== new URL( request.url ).origin || location.search || ! entries.has( location.pathname ) ) deny();
		return new Response( null, { status: response.status, headers: { ...isolation, Location: location.pathname, 'Cache-Control': 'no-store' } } );

	}

	if ( response.status !== 200 ) deny();
	const html = /^text\/html(?:;|$)/i.test( response.headers.get( 'Content-Type' ) || '' );
	if ( html !== [ '/student/', '/student/index.html' ].includes( entry.path ) ) deny();
	const bytes = await bounded( response, entry.byteLength );
	if ( bytes.byteLength !== entry.byteLength || await digest( bytes ) !== entry.sha256 ) deny();
	const headers = new Headers( response.headers );
	for ( const [ name, value ] of Object.entries( isolation ) ) headers.set( name, value );
	headers.delete( 'Set-Cookie' );
	return new Response( bytes, { status: 200, headers } );

}

async function privateAsset( context ) {

	const { request, env } = context;
	try {

		await requireAdminSession( request, env );

	} catch ( error ) {

		if ( error instanceof SecurityError && error.status === 401 ) return new Response( null, { status: 302, headers: { ...isolation, Location: '/admin/sign-in', 'Cache-Control': 'no-store' } } );
		throw error;

	}

	const response = await context.next();
	const headers = new Headers( response.headers );
	headers.set( 'Cache-Control', 'no-store' );
	headers.set( 'Referrer-Policy', 'no-referrer' );
	headers.append( 'Content-Security-Policy', "frame-ancestors 'none'" );
	for ( const [ name, value ] of Object.entries( isolation ) ) headers.set( name, value );
	return new Response( response.body, { status: response.status, statusText: response.statusText, headers } );

}

export async function onRequest( context ) {

	const { request, env } = context;
	try {

		assertAustralianRequest( request, env );
		const url = new URL( request.url );
		// Reject encoded/ambiguous path aliases before any public classification.
		if ( /%(?:2f|5c|2e|25|0[0-9a-f]|1[0-9a-f])|\\|\/{2}/i.test( url.pathname ) ) return securityResponse( { error: { code: 'INVALID_PATH', message: 'Invalid path.' } }, 400 );
		const session = await handleAdminSessionRoute( request, env );
		if ( session ) return session;
		if ( url.pathname.startsWith( '/v1/' ) ) return worker.fetch( request, env );
		if ( url.pathname === '/student' ) return new Response( null, { status: 302, headers: { ...isolation, Location: '/student/', 'Cache-Control': 'no-store' } } );
		const review = /^\/admin\/users\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/projects\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/?$/.exec( url.pathname );
		if ( review && request.method === 'GET' ) {

			try {

				await requireAdminSession( request, env );

			} catch ( error ) {

				if ( error instanceof SecurityError && error.status === 401 ) return new Response( null, { status: 302, headers: { ...isolation, Location: '/admin/sign-in', 'Cache-Control': 'no-store' } } );
				throw error;

			}

			return new Response( null, { status: 302, headers: { ...isolation, Location: `/admin/users/review/?user=${review[ 1 ]}&project=${review[ 2 ]}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } } );

		}

		if ( [ '/', '/index', '/index.html', '/admin', '/student/diagnostic', '/student/scene' ].includes( url.pathname ) || url.pathname.startsWith( '/admin/' ) || url.pathname.startsWith( '/student/diagnostic/' ) || url.pathname.startsWith( '/student/scene/' ) ) return await privateAsset( context );
		// Diagnostic tools are deliberately absent from the public manifest.
		// Unknown paths and all root/admin bundles require the shared password.
		const entries = await publicManifest( request, env );
		const entry = entries.get( url.pathname );
		if ( entry ) return await publicAsset( request, env, entries, entry );
		return await privateAsset( context );

	} catch ( error ) {

		return securityErrorResponse( error );

	}

}
