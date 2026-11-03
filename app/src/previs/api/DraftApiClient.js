import { migrateStudentProjectDocument } from '../domain/StudentProjectSchema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/** Errors deliberately contain no raw server text, request body, URL, capability or cause. */
export class DraftApiError extends Error {

	constructor( code, { status = 0, retryable = false } = {} ) {

		super( 'Private backup request could not be completed.' );
		this.name = 'DraftApiError';
		this.code = code;
		this.status = status;
		this.retryable = retryable;

	}

}

export function createDraftIdentity( crypto = globalThis.crypto ) {

	const bytes = crypto.getRandomValues( new Uint8Array( 32 ) );
	const capability = btoa( String.fromCharCode( ...bytes ) ).replaceAll( '+', '-' ).replaceAll( '/', '_' ).replace( /=+$/, '' );
	return { draftId: crypto.randomUUID(), capability };

}

export class DraftApiClient {

	constructor( { baseURL, fetch = ( ...args ) => globalThis.fetch( ...args ), timeoutMs = 15000, schedule = ( callback, delay ) => setTimeout( callback, delay ), cancel = timer => clearTimeout( timer ) } ) {

		let url;
		try {

			url = new URL( baseURL );

		} catch {

			throw new DraftApiError( 'CONFIGURATION' );

		}

		const loopback = [ 'localhost', '127.0.0.1', '[::1]' ].includes( url.hostname );
		if ( ( url.protocol !== 'https:' && ! ( url.protocol === 'http:' && loopback ) ) || url.username || url.password || url.search || url.hash || ! Number.isFinite( timeoutMs ) || timeoutMs <= 0 ) throw new DraftApiError( 'CONFIGURATION' );
		this.baseURL = url.href.replace( /\/$/, '' );
		this.fetch = fetch;
		this.timeoutMs = timeoutMs;
		this.schedule = schedule;
		this.cancel = cancel;

	}

	async create( { draftId, capability, requestId, document, signal } ) {

		return this.request( 'POST', '/v1/drafts', { draftId, capability, requestId, document, signal } );

	}

	async update( { draftId, capability, requestId, document, serverRevision, signal } ) {

		if ( ! Number.isSafeInteger( serverRevision ) || serverRevision < 0 ) throw new DraftApiError( 'INVALID_REQUEST' );
		return this.request( 'PUT', `/v1/drafts/${draftId}`, { draftId, capability, requestId, document, serverRevision, signal } );

	}

	async read( { draftId, capability, signal } ) {

		return this.request( 'GET', `/v1/drafts/${draftId}`, { draftId, capability, signal } );

	}

	async request( method, path, { draftId, capability, requestId, document, serverRevision, signal } ) {

		if ( ! UUID.test( draftId ) || ! CAPABILITY.test( capability ) ) throw new DraftApiError( 'INVALID_REQUEST' );
		if ( method !== 'GET' && ( typeof requestId !== 'string' || ! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test( requestId ) ) ) throw new DraftApiError( 'INVALID_REQUEST' );
		let content;
		if ( method !== 'GET' ) {

			try {

				content = migrateStudentProjectDocument( document );

			} catch {

				throw new DraftApiError( 'INVALID_DOCUMENT' );

			}

		}

		const controller = new AbortController();
		let timedOut = false;
		const abort = () => controller.abort();
		if ( signal?.aborted ) throw new DraftApiError( 'CANCELLED' );
		signal?.addEventListener( 'abort', abort, { once: true } );
		const timer = this.schedule( () => {

			timedOut = true; controller.abort();

		}, this.timeoutMs );
		try {

			const headers = { Authorization: `Bearer ${capability}`, Accept: 'application/json' };
			if ( method !== 'GET' ) {

				headers[ 'Content-Type' ] = 'application/json'; headers[ 'Idempotency-Key' ] = requestId;

			}

			if ( method === 'PUT' ) headers[ 'If-Match' ] = `"${serverRevision}"`;
			const response = await this.fetch( `${this.baseURL}${path}`, {
				method, headers, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
				...( method === 'GET' ? {} : { body: JSON.stringify( method === 'POST' ? { draftId, document: content } : { document: content } ) } ),
			} );
			if ( ! response.ok ) {

				const status = response.status;
				let remoteCode;
				try {

					remoteCode = ( await response.json() )?.error?.code;

				} catch { /* Never expose raw response text. */ }

				const code = remoteCode === 'MEDIA_NOT_READY' ? 'DEPENDENCIES_PENDING' : status === 409 || status === 412 ? 'CONFLICT' : status === 401 || status === 403 ? 'AUTHORIZATION' : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'SERVER' : 'REJECTED';
				throw new DraftApiError( code, { status, retryable: status === 429 || status >= 500 } );

			}

			let result;
			try {

				result = await response.json();

			} catch {

				throw new DraftApiError( 'INVALID_RESPONSE', { retryable: true } );

			}

			if ( result?.draftId !== draftId || ! Number.isSafeInteger( result.serverRevision ) || result.serverRevision < 0 ) throw new DraftApiError( 'INVALID_RESPONSE', { retryable: true } );
			if ( method !== 'GET' && result.documentRevision !== content.revision ) throw new DraftApiError( 'INVALID_RESPONSE', { retryable: true } );
			if ( method === 'GET' ) {

				try {

					return { draftId, serverRevision: result.serverRevision, document: migrateStudentProjectDocument( result.document ) };

				} catch {

					throw new DraftApiError( 'INVALID_RESPONSE' );

				}

			}

			return { draftId, serverRevision: result.serverRevision, documentRevision: result.documentRevision, dependenciesVerified: result.dependenciesVerified === true };

		} catch ( error ) {

			if ( error instanceof DraftApiError ) throw error;
			throw new DraftApiError( timedOut ? 'TIMEOUT' : signal?.aborted ? 'CANCELLED' : 'NETWORK', { retryable: ! signal?.aborted } );

		} finally {

			this.cancel( timer );
			signal?.removeEventListener( 'abort', abort );

		}

	}

}
