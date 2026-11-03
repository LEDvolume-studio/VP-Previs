import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { validateStudentProjectDocument, createStudentProjectDocument } from '@/previs/domain/StudentProjectSchema.js';
import { applyStudentCommand } from '@/previs/domain/StudentCommands.js';
import { StudentCatalogueClient } from '@/previs/api/StudentCatalogueClient.js';

const catalogue = new StudentCatalogueClient( { baseURL: location.origin } );
const hash = async bytes => Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
async function api( path, options = {} ) {

	const response = await fetch( path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...options } );
	const value = await response.json().catch( () => ( {} ) );
	if ( ! response.ok ) throw new Error( value.error?.message || 'Student default request failed.' );
	return value;

}

const json = ( method, body, id, extra = {} ) => ( { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id, ...extra }, body: JSON.stringify( body ) } );

/** Publishes a complete student sequence, or a single shot from a converted published preset. */
export default function StudentDefaultDialog( { open, onOpenChange } ) {

	const [ head, setHead ] = useState( null ), [ source, setSource ] = useState( null );
	const [ files, setFiles ] = useState( [] ), [ presets, setPresets ] = useState( [] );
	const [ error, setError ] = useState( '' ), [ status, setStatus ] = useState( '' ), [ busy, setBusy ] = useState( false );
	const [ preview, setPreview ] = useState( null ), [ shotId, setShotId ] = useState( '' );
	const [ previewReady, setPreviewReady ] = useState( false );
	const host = useRef( null ), staged = useRef( null ), pointer = useRef( null );
	const run = async fn => {

		setBusy( true ); setError( '' );
		try {

			await fn();

		} catch ( e ) {

			setError( e.message || 'The operation failed.' );

		} finally {

			setBusy( false );

		}

	};

	const refresh = async () => setHead( await api( '/v1/admin/student-default' ) );
	useEffect( () => {

		if ( open ) run( async () => {

			await refresh(); const result = await catalogue.list(); setPresets( result.presets );

		} );

	}, [ open ] );
	useEffect( () => {

		if ( ! open || ! preview?.document || ! shotId ) return;
		setPreviewReady( false );
		const controller = new AbortController(); let view;
		( async () => {

			try {

				setStatus( 'Preparing preview…' );
				const { createPublishedShotViewport } = await import( '@/student/PublishedShotViewport.js' );
				view = await createPublishedShotViewport( { document: preview.document, shotId, catalogue, signal: controller.signal, onStatus: setStatus } );
				if ( controller.signal.aborted ) {

					await view.dispose(); return;

				}

				view.setInteractive( false ); host.current?.replaceChildren( view.canvas ); setStatus( 'Preview ready.' ); setPreviewReady( true );

			} catch ( e ) {

				if ( ! controller.signal.aborted ) setError( e.message || 'Preview failed.' );

			}

		} )();

		return () => {

			controller.abort(); view?.dispose().catch( () => {} );

		};

	}, [ open, preview, shotId ] );
	const selectSource = document => {

		validateStudentProjectDocument( document ); setSource( document ); staged.current = null; pointer.current = null; setStatus( 'Source selected. The timeline and all clips will be retained.' );

	};

	const selectFile = event => run( async () => {

		const file = event.target.files?.[ 0 ]; if ( ! file ) return;
		selectSource( JSON.parse( await file.text() ) );

	} );
	const fromPreset = event => run( async () => {

		if ( ! event.target.value ) return;
		const preset = presets[ Number( event.target.value ) ]; if ( ! preset ) return;
		const converted = await catalogue.getPreset( preset );
		const document = applyStudentCommand( createStudentProjectDocument( { name: converted.name } ), { type: 'addPresetShot', preset: converted, shotId: crypto.randomUUID(), clipId: crypto.randomUUID() } ).document;
		selectSource( document ); setStatus( 'Converted from the selected published scene preset as a one-shot timeline.' );

	} );
	const stage = async () => {

		if ( ! source ) throw new Error( 'Select a student JSON file or converted preset first.' );
		for ( const asset of Object.values( source.narration.assets ) ) {

			let matched;
			for ( const file of files ) if ( file.size === asset.byteLength && await hash( await file.arrayBuffer() ) === asset.sha256 ) {

				matched = file; break;

			}

			if ( ! matched ) throw new Error( `Select the matching recorded audio for ${asset.assetId}.` );
			await api( `/v1/admin/student-default/media/${asset.sha256}`, { method: 'PUT', headers: { 'Content-Type': asset.mimeType }, body: matched } );

		}

		staged.current ||= { versionId: crypto.randomUUID(), document: structuredClone( source ), requestId: crypto.randomUUID() };
		const request = staged.current;
		const version = await api( '/v1/admin/student-default/versions', json( 'POST', { versionId: request.versionId, document: request.document }, request.requestId ) );
		setStatus( `Verified version ${version.versionId} is ready. Preview it, then set it as the student default.` );
		setPreview( version ); setShotId( version.document.clips[ 0 ]?.shotId || Object.keys( version.document.shots )[ 0 ] || '' );

	};

	const setDefault = async () => {

		if ( ! staged.current || ! preview || preview.versionId !== staged.current.versionId || ! previewReady ) throw new Error( 'Prepare and preview the new version first.' );
		pointer.current ||= { requestId: crypto.randomUUID(), versionId: preview.versionId, revision: head?.revision ?? - 1 };
		const p = pointer.current;
		await api( '/v1/admin/student-default', json( 'PUT', { versionId: p.versionId }, p.requestId, { 'If-Match': `"${p.revision}"` } ) );
		pointer.current = null; staged.current = null; await refresh(); setStatus( 'Student default updated. Existing projects are unchanged.' );

	};

	const previewHead = () => {

		if ( ! head?.version ) throw new Error( 'No published student default is available.' );
		setPreview( head.version ); setShotId( head.version.document.clips[ 0 ]?.shotId || Object.keys( head.version.document.shots )[ 0 ] || '' );

	};

	return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>Student default timeline</DialogTitle><DialogDescription>Publish a complete student timeline. This is separate from scene presets and the editor’s device-local default project.</DialogDescription></DialogHeader>
		<p>Published version: {head?.versionId || 'None'} · pointer revision {head?.revision ?? '—'}</p>
		<div className="flex flex-wrap gap-3"><button className="rounded border px-3 py-1" disabled={busy || ! head?.version} onClick={() => run( previewHead )}>Preview default</button><button className="rounded border px-3 py-1" disabled={busy} onClick={() => run( refresh )}>Refresh published version</button></div>
		<label>Student timeline JSON <input type="file" accept=".json,application/json" disabled={busy} onChange={selectFile}/></label>
		<label>Or use a published converted scene preset <select defaultValue="" disabled={busy} onChange={fromPreset}><option value="">Choose preset</option>{presets.map( ( p, i ) => <option key={`${p.presetId}@${p.version}`} value={i}>{p.name} · {p.version}</option> )}</select></label>
		<label>Recorded audio files <input type="file" multiple disabled={busy} onChange={e => setFiles( [ ...e.target.files ] )}/></label>
		{source && <p>Selected: {source.name} · revision {source.revision} · {source.clips.length} clips · {Object.keys( source.assets ).length} assets · {Object.keys( source.narration.assets ).length} recordings</p>}
		<div className="flex flex-wrap gap-3"><button className="rounded border px-3 py-1" disabled={busy || ! source} onClick={() => run( stage )}>Prepare and preview version</button><button className="rounded border px-3 py-1" disabled={busy || ! previewReady || ! staged.current || preview?.versionId !== staged.current.versionId} onClick={() => run( setDefault )}>Set as student default</button></div>
		{preview && <section><p>Preview version {preview.versionId} · SHA-256 {preview.sha256}</p><p>{Object.keys( preview.document.assets ).length} assets · {Object.keys( preview.document.baseScenes ).length} scene versions · {Object.keys( preview.document.narration.assets ).length} recordings</p><details><summary>Verified dependency inventory</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify( preview.dependencies, null, 2 )}</pre></details><label>Shot <select value={shotId} onChange={e => setShotId( e.target.value )}>{Object.values( preview.document.shots ).map( shot => <option key={shot.shotId} value={shot.shotId}>{shot.name}</option> )}</select></label><div ref={host} className="aspect-video w-full overflow-hidden bg-black [&_canvas]:h-full [&_canvas]:w-full"/></section>}
		<p role="status">{status}</p>{error && <p role="alert" className="text-red-500">{error}</p>}
	</DialogContent></Dialog>;

}
