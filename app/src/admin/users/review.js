import { ReadOnlyStudentReview } from './ReadOnlyStudentReview.js';
import './review.css';

const root = document.querySelector( '#review' );
const params = new URLSearchParams( location.search );
const element = ( name, text, attrs = {} ) => {

	const node = document.createElement( name ); node.textContent = text; Object.assign( node, attrs ); return node;

};

const heading = element( 'h1', 'Student project review' ), back = element( 'a', '← Back to users', { href: '/admin/users/' } );
const summary = element( 'p', 'Loading latest cloud-synced version…', { id: 'review-summary' } );
const message = element( 'p', '', { id: 'review-status', role: 'status' } );
const host = element( 'div', '', { id: 'review-viewport' } ), controls = element( 'div', '', { className: 'controls' } );
const select = element( 'select', '', { id: 'review-shot', ariaLabel: 'Shot' } );
const play = element( 'button', 'Play sequence', { id: 'review-play', type: 'button', disabled: true } );
const stop = element( 'button', 'Pause', { id: 'review-pause', type: 'button', disabled: true } );
const time = element( 'span', '0:00', { id: 'review-time' } );
controls.append( select, play, stop, time ); root.append( back, heading, summary, message, host, controls );
let review;
const showError = error => {

	message.textContent = error?.message || 'Review is unavailable.';

};

try {

	review = new ReadOnlyStudentReview( { userId: params.get( 'user' ), projectId: params.get( 'project' ) } );
	const { project, document: doc } = await review.load();
	summary.textContent = `${doc.name} · cloud revision ${project.serverRevision} · ${project.archived ? 'Archived' : 'Active'}. This is the latest cloud-synced version; offline edits may not yet be visible.`;
	for ( const span of review.evaluator.spans ) {

		const option = element( 'option', doc.shots[ span.shotId ].name, { value: String( span.startFrame ) } ); select.append( option );

	}

	if ( ! review.evaluator.totalFrames ) {

		message.textContent = 'This sequence has no shots.'; select.disabled = true;

	} else {

		await review.render( 0, host, text => {

			message.textContent = text;

		} ); message.textContent = 'Read-only review'; play.disabled = false;
		select.addEventListener( 'change', async () => {

			try {

				review.stop(); stop.disabled = true; play.disabled = true; await review.render( Number( select.value ), host, text => {

					message.textContent = text;

				} ); message.textContent = 'Read-only review'; play.disabled = false;

			} catch ( error ) {

				showError( error );

			}

		} );
		play.addEventListener( 'click', async () => {

			try {

				play.disabled = true; stop.disabled = false; await review.play( host, frame => {

					time.textContent = `${Math.floor( frame / 25 )}s`;
					time.dataset.frame = String( frame );

				}, error => {

					showError( error ); play.disabled = false; stop.disabled = true;

				}, () => {

					play.disabled = false; stop.disabled = true;

				} );

			} catch ( error ) {

				showError( error ); play.disabled = false; stop.disabled = true;

			}

		} );
		stop.addEventListener( 'click', () => {

			review.stop(); play.disabled = false; stop.disabled = true;

		} );

	}

} catch ( error ) {

	showError( error );

}

window.addEventListener( 'pagehide', () => {

	void review?.dispose();

}, { once: true } );
