import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ShotInspector from '../../../app/src/student/editor/ShotInspector.jsx';
import { applyStudentCommand } from '../../../app/src/previs/domain/StudentCommands.js';
import '../../../app/src/student/editor/editor.css';

export function checkInspectorLoadingStates( host ) {

	const root = createRoot( host );
	for ( const props of [ {}, { shot: null, blurComparison: null }, { blurComparison: { shotId: 'previous-shot', wallId: 'previous-wall', results: [] } } ] ) {

		flushSync( () => root.render( <ShotInspector {...props} /> ) );
		if ( ! host.textContent.includes( 'Choose a timeline shot' ) ) throw new Error( 'Inspector failed to render its loading state.' );

	}
	flushSync( () => root.unmount() );

}

export function mountInspector( view, project, host ) {

	function Inspector() {

		const [ doc, setDocument ] = useState( project ), [ busy, setBusy ] = useState( false ), [ comparison, setComparison ] = useState( null );
		const shotId = doc.clips[ 0 ].shotId;
		window.inspectorDocument = doc;
		return <ShotInspector shot={doc.shots[ shotId ]} capabilities={view.capabilities} disabled={busy} blurComparison={comparison} onFocalLengthPreview={camera => view.previewFocalLength( camera )} onLEDBlurPreview={( wallId, value ) => view.previewLEDBlur( wallId, value )} onCompareLEDBlur={async ( wallId, amount ) => {

			setBusy( true );
			try {

				setComparison( { shotId, wallId, amount, results: await view.compareLEDBlur( wallId, amount ) } );

			} finally {

				setBusy( false );

			}

		}} onEdit={async build => {

			setBusy( true );
			try {

				const result = applyStudentCommand( doc, { type: 'replaceShot', shot: build( doc.shots[ shotId ] ) } );
				await view.updateDocument( result.document, shotId );
				setDocument( result.document );

			} finally {

				setBusy( false );

			}

		}} />;

	}

	createRoot( host ).render( <Inspector /> );

}
