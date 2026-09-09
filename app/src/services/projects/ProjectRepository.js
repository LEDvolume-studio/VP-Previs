import {
	createProjectDocument,
	importProjectDocument,
	migrateProjectDocument,
	prepareProjectExport,
} from './ProjectSchema';

const DB_NAME = 'RayzeeEditorDB';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const HANDLES = 'fileHandles';
const META = 'metadata';
const ACTIVE_PROJECT_KEY = 'activeProjectId';
const DEFAULT_PROJECT_KEY = 'defaultProjectId';

const requestResult = request => new Promise( ( resolve, reject ) => {

	request.onsuccess = () => resolve( request.result );
	request.onerror = () => reject( request.error );

} );

const transactionDone = transaction => new Promise( ( resolve, reject ) => {

	transaction.oncomplete = () => resolve();
	transaction.onerror = () => reject( transaction.error );
	transaction.onabort = () => reject( transaction.error || new Error( 'Database transaction aborted.' ) );

} );

export class ProjectRepository {

	constructor( databaseFactory = globalThis.indexedDB ) {

		this.databaseFactory = databaseFactory;
		this.dbPromise = null;

	}

	async init() {

		if ( ! this.databaseFactory ) throw new Error( 'IndexedDB is not available in this browser.' );
		if ( this.dbPromise ) return this.dbPromise;
		this.dbPromise = new Promise( ( resolve, reject ) => {

			const request = this.databaseFactory.open( DB_NAME, DB_VERSION );
			request.onupgradeneeded = () => {

				const db = request.result;
				if ( ! db.objectStoreNames.contains( PROJECTS ) ) {

					const store = db.createObjectStore( PROJECTS, { keyPath: 'projectId' } );
					store.createIndex( 'updatedAt', 'updatedAt' );

				}

				if ( ! db.objectStoreNames.contains( HANDLES ) ) db.createObjectStore( HANDLES, { keyPath: [ 'projectId', 'assetId' ] } );
				if ( ! db.objectStoreNames.contains( META ) ) db.createObjectStore( META, { keyPath: 'key' } );

			};

			request.onsuccess = () => {

				const db = request.result;
				db.onversionchange = () => db.close();
				resolve( db );

			};

			request.onerror = () => {

				this.dbPromise = null;
				reject( request.error );

			};

		} );
		return this.dbPromise;

	}

	async list() {

		const db = await this.init();
		const rows = await requestResult( db.transaction( PROJECTS ).objectStore( PROJECTS ).getAll() );
		return rows.map( migrateProjectDocument ).sort( ( a, b ) => new Date( b.updatedAt ) - new Date( a.updatedAt ) );

	}

	async get( projectId ) {

		const db = await this.init();
		const value = await requestResult( db.transaction( PROJECTS ).objectStore( PROJECTS ).get( projectId ) );
		return value ? migrateProjectDocument( value ) : null;

	}

	async save( document ) {

		const db = await this.init();
		const next = migrateProjectDocument( document );
		const tx = db.transaction( PROJECTS, 'readwrite' );
		tx.objectStore( PROJECTS ).put( next );
		await transactionDone( tx );
		return next;

	}

	async create( options ) {

		const document = createProjectDocument( options );
		await this.save( document );
		return document;

	}

	async delete( projectId ) {

		const db = await this.init();
		const tx = db.transaction( [ PROJECTS, HANDLES ], 'readwrite' );
		tx.objectStore( PROJECTS ).delete( projectId );
		const handleStore = tx.objectStore( HANDLES );
		const range = IDBKeyRange.bound( [ projectId, '' ], [ projectId, '\uffff' ] );
		handleStore.openKeyCursor( range ).onsuccess = event => {

			const cursor = event.target.result;
			if ( cursor ) {

				cursor.delete();
				cursor.continue();

			}

		};

		await transactionDone( tx );

	}

	async duplicate( projectId ) {

		const source = await this.get( projectId );
		if ( ! source ) throw new Error( 'Project not found.' );
		const copy = importProjectDocument( { ...source, name: `Copy of ${source.name}` } );
		const db = await this.init();
		const tx = db.transaction( [ PROJECTS, HANDLES ], 'readwrite' );
		tx.objectStore( PROJECTS ).put( copy );
		const handles = tx.objectStore( HANDLES );
		const range = IDBKeyRange.bound( [ projectId, '' ], [ projectId, '\uffff' ] );
		handles.openCursor( range ).onsuccess = event => {

			const cursor = event.target.result;
			if ( cursor ) {

				handles.put( { ...cursor.value, projectId: copy.projectId } );
				cursor.continue();

			}

		};

		await transactionDone( tx );
		return copy;

	}

	/**
	 * Persist a modified working copy without ever writing the source project.
	 * Retained file handles are copied in the same transaction as the new document.
	 */
	async fork( sourceProjectId, document, name ) {

		const copy = importProjectDocument( { ...document, name } );
		const number = Number( name.match( /^New Project (\d+)$/i )?.[ 1 ] );
		if ( Number.isInteger( number ) && number > 0 ) {

			copy.extensions = { ...copy.extensions, workingCopyNumber: number };

		}

		const db = await this.init();
		const tx = db.transaction( [ PROJECTS, HANDLES, META ], 'readwrite' );
		tx.objectStore( PROJECTS ).put( copy );
		tx.objectStore( META ).put( { key: ACTIVE_PROJECT_KEY, value: copy.projectId } );
		const handles = tx.objectStore( HANDLES );
		const range = IDBKeyRange.bound( [ sourceProjectId, '' ], [ sourceProjectId, '\uffff' ] );
		handles.openCursor( range ).onsuccess = event => {

			const cursor = event.target.result;
			if ( cursor ) {

				handles.put( { ...cursor.value, projectId: copy.projectId } );
				cursor.continue();

			}

		};

		await transactionDone( tx );
		return copy;

	}

	/** Replace the protected default document and its retained handles atomically. */
	async replaceDefault( sourceProjectId, defaultProjectId, document ) {

		const next = migrateProjectDocument( document );
		const db = await this.init();
		let sourceHandles = [];
		if ( sourceProjectId !== defaultProjectId ) {

			const sourceRange = IDBKeyRange.bound( [ sourceProjectId, '' ], [ sourceProjectId, '\uffff' ] );
			sourceHandles = await requestResult( db.transaction( HANDLES ).objectStore( HANDLES ).getAll( sourceRange ) );

		}

		const tx = db.transaction( [ PROJECTS, HANDLES, META ], 'readwrite' );
		tx.objectStore( PROJECTS ).put( next );
		tx.objectStore( META ).put( { key: ACTIVE_PROJECT_KEY, value: defaultProjectId } );
		if ( sourceProjectId !== defaultProjectId ) {

			const handles = tx.objectStore( HANDLES );
			const defaultRange = IDBKeyRange.bound( [ defaultProjectId, '' ], [ defaultProjectId, '\uffff' ] );
			handles.openCursor( defaultRange ).onsuccess = event => {

				const cursor = event.target.result;
				if ( cursor ) {

					cursor.delete();
					cursor.continue();

				} else {

					for ( const row of sourceHandles ) handles.put( { ...row, projectId: defaultProjectId } );

				}

			};

		}

		await transactionDone( tx );
		return next;

	}

	async setActiveProjectId( projectId ) {

		const db = await this.init();
		const tx = db.transaction( META, 'readwrite' );
		tx.objectStore( META ).put( { key: ACTIVE_PROJECT_KEY, value: projectId } );
		await transactionDone( tx );

	}

	async getActiveProjectId() {

		const db = await this.init();
		const row = await requestResult( db.transaction( META ).objectStore( META ).get( ACTIVE_PROJECT_KEY ) );
		return row?.value || null;

	}

	async setDefaultProjectId( projectId ) {

		const db = await this.init();
		const tx = db.transaction( META, 'readwrite' );
		tx.objectStore( META ).put( { key: DEFAULT_PROJECT_KEY, value: projectId } );
		await transactionDone( tx );

	}

	async getDefaultProjectId() {

		const db = await this.init();
		const row = await requestResult( db.transaction( META ).objectStore( META ).get( DEFAULT_PROJECT_KEY ) );
		return row?.value || null;

	}

	async putHandle( projectId, assetId, handle ) {

		const db = await this.init();
		const tx = db.transaction( HANDLES, 'readwrite' );
		tx.objectStore( HANDLES ).put( { projectId, assetId, handle } );
		await transactionDone( tx );

	}

	async getHandle( projectId, assetId ) {

		const db = await this.init();
		const row = await requestResult( db.transaction( HANDLES ).objectStore( HANDLES ).get( [ projectId, assetId ] ) );
		return row?.handle || null;

	}

	async deleteHandle( projectId, assetId ) {

		const db = await this.init();
		const tx = db.transaction( HANDLES, 'readwrite' );
		tx.objectStore( HANDLES ).delete( [ projectId, assetId ] );
		await transactionDone( tx );

	}

	serialize( document ) {

		return JSON.stringify( prepareProjectExport( document ), null, 2 );

	}

	deserialize( text ) {

		return importProjectDocument( JSON.parse( text ) );

	}

}

export const projectRepository = new ProjectRepository();
