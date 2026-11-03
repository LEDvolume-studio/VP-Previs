import './student.css';
import { createStudentId, createStudentProjectDocument, importStudentProjectDocument, prepareStudentProjectExport, STUDENT_FPS, MAX_SEQUENCE_FRAMES } from '../previs/domain/StudentProjectSchema.js';
import { applyStudentCommand } from '../previs/domain/StudentCommands.js';
import { StudentProjectRepository } from '../previs/persistence/StudentProjectRepository.js';
import { createSequenceEvaluator } from '../previs/sequence/evaluateSequence.js';
import { StudentCatalogueClient } from '../previs/api/StudentCatalogueClient.js';
import { ShotPreviewController } from './ShotPreviewController.js';
import { renderShotEditor, bindShotEditor } from './ShotEditor.js';

// Local editing has no admin store, account, engine or required network dependency.
const root = document.querySelector( '#student-app' );
const state = { document: null, projects: [], pending: null, conflict: null, busy: false, undo: [], redo: [], status: 'Choose a project or create a sequence.', kind: 'idle', message: '', recoveries: [], frame: 0, playing: false, evaluator: null, editingShotId: null, scrubbing: false, cameraDirty: false, restoreShotId: null, restoreFrame: 0, shellStatus: import.meta.env.PROD ? 'Checking offline application shell…' : 'Development preview: offline page reload is not installed.' };
const catalogue = new StudentCatalogueClient( { baseURL: window.location.origin } );
let demoCatalogue;
const library = { presets: [], status: 'Load the teacher library when online. Copied shots remain saved on this device.', loaded: false };
const shotEditorSelection = {};
const shotPreview = new ShotPreviewController( {
	createViewport: async options => {

		const { createPublishedShotViewport } = await import( './PublishedShotViewport.js' );
		return createPublishedShotViewport( options );

	},
	onChange: () => state.playing || state.scrubbing ? renderSceneStatus() : render(),
	onNavigationStart: () => {

		state.cameraDirty = true;
		state.kind = 'editing';
		state.status = 'Camera moving · not saved until navigation stops.';
		const status = document.querySelector( '#save-status' );
		if ( status ) {

			status.dataset.kind = state.kind; status.textContent = state.status;

		}

	},
	onCameraChange: ( camera, { shotId } ) => run( () => saveNavigatedCamera( camera, shotId ), { flushCamera: false } ),
} );
let playbackHandle;
let transportGeneration = 0;
let seekGeneration = 0;
let cameraFlush;
let seekPointerActive = false;
const repository = new StudentProjectRepository( { onStorageEvent: event => {

	if ( event.type === 'versionchange' ) {

		state.status = 'Device storage changed in another tab. Download your project, then reload before editing.';
		state.kind = 'error';
		state.message = 'Editing is paused because the storage schema changed.';
		stopPlayback();
		shotPreview.clear( 'Storage changed. Reload before previewing again.', { notify: false } );
		render();

	}

} } );
const escape = value => String( value ).replace( /[&<>"']/g, character => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } )[ character ] );
const disabled = condition => condition ? ' disabled' : '';
const locked = () => state.busy || state.playing || Boolean( state.pending ) || repository.invalidated;
const timecode = frame => `${Math.floor( frame / 1500 )}:${String( Math.floor( frame / STUDENT_FPS ) % 60 ).padStart( 2, '0' )}:${String( frame % STUDENT_FPS ).padStart( 2, '0' )}`;

function stopPlayback() {

	state.playing = false;
	++ transportGeneration;
	cancelAnimationFrame( playbackHandle );

}

function refreshEvaluator( { clearPreview = true } = {} ) {

	stopPlayback();
	if ( clearPreview ) shotPreview.clear( 'Choose a shot to preview its current saved settings.', { notify: false } );
	state.evaluator = state.document ? createSequenceEvaluator( state.document ) : null;
	state.frame = Math.min( state.frame, state.evaluator?.totalFrames || 0 );

}

async function refreshProjects() {

	state.projects = ( await repository.list() ).sort( ( a, b ) => b.updatedAt.localeCompare( a.updatedAt ) );
	state.recoveries = state.document ? await repository.recoveries( state.document.projectId ) : [];

}

function adopt( value ) {

	state.document = value;
	state.pending = null;
	state.conflict = null;
	state.undo = [];
	state.redo = [];
	state.frame = 0;
	state.editingShotId = null;
	state.cameraDirty = false;
	state.kind = 'saved';
	state.status = `Saved on this device · revision ${value.revision}. Cloud backup is not connected.`;
	refreshEvaluator();

}

async function run( action, { flushCamera = true } = {} ) {

	if ( state.busy ) return;
	++ seekGeneration;
	state.scrubbing = false;
	state.busy = true;
	state.message = '';
	render();
	try {

		if ( flushCamera && ! await flushNavigatedCamera() ) return;
		await action();

	} catch ( error ) {

		state.message = error.message;

	} finally {

		state.busy = false;
		render();

	}

}

function cameraMoved( saved, current ) {

	return [[ saved.transform.position, current.transform.position ], [ saved.transform.quaternion, current.transform.quaternion ], [ saved.target, current.target ]].some( ( [ before, after ] ) => before.some( ( value, index ) => Math.abs( value - after[ index ] ) > 1e-9 ) );

}

async function saveNavigatedCamera( camera, shotId ) {

	const shot = state.document?.shots[ shotId ];
	if ( ! shot || state.pending || state.playing || repository.invalidated ) return true;
	state.cameraDirty = false;
	if ( ! cameraMoved( shot.snapshot.camera, camera ) ) {

		if ( state.kind === 'editing' ) {

			state.kind = 'saved';
			state.status = `Saved on this device · revision ${state.document.revision}. Cloud backup is not connected.`;

		}

		return true;

	}

	const replacement = structuredClone( shot );
	// Navigation changes only the camera pose/target. Preserve all authored lens,
	// exposure, framing and other settings exactly.
	replacement.snapshot.camera.transform.position = [ ...camera.transform.position ];
	replacement.snapshot.camera.transform.quaternion = [ ...camera.transform.quaternion ];
	replacement.snapshot.camera.target = [ ...camera.target ];
	return command( { type: 'replaceShot', shot: replacement } );

}

async function flushNavigatedCamera() {

	if ( cameraFlush ) return cameraFlush;
	if ( state.pending || state.playing || shotPreview.state.phase !== 'ready' ) return true;
	const shotId = shotPreview.state.shotId;
	cameraFlush = ( async () => {

		const camera = await shotPreview.captureCamera();
		return camera ? saveNavigatedCamera( camera, shotId ) : true;

	} )().finally( () => {

		cameraFlush = null;

	} );
	return cameraFlush;

}

async function catalogueForShot( shot ) {

	if ( import.meta.env.DEV ) {

		const demo = await import( './demo/StudentDemo.js' );
		if ( demo.isStudentDemoScene( shot.baseScene ) ) demoCatalogue ||= await demo.createStudentDemoCatalogue();
		if ( demo.isStudentDemoScene( shot.baseScene ) ) return demoCatalogue;

	}

	return catalogue;

}

async function selectShot( shotId, { frame = 0, interactive = true } = {} ) {

	const shot = state.document?.shots[ shotId ];
	if ( ! shot ) return false;
	state.editingShotId = shotId;
	const placement = state.evaluator?.spans.find( clip => clip.shotId === shotId );
	if ( placement ) state.frame = placement.startFrame + frame;
	renderTransport();
	if ( ! Object.keys( shot.snapshot.nodes ).length ) {

		await shotPreview.clear( 'This setup has no models yet. Add a teacher preset or open the local demo scene.' );
		return false;

	}

	return shotPreview.select( { document: state.document, shotId, catalogue: await catalogueForShot( shot ), frame, interactive } );

}

async function openFirstShot() {

	const shotId = state.document?.clips[ 0 ]?.shotId || Object.keys( state.document?.shots || {} )[ 0 ];
	if ( shotId && ! state.pending ) await selectShot( shotId );

}

async function openLocalDemo() {

	if ( ! import.meta.env.DEV ) return;
	const { createStudentDemoProject } = await import( './demo/StudentDemo.js' );
	const demo = await createStudentDemoProject();
	demoCatalogue = demo.catalogue;
	adopt( await repository.save( demo.document, { expectedRevision: null } ) );
	await refreshProjects();
	await openFirstShot();

}

async function commitPending() {

	const pending = state.pending;
	state.kind = 'saving';
	state.status = 'Saving on this device…';
	render();
	try {

		state.document = await repository.save( pending.document, { expectedRevision: pending.expectedRevision } );
		if ( pending.mode === 'undo' ) {

			state.undo.pop();
			state.redo.push( pending.inverse );

		} else if ( pending.mode === 'redo' ) {

			state.redo.pop();
			state.undo.push( pending.inverse );

		} else if ( pending.inverse ) {

			state.undo.push( pending.inverse );
			state.redo = [];

		}

		state.pending = null;
		state.conflict = null;
		state.kind = 'saved';
		state.status = `Saved on this device · revision ${state.document.revision}. Cloud backup is not connected.`;
		refreshEvaluator( { clearPreview: false } );
		// Save is already durable. A failed list refresh must not be reported as a failed save.
		try {

			await refreshProjects();

		} catch ( error ) {

			state.message = `Project saved, but the project list could not refresh: ${error.message}`;

		}

	} catch ( error ) {

		state.conflict = error.code === 'REVISION_CONFLICT' ? error : null;
		state.kind = state.conflict ? 'conflict' : 'error';
		state.status = state.conflict ? 'Save conflict. This attempted edit is preserved in a device recovery copy.' : 'Not saved on this device. Your attempted edit remains in this tab.';
		state.message = error.message;
		if ( state.conflict ) {

			try {

				state.recoveries = await repository.recoveries( state.document.projectId );

			} catch { /* The conflict itself already confirms the durable recovery transaction. */ }

		}

		return false;

	}

	// The revision is already durable. Rendering errors belong to the picture,
	// never to the transaction/recovery path above.
	await shotPreview.syncSavedDocument( state.document );
	return true;

}

async function command( edit, mode = 'edit' ) {

	const before = state.document;
	const result = applyStudentCommand( before, edit );
	if ( ! result.changed ) return true;
	stopPlayback();
	state.document = result.document;
	state.pending = { document: result.document, expectedRevision: before.revision, inverse: result.inverse, mode };
	shotPreview.suspend( 'Saving shot settings on this device…', { notify: false } );
	refreshEvaluator( { clearPreview: false } );
	return commitPending();

}

async function createProject() {

	const value = createStudentProjectDocument();
	adopt( value );
	state.pending = { document: value, expectedRevision: null };
	await commitPending();

}

function emptyShot( sceneId ) {

	return {
		shotId: createStudentId(), name: `Empty custom shot ${Object.keys( state.document.shots ).length + 1}`,
		baseScene: { sceneId, version: '1' }, sourcePreset: null,
		snapshot: {
			camera: {
				transform: { position: [ 0, 1.6, 5 ], quaternion: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], visible: true }, target: [ 0, 1.6, 0 ],
				projection: { type: 'perspective', fov: 50, aspect: 16 / 9, near: 0.01, far: 1000, zoom: 1, filmGauge: 35, filmOffset: 0, clipStart: 0 },
				renderProjection: { type: 'perspective', panoramaLonRange: [ - 180, 180 ], panoramaLatRange: [ - 90, 90 ], panoramaLevelHorizon: true },
				lens: { focalLength: 38.6, sensorWidth: 36, sensorHeight: 20.25, focusDistance: 5, aperture: 2.8, enableDOF: false, dofMode: 'physical', dofBlur: 0.05, apertureScale: 1, anamorphicRatio: 1, autoFocusMode: 'manual', afScreenPoint: [ 0.5, 0.5 ], afSmoothingFactor: 0.2, unitsPerMetre: 1 }, exposure: 1, frameOverlayRatio: '16:9',
			},
			nodes: {}, lights: [], ledWalls: [], environment: { asset: null, intensity: 1, rotation: [ 0, 0, 0 ], background: false },
		},
	};

}

async function addEmptyShot() {

	// The shot and its empty immutable scene commit and undo as one edit.
	const sceneId = createStudentId();
	await command( { type: 'addCustomShot', scene: { sceneId, version: '1', assets: [] }, shot: emptyShot( sceneId ) } );

}

async function refreshCatalogue() {

	try {

		const listing = await catalogue.list( { signal: AbortSignal.timeout( 15000 ) } );
		library.presets = listing.presets;
		library.loaded = true;
		library.status = listing.presets.length ? 'Teacher library refreshed. Adding a preset makes an independent copy.' : 'No teacher presets are currently available.';
		return true;

	} catch {

		library.presets = [];
		library.loaded = false;
		library.status = 'Teacher library is unavailable. Check your connection or try again later. Your device-saved projects are unaffected.';
		return false;

	}

}

async function addTeacherPreset( presetId, version ) {

	// Revalidate availability before adding a new choice; saved shots retain their pinned versions.
	if ( ! await refreshCatalogue() ) return;
	if ( ! library.presets.some( preset => preset.presetId === presetId && preset.version === version ) ) {

		library.status = 'This preset has changed or is no longer available. Choose from the refreshed library.';
		return;

	}

	const preset = await catalogue.getPreset( { presetId, version }, { signal: AbortSignal.timeout( 15000 ) } );
	const shotId = createStudentId();
	if ( await command( { type: 'addPresetShot', preset, shotId, clipId: createStudentId() } ) ) await selectShot( shotId );

}

function downloadProject() {

	const json = JSON.stringify( prepareStudentProjectExport( state.document ), null, 2 );
	const url = URL.createObjectURL( new Blob( [ json ], { type: 'application/json' } ) );
	const link = document.createElement( 'a' );
	link.href = url;
	link.download = `${state.document.name.replace( /[^A-Za-z0-9_-]+/g, '-' ).slice( 0, 80 ) || 'student-project'}.student.json`;
	link.click();
	setTimeout( () => URL.revokeObjectURL( url ), 1000 );

}

function renderTransport() {

	const evaluator = state.evaluator;
	if ( ! evaluator ) return;
	const active = evaluator.evaluate( state.frame );
	const output = document.querySelector( '#transport-position' );
	if ( ! output ) return;
	output.textContent = `Frame ${state.frame} / ${evaluator.totalFrames} · ${timecode( state.frame )} · ${active.ended ? 'End of sequence' : `${active.shot.name} · local frame ${active.localFrame}`}`;
	document.querySelector( '#seek' ).value = state.frame;
	document.querySelector( '#play' ).textContent = state.playing ? 'Pause' : 'Play sequence';
	for ( const element of document.querySelectorAll( '[data-clip]' ) ) element.classList.toggle( 'active', element.dataset.clip === active.activeClip?.clipId );

}

async function displaySequenceFrame( requested, { generation = transportGeneration, interactive = true } = {} ) {

	const evaluator = state.evaluator;
	if ( ! evaluator?.totalFrames ) return false;
	state.frame = Math.max( 0, Math.min( requested, evaluator.totalFrames ) );
	renderTransport();
	const evaluation = evaluator.evaluate( Math.min( state.frame, evaluator.totalFrames - 1 ) );
	const document = state.document;
	const sceneCatalogue = await catalogueForShot( evaluation.shot );
	if ( generation !== transportGeneration || document !== state.document ) return false;
	if ( ! Object.keys( evaluation.shot.snapshot.nodes ).length ) {

		await shotPreview.clear( 'This timeline setup has no scene models. Add a teacher preset or open the local demo scene.' );
		return false;

	}

	state.editingShotId = evaluation.shot.shotId;
	return shotPreview.select( { document, shotId: evaluation.shot.shotId, catalogue: sceneCatalogue, frame: evaluation.localFrame, interactive } );

}

async function seekSequence( frame ) {

	const request = ++ seekGeneration;
	stopPlayback();
	let generation = transportGeneration;
	state.scrubbing = true;
	try {

		await flushNavigatedCamera();
		if ( state.pending || request !== seekGeneration ) return;
		generation = transportGeneration;
		await displaySequenceFrame( frame, { generation } );

	} catch ( error ) {

		state.message = `Scene seek failed: ${error.message}`;

	} finally {

		if ( request === seekGeneration ) {

			state.scrubbing = false;
			if ( seekPointerActive ) {

				renderSceneStatus(); renderTransport();

			} else {

				const focused = document.activeElement?.id;
				render();
				if ( focused === 'seek' ) document.querySelector( '#seek' )?.focus();

			}

		}

	}

}

async function startPlayback() {

	if ( state.frame >= state.evaluator.totalFrames ) state.frame = 0;
	state.restoreShotId = state.editingShotId;
	state.restoreFrame = state.frame;
	state.playing = true;
	const generation = ++ transportGeneration;
	if ( ! await displaySequenceFrame( state.frame, { generation, interactive: false } ) ) {

		stopPlayback(); render(); return;

	}

	const startFrame = state.frame;
	const startedAt = performance.now();
	const tick = async now => {

		if ( generation !== transportGeneration || ! state.playing ) return;
		try {

			const frame = Math.min( state.evaluator.totalFrames, startFrame + Math.floor( ( now - startedAt ) * STUDENT_FPS / 1000 ) );
			if ( frame !== state.frame && ! await displaySequenceFrame( frame, { generation, interactive: false } ) ) {

				if ( generation === transportGeneration ) {

					stopPlayback(); render();

				}

				return;

			}

			if ( generation !== transportGeneration ) return;
			if ( frame === state.evaluator.totalFrames ) {

				stopPlayback();
				await displaySequenceFrame( frame );
				render();
				return;

			}

			playbackHandle = requestAnimationFrame( tick );

		} catch ( error ) {

			if ( generation !== transportGeneration ) return;
			stopPlayback(); state.message = `Scene playback stopped: ${error.message}`; render();

		}

	};

	playbackHandle = requestAnimationFrame( tick );
	renderTransport();

}

async function restoreEditingShot() {

	stopPlayback();
	state.frame = state.restoreFrame;
	if ( state.restoreShotId && state.document.shots[ state.restoreShotId ] ) await selectShot( state.restoreShotId );
	else await openFirstShot();

}

function renderSceneStatus() {

	const status = document.querySelector( '#shot-preview-status' );
	if ( ! status ) return;
	status.textContent = shotPreview.state.status;
	status.dataset.phase = shotPreview.state.phase;
	const host = document.querySelector( '#shot-preview-host' );
	if ( shotPreview.runtime && shotPreview.state.phase === 'ready' ) host?.replaceChildren( shotPreview.runtime.canvas );
	else if ( ! shotPreview.runtime || [ 'error', 'suspended' ].includes( shotPreview.state.phase ) ) host?.replaceChildren();
	shotPreview.runtime?.setInteractive?.( ! locked() && shotPreview.state.phase === 'ready' && shotPreview.state.interactive );
	const close = document.querySelector( '#close-shot-preview' );
	if ( close ) close.disabled = shotPreview.state.phase === 'idle';
	renderEditor();
	const error = document.querySelector( '#operation-error' );
	if ( error ) error.textContent = state.message;

}

function render() {

	const value = state.document;
	const lock = locked();
	const totalFrames = state.evaluator?.totalFrames || 0;
	const renderable = value?.clips.length && value.clips.every( clip => Object.keys( value.shots[ clip.shotId ].snapshot.nodes ).length );
	root.innerHTML = `
	<header><div><span class="eyebrow">Rayzee / student workspace</span><h1>Student previs</h1></div><div class="toolbar">${import.meta.env.PREVIS_FIXTURE_ASSETS ? '<a href="./scene/">Real scene integration ↗</a>' : ''}<a href="./diagnostic/">Export diagnostic ↗</a></div></header>
	<main>
	<div class="notice"><strong>Scene workspace</strong> · Set up the scene in the Rayzee 3D viewer. Presets and timeline placements recall camera, objects, lights and poses. Narration, cloud backup, sharing and project MP4 export are still being built.</div>
	<div class="toolbar">${import.meta.env.DEV ? `<button id="open-local-demo"${disabled( lock )}>Open local demo scene</button>` : ''}<button id="new-project"${disabled( lock )}>New sequence</button><button id="import-project"${disabled( lock )}>Import student JSON</button><input id="import-file" hidden type="file" accept=".json,application/json" aria-label="Student project JSON"${disabled( lock )}><button id="refresh-projects"${disabled( state.busy )}>Refresh project list</button></div>
	<div class="status" id="save-status" data-kind="${state.kind}" role="status">${escape( state.status )}</div>
	<p class="error" id="operation-error" role="alert">${escape( state.message )}</p>
	${state.pending ? `<div class="recovery"><p>${state.conflict ? 'Your edit and the other tab’s version are kept separately. Restore your attempted edit as a new project, or open the latest version.' : 'Editing and project switching are paused until this save succeeds. Download the in-memory project before closing this tab.'}</p><div class="toolbar">${state.conflict ? '<button id="restore-conflict">Restore my recovery as new project</button><button id="open-latest">Open latest saved version</button>' : `<button id="retry-save"${disabled( state.busy || repository.invalidated )}>Retry device save</button>`}<button id="download-recovery"${disabled( state.busy )}>Download attempted project</button></div></div>` : ''}
	<div class="project-layout"><aside class="panel"><h2>On this device</h2><small>Browser storage is local to this browser profile and origin. Download JSON to keep a portable copy. Media bytes are not included.</small><ul class="project-list">${state.projects.map( project => `<li><button data-open="${escape( project.projectId )}" aria-current="${project.projectId === value?.projectId}"${disabled( lock )}>${escape( project.name )}<small>Revision ${project.revision} · ${project.clips.length} placements</small></button></li>` ).join( '' ) || '<li class="empty">No saved sequences yet.</li>'}</ul></aside>
	<section class="editor" aria-label="Sequence editor">${value ? `
	<div class="panel"><form id="rename-form" class="name-form"><label class="field">Sequence name<input id="project-name" name="name" value="${escape( value.name )}" maxlength="1024" required${disabled( lock )}></label><button${disabled( lock )}>Rename</button></form><p class="muted">1920 × 1080 · 25 fps · metres · maximum 15 minutes</p><div class="toolbar"><button id="duplicate-project"${disabled( lock )}>Duplicate sequence</button><button id="download-project"${disabled( state.busy )}>Download student JSON</button><button id="undo"${disabled( lock || ! state.undo.length )}>Undo</button><button id="redo"${disabled( lock || ! state.redo.length )}>Redo</button></div><small>Undo history lasts for this open project. Undo and redo create new saved revisions.</small></div>
	<div class="scene-workspace"><div class="panel scene-stage" aria-label="Rayzee 3D scene viewer"><div class="toolbar"><h2>Scene viewport</h2><button id="close-shot-preview"${disabled( shotPreview.state.phase === 'idle' )}>Close scene</button></div><p id="shot-preview-status" role="status" data-phase="${shotPreview.state.phase}">${escape( shotPreview.state.status )}</p><div id="shot-preview-host"><div class="scene-placeholder">Select a setup to load its 3D scene.</div></div><p class="navigation-help">Hold right mouse + WASD to fly · Q/E down/up · Shift faster · wheel changes speed · middle mouse pans</p><small>Camera movement saves to the selected setup when you release the controls. Presets and timeline selections apply scene state in this viewer.</small></div><aside class="panel scene-inspector"><div id="shot-editor-host"><p>Select a scene setup to edit its settings.</p></div></aside></div>
	<div class="panel"><h2>Timeline · ${totalFrames} frames · ${timecode( totalFrames )}</h2><p class="muted">Select a placement or scrub to apply its setup in the 3D viewer. Play cuts between saved setups and advances LED video; narration playback is still being built.</p><div class="transport"><div class="toolbar"><button id="play"${disabled( ! renderable || state.busy || Boolean( state.pending ) )}>Play sequence</button><button id="stop"${disabled( ! totalFrames || state.busy || Boolean( state.pending ) )}>Stop / return to editing</button><button id="frame-back"${disabled( ! totalFrames || lock )}>−1 frame</button><button id="frame-forward"${disabled( ! totalFrames || lock )}>+1 frame</button><button id="seek-start"${disabled( ! totalFrames || state.busy || Boolean( state.pending ) )}>Start</button><button id="seek-end"${disabled( ! totalFrames || state.busy || Boolean( state.pending ) )}>End</button></div><label for="seek">Sequence frame</label><input id="seek" type="range" min="0" max="${totalFrames}" step="1" value="${state.frame}"${disabled( ! totalFrames || state.busy || Boolean( state.pending ) )}><output id="transport-position" aria-live="off"></output></div><ol class="clip-list">${state.evaluator.spans.map( ( clip, index ) => `<li class="clip" data-clip="${escape( clip.clipId )}"><div class="clip-heading"><button data-select-placement="${clip.startFrame}"${disabled( lock )}>${index + 1}. ${escape( value.shots[ clip.shotId ].name )}</button> <small>Frames [${clip.startFrame}, ${clip.endFrame})</small></div><div class="toolbar"><form data-duration-form="${escape( clip.clipId )}" class="toolbar"><label>Frames <input name="duration" aria-label="Duration frames for placement ${index + 1}" type="number" min="1" max="${MAX_SEQUENCE_FRAMES - totalFrames + clip.durationFrames}" step="1" value="${clip.durationFrames}" required${disabled( lock )}></label><button${disabled( lock )}>Set duration</button></form><button data-move="${escape( clip.clipId )}" data-index="${index - 1}"${disabled( lock || index === 0 )}>Earlier</button><button data-move="${escape( clip.clipId )}" data-index="${index + 1}"${disabled( lock || index === value.clips.length - 1 )}>Later</button><button data-duplicate-clip="${escape( clip.clipId )}"${disabled( lock || totalFrames + clip.durationFrames > MAX_SEQUENCE_FRAMES )}>Duplicate placement</button><button data-remove-clip="${escape( clip.clipId )}"${disabled( lock )}>Remove placement</button></div></li>` ).join( '' ) || '<li class="empty">No placements. Add a shot to the timeline.</li>'}</ol><small>Removing a placement preserves its shot and any orphaned narration records in the document. Narration editing and playback are not available in this preview.</small></div>
	<div class="panel" aria-label="Teacher preset library"><div class="toolbar"><h2>Teacher presets</h2><button id="refresh-catalogue"${disabled( lock )}>${library.loaded ? 'Refresh teacher library' : 'Load teacher library'}</button></div><p id="catalogue-status" role="status">${escape( library.status )}</p><ul class="shot-list">${library.presets.map( preset => `<li><div class="toolbar"><strong>${escape( preset.name )}</strong><button data-add-preset="${escape( preset.presetId )}" data-preset-version="${escape( preset.version )}"${disabled( lock || totalFrames + preset.defaultDurationFrames > MAX_SEQUENCE_FRAMES )}>Add preset to sequence</button></div><p>${escape( preset.description )}</p><small>${escape( preset.category )} · ${preset.defaultDurationFrames} frames · version ${escape( preset.version )}</small></li>` ).join( '' )}</ul><small>Copies include shot settings and versioned media references. Media bytes are loaded only when you preview a supported shot; downloaded JSON contains references.</small></div>

	<div class="panel"><div class="toolbar"><h2>Shots</h2><button id="add-empty-shot"${disabled( lock )}>Add empty custom shot</button></div><p class="muted">Setups store camera, object, light and media state for the 3D scene. Empty custom setups have no models until a supported scene is chosen. Adding a placement reuses the shot; duplicating a shot makes an independent snapshot.</p><ul class="shot-list">${Object.values( value.shots ).map( shot => `<li><div class="toolbar"><strong>${escape( shot.name )}</strong><div class="toolbar"><button data-preview-shot="${escape( shot.shotId )}"${disabled( lock )}>Edit setup</button><button data-add-placement="${escape( shot.shotId )}"${disabled( lock || totalFrames + 125 > MAX_SEQUENCE_FRAMES )}>Add 125-frame placement</button><button data-duplicate-shot="${escape( shot.shotId )}"${disabled( lock )}>Duplicate shot</button><button data-remove-shot="${escape( shot.shotId )}"${disabled( lock || value.clips.some( clip => clip.shotId === shot.shotId ) )}>Delete shot</button></div></div></li>` ).join( '' ) || '<li class="empty">No shots. Add an empty custom shot to exercise the local timeline, or import a valid student document.</li>'}</ul></div>

	${state.recoveries.length && ! state.pending ? `<div class="panel"><h2>Preserved recovery copies</h2><p class="muted">These are edits that conflicted with another tab. Restoring creates a new local project.</p>${state.recoveries.map( row => `<p><button data-restore="${escape( row.recoveryId )}"${disabled( lock )}>Restore ${escape( row.document.name )} · revision ${row.document.revision}</button></p>` ).join( '' )}</div>` : ''}
	` : '<div class="panel empty"><h2>Start a sequence</h2><p>Create a local project or import a student JSON file. This preview requires no account.</p></div>'}</section></div></main>
	<footer>Student document format v1 · Device storage may be cleared by browser settings. JSON contains project metadata and media references, not media files. <span id="offline-shell-status">${escape( state.shellStatus )}</span></footer>`;
	bindEvents();
	if ( shotPreview.runtime && shotPreview.state.phase === 'ready' ) document.querySelector( '#shot-preview-host' )?.replaceChildren( shotPreview.runtime.canvas );
	renderEditor();
	shotPreview.runtime?.setInteractive?.( ! lock && shotPreview.state.phase === 'ready' && shotPreview.state.interactive );
	if ( value ) renderTransport();

}

function renderEditor() {

	const host = document.querySelector( '#shot-editor-host' );
	if ( ! host ) return;
	const shot = state.document?.shots[ shotPreview.state.shotId ];
	const capabilities = shotPreview.runtime?.capabilities;
	host.innerHTML = renderShotEditor( { shot, capabilities, selection: shotEditorSelection, locked: locked() || shotPreview.state.phase !== 'ready' } );
	if ( ! shot || ! capabilities ) return;
	bindShotEditor( host, {
		shot, getShot: () => state.document.shots[ shot.shotId ], selection: shotEditorSelection,
		onEdit: build => run( () => command( { type: 'replaceShot', shot: build() } ) ),
		onSelectionChange: () => {

			const open = [ ...host.querySelectorAll( 'details' ) ].map( element => element.open );
			renderEditor();
			for ( const [ index, element ] of [ ...host.querySelectorAll( 'details' ) ].entries() ) element.open = open[ index ];

		},
	} );

}

function bindEvents() {

	const on = ( selector, event, handler ) => document.querySelector( selector )?.addEventListener( event, handler );
	const action = ( selector, handler ) => on( selector, 'click', () => run( handler ) );
	action( '#new-project', createProject );
	action( '#open-local-demo', openLocalDemo );
	action( '#refresh-projects', refreshProjects );
	on( '#import-project', 'click', () => document.querySelector( '#import-file' ).click() );
	on( '#import-file', 'change', event => {

		const file = event.target.files[ 0 ];
		if ( ! file ) return;
		run( async () => {

			if ( file.size > 16 * 1024 * 1024 ) throw new Error( 'Choose a student JSON file no larger than 16 MiB.' );
			adopt( await repository.importJSON( await file.text() ) );
			await refreshProjects();
			await openFirstShot();

		} );

	} );
	on( '#rename-form', 'submit', event => {

		event.preventDefault();
		const name = new FormData( event.target ).get( 'name' ).trim();
		run( () => command( { type: 'renameProject', name } ) );

	} );
	action( '#duplicate-project', async () => {

		const copy = importStudentProjectDocument( state.document );
		copy.name = `${copy.name.slice( 0, 1019 )} copy`;
		adopt( await repository.save( copy, { expectedRevision: null } ) );
		await refreshProjects();

	} );
	action( '#download-project', downloadProject );
	on( '#download-recovery', 'click', downloadProject );
	action( '#retry-save', commitPending );
	action( '#open-latest', async () => {

		const latest = await repository.get( state.document.projectId );
		if ( ! latest ) throw new Error( 'No latest saved version was found. Restore or download your recovery instead.' );
		adopt( latest );
		await refreshProjects();

	} );
	action( '#restore-conflict', async () => {

		adopt( await repository.restoreRecovery( state.conflict.recoveryId ) );
		await refreshProjects();

	} );
	action( '#add-empty-shot', addEmptyShot );
	action( '#refresh-catalogue', refreshCatalogue );
	on( '#close-shot-preview', 'click', () => {

		stopPlayback(); ++ seekGeneration; state.scrubbing = false;
		if ( state.busy || shotPreview.state.phase !== 'ready' ) shotPreview.clear();
		else run( () => shotPreview.clear() );

	} );
	for ( const button of document.querySelectorAll( '[data-preview-shot]' ) ) button.addEventListener( 'click', () => run( () => selectShot( button.dataset.previewShot ) ) );
	for ( const button of document.querySelectorAll( '[data-add-preset]' ) ) button.addEventListener( 'click', () => run( () => addTeacherPreset( button.dataset.addPreset, button.dataset.presetVersion ) ) );
	action( '#undo', () => command( state.undo.at( - 1 ), 'undo' ) );
	action( '#redo', () => command( state.redo.at( - 1 ), 'redo' ) );
	on( '#play', 'click', () => state.playing ? seekSequence( state.frame ) : run( startPlayback ) );
	action( '#stop', restoreEditingShot );
	on( '#frame-back', 'click', () => seekSequence( Math.max( 0, state.frame - 1 ) ) );
	on( '#frame-forward', 'click', () => seekSequence( Math.min( state.evaluator.totalFrames, state.frame + 1 ) ) );
	for ( const button of document.querySelectorAll( '[data-select-placement]' ) ) button.addEventListener( 'click', () => seekSequence( Number( button.dataset.selectPlacement ) ) );
	on( '#seek-start', 'click', () => {

		seekSequence( 0 );

	} );
	on( '#seek-end', 'click', () => {

		seekSequence( state.evaluator.totalFrames );

	} );
	on( '#seek', 'pointerdown', () => {

		seekPointerActive = true;

	} );
	on( '#seek', 'input', event => {

		seekSequence( Number( event.target.value ) );

	} );
	for ( const button of document.querySelectorAll( '[data-open]' ) ) button.addEventListener( 'click', () => run( async () => {

		const value = await repository.get( button.dataset.open );
		if ( ! value ) throw new Error( 'Project not found on this device.' );
		adopt( value );
		await refreshProjects();
		await openFirstShot();

	} ) );
	for ( const button of document.querySelectorAll( '[data-restore]' ) ) button.addEventListener( 'click', () => run( async () => {

		adopt( await repository.restoreRecovery( button.dataset.restore ) );
		await refreshProjects();

	} ) );
	const commands = [
		[ '[data-add-placement]', button => ( { type: 'insertClip', index: state.document.clips.length, clip: { clipId: createStudentId(), shotId: button.dataset.addPlacement, durationFrames: 125 } } ) ],
		[ '[data-duplicate-shot]', button => ( { type: 'duplicateShot', shotId: button.dataset.duplicateShot, newShotId: createStudentId() } ) ],
		[ '[data-remove-shot]', button => ( { type: 'removeShot', shotId: button.dataset.removeShot } ) ],
		[ '[data-duplicate-clip]', button => ( { type: 'duplicateClip', clipId: button.dataset.duplicateClip, newClipId: createStudentId() } ) ],
		[ '[data-remove-clip]', button => ( { type: 'removeClip', clipId: button.dataset.removeClip } ) ],
		[ '[data-move]', button => ( { type: 'moveClip', clipId: button.dataset.move, index: Number( button.dataset.index ) } ) ],
	];
	for ( const [ selector, makeCommand ] of commands ) for ( const button of document.querySelectorAll( selector ) ) button.addEventListener( 'click', () => run( () => command( makeCommand( button ) ) ) );
	for ( const form of document.querySelectorAll( '[data-duration-form]' ) ) form.addEventListener( 'submit', event => {

		event.preventDefault();
		const durationFrames = Number( new FormData( form ).get( 'duration' ) );
		run( () => command( { type: 'setClipDuration', clipId: form.dataset.durationForm, durationFrames } ) );

	} );

}

window.addEventListener( 'pointerup', () => {

	if ( ! seekPointerActive ) return;
	seekPointerActive = false;
	if ( ! state.scrubbing ) render();

} );

window.addEventListener( 'beforeunload', event => {

	if ( ! state.pending && ! state.cameraDirty ) return;
	event.preventDefault();
	event.returnValue = '';

} );
render();
run( refreshProjects );

async function installOfflineShell() {

	const update = message => {

		state.shellStatus = message;
		const label = document.querySelector( '#offline-shell-status' );
		if ( label ) label.textContent = message;

	};

	if ( ! ( 'serviceWorker' in navigator ) ) {

		update( 'Offline application shell is unavailable in this browser. Referenced media may require a network connection.' );
		return;

	}

	try {

		const registration = await navigator.serviceWorker.register( new URL( 'sw.js', window.location.href ), { scope: './' } );
		const describe = () => {

			if ( navigator.serviceWorker.controller ) update( 'Application shell is available for offline reload. Referenced media are not prepared for offline use.' );
			else if ( registration.active ) update( 'Application shell installed; reload to enable offline reopening. Referenced media are not prepared for offline use.' );
			else update( 'Installing the offline application shell. Referenced media are not prepared for offline use.' );

		};

		describe();
		registration.installing?.addEventListener( 'statechange', describe );
		navigator.serviceWorker.addEventListener( 'controllerchange', describe );

	} catch {

		update( 'Offline application shell could not be installed. Reload needs a network connection; device-saved projects remain in this browser.' );

	}

}

if ( import.meta.env.PROD ) {

	if ( document.readyState === 'complete' ) installOfflineShell();
	else window.addEventListener( 'load', installOfflineShell, { once: true } );

}
