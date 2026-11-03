import { useEffect, useState } from 'react';
import { prepareStudentProjectExport } from '../../previs/domain/StudentProjectSchema.js';

const MESSAGES = {
	missing: 'Please request a login link from your VP supervisor.',
	invalid: 'This login link is invalid or has been replaced. Please request a new link from your VP supervisor.',
	revoked: 'Access revoked · Local changes retained for download',
	offline: 'Connect to the internet to validate your login link and download your first scene.',
	unavailable: 'The student service is unavailable. Your saved work remains on this device.',
	bootstrapping: 'Opening your student workspace…',
	storage: 'Device storage is unavailable. Your saved projects have not been changed.',
	switchBlocked: 'Finish or save the current recording and any unsaved changes before switching accounts.'
};

function download( blob, name ) {

	const url = URL.createObjectURL( blob ), link = document.createElement( 'a' );
	link.href = url; link.download = name; link.click(); setTimeout( () => URL.revokeObjectURL( url ), 1000 );

}

export default function StudentAccessGate( { state, retry, repository, narration, pendingDocument, pendingBlob } ) {

	const [ projects, setProjects ] = useState( [] );
	useEffect( () => {

		let cancelled = false;
		if ( state === 'revoked' && repository ) repository.list().then( rows => {

			if ( cancelled ) return;
			const documents = pendingDocument ? [ pendingDocument, ...rows.filter( row => row.projectId !== pendingDocument.projectId ) ] : rows;
			setProjects( documents );

		} ).catch( () => {

			if ( ! cancelled && pendingDocument ) setProjects( [ pendingDocument ] );

		} );
		return () => {

			cancelled = true;

		};

	}, [ state, repository, pendingDocument ] );
	const exportDocument = document => download( new Blob( [ JSON.stringify( prepareStudentProjectExport( document ), null, 2 ) ], { type: 'application/json' } ), `${document.name}.student.json` );
	const exportAudio = async asset => {

		const row = await narration?.get( asset.assetId );
		if ( row?.blob ) download( row.blob, `${asset.assetId}.audio` );

	};

	return <main id="student-auth-state" data-state={state} style={{ maxWidth: '48rem', margin: '12vh auto', padding: '2rem', color: '#eef2f7', fontFamily: 'system-ui, sans-serif' }}>
		<h1>Sim Trav student editor</h1><p role="status">{MESSAGES[ state ] || MESSAGES.unavailable}</p>
		{retry && <button type="button" onClick={retry}>Retry</button>}
		{state === 'revoked' && <><p>Downloaded projects and recordings remain available on this device.</p>{projects.map( project => <section key={project.projectId}><h2>{project.name}</h2><button type="button" onClick={() => exportDocument( project )}>Download project JSON</button>{Object.values( project.narration.assets ).map( asset => <button type="button" key={asset.assetId} onClick={() => exportAudio( asset )}>Download recording {asset.assetId}</button> )}</section> )}{pendingBlob && <button type="button" onClick={() => download( pendingBlob, 'unsaved-recording.audio' )}>Download unfinished recording</button>}</>}
	</main>;

}
