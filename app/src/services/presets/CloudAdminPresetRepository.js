import { AdminCatalogueClient } from '../../previs/api/AdminCatalogueClient.js';
import { StudentCatalogueClient } from '../../previs/api/StudentCatalogueClient.js';
import { serializeStudentCatalogueContent, validateCatalogueId, validateStudentLibraryAsset, validateStudentPresetVersion } from '../../previs/domain/StudentCatalogueSchema.js';
import { assetVersionKey } from '../../previs/domain/StudentProjectSchema.js';
import { migrateProjectDocument } from '../projects/ProjectSchema.js';

const clone = value => structuredClone( value );
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_LIST_BYTES = 32 * 1024 * 1024;
const same = ( a, b ) => serializeStudentCatalogueContent( a ) === serializeStudentCatalogueContent( b );
const revision = value => Number.isSafeInteger( value ) && value >= 0;
// Cloudflare can weaken a response ETag when it compresses the representation.
// Writes still send the strong, revision-based If-Match precondition.
const matchesRevisionETag = ( response, value ) => [ `"${value}"`, `W/"${value}"` ].includes( response.headers.get( 'etag' ) );
const hash = async bytes => Array.from( new Uint8Array( await globalThis.crypto.subtle.digest( 'SHA-256', bytes ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const expected = value => {

	if ( value !== null && ! revision( value ) ) throw new TypeError( 'An explicit expectedRevision (null for a new preset) is required.' );

};

export class CloudPresetRepositoryError extends Error {

	constructor( code, { status = 0, retryable = false } = {} ) {

		const messages = {
			AUTHORIZATION: 'Sign in to the admin editor before editing the shared preset library.',
			REVISION_CONFLICT: 'This preset changed in another editor. Reload it before saving your changes.',
			NETWORK: 'The shared preset library could not be reached. Retry when your connection is available.',
			SERVER: 'The shared preset library is temporarily unavailable. Retry shortly.',
			REJECTED: 'The shared preset library rejected this change. The preset has not been saved.',
			INVALID_RESPONSE: 'The shared preset library returned an invalid response.',
			RESPONSE_TOO_LARGE: 'The shared preset library response exceeds the supported size.',
		};
		super( messages[ code ] || 'The shared preset library request could not be completed.' );
		this.name = 'CloudPresetRepositoryError'; this.code = code; this.status = status; this.retryable = retryable;

	}

}

async function readJSON( response, maximum ) {

	const declared = response.headers.get( 'content-length' );
	if ( declared && ( ! /^\d+$/.test( declared ) || Number( declared ) > maximum ) ) {

		await response.body?.cancel().catch( () => {} ); throw new CloudPresetRepositoryError( 'RESPONSE_TOO_LARGE' );

	}

	if ( response.headers.get( 'content-type' )?.split( ';' )[ 0 ].trim().toLowerCase() !== 'application/json' || ! response.body ) {

		await response.body?.cancel().catch( () => {} ); throw new CloudPresetRepositoryError( 'INVALID_RESPONSE' );

	}

	const reader = response.body.getReader(), decoder = new TextDecoder( 'utf-8', { fatal: true } );
	let size = 0, text = '';
	try {

		while ( true ) {

			const { value, done } = await reader.read();
			if ( done ) break;
			size += value.byteLength;
			if ( size > maximum ) throw new CloudPresetRepositoryError( 'RESPONSE_TOO_LARGE' );
			text += decoder.decode( value, { stream: true } );

		}

		return JSON.parse( text + decoder.decode() );

	} catch ( error ) {

		await reader.cancel().catch( () => {} );
		if ( error instanceof CloudPresetRepositoryError ) throw error;
		throw new CloudPresetRepositoryError( 'INVALID_RESPONSE' );

	} finally {

		reader.releaseLock();

	}

}

function validateRecord( value ) {

	try {

		if ( ! value || ! [ 'rayzee-local-preset', 'rayzee-cloud-preset' ].includes( value.format ) || value.schemaVersion !== 1 || ! revision( value.revision ) || typeof value.name !== 'string' || ! value.name.trim() || ! Number.isFinite( Date.parse( value.createdAt ) ) || ! Number.isFinite( Date.parse( value.updatedAt ) ) || value.thumbnail !== null ) throw new Error();
		validateCatalogueId( value.presetId );
		validateStudentPresetVersion( value.studentPreset );
		migrateProjectDocument( value.adminDocument );
		if ( value.studentPreset.presetId !== value.presetId || value.studentPreset.name !== value.name ) throw new Error();
		return value;

	} catch {

		throw new CloudPresetRepositoryError( 'INVALID_RESPONSE' );

	}

}

/** Protected Cloudflare authoring records and immutable shared catalogue assets.
 * A save uploads verified bytes, then atomically advances D1's authoring record
 * and student catalogue head. Network failures never fall back to device storage.
 */
export class CloudAdminPresetRepository {

	constructor( { baseURL = globalThis.location?.origin, origin = globalThis.location?.origin, fetch = ( ...args ) => globalThis.fetch( ...args ), catalogueClient, studentClient, createId = () => globalThis.crypto.randomUUID(), channelFactory = name => typeof globalThis.BroadcastChannel === 'function' ? new globalThis.BroadcastChannel( name ) : null } = {} ) {

		// The existing clients enforce same-origin HTTPS/session-cookie transport.
		this.catalogue = catalogueClient || new AdminCatalogueClient( { baseURL, origin, fetch, maxJSONBytes: MAX_RECORD_BYTES } );
		this.student = studentClient || new StudentCatalogueClient( { baseURL, origin, fetch, maxJSONBytes: MAX_RECORD_BYTES } );
		const url = new URL( baseURL );
		if ( ! origin || url.origin !== new URL( origin ).origin || url.username || url.password || url.search || url.hash || ! [ 'https:', ...( [ 'localhost', '127.0.0.1', '[::1]' ].includes( url.hostname ) ? [ 'http:' ] : [] ) ].includes( url.protocol ) || typeof fetch !== 'function' ) throw new CloudPresetRepositoryError( 'CONFIGURATION' );
		this.baseURL = url.href.replace( /\/$/, '' ); this.fetch = fetch; this.createId = createId;
		this.storage = 'cloud'; this.listeners = new Set(); this.assets = new Map(); this.pending = new Map(); this.pendingCreates = new Map();
		try {

			this.channel = channelFactory( 'RayzeeCloudPresetLibrary:changes' );
			if ( this.channel ) this.channel.onmessage = event => {

				if ( event.data?.type === 'changed' && typeof event.data.presetId === 'string' && revision( event.data.revision ) ) this.notify( event.data, false );

			};

		} catch { /* Focus refresh remains available when channels are disabled. */ }

	}

	async init() {

		return this;

	}
	subscribe( listener ) {

		if ( typeof listener !== 'function' ) throw new TypeError( 'A preset change listener is required.' );
		this.listeners.add( listener ); return () => this.listeners.delete( listener );

	}
	notify( event, broadcast = true ) {

		for ( const listener of this.listeners ) {

			try {

				listener( clone( event ) );

			} catch { /* Subscriber errors cannot reverse a committed save. */ }

		}

		if ( broadcast ) {

			try {

				this.channel?.postMessage( event );

			} catch { /* A student focus refresh still sees the shared head. */ }

		}

	}
	remember( record ) {

		for ( const asset of Object.values( record.studentPreset.assets ) ) {

			const key = assetVersionKey( asset ), existing = this.assets.get( key );
			if ( existing && ! same( existing, asset ) ) throw new CloudPresetRepositoryError( 'INVALID_RESPONSE' );
			this.assets.set( key, clone( asset ) );

		}

		return record;

	}
	async request( path, options = {}, allowMissing = false ) {

		let response;
		try {

			response = await this.fetch( `${this.baseURL}${path}`, { ...options, headers: { Accept: 'application/json', ...options.headers }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' } );

		} catch {

			throw new CloudPresetRepositoryError( 'NETWORK', { retryable: true } );

		}

		if ( [ 200, 201 ].includes( response.status ) || ( allowMissing && response.status === 404 ) ) return response;
		await response.body?.cancel().catch( () => {} );
		const status = response.status;
		throw new CloudPresetRepositoryError( status === 401 || status === 403 ? 'AUTHORIZATION' : status === 409 || status === 412 ? 'REVISION_CONFLICT' : status >= 500 ? 'SERVER' : 'REJECTED', { status, retryable: status === 429 || status >= 500 } );

	}
	async hydrateThumbnail( record ) {

		this.remember( record );
		if ( record.studentPreset.thumbnail ) record.thumbnail = await this.getAsset( record.studentPreset.thumbnail );
		return record;

	}
	async list() {

		const value = await readJSON( await this.request( '/v1/admin/preset-editor?summary=1', { method: 'GET' } ), MAX_LIST_BYTES );
		if ( ! value || Object.keys( value ).join() !== 'presets' || ! Array.isArray( value.presets ) || value.presets.length > 1024 ) throw new CloudPresetRepositoryError( 'INVALID_RESPONSE' );
		const seen = new Set();
		for ( const record of value.presets ) {

			try {

				if ( ! record || Object.keys( record ).sort().join() !== 'createdAt,name,presetId,revision,thumbnailAsset,updatedAt' || ! revision( record.revision ) || typeof record.name !== 'string' || ! record.name.trim() || record.name.length > 1024 || ! Number.isFinite( Date.parse( record.createdAt ) ) || ! Number.isFinite( Date.parse( record.updatedAt ) ) ) throw new Error();
				validateCatalogueId( record.presetId );
				if ( record.thumbnailAsset !== null ) {

					validateStudentLibraryAsset( record.thumbnailAsset );
					if ( record.thumbnailAsset.kind !== 'image' ) throw new Error();
					const key = assetVersionKey( record.thumbnailAsset ), existing = this.assets.get( key );
					if ( existing && ! same( existing, record.thumbnailAsset ) ) throw new Error();
					this.assets.set( key, clone( record.thumbnailAsset ) );

				}

			} catch {

				throw new CloudPresetRepositoryError( 'INVALID_RESPONSE' );

			}

			if ( seen.has( record.presetId ) ) throw new CloudPresetRepositoryError( 'INVALID_RESPONSE' );
			seen.add( record.presetId );

		}

		const rows = [];
		for ( const record of value.presets ) rows.push( { ...record, thumbnail: record.thumbnailAsset ? await this.getAsset( record.thumbnailAsset ) : null } );
		return rows.sort( ( left, right ) => right.updatedAt.localeCompare( left.updatedAt ) || left.name.localeCompare( right.name ) );

	}
	async get( presetId, { revision: requestedRevision } = {} ) {

		validateCatalogueId( presetId );
		if ( requestedRevision !== undefined && ! revision( requestedRevision ) ) throw new TypeError( 'A nonnegative preset revision is required.' );
		const response = await this.request( `/v1/admin/preset-editor/${encodeURIComponent( presetId )}`, { method: 'GET' }, true );
		if ( response.status === 404 ) {

			await response.body?.cancel().catch( () => {} ); return null;

		}

		const record = validateRecord( await readJSON( response, MAX_RECORD_BYTES ) );
		if ( record.presetId !== presetId || ( requestedRevision !== undefined && record.revision !== requestedRevision ) || ! matchesRevisionETag( response, record.revision ) ) throw new CloudPresetRepositoryError( 'INVALID_RESPONSE' );
		return this.hydrateThumbnail( record );

	}
	async getAssetMetadata( reference ) {

		validateCatalogueId( reference?.assetId ); validateCatalogueId( reference?.version );
		const key = assetVersionKey( reference );
		if ( ! this.assets.has( key ) ) {

			const rows = await this.list();
			for ( const row of rows ) {

				if ( this.assets.has( key ) ) break;
				await this.get( row.presetId );

			}

		}

		return this.assets.has( key ) ? clone( this.assets.get( key ) ) : null;

	}
	async getAssetRecord( reference ) {

		const asset = await this.getAssetMetadata( reference );
		if ( ! asset ) return null;
		const bytes = await this.student.getAssetBytes( asset );
		return { asset: clone( asset ), blob: new Blob( [ bytes ], { type: asset.mimeType } ) };

	}
	async getAsset( reference ) {

		return ( await this.getAssetRecord( reference ) )?.blob || null;

	}
	getScene( reference ) {

		return this.student.getScene( reference );

	}
	async save( input, { expectedRevision } = {} ) {

		expected( expectedRevision );
		const createIdentity = expectedRevision === null && ! input.presetId ? await hash( new TextEncoder().encode( serializeStudentCatalogueContent( { name: input.name, adminDocument: input.adminDocument, studentPreset: input.studentPreset, thumbnail: input.thumbnail instanceof Blob ? await hash( await input.thumbnail.arrayBuffer() ) : null } ) ) ) : null;
		const presetId = validateCatalogueId( input.presetId || this.pendingCreates.get( createIdentity ) || this.createId() );
		if ( createIdentity ) this.pendingCreates.set( createIdentity, presetId );
		if ( typeof input.name !== 'string' || ! input.name.trim() || input.name.trim().length > 1024 ) throw new TypeError( 'A preset name up to 1024 characters is required.' );
		const name = input.name.trim(), nextRevision = ( expectedRevision ?? - 1 ) + 1;
		const adminDocument = migrateProjectDocument( input.adminDocument );
		const studentPreset = clone( { ...input.studentPreset, presetId, version: String( nextRevision + 1 ), name } );
		if ( ! Array.isArray( input.assetBlobs ?? [] ) ) throw new TypeError( 'Preset asset bytes must be an array.' );
		const uploads = new Map();
		for ( const entry of input.assetBlobs || [] ) {

			validateStudentLibraryAsset( entry.asset );
			if ( ! ( entry.blob instanceof Blob ) || entry.blob.size !== entry.asset.byteLength ) throw new Error( 'Preset asset bytes do not match their declared length.' );
			const key = assetVersionKey( entry.asset );
			if ( uploads.has( key ) && ! same( uploads.get( key ).asset, entry.asset ) ) throw new Error( 'An immutable preset asset has conflicting metadata.' );
			uploads.set( key, { asset: clone( entry.asset ), blob: entry.blob } );

		}

		if ( input.thumbnail !== undefined && input.thumbnail !== null ) {

			const thumbnail = input.thumbnail;
			if ( ! ( thumbnail instanceof Blob ) || ! [ 'image/png', 'image/jpeg', 'image/webp' ].includes( thumbnail.type ) || thumbnail.size < 1 || thumbnail.size > 1024 * 1024 ) throw new TypeError( 'A PNG, JPEG or WebP thumbnail up to 1 MiB is required.' );
			const sha256 = await hash( await thumbnail.arrayBuffer() );
			const asset = { assetId: `thumbnail-${sha256}`, version: '1', kind: 'image', sha256, byteLength: thumbnail.size, mimeType: thumbnail.type, durationUs: null };
			studentPreset.assets = { ...studentPreset.assets, [ assetVersionKey( asset ) ]: asset };
			studentPreset.thumbnail = { assetId: asset.assetId, version: asset.version };
			uploads.set( assetVersionKey( asset ), { asset, blob: thumbnail } );

		}

		validateStudentPresetVersion( studentPreset );
		for ( const [ key, entry ] of uploads ) if ( ! studentPreset.assets[ key ] || ! same( studentPreset.assets[ key ], entry.asset ) ) throw new Error( 'Preset asset bytes require matching portable metadata.' );
		const body = serializeStudentCatalogueContent( { name, adminDocument, studentPreset } );
		if ( new TextEncoder().encode( body ).byteLength > MAX_RECORD_BYTES ) throw new Error( 'This preset exceeds the shared library record size limit.' );
		const operationKey = `${presetId}:${expectedRevision}:${await hash( new TextEncoder().encode( body ) )}`;
		const requestId = this.pending.get( operationKey ) || this.createId();
		this.pending.set( operationKey, requestId );
		// Byte uploads are content-addressed and idempotent. D1 changes only after
		// all R2 objects have passed the existing upload/integrity preflight.
		for ( const { asset, blob } of uploads.values() ) await this.catalogue.uploadAsset( asset, await blob.arrayBuffer() );
		const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': requestId, ...( expectedRevision === null ? { 'If-None-Match': '*' } : { 'If-Match': `"${expectedRevision}"` } ) };
		const response = await this.request( `/v1/admin/preset-editor/${encodeURIComponent( presetId )}`, { method: 'PUT', headers, body } );
		const saved = validateRecord( await readJSON( response, MAX_RECORD_BYTES ) );
		if ( saved.presetId !== presetId || saved.revision !== nextRevision || saved.name !== name || ! same( saved.studentPreset, studentPreset ) || ! same( saved.adminDocument, adminDocument ) || ! matchesRevisionETag( response, saved.revision ) ) throw new CloudPresetRepositoryError( 'INVALID_RESPONSE' );
		this.pending.delete( operationKey );
		if ( createIdentity ) this.pendingCreates.delete( createIdentity );
		this.remember( saved );
		saved.thumbnail = input.thumbnail ?? ( studentPreset.thumbnail ? await this.getAsset( studentPreset.thumbnail ) : null );
		this.notify( { type: 'changed', presetId, revision: saved.revision } );
		return clone( saved );

	}
	async rename( presetId, name, { expectedRevision } = {} ) {

		expected( expectedRevision );
		const current = await this.get( presetId );
		if ( ! current || current.revision !== expectedRevision ) throw new CloudPresetRepositoryError( 'REVISION_CONFLICT' );
		return this.save( { ...current, name }, { expectedRevision } );

	}
	async remove( presetId, { expectedRevision } = {} ) {

		expected( expectedRevision );
		if ( expectedRevision === null ) throw new TypeError( 'Removing a preset requires its current revision.' );
		const current = await this.get( presetId );
		if ( ! current || current.revision !== expectedRevision ) throw new CloudPresetRepositoryError( 'REVISION_CONFLICT' );
		const operationKey = `remove:${presetId}:${expectedRevision}`;
		const requestId = this.pending.get( operationKey ) || this.createId();
		this.pending.set( operationKey, requestId );
		const operation = this.catalogue.prepareAvailability( { presetId, version: current.studentPreset.version, available: false, headRevision: expectedRevision, requestId } );
		await this.catalogue.setAvailability( operation );
		this.pending.delete( operationKey );
		this.notify( { type: 'changed', presetId, revision: expectedRevision + 1 } );

	}
	close() {

		this.channel?.close(); this.listeners.clear(); this.assets.clear(); this.pending.clear(); this.pendingCreates.clear();

	}

}
