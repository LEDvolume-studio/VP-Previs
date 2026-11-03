import { LocalPlateLibrary } from './LocalPlateLibrary.js';
import { PlateCatalogueClient } from './PlateCatalogueClient.js';
import { PlateDownloader } from './PlateDownloader.js';
import { choosePlateEncoding } from './PlateCodec.js';

/** One download per set, shared by scenes and the library modal. Modal lifetime
 * never owns a download. Each caller can stop waiting without cancelling others. */
export class PlateLibraryService {

	constructor( { library = new LocalPlateLibrary(), client = new PlateCatalogueClient(), downloader, chooseEncoding = choosePlateEncoding } = {} ) {

		Object.assign( this, { library, client, chooseEncoding } );
		this.downloader = downloader || new PlateDownloader( { library, client, chooseEncoding } );
		this.jobs = new Map(); this.catalogue = null; this.catalogueAt = 0;

	}
	async list() {

		if ( ! this.catalogue || Date.now() - this.catalogueAt > 60000 ) {

			this.catalogueAt = Date.now();
			this.catalogue = this.client.list().catch( error => {

				this.catalogue = null; throw error;

			} );

		}

		return this.catalogue;

	}
	async findAsset( asset ) {

		if ( asset.mimeType !== 'video/mp4' ) return null;
		const match = manifests => {

			for ( const manifest of manifests ) {

				if ( Math.abs( manifest.frameCount * 40000 - asset.durationUs ) > 1000 ) continue;
				for ( const [ slot, file ] of Object.entries( manifest.files ) ) if ( file.sha256 === asset.sha256 && file.size === asset.byteLength ) return { manifest, view: slot.split( '-' )[ 0 ] };

			}

			return null;

		};

		let local = [];
		try {

			local = await this.library.list();

		} catch { /* Online downloads report storage errors when needed. */ }

		const saved = match( local.map( item => item.manifest ) );
		if ( saved ) return saved;
		try {

			return match( await this.list() );

		} catch { /* Unknown non-plate assets use the catalogue. */ }

		return null;

	}
	async ensure( manifest, { signal } = {} ) {

		signal?.throwIfAborted();
		const encoding = await this.chooseEncoding( manifest ), key = `${manifest.id}:${encoding}`;
		signal?.throwIfAborted();
		let job = this.jobs.get( key );
		if ( ! job ) {

			job = ( async () => {

				const local = ( await this.library.list() ).find( item => item.ready && item.manifest.id === manifest.id && ( item.manifest.downloadedEncodings || [ 'hevc', 'h264' ] ).includes( encoding ) );
				if ( local ) {

					await this.library.updateMetadata?.( manifest );
					return { manifest: { ...manifest, downloadedEncodings: local.manifest.downloadedEncodings }, encoding };

				}

				const saved = await this.downloader.start( manifest, encoding );
				if ( ! saved ) throw new Error( this.downloader.getSnapshot()[ manifest.id ]?.error || 'Plate download paused. Open Select Driving Plates to resume.' );
				const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel( 'rayzee-plate-library' ) : null;
				channel?.postMessage( 'downloaded' ); channel?.close();
				return { manifest: saved, encoding };

			} )().finally( () => this.jobs.delete( key ) );
			this.jobs.set( key, job );

		}

		if ( ! signal ) return job;
		return new Promise( ( resolve, reject ) => {

			const abort = () => reject( signal.reason );
			signal.addEventListener( 'abort', abort, { once: true } );
			job.then( value => {

				signal.removeEventListener( 'abort', abort ); if ( signal.aborted ) reject( signal.reason ); else resolve( value );

			}, error => {

				signal.removeEventListener( 'abort', abort ); reject( error );

			} );

		} );

	}

}

let shared;
export const getPlateLibraryService = () => shared ||= new PlateLibraryService();
