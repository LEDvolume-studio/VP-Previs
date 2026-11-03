import { getApp } from '../../lib/appProxy.js';
import { MODEL_FILES, DEFAULT_STATE } from '../../Constants.js';
import { useAssetsStore, useCameraStore, useStore } from '../../store.js';
import { projectSession } from '../projects/ProjectSession.js';
import { captureProjectPresetState, applyProjectPresetState, adoptLegacyPresetState, restorePresetLightIntensities } from './ProjectPresetState.js';
import { EnvironmentService } from '../EnvironmentService.js';
import { LEDVideoManager } from '../LEDVideoManager.js';
import { AdminPlatePlayback } from '../plates/AdminPlatePlayback.js';
import { getAdminPresetRepository } from './PresetRepository.js';
import { ensureLocalPresetSeeds } from './LocalPresetSeeds.js';
import { captureAdminPreset } from './CaptureAdminPreset.js';
import { createStudentProjectDocument, assetVersionKey } from '../../previs/domain/StudentProjectSchema.js';
import { serializeStudentCatalogueContent } from '../../previs/domain/StudentCatalogueSchema.js';
import { applyStudentCommand } from '../../previs/domain/StudentCommands.js';
import { SENSOR_ASPECT_RATIO } from '../../utils/cameraSensor.js';

const clone = value => structuredClone( value );
const STUDENT_WORKSPACE_ID = 'student-preset-workspace';
const fingerprint = source => serializeStudentCatalogueContent( { scene: source.scene, cameras: source.cameras, render: source.render, led: source.led, animation: source.animation } );

function restorePresetCamera( app, snapshot ) {

	const camera = app.cameraManager?.camera;
	if ( ! camera?.isPerspectiveCamera || snapshot?.projection?.type !== 'perspective' ) return;
	const { projection, transform, target, lens } = snapshot;
	for ( const key of [ 'fov', 'aspect', 'near', 'far', 'zoom', 'filmGauge', 'filmOffset' ] ) camera[ key ] = projection[ key ];
	camera.aspect = SENSOR_ASPECT_RATIO;
	camera.userData.clipStart = projection.clipStart;
	const applyTransform = () => {

		camera.position.fromArray( transform.position ); camera.quaternion.fromArray( transform.quaternion ); camera.scale.fromArray( transform.scale ); camera.visible = transform.visible;

	};

	applyTransform();
	app.cameraManager.controls.target.fromArray( target );
	app.cameraManager.controls.update?.();
	// Sensor restoration during ProjectSession.hydrate derives a new FOV.
	// The saved portable framing is authoritative when opening this preset.
	applyTransform(); camera.updateProjectionMatrix(); camera.updateMatrix(); camera.updateWorldMatrix( true, true );
	useCameraStore.setState?.( { fov: projection.fov, sensorWidth: lens.sensorWidth, sensorHeight: lens.sensorHeight, frameOverlayRatio: snapshot.frameOverlayRatio } );
	app.reset?.();

}

async function loadBlob( url ) {

	const response = await fetch( url, { credentials: 'same-origin' } );
	if ( ! response.ok || ! response.body ) throw new Error( 'A preset source file could not be read.' );
	const maximum = 64 * 1024 * 1024;
	if ( Number( response.headers.get( 'Content-Length' ) ) > maximum ) throw new Error( 'A preset source file exceeds the supported size.' );
	const reader = response.body.getReader(), chunks = [];
	let length = 0;
	try {

		while ( true ) {

			const { done, value } = await reader.read(); if ( done ) break;
			length += value.byteLength;
			if ( length > maximum ) throw new Error( 'A preset source file exceeds the supported size.' );
			chunks.push( value );

		}

	} finally {

		await reader.cancel().catch( () => {} ); reader.releaseLock();

	}

	return new Blob( chunks );

}

/** Generate the saved thumbnail from the exact portable scene students receive. */
async function thumbnailFor( preset, assetBlobs, repository, onStatus ) {

	const { createPublishedShotViewport } = await import( '../../student/PublishedShotViewport.js' );
	const project = applyStudentCommand( createStudentProjectDocument(), { type: 'addPresetShot', preset, shotId: 'thumbnail', clipId: 'thumbnail' } ).document;
	const rows = new Map( assetBlobs.map( row => [ assetVersionKey( row.asset ), row ] ) );
	const catalogue = {
		getScene: async () => ( { sceneDefinition: clone( preset.sceneDefinition ), assets: Object.fromEntries( preset.baseScene.assets.map( ref => [ assetVersionKey( ref ), clone( preset.assets[ assetVersionKey( ref ) ] ) ] ) ) } ),
		getAssetBytes: async asset => {

			const row = rows.get( assetVersionKey( asset ) ) || await repository.getAssetRecord( asset );
			if ( ! row || serializeStudentCatalogueContent( row.asset ) !== serializeStudentCatalogueContent( asset ) ) throw new Error( 'The thumbnail source bytes are unavailable.' );
			return new Uint8Array( await row.blob.arrayBuffer() );

		},
	};
	const viewport = await createPublishedShotViewport( { document: project, shotId: 'thumbnail', catalogue, onStatus } );
	try {

		viewport.setInteractive( false ); await viewport.renderFrame( 0 );
		const canvas = document.createElement( 'canvas' ); canvas.width = 480; canvas.height = 270;
		canvas.getContext( '2d' ).drawImage( viewport.canvas, 0, 0, 480, 270 );
		const thumbnail = await new Promise( resolve => canvas.toBlob( resolve, 'image/jpeg', 0.85 ) );
		if ( ! thumbnail ) throw new Error( 'The preset thumbnail could not be captured.' );
		return thumbnail;

	} finally {

		await viewport.dispose();

	}

}

export class AdminPresetService {

	constructor( { repository = getAdminPresetRepository(), session = projectSession, app = getApp, capture = captureAdminPreset, thumbnail = thumbnailFor, ensureSeeds = ensureLocalPresetSeeds } = {} ) {

		Object.assign( this, { repository, session, app, capture, thumbnail, ensureSeeds } );
		this.plates = new AdminPlatePlayback( { session, app } );
		this.state = { presets: [], selectedPresetId: null, busy: false, retryPending: false, error: '', status: repository.storage === 'cloud' ? 'Presets are stored in Cloudflare and shared with the student view.' : 'Presets are shared with the student view on this device.' };
		this.listeners = new Set(); this.urls = new Map(); this.selected = null; this.recordCache = new Map();
		this.unsubscribe = repository.subscribe( () => this.importExistingPresets().then( () => this.refreshList() ).catch( error => this.set( { error: error.message } ) ) );
		this.onHydrated = () => {

			this.selected = null; this.editProjectId = null;
			this.set( { selectedPresetId: null, presets: [] } );
			this.importExistingPresets().then( () => this.refreshList() ).catch( error => this.set( { error: error.message } ) );

		};

		globalThis.window?.addEventListener( 'project:hydrated', this.onHydrated );

	}
	getState() {

		return this.state;

	}
	subscribe( listener ) {

		this.listeners.add( listener ); return () => this.listeners.delete( listener );

	}
	set( patch ) {

		this.state = { ...this.state, ...patch }; for ( const listener of this.listeners ) listener();

	}

	async run( operation ) {

		if ( this.state.busy ) throw new Error( 'Wait for the current preset operation to finish.' );
		this.set( { busy: true, error: '' } );
		try {

			return await operation();

		} catch ( error ) {

			this.set( { error: error.message } ); throw error;

		} finally {

			this.set( { busy: false } );

		}

	}

	async refreshList() {

		const rows = await this.repository.list();
		const project = this.session.current;
		const links = project?.extensions?.projectPresets || {};
		const sharedLibrary = project?.extensions?.studentPresetLibrary === true;
		const scoped = sharedLibrary ? rows : rows.filter( row => links[ row.presetId ] );
		const retained = new Set();
		const presets = scoped.map( row => {

			const key = `${row.presetId}@${row.revision}`; retained.add( key );
			if ( row.thumbnail && ! this.urls.has( key ) ) this.urls.set( key, URL.createObjectURL( row.thumbnail ) );
			return { presetId: row.presetId, revision: row.revision, name: row.name, thumbnailUrl: this.urls.get( key ) };

		} );
		for ( const [ key, url ] of this.urls ) if ( ! retained.has( key ) ) {

			URL.revokeObjectURL( url ); this.urls.delete( key );

		}

		this.set( { presets, sharedLibrary } );

	}

	openDefaultProject() {

		return this.run( async () => {

			this.assertNoPendingSave();
			if ( this.repository.storage !== 'cloud' ) await this.ensureSeeds( { repository: this.repository } );
			await this.session.flush();
			const existing = await this.session.repository.get( STUDENT_WORKSPACE_ID );
			const rows = await this.repository.list();
			const first = rows.find( row => row.presetId === 'studio-camera-wide' ) || rows[ 0 ];
			if ( ! first && ! existing ) throw new Error( 'The student preset library is empty. Save a scene preset to create its default project.' );
			const record = ! first ? null : first.adminDocument ? first : await this.repository.get( first.presetId );
			if ( ! record && ! existing ) throw new Error( 'The student default scene could not be found. Refresh and try again.' );
			// Keep the welcome project and other working projects intact. This workspace
			// edits the same repository the student gallery reads, using its full scene.
			const document = clone( existing || record.adminDocument );
			document.projectId = STUDENT_WORKSPACE_ID;
			document.name = 'Student default project';
			document.extensions = { ...document.extensions, studentPresetLibrary: true };
			document.workspace = { ...document.workspace, activeTab: 'presets' };
			await this.session.hydrate( document );
			await this.importExistingPresets();
			await this.refreshList();
			this.set( { status: 'Student default project opened. Add, edit or remove presets in the shared student library.' } );

		} );

	}

	assertNoPendingSave() {

		if ( this.pendingSave ) throw new Error( 'Retry the previous preset save before loading, renaming or saving another preset.' );

	}

	async commitPreparedSave( prepared, retry = false ) {

		let saved;
		try {

			// Keep these exact objects across retries: their timestamp, thumbnail,
			// source bytes and revision guard describe one prepared operation.
			saved = await this.repository.save( prepared.input, prepared.options );

		} catch ( error ) {

			this.pendingSave = error.retryable === true ? prepared : null;
			this.set( {
				retryPending: Boolean( this.pendingSave ),
				status: this.pendingSave ? 'The preset save could not be confirmed. Retry the previous save to confirm it; your current scene is preserved.' : error.code === 'REVISION_CONFLICT' || error.code === 'CONFLICT' ? 'The preset changed in another editor. Reload it before saving again; your current scene is preserved.' : 'The preset save could not be completed. Your current scene is preserved.',
			} );
			throw error;

		}

		this.pendingSave = null;
		const currentProject = prepared.app === this.app() && ! this.session.hydrating && this.session.current?.projectId === prepared.projectId;
		const changed = ! currentProject || prepared.fingerprint !== fingerprint( this.session.capture() );
		if ( currentProject ) {

			const extensions = this.session.current.extensions || {};
			this.session.current.extensions = { ...extensions, projectPresetsInitialized: true, projectPresets: { ...extensions.projectPresets, [ saved.presetId ]: { state: prepared.input.adminDocument.extensions.projectPresetState } } };
			this.session.markDirty();

		}

		this.recordCache.set( saved.presetId, saved );
		this.selected = currentProject ? saved : null;
		this.editProjectId = currentProject ? prepared.projectId : null;
		const status = `${retry ? 'Previous preset save confirmed.' : 'Preset saved with a new thumbnail.'} The student library has been updated.${changed ? ' Current scene changes have not been saved.' : ''}`;
		this.set( { retryPending: false, selectedPresetId: currentProject ? saved.presetId : null, status } );
		try {

			await this.refreshList();

		} catch {

			// The acknowledgement already proves persistence. A failed list refresh
			// must not present this committed operation as a retryable save.
			this.set( { status: `${status} Refresh the preset list when the connection is available.` } );

		}

		return saved;

	}

	retryPendingSave() {

		return this.run( async () => {

			if ( ! this.pendingSave ) throw new Error( 'There is no previous preset save to retry.' );
			this.set( { status: 'Confirming the previous preset save…' } );
			return this.commitPreparedSave( this.pendingSave, true );

		} );

	}

	refresh() {

		this.refreshPromise ||= this.run( async () => {

			if ( this.repository.storage !== 'cloud' ) await this.ensureSeeds( { repository: this.repository } );
			await this.importExistingPresets();
			await this.refreshList();

		} ).finally( () => {

			this.refreshPromise = null;

		} );
		return this.refreshPromise;

	}

	selectPreset( presetId ) {

		return this.run( async () => {

			this.assertNoPendingSave();
			const app = this.app();
			if ( ! app || ! this.session.current || this.session.hydrating ) throw new Error( 'Wait for the project to finish loading.' );
			const projectId = this.session.current.projectId;
			let link = this.session.current.extensions?.projectPresets?.[ presetId ];
			const sharedLibrary = this.session.current.extensions?.studentPresetLibrary === true;
			if ( ! link && ! sharedLibrary ) throw new Error( 'This preset is not part of the current project.' );
			const record = this.recordCache.get( presetId ) || await this.repository.get( presetId );
			if ( ! record ) throw new Error( 'This preset was not found.' );
			if ( this.session.current?.projectId !== projectId ) throw new Error( 'The project changed while selecting the preset.' );
			if ( ! link ) {

				// Different scene inventories need their own authoring resources. Matching
				// presets continue to switch instantly within the loaded student scene.
				const document = clone( record.adminDocument );
				document.projectId = projectId; document.name = this.session.current.name;
				document.extensions = { ...document.extensions, studentPresetLibrary: true, projectPresets: {}, projectPresetsInitialized: false };
				document.workspace = { ...document.workspace, activeTab: 'presets' };
				await this.session.hydrate( document );
				await this.importExistingPresets();
				link = this.session.current.extensions.projectPresets[ presetId ];

			}

			// Matching scene inventories keep all resources alive during application.
			const stored = record.adminDocument.extensions?.projectPresetState;
			const state = restorePresetLightIntensities( stored?.projectId === projectId ? stored : link.state, record.adminDocument );
			applyProjectPresetState( app, { ...state, projectId }, projectId );
			restorePresetCamera( app, state.camera );
			await this.plates.setView( state.plateView || 'front' );
			this.selected = record; this.editProjectId = projectId;
			this.session.markDirty();
			this.set( { selectedPresetId: presetId, status: `Editing ${record.name}. Positions and visibility applied in the current project.` } );

		} );

	}

	async importExistingPresets() {

		if ( ! this.session.current ) return;
		const source = this.session.capture();

		const rows = await this.repository.list();
		const available = new Set( rows.map( row => row.presetId ) );
		const entries = Object.fromEntries( Object.entries( source.extensions?.projectPresets || {} ).filter( ( [ id ] ) => available.has( id ) ) );
		for ( const row of rows ) {

			const record = row.adminDocument ? row : await this.repository.get( row.presetId );
			if ( ! record ) continue;
			const stored = record.adminDocument.extensions?.projectPresetState;
			const state = source.extensions?.studentPresetLibrary
				? ( stored?.projectId === source.projectId ? stored : adoptLegacyPresetState( record, source ) )
				: stored ? ( stored.projectId === source.projectId ? stored : null ) : ( ! source.extensions?.projectPresetsInitialized ? adoptLegacyPresetState( record, source ) : null );
			this.recordCache.set( record.presetId, record );
			if ( state ) entries[ record.presetId ] = { state };
			else if ( source.extensions?.studentPresetLibrary ) delete entries[ record.presetId ];

		}

		if ( this.session.current?.projectId !== source.projectId ) return;
		if ( JSON.stringify( entries ) === JSON.stringify( source.extensions?.projectPresets || {} ) && source.extensions?.projectPresetsInitialized ) return;
		this.session.current.extensions = { ...this.session.current.extensions, projectPresets: entries, projectPresetsInitialized: true };
		this.session.markDirty();
		await this.session.flush();

	}

	renamePreset( presetId, name ) {

		return this.run( async () => {

			this.assertNoPendingSave();
			const selected = this.selected?.presetId === presetId ? this.selected : await this.repository.get( presetId );
			if ( ! selected || ! this.session.current?.extensions?.projectPresets?.[ presetId ] ) throw new Error( 'Select a preset in this project first.' );
			if ( ! this.session.current.extensions?.studentPresetLibrary && selected.adminDocument.extensions?.projectPresetState && selected.adminDocument.extensions.projectPresetState.projectId !== this.session.current.projectId ) throw new Error( 'This library revision belongs to another project. Save a new preset in this project first.' );
			const saved = await this.repository.rename( presetId, name, { expectedRevision: selected.revision } );
			this.recordCache.set( presetId, saved );
			if ( this.selected?.presetId === presetId ) this.selected = saved;
			await this.refreshList(); this.set( { status: 'Preset renamed. The student library has been updated.' } );

		} );

	}

	removePreset( presetId ) {

		return this.run( async () => {

			this.assertNoPendingSave();
			const record = this.selected?.presetId === presetId ? this.selected : await this.repository.get( presetId );
			if ( ! record || ! this.state.presets.some( row => row.presetId === presetId ) ) throw new Error( 'Select a preset to remove first.' );
			await this.repository.remove( presetId, { expectedRevision: record.revision } );
			this.recordCache.delete( presetId );
			if ( this.selected?.presetId === presetId ) {

				this.selected = null; this.editProjectId = null;
				this.set( { selectedPresetId: null } );

			}

			await this.importExistingPresets();
			await this.refreshList();
			this.set( { status: 'Preset removed from the student library. Existing student shots are preserved.' } );

		} );

	}

	saveCurrent( { name, asNew = false } = {} ) {

		return this.run( async () => {

			this.assertNoPendingSave();
			const app = this.app();
			if ( ! app || useStore.getState().loading.isLoading || this.session.hydrating ) throw new Error( 'Wait for the admin scene to finish loading.' );
			if ( ! asNew && ( ! this.selected || ! this.session.current?.extensions?.projectPresets?.[ this.selected.presetId ] ) ) throw new Error( 'Load the preset you want to update first.' );
			if ( typeof name !== 'string' || ! name.trim() ) throw new Error( 'Enter a preset name.' );
			if ( ! asNew && ! this.session.current.extensions?.studentPresetLibrary && this.selected?.adminDocument.extensions?.projectPresetState && this.selected.adminDocument.extensions.projectPresetState.projectId !== this.session.current.projectId ) throw new Error( 'This library revision belongs to another project. Save a new preset in this project first.' );
			const selected = this.selected, controls = app.cameraManager.controls, enabled = controls.enabled;
			const playing = [ ...LEDVideoManager.records.values() ].filter( row => row.video && ! row.video.paused );
			const playingWalls = new Set( playing.map( row => row.root.uuid ) );
			controls.enabled = false;
			try {

				for ( const record of playing ) record.video.pause();
				await this.session.flush();
				const source = clone( this.session.capture() ), before = fingerprint( source );
				const storedEnvironment = useAssetsStore.getState().environment;
				const environment = EnvironmentService.getEnvironmentById( storedEnvironment?.id || ( typeof storedEnvironment === 'string' ? storedEnvironment : DEFAULT_STATE.environment ) ) || storedEnvironment;
				this.set( { status: 'Capturing the current scene and verifying preset assets…' } );
				const captured = await this.capture( { app, source, modelFiles: MODEL_FILES, environment, ledManager: LEDVideoManager, cameraMetadata: useCameraStore.getState(), loadBlob, playingWalls } );
				this.set( { status: 'Rendering the preset thumbnail…' } );
				const thumbnail = await this.thumbnail( captured.studentPreset, captured.assetBlobs, this.repository, status => this.set( { status } ) );
				if ( app !== this.app() || this.session.hydrating || this.session.current?.projectId !== source.projectId || before !== fingerprint( this.session.capture() ) ) throw new Error( 'The scene changed while saving the preset. Your changes are intact; save again to capture them.' );
				source.extensions = { ...source.extensions, localPresetMedia: captured.mediaBindings || {}, projectPresetState: { ...captureProjectPresetState( source, captured.studentPreset.snapshot.camera ), plateView: this.plates.getSnapshot().view } };
				// Published scene data is a student delivery snapshot, not a project to open.
				delete source.extensions.projectPresets;
				return await this.commitPreparedSave( {
					input: clone( { ...( ! asNew ? { presetId: selected.presetId } : {} ), name, adminDocument: source, studentPreset: captured.studentPreset, assetBlobs: captured.assetBlobs, thumbnail } ),
					options: { expectedRevision: asNew ? null : selected.revision }, app, projectId: source.projectId, fingerprint: before,
				} );

			} finally {

				controls.enabled = enabled;
				for ( const record of playing ) record.video.play().catch( () => {} );

			}

		} );

	}

}

let service;
export function getAdminPresetService() {

	return service ||= new AdminPresetService();

}
