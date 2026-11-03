import { choosePlateEncoding } from './PlateCodec.js';
import { PLATE_VIEWS, validatePlateManifest } from './PlateSet.js';
import { PLATE_CHUNK_BYTES } from './LocalPlateLibrary.js';

const digest = async bytes => Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const exists = async ( directory, filename ) => {

	try {

		return await ( await directory.getFileHandle( filename ) ).getFile();

	} catch ( error ) {

		if ( error.name !== 'NotFoundError' ) throw error; return null;

	}

};

const save = async ( directory, filename, bytes ) => {

	const writer = await ( await directory.getFileHandle( filename, { create: true } ) ).createWritable();
	try {

		await writer.write( bytes ); await writer.close();

	} catch ( error ) {

		await writer.abort().catch( () => {} ); throw error;

	}

};

const delay = ( milliseconds, signal ) => new Promise( ( resolve, reject ) => {

	const abort = () => {

		clearTimeout( timer ); reject( signal.reason );

	};

	const timer = setTimeout( () => {

		signal.removeEventListener( 'abort', abort ); resolve();

	}, milliseconds );
	if ( signal.aborted ) abort(); else signal.addEventListener( 'abort', abort, { once: true } );

} );


const verifiedFile = async ( file, metadata, signal ) => {

	if ( ! file || file.size !== metadata.size ) return false;
	for ( let chunk = 0; chunk < metadata.chunks.length; chunk ++ ) {

		signal.throwIfAborted();
		if ( await digest( await file.slice( chunk * PLATE_CHUNK_BYTES, ( chunk + 1 ) * PLATE_CHUNK_BYTES ).arrayBuffer() ) !== metadata.chunks[ chunk ] ) return false;

	}

	return true;

};

/** Verified chunk files are durable checkpoints; never append unverified server responses. */
export class PlateDownloader {

	constructor( { library, client, chooseEncoding = choosePlateEncoding } ) {

		Object.assign( this, { library, client, chooseEncoding } );
		this.states = {}; this.listeners = new Set(); this.jobs = new Map(); this.tasks = new Map();
		this.onOnline = () => {

			for ( const state of Object.values( this.states ) ) if ( state.phase === 'waiting' ) this.start( state.manifest, state.encoding );

		};

		globalThis.addEventListener?.( 'online', this.onOnline );

	}

	subscribe = callback => {

		this.listeners.add( callback ); return () => this.listeners.delete( callback );

	};
	getSnapshot = () => this.states;
	update( id, value ) {

		this.states = { ...this.states, [ id ]: { ...this.states[ id ], ...value } };
		for ( const listener of this.listeners ) listener();

	}

	async restore() {

		for await ( const [ id, directory ] of ( await this.library.root() ).entries() ) {

			if ( directory.kind !== 'directory' || this.jobs.has( id ) ) continue;
			try {

				if ( await exists( directory, 'manifest.json' ) ) continue;
				const file = await exists( directory, 'download.json' );
				if ( ! file || file.size > 256 * 1024 ) continue;
				const { manifest, encoding } = JSON.parse( await file.text() ); validatePlateManifest( manifest );
				if ( manifest.id !== id || ! [ 'hevc', 'h264' ].includes( encoding ) ) continue;
				const total = PLATE_VIEWS.reduce( ( sum, view ) => sum + manifest.files[ `${view}-${encoding}` ].size, 0 );
				let completed = 0;
				for ( const view of PLATE_VIEWS ) {

				 const slot = `${view}-${encoding}`, metadata = manifest.files[ slot ]; let parts = 0;
				 for ( let chunk = 0; chunk < metadata.chunks.length; chunk ++ ) parts += ( await exists( directory, `part-${slot}-${chunk}` ) )?.size || 0;
				 completed += Math.min( metadata.size, Math.max( ( await exists( directory, `${slot}.mp4` ) )?.size || 0, parts ) );

				}

				this.update( id, { manifest, encoding, phase: 'paused', completed, total } );

			} catch { /* Ignore incomplete metadata; no set is marked downloaded. */ }

		}

	}

	pause( id ) {

		this.jobs.get( id )?.abort();
		if ( this.states[ id ]?.phase === 'waiting' ) this.update( id, { phase: 'paused' } );

	}
	dispose() {

		globalThis.removeEventListener?.( 'online', this.onOnline );
		for ( const job of this.jobs.values() ) job.abort(); this.listeners.clear();

	}

	async discard( id ) {

		this.pause( id );
		try {

			await this.library.remove( id );

		} catch ( error ) {

			if ( error.name !== 'NotFoundError' ) throw error;

		}

		const next = { ...this.states }; delete next[ id ]; this.states = next;
		for ( const listener of this.listeners ) listener();

	}

	start( manifest, requested = 'auto' ) {

		if ( this.tasks.has( manifest.id ) ) return this.tasks.get( manifest.id );
		const task = this.download( manifest, requested ).finally( () => this.tasks.delete( manifest.id ) );
		this.tasks.set( manifest.id, task );
		return task;

	}
	async download( manifest, requested ) {

		validatePlateManifest( manifest );
		const controller = new AbortController(), signal = controller.signal; this.jobs.set( manifest.id, controller );
		this.update( manifest.id, { manifest, phase: 'checking', error: '', completed: 0, total: 1 } );
		try {

			return await this.library.locks.request( `rayzee-plate:${manifest.id}`, { ifAvailable: true }, async lock => {

				if ( ! lock ) throw new Error( 'This set is open or downloading in another tab.' );
				const encoding = requested === 'auto' ? ( this.states[ manifest.id ].encoding || await this.chooseEncoding( manifest ) ) : requested;
				if ( ! [ 'hevc', 'h264' ].includes( encoding ) ) throw new Error( 'Invalid download encoding.' );
				const directory = await ( await this.library.root() ).getDirectoryHandle( manifest.id, { create: true } );
				const slots = PLATE_VIEWS.map( view => `${view}-${encoding}` );
				const total = slots.reduce( ( sum, slot ) => sum + manifest.files[ slot ].size, 0 );
				this.update( manifest.id, { encoding, total } );
				const estimate = await this.library.storage.estimate();
				let saved = 0;
				for ( const slot of slots ) {

				 const metadata = manifest.files[ slot ]; const final = await exists( directory, `${slot}.mp4` ); let parts = 0;
				 for ( let chunk = 0; chunk < metadata.chunks.length; chunk ++ ) parts += ( await exists( directory, `part-${slot}-${chunk}` ) )?.size || 0;
				 saved += Math.min( metadata.size, Math.max( final?.size || 0, parts ) );

				}

				// Checkpoint files and one assembled video coexist. Preserve editor/export headroom.
				if ( estimate.quota - estimate.usage < total - saved + Math.max( ...slots.map( slot => manifest.files[ slot ].size ) ) + 128 * 1024 * 1024 ) throw new Error( 'There is not enough browser storage. Remove an unused set and retry.' );
				await save( directory, 'download.json', JSON.stringify( { manifest, encoding } ) );
				let completed = 0;
				for ( const slot of slots ) {

					const metadata = manifest.files[ slot ], partNames = [];
					this.update( manifest.id, { phase: 'verifying', completed } );
					if ( await verifiedFile( await exists( directory, `${slot}.mp4` ), metadata, signal ) ) {

						completed += metadata.size; this.update( manifest.id, { completed } );
						for ( let chunk = 0; chunk < metadata.chunks.length; chunk ++ ) await directory.removeEntry( `part-${slot}-${chunk}` ).catch( () => {} );
						continue;

					}

					for ( let chunk = 0; chunk < metadata.chunks.length; chunk ++ ) {

						signal.throwIfAborted();
						const start = chunk * PLATE_CHUNK_BYTES, end = Math.min( metadata.size, start + PLATE_CHUNK_BYTES ) - 1;
						const filename = `part-${slot}-${chunk}`, existing = await exists( directory, filename );
						let bytes = existing?.size === end - start + 1 ? new Uint8Array( await existing.arrayBuffer() ) : null;
						if ( bytes && await digest( bytes ) !== metadata.chunks[ chunk ] ) bytes = null;
						if ( ! bytes ) {

							for ( let attempt = 0; attempt < 4; attempt ++ ) {

								try {

									this.update( manifest.id, { phase: attempt ? 'retrying' : 'downloading', completed } );
									bytes = await this.client.chunk( manifest, slot, start, end, { signal, onBytes: received => this.update( manifest.id, { completed: completed + received } ) } );
									if ( await digest( bytes ) !== metadata.chunks[ chunk ] ) throw new Error( 'A downloaded chunk failed verification. Retry to resume.' );
									break;

								} catch ( error ) {

									signal.throwIfAborted(); if ( attempt === 3 ) throw error;
									this.update( manifest.id, { phase: 'retrying', completed } ); await delay( 500 * 2 ** attempt, signal );

								}

							}

							await save( directory, filename, bytes );

						}

						partNames.push( filename ); completed += bytes.byteLength;
						this.update( manifest.id, { phase: 'downloading', completed } );

					}

					this.update( manifest.id, { phase: 'verifying' } );
					const writer = await ( await directory.getFileHandle( `${slot}.mp4`, { create: true } ) ).createWritable();
					try {

						for ( const filename of partNames ) {

							signal.throwIfAborted(); await writer.write( await ( await directory.getFileHandle( filename ) ).getFile() );

						}

						await writer.close();

					} catch ( error ) {

						await writer.abort().catch( () => {} ); throw error;

					}

					if ( ! await verifiedFile( await exists( directory, `${slot}.mp4` ), metadata, signal ) ) throw new Error( 'The saved video is incomplete. Resume to repair it.' );
					for ( const filename of partNames ) await directory.removeEntry( filename ).catch( () => {} );

				}

				signal.throwIfAborted();
				if ( manifest.media ) for ( const filename of [ 'thumbnail.jpg', 'preview.mp4' ] ) {

					try {

						await save( directory, filename, await this.client.media( manifest, filename, signal ) );

					} catch {

						signal.throwIfAborted();
						/* Footage remains usable if a small preview is unavailable. */

					}

				}

				const previous = await exists( directory, 'manifest.json' );
				let encodings = [];
				if ( previous ) try {

					encodings = validatePlateManifest( JSON.parse( await previous.text() ) ).downloadedEncodings || [ 'hevc', 'h264' ];

				} catch { /* Replace a damaged local marker after all video bytes verify. */ }

				const local = { ...manifest, downloadedEncodings: [ ...new Set( [ ...encodings, encoding ] ) ] };
				delete local.needsRepair;
				await save( directory, 'manifest.json', JSON.stringify( local ) );
				this.update( manifest.id, { phase: 'downloaded', completed: total } );
				for ( const slot of slots ) for ( let chunk = 0; chunk < manifest.files[ slot ].chunks.length; chunk ++ ) await directory.removeEntry( `part-${slot}-${chunk}` ).catch( () => {} );
				await directory.removeEntry( 'download.json' ).catch( () => {} );
				return local;

			} );

		} catch ( error ) {

			this.update( manifest.id, { phase: signal.aborted ? 'paused' : globalThis.navigator?.onLine === false ? 'waiting' : 'error', error: signal.aborted ? '' : error.name === 'QuotaExceededError' ? 'Browser storage filled. Free space and resume.' : error.message } );

		} finally {

			this.jobs.delete( manifest.id );

		}

	}

}
