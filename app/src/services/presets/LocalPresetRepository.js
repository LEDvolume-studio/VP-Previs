import { migrateProjectDocument } from '../projects/ProjectSchema.js';
import { serializeStudentCatalogueContent, validateCatalogueId, validateStudentLibraryAsset, validateStudentPresetVersion } from '../../previs/domain/StudentCatalogueSchema.js';
import { assetVersionKey } from '../../previs/domain/StudentProjectSchema.js';

export const LOCAL_PRESET_DATABASE_NAME = 'RayzeeLocalPresetDB';
const DATABASE_VERSION = 1;
const clone = value => structuredClone( value );
const same = ( left, right ) => [ 'assetId', 'version', 'kind', 'sha256', 'byteLength', 'mimeType', 'durationUs' ].every( field => left[ field ] === right[ field ] );

export class LocalPresetRevisionConflict extends Error {

	constructor( expectedRevision, latestRecord ) {

		super( 'This preset changed in another editor. Reload it before saving your changes.' );
		this.name = 'LocalPresetRevisionConflict';
		this.code = 'REVISION_CONFLICT';
		this.expectedRevision = expectedRevision;
		this.latestRecord = latestRecord;

	}

}

function transact( db, names, mode, operation ) {

	return new Promise( ( resolve, reject ) => {

		let failure, result;
		const tx = db.transaction( names, mode );
		tx.oncomplete = () => resolve( result );
		tx.onabort = () => reject( failure || tx.error || new Error( 'Preset storage transaction was aborted.' ) );
		tx.onerror = event => {

			failure ||= event.target.error || tx.error;

		};

		const context = {
			result: value => {

				result = value;

			},
			request: ( request, callback ) => {

				request.onsuccess = () => {

					try {

						callback( request.result );

					} catch ( error ) {

						failure = error; tx.abort();

					}

				};

			},
		};
		try {

			operation( Object.fromEntries( names.map( name => [ name, tx.objectStore( name ) ] ) ), context );

		} catch ( error ) {

			failure = error; tx.abort();

		}

	} );

}

async function verifiedBlob( asset, blob ) {

	validateStudentLibraryAsset( asset );
	if ( ! ( blob instanceof Blob ) || blob.size !== asset.byteLength ) throw new Error( 'Preset asset bytes do not match their declared length.' );
	const sha256 = Array.from( new Uint8Array( await globalThis.crypto.subtle.digest( 'SHA-256', await blob.arrayBuffer() ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	if ( sha256 !== asset.sha256 ) throw new Error( 'Preset asset bytes do not match their pinned SHA-256.' );
	return { key: assetVersionKey( asset ), asset: clone( asset ), blob: blob.slice( 0, blob.size, asset.mimeType ) };

}

function expected( revision ) {

	if ( revision !== null && ( ! Number.isSafeInteger( revision ) || revision < 0 ) ) throw new TypeError( 'An explicit expectedRevision (null for a new preset) is required.' );

}

/** Device-local authoring library shared by admin and student tabs on this origin.
 * Each revision and its verified asset bytes commit atomically. Student consumers
 * receive detached portable presets, never a live link into an existing shot.
 */
export class LocalPresetRepository {

	constructor( {
		databaseFactory = globalThis.indexedDB,
		databaseName = LOCAL_PRESET_DATABASE_NAME,
		channelFactory = name => typeof globalThis.BroadcastChannel === 'function' ? new globalThis.BroadcastChannel( name ) : null,
		now = () => new Date().toISOString(),
		createId = () => globalThis.crypto.randomUUID(),
	} = {} ) {

		Object.assign( this, { databaseFactory, databaseName, now, createId } );
		this.listeners = new Set();
		this.dbPromise = null;
		this.connection = null;
		try {

			this.channel = channelFactory( `${databaseName}:changes` );

		} catch {

			// Some privacy modes disable channels while permitting device storage.
			this.channel = null;

		}

		if ( this.channel ) this.channel.onmessage = event => {

			const value = event.data;
			if ( value?.type === 'changed' && typeof value.presetId === 'string' && Number.isSafeInteger( value.revision ) && value.revision >= 0 ) this.notify( value, false );

		};

	}

	async init() {

		if ( ! this.databaseFactory ) throw new Error( 'IndexedDB is unavailable. Presets could not be saved on this device.' );
		if ( this.dbPromise ) return this.dbPromise;
		this.dbPromise = new Promise( ( resolve, reject ) => {

			const request = this.databaseFactory.open( this.databaseName, DATABASE_VERSION );
			let blocked = false;
			request.onupgradeneeded = () => {

				const db = request.result;
				if ( ! db.objectStoreNames.contains( 'presets' ) ) db.createObjectStore( 'presets', { keyPath: 'presetId' } );
				if ( ! db.objectStoreNames.contains( 'revisions' ) ) db.createObjectStore( 'revisions', { keyPath: [ 'presetId', 'revision' ] } );
				if ( ! db.objectStoreNames.contains( 'assets' ) ) db.createObjectStore( 'assets', { keyPath: 'key' } );

			};

			request.onblocked = () => {

				blocked = true; reject( new Error( 'Another tab is blocking preset storage. Close older editor tabs and retry.' ) );

			};

			request.onerror = () => reject( request.error );
			request.onsuccess = () => {

				const db = request.result;
				if ( blocked ) {

					db.close(); return;

				}

				this.connection = db;
				db.onversionchange = () => {

					db.close(); this.connection = null; this.dbPromise = null;

				};

				resolve( db );

			};

		} );
		try {

			return await this.dbPromise;

		} catch ( error ) {

			this.dbPromise = null; throw error;

		}

	}

	subscribe( listener ) {

		if ( typeof listener !== 'function' ) throw new TypeError( 'A preset change listener is required.' );
		this.listeners.add( listener );
		return () => this.listeners.delete( listener );

	}

	notify( event, broadcast = true ) {

		for ( const listener of this.listeners ) {

			// A UI subscriber must not turn an already committed save into an error.
			try {

				listener( clone( event ) );

			} catch { /* The consumer owns its refresh errors. */ }

		}

		if ( broadcast ) {

			try {

				this.channel?.postMessage( event );

			} catch { /* Visibility refresh still recovers a closed channel. */ }

		}

	}

	async list() {

		const db = await this.init();
		return transact( db, [ 'presets' ], 'readonly', ( stores, { request, result } ) => {

			request( stores.presets.getAll(), rows => result( rows.filter( row => ! row.deleted ).sort( ( left, right ) => right.updatedAt.localeCompare( left.updatedAt ) || left.name.localeCompare( right.name ) ) ) );

		} );

	}

	async get( presetId, { revision } = {} ) {

		validateCatalogueId( presetId );
		if ( revision !== undefined && ( ! Number.isSafeInteger( revision ) || revision < 0 ) ) throw new TypeError( 'A nonnegative preset revision is required.' );
		const name = revision === undefined ? 'presets' : 'revisions';
		const db = await this.init();
		return transact( db, [ name ], 'readonly', ( stores, { request, result } ) => request( stores[ name ].get( revision === undefined ? presetId : [ presetId, revision ] ), row => result( row && ! row.deleted ? row : null ) ) );

	}

	async isDeleted( presetId ) {

		validateCatalogueId( presetId );
		const db = await this.init();
		return transact( db, [ 'presets' ], 'readonly', ( stores, { request, result } ) => request( stores.presets.get( presetId ), row => result( row?.deleted === true ) ) );

	}

	async remove( presetId, { expectedRevision } = {} ) {

		validateCatalogueId( presetId ); expected( expectedRevision );
		if ( expectedRevision === null ) throw new TypeError( 'Removing a preset requires its current revision.' );
		const db = await this.init();
		const revision = expectedRevision + 1;
		await transact( db, [ 'presets' ], 'readwrite', ( stores, { request } ) => request( stores.presets.get( presetId ), current => {

			if ( ! current || current.deleted || current.revision !== expectedRevision ) throw new LocalPresetRevisionConflict( expectedRevision, current || null );
			// Retain immutable revisions/assets for existing student shots. A tombstone
			// also prevents development seeds from reappearing on the next page load.
			stores.presets.put( { presetId, revision, deleted: true } );

		} ) );
		this.notify( { type: 'changed', presetId, revision } );

	}

	async getAssetRecord( reference ) {

		validateCatalogueId( reference?.assetId ); validateCatalogueId( reference?.version );
		const db = await this.init();
		return transact( db, [ 'assets' ], 'readonly', ( stores, { request, result } ) => request( stores.assets.get( assetVersionKey( reference ) ), row => result( row ? { asset: row.asset, blob: row.blob } : null ) ) );

	}

	/** Resolve retained scenes across every revision, including superseded inventory. */
	async getScene( reference ) {

		validateCatalogueId( reference?.sceneId ); validateCatalogueId( reference?.version );
		const db = await this.init();
		return transact( db, [ 'revisions' ], 'readonly', ( stores, { request, result } ) => {

			request( stores.revisions.getAll(), rows => {

				let scene = null, identity = null;
				for ( const { studentPreset: preset } of rows ) {

					if ( ! preset.sceneDefinition || preset.baseScene.sceneId !== reference.sceneId || preset.baseScene.version !== reference.version ) continue;
					const candidate = { sceneDefinition: preset.sceneDefinition, assets: Object.fromEntries( Object.entries( preset.assets ).filter( ( [ , asset ] ) => asset.kind === 'model' ) ) };
					const nextIdentity = serializeStudentCatalogueContent( candidate );
					if ( identity !== null && identity !== nextIdentity ) throw new Error( 'An immutable preset scene has conflicting definitions.' );
					identity = nextIdentity;
					scene = candidate;

				}

				result( scene );

			} );

		} );

	}

	async getAsset( reference ) {

		return ( await this.getAssetRecord( reference ) )?.blob || null;

	}

	async save( input, { expectedRevision } = {} ) {

		expected( expectedRevision );
		const presetId = validateCatalogueId( input.presetId || this.createId() );
		if ( typeof input.name !== 'string' || ! input.name.trim() || input.name.trim().length > 1024 ) throw new TypeError( 'A preset name up to 1024 characters is required.' );
		const name = input.name.trim();
		const revision = expectedRevision === null ? 0 : expectedRevision + 1;
		const adminDocument = migrateProjectDocument( input.adminDocument );
		const studentPreset = clone( { ...input.studentPreset, presetId, version: String( revision + 1 ), name } );
		const thumbnail = input.thumbnail ?? null;
		if ( thumbnail !== null && ( ! ( thumbnail instanceof Blob ) || ! [ 'image/png', 'image/jpeg', 'image/webp' ].includes( thumbnail.type ) || thumbnail.size < 1 || thumbnail.size > 1024 * 1024 ) ) throw new TypeError( 'A PNG, JPEG or WebP thumbnail up to 1 MiB is required.' );
		if ( ! Array.isArray( input.assetBlobs ?? [] ) ) throw new TypeError( 'Preset asset bytes must be an array.' );
		const rows = await Promise.all( ( input.assetBlobs || [] ).map( entry => verifiedBlob( entry.asset, entry.blob ) ) );
		if ( thumbnail ) {

			const digest = await globalThis.crypto.subtle.digest( 'SHA-256', await thumbnail.arrayBuffer() );
			const sha256 = Array.from( new Uint8Array( digest ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			const asset = {
				assetId: `thumbnail-${sha256}`, version: '1', kind: 'image', sha256,
				byteLength: thumbnail.size, mimeType: thumbnail.type, durationUs: null,
			};
			studentPreset.assets = { ...studentPreset.assets, [ assetVersionKey( asset ) ]: asset };
			studentPreset.thumbnail = { assetId: asset.assetId, version: asset.version };
			rows.push( { key: assetVersionKey( asset ), asset, blob: thumbnail } );

		}

		validateStudentPresetVersion( studentPreset );
		for ( const row of rows ) {

			if ( ! studentPreset.assets[ row.key ] || ! same( studentPreset.assets[ row.key ], row.asset ) ) throw new Error( 'Preset asset bytes require matching portable metadata.' );

		}

		const unique = new Map();
		for ( const row of rows ) {

			if ( unique.has( row.key ) && ! same( unique.get( row.key ).asset, row.asset ) ) throw new Error( 'An immutable preset asset has conflicting metadata.' );
			unique.set( row.key, row );

		}

		const timestamp = this.now();
		const db = await this.init();
		const saved = await transact( db, [ 'presets', 'revisions', 'assets' ], 'readwrite', ( stores, { request, result } ) => {

			request( stores.presets.get( presetId ), current => {

				if ( ( current?.revision ?? null ) !== expectedRevision ) throw new LocalPresetRevisionConflict( expectedRevision, current || null );
				const record = {
					format: 'rayzee-local-preset', schemaVersion: 1, presetId, revision, name,
					createdAt: current?.createdAt || timestamp, updatedAt: timestamp, adminDocument, studentPreset, thumbnail,
				};
				for ( const asset of Object.values( studentPreset.assets ) ) request( stores.assets.get( assetVersionKey( asset ) ), existing => {

					if ( existing && ! same( existing.asset, asset ) ) throw new Error( 'An immutable preset asset cannot be replaced with different bytes.' );
					const row = unique.get( assetVersionKey( asset ) );
					if ( ! existing && row ) stores.assets.add( row );

				} );
				stores.presets.put( record );
				stores.revisions.add( record );
				result( record );

			} );

		} );
		this.notify( { type: 'changed', presetId, revision } );
		return clone( saved );

	}

	async rename( presetId, name, { expectedRevision } = {} ) {

		expected( expectedRevision );
		const current = await this.get( presetId );
		if ( ! current || current.revision !== expectedRevision ) throw new LocalPresetRevisionConflict( expectedRevision, current );
		return this.save( { ...current, name }, { expectedRevision } );

	}

	close() {

		this.connection?.close();
		this.connection = null;
		this.dbPromise = null;
		this.channel?.close();
		this.listeners.clear();

	}

}

let singleton;
export function getLocalPresetRepository() {

	singleton ||= new LocalPresetRepository();
	return singleton;

}
