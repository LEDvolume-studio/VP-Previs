import { AccountApiError } from '../api/AccountProjectClient.js';
import { backupRetryDelay } from './PrivateDraftBackupService.js';

/** Durable local-first account sync. Account lifecycle owns and stops this service. */
export class AccountSyncService {

	constructor( { repository, client, narration, eventTarget = globalThis.window, onStatus = () => {}, now = Date.now, schedule = ( fn, ms ) => setTimeout( fn, ms ), cancel = timer => clearTimeout( timer ), random = Math.random, maxAttempts = 5, concurrency = 2, probeMs = 60000 } ) {

		Object.assign( this, { repository, client, narration, eventTarget, onStatus, now, schedule, cancel, random, maxAttempts, concurrency, probeMs } );
		this.running = new Map(); this.reruns = new Set(); this.controllers = new Map(); this.timers = new Map(); this.stopped = true; this.denied = false; this.generation = 0;
		if ( ! Number.isSafeInteger( concurrency ) || concurrency < 1 || ! Number.isSafeInteger( maxAttempts ) || maxAttempts < 1 || probeMs < 1 ) throw new TypeError( 'Invalid sync limits.' );
		this.active = 0; this.waiters = [];
		this.hint = () => {

			void this.scan( true ); void this.discover();

		};

	}
	emit( projectId, state, code ) {

		if ( ! this.stopped ) {

			try {

				this.onStatus( { projectId, state, ...( code ? { code } : {} ) } );

			} catch { /* Status observers cannot affect persistence. */ }

		}

	}
	async start() {

		if ( ! this.stopped ) return; this.stopped = false; this.denied = false; ++ this.generation;
		this.eventTarget?.addEventListener( 'online', this.hint ); this.eventTarget?.addEventListener( 'focus', this.hint );
		this.unsubscribe = this.repository.subscribeCommits( id => {

			void this.notifyLocalCommit( id );

		} );
		void this.discover(); await this.scan( true );

	}
	stop() {

		this.stopped = true; ++ this.generation; this.unsubscribe?.(); this.eventTarget?.removeEventListener( 'online', this.hint ); this.eventTarget?.removeEventListener( 'focus', this.hint );
		for ( const timer of this.timers.values() ) this.cancel( timer ); this.timers.clear();
		for ( const controller of this.controllers.values() ) controller.abort(); this.discovery?.abort(); if ( this.discoveryTimer ) this.cancel( this.discoveryTimer ); this.discoveryTimer = null; this.reruns.clear();
		for ( const waiter of this.waiters.splice( 0 ) ) waiter();

	}
	valid( generation ) {

		return ! this.stopped && ! this.denied && generation === this.generation;

	}
	async scan( force = false ) {

		if ( this.stopped || this.denied ) return;
		try {

			const docs = await this.repository.list(); for ( let i = 0; i < docs.length && ! this.stopped && ! this.denied; i += this.concurrency ) await Promise.all( docs.slice( i, i + this.concurrency ).map( doc => this.run( doc.projectId, force ) ) );

		} catch {

			this.emit( null, 'storage-error', 'LOCAL_STORAGE' );

		}

	}
	/** Fetch cloud summaries and hydrate missing or newer heads without blocking local startup. */
	async discover() {

		if ( this.discoveryPromise ) return this.discoveryPromise;
		if ( this.stopped || this.denied || typeof this.client.list !== 'function' ) return;
		const promise = this.discoverOnce();
		this.discoveryPromise = promise;
		try {

			return await promise;

		} finally {

			if ( this.discoveryPromise === promise ) this.discoveryPromise = null;

		}

	}
	async discoverOnce() {

		if ( this.discoveryTimer ) {

			this.cancel( this.discoveryTimer ); this.discoveryTimer = null;

		}

		const generation = this.generation, controller = new AbortController(); this.discovery = controller;
		try {

			let cursor = null;
			do {

				const page = await this.client.list( { cursor, archived: true, signal: controller.signal } );
				if ( ! this.valid( generation ) ) return;
				if ( ! Array.isArray( page.items ) || ( page.nextCursor != null && typeof page.nextCursor !== 'string' ) ) throw new AccountApiError( 'INVALID_RESPONSE', { retryable: true } );
				for ( const summary of page.items ) {

					if ( this.repository.rememberAccountSummary ) await this.repository.rememberAccountSummary( summary );
					const state = await this.repository.backupState( summary.projectId );
					if ( ! this.valid( generation ) ) return;
					if ( state?.serverRevision != null && state.serverRevision >= summary.serverRevision ) {

						this.emit( summary.projectId, 'discovered' ); continue;

					}

					// A pending flight may already have committed remotely with its response
					// lost. Replay it first; hydration must not invent a conflict in that case.
					if ( state?.inFlight || ( await this.repository.pending( summary.projectId ) ).length ) continue;
					const remote = await this.client.read( { projectId: summary.projectId, signal: controller.signal } );
					if ( ! this.valid( generation ) ) return;
					if ( remote.project?.projectId !== summary.projectId || remote.document?.projectId !== summary.projectId || ! Number.isSafeInteger( remote.project.serverRevision ) ) throw new AccountApiError( 'INVALID_RESPONSE', { retryable: true } );
					for ( const [ mediaId, asset ] of Object.entries( remote.document.narration.assets ) ) {

						const blob = await this.client.downloadNarration( { projectId: summary.projectId, mediaId, signal: controller.signal } );
						const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await blob.arrayBuffer() ) ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
						if ( blob.size !== asset.byteLength || blob.type.replaceAll( ' ', '' ) !== asset.mimeType.toLowerCase().replaceAll( ' ', '' ) || hash !== asset.sha256 ) throw new AccountApiError( 'DEPENDENCIES_PENDING', { retryable: true } );
						if ( ! this.valid( generation ) ) return;
						const existing = await this.narration.get( asset.assetId );
						if ( existing ) {

							const existingHash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await existing.blob.arrayBuffer() ) ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
							if ( existingHash !== asset.sha256 ) throw new AccountApiError( 'CONFLICT' );

						} else if ( this.valid( generation ) ) await this.narration.put( { assetId: asset.assetId, projectId: summary.projectId, asset, blob } );

					}

					if ( ! this.valid( generation ) ) return;
					const result = await this.repository.adoptRemoteHead( remote.document, { serverRevision: remote.project.serverRevision } );
					if ( ! result.adopted && result.reason !== 'STALE_REMOTE' ) this.emit( summary.projectId, 'conflict', result.reason );
					else this.emit( summary.projectId, 'discovered' );

				}

				cursor = page.nextCursor;

			} while ( cursor && this.valid( generation ) );

		} catch ( error ) {

			if ( this.valid( generation ) && error?.code === 'AUTHORIZATION' ) {

				this.denied = true; for ( const item of this.controllers.values() ) item.abort(); this.emit( null, 'revoked', 'AUTHORIZATION' );

			} else if ( this.valid( generation ) ) this.discoveryTimer = this.schedule( () => {

				this.discoveryTimer = null; void this.discover();

			}, this.probeMs );

		} finally {

			if ( this.discovery === controller ) this.discovery = null;

		}

	}
	notifyLocalCommit( id ) {

		return this.run( id );

	}
	retry( id ) {

		return this.run( id, true );

	}
	later( id, delay, force = false ) {

		if ( this.stopped || this.denied ) return; if ( this.timers.has( id ) ) this.cancel( this.timers.get( id ) ); this.timers.set( id, this.schedule( () => {

			this.timers.delete( id ); void this.run( id, force );

		}, Math.max( 0, delay ) ) );

	}
	run( id, force = false ) {

		if ( this.stopped || this.denied ) return Promise.resolve();
		if ( this.running.has( id ) ) {

			this.reruns.add( id ); return this.running.get( id );

		}

		if ( this.timers.has( id ) ) {

			this.cancel( this.timers.get( id ) ); this.timers.delete( id );

		}

		const generation = this.generation;
		const task = ( async () => {

			while ( this.active >= this.concurrency && this.valid( generation ) ) await new Promise( resolve => this.waiters.push( resolve ) );
			if ( ! this.valid( generation ) ) return;
			this.active ++;
			try {

				await this.drain( id, force, generation );

			} finally {

				this.active --; this.waiters.shift()?.();

			}

		} )().catch( () => this.emit( id, 'storage-error', 'LOCAL_STORAGE' ) ).finally( () => {

			this.running.delete( id ); this.controllers.delete( id ); if ( this.reruns.delete( id ) && this.valid( generation ) ) void this.run( id );

		} );
		this.running.set( id, task ); return task;

	}
	async drain( id, force, generation ) {

		while ( this.valid( generation ) ) {

			const state = await this.repository.backupState( id ); if ( ! this.valid( generation ) ) return;
			if ( state?.conflict ) {

				this.emit( id, 'conflict', 'CONFLICT' ); return;

			}

			if ( ! force && state?.retry ) {

				if ( state.retry.exhausted ) {

					this.emit( id, 'pending', state.retry.code ); this.later( id, this.probeMs, true ); return;

				}

				if ( state.retry.nextAttemptAt > this.now() ) {

					this.later( id, state.retry.nextAttemptAt - this.now() ); return;

				}

			}

			const flight = await this.repository.prepareAccountBackup( id ); if ( ! this.valid( generation ) ) return;
			if ( ! flight ) {

				const op = state?.metadataQueue?.[ 0 ];
				if ( op && state.serverRevision != null ) {

					if ( ! force && state.metadataRetry?.requestId === op.requestId ) {

						const retry = state.metadataRetry;
						if ( retry.exhausted ) {

							this.emit( id, 'pending', retry.code ); this.later( id, this.probeMs, true ); return;

						}

						if ( retry.nextAttemptAt > this.now() ) {

							this.later( id, retry.nextAttemptAt - this.now() ); return;

						}

					}

					const controller = new AbortController(); this.controllers.set( id, controller );
					try {

						const result = await this.client.metadata( { projectId: id, operation: op, signal: controller.signal } ); if ( ! this.valid( generation ) ) return; if ( ! await this.repository.acknowledgeMetadata( id, { requestId: op.requestId, metadataRevision: result.project?.metadataRevision } ) ) throw new Error( 'Invalid metadata acknowledgement.' ); continue;

					} catch ( error ) {

						await this.failure( id, state, op.requestId, error, force, generation, true ); return;

					}

				}

				this.emit( id, state?.serverRevision != null ? 'backed-up' : 'local' ); return;

			}

			const controller = new AbortController(); this.controllers.set( id, controller ); this.emit( id, 'backing-up' );
			const request = { projectId: id, document: flight.document, requestId: flight.inFlight.requestId, serverRevision: flight.inFlight.expectedServerRevision, signal: controller.signal };
			try {

				if ( flight.inFlight.kind === 'create' && Object.keys( flight.document.narration.assets ).length ) await this.client.reserve( request );
				for ( const [ mediaId, asset ] of Object.entries( flight.document.narration.assets ) ) {

					const row = await this.narration.get( asset.assetId ); if ( ! row?.blob || row.blob.size !== asset.byteLength ) throw new AccountApiError( 'DEPENDENCIES_PENDING', { retryable: true } );
					const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await row.blob.arrayBuffer() ) ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
					if ( hash !== asset.sha256 ) throw new AccountApiError( 'DEPENDENCIES_PENDING', { retryable: true } );
					await this.client.uploadNarration( { projectId: id, mediaId, asset, blob: row.blob, signal: controller.signal } );

				}

				const ack = await ( flight.inFlight.kind === 'create' ? this.client.create( request ) : this.client.update( request ) );
				if ( ! this.valid( generation ) ) return;
				if ( ack.projectId !== id || ack.documentRevision !== flight.inFlight.revision || ack.serverRevision !== ( flight.inFlight.expectedServerRevision ?? - 1 ) + 1 || ack.dependenciesVerified !== true ) throw new AccountApiError( 'INVALID_RESPONSE', { retryable: true } );
				if ( ! await this.repository.acknowledgeAccountBackup( id, { revision: flight.inFlight.revision, requestId: flight.inFlight.requestId, serverRevision: ack.serverRevision, dependenciesVerified: true } ) ) {

					this.emit( id, 'storage-error', 'ACK_NOT_COMMITTED' ); return;

				}

			} catch ( error ) {

				await this.failure( id, flight, flight.inFlight.requestId, error, force, generation ); return;

			}

			force = false;

		}

	}
	async failure( id, state, requestId, error, force, generation, metadata = false ) {

		if ( ! this.valid( generation ) || error?.code === 'CANCELLED' ) return;
		if ( error?.code === 'AUTHORIZATION' ) {

			this.denied = true; for ( const controller of this.controllers.values() ) controller.abort(); for ( const timer of this.timers.values() ) this.cancel( timer ); this.timers.clear(); this.emit( id, 'revoked', 'AUTHORIZATION' ); return;

		}

		if ( error?.code === 'CONFLICT' || error?.code === 'PROJECT_ARCHIVED' ) {

			if ( metadata ) await this.repository.preserveMetadataConflict( id, requestId );
			else await this.repository.preserveBackupConflict( id, requestId );
			this.emit( id, 'conflict', error.code ); return;

		}

		const attempts = ( force ? 0 : ( metadata ? state?.metadataRetry?.attempts : state?.retry?.attempts ) ?? 0 ) + 1, retryable = error instanceof AccountApiError && error.retryable;
		const exhausted = ! retryable || attempts >= this.maxAttempts, delay = backupRetryDelay( attempts, { random: this.random } ), code = error?.code || 'REQUEST_FAILED';
		if ( metadata ) await this.repository.recordMetadataRetry( id, requestId, { attempts, nextAttemptAt: this.now() + delay, exhausted, code } );
		else await this.repository.recordBackupRetry( id, requestId, { attempts, nextAttemptAt: this.now() + delay, exhausted, code } );
		this.emit( id, 'pending', code ); this.later( id, exhausted ? this.probeMs : delay, exhausted );

	}

}
