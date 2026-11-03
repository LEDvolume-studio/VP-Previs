import { serializeStudentCatalogueContent, validateStudentCatalogue, validateStudentPresetVersion, validateStudentLibraryAsset } from '../domain/StudentCatalogueSchema.js';

import { validateStudentSceneDefinition } from '../domain/StudentSceneDefinition.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const clone = value => structuredClone( value );
const cancelled = signal => {

	if ( signal?.aborted ) throw new StudentCatalogueApiError( 'CANCELLED' );

};

/** Deliberately excludes server text, response bodies and endpoint URLs. */
export class StudentCatalogueApiError extends Error {

	constructor( code, { status = 0, retryable = false } = {} ) {

		super( 'The student catalogue request could not be completed.' );
		this.name = 'StudentCatalogueApiError';
		this.code = code;
		this.status = status;
		this.retryable = retryable;

	}

}

async function readJSON( response, maxBytes, signal ) {

	const length = response.headers.get( 'content-length' );
	if ( length && /^\d+$/.test( length ) && Number( length ) > maxBytes ) {

		await response.body?.cancel().catch( () => {} );
		throw new StudentCatalogueApiError( 'RESPONSE_TOO_LARGE' );

	}

	if ( response.headers.get( 'content-type' )?.split( ';' )[ 0 ].trim().toLowerCase() !== 'application/json' || ! response.body ) {

		await response.body?.cancel().catch( () => {} );
		throw new StudentCatalogueApiError( 'INVALID_RESPONSE' );

	}

	const reader = response.body.getReader();
	const abort = () => {

		reader.cancel().catch( () => {} );

	};

	signal?.addEventListener( 'abort', abort, { once: true } );
	let bytes = 0;
	let text = '';
	const decoder = new TextDecoder( 'utf-8', { fatal: true } );
	try {

		cancelled( signal );
		while ( true ) {

			const { done, value } = await reader.read();
			cancelled( signal );
			if ( done ) break;
			bytes += value.byteLength;
			if ( bytes > maxBytes ) throw new StudentCatalogueApiError( 'RESPONSE_TOO_LARGE' );
			text += decoder.decode( value, { stream: true } );

		}

		text += decoder.decode();
		return JSON.parse( text );

	} catch ( error ) {

		await reader.cancel().catch( () => {} );
		cancelled( signal );
		if ( error instanceof StudentCatalogueApiError ) throw error;
		throw new StudentCatalogueApiError( 'INVALID_RESPONSE' );

	} finally {

		signal?.removeEventListener( 'abort', abort );
		reader.releaseLock();

	}

}

async function readAssetBytes( response, asset, signal ) {

	const length = response.headers.get( 'content-length' );
	if ( response.status !== 200 || response.headers.get( 'content-type' )?.split( ';' )[ 0 ].trim().toLowerCase() !== asset.mimeType || ! response.body || ( length !== null && ( ! /^\d+$/.test( length ) || Number( length ) !== asset.byteLength ) ) ) {

		await response.body?.cancel().catch( () => {} );
		throw new StudentCatalogueApiError( 'INVALID_RESPONSE' );

	}

	const reader = response.body.getReader();
	const abort = () => {

		reader.cancel().catch( () => {} );

	};

	signal?.addEventListener( 'abort', abort, { once: true } );
	const bytes = new Uint8Array( asset.byteLength ); let size = 0;
	try {

		cancelled( signal );
		while ( true ) {

			const { done, value } = await reader.read();
			cancelled( signal );
			if ( done ) break;
			if ( size + value.byteLength > bytes.byteLength ) throw new StudentCatalogueApiError( 'RESPONSE_TOO_LARGE' );
			bytes.set( value, size ); size += value.byteLength;

		}

		if ( size !== asset.byteLength ) throw new StudentCatalogueApiError( 'ASSET_MISMATCH' );
		const digest = await crypto.subtle.digest( 'SHA-256', bytes );
		cancelled( signal );
		const sha256 = Array.from( new Uint8Array( digest ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
		if ( sha256 !== asset.sha256 ) throw new StudentCatalogueApiError( 'ASSET_MISMATCH' );
		return bytes;

	} catch ( error ) {

		await reader.cancel().catch( () => {} );
		cancelled( signal );
		if ( error instanceof StudentCatalogueApiError ) throw error;
		throw new StudentCatalogueApiError( 'INVALID_RESPONSE' );

	} finally {

		signal?.removeEventListener( 'abort', abort ); reader.releaseLock();

	}

}

/** Only explicitly configured catalogue endpoints are fetched; asset references are never URLs. */
export class StudentCatalogueClient {

	#listing = null;
	#presets = new Map();
	#scenes = new Map();
	#generation = 0;
	#listingRequest = 0;

	constructor( { baseURL, fetch = ( ...args ) => globalThis.fetch( ...args ), origin = globalThis.location?.origin, maxJSONBytes = 8 * 1024 * 1024, maxCachedPresets = 32 } = {} ) {

		let url;
		try {

			url = new URL( baseURL );

		} catch {

			throw new StudentCatalogueApiError( 'CONFIGURATION' );

		}

		const loopback = [ 'localhost', '127.0.0.1', '[::1]' ].includes( url.hostname );
		if ( ( url.protocol !== 'https:' && ! ( url.protocol === 'http:' && loopback ) ) || url.username || url.password || url.search || url.hash || ( origin && url.origin !== origin ) || typeof fetch !== 'function' || ! Number.isSafeInteger( maxJSONBytes ) || maxJSONBytes < 1 || ! Number.isSafeInteger( maxCachedPresets ) || maxCachedPresets < 1 || maxCachedPresets > 1024 ) throw new StudentCatalogueApiError( 'CONFIGURATION' );
		this.baseURL = url.href.replace( /\/$/, '' );
		this.fetch = fetch;
		this.maxJSONBytes = maxJSONBytes;
		this.maxCachedPresets = maxCachedPresets;

	}

	clear() {

		this.#generation ++;
		this.#listing = null;
		this.#presets.clear();
		this.#scenes.clear();

	}

	async list( { signal } = {} ) {

		cancelled( signal );
		const retained = this.#listing;
		const generation = this.#generation;
		const request = ++ this.#listingRequest;
		const response = await this.#request( '/v1/catalogue', signal, retained?.etag );
		if ( response.status === 304 ) {

			if ( ! retained?.etag ) throw new StudentCatalogueApiError( 'INVALID_RESPONSE' );
			return clone( retained.value );

		}

		const value = await this.#validate( response, validateStudentCatalogue, signal );
		const etag = response.headers.get( 'etag' );
		cancelled( signal );
		if ( generation === this.#generation && request === this.#listingRequest ) this.#listing = { value: clone( value ), etag };
		return clone( value );

	}

	async getPreset( { presetId, version } = {}, { signal } = {} ) {

		cancelled( signal );
		if ( typeof presetId !== 'string' || ! ID.test( presetId ) || typeof version !== 'string' || ! ID.test( version ) ) throw new StudentCatalogueApiError( 'INVALID_REQUEST' );
		const key = `${presetId}@${version}`;
		const retained = this.#presets.get( key );
		if ( retained ) {

			this.#presets.delete( key );
			this.#presets.set( key, retained );
			return clone( retained );

		}

		const generation = this.#generation;
		const response = await this.#request( `/v1/catalogue/presets/${encodeURIComponent( presetId )}/${encodeURIComponent( version )}`, signal );
		if ( response.status === 304 ) throw new StudentCatalogueApiError( 'INVALID_RESPONSE' );
		const value = await this.#validate( response, validateStudentPresetVersion, signal );
		if ( value.presetId !== presetId || value.version !== version ) throw new StudentCatalogueApiError( 'INVALID_RESPONSE' );
		cancelled( signal );
		if ( generation === this.#generation ) {

			const existing = this.#presets.get( key );
			if ( existing && serializeStudentCatalogueContent( existing ) !== serializeStudentCatalogueContent( value ) ) throw new StudentCatalogueApiError( 'IMMUTABLE_MISMATCH' );
			this.#presets.set( key, clone( value ) );
			while ( this.#presets.size > this.maxCachedPresets ) this.#presets.delete( this.#presets.keys().next().value );

		}

		return clone( value );

	}

	async getScene( { sceneId, version } = {}, { signal } = {} ) {

		cancelled( signal );
		if ( typeof sceneId !== 'string' || ! ID.test( sceneId ) || typeof version !== 'string' || ! ID.test( version ) ) throw new StudentCatalogueApiError( 'INVALID_REQUEST' );
		const key = `${sceneId}@${version}`;
		const retained = this.#scenes.get( key );
		if ( retained ) {

			this.#scenes.delete( key ); this.#scenes.set( key, retained );
			return clone( retained );

		}

		const generation = this.#generation;
		const response = await this.#request( `/v1/catalogue/scenes/${encodeURIComponent( sceneId )}/${encodeURIComponent( version )}`, signal );
		if ( response.status === 304 ) throw new StudentCatalogueApiError( 'INVALID_RESPONSE' );
		const value = await this.#validate( response, candidate => {

			if ( ! candidate || Object.keys( candidate ).sort().join() !== 'assets,sceneDefinition' ) throw new Error();
			validateStudentSceneDefinition( candidate.sceneDefinition, candidate.assets );
			if ( candidate.sceneDefinition.baseScene.sceneId !== sceneId || candidate.sceneDefinition.baseScene.version !== version ) throw new Error();
			const inventory = candidate.sceneDefinition.baseScene.assets.map( asset => `${asset.assetId}@${asset.version}` ).sort();
			if ( Object.keys( candidate.assets ).sort().join() !== inventory.join() ) throw new Error();
			for ( const asset of Object.values( candidate.assets ) ) validateStudentLibraryAsset( asset );

		}, signal );
		cancelled( signal );
		if ( generation === this.#generation ) {

			const existing = this.#scenes.get( key );
			if ( existing && serializeStudentCatalogueContent( existing ) !== serializeStudentCatalogueContent( value ) ) throw new StudentCatalogueApiError( 'IMMUTABLE_MISMATCH' );
			this.#scenes.set( key, clone( value ) );
			while ( this.#scenes.size > this.maxCachedPresets ) this.#scenes.delete( this.#scenes.keys().next().value );

		}

		return clone( value );

	}

	async getAssetBytes( asset, { signal } = {} ) {

		cancelled( signal );
		try {

			validateStudentLibraryAsset( asset );
			if ( asset.byteLength > ( asset.kind === 'model' ? 64 : 128 ) * 1024 * 1024 ) throw new Error();

		} catch {

			throw new StudentCatalogueApiError( 'INVALID_REQUEST' );

		}

		// Capture immutable metadata before awaiting caller-controlled networking.
		const metadata = clone( asset );
		const response = await this.#request( `/v1/catalogue/assets/${encodeURIComponent( metadata.assetId )}/${encodeURIComponent( metadata.version )}`, signal, undefined, metadata.mimeType );
		return readAssetBytes( response, metadata, signal );

	}

	async #validate( response, validate, signal ) {

		const value = await readJSON( response, this.maxJSONBytes, signal );
		cancelled( signal );
		try {

			validate( value );

		} catch {

			throw new StudentCatalogueApiError( 'INVALID_RESPONSE' );

		}

		return value;

	}

	async #request( path, signal, etag, accept = 'application/json' ) {

		try {

			const headers = { Accept: accept };
			if ( etag ) headers[ 'If-None-Match' ] = etag;
			const response = await this.fetch( `${this.baseURL}${path}`, { method: 'GET', headers, signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' } );
			if ( signal?.aborted ) await response.body?.cancel().catch( () => {} );
			cancelled( signal );
			if ( response.status === 304 || response.ok ) return response;
			const status = response.status;
			await response.body?.cancel().catch( () => {} );
			cancelled( signal );
			const code = status === 401 || status === 403 ? 'AUTHORIZATION' : status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'SERVER' : 'REJECTED';
			throw new StudentCatalogueApiError( code, { status, retryable: status === 429 || status >= 500 } );

		} catch ( error ) {

			cancelled( signal );
			if ( error instanceof StudentCatalogueApiError ) throw error;
			throw new StudentCatalogueApiError( 'NETWORK', { retryable: true } );

		}

	}

}
