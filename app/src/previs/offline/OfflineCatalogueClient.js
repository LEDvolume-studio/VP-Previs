import { StudentCatalogueClient } from '../api/StudentCatalogueClient.js';
import { validateStudentCatalogue, validateStudentPresetVersion, validateStudentLibraryAsset } from '../domain/StudentCatalogueSchema.js';
import { validateStudentSceneDefinition } from '../domain/StudentSceneDefinition.js';
import { validateStudentProjectDocument } from '../domain/StudentProjectSchema.js';

const hash = async bytes => Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const key = ( id, version ) => `${id}@${version}`;

/** Public, immutable catalogue cache; never stores account API responses or credentials. */
export class OfflineCatalogueClient {

	constructor( { client = new StudentCatalogueClient( { baseURL: globalThis.location?.origin } ), databaseFactory = globalThis.indexedDB, databaseName = 'RayzeePublicCatalogueCache-v1' } = {} ) {

		Object.assign( this, { client, databaseFactory, databaseName } );

	}
	async database() {

		if ( ! this.databaseFactory ) throw new Error( 'Offline storage is unavailable.' );
		this.connection ||= new Promise( ( resolve, reject ) => {

			const req = this.databaseFactory.open( this.databaseName, 1 );
			req.onupgradeneeded = () => req.result.createObjectStore( 'records', { keyPath: 'key' } );
			req.onsuccess = () => resolve( req.result ); req.onerror = () => reject( req.error ); req.onblocked = () => reject( new Error( 'Offline storage is blocked.' ) );

		} );
		return this.connection;

	}
	async get( key ) {

		const db = await this.database();
		return new Promise( ( resolve, reject ) => {

			const req = db.transaction( 'records', 'readonly' ).objectStore( 'records' ).get( key );
			req.onsuccess = () => resolve( req.result?.value ?? null ); req.onerror = () => reject( req.error );

		} );

	}
	async put( key, value ) {

		const db = await this.database();
		return new Promise( ( resolve, reject ) => {

			const tx = db.transaction( 'records', 'readwrite' ); tx.objectStore( 'records' ).put( { key, value } );
			tx.oncomplete = () => resolve(); tx.onabort = () => {

				this.storageFailure = tx.error?.name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED' : 'STORAGE_UNAVAILABLE'; reject( tx.error || new Error( 'Offline storage failed.' ) );

			};

		} );

	}
	async list( options ) {

		try {

			const value = await this.client.list( options ); validateStudentCatalogue( value ); await this.put( 'listing', value ).catch( () => {} ); return value;

		} catch ( error ) {

			if ( options?.signal?.aborted ) throw error;
			const value = await this.get( 'listing' ); if ( ! value ) throw error;
			validateStudentCatalogue( value ); return value;

		}

	}
	async getPreset( ref, options ) {

		const cacheKey = `preset:${key( ref.presetId, ref.version )}`;
		const cached = await this.get( cacheKey ).catch( () => null );
		if ( cached ) {

			validateStudentPresetVersion( cached ); return cached;

		}

		const value = await this.client.getPreset( ref, options ); await this.put( cacheKey, value ).catch( () => {} ); return value;

	}
	async getScene( ref, options ) {

		const cacheKey = `scene:${key( ref.sceneId, ref.version )}`;
		const cached = await this.get( cacheKey ).catch( () => null );
		if ( cached ) {

			validateStudentSceneDefinition( cached.sceneDefinition, cached.assets );
			if ( cached.sceneDefinition.baseScene.sceneId !== ref.sceneId || cached.sceneDefinition.baseScene.version !== ref.version ) throw new Error( 'Cached scene identity mismatch.' );
			return cached;

		}

		const value = await this.client.getScene( ref, options ); await this.put( cacheKey, value ).catch( () => {} ); return value;

	}
	async getAssetBytes( asset, options ) {

		validateStudentLibraryAsset( asset );
		const cacheKey = `asset:${asset.sha256}`;
		const cached = await this.get( cacheKey ).catch( () => null );
		if ( cached && cached.size === asset.byteLength && cached.type === asset.mimeType ) {

			const bytes = await cached.arrayBuffer();
			if ( await hash( bytes ) === asset.sha256 ) return new Uint8Array( bytes );

		}

		const bytes = await this.client.getAssetBytes( asset, options );
		await this.put( cacheKey, new Blob( [ bytes ], { type: asset.mimeType } ) ).catch( () => {} );
		return bytes;

	}
	async getStartingProject( { signal } = {} ) {

		try {

			const response = await fetch( '/v1/student/starting-project', { credentials: 'omit', cache: 'no-store', signal } );
			if ( ! response.ok ) throw new Error( 'Starting project is unavailable.' );
			const value = await response.json(); validateStudentProjectDocument( value ); await this.put( 'starting-project', value ).catch( () => {} ); return value;

		} catch ( error ) {

			if ( signal?.aborted ) throw error;
			const value = await this.get( 'starting-project' ); if ( ! value ) throw error;
			validateStudentProjectDocument( value ); return value;

		}

	}
	/** Readiness is checked afresh, including hashes, rather than trusting an old marker. */
	async checkProject( document, { narration } = {} ) {

		const missing = [];
		try {

			for ( const scene of Object.values( document.baseScenes ) ) {

				const value = await this.get( `scene:${key( scene.sceneId, scene.version )}` );
				if ( ! value ) {

					missing.push( `scene:${key( scene.sceneId, scene.version )}` ); continue;

				}

				try {

					validateStudentSceneDefinition( value.sceneDefinition, value.assets );
					if ( value.sceneDefinition.baseScene.sceneId !== scene.sceneId || value.sceneDefinition.baseScene.version !== scene.version ) throw new Error( 'Scene identity mismatch.' );

				} catch {

					missing.push( `scene:${key( scene.sceneId, scene.version )}` );

				}

			}

			for ( const asset of Object.values( document.assets ) ) {

				const blob = await this.get( `asset:${asset.sha256}` );
				if ( ! blob || blob.size !== asset.byteLength || blob.type !== asset.mimeType || await hash( await blob.arrayBuffer() ) !== asset.sha256 ) missing.push( `asset:${key( asset.assetId, asset.version )}` );

			}

			for ( const asset of Object.values( document.narration.assets ) ) {

				const row = await narration?.get( asset.assetId );
				if ( ! row?.blob || row.blob.size !== asset.byteLength || await hash( await row.blob.arrayBuffer() ) !== asset.sha256 ) missing.push( `narration:${key( asset.assetId, asset.version )}` );

			}

			return { ready: missing.length === 0, missing, ...( missing.length && this.storageFailure ? { reason: this.storageFailure } : {} ) };

		} catch ( error ) {

			return { ready: false, missing, reason: error?.name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED' : 'STORAGE_UNAVAILABLE' };

		}

	}
	async prepareProject( document, { narration, onProgress = () => {}, signal } = {} ) {

		this.storageFailure = null;
		try {

			for ( const scene of Object.values( document.baseScenes ) ) {

				signal?.throwIfAborted(); onProgress( 'scene' ); await this.getScene( scene, { signal } );

			}

			for ( const asset of Object.values( document.assets ) ) {

				signal?.throwIfAborted(); onProgress( asset.assetId ); await this.getAssetBytes( asset, { signal } );

			}

			return await this.checkProject( document, { narration } );

		} catch ( error ) {

			if ( signal?.aborted ) throw error; return { ready: false, missing: [], reason: error?.name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED' : 'DOWNLOAD_FAILED' };

		}

	}
	clear() {

		this.client.clear();

	}

}
