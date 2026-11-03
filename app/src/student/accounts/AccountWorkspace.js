import { StudentProjectRepository, accountDatabaseName } from '../../previs/persistence/StudentProjectRepository.js';
import { importStudentProjectDocument } from '../../previs/domain/StudentProjectSchema.js';
import { LocalNarrationStore } from '../editor/LocalNarration.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const accountNarrationDatabaseName = userId => `${accountDatabaseName( userId )}:narration`;
export const accountSelectionKey = userId => `${accountDatabaseName( userId )}:selected-project`;

/** An identity is persisted only after a successful server validation. */
export class ValidatedIdentityRegistry {

	constructor( { databaseFactory = globalThis.indexedDB, databaseName = 'RayzeeStudentIdentityDB' } = {} ) {

		this.databaseFactory = databaseFactory; this.databaseName = databaseName;

	}
	async database() {

		this.connection ||= new Promise( ( resolve, reject ) => {

			let abandoned = false;
			const request = this.databaseFactory.open( this.databaseName, 1 );
			request.onupgradeneeded = () => request.result.createObjectStore( 'identities', { keyPath: 'userId' } );
			request.onsuccess = () => {

				if ( abandoned ) {

					request.result.close(); return;

				}

				request.result.onversionchange = () => {

					request.result.close(); this.connection = null;

				};

				resolve( request.result );

			};

			request.onerror = () => {

				this.connection = null; reject( request.error );

			};

			request.onblocked = () => {

				abandoned = true; this.connection = null; reject( new Error( 'Identity storage is blocked.' ) );

			};

		} );
		return this.connection;

	}
	async writeValidated( { userId, credential, accessGeneration } ) {

		if ( ! UUID.test( userId || '' ) || ! UUID.test( credential || '' ) || ! Number.isSafeInteger( accessGeneration ) || accessGeneration < 1 ) throw new TypeError( 'Validated identity is required.' );
		const db = await this.database();
		return new Promise( ( resolve, reject ) => {

			const tx = db.transaction( 'identities', 'readwrite' );
			tx.objectStore( 'identities' ).put( { userId, credential, accessGeneration } );
			tx.objectStore( 'identities' ).put( { userId: '__active__', activeUserId: userId } );
			tx.oncomplete = () => resolve(); tx.onabort = () => reject( tx.error );

		} );

	}
	async get( userId ) {

		const db = await this.database();
		return new Promise( ( resolve, reject ) => {

			const request = db.transaction( 'identities', 'readonly' ).objectStore( 'identities' ).get( userId );
			request.onsuccess = () => resolve( request.result || null ); request.onerror = () => reject( request.error );

		} );

	}
	async list() {

		const db = await this.database();
		return new Promise( ( resolve, reject ) => {

			const request = db.transaction( 'identities', 'readonly' ).objectStore( 'identities' ).getAll();
			request.onsuccess = () => resolve( request.result.filter( row => row.userId !== '__active__' ) ); request.onerror = () => reject( request.error );

		} );

	}
	async active() {

		const marker = await this.get( '__active__' );
		return marker ? this.get( marker.activeUserId ) : null;

	}
	async close() {

		if ( this.connection ) ( await this.connection ).close(); this.connection = null;

	}

}

/** Switches invalidate callbacks immediately, before any asynchronous teardown. */
export class AccountWorkspace {

	constructor( { databaseFactory = globalThis.indexedDB, storage = globalThis.localStorage } = {} ) {

		this.databaseFactory = databaseFactory; this.storage = storage; this.epoch = 0; this.current = null; this.teardown = Promise.resolve();

	}
	async switchAccount( userId, { stop = async () => {} } = {} ) {

		const databaseName = accountDatabaseName( userId );
		const previous = this.current; const epoch = ++ this.epoch;
		previous?.controller.abort(); this.current = null;
		if ( previous ) this.teardown = this.teardown.then( async () => {

			try {

				await previous.stop();

			} finally {

				previous.repository.deactivate(); previous.narration.deactivate();

			}

		} );
		await this.teardown;
		if ( epoch !== this.epoch ) return null;
		const workspace = { userId, epoch, controller: new AbortController(), stop,
			repository: new StudentProjectRepository( { databaseFactory: this.databaseFactory, databaseName } ),
			narration: new LocalNarrationStore( { databaseFactory: this.databaseFactory, databaseName: accountNarrationDatabaseName( userId ) } ) };
		this.current = workspace;
		return workspace;

	}
	isCurrent( workspace ) {

		return !! workspace && this.current === workspace && workspace.epoch === this.epoch && ! workspace.controller.signal.aborted;

	}
	guard( workspace, callback ) {

		return ( ...args ) => this.isCurrent( workspace ) ? callback( ...args ) : undefined;

	}
	selected( workspace ) {

		if ( ! this.isCurrent( workspace ) ) return null; return this.storage.getItem( accountSelectionKey( workspace.userId ) );

	}
	select( workspace, projectId ) {

		if ( ! this.isCurrent( workspace ) ) return false; this.storage.setItem( accountSelectionKey( workspace.userId ), projectId ); return true;

	}
	async close() {

		const previous = this.current; ++ this.epoch; this.current = null; previous?.controller.abort();
		if ( previous ) this.teardown = this.teardown.then( async () => {

			try {

				await previous.stop();

			} finally {

				previous.repository.deactivate(); previous.narration.deactivate();

			}

		} );
		await this.teardown;

	}
	/** Explicitly copy a legacy project and its verified recordings; never change the source. */
	async importLegacy( workspace, projectId, { legacyRepository = new StudentProjectRepository( { databaseFactory: this.databaseFactory } ), legacyNarration = new LocalNarrationStore( { databaseFactory: this.databaseFactory } ), newProjectId = globalThis.crypto.randomUUID() } = {} ) {

		if ( ! this.isCurrent( workspace ) ) throw new Error( 'Account session changed.' );
		const original = await legacyRepository.get( projectId );
		if ( ! original ) throw new Error( 'Legacy project not found.' );
		const document = importStudentProjectDocument( original, { projectId: newProjectId } );
		for ( const asset of Object.values( document.narration.assets ) ) {

			const row = await legacyNarration.get( asset.assetId );
			if ( ! row?.blob || row.blob.size !== asset.byteLength ) throw new Error( 'Legacy narration is unavailable.' );
			const digest = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await row.blob.arrayBuffer() ) ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			if ( digest !== asset.sha256 ) throw new Error( 'Legacy narration failed its integrity check.' );
			if ( ! this.isCurrent( workspace ) ) throw new Error( 'Account session changed.' );
			const existing = await workspace.narration.get( asset.assetId );
			if ( existing && ( ! existing.blob || existing.blob.size !== asset.byteLength || Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await existing.blob.arrayBuffer() ) ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' ) !== asset.sha256 ) ) throw new Error( 'A different recording already uses this asset ID.' );
			if ( ! this.isCurrent( workspace ) ) throw new Error( 'Account session changed.' );
			if ( ! existing ) await workspace.narration.put( { ...row, projectId: newProjectId } );

		}

		if ( ! this.isCurrent( workspace ) ) throw new Error( 'Account session changed.' );
		return workspace.repository.save( document, { expectedRevision: null } );

	}

}
