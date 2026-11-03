import { createSequenceEvaluator } from '../sequence/evaluateSequence.js';
import { drawFramingBars } from './FrameFraming.js';

const superseded = () => new DOMException( 'A newer sequence frame was requested', 'AbortError' );

/**
 * App-owned bridge for preview seeks and offline export. The evaluator freezes
 * one revision; complete shots apply only at cuts, decoded media on every frame.
 * The host owns scene loading and GPU rendering. render() must synchronously
 * copy the freshly rendered GPU canvas into the supplied Canvas2D surface.
 */
export class SequenceRasterAdapter {

	constructor( { document, sceneAdapter, canvas, renderMedia, render, prepare = async () => {}, restore = async () => {}, editingShotId = Object.keys( document.shots )[ 0 ] } ) {

		this.evaluator = createSequenceEvaluator( document );
		if ( ! this.evaluator.totalFrames ) throw new Error( 'A raster sequence requires at least one shot placement' );
		for ( const method of [ 'captureState', 'applyShot', 'restoreState' ] ) if ( typeof sceneAdapter?.[ method ] !== 'function' ) throw new TypeError( `Missing sceneAdapter.${method}` );
		if ( typeof renderMedia !== 'function' || typeof render !== 'function' ) throw new TypeError( 'Sequence rendering requires media and raster ports' );
		this.canvas = canvas;
		this._context = canvas.getContext( '2d' );
		if ( ! this._context ) throw new TypeError( 'Sequence capture requires a Canvas2D surface' );
		// Keep an independent document for scene preflight; never the live editor.
		this._document = structuredClone( document );
		this._scene = sceneAdapter;
		this._editingShotId = editingShotId;
		this._renderMedia = renderMedia;
		this._render = render;
		this._prepare = prepare;
		this._restore = restore;
		this._tail = Promise.resolve();
		this._generation = 0;
		this._prepared = false;
		this._lifecycle = 'idle';
		this._stateToken = null;
		this._shotId = null;
		this._controller = null; this._inFlight = 0;

	}

	async prepare( options = {} ) {

		if ( this._lifecycle !== 'idle' ) throw new Error( 'Sequence raster adapter is already prepared or busy' );
		this._lifecycle = 'preparing';
		try {

			options.signal?.throwIfAborted();
			this._stateToken = await this._scene.captureState( this._document, this._editingShotId );
			this._prepared = true; // Partial host preparation still needs restoration.
			this._shotId = null;
			options.signal?.throwIfAborted();
			await this._prepare( options );
			options.signal?.throwIfAborted();
			this._lifecycle = 'ready';

		} catch ( error ) {

			this._lifecycle = this._prepared ? 'failed' : 'idle';
			throw error;

		}

	}

	async renderFrame( frame, { signal, ...options } = {} ) {

		if ( this._lifecycle !== 'ready' ) return Promise.reject( new Error( 'Prepare the sequence raster adapter and wait until ready before rendering' ) );
		const evaluation = this.evaluator.evaluate( frame, { timelineFrame: options.timelineFrame } );
		if ( evaluation.ended ) return Promise.reject( new RangeError( 'The sequence endpoint is not a renderable frame' ) );
		const generation = ++ this._generation;
		this._controller?.abort( superseded() );
		const controller = new AbortController();
		this._controller = controller;
		const abort = () => controller.abort( signal.reason );
		if ( signal?.aborted ) abort();
		else signal?.addEventListener( 'abort', abort, { once: true } );
		const current = () => {

			controller.signal.throwIfAborted();
			if ( generation !== this._generation ) throw superseded();

		};

		this._inFlight ++;
		// A cancelled decode/application must settle before another shot can write.
		// Old work may finish applying state, but can never paint a stale frame.
		const operation = this._tail.catch( () => {} ).then( async () => {

			current();
			if ( evaluation.shot.shotId !== this._shotId ) {

				await this._scene.applyShot( this._document, evaluation.shot.shotId, { mediaTimes: new Map( evaluation.led.map( entry => [ entry.wallId, entry.sourceTimeSeconds ] ) ) } );
				this._shotId = evaluation.shot.shotId;
				current();

			}

			await this._renderMedia( evaluation, { ...options, signal: controller.signal } );
			current();
			const result = this._render( evaluation, options );
			if ( result && typeof result.then === 'function' ) throw new TypeError( 'Raster render must copy its frame synchronously' );
			drawFramingBars( this._context, evaluation.shot.snapshot.camera.frameOverlayRatio );
			return evaluation;

		} ).finally( () => {

			this._inFlight --; signal?.removeEventListener( 'abort', abort );

		} );
		this._tail = operation;
		return operation;

	}

	/** Cut within the same prepared project without restoring its editing baseline. */
	retarget( document, editingShotId ) {

		if ( this._lifecycle !== 'ready' || this._inFlight ) throw new Error( 'Sequence adapter is not ready for a shot cut.' );
		const evaluator = createSequenceEvaluator( document );
		if ( ! evaluator.totalFrames || ! document.shots[ editingShotId ] ) throw new Error( 'A prepared cut requires a valid shot.' );
		this._document = structuredClone( document ); this.evaluator = evaluator;
		this._editingShotId = editingShotId; this._shotId = null;

	}

	async restore() {

		if ( [ 'preparing', 'restoring' ].includes( this._lifecycle ) ) throw new Error( 'Sequence raster adapter is busy' );
		if ( ! this._prepared ) return;
		this._lifecycle = 'restoring';
		++ this._generation;
		this._controller?.abort( superseded() );
		await this._tail.catch( () => {} );
		const errors = [];
		try {

			await this._scene.restoreState( this._stateToken );

		} catch ( error ) {

			errors.push( error );

		}

		try {

			await this._restore();

		} catch ( error ) {

			errors.push( error );

		}

		this._prepared = false;
		this._stateToken = null;
		this._shotId = null;
		this._lifecycle = errors.length ? 'failed' : 'idle';
		if ( errors.length ) throw new AggregateError( errors, 'Sequence viewport restoration failed' );

	}

}
