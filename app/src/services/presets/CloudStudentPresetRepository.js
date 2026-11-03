import { StudentCatalogueClient } from '../../previs/api/StudentCatalogueClient.js';
import { serializeStudentCatalogueContent } from '../../previs/domain/StudentCatalogueSchema.js';
import { assetVersionKey } from '../../previs/domain/StudentProjectSchema.js';

/** Public, read-only cloud catalogue. Refresh notifications never edit shots. */
export class CloudStudentPresetRepository {

	constructor( { client, baseURL = globalThis.location?.origin, pollIntervalMs = 15000, eventTarget = globalThis.window, setInterval = ( ...args ) => globalThis.setInterval( ...args ), clearInterval = timer => globalThis.clearInterval( timer ) } = {} ) {

		this.client = client || new StudentCatalogueClient( { baseURL } );
		Object.assign( this, { pollIntervalMs, eventTarget, setInterval, clearInterval } );
		this.storage = 'cloud'; this.listeners = new Set(); this.assets = new Map(); this.thumbnails = new Map(); this.fingerprint = null; this.polling = null;
		this.onFocus = () => this.poll();

	}

	async list() {

		const catalogue = await this.client.list();
		const records = new Array( catalogue.presets.length );
		let index = 0;
		await Promise.all( Array.from( { length: Math.min( 4, records.length ) }, async () => {

			while ( index < catalogue.presets.length ) {

				const current = index ++, summary = catalogue.presets[ current ];
				const studentPreset = await this.client.getPreset( summary );
				for ( const asset of Object.values( studentPreset.assets ) ) this.assets.set( assetVersionKey( asset ), structuredClone( asset ) );
				let thumbnail = null;
				if ( studentPreset.thumbnail ) {

					const asset = studentPreset.assets[ assetVersionKey( studentPreset.thumbnail ) ], key = assetVersionKey( asset );
					if ( ! this.thumbnails.has( key ) ) this.thumbnails.set( key, new Blob( [ await this.client.getAssetBytes( asset ) ], { type: asset.mimeType } ) );
					thumbnail = this.thumbnails.get( key );

				}

				records[ current ] = { presetId: studentPreset.presetId, revision: studentPreset.version, name: studentPreset.name, studentPreset, thumbnail };

			}

		} ) );
		this.fingerprint = serializeStudentCatalogueContent( catalogue );
		const activeThumbnails = new Set( records.filter( item => item.studentPreset.thumbnail ).map( item => assetVersionKey( item.studentPreset.thumbnail ) ) );
		for ( const key of this.thumbnails.keys() ) if ( ! activeThumbnails.has( key ) ) this.thumbnails.delete( key );
		return records;

	}

	async getScene( reference, options ) {

		try {

			const scene = await this.client.getScene( reference, options );
			for ( const asset of Object.values( scene.assets ) ) this.assets.set( assetVersionKey( asset ), structuredClone( asset ) );
			return scene;

		} catch ( error ) {

			if ( error.code === 'NOT_FOUND' ) return null;
			throw error;

		}

	}

	async getAssetRecord( reference, options ) {

		const asset = reference.sha256 ? reference : this.assets.get( assetVersionKey( reference ) );
		if ( ! asset ) return null;
		const blob = new Blob( [ await this.client.getAssetBytes( asset, options ) ], { type: asset.mimeType } );
		return { asset: structuredClone( asset ), blob };

	}

	subscribe( listener ) {

		this.listeners.add( listener );
		if ( this.listeners.size === 1 ) {

			this.timer = this.setInterval( () => this.poll(), this.pollIntervalMs );
			this.eventTarget?.addEventListener( 'focus', this.onFocus );

		}

		return () => {

			this.listeners.delete( listener );
			if ( ! this.listeners.size ) this.stopPolling();

		};

	}

	poll() {

		if ( ! this.listeners.size || this.polling ) return this.polling;
		this.polling = this.client.list().then( catalogue => {

			const fingerprint = serializeStudentCatalogueContent( catalogue );
			if ( this.fingerprint !== null && fingerprint !== this.fingerprint ) {

				for ( const listener of this.listeners ) listener( { type: 'changed' } );

			}

		} ).catch( () => {

			// Keep the last usable gallery during a temporary network failure.
			// An explicit refresh still reports its failure through list().

		} ).finally( () => {

			this.polling = null;

		} );
		return this.polling;

	}

	stopPolling() {

		this.clearInterval( this.timer ); this.timer = null;
		this.eventTarget?.removeEventListener( 'focus', this.onFocus );

	}

	close() {

		this.listeners.clear(); this.stopPolling(); this.thumbnails.clear(); this.assets.clear();

	}

}
