import PlateDownloadStatus from '../../components/plates/PlateDownloadStatus.jsx';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Camera, Box, ChevronDown, Check, CloudCheck, LoaderCircle, Users, Upload, Settings, Maximize, Hand, Crosshair, X, FolderOpen, Download, Plus, FileUp, Info, Save } from 'lucide-react';
import { EditorSession } from './EditorSession.js';
import { LocalNarration } from './LocalNarration.js';
import { AccountWorkspace, ValidatedIdentityRegistry, accountSelectionKey } from '../accounts/AccountWorkspace.js';
import { AccountProjectClient } from '../../previs/api/AccountProjectClient.js';
import { AccountSyncService } from '../../previs/sync/AccountSyncService.js';
import { bootstrapStudentProject, refreshAccountDefault, removeLoginFragment, resolveStudentIdentity } from '../accounts/StudentIdentity.js';
import StudentAccessGate from '../accounts/StudentAccessGate.jsx';
import ShotInspector from './ShotInspector.jsx';
import SequenceTimeline from './SequenceTimeline.jsx';
import './editor.css';

const PlateLibraryDialog = lazy( () => import( '../../components/plates/PlateLibraryDialog.jsx' ) );

let session;
const createViewport = async options => {

	const { createPublishedShotViewport } = await import( '../PublishedShotViewport.js' );
	return createPublishedShotViewport( options );

};

const equal = ( a, b ) => JSON.stringify( a ) === JSON.stringify( b );
// Apply only fields intentionally edited in an inspector; pending live camera
// movement may have been flushed since that inspector snapshot was displayed.
function mergeEdits( current, baseline, edited ) {

	if ( equal( baseline, edited ) ) return structuredClone( current );
	if ( Array.isArray( edited ) && Array.isArray( baseline ) && Array.isArray( current ) && edited.length === baseline.length && current.length === baseline.length ) return edited.map( ( value, index ) => mergeEdits( current[ index ], baseline[ index ], value ) );
	if ( edited && baseline && typeof edited === 'object' && ! Array.isArray( edited ) ) return Object.fromEntries( Object.keys( edited ).map( key => [ key, mergeEdits( current?.[ key ], baseline[ key ], edited[ key ] ) ] ) );
	return structuredClone( edited );

}

export function Editor() {

	// The pinned beta compiler hoists optional-chain dependencies through null.
	// eslint-disable-next-line react-compiler/react-compiler -- Required by the pinned runtime compiler; its lint version reports it unused.
	'use no memo';

	const state = useSyncExternalStore( session.subscribe, session.getSnapshot );
	const [ menu, setMenu ] = useState( false ), [ dialog, setDialog ] = useState( null );
	const [ online, setOnline ] = useState( navigator.onLine );
	const host = useRef( null ), viewport = useRef( null ), file = useRef( null );
	const doc = state.document;
	const clip = doc?.clips.find( item => item.clipId === state.selectedClipId );
	const shot = clip && doc.shots[ clip.shotId ];
	const index = doc?.clips.findIndex( item => item.clipId === state.selectedClipId ) ?? - 1;
	const locked = state.busy || state.pending || state.playing || !! state.recording;
	useEffect( () => {

		const update = () => setOnline( navigator.onLine );
		window.addEventListener( 'online', update ); window.addEventListener( 'offline', update );
		return () => {

			window.removeEventListener( 'online', update ); window.removeEventListener( 'offline', update );

		};

	}, [] );
	const currentPreset = state.presets.find( preset => shot && equal( preset.camera, shot.snapshot.camera ) );

	useEffect( () => {

		document.title = 'Sim Trav · Student editor';
		session.boot();
		const warn = event => {

			if ( session.state.pending || session.state.dirty || session.state.recording ) {

				event.preventDefault(); event.returnValue = '';

			}

		};

		window.addEventListener( 'beforeunload', warn );
		return () => {

			window.removeEventListener( 'beforeunload', warn ); session.dispose();

		};

	}, [] );
	useEffect( () => {

		const space = event => {

			if ( ( event.code !== 'Space' && event.key !== ' ' ) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || dialog || menu ) return;
			const target = event.target;
			const typing = target.isContentEditable || target.closest?.( 'textarea, select, [role="textbox"]' ) || ( target.tagName === 'INPUT' && ! [ 'range', 'checkbox', 'radio', 'button', 'submit', 'reset' ].includes( target.type ) );
			if ( typing ) return;
			// Capture both halves of the key so focused buttons/checkboxes cannot
			// activate on release, and held Space toggles playback only once.
			event.preventDefault(); event.stopPropagation();
			const current = session.state;
			if ( event.type === 'keydown' && ! event.repeat && current.ready && ! current.busy && ! current.pending && ! current.recording && current.document?.clips.length ) session.playPause();

		};

		window.addEventListener( 'keydown', space, true ); window.addEventListener( 'keyup', space, true );
		return () => {

			window.removeEventListener( 'keydown', space, true ); window.removeEventListener( 'keyup', space, true );

		};

	}, [ dialog, menu ] );
	useLayoutEffect( () => {

		if ( host.current && session.runtime ) host.current.replaceChildren( session.runtime.canvas );

	}, [ state.ready, state.loading, state.document ] );

	const editShot = replacement => session.edit( document => {

		const current = document.shots[ shot.shotId ];
		return { type: 'replaceShot', shot: typeof replacement === 'function' ? replacement( current ) : mergeEdits( current, shot, replacement ) };

	} );
	const adjacent = direction => {

		const next = doc.clips[ Math.max( 0, Math.min( doc.clips.length - 1, index + direction ) ) ]; if ( next ) session.selectClip( next.clipId );

	};

	const cloud = state.cloudStatuses?.[ doc?.projectId ];
	const saveText = state.pending && state.error ? 'Not saved on this device — Retry / Download' : state.pending || state.dirty ? 'Saving on this device…' : ! online ? 'Saved on this device · Offline' : cloud?.conflict ? 'Changes preserved · Review conflict' : cloud?.state === 'backing-up' ? 'Syncing…' : cloud?.unavailable ? 'Saved on this device · Cloud unavailable — Retry' : cloud?.pending || ! cloud?.lastSyncedAt || cloud.acknowledgedRevision !== doc?.revision ? 'Saved on this device · Waiting to sync' : `Saved to cloud · ${new Date( cloud.lastSyncedAt ).toLocaleTimeString()}`;

	const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : viewport.current.requestFullscreen();
	const doMenu = action => {

		setMenu( false ); action();

	};

	return <div className="sim-editor">
		<header className="sim-header">
			<a className="sim-brand" href="/student/" aria-label="Sim Trav workspace"><span className="sim-brand-mark"><i/><i/></span><strong>Sim Trav</strong></a>
			<div className="sim-project-menu"><button className="sim-project-button" onClick={() => setMenu( ! menu )} aria-expanded={menu}><span>{doc?.name || 'New project'}</span><ChevronDown size={17}/></button>
				{menu && <div className="sim-menu" role="menu"><p>Account projects</p>{state.projects.map( item => <div key={item.projectId}><button role="menuitem" disabled={locked || item.archived} onClick={() => doMenu( () => session.action( () => session.openAccountProject( item.projectId ) ) )}><FolderOpen size={15}/>{item.name} {item.archived ? '· Archived' : item.local ? '· On this device' : '· Cloud'}{item.projectId === doc?.projectId && <Check size={15}/>}</button><button disabled={locked || ! item.local} onClick={() => doMenu( () => session.action( () => session.setProjectArchived( item.projectId, ! item.archived ) ) )}>{item.archived ? 'Restore' : 'Archive'}</button></div> )}<hr/><button role="menuitem" disabled={locked} onClick={() => doMenu( () => session.action( () => session.newSharedStartingProject() ) )}><Plus size={15}/>New project</button><button role="menuitem" disabled={locked || ! doc} onClick={() => doMenu( () => session.action( () => session.duplicateProject() ) )}>Duplicate project</button><button role="menuitem" disabled={locked || ! doc} onClick={() => doMenu( () => setDialog( 'settings' ) )}>Rename project</button><button role="menuitem" disabled={locked} onClick={() => doMenu( () => session.action( () => session.listLegacyProjects() ) )}>Import device project</button>{state.legacyProjects?.map( item => <button key={item.projectId} role="menuitem" disabled={locked} onClick={() => doMenu( () => session.action( () => session.importLegacyProject( item.projectId ) ) )}>Import {item.name}</button> )}<button role="menuitem" disabled={locked} onClick={() => doMenu( () => file.current.click() )}><FileUp size={15}/>Import student JSON</button><button role="menuitem" disabled={! doc || state.busy} onClick={() => doMenu( () => session.exportJSON() )}><Download size={15}/>Download project JSON</button></div>}
			</div>
			<div id="editor-save-status" className={`sim-save ${state.pending && state.error ? 'is-error' : ''}`} role="status">{cloud?.state === 'backing-up' ? <LoaderCircle size={20} className="sim-spin"/> : cloud?.lastSyncedAt && ! cloud?.pending && cloud.acknowledgedRevision === doc?.revision && ! state.dirty && ! state.pending && online ? <CloudCheck size={21}/> : <Save size={21}/>}<span>{saveText}</span>{cloud?.unavailable && <button onClick={() => session.accountContext?.sync.retry( doc.projectId )}>Retry</button>}{cloud?.conflict && <><button onClick={() => session.action( () => session.resolveConflict( 'cloud' ) )}>Reopen cloud</button><button onClick={() => session.action( () => session.resolveConflict( 'copy' ) )}>Save local as copy</button></>}</div>
			{state.offlineReadiness && <div role="status" className="sim-save" title={state.offlineReason || 'Project assets on this device'}>{state.offlineReadiness === 'ready' ? 'Ready offline' : state.offlineReadiness === 'preparing' ? 'Preparing offline…' : 'Offline preparation incomplete'}</div>}
			<div className="sim-header-actions"><button onClick={() => setDialog( 'plates' )}>Select Driving Plates</button><button onClick={() => setDialog( 'share' )}><Users size={18}/>Share</button><button className="sim-primary" onClick={() => setDialog( 'export' )}><Upload size={18}/>Export</button><button className="sim-icon-button" aria-label="Workspace settings" onClick={() => setDialog( 'settings' )}><Settings size={22}/></button></div>
		</header>
		<PlateDownloadStatus onOpen={() => setDialog( 'plates' )}/>
		{import.meta.env.DEV && shot?.baseScene.sceneId === 'local-fixture-led-mannequin-studio-suv' && ! shot.snapshot.materials && <div className="sim-appearance-update"><span>This study uses the earlier diagnostic materials and lighting.</span><button disabled={locked || ! state.ready} onClick={() => session.action( () => session.matchAdminAppearance() )}>Open copy with admin appearance</button></div>}
		{state.error && <div className="sim-error" role="alert"><Info size={17}/><span>{state.error}</span>{state.pending && <><button onClick={() => session.action( () => session.savePending(), { flush: false, allowPending: true } )}>Retry save</button><button onClick={() => session.download()}>Download attempted project</button><button onClick={() => session.action( async () => {

			const latest = await session.repository.get( state.document.projectId ); await session.openDocument( latest );

		}, { flush: false, allowPending: true } )}>Open latest saved version</button></>}</div>}
		<div className="sim-main">
			<aside className="sim-presets"><h2><Camera size={22}/>Scene presets</h2><div className="sim-gallery-heading"><span>Project presets</span><small>{currentPreset ? 'Preset' : 'Custom'}</small></div><div className="sim-preset-grid">{state.presets.map( preset => <div className="sim-preset-card" key={preset.id}><button className={`sim-preset ${currentPreset?.id === preset.id ? 'is-selected' : ''}`} aria-pressed={currentPreset?.id === preset.id} disabled={locked || ! state.ready} onClick={() => session.applyPreset( preset )} title="Apply preset positions, visibility and camera to the selected shot">{preset.thumbnail ? <img src={preset.thumbnail} alt={`${preset.name} camera viewpoint`}/> : <div className="sim-preset-empty"><Camera/></div>}{currentPreset?.id === preset.id && <span className="sim-preset-check"><Check size={13}/></span>}<span>{preset.name}</span></button>{preset.studentPreset && <button className="sim-use-scene-preset" disabled={locked || !! doc && ! state.ready} aria-label={`Use scene preset ${preset.name}`} title="Add a shot using preset positions and visibility in this project" onClick={() => session.addScenePreset( preset )}><Plus size={13}/>Use scene preset</button>}</div> )}</div>{! state.presets.length && <p className="sim-empty-note">Camera viewpoints appear when a supported scene is open.</p>}<div className="sim-library-note"><span className="sim-dot"/>{session.presetRepository?.storage === 'cloud' ? 'Published presets' : 'Presets on this device'}<br/><small>Click a thumbnail to apply object positions, visibility and camera framing. Use scene preset adds a shot using positions and visibility in this project. Admin updates appear here automatically.</small></div></aside>
			<section className="sim-viewport" ref={viewport} aria-label="3D Viewer"><div className="sim-viewport-header"><h2><Box size={23}/>3D Viewer</h2><div><button type="button" className="sim-view-mode" role="switch" aria-label="Viewer mode" title="Sequencer camera / Viewport camera" aria-checked={state.mode === 'inspection'} disabled={locked || ! state.ready} onClick={() => session.setMode( state.mode === 'shot' ? 'inspection' : 'shot' )}><span className={state.mode === 'shot' ? 'is-active' : ''}><span>Sequencer</span><Camera size={15} aria-label="camera"/></span><span className={state.mode === 'inspection' ? 'is-active' : ''}><span>Viewport</span><Camera size={15} aria-label="camera"/></span></button><select aria-label="Framing ratio" value={shot?.snapshot.camera.frameOverlayRatio || '16:9'} disabled={locked || ! shot} onChange={event => {

				const replacement = structuredClone( shot ); replacement.snapshot.camera.frameOverlayRatio = event.target.value; editShot( replacement );

			}}><option>16:9</option><option>4:3</option><option>2.40:1</option></select></div></div>
			<div className="sim-stage"><div id="sim-viewport-host" ref={host}/>{( ! state.ready || ! doc ) && <div className="sim-loading"><LoaderCircle className="sim-spin" size={28}/><strong>{state.loading || 'Opening scene…'}</strong>{import.meta.env.DEV && ! state.busy && <button className="sim-primary" onClick={() => session.action( () => session.newDemo() )}>Open studio study</button>}</div>}
				<div className="sim-view-tools"><button aria-label="Return to shot POV" title="View the selected shot" disabled={locked || ! state.ready} onClick={() => session.setMode( 'shot' )}><Crosshair size={21}/></button><span title="Middle mouse pans. Right mouse + WASD flies."><Hand size={21}/></span><button aria-label="Fullscreen viewer" onClick={fullscreen}><Maximize size={20}/></button></div>
				<div className="sim-axis" aria-label="World orientation reference: Y up"><span className="sim-axis-y">Y</span><span className="sim-axis-z">Z</span><span className="sim-axis-x">X</span><i/></div>
				<div className="sim-shot-label">{shot ? `${String( index + 1 ).padStart( 2, '0' )} · ${shot.name}` : 'Scene workspace'}{state.mode === 'inspection' && <small>Inspection · shot framing protected</small>}</div>
			</div><div className="sim-navigation-status"><span>{state.playing ? `Sequence playback · ${state.mode === 'inspection' ? 'Scene inspection' : 'Shot POV'}` : state.mode === 'inspection' ? 'Scene inspection · navigation does not change your shot' : 'Shot POV · camera movement saves to this shot'}</span><small>RMB + WASD · Q/E up/down · Shift faster · middle mouse pan</small></div>
			</section>
			<ShotInspector shot={shot} capabilities={session.runtime?.capabilities} disabled={locked || ! state.ready} onEdit={editShot} onFocalLengthPreview={camera => session.runtime?.previewFocalLength( camera )} onLEDBlurPreview={( wallId, value ) => session.runtime?.previewLEDBlur( wallId, value )} onCompareLEDBlur={( wallId, amount ) => session.compareLEDBlur( wallId, amount )} blurComparison={state.blurComparison} onPrevious={() => adjacent( - 1 )} onNext={() => adjacent( 1 )}/>
		</div>
		{doc ? <SequenceTimeline document={doc} frame={state.frame} selectedClipId={state.selectedClipId} playing={state.playing} recording={state.recording} onRecord={() => session.recordVoiceover()} onDiscardRecording={() => session.cancelVoiceover()} disabled={state.busy || state.pending || ! state.ready || !! state.recording} thumbnails={state.thumbnails} onSeek={frame => session.seek( frame )} onSelectClip={id => session.selectClip( id )} onPlayPause={() => session.playPause()} onStop={() => session.stop()} onAddShot={() => session.addShot()} onUndo={() => session.undoEdit()} onRedo={() => session.redoEdit()} canUndo={state.canUndo} canRedo={state.canRedo} onCommand={command => session.edit( command )}/> : <div className="sim-timeline-empty">Open a project to start your sequence</div>}
		<footer className="sim-footer"><span>Local progress review · 1920 × 1080 · 25 fps</span><span>Drag shots to reorder · Drag right edges to change duration</span></footer>
		<input hidden ref={file} type="file" accept=".json,application/json" aria-label="Import student project" onChange={async event => {

			const selected = event.target.files[ 0 ]; if ( selected ) {

				if ( selected.size > 16 * 1024 * 1024 ) session.set( { error: 'Choose a student JSON file no larger than 16 MiB.' } ); else await session.importJSON( await selected.text() );

			}

		}}/>
		{dialog === 'plates' && <Suspense fallback={<p role="status">Opening plate library…</p>}><PlateLibraryDialog onClose={() => setDialog( null )} onSelect={async manifest => {

			await session.selectDrivingPlateSet( manifest ); setDialog( null );

		}}/></Suspense>}
		{dialog && dialog !== 'plates' && <div className="sim-dialog-backdrop" onClick={() => setDialog( null )}><section className="sim-dialog" role="dialog" aria-modal="true" aria-labelledby="sim-dialog-title" onClick={event => event.stopPropagation()}><button className="sim-dialog-close sim-icon-button" aria-label="Close dialog" onClick={() => setDialog( null )}><X size={20}/></button><h2 id="sim-dialog-title">{dialog === 'settings' ? 'Workspace settings' : dialog === 'share' ? 'Share your sequence' : 'Export your sequence'}</h2>{dialog === 'settings' ? <><p>Shot POV edits your selected shot’s camera. Scene inspection uses a separate camera and keeps that framing unchanged.</p><label className="sim-dialog-label">Project name<input key={doc?.projectId} defaultValue={doc?.name} disabled={locked || ! doc} onBlur={event => {

			const name = event.target.value.trim(); if ( name && name !== doc.name ) session.edit( { type: 'renameProject', name } );

		}}/></label><p className="sim-subtle">Projects save on this browser. Check the offline indicator for this project’s media readiness.</p><a href="/student/workbench/">Open engineering workbench</a></> : dialog === 'share' ? <><p>Your supervisor can open the latest cloud-synced version of your projects. Changes still on this device become visible after they sync.</p></> : <><p>Project MP4 export is still being connected. Voiceover recording and playback are available in the timeline. You can download your editable project now.</p><button className="sim-primary" disabled={! doc} onClick={() => session.exportJSON()}><Download size={17}/>Download student JSON</button><p className="sim-subtle">JSON contains scene settings and media references. Download recorded audio separately from this browser.</p>{Object.values( doc?.narration.assets || {} ).map( asset => <button key={asset.assetId} className="sim-primary" onClick={() => session.exportNarration( asset )}><Download size={17}/>Download audio {asset.assetId}</button> )}</>}</section></div>}
	</div>;

}

const root = createRoot( document.querySelector( '#student-app' ) );
const registry = new ValidatedIdentityRegistry();
const manager = new AccountWorkspace();
let activation = 0, identityRequest, activeSync;

function gate( state, options = {} ) {

	root.render( <StudentAccessGate state={state} {...options}/> );

}

async function accessRevoked( current, workspace ) {

	if ( session !== current || ! manager.isCurrent( workspace ) ) return;
	activeSync?.stop();
	if ( current.state.recording === 'recording' ) await current.finishVoiceover();
	await current.tail.catch( () => {} );
	await current.flushCamera().catch( () => false );
	const pendingDocument = current.state.document;
	const pendingBlob = current.narration.pendingBlob;
	// Keep the workspace open for explicit local exports; its queue has stopped.
	gate( 'revoked', { repository: workspace.repository, narration: workspace.narration, pendingDocument, pendingBlob } );

}

async function startEditor() {

	const run = ++ activation;
	identityRequest?.abort(); identityRequest = new AbortController();
	const signal = identityRequest.signal;
	let resolved;
	try {

		resolved = await resolveStudentIdentity( registry, { signal } );
		if ( run !== activation ) return;
		if ( ! resolved.identity ) {

			gate( 'missing' ); return;

		}

		// Finish the old account before changing the active identity marker.
		if ( session && ! session.closed ) {

			await session.tail.catch( () => {} );
			if ( session.state.recording || session.pending || ! await session.flushCamera() ) {

				session.set( { error: 'Finish or save the current recording and unsaved changes before switching accounts.' } ); return;

			}

		}

		if ( resolved.incoming ) {

			await registry.writeValidated( resolved.identity );
			if ( run !== activation ) return;
			removeLoginFragment();

		}

		const identity = resolved.identity;
		let current, sync, refreshDefault;
		const workspace = await manager.switchAccount( identity.userId, { stop: async () => {

			sync?.stop(); window.removeEventListener( 'online', refreshDefault ); window.removeEventListener( 'focus', refreshDefault ); if ( current && ! current.closed ) await current.dispose();

		} } );
		if ( ! workspace || run !== activation ) return;
		const client = new AccountProjectClient( { baseURL: location.origin, credential: identity.credential } );
		if ( ! ( await workspace.repository.list() ).length ) {

			gate( 'bootstrapping' );
			await bootstrapStudentProject( { client, workspace, signal: workspace.controller.signal } );
			if ( run !== activation || ! manager.isCurrent( workspace ) ) return;

		}

		current = new EditorSession( { createViewport, repository: workspace.repository, narration: new LocalNarration( { store: workspace.narration } ), selectionKey: accountSelectionKey( identity.userId ) } );
		sync = new AccountSyncService( { repository: workspace.repository, client, narration: workspace.narration, onStatus: event => {

			if ( session !== current || ! manager.isCurrent( workspace ) ) return;
			if ( event.state === 'revoked' ) {

				void accessRevoked( current, workspace ); return;

			}

			current.setCloudStatus?.( event );
			if ( event.state === 'discovered' ) void current.refreshProjects().catch( () => {} );

		} } );
		current.accountContext = { manager, workspace, client, sync, identity };
		refreshDefault = () => { void refreshAccountDefault( { client, workspace, signal: workspace.controller.signal } ).catch( () => {} ); };
		window.addEventListener( 'online', refreshDefault ); window.addEventListener( 'focus', refreshDefault );
		session = current; activeSync = sync;
		root.render( <Editor/> );
		// Cached work opens immediately; an upload or network refresh cannot block it.
		void sync.start();
		refreshDefault();

	} catch ( error ) {

		if ( run !== activation || signal.aborted ) return;
		const retry = () => void startEditor();
		if ( session && ! session.closed ) {

			session.set( { error: 'The new login link could not be opened. Your current project remains on this device.' } ); return;

		}

		if ( error?.code === 'INVALID_LINK' || ( error?.code === 'AUTHORIZATION' && resolved?.incoming !== false && error.status !== 403 ) ) gate( 'invalid', { retry } );
		else if ( error?.code === 'AUTHORIZATION' ) gate( 'revoked', { retry } );
		else if ( [ 'NETWORK', 'TIMEOUT' ].includes( error?.code ) ) gate( 'offline', { retry } );
		else if ( error?.code ) gate( 'unavailable', { retry } );
		else gate( 'storage', { retry } );

	}

}

window.addEventListener( 'hashchange', () => {

	if ( new URLSearchParams( location.hash.slice( 1 ) ).has( 'login' ) ) void startEditor();

} );
void startEditor();
