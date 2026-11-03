/** Own asynchronous viewport preparation and teardown independently of DOM rerenders. */
export class ShotPreviewController {

	constructor( { createViewport, onChange = () => {}, onCameraChange = () => {}, onNavigationStart = () => {} } ) {

		this.createViewport = createViewport;
		this.onChange = onChange;
		this.onCameraChange = onCameraChange;
		this.onNavigationStart = onNavigationStart;
		this.state = { phase: 'idle', status: 'Choose a shot to preview its saved start frame.', shotId: null, frame: 0, interactive: false };
		this.runtime = null;
		this.runtimeToken = null;
		this.controller = null;
		this.generation = 0;
		this.tail = Promise.resolve();
		this.teardownError = null;
		this.document = null;
		this.catalogue = null;

	}

	clear( status = 'Shot preview closed.', { notify = true } = {} ) {

		++ this.generation;
		this.controller?.abort();
		const old = this.runtime;
		old?.setInteractive?.( false );
		this.runtime = null;
		this.runtimeToken = null;
		this.document = null;
		old?.canvas.remove();
		this.state = { phase: 'idle', status, shotId: null, frame: 0, interactive: false };
		const generation = this.generation;
		this.tail = this.tail.catch( () => {} ).then( () => old?.dispose() ).catch( error => {

			this.teardownError = error;
			if ( generation !== this.generation ) return;
			this.state = { ...this.state, phase: 'error', status: 'Shot preview closed, but some resources could not be released. Reload before previewing again.' };
			this.onChange();

		} );
		if ( notify ) this.onChange();
		return this.tail;

	}

	/** Hide a retained picture until its corresponding document is durably saved. */
	suspend( status = 'Saving…', { notify = false } = {} ) {

		++ this.generation;
		this.controller?.abort();
		this.runtime?.setInteractive?.( false );
		this.runtime?.canvas.remove();
		this.state = { ...this.state, phase: this.runtime ? 'suspended' : 'idle', status, shotId: this.runtime ? this.state.shotId : null };
		if ( notify ) this.onChange();

	}

	/** A failed picture refresh must never turn an already successful save into a save failure. */
	syncSavedDocument( document ) {

		if ( ! this.runtime || ! this.state.shotId ) return Promise.resolve( false );
		return this._prepare( { document, shotId: this.state.shotId, catalogue: this.catalogue, frame: this.state.frame, interactive: this.state.interactive }, { reuse: true, saved: true } );

	}

	/** Explicit retries rebuild the scene; ordinary selection retains compatible resources. */
	show( options ) {

		return this._prepare( options );

	}

	select( options ) {

		return this._prepare( options, { reuse: this.state.phase !== 'error' } );

	}

	seek( options ) {

		return this.select( { ...options, interactive: false } );

	}

	renderFrame( frame ) {

		if ( ! this.document || ! this.runtime || ! this.state.shotId ) return Promise.resolve( false );
		return this.seek( { document: this.document, shotId: this.state.shotId, catalogue: this.catalogue, frame } );

	}

	async captureCamera() {

		const runtime = this.runtime, generation = this.generation;
		if ( ! runtime || this.state.phase !== 'ready' || ! this.state.interactive ) return null;
		const camera = await runtime.captureCamera?.();
		if ( generation !== this.generation || runtime !== this.runtime || this.state.phase !== 'ready' || ! this.state.interactive ) return null;
		return camera ? structuredClone( camera ) : null;

	}

	_prepare( { document, shotId, catalogue, frame = 0, interactive = true }, { reuse = false, saved = false } = {} ) {

		const retained = reuse ? this.runtime : null;
		if ( reuse ) this.suspend( 'Updating shot viewer…' );
		else this.clear( 'Preparing shot preview…', { notify: false } );
		const generation = this.generation;
		const controller = new AbortController();
		this.controller = controller;
		let snapshot, signature;
		try {

			snapshot = structuredClone( document );
			signature = JSON.stringify( [ shotId, snapshot ] );

		} catch ( error ) {

			this.state = { ...this.state, phase: 'error', status: saved ? `Project saved on this device. Shot preview unavailable: ${error.message}` : `Shot preview unavailable: ${error.message} Project settings remain saved on this device.` };
			this.onChange();
			return Promise.resolve( false );

		}

		this.state = { phase: 'loading', status: retained ? 'Updating shot viewer…' : 'Preparing shot preview…', shotId, frame, interactive };
		this.onChange();
		const operation = this.tail.then( async () => {

			controller.signal.throwIfAborted();
			if ( this.teardownError ) throw new Error( 'Earlier preview cleanup failed. Reload before preparing another preview.' );
			if ( ! Number.isSafeInteger( frame ) || frame < 0 ) throw new Error( 'Shot frame must be a non-negative integer.' );
			let runtime = retained;
			if ( runtime ) {

				const compatible = this.runtimeToken.signature === signature || ( !! snapshot.shots?.[ shotId ] && runtime.canUpdate( snapshot, shotId ) );
				if ( ! compatible && saved ) {

					// Do not await clear: its teardown follows this operation in the queue.
					this.clear( 'Project saved on this device. Choose a shot to preview its saved start frame.' );
					return false;

				}

				if ( compatible ) {

					this.runtimeToken.generation = generation;
					if ( this.runtimeToken.signature !== signature ) await runtime.updateDocument( snapshot, shotId, { signal: controller.signal } );

				} else {

					this.runtime = null; this.runtimeToken = null;
					try {

						await runtime.dispose();

					} catch ( error ) {

						this.teardownError = error; throw error;

					}

					runtime = null;

				}

			}

			controller.signal.throwIfAborted();
			if ( ! runtime ) {

				const token = { runtime: null, generation };
				runtime = await this.createViewport( { document: snapshot, shotId, catalogue, signal: controller.signal, onStatus: status => {

					if ( generation !== this.generation ) return;
					this.state = { ...this.state, status }; this.onChange();

				}, onCameraChange: camera => {

					if ( token !== this.runtimeToken || token.runtime !== this.runtime || token.generation !== this.generation || this.state.phase !== 'ready' || ! this.state.interactive ) return;
					return this.onCameraChange( structuredClone( camera ), { shotId: this.state.shotId } );

				}, onNavigationStart: () => {

					if ( token !== this.runtimeToken || token.runtime !== this.runtime || token.generation !== this.generation || this.state.phase !== 'ready' || ! this.state.interactive ) return;
					return this.onNavigationStart( { shotId: this.state.shotId } );

				}, onError: error => {

					if ( token !== this.runtimeToken || token.runtime !== this.runtime || token.generation !== this.generation || this.state.phase !== 'ready' || ! this.state.interactive ) return;
					runtime.setInteractive?.( false );
					this.state = { ...this.state, phase: 'error', interactive: false, status: `Camera navigation unavailable: ${error.message}. Saved project settings remain on this device. Reopen this setup to retry.` };
					this.onChange();

				} } );
				if ( generation !== this.generation || controller.signal.aborted ) {

					try {

						await runtime.dispose();

					} catch ( error ) {

						this.teardownError = error; throw error;

					}

					return false;

				}

				token.runtime = runtime;
				this.runtimeToken = token;
				this.runtime = runtime;
				runtime.setInteractive?.( false );

			}

			await runtime.renderFrame?.( frame, { signal: controller.signal } );
			if ( generation !== this.generation || controller.signal.aborted ) return false;
			this.runtimeToken.signature = signature;
			this.document = snapshot;
			this.catalogue = catalogue;
			this.state = { phase: 'ready', status: frame === 0 ? `Previewing ${snapshot.shots[ shotId ].name} at its saved start frame.` : `Viewing ${snapshot.shots[ shotId ].name} at frame ${frame}.`, shotId, frame, interactive };
			runtime.setInteractive?.( interactive );
			this.onChange();
			return true;

		} ).catch( error => {

			if ( generation !== this.generation || controller.signal.aborted ) return false;
			this.runtime?.setInteractive?.( false );
			this.state = { ...this.state, phase: 'error', status: saved ? `Project saved on this device. Shot preview unavailable: ${error.message}` : `Shot preview unavailable: ${error.message} Project settings remain saved on this device.` };
			this.onChange();
			return false;

		} );
		this.tail = operation.then( () => {} );
		return operation;

	}

}
