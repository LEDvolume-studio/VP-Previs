// Pure orchestration tests use a deliberate repository fake; native transaction evidence is in the browser harness.
import { describe, it, expect, vi } from 'vitest';
import { PrivateDraftBackupService, backupRetryDelay, hasBackupDependencies } from '../../../app/src/previs/sync/PrivateDraftBackupService.js';
import { DraftApiError } from '../../../app/src/previs/api/DraftApiClient.js';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

function fixture( options = {} ) {

	let state = { projectId: 'project', acknowledgedRevision: null };
	let now = 0;
	let nextTimer = 0;
	const timers = new Map();
	const document = { ...createStudentProjectDocument( { projectId: 'project' } ), revision: 1 };
	const identity = { draftId: '342341af-1478-4ffc-862e-93510340b44d', capability: 'A'.repeat( 43 ) };
	const repository = {
		list: vi.fn( async () => [ document ] ),
		backupState: vi.fn( async () => structuredClone( state ) ),
		prepareBackup: vi.fn( async () => {

			if ( state.acknowledgedRevision === document.revision ) return null;
			state = { ...state, ...identity, inFlight: state.inFlight ?? { kind: 'create', revision: document.revision, expectedServerRevision: null, requestId: 'project:1' } };
			return structuredClone( { ...state, document } );

		} ),
		acknowledgeBackup: vi.fn( async ( projectId, ack ) => {

			state = { ...state, acknowledgedRevision: ack.revision, serverRevision: ack.serverRevision, inFlight: null, retry: null }; return true;

		} ),
		recordBackupRetry: vi.fn( async ( projectId, requestId, retry ) => {

			state.retry = retry; return true;

		} ),
		preserveBackupConflict: vi.fn( async () => {

			state.conflict = { recoveryId: 'copy' }; return 'copy';

		} ),
		status: vi.fn( async () => ( { backedUp: state.acknowledgedRevision === document.revision } ) ),
	};
	const client = { create: vi.fn( async () => ( { draftId: identity.draftId, serverRevision: 0, documentRevision: 1, dependenciesVerified: true } ) ), update: vi.fn() };
	const onStatus = vi.fn();
	const eventTarget = new EventTarget();
	const service = new PrivateDraftBackupService( { repository, client, onStatus, eventTarget, createIdentity: () => identity, now: () => now,
		schedule: ( callback, delay ) => {

			timers.set( ++ nextTimer, { callback, delay } ); return nextTimer;

		}, cancel: id => timers.delete( id ), random: () => 0, ...options } );
	return { repository, client, onStatus, service, timers, document, eventTarget, state: () => state, time: value => {

		now = value;

	} };

}

describe( 'private draft service orchestration (repository fake)', () => {

	it( 'keeps unverified pinned base scenes pending even when their claimed asset list is empty', () => {

		const document = createStudentProjectDocument();
		document.baseScenes = { 'empty@v1': { sceneId: 'empty', version: 'v1', assets: [] } };
		expect( hasBackupDependencies( document ) ).toBe( true );
		document.assets[ 'model@v1' ] = {};
		expect( hasBackupDependencies( document ) ).toBe( true );

	} );

	it( 'bounds exponential delay with injected equal jitter', () => {

		expect( backupRetryDelay( 1, { random: () => 0 } ) ).toBe( 500 );
		expect( backupRetryDelay( 2, { random: () => 1 } ) ).toBe( 2000 );
		expect( backupRetryDelay( 100, { random: () => 1 } ) ).toBe( 60000 );

	} );

	it( 'starts by scanning durable projects and listens for online hints', async () => {

		const f = fixture();
		await f.service.start();
		expect( f.repository.list ).toHaveBeenCalledOnce();
		expect( f.client.create ).toHaveBeenCalledOnce();
		expect( f.onStatus ).toHaveBeenLastCalledWith( { projectId: 'project', state: 'backed-up' } );
		f.eventTarget.dispatchEvent( new Event( 'online' ) );
		await f.service.scan();
		expect( f.repository.list.mock.calls.length ).toBeGreaterThan( 1 );
		f.service.stop();

	} );

	it( 'retains the same frozen request across bounded failures and resets on an explicit retry', async () => {

		const f = fixture( { maxAttempts: 2 } );
		f.client.create.mockRejectedValue( new DraftApiError( 'NETWORK', { retryable: true } ) );
		await f.service.notifyLocalCommit( 'project' );
		expect( f.state().retry ).toMatchObject( { attempts: 1, nextAttemptAt: 500, exhausted: false } );
		expect( [ ...f.timers.values() ][ 0 ].delay ).toBe( 500 );
		await f.service.notifyLocalCommit( 'project' );
		expect( f.client.create ).toHaveBeenCalledOnce();
		f.time( 500 );
		await f.service.notifyLocalCommit( 'project' );
		expect( f.state().retry ).toMatchObject( { attempts: 2, exhausted: true } );
		expect( f.timers.size ).toBe( 0 );
		expect( f.repository.acknowledgeBackup ).not.toHaveBeenCalled();
		await f.service.retry( 'project' );
		expect( f.state().retry.attempts ).toBe( 1 );
		expect( f.client.create.mock.calls.map( ( [ request ] ) => request.requestId ) ).toEqual( [ 'project:1', 'project:1', 'project:1' ] );
		f.service.stop();

	} );

	it( 'does not retry authorization failures automatically', async () => {

		const f = fixture();
		f.client.create.mockRejectedValue( new DraftApiError( 'AUTHORIZATION' ) );
		await f.service.notifyLocalCommit( 'project' );
		expect( f.state().retry.exhausted ).toBe( true );
		expect( f.timers.size ).toBe( 0 );
		expect( f.repository.acknowledgeBackup ).not.toHaveBeenCalled();

	} );

	it( 'preserves a conflict copy and blocks subsequent requests', async () => {

		const f = fixture();
		f.client.create.mockRejectedValue( new DraftApiError( 'CONFLICT' ) );
		await f.service.notifyLocalCommit( 'project' );
		await f.service.retry( 'project' );
		expect( f.repository.preserveBackupConflict ).toHaveBeenCalledOnce();
		expect( f.client.create ).toHaveBeenCalledOnce();

	} );

	it( 'does not acknowledge media references or forge uploads', async () => {

		const f = fixture();
		f.document.assets[ 'video@1' ] = { assetId: 'video', version: '1' };
		await f.service.notifyLocalCommit( 'project' );
		expect( f.client.create ).not.toHaveBeenCalled();
		expect( f.repository.acknowledgeBackup ).not.toHaveBeenCalled();
		expect( f.onStatus ).toHaveBeenLastCalledWith( { projectId: 'project', state: 'pending', code: 'DEPENDENCIES_PENDING' } );

	} );

	it( 'refuses malformed or incompletely verified acknowledgements', async () => {

		for ( const patch of [ { documentRevision: 2 }, { draftId: 'other' }, { dependenciesVerified: false }, { serverRevision: 1 } ] ) {

			const f = fixture( { maxAttempts: 1 } );
			f.client.create.mockResolvedValue( { draftId: '342341af-1478-4ffc-862e-93510340b44d', serverRevision: 0, documentRevision: 1, dependenciesVerified: true, ...patch } );
			await f.service.notifyLocalCommit( 'project' );
			expect( f.repository.acknowledgeBackup ).not.toHaveBeenCalled();
			expect( f.state().inFlight.requestId ).toBe( 'project:1' );

		}

	} );

	it( 'keeps the flight pending when cancellation may race remote commit', async () => {

		const f = fixture();
		let entered;
		const sending = new Promise( resolve => {

			entered = resolve;

		} );
		f.client.create.mockImplementation( ( { signal } ) => new Promise( ( resolve, reject ) => {

			entered();
			signal.addEventListener( 'abort', () => reject( new DraftApiError( 'CANCELLED' ) ) );

		} ) );
		const work = f.service.notifyLocalCommit( 'project' );
		await sending;
		f.service.stop();
		await work;
		expect( f.state().inFlight.requestId ).toBe( 'project:1' );
		expect( f.repository.acknowledgeBackup ).not.toHaveBeenCalled();
		expect( f.repository.recordBackupRetry ).not.toHaveBeenCalled();

	} );

	it( 'stops instead of endlessly replaying an unchanged rejected local acknowledgement', async () => {

		const f = fixture();
		f.repository.acknowledgeBackup.mockResolvedValue( false );
		await f.service.notifyLocalCommit( 'project' );
		expect( f.client.create ).toHaveBeenCalledOnce();
		expect( f.state().acknowledgedRevision ).toBeNull();
		expect( f.onStatus ).toHaveBeenLastCalledWith( { projectId: 'project', state: 'storage-error', code: 'ACK_NOT_COMMITTED' } );

	} );

	it( 'reports local storage failure separately without trusting a network response', async () => {

		const f = fixture();
		f.repository.acknowledgeBackup.mockRejectedValue( new Error( 'Disk failure' ) );
		await f.service.notifyLocalCommit( 'project' );
		expect( f.state().acknowledgedRevision ).toBeNull();
		expect( f.onStatus ).toHaveBeenLastCalledWith( { projectId: 'project', state: 'storage-error', code: 'LOCAL_STORAGE' } );

	} );

} );
