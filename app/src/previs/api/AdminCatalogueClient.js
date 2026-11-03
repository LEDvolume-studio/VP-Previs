import { serializeStudentCatalogueContent, validateCatalogueId, validateStudentLibraryAsset, validateStudentPresetVersion } from '../domain/StudentCatalogueSchema.js';

// Stay below the Cloudflare Free plan 100 MB request-body limit.
const MAX_ASSET_BYTES = 90 * 1024 * 1024;
const cancelled = signal => {

	if ( signal?.aborted ) throw new AdminCatalogueApiError( 'CANCELLED' );

};

const exact = ( value, fields ) => value && typeof value === 'object' && ! Array.isArray( value ) && Object.keys( value ).length === fields.length && fields.every( key => Object.hasOwn( value, key ) );
const revision = value => Number.isSafeInteger( value ) && value >= 0;

/** Never includes response bodies, URLs, credentials or server exception text. */
export class AdminCatalogueApiError extends Error {

	constructor( code, { status = 0, retryable = false } = {} ) {

		super( 'The admin catalogue request could not be completed.' );
		this.name = 'AdminCatalogueApiError'; this.code = code; this.status = status; this.retryable = retryable;

	}

}

async function readJSON( response, maxBytes, signal ) {

	const length = response.headers.get( 'content-length' );
	if ( length && /^\d+$/.test( length ) && Number( length ) > maxBytes ) {

		await response.body?.cancel().catch( () => {} );
		throw new AdminCatalogueApiError( 'RESPONSE_TOO_LARGE' );

	}

	if ( response.headers.get( 'content-type' )?.split( ';' )[ 0 ].trim().toLowerCase() !== 'application/json' || ! response.body ) {

		await response.body?.cancel().catch( () => {} );
		throw new AdminCatalogueApiError( 'INVALID_RESPONSE' );

	}

	const reader = response.body.getReader(), decoder = new TextDecoder( 'utf-8', { fatal: true } );
	const abort = () => {

		reader.cancel().catch( () => {} );

	};

	signal?.addEventListener( 'abort', abort, { once: true } );
	let bytes = 0, text = '';
	try {

		cancelled( signal );
		while ( true ) {

			const { done, value } = await reader.read();
			cancelled( signal );
			if ( done ) break;
			bytes += value.byteLength;
			if ( bytes > maxBytes ) throw new AdminCatalogueApiError( 'RESPONSE_TOO_LARGE' );
			text += decoder.decode( value, { stream: true } );

		}

		return JSON.parse( text + decoder.decode() );

	} catch ( error ) {

		await reader.cancel().catch( () => {} );
		cancelled( signal );
		if ( error instanceof AdminCatalogueApiError ) throw error;
		throw new AdminCatalogueApiError( 'INVALID_RESPONSE' );

	} finally {

		signal?.removeEventListener( 'abort', abort ); reader.releaseLock();

	}

}

/** Existing shared-password cookie only. A prepared operation pins the exact
 * canonical body, request ID and original head precondition for every retry.
 * A replay acknowledgement describes the original operation, never current head.
 */
export class AdminCatalogueClient {

	#operations = new WeakMap();
	#baseURL;
	#fetch;
	#maxJSONBytes;
	constructor( { baseURL, origin = globalThis.location?.origin, fetch = ( ...args ) => globalThis.fetch( ...args ), maxJSONBytes = 1024 * 1024 } = {} ) {

		try {

			const url = new URL( baseURL );
			const local = [ 'localhost', '127.0.0.1', '[::1]' ].includes( url.hostname );
			if ( ! origin || url.origin !== new URL( origin ).origin || ( url.protocol !== 'https:' && ! ( local && url.protocol === 'http:' ) ) || url.username || url.password || url.search || url.hash || typeof fetch !== 'function' || ! Number.isSafeInteger( maxJSONBytes ) || maxJSONBytes < 1 || maxJSONBytes > 8 * 1024 * 1024 ) throw new Error();
			this.#baseURL = url.href.replace( /\/$/, '' ); this.#fetch = fetch; this.#maxJSONBytes = maxJSONBytes;

		} catch {

			throw new AdminCatalogueApiError( 'CONFIGURATION' );

		}

	}

	async getHead( presetId, { signal } = {} ) {

		this.#id( presetId );
		const response = await this.#request( `/v1/admin/catalogue/presets/${encodeURIComponent( presetId )}`, { method: 'GET', signal }, true );
		if ( response.status === 404 ) return null;
		const value = await readJSON( response, this.#maxJSONBytes, signal );
		this.#ack( value, response );
		if ( value.presetId !== presetId || value.replayed ) throw new AdminCatalogueApiError( 'INVALID_RESPONSE' );
		return structuredClone( value );

	}

	preparePublication( { preset, headRevision = null, requestId } = {} ) {

		try {

			validateStudentPresetVersion( preset );

		} catch {

			throw new AdminCatalogueApiError( 'INVALID_REQUEST' );

		}

		return this.#prepare( { kind: 'publish', presetId: preset.presetId, version: preset.version, available: true, headRevision, requestId, body: serializeStudentCatalogueContent( preset ) } );

	}

	prepareAvailability( { presetId, version, available, headRevision, requestId } = {} ) {

		if ( typeof available !== 'boolean' || ! revision( headRevision ) ) throw new AdminCatalogueApiError( 'INVALID_REQUEST' );
		return this.#prepare( { kind: 'availability', presetId, version, available, headRevision, requestId, body: serializeStudentCatalogueContent( { version, available } ) } );

	}

	async publish( operation, { signal } = {} ) {

		const prepared = this.#operations.get( operation );
		if ( ! prepared || prepared.kind !== 'publish' ) throw new AdminCatalogueApiError( 'INVALID_REQUEST' );
		return this.#mutate( prepared, signal );

	}

	async setAvailability( operation, { signal } = {} ) {

		const prepared = this.#operations.get( operation );
		if ( ! prepared || prepared.kind !== 'availability' ) throw new AdminCatalogueApiError( 'INVALID_REQUEST' );
		return this.#mutate( prepared, signal );

	}

	async uploadAsset( asset, bytes, { signal } = {} ) {

		cancelled( signal );
		try {

			asset = structuredClone( asset ); validateStudentLibraryAsset( asset );

		} catch {

			throw new AdminCatalogueApiError( 'INVALID_REQUEST' );

		}

		const metadata = serializeStudentCatalogueContent( asset );
		const view = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array( bytes ) : null;
		if ( ! view || view.byteLength !== asset.byteLength || view.byteLength > MAX_ASSET_BYTES || new TextEncoder().encode( metadata ).byteLength > 16384 ) throw new AdminCatalogueApiError( 'INVALID_REQUEST' );
		// Snapshot caller-owned bytes before asynchronous hashing or fetch.
		const body = view.slice();
		const hash = Array.from( new Uint8Array( await globalThis.crypto.subtle.digest( 'SHA-256', body ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
		cancelled( signal );
		if ( hash !== asset.sha256 ) throw new AdminCatalogueApiError( 'ASSET_MISMATCH' );
		const response = await this.#request( `/v1/admin/catalogue/assets/${encodeURIComponent( asset.assetId )}/${encodeURIComponent( asset.version )}`, { method: 'PUT', headers: { 'Content-Type': asset.mimeType, 'X-Asset-Metadata': metadata }, body, signal } );
		const value = await readJSON( response, this.#maxJSONBytes, signal );
		if ( ! exact( value, [ 'assetId', 'version', 'verified' ] ) || value.assetId !== asset.assetId || value.version !== asset.version || value.verified !== true || response.headers.get( 'etag' ) !== `"${hash}"` ) throw new AdminCatalogueApiError( 'INVALID_RESPONSE' );
		return structuredClone( value );

	}

	#id( value ) {

		try {

			validateCatalogueId( value );

		} catch {

			throw new AdminCatalogueApiError( 'INVALID_REQUEST' );

		}

	}
	#prepare( value ) {

		this.#id( value.presetId ); this.#id( value.version );
		if ( typeof value.requestId !== 'string' || ! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test( value.requestId ) || ( value.headRevision !== null && ! revision( value.headRevision ) ) || new TextEncoder().encode( value.body ).byteLength > this.#maxJSONBytes ) throw new AdminCatalogueApiError( 'INVALID_REQUEST' );
		const operation = Object.freeze( { ...value } );
		this.#operations.set( operation, operation );
		return operation;

	}
	#ack( value, response ) {

		if ( ! exact( value, [ 'presetId', 'version', 'available', 'headRevision', 'replayed' ] ) || typeof value.available !== 'boolean' || typeof value.replayed !== 'boolean' || ! revision( value.headRevision ) || response.headers.get( 'etag' ) !== `"${value.headRevision}"` ) throw new AdminCatalogueApiError( 'INVALID_RESPONSE' );
		try {

			validateCatalogueId( value.presetId ); validateCatalogueId( value.version );

		} catch {

			throw new AdminCatalogueApiError( 'INVALID_RESPONSE' );

		}

	}
	async #mutate( value, signal ) {

		const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': value.requestId };
		if ( value.headRevision === null ) headers[ 'If-None-Match' ] = '*';
		else headers[ 'If-Match' ] = `"${value.headRevision}"`;
		const path = `/v1/admin/catalogue/presets/${encodeURIComponent( value.presetId )}${value.kind === 'publish' ? `/${encodeURIComponent( value.version )}` : '/availability'}`;
		const response = await this.#request( path, { method: value.kind === 'publish' ? 'PUT' : 'POST', headers, body: value.body, signal } );
		const ack = await readJSON( response, this.#maxJSONBytes, signal );
		this.#ack( ack, response );
		if ( ack.presetId !== value.presetId || ack.version !== value.version || ack.available !== value.available || ack.headRevision !== ( value.headRevision ?? - 1 ) + 1 ) throw new AdminCatalogueApiError( 'INVALID_RESPONSE' );
		return structuredClone( ack );

	}
	async #request( path, options, allowMissing = false ) {

		cancelled( options.signal );
		try {

			const response = await this.#fetch( `${this.#baseURL}${path}`, { ...options, headers: { Accept: 'application/json', ...options.headers }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' } );
			if ( options.signal?.aborted ) await response.body?.cancel().catch( () => {} );
			cancelled( options.signal );
			if ( [ 200, 201 ].includes( response.status ) ) return response;
			const status = response.status;
			await response.body?.cancel().catch( () => {} );
			cancelled( options.signal );
			if ( allowMissing && status === 404 ) return response;
			throw new AdminCatalogueApiError( status === 401 || status === 403 ? 'AUTHORIZATION' : status === 409 ? 'CONFLICT' : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'SERVER' : 'REJECTED', { status, retryable: status === 429 || status >= 500 } );

		} catch ( error ) {

			cancelled( options.signal );
			if ( error instanceof AdminCatalogueApiError ) throw error;
			throw new AdminCatalogueApiError( 'NETWORK', { retryable: true } );

		}

	}

}
