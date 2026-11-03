import { repairLegacyStudioLights } from './RepairLegacyStudioLights.js';
import { getPlateLibraryService } from '../../services/plates/PlateLibraryService.js';
import { LocalNarration } from './LocalNarration.js';
import { applyProjectPresetSnapshot, mergePresetMediaAssets } from './ApplyProjectPreset.js';
import { StudentProjectRepository } from '../../previs/persistence/StudentProjectRepository.js';
import { applyStudentCommand } from '../../previs/domain/StudentCommands.js';
import { createStudentId, createStudentProjectDocument, importStudentProjectDocument, prepareStudentProjectExport } from '../../previs/domain/StudentProjectSchema.js';
import { createCameraShotEdit } from '../../previs/domain/StudentShotEdits.js';
import { createSequenceEvaluator } from '../../previs/sequence/evaluateSequence.js';
import { StudentCatalogueClient } from '../../previs/api/StudentCatalogueClient.js';
import { getStudentPresetRepository } from '../../services/presets/StudentPresetRepository.js';
import { createLocalPresetCatalogue } from '../../services/presets/LocalPresetCatalogue.js';
import { refreshAccountDefault } from '../accounts/StudentIdentity.js';

const copy = value => structuredClone( value );
const projectTime = value => {

	const time = typeof value === 'number' ? value : Date.parse( value );
	return Number.isFinite( time ) ? time : 0;

};

const samePose = ( a, b ) => [[ a.transform.position, b.transform.position ], [ a.transform.quaternion, b.transform.quaternion ], [ a.target, b.target ]].every( ( [ first, second ] ) => first.every( ( value, index ) => Math.abs( value - second[ index ] ) < 1e-9 ) );

/** Portable authoring state and transient inspection cameras remain separate. */
export class EditorSession {

	constructor( { repository = new StudentProjectRepository(), presetRepository = getStudentPresetRepository(), narration = new LocalNarration(), createViewport, catalogue = presetRepository?.client || new StudentCatalogueClient( { baseURL: location.origin } ), selectionKey = 'sim-trav-review-project' } = {} ) {

		this.narration = narration;
		this.selectionKey = selectionKey;
		this.repository = repository; this.createViewport = createViewport; this.catalogue = catalogue;
		this.presetRepository = presetRepository; this.presetURLs = new Map(); this.libraryPresets = []; this.presetGeneration = 0;
		this.localPresetCatalogue = presetRepository ? createLocalPresetCatalogue( presetRepository ) : null;
		this.listeners = new Set(); this.undo = []; this.redo = []; this.tail = Promise.resolve();
		this.runtime = null; this.inspectionCamera = null; this.pending = null; this.closed = false; this.generation = 0; this.seekGeneration = 0; this.clockGeneration = 0;
		this.state = { recording: '', document: null, projects: [], busy: false, ready: false, status: 'Opening workspace', error: '', mode: 'shot', frame: 0, playing: false, selectedClipId: null, thumbnails: {}, presets: [], canUndo: false, canRedo: false, dirty: false, loading: 'Choose a project to begin', pending: false };
		this.cloudStatuses = new Map();
		this.cloudStatusEpoch = new Map();
		this.subscribe = listener => {

			this.listeners.add( listener ); return () => this.listeners.delete( listener );

		};

		this.getSnapshot = () => this.state;

	}

	set( patch ) {

		const documentChanged = patch.document && patch.document !== this.state.document;
		this.state = { ...this.state, ...patch, ...( documentChanged ? { offlineReadiness: 'preparing' } : {} ), canUndo: !! this.undo.length, canRedo: !! this.redo.length };
		for ( const listener of this.listeners ) listener();
		if ( documentChanged ) this.prepareOffline( patch.document );

	}

	prepareOffline( document ) {

		this.offlinePreparation?.abort();
		if ( ! this.catalogue.prepareProject ) return;
		const controller = this.offlinePreparation = new AbortController();
		void this.catalogue.prepareProject( document, { narration: this.narration.store, signal: controller.signal } ).then( result => {

			if ( ! controller.signal.aborted && ! this.closed && this.state.document === document ) this.set( { offlineReadiness: result.ready ? 'ready' : 'incomplete', offlineReason: result.reason || '' } );

		} ).catch( () => {

			if ( ! controller.signal.aborted && ! this.closed ) this.set( { offlineReadiness: 'incomplete' } );

		} );

	}

	boot() {

		this.offlineFocus = () => {

			const doc = this.state.document;
			if ( doc && this.catalogue.checkProject ) void this.catalogue.checkProject( doc, { narration: this.narration.store } ).then( result => {

				if ( ! this.closed && this.state.document === doc ) this.set( { offlineReadiness: result.ready ? 'ready' : 'incomplete', offlineReason: result.reason || '' } );

			} );

		};

		globalThis.window?.addEventListener( 'focus', this.offlineFocus );
		if ( this.catalogue.getStartingProject ) void this.catalogue.getStartingProject().catch( () => {} );
		return this.action( async () => {

			await this.refreshProjects();
			void this.startPresetLibrary().catch( error => ! this.closed && this.set( { error: `Preset library unavailable: ${error.message}` } ) );
			const selected = localStorage.getItem( this.selectionKey );
			const available = this.state.projects.filter( item => ! item.archived && ( ! this.accountContext || item.local ) );
			if ( selected && available.some( item => item.projectId === selected ) ) await this.openDocument( await this.repository.get( selected ) );
			else if ( this.presetRepository?.storage === 'cloud' && available.length ) await this.openDocument( await this.repository.get( available[ 0 ].projectId ) );
			else if ( this.accountContext ) this.set( { loading: 'Your cloud projects are being retrieved.', status: 'No project open' } );
			else if ( this.presetRepository?.storage === 'cloud' ) {

				if ( ! await this.newSharedStartingProject() ) this.set( { loading: this.libraryPresets.length ? 'Choose Use scene preset to begin your sequence.' : 'Open a saved project or import student JSON.', status: 'No project open' } );

			} else if ( import.meta.env.DEV ) await this.newDemo();
			else this.set( { loading: this.libraryPresets.length ? 'Choose Use scene preset to begin your sequence.' : 'Open a saved project or import student JSON.', status: 'No project open' } );

		}, { flush: false } );

	}

	action( operation, { flush = true, allowPending = false, invalidateSeek = true } = {} ) {

		this.stopClock();
		if ( invalidateSeek ) ++ this.seekGeneration;
		const job = this.tail.catch( () => {} ).then( async () => {

			if ( this.closed || ( this.pending && ! allowPending ) ) return;
			// A preceding queued action may have started playback after this action was requested.
			this.stopClock();
			this.set( { busy: true, error: '' } ); this.runtime?.setInteractive( false );
			try {

				if ( flush && ! await this.flushCamera() ) return;
				await operation();

			} catch ( error ) {

				this.set( { error: error.message } );

			} finally {

				this.set( { busy: false } ); this.runtime?.setInteractive( ! this.pending && this.state.ready && ! this.state.playing && ! this.state.recording );

			}

		} );
		this.tail = job;
		return job;

	}

	async refreshProjects() {

		const documents = await this.repository.list();
		if ( ! this.accountContext || ! this.repository.accountSummaries ) {

			this.set( { projects: documents.sort( ( a, b ) => b.updatedAt.localeCompare( a.updatedAt ) ) } ); return;

		}

		const summaries = await this.repository.accountSummaries(), byId = new Map( documents.map( document => [ document.projectId, { ...document, local: true, archived: false } ] ) );
		for ( const summary of summaries ) byId.set( summary.projectId, { ...( byId.get( summary.projectId ) || {} ), ...summary, local: byId.has( summary.projectId ) } );
		this.set( { projects: [ ...byId.values() ].sort( ( a, b ) => projectTime( b.updatedAt ) - projectTime( a.updatedAt ) || a.projectId.localeCompare( b.projectId ) ) } );

	}

	setCloudStatus( event ) {

		if ( this.closed || ! event ) return;
		if ( event.state === 'revoked' ) this.set( { accessRevoked: true } );
		if ( event.projectId && event.state !== 'discovered' ) this.cloudStatuses.set( event.projectId, { state: event.state, code: event.code } );
		if ( event.state === 'discovered' ) void this.refreshProjects().catch( () => {} );
		void this.refreshCloudStatus( event.projectId || this.state.document?.projectId );

	}

	async refreshCloudStatus( projectId ) {

		if ( ! projectId || ! this.accountContext ) return;
		const epoch = ( this.cloudStatusEpoch.get( projectId ) || 0 ) + 1; this.cloudStatusEpoch.set( projectId, epoch );
		try {

			const [ state, pending ] = await Promise.all( [ this.repository.backupState( projectId ), this.repository.pending( projectId ) ] );
			if ( this.closed || this.cloudStatusEpoch.get( projectId ) !== epoch ) return;
			const cloudStatuses = { ...( this.state.cloudStatuses || {} ), [ projectId ]: { ...this.cloudStatuses.get( projectId ), pending: !! pending.length || !! state?.inFlight || !! state?.metadataQueue?.length, conflict: !! state?.conflict, lastSyncedAt: state?.lastSyncedAt || null, acknowledgedRevision: state?.acknowledgedRevision ?? null, serverRevision: state?.serverRevision ?? null, unavailable: !! state?.retry?.exhausted || !! state?.metadataRetry?.exhausted } };
			this.set( { cloudStatuses } );

		} catch { /* A later retry will refresh storage status. */ }

	}

	async openAccountProject( projectId ) {

		let document = await this.repository.get( projectId );
		if ( ! document && this.accountContext ) {

			await this.accountContext.sync.discover(); document = await this.repository.get( projectId );

		}

		if ( ! document ) throw new Error( 'This cloud project is not available on this device yet. Reconnect and retry.' );
		await this.openDocument( document ); await this.refreshCloudStatus( projectId );

	}

	async duplicateProject() {

		if ( ! this.state.document ) return;
		const source = this.state.document, copy = importStudentProjectDocument( source );
		copy.name = `${source.name} copy`;
		const duplicate = await this.repository.save( copy, { expectedRevision: null } );
		await this.openDocument( duplicate ); await this.refreshProjects();

	}

	async listLegacyProjects() {

		const legacy = new StudentProjectRepository();
		try {

			this.set( { legacyProjects: await legacy.list() } );

		} finally {

			legacy.close();

		}

	}

	async importLegacyProject( projectId ) {

		if ( ! this.accountContext ) throw new Error( 'Sign in to import device projects.' );
		const { manager, workspace } = this.accountContext;
		const document = await manager.importLegacy( workspace, projectId );
		await this.openDocument( document ); await this.refreshProjects(); this.set( { legacyProjects: null } );

	}

	async setProjectArchived( projectId, archived ) {

		if ( this.state.recording ) throw new Error( 'Stop and save your voiceover before changing projects.' );
		const state = await this.repository.backupState( projectId );
		const revision = ( state?.metadataRevision ?? 0 ) + ( state?.metadataQueue?.length ?? 0 );
		await this.repository.queueMetadata( projectId, { requestId: crypto.randomUUID(), expectedMetadataRevision: revision, patch: { archived } } );
		await this.refreshProjects(); await this.refreshCloudStatus( projectId );
		if ( archived && this.state.document?.projectId === projectId ) {

			const next = this.state.projects.find( item => item.projectId !== projectId && ! item.archived && item.local );
			if ( next ) await this.openAccountProject( next.projectId );
			else {

				++ this.generation; await this.runtime?.dispose(); this.runtime = null; localStorage.removeItem( this.selectionKey );
				this.set( { document: null, ready: false, loading: 'Choose or create a project.', status: 'No project open' } );

			}

		}

	}

	async resolveConflict( choice ) {

		const projectId = this.state.document?.projectId;
		const state = projectId && await this.repository.backupState( projectId );
		if ( ! state?.conflict?.recoveryId ) throw new Error( 'No saved conflict was found.' );
		if ( choice === 'copy' ) {

			const document = await this.repository.restoreRecovery( state.conflict.recoveryId );
			await this.openDocument( document ); await this.refreshProjects(); return;

		}

		if ( ! this.accountContext ) throw new Error( 'Account access is unavailable.' );
		const remote = await this.accountContext.client.read( { projectId } );
		for ( const [ mediaId, asset ] of Object.entries( remote.document.narration.assets ) ) {

			const blob = await this.accountContext.client.downloadNarration( { projectId, mediaId } );
			const digest = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await blob.arrayBuffer() ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			if ( blob.size !== asset.byteLength || digest !== asset.sha256 ) throw new Error( 'Cloud audio could not be verified.' );
			const existing = await this.narration.store.get( asset.assetId );
			if ( existing ) {

				const oldHash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await existing.blob.arrayBuffer() ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
				if ( oldHash !== digest ) throw new Error( 'Cloud audio conflicts with a local recording. Save a local copy first.' );

			} else await this.narration.store.put( { assetId: asset.assetId, projectId, asset, blob } );

		}

		const document = await this.repository.acceptRemoteConflict( remote.document, { serverRevision: remote.project.serverRevision, recoveryId: state.conflict.recoveryId } );
		await this.repository.rememberAccountSummary( remote.project );
		this.cloudStatuses.delete( projectId );
		await this.openDocument( document ); await this.refreshProjects(); await this.refreshCloudStatus( projectId );

	}

	async startPresetLibrary() {

		if ( ! this.presetRepository ) return;
		this.unsubscribePresets ||= this.presetRepository.subscribe( () => {

			// Library notifications update the gallery only. Existing student
			// shots are detached copies, including while playback is running.
			this.refreshPresets().catch( error => ! this.closed && this.set( { error: `Preset library unavailable: ${error.message}` } ) );

		} );
		try {

			if ( this.presetRepository.storage !== 'cloud' ) {

				const { ensureLocalPresetSeeds } = await import( '../../services/presets/LocalPresetSeeds.js' );
				await ensureLocalPresetSeeds( { repository: this.presetRepository } );

			}

		} catch ( error ) {

			this.set( { error: `Preset library unavailable: ${error.message}` } );

		}

		await this.refreshPresets();

	}

	async refreshPresets() {

		const generation = ++ this.presetGeneration, records = await this.presetRepository.list();
		if ( this.closed || generation !== this.presetGeneration ) return;
		const retained = new Set();
		const presets = records.map( record => {

			const key = `${record.presetId}@${record.revision}`; retained.add( key );
			if ( record.thumbnail && ! this.presetURLs.has( key ) ) this.presetURLs.set( key, URL.createObjectURL( record.thumbnail ) );
			return { id: `library:${record.presetId}`, name: record.name, revision: record.revision, camera: copy( record.studentPreset.snapshot.camera ), thumbnail: this.presetURLs.get( key ), studentPreset: copy( record.studentPreset ) };

		} );
		for ( const [ key, url ] of this.presetURLs ) if ( ! retained.has( key ) ) {

			URL.revokeObjectURL( url ); this.presetURLs.delete( key );

		}

		this.libraryPresets = presets;
		this.set( { presets } );

	}

	async newSharedStartingProject() {

		let source;
		if ( this.accountContext ) {

			const { client, workspace } = this.accountContext;
			let cached = await this.repository.accountDefault();
			if ( ! cached ) {

				try {

					await refreshAccountDefault( { client, workspace, signal: workspace.controller.signal } );
					cached = await this.repository.accountDefault();

				} catch { /* Offline or unavailable: no unverified fallback. */ }

			}

			if ( ! cached ) throw new Error( 'The student default is not prepared on this device. Connect and retry.' );
			for ( const asset of Object.values( cached.document.narration.assets ) ) {

				const row = await this.narration.store.get( asset.assetId );
				if ( ! row?.blob || row.blob.size !== asset.byteLength ) throw new Error( 'Default audio is unavailable. Connect and retry.' );
				const digest = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await row.blob.arrayBuffer() ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
				if ( digest !== asset.sha256 ) throw new Error( 'Default audio failed verification. Connect and retry.' );

			}

			source = cached.document;

		} else if ( this.catalogue.getStartingProject ) source = await this.catalogue.getStartingProject();
		else {

			const response = await fetch( '/v1/student/starting-project', { credentials: 'same-origin', cache: 'no-store' } );
			if ( response.status === 404 ) return false;
			if ( ! response.ok ) throw new Error( 'The shared starting project is unavailable. Please refresh and try again.' );
			source = await response.json();

		}

		const document = importStudentProjectDocument( source );
		await this.openDocument( await this.repository.save( document, { expectedRevision: null } ) );
		await this.refreshProjects();
		return true;

	}

	async newDemo() {

		if ( ! import.meta.env.DEV ) return;
		const demo = await import( '../demo/StudentDemo.js' );
		const { document, catalogue } = await demo.createStudentDemoProject( { matchAdmin: true } );
		this.demoCatalogue = catalogue; document.name = 'Studio study';
		await this.openDocument( await this.repository.save( document, { expectedRevision: null } ) );
		await this.refreshProjects();

	}

	async matchAdminAppearance() {

		if ( ! import.meta.env.DEV ) return;
		const demo = await import( '../demo/StudentDemo.js' );
		const copy = demo.copyDemoWithAdminAppearance( this.state.document );
		await this.openDocument( await this.repository.save( copy, { expectedRevision: null } ) );
		await this.refreshProjects();

	}

	async resolveCatalogue( shot ) {

		if ( await this.localPresetCatalogue?.hasScene( shot.baseScene ) ) return this.localPresetCatalogue;
		if ( import.meta.env.DEV ) {

			const demo = await import( '../demo/StudentDemo.js' );
			if ( demo.isStudentDemoScene( shot.baseScene ) ) {

				const fallback = this.demoCatalogue ||= demo.createStudentDemoCatalogue();
				return this.presetRepository ? createLocalPresetCatalogue( this.presetRepository, { fallback } ) : fallback;

			}

		}

		return this.presetRepository ? createLocalPresetCatalogue( this.presetRepository, { fallback: this.catalogue } ) : this.catalogue;

	}

	async openDocument( document ) {

		if ( this.state.recording ) throw new Error( 'Stop and save your voiceover before changing projects.' );
		if ( ! document ) throw new Error( 'This saved project was not found.' );
		const repaired = repairLegacyStudioLights( document );
		if ( repaired ) {

			repaired.revision = document.revision + 1;
			document = await this.repository.save( repaired, { expectedRevision: document.revision } );

		}

		this.offlinePreparation?.abort();
		++ this.generation; await this.runtime?.dispose(); this.runtime = null;
		this.undo = []; this.redo = []; this.pending = null; this.playRestore = null; this.inspectionCamera = null;
		this.set( { document, selectedClipId: document.clips[ 0 ]?.clipId || null, frame: 0, ready: false, mode: 'shot', thumbnails: {}, presets: this.libraryPresets, pending: false, dirty: false, status: 'Saved on this device', loading: 'Opening scene…' } );
		void this.refreshCloudStatus( document.projectId );
		localStorage.setItem( this.selectionKey, document.projectId );
		if ( document.clips.length ) {

			const service = getPlateLibraryService(), required = new Map();
			for ( const clip of document.clips ) for ( const wall of document.shots[ clip.shotId ].snapshot.ledWalls ) {

				const asset = wall.media && document.assets[ `${wall.media.assetId}@${wall.media.version}` ];
				if ( asset ) required.set( asset.sha256, asset );

			}

			for ( const asset of required.values() ) {

				let match;
				try {

					match = await service.findAsset( asset );

				} catch { /* Non-plate media uses the pinned catalogue. */ }

				if ( match ) {

					this.set( { loading: `Preparing driving plates · ${match.manifest.name}…` } );
					await service.ensure( match.manifest );

				}

			}

			await this.showFrame( 0 ); if ( this.runtime ) await this.prepareGallery();

		} else this.set( { loading: 'This project has no timeline placements. Import a sequence with a supported scene or open a studio study.' } );

	}

	async ensureScene( shotId, { isCurrent = () => true, timelineFrame } = {} ) {

		const document = this.state.document, shot = document.shots[ shotId ];
		const valid = () => ! this.closed && document === this.state.document && isCurrent();
		if ( ! valid() ) return false;
		if ( ! Object.keys( shot.snapshot.nodes ).length ) throw new Error( 'This setup has no supported scene models.' );
		if ( ! this.runtimeFailed && this.runtime?.prepareShot && ! this.runtime.canUpdate( document, shotId ) ) {

			// A new video is not a new scene. Keep the current canvas, GPU resources
			// and picture while its verified decoder joins this viewport.
			await this.runtime.prepareShot( document, shotId );
			if ( ! valid() ) return false;

		}

		if ( ! this.runtimeFailed && this.runtime && ( this.runtimeDocument === document && this.runtime.shotId === shotId || this.runtime.canUpdate( document, shotId ) ) ) {

			if ( this.runtimeDocument !== document || this.runtime.shotId !== shotId ) await this.runtime.updateDocument( document, shotId, { playback: this.state.playing, timelineFrame } );
			if ( ! valid() ) return false;

		} else {

			const generation = ++ this.generation;
			// This workspace view belongs to the editor, never to an individual shot.
			// Preserve it even when the next shot requires different scene resources.
			if ( ! this.runtimeFailed && this.runtime?.captureInspectionCamera ) {

				const inspection = await this.runtime.captureInspectionCamera();
				if ( ! valid() ) return false;
				if ( inspection ) this.inspectionCamera = copy( inspection );

			}

			await this.runtime?.dispose(); this.runtime = null;
			if ( ! valid() ) return false;
			this.set( { ready: false, loading: 'Loading verified scene and media…' } );
			const catalogue = await this.resolveCatalogue( shot );
			if ( ! valid() ) return false;
			let created;
			const currentRuntime = () => ! this.closed && generation === this.generation && created === this.runtime;
			created = await this.createViewport( { document, shotId, catalogue, inspectionCamera: this.inspectionCamera ? copy( this.inspectionCamera ) : null, onStatus: loading => {

				if ( ! this.closed && generation === this.generation && valid() ) this.set( { loading } );

			}, onNavigationStart: () => {

				if ( currentRuntime() && this.state.ready && this.state.mode === 'shot' && ! this.state.busy && ! this.state.playing ) this.set( { dirty: true, status: 'Camera moving · not saved yet' } );

			}, onCameraChange: () => {

				if ( currentRuntime() && this.state.ready && this.state.mode === 'shot' && ! this.state.busy && ! this.state.playing ) return this.action( async () => {} );

			}, onError: error => {

				if ( ! currentRuntime() || ! this.state.ready ) return;
				this.runtimeFailed = true; created.setInteractive( false );
				this.set( { ready: false, error: `Navigation stopped: ${error.message}. Saved project settings are unchanged. Reopen this setup to retry.`, loading: 'Scene navigation unavailable. Reopen this setup to retry.' } );

			} } );
			if ( this.closed || generation !== this.generation || ! valid() ) {

				await created.dispose(); return false;

			}

			this.runtime = created; this.runtimeFailed = false;

		}

		this.runtimeDocument = document;
		const mode = this.state.mode;
		if ( this.runtime.viewMode !== mode ) await this.runtime.setViewMode( mode );
		return valid();

	}

	sequenceFor( document = this.state.document ) {

		if ( this.evaluationDocument !== document ) {

			this.evaluationDocument = document; this.evaluator = createSequenceEvaluator( document );

		}

		return this.evaluator;

	}

	async showFrame( frame, { isCurrent = () => true } = {} ) {

		const document = this.state.document;
		const valid = () => ! this.closed && document === this.state.document && isCurrent();
		if ( ! valid() ) return false;
		const evaluator = this.sequenceFor( document );
		if ( ! evaluator.totalFrames ) return false;
		const bounded = Math.max( 0, Math.min( evaluator.totalFrames - 1, frame ) ), evaluation = evaluator.evaluate( bounded );
		try {

			if ( ! await this.ensureScene( evaluation.shot.shotId, { isCurrent: valid, timelineFrame: bounded } ) || ! valid() || ! this.runtime ) return false;
			await this.runtime.renderFrame( evaluation.localFrame, { timelineFrame: bounded } );
			if ( ! valid() ) return false;
			this.set( { frame: bounded, selectedClipId: evaluation.activeClip.clipId, ready: true, loading: '' } );
			if ( this.state.playing && this.runtime.prepareCut ) {

				const upcoming = evaluator.spans.find( span => span.startFrame > bounded && span.startFrame - bounded <= 25 );
				const key = upcoming && `${document.revision}:${upcoming.clipId}`;
				if ( key && key !== this.warmedCut ) {

					this.warmedCut = key;
					// Decode independently of the scene queue; failure is retried/reported
					// by the normal render path if the playhead actually reaches this cut.
					this.runtime.prepareCut( upcoming.shotId, upcoming.startFrame ).catch( () => {} );

				}

			}

			return true;

		} catch ( error ) {

			if ( ! valid() ) return false;
			this.runtime?.setInteractive( false );
			this.set( { ready: false, loading: `Scene unavailable: ${error.message}` } );
			throw error;

		}

	}

	async flushCamera() {

		if ( ! this.runtime || this.state.mode !== 'shot' || ! this.state.ready || this.pending ) return ! this.pending;
		const camera = await this.runtime.captureCamera(), shot = this.state.document.shots[ this.runtime.shotId ];
		if ( samePose( shot.snapshot.camera, camera ) ) {

			this.set( { dirty: false, status: 'Saved on this device' } ); return true;

		}

		const replacement = copy( shot );
		replacement.snapshot.camera.transform.position = [ ...camera.transform.position ];
		replacement.snapshot.camera.transform.quaternion = [ ...camera.transform.quaternion ];
		replacement.snapshot.camera.target = [ ...camera.target ];
		return this.commit( { type: 'replaceShot', shot: replacement } );

	}

	async commit( command, mode = 'edit' ) {

		const before = this.state.document, result = applyStudentCommand( before, command );
		if ( ! result.changed ) return true;
		this.pending = { ...result, expectedRevision: before.revision, mode, metadataOperation: this.accountContext && before.name !== result.document.name ? { requestId: crypto.randomUUID(), name: result.document.name } : undefined };
		this.set( { document: result.document, pending: true, dirty: false, status: 'Saving on this device…' } );
		return this.savePending();

	}

	async savePending() {

		const pending = this.pending;
		if ( ! pending ) return true;
		try {

			const document = await this.repository.save( pending.document, { expectedRevision: pending.expectedRevision, metadataOperation: pending.metadataOperation } );
			if ( pending.mode === 'undo' ) {

				this.undo.pop(); this.redo.push( pending.inverse );

			} else if ( pending.mode === 'redo' ) {

				this.redo.pop(); this.undo.push( pending.inverse );

			} else {

				this.undo.push( pending.inverse ); this.redo = [];

			}

			this.pending = null; this.set( { document, pending: false, status: 'Saved on this device' } );
			void this.refreshCloudStatus( document.projectId );

		} catch ( error ) {

			this.set( { error: `${error.message} Your attempted edit is kept in this tab. Download it or retry the save.`, status: 'Not saved on this device', pending: true, ready: false } );
			return false;

		}

		// Never report a committed revision as a failed save because rendering failed.
		try {

			await this.showFrame( this.state.frame );
			await this.captureShotThumbnail();
			await this.refreshProjects();

		} catch ( error ) {

			this.set( { error: `Project saved; scene refresh failed: ${error.message}`, ready: false } );

		}

		return true;

	}

	edit( command ) {

		return this.action( () => this.commit( typeof command === 'function' ? command( this.state.document ) : command ) );

	}
	compareLEDBlur( wallId, amount ) {

		return this.action( async () => {

			this.set( { blurComparison: null } );
			const shotId = this.runtime.shotId;
			const results = await this.runtime.compareLEDBlur( wallId, amount, method => this.set( { status: `Comparing LED blur: ${method}…` } ) );
			this.set( { blurComparison: { shotId, wallId, amount, results }, status: 'LED blur comparison complete' } );

		} );

	}
	undoEdit() {

		return this.action( () => this.undo.length && this.commit( this.undo.at( - 1 ), 'undo' ) );

	}
	redoEdit() {

		return this.action( () => this.redo.length && this.commit( this.redo.at( - 1 ), 'redo' ) );

	}
	setMode( mode ) {

		return this.action( async () => {

			await this.runtime?.setViewMode( mode ); this.set( { mode, dirty: false } );

		} );

	}

	seek( frame ) {

		const generation = ++ this.seekGeneration;
		return this.action( () => generation === this.seekGeneration && this.showFrame( frame, { isCurrent: () => generation === this.seekGeneration } ), { invalidateSeek: false } );

	}

	selectClip( clipId ) {

		const span = this.sequenceFor().spans.find( item => item.clipId === clipId );
		return span && this.seek( span.startFrame );

	}

	stopClock() {

		++ this.clockGeneration; cancelAnimationFrame( this.clock ); this.narration.stopPlayback();
		if ( this.state.playing ) this.set( { playing: false } );

	}

	playPause() {

		if ( this.state.playing ) {

			this.stopClock(); return this.action( () => this.restoreMode(), { flush: false } );

		}

		return this.action( async () => {

			this.warmedCut = null;
			this.playRestore = { mode: this.state.mode, frame: this.state.frame };
			const total = this.sequenceFor().totalFrames, start = this.state.frame >= total - 1 ? 0 : this.state.frame;
			if ( ! total ) return;
			if ( this.runtime?.preparePlayback && ! ( this.state.recording === 'recording' && this.recordPreparedDocument === this.state.document ) ) {

				this.set( { status: 'Preparing playback…' } );
				await this.runtime.preparePlayback( this.state.document, start );
				this.set( { status: 'Saved on this device' } );

			}

			this.set( { playing: true } );
			if ( ! await this.showFrame( start ) || ! this.runtime ) {

				this.stopClock(); return;

			}

			this.runtime.setInteractive( false );
			if ( this.state.recording !== 'recording' ) {

				try {

					await this.narration.play( this.state.document, start );

				} catch ( error ) {

					this.stopClock(); throw error;

				}

			}

			const started = performance.now(), generation = ++ this.clockGeneration;
			const tick = now => {

				const valid = () => generation === this.clockGeneration && this.state.playing && ! this.closed;
				if ( ! valid() ) return;
				// Playback uses the same queue as edits and seeks. A stop invalidates
				// its generation immediately, then drains this job before restoring.
				const job = this.tail.catch( () => {} ).then( async () => {

					if ( ! valid() ) return;
					try {

						const next = Math.min( total - 1, start + Math.floor( ( now - started ) / 40 ) );
						if ( next !== this.state.frame && ! await this.showFrame( next, { isCurrent: valid } ) ) {

							// A cancelled GPU/media operation can finish painting before it
							// notices cancellation. Restore the last committed cursor before
							// queued authoring captures a camera or enables interaction.
							if ( ! this.closed && ! this.pending ) await this.showFrame( this.state.frame );
							return;

						}

						if ( ! valid() ) return;
						if ( next === total - 1 ) {

							this.stopClock(); await this.restoreMode();
							if ( this.state.recording === 'recording' ) this.finishVoiceover();
							return;

						}

						this.clock = requestAnimationFrame( tick );

					} catch ( error ) {

						if ( ! valid() ) return;
						this.stopClock(); this.set( { error: `Playback stopped: ${error.message}` } ); await this.restoreMode();

					}

				} );
				this.tail = job;
				return job;

			};

			this.clock = requestAnimationFrame( tick );

		} );

	}

	async restoreMode() {

		await this.runtime?.setViewMode( this.state.mode ); this.runtime?.setInteractive( ! this.pending && ! this.state.busy && this.state.ready && ! this.state.recording );

	}
	stop() {

		this.stopClock(); return this.action( async () => {

			await this.showFrame( this.playRestore?.frame || 0 ); await this.restoreMode();

		} );

	}


	/** Capture the authored camera, then restore inspection within the locked action. */
	async captureShotThumbnail() {

		const runtime = this.runtime, mode = this.state.mode;
		if ( ! runtime || ! this.state.ready ) return null;
		runtime.setInteractive( false );
		try {

			await runtime.setViewMode( 'shot' );
			return this.thumbnail( runtime.shotId );

		} finally {

			await runtime.setViewMode( mode );

		}

	}

	thumbnail( shotId ) {

		const small = document.createElement( 'canvas' ); small.width = 360; small.height = 203;
		small.getContext( '2d' ).drawImage( this.runtime.canvas, 0, 0, small.width, small.height );
		const url = small.toDataURL( 'image/jpeg', 0.8 );
		this.set( { thumbnails: { ...this.state.thumbnails, [ shotId ]: url } } );
		return url;

	}

	async prepareGallery() {

		const document = this.state.document, selectedId = this.runtime.shotId, selected = document.shots[ selectedId ];
		const presets = Object.values( document.shots ).filter( shot => JSON.stringify( shot.baseScene ) === JSON.stringify( selected.baseScene ) ).map( shot => ( { id: shot.shotId, name: shot.name.split( '—' )[ 0 ].trim(), camera: copy( shot.snapshot.camera ) } ) );
		if ( import.meta.env.DEV && this.demoCatalogue ) for ( const [ id, name, position ] of [[ 'front', 'Front three-quarter', [ 5.8, 1.6, 7.5 ]], [ 'side', 'Side view', [ 8, 1.6, 0 ]], [ 'rear', 'Rear three-quarter', [ - 5.8, 2, - 7 ]], [ 'high', 'High angle', [ 6, 6, 8 ]]] ) {

			const shot = createCameraShotEdit( selected, { position, target: [ 0, 1.2, 0 ], fov: 48, exposure: selected.snapshot.camera.exposure, frameOverlayRatio: '16:9' } );
			presets.push( { id, name, camera: shot.snapshot.camera } );

		}

		this.set( { loading: 'Preparing camera thumbnails…', ready: false } );
		try {

			await this.runtime.setViewMode( 'shot' );
			for ( const preset of this.libraryPresets.length ? [] : presets ) {

				const preview = copy( document ); preview.shots[ selectedId ].snapshot.camera = copy( preset.camera );
				await this.runtime.updateDocument( preview, selectedId ); preset.thumbnail = this.thumbnail( `preset:${preset.id}` );

			}

			for ( const shot of Object.values( document.shots ) ) if ( this.runtime.canUpdate( document, shot.shotId ) ) {

				await this.runtime.updateDocument( document, shot.shotId ); this.thumbnail( shot.shotId );

			}

		} finally {

			await this.runtime.updateDocument( document, selectedId ); this.runtimeDocument = document;
			await this.runtime.setViewMode( this.state.mode ); await this.showFrame( this.state.frame );
			this.set( { presets: this.libraryPresets.length ? this.libraryPresets : presets, ready: true, loading: '' } );

		}

	}

	selectDrivingPlateSet( manifest ) {

		return this.action( async () => {

			const service = getPlateLibraryService();
			const { encoding } = await service.ensure( manifest );
			if ( ! this.state.document || ! this.state.selectedClipId ) return;
			const clip = this.state.document.clips.find( item => item.clipId === this.state.selectedClipId );
			const shot = copy( this.state.document.shots[ clip.shotId ] ), assets = {};
			if ( ! shot.snapshot.ledWalls.length ) throw new Error( 'This shot has no LED wall.' );
			for ( const wall of shot.snapshot.ledWalls ) {

				const previous = wall.media && this.state.document.assets[ `${wall.media.assetId}@${wall.media.version}` ];
				const match = previous && await service.findAsset( previous );
				const view = match?.view || 'front', file = manifest.files[ `${view}-${encoding}` ];
				if ( ! file.sha256 ) throw new Error( 'This plate set needs updated content metadata before it can be selected.' );
				const asset = { assetId: `plate-${file.sha256}`, version: '1', kind: 'video', mimeType: 'video/mp4', sha256: file.sha256, byteLength: file.size, durationUs: manifest.frameCount * 40000 };
				assets[ `${asset.assetId}@${asset.version}` ] = asset;
				wall.media = { assetId: asset.assetId, version: asset.version };
				wall.inPointUs = Math.min( wall.inPointUs, asset.durationUs - 40000 );

			}

			await this.commit( { type: 'replaceShot', shot, assets } );

		} );

	}

	applyPreset( preset ) {

		return this.action( async () => {

			const shot = copy( this.state.document.shots[ this.runtime.shotId ] );
			shot.snapshot = preset.studentPreset ? await this.presetSnapshot( shot, preset.studentPreset, { placementOnly: true } ) : { ...shot.snapshot, camera: copy( preset.camera ) };
			return this.commit( { type: 'replaceShot', shot } );

		} );

	}

	async presetSnapshot( active, preset, options ) {

		let definition = null;
		if ( active.baseScene.sceneId !== preset.baseScene.sceneId || active.baseScene.version !== preset.baseScene.version ) {

			const catalogue = await this.resolveCatalogue( active );
			if ( ! catalogue?.getScene ) throw new Error( 'This preset belongs to a different scene setup.' );
			definition = ( await catalogue.getScene( active.baseScene ) ).sceneDefinition;

		}

		return applyProjectPresetSnapshot( active, preset, this.state.document.assets, definition, options );

	}

	addScenePreset( preset ) {

		return this.action( async () => {

			if ( ! preset.studentPreset ) throw new Error( 'This camera does not include a scene preset.' );
			if ( ! this.state.document ) {

				const empty = createStudentProjectDocument( { name: preset.name || preset.studentPreset.name } );
				const result = applyStudentCommand( empty, { type: 'addPresetShot', preset: copy( preset.studentPreset ), shotId: createStudentId(), clipId: createStudentId() } );
				// Persist the populated project atomically as its first revision.
				const document = { ...result.document, revision: 0 };
				await this.openDocument( await this.repository.save( document, { expectedRevision: null } ) );
				await this.refreshProjects();
				return;

			}

			const active = this.state.document.shots[ this.runtime.shotId ];
			const incoming = preset.studentPreset;
			const applied = copy( incoming );
			applied.snapshot = await this.presetSnapshot( active, incoming );
			applied.baseScene = copy( this.state.document.baseScenes[ `${active.baseScene.sceneId}@${active.baseScene.version}` ] );
			if ( active.baseScene.sceneId !== incoming.baseScene.sceneId || active.baseScene.version !== incoming.baseScene.version ) {

				const catalogue = await this.resolveCatalogue( active );
				applied.sceneDefinition = copy( ( await catalogue.getScene( active.baseScene ) ).sceneDefinition );

			}

			applied.assets = mergePresetMediaAssets( this.state.document.assets, applied.snapshot, incoming.assets );
			applied.thumbnail = null;

			const frame = this.sequenceFor().totalFrames;
			const shotId = createStudentId(), clipId = createStudentId();
			if ( await this.commit( { type: 'addPresetShot', preset: applied, shotId, clipId } ) ) {

				await this.showFrame( frame ); await this.captureShotThumbnail();

			}

		} );

	}

	addShot() {

		return this.action( async () => {

			const document = this.state.document, shot = copy( document.shots[ this.runtime.shotId ] );
			shot.shotId = createStudentId(); shot.name = `Shot ${String( document.clips.length + 1 ).padStart( 2, '0' )}`;
			const content = copy( { name: document.name, assets: document.assets, baseScenes: document.baseScenes, shots: document.shots, clips: document.clips, narration: document.narration } );
			content.shots[ shot.shotId ] = shot; content.clips.push( { clipId: createStudentId(), shotId: shot.shotId, durationFrames: 100 } );
			if ( await this.commit( { type: 'restoreContent', content } ) ) {

				await this.showFrame( this.sequenceFor().totalFrames - 100 );
				await this.captureShotThumbnail();

			}

		} );

	}

	recordVoiceover() {

		if ( this.state.recording === 'requesting' || this.state.recording === 'saving' ) return;
		if ( this.state.recording ) return this.finishVoiceover();
		return this.action( async () => {

			if ( ! this.state.document || ! this.state.ready ) throw new Error( 'Open a scene before recording.' );
			const total = this.sequenceFor().totalFrames;
			const frame = this.state.frame >= total - 1 ? 0 : this.state.frame;
			this.recordStart = { projectId: this.state.document.projectId, frame };
			await this.showFrame( frame );
			this.set( { recording: 'requesting' } );
			try {

				// Prepare before opening the microphone so GPU/video startup does
				// not become silence at the beginning of the recorded take.
				await this.runtime?.preparePlayback?.( this.state.document, frame );
				this.recordPreparedDocument = this.state.document;
				await this.narration.start( this.recordStart.projectId, () => this.finishVoiceover() );
				if ( this.closed ) return;
				this.set( { recording: 'recording', status: 'Recording voiceover · stop to save locally' } );
				this.recordLimit = setTimeout( () => this.finishVoiceover(), 15 * 60 * 1000 );

			} catch ( error ) {

				this.set( { recording: '' } ); throw error;

			}

		} ).then( () => this.state.recording === 'recording' && this.playPause() );

	}
	cancelVoiceover() {

		clearTimeout( this.recordLimit ); this.stopClock(); this.narration.cancel();
		this.set( { recording: '', error: '', status: 'Voiceover take discarded' } );

	}
	finishVoiceover() {

		if ( ! this.state.recording || [ 'saving', 'requesting' ].includes( this.state.recording ) ) return;
		clearTimeout( this.recordLimit ); this.stopClock(); this.set( { recording: 'saving' } );
		return this.action( async () => {

			try {

				const asset = await this.narration.finish();
				if ( this.closed || this.state.document.projectId !== this.recordStart.projectId ) return;
				const content = copy( { name: this.state.document.name, assets: this.state.document.assets, baseScenes: this.state.document.baseScenes, shots: this.state.document.shots, clips: this.state.document.clips, narration: this.state.document.narration } );
				content.narration.assets[ `${asset.assetId}@${asset.version}` ] = asset;
				content.narration.clips.push( { narrationClipId: createStudentId(), media: { assetId: asset.assetId, version: asset.version }, anchor: { type: 'sequence' }, offsetFrames: this.recordStart.frame, sourceStartSample: 0, lengthSamples: asset.durationSamples, gain: 1, muted: false } );
				await this.commit( { type: 'restoreContent', content } );
				this.set( { recording: '' } );

			} catch ( error ) {

				this.set( { recording: 'save-error' } ); throw error;

			}

		}, { flush: false } );

	}

	download() {

		const blob = new Blob( [ JSON.stringify( prepareStudentProjectExport( this.state.document ), null, 2 ) ], { type: 'application/json' } );
		const url = URL.createObjectURL( blob ), link = document.createElement( 'a' ); link.href = url; link.download = `${this.state.document.name}.student.json`; link.click();
		setTimeout( () => URL.revokeObjectURL( url ), 1000 );

	}

	exportJSON() {

		return this.action( () => this.download(), { allowPending: true, flush: ! this.pending } );

	}
	exportNarration( asset ) {

		return this.action( async () => {

			const row = await this.narration.store.get( asset.assetId );
			if ( ! row?.blob || row.blob.size !== asset.byteLength ) throw new Error( 'The recorded audio is unavailable on this device.' );
			const bytes = await row.blob.arrayBuffer();
			const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			if ( hash !== asset.sha256 ) throw new Error( 'The recorded audio failed its integrity check.' );
			const url = URL.createObjectURL( row.blob ), link = document.createElement( 'a' );
			link.href = url; link.download = `${asset.assetId}.${asset.mimeType.includes( 'webm' ) ? 'webm' : 'audio'}`; link.click();
			setTimeout( () => URL.revokeObjectURL( url ), 1000 );

		}, { allowPending: true, flush: ! this.pending } );

	}
	importJSON( json ) {

		return this.action( async () => {

			const document = importStudentProjectDocument( JSON.parse( json ) ); await this.openDocument( await this.repository.save( document, { expectedRevision: null } ) ); await this.refreshProjects();

		} );

	}
	async dispose() {

		clearTimeout( this.recordLimit );
		this.offlinePreparation?.abort();
		globalThis.window?.removeEventListener( 'focus', this.offlineFocus );
		this.closed = true; await this.narration.dispose(); ++ this.generation; ++ this.presetGeneration; this.unsubscribePresets?.();
		for ( const url of this.presetURLs.values() ) URL.revokeObjectURL( url );
		this.presetURLs.clear();
		this.stopClock(); await this.tail.catch( () => {} ); await this.runtime?.dispose();

	}

}
