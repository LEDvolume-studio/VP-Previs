import { validateStudentProjectDocument } from '../../previs/domain/StudentProjectSchema.js';
import { createSequenceEvaluator } from '../../previs/sequence/evaluateSequence.js';
import { StudentCatalogueClient } from '../../previs/api/StudentCatalogueClient.js';
import { createPublishedShotViewport } from '../../student/PublishedShotViewport.js';
import { LocalNarration } from '../../student/editor/LocalNarration.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** Review deliberately exposes only read and transport methods; no save, sync or upload service exists here. */
export class ReadOnlyStudentReview {

	constructor( { projectId, userId, fetch = globalThis.fetch.bind( globalThis ), catalogue = new StudentCatalogueClient( { baseURL: location.origin } ) } ) {

		if ( ! uuid.test( projectId || '' ) || ! uuid.test( userId || '' ) ) throw new Error( 'Invalid project address.' );
		Object.assign( this, { projectId, userId, fetch, catalogue } ); this.controller = new AbortController(); this.frame = 0; this.generation = 0;
		this.narration = new LocalNarration( { store: { get: async assetId => {

			const asset = Object.values( this.document.narration.assets ).find( item => item.assetId === assetId );
			if ( ! asset ) throw new Error( 'Recording not found.' );
			const response = await this.fetch( `/v1/admin/projects/${this.projectId}/narration/${encodeURIComponent( `${asset.assetId}@${asset.version}` )}/content`, { credentials: 'same-origin', cache: 'no-store', signal: this.controller.signal } );
			if ( ! response.ok ) throw new Error( 'Recording is unavailable.' ); return { blob: await response.blob() };

		} } } );

	}
	async load() {

		const response = await this.fetch( `/v1/admin/projects/${this.projectId}`, { credentials: 'same-origin', cache: 'no-store', signal: this.controller.signal } );
		if ( ! response.ok ) throw new Error( 'Cloud project is unavailable.' );
		const result = await response.json();
		if ( result.project?.projectId !== this.projectId || result.project?.ownerId !== this.userId ) throw new Error( 'Project owner does not match.' );
		validateStudentProjectDocument( result.document ); this.document = structuredClone( result.document ); this.summary = result.project; this.evaluator = createSequenceEvaluator( this.document );
		return { project: structuredClone( this.summary ), document: structuredClone( this.document ) };

	}
	async render( frame, host, onStatus = () => {} ) {

		if ( ! this.evaluator || ! this.evaluator.totalFrames ) return;
		const position = Math.min( Math.max( 0, Math.floor( frame ) ), this.evaluator.totalFrames - 1 );
		const evaluation = this.evaluator.evaluate( position, { timelineFrame: position } );
		if ( ! this.viewport || ! this.viewport.canUpdate( this.document, evaluation.shot.shotId ) ) {

			await this.viewport?.dispose();
			this.viewport = await createPublishedShotViewport( { document: this.document, shotId: evaluation.shot.shotId, catalogue: this.catalogue, signal: this.controller.signal, onStatus } );
			this.viewport.setInteractive( false ); host.replaceChildren( this.viewport.canvas );

		} else if ( this.viewport.shotId !== evaluation.shot.shotId ) await this.viewport.updateDocument( this.document, evaluation.shot.shotId, { playback: true, timelineFrame: position } );
		await this.viewport.renderFrame( evaluation.localFrame, { timelineFrame: position } ); this.frame = position; return evaluation;

	}
	async play( host, onFrame, onError, onEnd = () => {} ) {

		this.stop(); const generation = ++ this.generation; await this.narration.play( this.document, this.frame );
		const start = performance.now(), initial = this.frame;
		const tick = async () => {

			if ( generation !== this.generation ) return;
			const frame = Math.min( this.evaluator.totalFrames - 1, initial + Math.floor( ( performance.now() - start ) * 25 / 1000 ) );
			try {

				await this.render( frame, host ); onFrame( frame ); if ( frame < this.evaluator.totalFrames - 1 && generation === this.generation ) this.timer = requestAnimationFrame( tick ); else {

					this.stop(); onEnd();

				}

			} catch ( error ) {

				this.stop(); onError( error );

			}

		};

		this.timer = requestAnimationFrame( tick );

	}
	stop() {

		++ this.generation; cancelAnimationFrame( this.timer ); this.narration.stopPlayback();

	}
	async dispose() {

		this.stop(); this.controller.abort(); await this.viewport?.dispose(); await this.narration.dispose();

	}

}
