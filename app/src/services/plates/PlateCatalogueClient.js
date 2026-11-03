import { validatePlateManifest } from './PlateSet.js';

export class PlateCatalogueClient {

	constructor( { fetch = ( ...args ) => globalThis.fetch( ...args ) } = {} ) {

		this.fetch = fetch; this.session = null; this.expiresAt = 0;

	}

	async ensureSession( force = false ) {

		if ( ! force && this.expiresAt > Date.now() + 60000 ) return;
		if ( this.session ) return this.session;
		this.session = ( async () => {

			const response = await this.fetch( '/v1/plates/session', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout( 15000 ) } );
			if ( ! response.ok ) throw new Error( 'The plate library could not connect. Try again shortly.' );
			const result = await response.json();
			if ( ! Number.isFinite( result.expiresAt ) ) throw new Error( 'Invalid plate session.' );
			this.expiresAt = result.expiresAt;

		} )();
		try {

			await this.session;

		} finally {

			this.session = null;

		}

	}

	assetURL( manifest, filename ) {

		if ( ! /^[a-zA-Z0-9-]{1,80}$/.test( manifest.id ) || ! /^[a-z0-9.-]+$/.test( filename ) ) throw new Error( 'Invalid plate asset.' );
		return `/v1/plates/${manifest.id}/${filename}`;

	}

	async list() {

		await this.ensureSession();
		const response = await this.fetch( '/v1/plates', { credentials: 'same-origin', signal: AbortSignal.timeout( 15000 ) } );
		if ( ! response.ok || ! response.headers.get( 'content-type' )?.startsWith( 'application/json' ) ) throw new Error( 'The online plate library is unavailable. Your downloaded sets remain usable.' );
		const reader = response.body.getReader(); let length = 0, text = ''; const decoder = new TextDecoder();
		try {

			while ( true ) {

				const chunk = await reader.read(); if ( chunk.done ) break;
				length += chunk.value.byteLength;
				if ( length > 2 * 1024 * 1024 ) throw new Error( 'Plate catalogue exceeds its supported size.' );
				text += decoder.decode( chunk.value, { stream: true } );

			}

			const result = JSON.parse( text + decoder.decode() );
			if ( result.schemaVersion !== 1 || ! Array.isArray( result.sets ) || result.sets.length > 100 ) throw new Error( 'Invalid plate catalogue.' );
			return result.sets.map( validatePlateManifest );

		} finally {

			await reader.cancel().catch( () => {} ); reader.releaseLock();

		}

	}

	async media( manifest, filename, signal ) {

		await this.ensureSession();
		const response = await this.fetch( this.assetURL( manifest, filename ), { credentials: 'same-origin', signal: signal ? AbortSignal.any( [ signal, AbortSignal.timeout( 15000 ) ] ) : AbortSignal.timeout( 15000 ) } );
		if ( ! response.ok || ! response.body ) throw new Error( 'Preview unavailable.' );
		const reader = response.body.getReader(), chunks = []; let size = 0;
		try {

			while ( true ) {

				const chunk = await reader.read(); if ( chunk.done ) break;
				size += chunk.value.byteLength;
				if ( size > 2 * 1024 * 1024 ) throw new Error( 'Preview exceeds its size limit.' );
				chunks.push( chunk.value );

			}

			return new Blob( chunks, { type: filename.endsWith( '.jpg' ) ? 'image/jpeg' : 'video/mp4' } );

		} finally {

			await reader.cancel().catch( () => {} ); reader.releaseLock();

		}

	}

	async chunk( manifest, slot, start, end, { signal, onBytes = () => {} } = {} ) {

		await this.ensureSession(); signal?.throwIfAborted();
		const length = end - start + 1;
		if ( length < 1 || length > 4 * 1024 * 1024 ) throw new Error( 'Invalid plate chunk size.' );
		for ( let authorization = 0; authorization < 2; authorization ++ ) {

			const controller = new AbortController(); let timer;
			const abort = () => controller.abort( signal.reason );
			signal?.addEventListener( 'abort', abort, { once: true } );
			const resetTimeout = () => {

				clearTimeout( timer ); timer = setTimeout( () => controller.abort( new Error( 'Download stalled. Resume to continue.' ) ), 20000 );

			};

			resetTimeout();
			let reader;
			try {

				const response = await this.fetch( this.assetURL( manifest, `${slot}.mp4` ), { credentials: 'same-origin', headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal } );
				if ( response.status === 401 && authorization === 0 ) {

					await response.body?.cancel(); await this.ensureSession( true ); continue;

				}

				if ( response.status !== 206 || response.headers.get( 'content-range' ) !== `bytes ${start}-${end}/${manifest.files[ slot ].size}` || response.headers.get( 'content-type' )?.split( ';' )[ 0 ] !== 'video/mp4' || ! response.body ) {

					await response.body?.cancel(); throw new Error( 'The server could not provide a verified download range. Retry to resume.' );

				}

				reader = response.body.getReader(); const bytes = new Uint8Array( length ); let received = 0;
				while ( true ) {

					const chunk = await reader.read(); if ( chunk.done ) break;
					signal?.throwIfAborted(); resetTimeout();
					if ( received + chunk.value.byteLength > length ) throw new Error( 'Unexpected plate download size.' );
					bytes.set( chunk.value, received ); received += chunk.value.byteLength; onBytes( received );

				}

				if ( received !== length ) throw new Error( 'Download interrupted. Resume to continue.' );
				return bytes;

			} finally {

				clearTimeout( timer ); signal?.removeEventListener( 'abort', abort );
				await reader?.cancel().catch( () => {} ); reader?.releaseLock();

			}

		}

	}

}
