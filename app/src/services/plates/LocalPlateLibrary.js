import { inspectPlateVideo } from './InspectPlateVideo.js';
import { PLATE_SLOTS, PLATE_VIEWS, plateError, validatePlateManifest } from './PlateSet.js';

export const PLATE_CHUNK_BYTES = 4 * 1024 * 1024;
const hex = bytes => Array.from( new Uint8Array( bytes ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const hash = async bytes => hex( await crypto.subtle.digest( 'SHA-256', bytes ) );
const validId = id => {

	if ( ! /^[a-zA-Z0-9-]{1,80}$/.test( id ) ) plateError( 'Invalid local set identifier.' );
	return id;

};

/** The completed manifest is the commit marker. No incomplete set is listed. */
export class LocalPlateLibrary {

	constructor( { storage = globalThis.navigator?.storage, locks = globalThis.navigator?.locks, inspect = inspectPlateVideo } = {} ) {

		Object.assign( this, { storage, locks, inspect } );

	}

	async root() {

		if ( ! this.storage?.getDirectory ) plateError( 'This browser cannot store plate files. Use a current browser in a normal window.' );
		return ( await this.storage.getDirectory() ).getDirectoryHandle( 'rayzee-driving-plates-v1', { create: true } );

	}

	async list() {

		const root = await this.root(), records = [];
		for await ( const [ id, directory ] of root.entries() ) {

			if ( directory.kind !== 'directory' ) continue;
			try {

				const marker = await ( await directory.getFileHandle( 'manifest.json' ) ).getFile();
				if ( marker.size > 256 * 1024 ) continue;
				const manifest = validatePlateManifest( JSON.parse( await marker.text() ) );
				if ( manifest.id !== id ) continue;
				let ready = ! manifest.needsRepair;
				for ( const slot of PLATE_SLOTS.filter( slot => ( manifest.downloadedEncodings || [ 'hevc', 'h264' ] ).includes( slot.split( '-' )[ 1 ] ) ) ) {

					try {

						const file = await ( await directory.getFileHandle( `${slot}.mp4` ) ).getFile();
						if ( file.size !== manifest.files[ slot ].size ) ready = false;

					} catch {

						ready = false;

					}

				}

				records.push( { manifest, ready } );

			} catch {

				// Interrupted imports have no valid commit marker. Never advertise them as ready.

			}

		}

		return records.sort( ( a, b ) => a.manifest.name.localeCompare( b.manifest.name ) );

	}

	async importSet( { name, files, headingOffset = 0 }, { signal, onProgress = () => {} } = {} ) {

		if ( ! this.locks ) plateError( 'This browser cannot coordinate plate imports between tabs.' );
		return this.locks.request( 'rayzee-plate-import', { ifAvailable: true }, async lock => {

			if ( ! lock ) plateError( 'Another plate import is running. Wait for it to finish.' );
			return this.importUnlocked( { name, files, headingOffset }, { signal, onProgress } );

		} );

	}

	async discardInterruptedImports() {

		if ( ! this.locks ) plateError( 'This browser cannot coordinate plate imports between tabs.' );
		return this.locks.request( 'rayzee-plate-import', { ifAvailable: true }, async lock => {

			if ( ! lock ) plateError( 'An import is still running. Finish or cancel it before cleaning up.' );
			const root = await this.root(); let removed = 0;
			for await ( const [ id, directory ] of root.entries() ) {

				if ( directory.kind !== 'directory' || ! /^[a-zA-Z0-9-]{1,80}$/.test( id ) ) continue;
				try {

					await directory.getFileHandle( 'manifest.json' );

				} catch ( error ) {

					if ( error.name !== 'NotFoundError' ) throw error;
					try {

						await directory.getFileHandle( 'download.json' ); continue;

					} catch ( failure ) {

						if ( failure.name !== 'NotFoundError' ) throw failure;

					}

					await root.removeEntry( id, { recursive: true } ); removed ++;

				}

			}

			return removed;

		} );

	}

	async importUnlocked( { name, files, headingOffset }, { signal, onProgress } ) {

		if ( typeof name !== 'string' || ! name.trim() || name.trim().length > 120 ) plateError( 'Enter a location name of at most 120 characters.' );
		if ( ! Number.isFinite( headingOffset ) || Math.abs( headingOffset ) > 360 ) plateError( 'Enter a heading offset between −360 and 360 degrees.' );
		if ( ! files || Object.keys( files ).length !== 8 || PLATE_SLOTS.some( slot => ! ( files[ slot ] instanceof Blob ) ) ) plateError( 'Select all eight files before importing.' );
		const total = PLATE_SLOTS.reduce( ( sum, slot ) => sum + files[ slot ].size, 0 );
		const estimate = await this.storage?.estimate?.();
		if ( estimate && estimate.quota - estimate.usage < total + Math.max( total * 0.15, 128 * 1024 * 1024 ) ) plateError( 'Not enough estimated browser storage for this set and working space.' );
		signal?.throwIfAborted();
		const metadata = {};
		let frameCount = null;
		for ( const slot of PLATE_SLOTS ) {

			signal?.throwIfAborted(); onProgress( { phase: 'checking', slot, completed: Object.keys( metadata ).length, total: 8 } );
			try {

				metadata[ slot ] = await this.inspect( files[ slot ], slot.split( '-' )[ 1 ], { signal } );

			} catch ( error ) {

				if ( error.name === 'AbortError' ) throw error;
				plateError( `${slot}: ${error.message}` );

			}

			frameCount ??= metadata[ slot ].frameCount;
			if ( metadata[ slot ].frameCount !== frameCount ) plateError( `${slot} has a different frame count. All eight files must match.` );

		}

		// UUID per import keeps replacements from overwriting an open or previously verified set.
		const id = crypto.randomUUID(), root = await this.root();
		const directory = await root.getDirectoryHandle( id, { create: true } );
		let copied = 0;
		try {

			for ( const slot of PLATE_SLOTS ) {

				const file = files[ slot ], chunks = [];
				const handle = await directory.getFileHandle( `${slot}.mp4`, { create: true } );
				const writer = await handle.createWritable();
				try {

					for ( let offset = 0; offset < file.size; offset += PLATE_CHUNK_BYTES ) {

						signal?.throwIfAborted();
						const bytes = await file.slice( offset, offset + PLATE_CHUNK_BYTES ).arrayBuffer();
						chunks.push( await hash( bytes ) ); await writer.write( bytes );
						copied += bytes.byteLength; onProgress( { phase: 'saving', slot, completed: copied, total } );

					}

					await writer.close();

				} catch ( error ) {

					await writer.abort().catch( () => {} ); throw error;

				}

				if ( ( await handle.getFile() ).size !== file.size ) plateError( `${slot} was not saved completely.` );
				metadata[ slot ].chunks = chunks;

			}

			signal?.throwIfAborted();
			const manifest = validatePlateManifest( { format: 'rayzee-driving-plates', schemaVersion: 1, id, name: name.trim(), createdAt: new Date().toISOString(), frameCount, headingOffset, files: metadata } );
			const writer = await ( await directory.getFileHandle( 'manifest.json', { create: true } ) ).createWritable();
			try {

				await writer.write( JSON.stringify( manifest ) ); await writer.close();

			} catch ( error ) {

				await writer.abort().catch( () => {} ); throw error;

			}

			return manifest;

		} catch ( error ) {

			await root.removeEntry( id, { recursive: true } ).catch( () => {} );
			if ( error.name === 'QuotaExceededError' ) plateError( 'Browser storage filled during import. The unfinished set was removed.' );
			throw error;

		}

	}

	async markNeedsRepair( id ) {

		try {

			const directory = await ( await this.root() ).getDirectoryHandle( validId( id ) );
			const handle = await directory.getFileHandle( 'manifest.json' );
			const manifest = JSON.parse( await ( await handle.getFile() ).text() );
			manifest.needsRepair = true;
			const writer = await handle.createWritable();
			try {

				await writer.write( JSON.stringify( manifest ) ); await writer.close();

			} catch ( error ) {

				await writer.abort().catch( () => {} ); throw error;

			}

		} catch { /* The original read failure remains the actionable error. */ }

	}

	/** Enrich older downloaded manifests with content hashes, without changing
	 * their verified video inventory or downloaded encodings. */
	async updateMetadata( manifest ) {

		validatePlateManifest( manifest );
		const release = await this.lease( manifest.id );
		try {

			const directory = await ( await this.root() ).getDirectoryHandle( manifest.id );
			const handle = await directory.getFileHandle( 'manifest.json' );
			const saved = validatePlateManifest( JSON.parse( await ( await handle.getFile() ).text() ) );
			if ( saved.frameCount !== manifest.frameCount ) return;
			for ( const slot of PLATE_SLOTS ) {

				const a = saved.files[ slot ], b = manifest.files[ slot ];
				if ( [ 'size', 'width', 'height', 'fps', 'frameCount', 'codec', 'encoding' ].some( key => a[ key ] !== b[ key ] ) || JSON.stringify( a.chunks ) !== JSON.stringify( b.chunks ) ) return;

			}

			if ( ! PLATE_SLOTS.some( slot => ! saved.files[ slot ].sha256 && manifest.files[ slot ].sha256 ) ) return;
			for ( const slot of PLATE_SLOTS ) if ( manifest.files[ slot ].sha256 ) saved.files[ slot ].sha256 = manifest.files[ slot ].sha256;
			const writer = await handle.createWritable();
			try {

				await writer.write( JSON.stringify( saved ) ); await writer.close();

			} catch ( error ) {

				await writer.abort().catch( () => {} ); throw error;

			}

		} finally {

			await release();

		}

	}

	async filesFor( manifest, encoding, { signal, onProgress = () => {} } = {} ) {

		validatePlateManifest( manifest );
		if ( ! [ 'hevc', 'h264' ].includes( encoding ) ) plateError( 'Unknown video encoding.' );
		if ( manifest.downloadedEncodings && ! manifest.downloadedEncodings.includes( encoding ) ) plateError( 'This encoding is not downloaded. Choose Automatic or download the alternative encoding.' );
		const directory = await ( await this.root() ).getDirectoryHandle( validId( manifest.id ) );
		const result = {};
		for ( const view of PLATE_VIEWS ) {

			const slot = `${view}-${encoding}`, metadata = manifest.files[ slot ];
			const file = await ( await directory.getFileHandle( `${slot}.mp4` ) ).getFile();
			if ( file.size !== metadata.size ) {

				await this.markNeedsRepair( manifest.id ); plateError( `${slot} is incomplete. Use Repair download to restore it.` );

			}

			for ( let chunk = 0; chunk < metadata.chunks.length; chunk ++ ) {

				signal?.throwIfAborted();
				if ( await hash( await file.slice( chunk * PLATE_CHUNK_BYTES, ( chunk + 1 ) * PLATE_CHUNK_BYTES ).arrayBuffer() ) !== metadata.chunks[ chunk ] ) {

					await this.markNeedsRepair( manifest.id ); plateError( `${slot} failed its integrity check. Use Repair download to restore it.` );

				}

				onProgress( { phase: 'verifying', slot, completed: chunk + 1, total: metadata.chunks.length } );

			}

			result[ view ] = file;

		}

		return result;

	}

	async lease( id ) {

		validId( id );
		if ( ! this.locks ) plateError( 'This browser cannot coordinate plate playback between tabs.' );
		let release, entered, failed;
		const held = new Promise( resolve => {

			release = resolve;

		} );
		const ready = new Promise( ( resolve, reject ) => {

			entered = resolve; failed = reject;

		} );
		const request = this.locks.request( `rayzee-plate:${id}`, { mode: 'shared' }, async () => {

			entered(); await held;

		} );
		request.catch( failed ); await ready;
		return async () => {

			release(); await request;

		};

	}

	async remove( id ) {

		validId( id );
		if ( ! this.locks ) plateError( 'This browser cannot coordinate plate deletion between tabs.' );
		await this.locks.request( `rayzee-plate:${id}`, { ifAvailable: true }, async lock => {

			if ( ! lock ) plateError( 'This set is open in another tab. Close its preview before removing it.' );
			await ( await this.root() ).removeEntry( id, { recursive: true } );

		} );

	}

}
