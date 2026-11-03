import { createDraftIdentity, DraftApiError } from '../api/DraftApiClient.js';

/** Bounded exponential delay with equal jitter. Inputs are injectable for deterministic tests. */
export function backupRetryDelay( attempt, { baseMs = 1000, maxMs = 60000, random = Math.random } = {} ) {

	const ceiling = Math.min( maxMs, baseMs * 2 ** Math.min( 30, Math.max( 0, attempt - 1 ) ) );
	return Math.round( ceiling * ( 0.5 + Math.min( 1, Math.max( 0, random() ) ) / 2 ) );

}

export function hasBackupDependencies( document ) {

	return Object.keys( document.assets ).length > 0 || Object.keys( document.baseScenes ).length > 0 || Object.keys( document.narration.assets ).length > 0 || document.narration.clips.length > 0;

}

/** Local-first, media-free foundation. The host calls notifyLocalCommit after a successful save. */
export class PrivateDraftBackupService {

	constructor( { repository, client, eventTarget = globalThis.window, onStatus = () => {},
		createIdentity = createDraftIdentity, now = Date.now, schedule = ( callback, delay ) => setTimeout( callback, delay ), cancel = timer => clearTimeout( timer ),
		random = Math.random, maxAttempts = 5, retryBaseMs = 1000, retryMaxMs = 60000 } ) {

		if ( ! Number.isSafeInteger( maxAttempts ) || maxAttempts < 1 ) throw new TypeError( 'A positive retry limit is required.' );
		Object.assign( this, { repository, client, eventTarget, onStatus, createIdentity, now, schedule, cancel, random, maxAttempts, retryBaseMs, retryMaxMs } );
		this.running = new Map();
		this.reruns = new Map();
		this.timers = new Map();
		this.controllers = new Map();
		this.started = false;
		this.stopped = false;
		this.online = () => {

			void this.scan( true );

		};

	}

	emit( projectId, state, code ) {

		// Observers receive no documents or private capability records.
		try {

			this.onStatus( { projectId, state, ...( code ? { code } : {} ) } );

		} catch { /* Observers cannot change backup semantics. */ }

	}

	async start() {

		if ( this.started ) return;
		this.started = true;
		this.stopped = false;
		this.eventTarget?.addEventListener( 'online', this.online );
		await this.scan( true );

	}

	stop() {

		this.stopped = true;
		this.started = false;
		this.eventTarget?.removeEventListener( 'online', this.online );
		for ( const timer of this.timers.values() ) this.cancel( timer );
		this.timers.clear();
		for ( const controller of this.controllers.values() ) controller.abort();

	}

	async scan( force = false ) {

		if ( this.stopped ) return;
		try {

			const documents = await this.repository.list();
			await Promise.all( documents.map( document => this.run( document.projectId, force ) ) );

		} catch {

			this.emit( null, 'storage-error', 'LOCAL_STORAGE' );

		}

	}

	notifyLocalCommit( projectId ) {

		return this.run( projectId );

	}

	/** Explicit retry and online hints may start a new bounded retry cycle. */
	retry( projectId ) {

		return this.run( projectId, true );

	}

	run( projectId, force = false ) {

		if ( this.stopped ) return Promise.resolve();
		if ( this.running.has( projectId ) ) {

			this.reruns.set( projectId, force || this.reruns.get( projectId ) || false );
			return this.running.get( projectId );

		}

		if ( this.timers.has( projectId ) ) {

			this.cancel( this.timers.get( projectId ) ); this.timers.delete( projectId );

		}

		const promise = this.drain( projectId, force ).catch( () => {

			this.emit( projectId, 'storage-error', 'LOCAL_STORAGE' );

		} ).finally( () => {

			this.running.delete( projectId );
			this.controllers.delete( projectId );
			if ( this.reruns.has( projectId ) ) {

				const retryForce = this.reruns.get( projectId );
				this.reruns.delete( projectId );
				return this.run( projectId, retryForce );

			}

		} );
		this.running.set( projectId, promise );
		return promise;

	}

	later( projectId, delay ) {

		if ( this.stopped ) return;
		this.timers.set( projectId, this.schedule( () => {

			this.timers.delete( projectId );
			void this.run( projectId );

		}, Math.max( 0, delay ) ) );

	}

	async drain( projectId, force ) {

		while ( ! this.stopped ) {

			const state = await this.repository.backupState( projectId );
			if ( state?.conflict ) {

				this.emit( projectId, 'conflict', 'CONFLICT' ); return;

			}

			if ( ! force && state?.retry ) {

				if ( state.retry.exhausted ) {

					this.emit( projectId, 'pending', state.retry.code ); return;

				}

				if ( state.retry.nextAttemptAt > this.now() ) {

					this.later( projectId, state.retry.nextAttemptAt - this.now() ); return;

				}

			}

			const flight = await this.repository.prepareBackup( projectId, state?.draftId ? undefined : this.createIdentity() );
			if ( ! flight ) {

				const status = await this.repository.status( projectId );
				this.emit( projectId, status?.backedUp ? 'backed-up' : 'local' );
				return;

			}

			// No upload endpoint is simulated. Media support must supply server verification first.
			if ( flight.blocked === 'DEPENDENCIES_PENDING' || hasBackupDependencies( flight.document ) ) {

				this.emit( projectId, 'pending', 'DEPENDENCIES_PENDING' ); return;

			}

			if ( this.stopped ) return;
			const controller = new AbortController();
			this.controllers.set( projectId, controller );
			this.emit( projectId, 'backing-up' );
			let acknowledgement;
			try {

				const request = { draftId: flight.draftId, capability: flight.capability, requestId: flight.inFlight.requestId,
					document: flight.document, serverRevision: flight.inFlight.expectedServerRevision, signal: controller.signal };
				acknowledgement = await ( flight.inFlight.kind === 'create' ? this.client.create( request ) : this.client.update( request ) );
				if ( acknowledgement.draftId !== flight.draftId || acknowledgement.documentRevision !== flight.inFlight.revision || acknowledgement.dependenciesVerified !== true || acknowledgement.serverRevision !== ( flight.inFlight.expectedServerRevision ?? - 1 ) + 1 ) throw new DraftApiError( 'INVALID_RESPONSE', { retryable: true } );

			} catch ( error ) {

				if ( this.stopped || error?.code === 'CANCELLED' ) {

					this.emit( projectId, 'pending', 'CANCELLED' ); return;

				}

				if ( error instanceof DraftApiError && error.code === 'CONFLICT' ) {

					await this.repository.preserveBackupConflict( projectId, flight.inFlight.requestId );
					this.emit( projectId, 'conflict', 'CONFLICT' );
					return;

				}

				const attempts = ( force ? 0 : flight.retry?.attempts ?? 0 ) + 1;
				const retryable = error instanceof DraftApiError && error.retryable;
				const exhausted = ! retryable || attempts >= this.maxAttempts;
				const delay = backupRetryDelay( attempts, { baseMs: this.retryBaseMs, maxMs: this.retryMaxMs, random: this.random } );
				const code = error instanceof DraftApiError ? error.code : 'REQUEST_FAILED';
				await this.repository.recordBackupRetry( projectId, flight.inFlight.requestId, { attempts, nextAttemptAt: this.now() + delay, exhausted, code } );
				this.emit( projectId, 'pending', code );
				if ( ! exhausted ) this.later( projectId, delay );
				return;

			}

			// If this transaction aborts, the same persisted request is replayed on the next hint.
			const acknowledged = await this.repository.acknowledgeBackup( projectId, { revision: flight.inFlight.revision, requestId: flight.inFlight.requestId,
				serverRevision: acknowledgement.serverRevision, dependenciesVerified: true } );
			if ( ! acknowledged ) {

				const current = await this.repository.backupState( projectId );
				// Another tab can have advanced this flight. An unchanged rejected
				// acknowledgement must not become an unbounded network replay loop.
				if ( current?.inFlight?.requestId === flight.inFlight.requestId ) {

					this.emit( projectId, 'storage-error', 'ACK_NOT_COMMITTED' );
					return;

				}

			}

			force = false;

		}

	}

}
