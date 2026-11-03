import {
	migrateStudentProjectDocument,
	importStudentProjectDocument,
	prepareStudentProjectExport,
} from '../domain/StudentProjectSchema.js';

export const STUDENT_DATABASE_NAME = 'RayzeeStudentDB';
export const STUDENT_DATABASE_VERSION = 1;
const STORES = [ 'projects', 'revisions', 'outbox', 'sync', 'recoveries' ];

/** Account databases never alias the unassigned pre-account database. */
export function accountDatabaseName( userId ) {

	if ( typeof userId !== 'string' || ! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test( userId ) ) throw new TypeError( 'A canonical account UUID is required.' );
	return `${STUDENT_DATABASE_NAME}:account:v1:${userId}`;

}

export class StudentStorageError extends Error {

	constructor( code, message, cause ) {

		super( message, { cause } );
		this.name = 'StudentStorageError';
		this.code = code;

	}

}

export class StudentRevisionConflict extends Error {

	constructor( { recoveryId, expectedRevision, latestDocument } ) {

		super( 'This project changed in another editor. Your attempted save was preserved as a recovery copy.' );
		this.name = 'StudentRevisionConflict';
		this.code = 'REVISION_CONFLICT';
		this.recoveryId = recoveryId;
		this.expectedRevision = expectedRevision;
		this.latestDocument = latestDocument;

	}

}

function storageError( error ) {

	if ( error instanceof StudentStorageError ) return error;
	if ( error?.name === 'VersionError' ) return new StudentStorageError( 'VERSION_CHANGED', 'Device storage belongs to a newer editor. Open the latest application before editing.', error );
	if ( error?.name === 'SecurityError' ) return new StudentStorageError( 'UNAVAILABLE', 'Browser settings prevent device storage. The project was not saved.', error );
	const quota = error?.name === 'QuotaExceededError';
	return new StudentStorageError( quota ? 'QUOTA_EXCEEDED' : 'TRANSACTION_FAILED',
		quota ? 'Device storage is full. The project was not saved.' : 'Device storage could not save or read this project.', error );

}

/** No network work belongs inside this transaction: IndexedDB may auto-commit. */
function transact( db, names, mode, operation ) {

	return new Promise( ( resolve, reject ) => {

		let tx;
		let result;
		let failure;
		try {

			tx = db.transaction( names, mode );
			tx.oncomplete = () => resolve( result );
			tx.onabort = () => reject( failure || storageError( tx.error ) );
			tx.onerror = event => {

				failure ||= storageError( event.target.error || tx.error );

			};

			const stores = Object.fromEntries( names.map( name => [ name, tx.objectStore( name ) ] ) );
			const context = {
				setResult: value => {

					result = value;

				},
				request: ( request, callback ) => {

					request.onsuccess = () => {

						try {

							callback( request.result );

						} catch ( error ) {

							failure = storageError( error );
							try {

								tx.abort();

							} catch { /* Transaction may already have aborted. */ }

						}

					};

				},
			};
			operation( stores, context );

		} catch ( error ) {

			failure = storageError( error );
			if ( tx ) {

				try {

					tx.abort();

				} catch {

					reject( failure );

				}

			} else reject( failure );

		}

	} );

}

export class StudentProjectRepository {

	constructor( {
		databaseFactory = globalThis.indexedDB,
		databaseName = STUDENT_DATABASE_NAME,
		onStorageEvent = () => {},
		now = () => new Date().toISOString(),
		createId = () => globalThis.crypto.randomUUID(),
	} = {} ) {

		this.databaseFactory = databaseFactory;
		this.databaseName = databaseName;
		this.onStorageEvent = onStorageEvent;
		this.now = now;
		this.createId = createId;
		this.dbPromise = null;
		this.connection = null;
		this.invalidated = false;
		this.commitListeners = new Set();

	}

	async init() {

		if ( this.invalidated ) throw new StudentStorageError( 'VERSION_CHANGED', 'A newer editor changed device storage. Reload before editing.' );
		if ( ! this.databaseFactory ) throw new StudentStorageError( 'UNAVAILABLE', 'IndexedDB is unavailable. Device saving is unavailable.' );
		if ( this.dbPromise ) return this.dbPromise;
		this.dbPromise = new Promise( ( resolve, reject ) => {

			let abandoned = false;
			const request = this.databaseFactory.open( this.databaseName, STUDENT_DATABASE_VERSION );
			request.onupgradeneeded = () => {

				const db = request.result;
				for ( const name of STORES ) {

					if ( db.objectStoreNames.contains( name ) ) continue;
					const keyPath = [ 'revisions', 'outbox' ].includes( name ) ? [ 'projectId', 'revision' ] : name === 'recoveries' ? 'recoveryId' : 'projectId';
					const store = db.createObjectStore( name, { keyPath } );
					if ( [ 'revisions', 'outbox', 'recoveries' ].includes( name ) ) store.createIndex( 'projectId', 'projectId' );

				}

			};

			request.onblocked = () => {

				abandoned = true;
				const error = new StudentStorageError( 'BLOCKED', 'Another tab is blocking device storage setup. Close older editor tabs and retry.' );
				this.onStorageEvent( { type: 'blocked', error } );
				reject( error );

			};

			request.onerror = () => reject( storageError( request.error ) );
			request.onsuccess = () => {

				const db = request.result;
				if ( abandoned || this.invalidated ) {

					db.close();
					if ( ! abandoned ) reject( new StudentStorageError( 'VERSION_CHANGED', 'This account session is closed.' ) );
					return;

				}

				this.connection = db;
				db.onversionchange = () => {

					this.invalidated = true;
					this.connection = null;
					db.close();
					this.onStorageEvent( { type: 'versionchange' } );

				};

				db.onclose = () => {

					this.connection = null;
					this.dbPromise = null;
					this.onStorageEvent( { type: 'closed' } );

				};

				resolve( db );

			};

		} );
		try {

			return await this.dbPromise;

		} catch ( error ) {

			this.dbPromise = null;
			throw storageError( error );

		}

	}

	close() {

		this.connection?.close();
		this.connection = null;
		this.dbPromise = null;

	}

	/** Permanently fence callbacks holding a repository from an old account session. */
	deactivate() {

		this.invalidated = true;
		this.close();

	}

	async get( projectId ) {

		const db = await this.init();
		return transact( db, [ 'projects' ], 'readonly', ( stores, { request, setResult } ) => {

			request( stores.projects.get( projectId ), row => setResult( row ? migrateStudentProjectDocument( row.document ) : null ) );

		} );

	}

	async list() {

		const db = await this.init();
		return transact( db, [ 'projects' ], 'readonly', ( stores, { request, setResult } ) => {

			request( stores.projects.getAll(), rows => setResult( rows.map( row => migrateStudentProjectDocument( row.document ) ) ) );

		} );

	}

	/** Keep account summaries separate from portable documents. */
	async accountSummaries() {

		const db = await this.init();
		return transact( db, [ 'sync' ], 'readonly', ( stores, { request, setResult } ) => {

			request( stores.sync.getAll(), rows => setResult( rows.filter( row => row.summary ).map( row => row.summary ) ) );

		} );

	}

	/** The server-verified immutable default is kept outside portable projects. */
	async cacheAccountDefault( version ) {

		if ( ! version || typeof version.versionId !== 'string' || ! Number.isSafeInteger( version.pointerRevision ) || version.pointerRevision < 0 ) throw new TypeError( 'A pinned default version is required.' );
		const document = migrateStudentProjectDocument( version.document );
		const db = await this.init();
		return transact( db, [ 'sync' ], 'readwrite', ( stores, { request } ) => {

			request( stores.sync.get( '__account_default__' ), row => {

				if ( row?.defaultVersion?.pointerRevision > version.pointerRevision ) return;
				if ( row?.defaultVersion?.pointerRevision === version.pointerRevision && row.defaultVersion.versionId !== version.versionId ) throw new Error( 'Default pointer mismatch.' );
				stores.sync.put( { projectId: '__account_default__', defaultVersion: { versionId: version.versionId, pointerRevision: version.pointerRevision, document } } );

			} );

		} );

	}
	async accountDefault() {

		const db = await this.init();
		return transact( db, [ 'sync' ], 'readonly', ( stores, { request, setResult } ) => {

			request( stores.sync.get( '__account_default__' ), row => setResult( row?.defaultVersion || null ) );

		} );

	}

	async rememberAccountSummary( summary ) {

		if ( ! summary || typeof summary.projectId !== 'string' || ! Number.isSafeInteger( summary.metadataRevision ) || summary.metadataRevision < 0 || typeof summary.name !== 'string' || typeof summary.archived !== 'boolean' ) throw new TypeError( 'Invalid project summary.' );
		const db = await this.init();
		return transact( db, [ 'sync' ], 'readwrite', ( stores, { request } ) => {

			request( stores.sync.get( summary.projectId ), state => {

				if ( state?.metadataRevision != null && summary.metadataRevision < state.metadataRevision ) return;
				const localSummary = { ...summary };
				for ( const operation of state?.metadataQueue || [] ) Object.assign( localSummary, operation.patch );
				stores.sync.put( { ...state, projectId: summary.projectId, metadataRevision: summary.metadataRevision, summary: localSummary } );

			} );

		} );

	}

	/** Install a cloud head and its acknowledged baseline atomically, without an outbox edit. */
	async adoptRemoteHead( document, { serverRevision } = {} ) {

		const remote = migrateStudentProjectDocument( document );
		if ( ! Number.isSafeInteger( serverRevision ) || serverRevision < 0 ) throw new TypeError( 'A non-negative server revision is required.' );
		const db = await this.init();
		return transact( db, STORES, 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.projects.get( remote.projectId ), current => request( stores.sync.get( remote.projectId ), state => request( stores.outbox.index( 'projectId' ).getAll( remote.projectId ), pending => {

				if ( state?.serverRevision != null && serverRevision < state.serverRevision ) {

					setResult( { adopted: false, reason: 'STALE_REMOTE' } ); return;

				}

				if ( pending.length || state?.inFlight || state?.conflict ) {

					const recoveryId = this.createId();
					stores.recoveries.add( { recoveryId, projectId: remote.projectId, document: remote, serverRevision, reason: 'REMOTE_HEAD', createdAt: this.now() } );
					setResult( { adopted: false, reason: 'DIRTY_LOCAL', recoveryId } ); return;

				}

				if ( state?.serverRevision === serverRevision && current && JSON.stringify( current.document ) !== JSON.stringify( remote ) ) {

					const recoveryId = this.createId();
					stores.recoveries.add( { recoveryId, projectId: remote.projectId, document: remote, serverRevision, reason: 'REMOTE_HEAD_MISMATCH', createdAt: this.now() } );
					setResult( { adopted: false, reason: 'HEAD_MISMATCH', recoveryId } ); return;

				}

				request( stores.revisions.get( [ remote.projectId, remote.revision ] ), existing => {

					if ( existing && JSON.stringify( existing.document ) !== JSON.stringify( remote ) ) stores.recoveries.add( { recoveryId: this.createId(), projectId: remote.projectId, document: existing.document, reason: 'REPLACED_LOCAL_BASELINE', createdAt: this.now() } );
					const savedAt = this.now();
					stores.projects.put( { projectId: remote.projectId, document: remote, savedAt } );
					stores.revisions.put( { projectId: remote.projectId, revision: remote.revision, document: remote, savedAt } );
					stores.sync.put( { ...state, projectId: remote.projectId, serverRevision, acknowledgedRevision: remote.revision, lastSyncedAt: savedAt, inFlight: null, retry: null } );
					setResult( { adopted: true } );

				} );

			} ) ) );

		} );

	}

	/** Resolve an explicit conflict by opening cloud; the durable recovery remains. */
	async acceptRemoteConflict( document, { serverRevision, recoveryId } ) {

		const remote = migrateStudentProjectDocument( document );
		if ( ! Number.isSafeInteger( serverRevision ) || serverRevision < 0 || typeof recoveryId !== 'string' ) throw new TypeError( 'Invalid cloud conflict resolution.' );
		const db = await this.init();
		return transact( db, STORES, 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.sync.get( remote.projectId ), state => {

				if ( state?.conflict?.recoveryId !== recoveryId || ( state.serverRevision != null && serverRevision < state.serverRevision ) ) throw new Error( 'The conflict changed. Refresh and retry.' );
				request( stores.projects.get( remote.projectId ), current => request( stores.recoveries.get( recoveryId ), recovery => {

					if ( ! recovery || recovery.projectId !== remote.projectId ) throw new Error( 'The local recovery copy is unavailable.' );
					if ( current?.document.revision !== state.conflict.revision ) throw new Error( 'Local work changed. Preserve it before reopening cloud.' );
					request( stores.outbox.index( 'projectId' ).getAll( remote.projectId ), pending => request( stores.revisions.get( [ remote.projectId, remote.revision ] ), existing => {

						for ( const item of pending ) stores.outbox.delete( [ item.projectId, item.revision ] );
						if ( existing && JSON.stringify( existing.document ) !== JSON.stringify( remote ) ) stores.recoveries.add( { recoveryId: this.createId(), projectId: remote.projectId, document: existing.document, reason: 'REPLACED_LOCAL_BASELINE', createdAt: this.now() } );
						const savedAt = this.now();
						stores.projects.put( { projectId: remote.projectId, document: remote, savedAt } );
						stores.revisions.put( { projectId: remote.projectId, revision: remote.revision, document: remote, savedAt } );
						stores.sync.put( { ...state, serverRevision, acknowledgedRevision: remote.revision, inFlight: null, retry: null, conflict: null, metadataQueue: [], metadataRetry: null } );
						setResult( remote );

					} ) );

				} ) );

			} );

		} );

	}

	/** New documents require expectedRevision:null and revision:0. Saves require the next integer revision. */
	async save( document, { expectedRevision, metadataOperation } = {} ) {

		const next = migrateStudentProjectDocument( document );
		if ( expectedRevision !== null && ( ! Number.isSafeInteger( expectedRevision ) || expectedRevision < 0 ) ) throw new TypeError( 'An explicit expectedRevision (null for a new project) is required.' );
		if ( next.revision !== ( expectedRevision === null ? 0 : expectedRevision + 1 ) ) throw new TypeError( 'The document revision must be the expected revision plus one (zero for a new project).' );
		if ( metadataOperation && ( typeof metadataOperation.requestId !== 'string' || ! metadataOperation.requestId || typeof metadataOperation.name !== 'string' || ! metadataOperation.name.trim() ) ) throw new TypeError( 'Invalid metadata operation.' );
		const db = await this.init();
		const result = await transact( db, STORES, 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.projects.get( next.projectId ), current => {

				const actualRevision = current?.document.revision ?? null;
				if ( actualRevision !== expectedRevision ) {

					const recoveryId = this.createId();
					stores.recoveries.add( { recoveryId, projectId: next.projectId, document: next, expectedRevision, actualRevision, createdAt: this.now() } );
					setResult( { conflict: { recoveryId, expectedRevision, latestDocument: current?.document ?? null } } );
					return;

				}

				const savedAt = this.now();
				stores.projects.put( { projectId: next.projectId, document: next, savedAt } );
				stores.revisions.add( { projectId: next.projectId, revision: next.revision, document: next, savedAt } );
				stores.outbox.add( { projectId: next.projectId, revision: next.revision, requestId: `${next.projectId}:${next.revision}`, createdAt: savedAt } );
				if ( expectedRevision === null ) stores.sync.add( { projectId: next.projectId, acknowledgedRevision: null } );
				else if ( metadataOperation ) request( stores.sync.get( next.projectId ), state => {

					const queue = state?.metadataQueue || [];
					const revision = ( state?.metadataRevision ?? 0 ) + queue.length;
					const operation = { requestId: metadataOperation.requestId, expectedMetadataRevision: revision, patch: { name: metadataOperation.name.trim() } };
					stores.sync.put( { ...state, projectId: next.projectId, metadataQueue: [ ...queue, operation ], summary: { ...( state?.summary || { projectId: next.projectId, archived: false } ), name: operation.patch.name, updatedAt: next.updatedAt } } );

				} );
				setResult( { document: next } );

			} );

		} );
		if ( result.conflict ) throw new StudentRevisionConflict( result.conflict );
		for ( const listener of this.commitListeners ) {

			try {

				listener( next.projectId );

			} catch { /* Observers cannot undo a committed save. */ }

		}

		return result.document;

	}

	subscribeCommits( listener ) {

		this.commitListeners.add( listener ); return () => this.commitListeners.delete( listener );

	}

	/** Freeze the latest local revision, retaining its stable outbox request across retries. */
	async prepareAccountBackup( projectId ) {

		const db = await this.init();
		return transact( db, [ 'projects', 'revisions', 'outbox', 'sync' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.sync.get( projectId ), state => {

				if ( ! state || state.conflict ) {

					setResult( null ); return;

				}

				const load = flight => request( stores.revisions.get( [ projectId, flight.revision ] ), row => {

					if ( ! row ) throw new Error( 'Frozen account revision is unavailable.' );
					setResult( { ...state, inFlight: flight, document: row.document } );

				} );
				if ( state.inFlight ) {

					load( state.inFlight ); return;

				}

				request( stores.projects.get( projectId ), row => {

					const revision = row?.document.revision;
					if ( revision == null || revision <= ( state.acknowledgedRevision ?? - 1 ) ) {

						setResult( null ); return;

					}

					request( stores.outbox.get( [ projectId, revision ] ), item => {

						if ( ! item ) {

							setResult( null ); return;

						}

						const flight = { kind: state.serverRevision == null ? 'create' : 'update', revision, requestId: item.requestId, expectedServerRevision: state.serverRevision ?? null };
						stores.sync.put( { ...state, inFlight: flight, retry: null } ); load( flight );

					} );

				} );

			} );

		} );

	}

	async acknowledgeAccountBackup( projectId, acknowledgement ) {

		const { revision, requestId, serverRevision, dependenciesVerified } = acknowledgement;
		if ( ! Number.isSafeInteger( revision ) || revision < 0 || ! Number.isSafeInteger( serverRevision ) || serverRevision < 0 || dependenciesVerified !== true ) throw new TypeError( 'Exact verified acknowledgement required.' );
		const db = await this.init();
		return transact( db, [ 'sync', 'outbox' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.sync.get( projectId ), state => {

				const flight = state?.inFlight;
				if ( ! flight || flight.requestId !== requestId || flight.revision !== revision || serverRevision !== ( flight.expectedServerRevision ?? - 1 ) + 1 ) {

					setResult( false ); return;

				}

				request( stores.outbox.index( 'projectId' ).getAll( projectId ), items => {

					if ( ! items.some( item => item.revision === revision && item.requestId === requestId ) ) {

						setResult( false ); return;

					}

					for ( const item of items ) if ( item.revision <= revision ) stores.outbox.delete( [ projectId, item.revision ] );
					stores.sync.put( { ...state, serverRevision, acknowledgedRevision: revision, lastSyncedAt: this.now(), inFlight: null, retry: null } ); setResult( true );

				} );

			} );

		} );

	}

	async getRevision( projectId, revision ) {

		const db = await this.init();
		return transact( db, [ 'revisions' ], 'readonly', ( stores, { request, setResult } ) => {

			request( stores.revisions.get( [ projectId, revision ] ), row => setResult( row ? migrateStudentProjectDocument( row.document ) : null ) );

		} );

	}

	async pending( projectId ) {

		const db = await this.init();
		return transact( db, [ 'outbox' ], 'readonly', ( stores, { request, setResult } ) => {

			request( stores.outbox.index( 'projectId' ).getAll( projectId ), rows => setResult( rows ) );

		} );

	}

	/** Metadata requests persist independently of document revisions. */
	async queueMetadata( projectId, operation ) {

		if ( ! operation || typeof operation.requestId !== 'string' || ! operation.requestId || ! Number.isSafeInteger( operation.expectedMetadataRevision ) || operation.expectedMetadataRevision < 0 || ! operation.patch || typeof operation.patch !== 'object' || Array.isArray( operation.patch ) || ! Object.keys( operation.patch ).length || Object.keys( operation.patch ).some( key => ! [ 'name', 'archived' ].includes( key ) ) || ( 'name' in operation.patch && ( typeof operation.patch.name !== 'string' || ! operation.patch.name.trim() ) ) || ( 'archived' in operation.patch && typeof operation.patch.archived !== 'boolean' ) ) throw new TypeError( 'A frozen metadata operation is required.' );
		const frozen = structuredClone( operation );
		const db = await this.init();
		const result = await transact( db, [ 'projects', 'sync' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.projects.get( projectId ), project => {

				if ( ! project ) throw new Error( 'Student project not found.' );
				request( stores.sync.get( projectId ), state => {

					const queue = state?.metadataQueue || [], existing = queue.find( item => item.requestId === frozen.requestId );
					if ( existing && JSON.stringify( existing ) !== JSON.stringify( frozen ) ) throw new Error( 'Metadata request identity was already used.' );
					if ( ! existing ) stores.sync.put( { ...state, projectId, metadataQueue: [ ...queue, frozen ], summary: { ...( state?.summary || { projectId, name: project.document.name, updatedAt: project.document.updatedAt, archived: false } ), ...frozen.patch } } );
					setResult( existing || frozen );

				} );

			} );

		} );
		for ( const listener of this.commitListeners ) {

			try {

				listener( projectId );

			} catch { /* Notification follows the durable commit. */ }

		}

		return result;

	}

	async acknowledgeMetadata( projectId, { requestId, metadataRevision } ) {

		if ( typeof requestId !== 'string' || ! Number.isSafeInteger( metadataRevision ) || metadataRevision < 0 ) throw new TypeError( 'An exact metadata acknowledgement is required.' );
		const db = await this.init();
		return transact( db, [ 'sync' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.sync.get( projectId ), state => {

				const queue = state?.metadataQueue || [], first = queue[ 0 ];
				if ( ! first || first.requestId !== requestId || metadataRevision !== first.expectedMetadataRevision + 1 ) {

					setResult( false ); return;

				}

				stores.sync.put( { ...state, metadataRevision, metadataQueue: queue.slice( 1 ), metadataRetry: null, summary: state.summary ? { ...state.summary, metadataRevision } : undefined } );
				setResult( true );

			} );

		} );

	}

	async recordMetadataRetry( projectId, requestId, retry ) {

		const db = await this.init();
		return transact( db, [ 'sync' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.sync.get( projectId ), state => {

				if ( state?.metadataQueue?.[ 0 ]?.requestId !== requestId ) {

					setResult( false ); return;

				}

				stores.sync.put( { ...state, metadataRetry: { ...retry, requestId } } ); setResult( true );

			} );

		} );

	}

	async preserveMetadataConflict( projectId, requestId ) {

		const db = await this.init();
		return transact( db, [ 'projects', 'sync', 'recoveries' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.sync.get( projectId ), state => {

				if ( state?.metadataQueue?.[ 0 ]?.requestId !== requestId ) {

					setResult( null ); return;

				}

				if ( state.conflict ) {

					setResult( state.conflict.recoveryId ); return;

				}

				request( stores.projects.get( projectId ), row => {

					if ( ! row ) throw new Error( 'Local project unavailable.' );
					const recoveryId = this.createId();
					stores.recoveries.add( { recoveryId, projectId, document: row.document, reason: 'METADATA_CONFLICT', createdAt: this.now() } );
					stores.sync.put( { ...state, conflict: { recoveryId, revision: row.document.revision }, metadataRetry: null } ); setResult( recoveryId );

				} );

			} );

		} );

	}

	/** Only a verified remote revision AND its media may be acknowledged. Removes that exact outbox item. */
	async acknowledge( projectId, { revision, requestId, dependenciesVerified } ) {

		if ( ! Number.isSafeInteger( revision ) || revision < 0 || typeof requestId !== 'string' || dependenciesVerified !== true ) throw new TypeError( 'An exact verified revision, requestId and dependenciesVerified:true are required.' );
		const db = await this.init();
		return transact( db, [ 'outbox', 'sync' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.outbox.get( [ projectId, revision ] ), item => {

				if ( ! item || item.requestId !== requestId ) {

					setResult( false );
					return;

				}

				request( stores.sync.get( projectId ), state => {

					stores.sync.put( { ...state, projectId, acknowledgedRevision: Math.max( state?.acknowledgedRevision ?? - 1, revision ) } );
					stores.outbox.delete( [ projectId, revision ] );
					setResult( true );

				} );

			} );

		} );

	}


	/** Private device state. Never include this record in a portable export or URL. */
	async backupState( projectId ) {

		const db = await this.init();
		return transact( db, [ 'sync' ], 'readonly', ( stores, { request, setResult } ) => {

			request( stores.sync.get( projectId ), state => setResult( state ?? null ) );

		} );

	}

	/** Commit capability + frozen request before sending. Concurrent callers reuse the same flight. */
	async prepareBackup( projectId, identity ) {

		const db = await this.init();
		return transact( db, [ 'projects', 'revisions', 'outbox', 'sync' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.sync.get( projectId ), state => {

				if ( ! state || state.conflict ) {

					setResult( null ); return;

				}

				const load = flight => request( stores.revisions.get( [ projectId, flight.revision ] ), row => {

					if ( ! row ) throw new Error( 'Frozen backup revision is unavailable.' );
					setResult( { ...state, inFlight: flight, document: row.document } );

				} );
				if ( state.inFlight ) {

					load( state.inFlight ); return;

				}

				request( stores.projects.get( projectId ), row => {

					// Revision zero is the untouched shell/import. A committed edit starts backup.
					const revision = row?.document.revision;
					if ( ! revision || revision <= ( state.acknowledgedRevision ?? - 1 ) ) {

						setResult( null ); return;

					}

					// This foundation sends media-free documents only. Do not freeze an unsendable
					// request: a later edit removing references must remain eligible for backup.
					if ( Object.keys( row.document.assets ).length || Object.keys( row.document.baseScenes ).length || Object.keys( row.document.narration.assets ).length || row.document.narration.clips.length ) {

						setResult( { blocked: 'DEPENDENCIES_PENDING' } );
						return;

					}

					request( stores.outbox.get( [ projectId, revision ] ), item => {

						if ( ! item ) {

							setResult( null ); return;

						}

						if ( ! state.draftId && ( typeof identity?.draftId !== 'string' || typeof identity?.capability !== 'string' ) ) throw new TypeError( 'Private draft identity is required.' );
						state = { ...state, draftId: state.draftId ?? identity.draftId, capability: state.capability ?? identity.capability,
							serverRevision: state.serverRevision ?? null, retry: null };
						const flight = { kind: state.serverRevision === null ? 'create' : 'update', revision, requestId: item.requestId, expectedServerRevision: state.serverRevision };
						stores.sync.put( { ...state, inFlight: flight } );
						load( flight );

					} );

				} );

			} );

		} );

	}

	/** Exact acknowledgement and server precondition advancement are one crash-safe commit. */
	async acknowledgeBackup( projectId, { revision, requestId, serverRevision, dependenciesVerified } ) {

		if ( ! Number.isSafeInteger( serverRevision ) || serverRevision < 0 || ! Number.isSafeInteger( revision ) || revision < 0 || dependenciesVerified !== true ) throw new TypeError( 'An exact verified backup acknowledgement is required.' );
		const db = await this.init();
		return transact( db, [ 'sync', 'outbox' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.sync.get( projectId ), state => {

				const flight = state?.inFlight;
				if ( ! flight || flight.revision !== revision || flight.requestId !== requestId ) {

					setResult( false ); return;

				}

				if ( serverRevision !== ( flight.expectedServerRevision ?? - 1 ) + 1 ) throw new Error( 'Unexpected backup acknowledgement.' );
				request( stores.outbox.get( [ projectId, revision ] ), item => {

					if ( item?.requestId !== requestId ) {

						setResult( false ); return;

					}

					stores.sync.put( { ...state, serverRevision, acknowledgedRevision: Math.max( state.acknowledgedRevision ?? - 1, revision ), inFlight: null, retry: null } );
					stores.outbox.delete( [ projectId, revision ] );
					setResult( true );

				} );

			} );

		} );

	}

	async recordBackupRetry( projectId, requestId, retry ) {

		const db = await this.init();
		return transact( db, [ 'sync' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.sync.get( projectId ), state => {

				if ( state?.inFlight?.requestId !== requestId ) {

					setResult( false ); return;

				}

				stores.sync.put( { ...state, retry: { attempts: retry.attempts, nextAttemptAt: retry.nextAttemptAt, code: retry.code, exhausted: retry.exhausted === true } } );
				setResult( true );

			} );

		} );

	}

	/** Preserve the latest local revision as an explicit copy before blocking a conflicted flight. */
	async preserveBackupConflict( projectId, requestId ) {

		const db = await this.init();
		return transact( db, [ 'projects', 'sync', 'recoveries' ], 'readwrite', ( stores, { request, setResult } ) => {

			request( stores.sync.get( projectId ), state => {

				if ( state?.inFlight?.requestId !== requestId ) {

					setResult( null ); return;

				}

				if ( state.conflict ) {

					setResult( state.conflict.recoveryId ); return;

				}

				request( stores.projects.get( projectId ), row => {

					if ( ! row ) throw new Error( 'Local conflict revision is unavailable.' );
					const recoveryId = this.createId();
					stores.recoveries.add( { recoveryId, projectId, document: row.document, reason: 'REMOTE_CONFLICT', attemptedRevision: state.inFlight.revision, createdAt: this.now() } );
					stores.sync.put( { ...state, conflict: { recoveryId, revision: row.document.revision }, retry: null } );
					setResult( recoveryId );

				} );

			} );

		} );

	}

	async status( projectId ) {

		const db = await this.init();
		return transact( db, [ 'projects', 'sync' ], 'readonly', ( stores, { request, setResult } ) => {

			request( stores.projects.get( projectId ), row => {

				request( stores.sync.get( projectId ), sync => setResult( row ? {
					localRevision: row.document.revision,
					acknowledgedRevision: sync?.acknowledgedRevision ?? null,
					backedUp: sync?.acknowledgedRevision === row.document.revision,
				} : null ) );

			} );

		} );

	}

	async recoveries( projectId ) {

		const db = await this.init();
		return transact( db, [ 'recoveries' ], 'readonly', ( stores, { request, setResult } ) => {

			request( stores.recoveries.index( 'projectId' ).getAll( projectId ), rows => setResult( rows ) );

		} );

	}

	async duplicate( projectId, options ) {

		const document = await this.get( projectId );
		if ( ! document ) throw new Error( 'Student project not found.' );
		return this.save( importStudentProjectDocument( document, options ), { expectedRevision: null } );

	}

	async restoreRecovery( recoveryId, options ) {

		const db = await this.init();
		const row = await transact( db, [ 'recoveries' ], 'readonly', ( stores, { request, setResult } ) => {

			request( stores.recoveries.get( recoveryId ), setResult );

		} );
		if ( ! row ) throw new Error( 'Student recovery copy not found.' );
		return this.save( importStudentProjectDocument( row.document, options ), { expectedRevision: null } );

	}

	async exportJSON( projectId ) {

		const document = await this.get( projectId );
		if ( ! document ) throw new Error( 'Student project not found.' );
		return JSON.stringify( prepareStudentProjectExport( document ), null, 2 );

	}

	async importJSON( json, options ) {

		if ( typeof json !== 'string' || json.length > 16 * 1024 * 1024 || new TextEncoder().encode( json ).byteLength > 16 * 1024 * 1024 ) throw new TypeError( 'A student JSON document up to 16 MiB is required.' );
		return this.save( importStudentProjectDocument( JSON.parse( json ), options ), { expectedRevision: null } );

	}

}
