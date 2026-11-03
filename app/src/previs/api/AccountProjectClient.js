import { migrateStudentProjectDocument } from '../domain/StudentProjectSchema.js';

export class AccountApiError extends Error {

	constructor( code, { status = 0, retryable = false } = {} ) {

		super( 'Account synchronization request failed.' ); Object.assign( this, { code, status, retryable } );

	}

}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
export class AccountProjectClient {

	constructor( { baseURL, credential, fetch = ( ...args ) => globalThis.fetch( ...args ), timeoutMs = 30000 } ) {

		let url; try {

			url = new URL( baseURL );

		} catch {

			throw new AccountApiError( 'CONFIGURATION' );

		}

		if ( ! UUID.test( credential || '' ) || url.username || url.password || url.search || url.hash || ( url.protocol !== 'https:' && ! ( url.protocol === 'http:' && [ 'localhost', '127.0.0.1', '[::1]' ].includes( url.hostname ) ) ) || ! Number.isFinite( timeoutMs ) || timeoutMs <= 0 ) throw new AccountApiError( 'CONFIGURATION' );
		Object.assign( this, { baseURL: url.origin, credential, fetch, timeoutMs } );

	}
	async request( method, path, { body, key, match, signal, mime, binary = false } = {} ) {

		if ( ! path.startsWith( '/v1/student/' ) || path.startsWith( '//' ) || path.includes( '#' ) || ( key !== undefined && ! KEY.test( key ) ) ) throw new AccountApiError( 'INVALID_REQUEST' );
		const controller = new AbortController(); let timedOut = false;
		if ( signal?.aborted ) throw new AccountApiError( 'CANCELLED' );
		const abort = () => controller.abort(); signal?.addEventListener( 'abort', abort, { once: true } );
		const timer = setTimeout( () => {

			timedOut = true; controller.abort();

		}, this.timeoutMs );
		try {

			const headers = { Authorization: `Bearer ${this.credential}`, Accept: 'application/json' };
			if ( key ) headers[ 'Idempotency-Key' ] = key;
			if ( match != null ) headers[ 'If-Match' ] = `"${match}"`;
			if ( body !== undefined ) headers[ 'Content-Type' ] = mime || 'application/json';
			const response = await this.fetch( this.baseURL + path, { method, headers, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', ...( body === undefined ? {} : { body: mime ? body : JSON.stringify( body ) } ) } );
			if ( ! response.ok ) {

				let code; try {

					code = ( await response.json() )?.error?.code;

				} catch { /* Do not expose raw response. */ }

				if ( response.status === 401 || response.status === 403 ) code = 'AUTHORIZATION';
				else if ( response.status === 409 || response.status === 412 ) code = code === 'PROJECT_ARCHIVED' ? 'PROJECT_ARCHIVED' : code === 'MEDIA_NOT_READY' || code === 'DEPENDENCY_UNAVAILABLE' ? 'DEPENDENCIES_PENDING' : 'CONFLICT';
				else code = response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'SERVER' : 'REJECTED';
				throw new AccountApiError( code, { status: response.status, retryable: response.status === 429 || response.status >= 500 || code === 'DEPENDENCIES_PENDING' } );

			}

			if ( binary ) return response.blob();
			try {

				return await response.json();

			} catch {

				throw new AccountApiError( 'INVALID_RESPONSE', { retryable: true } );

			}

		} catch ( error ) {

			if ( error instanceof AccountApiError ) throw error;
			throw new AccountApiError( timedOut ? 'TIMEOUT' : signal?.aborted ? 'CANCELLED' : 'NETWORK', { retryable: ! signal?.aborted } );

		} finally {

			clearTimeout( timer ); signal?.removeEventListener( 'abort', abort );

		}

	}
	async reserve( { projectId, document, requestId, signal } ) {

		return this.request( 'POST', `/v1/student/projects/${projectId}/reservation`, { key: requestId, body: { projectId, document }, signal } );

	}
	async create( { projectId, document, requestId, signal } ) {

		return this.request( 'POST', '/v1/student/projects', { key: requestId, body: { projectId, document: migrateStudentProjectDocument( document ) }, signal } );

	}
	async update( { projectId, document, requestId, serverRevision, signal } ) {

		return this.request( 'PUT', `/v1/student/projects/${projectId}`, { key: requestId, match: serverRevision, body: { document: migrateStudentProjectDocument( document ) }, signal } );

	}
	async list( { cursor, signal, archived = false } = {} ) {

		return this.request( 'GET', `/v1/student/projects?limit=100${archived ? '&archived=true' : ''}${cursor ? `&cursor=${encodeURIComponent( cursor )}` : ''}`, { signal } );

	}
	async read( { projectId, signal } ) {

		return this.request( 'GET', `/v1/student/projects/${projectId}`, { signal } );

	}
	async downloadNarration( { projectId, mediaId, signal } ) {

		return this.request( 'GET', `/v1/student/projects/${projectId}/narration/${encodeURIComponent( mediaId )}/content`, { signal, binary: true } );

	}
	async metadata( { projectId, operation, signal } ) {

		return this.request( 'PATCH', `/v1/student/projects/${projectId}/metadata`, { key: operation.requestId, match: operation.expectedMetadataRevision, body: operation.patch, signal } );

	}
	async uploadNarration( { projectId, mediaId, asset, blob, signal } ) {

		const root = `/v1/student/projects/${projectId}/narration`;
		const digest = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( `${mediaId}:${asset.sha256}` ) );
		const key = `media:${Array.from( new Uint8Array( digest ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' )}`;
		const reservation = await this.request( 'POST', root, { key, body: { mediaId, sha256: asset.sha256, byteLength: asset.byteLength, mimeType: asset.mimeType }, signal } );
		if ( reservation.mediaId !== mediaId || reservation.uploadPath !== `${root}/${encodeURIComponent( mediaId )}/content` || reservation.completePath !== `${root}/${encodeURIComponent( mediaId )}/complete` ) throw new AccountApiError( 'INVALID_RESPONSE', { retryable: true } );
		if ( reservation.state !== 'complete' ) {

			await this.request( 'PUT', reservation.uploadPath, { body: blob, mime: asset.mimeType, signal } );
			await this.request( 'POST', reservation.completePath, { body: {}, signal } );

		}

	}

}
