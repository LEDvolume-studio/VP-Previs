import { serializeMaterial, applyMaterialState, TEXTURE_SLOTS } from './MaterialState.js';
import { DEFAULT_STATE, MODEL_FILES, WELCOME_PROJECT_CATALOG_ID, computeOutputDimensions } from '@/Constants';
import { SENSOR_ASPECT_RATIO } from '@/utils/cameraSensor';
import bundledDefaultScene from '@/data/default-scene.json';
import {
	useAnimationStore,
	useAssetsStore,
	useCameraStore,
	useLightStore,
	usePathTracerStore,
	useStore,
} from '@/store';
import { getApp } from '@/lib/appProxy';
import { EnvironmentService } from '@/services/EnvironmentService';
import { PolyHavenService } from '@/services/PolyHavenService';
import { PolyHavenMaterialLoader } from '@/services/PolyHavenMaterialLoader';
import { getLEDVideoMimeType, LEDVideoManager, LED_ROOT_METADATA_KEY, prepareLEDAssetRoot } from '@/services/LEDVideoManager';
import {
	createAssetId,
	createProjectId,
	migrateProjectDocument,
	PROJECT_FILE_EXTENSION,
	PROJECT_MIME_TYPE,
} from './ProjectSchema';
import { projectRepository } from './ProjectRepository';
import { useProjectStore } from './projectStore';
import { undoManager } from '@/services/UndoManager';
import {
	captureNodeTransform,
	createDefaultReplacement,
	hasChangedKeys,
	nextWorkingProjectName,
	restoreNodeTransform,
} from './projectStateUtils';

const AUTOSAVE_DELAY = 750;
const VIDEO_CHECKPOINT_INTERVAL = 5000;
const BUNDLED_DEFAULT_VERSION = 1;

const createBundledDefaultProject = ( existing = null ) => {

	const now = new Date().toISOString();
	const document = structuredClone( bundledDefaultScene );
	document.projectId = existing?.projectId || createProjectId();
	document.name = 'Welcome Project';
	document.createdAt = existing?.createdAt || now;
	document.updatedAt = now;
	document.revision = 0;
	document.extensions = { ...document.extensions, bundledDefaultVersion: BUNDLED_DEFAULT_VERSION };
	delete document.exportedAt;
	delete document.importedFromProjectId;
	return migrateProjectDocument( document );

};

const isOriginalWelcomeProject = document => document?.name === 'Welcome Project'
	&& document.revision === 0
	&& document.scene?.assets?.length === 1
	&& document.scene.assets[ 0 ].catalogId === WELCOME_PROJECT_CATALOG_ID
	&& Object.keys( document.scene.nodes || {} ).length === 0
	&& Object.keys( document.scene.materials || {} ).length === 0;

const RENDER_KEYS = new Set( [ ...Object.keys( DEFAULT_STATE ),
	'GIIntensity', 'asvgfQualityPreset', 'denoiserStrategy', 'filterStrength',
	'edgeAtrousIterations', 'edgePhiLuminance', 'edgePhiNormal', 'edgePhiDepth',
	'oidnQuality', 'enableOIDN', 'enableUpscaler', 'upscalerScale', 'upscalerQuality',
	'upscalerHdr', 'upscalerBackend', 'neuralRendering', 'nrIntensity', 'nrLocalTone',
	'nrLocalStructure', 'nrColorStrength', 'showAsvgfHeatmap',
] );
const WORKSPACE_KEYS = [ 'appMode', 'activeTab', 'transformMode', 'transformSpace' ];
const ANIMATION_KEYS = [ 'selectedClip', 'speed', 'loop', 'loopCount' ];
const CAMERA_KEYS = [
	'cameraNames', 'selectedCameraIndex', 'activePreset', 'fov', 'aperture',
	'focalLength', 'focusDistance', 'enableDOF', 'zoomToCursor', 'dollyZoom', 'autoFocusMode',
	'afScreenPoint', 'afSmoothingFactor', 'apertureScale', 'anamorphicRatio',
	'sensorPreset', 'sensorWidth', 'sensorHeight', 'frameOverlayRatio',
	'dofMode', 'dofBlur', 'unitsPerMetre',
];
const CAMERA_SETTING_KEYS = new Set( [
	'enableDOF', 'focusDistance', 'aperture', 'focalLength', 'apertureScale', 'anamorphicRatio',
	'dofMode', 'dofBlur', 'unitsPerMetre',
] );
const finiteOrNull = value => typeof value === 'number' && ! Number.isFinite( value ) ? null : value;

function copySerializableState( state, keys ) {

	const result = {};
	for ( const key of keys ) {

		const value = state[ key ];
		if ( typeof value === 'function' || value === undefined ) continue;
		if ( value && typeof value === 'object' && ! Array.isArray( value ) ) result[ key ] = { ...value };
		else result[ key ] = Array.isArray( value ) ? [ ...value ] : finiteOrNull( value );

	}

	return result;

}

function walkNodes( root, callback, path = '0' ) {

	callback( root, path );
	root.children.forEach( ( child, index ) => walkNodes( child, callback, `${path}/${index}` ) );

}

function sceneRoots( app ) {

	const scene = app?.getScene?.();
	const floor = app?.assetLoader?.floorPlane;
	return ( scene?.children || [] ).filter( child => child !== floor && child.userData?.__rayzeeCatalogId );

}

function entityKeyForObject( object ) {

	if ( ! object ) return null;
	let root = object;
	while ( root.parent && ! root.userData?.__rayzeeProjectInstanceId ) root = root.parent;
	const instanceId = root.userData?.__rayzeeProjectInstanceId;
	if ( ! instanceId ) return null;
	let found = null;
	walkNodes( root, ( node, path ) => {

		if ( node === object ) found = `${instanceId}:${path}`;

	} );
	return found;

}

function findEntity( app, key ) {

	if ( ! key ) return null;
	const separator = key.indexOf( ':' );
	if ( separator < 0 ) return null;
	const instanceId = key.slice( 0, separator );
	const path = key.slice( separator + 1 );
	const root = sceneRoots( app ).find( item => item.userData.__rayzeeProjectInstanceId === instanceId );
	if ( ! root ) return null;
	let object = root;
	for ( const index of path.split( '/' ).slice( 1 ).map( Number ) ) object = object?.children?.[ index ];
	return object || null;

}

export class ProjectSession {

	constructor( repository = projectRepository ) {

		this.repository = repository;
		this.current = null;
		this.defaultProjectId = null;
		this.hydrating = false;
		this.scratch = false;
		this.dirty = false;
		this.saveTimer = null;
		this.savePromise = Promise.resolve();
		this.unsubscribers = [];
		this.lastVideoCheckpoint = 0;
		this.videoStates = new Map();
		this.unresolved = { assets: [], nodes: {}, materials: {}, led: [], environment: null };
		this.undoBaselines = new Map();
		this.pendingUndoCheckpoints = new Map();
		this.undoGeneration = 0;
		this.transformUndoStart = null;

	}

	async initialize() {

		useProjectStore.getState().setStatus( 'loading' );
		await this.repository.init();
		globalThis.navigator?.storage?.persist?.().catch( () => false );
		let projects = await this.repository.list();
		if ( projects.length === 0 ) {

			const welcome = createBundledDefaultProject();
			await this.repository.save( welcome );
			projects = [ welcome ];

		} else {

			const originalWelcome = projects.find( isOriginalWelcomeProject );
			if ( originalWelcome ) {

				const welcome = createBundledDefaultProject( originalWelcome );
				await this.repository.save( welcome );
				projects = projects.map( project => project.projectId === welcome.projectId ? welcome : project );

			}

		}

		let defaultProjectId = await this.repository.getDefaultProjectId();
		if ( ! projects.some( project => project.projectId === defaultProjectId ) ) {

			let welcome = projects.find( project => project.name === 'Welcome Project' );
			if ( ! welcome ) {

				welcome = createBundledDefaultProject();
				await this.repository.save( welcome );
				projects = [ ...projects, welcome ];

			}

			defaultProjectId = welcome.projectId;
			await this.repository.setDefaultProjectId( defaultProjectId );

		}

		this.defaultProjectId = defaultProjectId;
		useProjectStore.getState().setDefaultProjectId( defaultProjectId );

		const activeId = await this.repository.getActiveProjectId();
		const active = projects.find( project => project.projectId === activeId )
			|| projects.find( project => project.projectId === defaultProjectId )
			|| projects[ 0 ];
		this.bindAutosave();
		await this.hydrate( active );
		return active;

	}

	bindAutosave() {

		if ( this.unsubscribers.length ) return;
		this.unsubscribers.push( useStore.subscribe( ( next, previous ) => {

			if ( hasChangedKeys( next, previous, WORKSPACE_KEYS ) || next.selectedObject !== previous.selectedObject ) this.markDirty();
			if ( next.selectedObject !== previous.selectedObject ) {

				this.undoBaselines.set( 'material', this._captureUndoDomain( 'material' ) );

			}

		} ) );
		this.unsubscribers.push( usePathTracerStore.subscribe( ( next, previous ) => {

			if ( hasChangedKeys( next, previous, RENDER_KEYS ) ) {

				this.markDirty();
				this._scheduleUndoCheckpoint( 'render', 'Render settings' );

			}

		} ) );
		this.unsubscribers.push( useLightStore.subscribe( ( next, previous ) => {

			if ( next.lights !== previous.lights ) {

				this.markDirty();
				this._scheduleUndoCheckpoint( 'lights', 'Lighting' );

			} else if ( next.selectedLightIndex !== previous.selectedLightIndex ) {

				this._scheduleUndoCheckpoint( 'lights', 'Lighting', false );

			}

		} ) );
		this.unsubscribers.push( useCameraStore.subscribe( ( next, previous ) => {

			if ( hasChangedKeys( next, previous, CAMERA_KEYS ) ) {

				this.markDirty();
				const automaticFocusUpdate = next.focusDistance !== previous.focusDistance
					&& next.autoFocusMode !== 'manual'
					&& CAMERA_KEYS.every( key => key === 'focusDistance' || next[ key ] === previous[ key ] );
				this._scheduleUndoCheckpoint( 'camera', 'Camera', ! automaticFocusUpdate );

			}

		} ) );
		this.unsubscribers.push( useAnimationStore.subscribe( ( next, previous ) => {

			if ( hasChangedKeys( next, previous, ANIMATION_KEYS ) ) {

				this.markDirty();
				this._scheduleUndoCheckpoint( 'animation', 'Animation settings' );

			}

		} ) );
		const app = getApp();
		const structuralEvents = [ 'SceneRebuild', 'ModelAdded', 'ModelLoaded', 'SceneObjectRemoved', 'EnvironmentLoaded' ];
		const onStructuralChange = () => {

			this.markDirty();
			if ( this.hydrating || undoManager.applying || this.preserveStructuralUndoDepth > 0 ) return;
			this._resetUndoHistory();

		};

		for ( const type of structuralEvents ) {

			app?.addEventListener?.( type, onStructuralChange );
			this.unsubscribers.push( () => app?.removeEventListener?.( type, onStructuralChange ) );

		}

		const onSetting = event => {

			this.markDirty();
			const isCameraSetting = CAMERA_SETTING_KEYS.has( event.key );
			this._scheduleUndoCheckpoint( isCameraSetting ? 'camera' : 'render', isCameraSetting ? 'Camera' : 'Render settings' );

		};

		app?.settings?.addEventListener?.( 'engine:settingChanged', onSetting );
		this.unsubscribers.push( () => app?.settings?.removeEventListener?.( 'engine:settingChanged', onSetting ) );

		const onTransformStart = event => this._beginTransformUndo( event.object );
		const onTransformEnd = () => this._finishTransformUndo();
		app?.addEventListener?.( 'engine:objectTransformStart', onTransformStart );
		app?.addEventListener?.( 'engine:objectTransformEnd', onTransformEnd );
		this.unsubscribers.push( () => app?.removeEventListener?.( 'engine:objectTransformStart', onTransformStart ) );
		this.unsubscribers.push( () => app?.removeEventListener?.( 'engine:objectTransformEnd', onTransformEnd ) );

		const onCamera = () => {

			this.markDirty();
			this._scheduleUndoCheckpoint( 'camera', 'Camera movement' );

		};

		app?.cameraManager?.controls?.addEventListener?.( 'change', onCamera );
		this.unsubscribers.push( () => app?.cameraManager?.controls?.removeEventListener?.( 'change', onCamera ) );
		const onMaterial = () => {

			this.markDirty();
			this._scheduleUndoCheckpoint( 'material', 'Material' );

		};

		window.addEventListener( 'MaterialUpdate', onMaterial );
		this.unsubscribers.push( () => window.removeEventListener( 'MaterialUpdate', onMaterial ) );
		const onMeshVisibility = () => {

			this.markDirty();
			this._scheduleUndoCheckpoint( 'visibility', 'Visibility' );

		};

		window.addEventListener( 'meshVisibilityChanged', onMeshVisibility );
		this.unsubscribers.push( () => window.removeEventListener( 'meshVisibilityChanged', onMeshVisibility ) );
		this.unsubscribers.push( LEDVideoManager.subscribe( rootId => {

			this.markDirty();
			const snapshot = LEDVideoManager.getSnapshot( rootId );
			const previous = this.videoStates.get( rootId );
			this.videoStates.set( rootId, snapshot && { status: snapshot.status, seeking: snapshot.seeking } );
			const stopped = snapshot?.status === 'paused' && previous?.status !== 'paused';
			const seekCompleted = previous?.seeking && ! snapshot?.seeking;
			const now = Date.now();
			if ( stopped || seekCompleted || now - this.lastVideoCheckpoint >= VIDEO_CHECKPOINT_INTERVAL ) {

				this.lastVideoCheckpoint = now;
				this.flush();

			}

		} ) );
		const onVisibility = () => {

			if ( document.visibilityState === 'hidden' ) this.flush();

		};

		document.addEventListener( 'visibilitychange', onVisibility );
		this.unsubscribers.push( () => document.removeEventListener( 'visibilitychange', onVisibility ) );
		const onPageHide = () => this.flush();
		window.addEventListener( 'pagehide', onPageHide );
		this.unsubscribers.push( () => window.removeEventListener( 'pagehide', onPageHide ) );

	}

	// A pose rebuild changes vertex samples without replacing scene objects.
	// Its explicit undo command remains valid across the SceneRebuild event.
	async withPreservedUndoHistory( callback ) {

		this.preserveStructuralUndoDepth = ( this.preserveStructuralUndoDepth || 0 ) + 1;
		try {

			return await callback();

		} finally {

			this.preserveStructuralUndoDepth --;

		}

	}

	markDirty() {

		if ( this.hydrating || this.scratch || ! this.current ) return;
		this.dirty = true;
		useProjectStore.getState().setStatus( 'dirty' );
		clearTimeout( this.saveTimer );
		this.saveTimer = setTimeout( () => this.flush(), AUTOSAVE_DELAY );

	}

	setWorkspace( patch ) {

		if ( ! this.current || this.hydrating ) return;
		if ( Object.entries( patch ).every( ( [ key, value ] ) => JSON.stringify( this.current.workspace?.[ key ] ) === JSON.stringify( value ) ) ) return;
		this.current.workspace = { ...this.current.workspace, ...patch };
		useProjectStore.getState().setActiveProject( { ...this.current } );
		this.markDirty();

	}

	_captureUndoDomain( domain ) {

		const app = getApp();
		if ( ! app ) return null;
		if ( domain === 'render' ) {

			return {
				engine: app.settings?.getAll?.() || {},
				ui: copySerializableState( usePathTracerStore.getState(), RENDER_KEYS ),
			};

		}

		if ( domain === 'camera' ) return {
			engine: app.cameraManager?.getProjectState?.() || null,
			ui: copySerializableState( useCameraStore.getState(), CAMERA_KEYS ),
		};
		if ( domain === 'lights' ) return {
			lights: app.lightManager?.getProjectState?.() || [],
			selectedLightIndex: useLightStore.getState().selectedLightIndex,
		};
		if ( domain === 'animation' ) return copySerializableState( useAnimationStore.getState(), ANIMATION_KEYS );
		if ( domain === 'visibility' ) {

			return ( app.sceneMeshes || [] ).map( object => ( { uuid: object.uuid, visible: object.visible } ) );

		}

		if ( domain === 'material' ) {

			const object = useStore.getState().selectedObject;
			if ( ! object?.isMesh || ! object.material ) return null;
			const materials = Array.isArray( object.material ) ? object.material : [ object.material ];
			return {
				uuid: object.uuid,
				materialIds: materials.map( material => material.uuid ),
				textureIds: materials.map( material => Object.fromEntries(
					TEXTURE_SLOTS.map( key => [ key, material[ key ]?.uuid || null ] )
				) ),
				materials: materials.map( serializeMaterial ),
			};

		}

		return null;

	}

	_resetUndoHistory() {

		this.undoGeneration ++;
		this.pendingUndoCheckpoints.clear();
		undoManager.clear();
		this._resetUndoBaselines();

	}

	_scheduleUndoCheckpoint( domain, label, record = true ) {

		if ( this.hydrating || undoManager.applying ) return;
		const existing = this.pendingUndoCheckpoints.get( domain );
		if ( existing ) {

			existing.record ||= record;
			return;

		}

		const pending = { label, record, generation: this.undoGeneration };
		this.pendingUndoCheckpoints.set( domain, pending );
		queueMicrotask( () => {

			if ( this.pendingUndoCheckpoints.get( domain ) !== pending ) return;
			this.pendingUndoCheckpoints.delete( domain );
			if ( pending.generation !== this.undoGeneration || this.hydrating || undoManager.applying ) return;
			if ( pending.record ) this._checkpointUndoDomain( domain, pending.label );
			else this.undoBaselines.set( domain, structuredClone( this._captureUndoDomain( domain ) ) );

		} );

	}

	_resetUndoBaselines() {

		this.undoBaselines.clear();
		for ( const domain of [ 'render', 'camera', 'lights', 'animation', 'visibility', 'material' ] ) {

			this.undoBaselines.set( domain, structuredClone( this._captureUndoDomain( domain ) ) );

		}

	}

	_checkpointUndoDomain( domain, label ) {

		if ( this.hydrating || undoManager.applying ) return;
		const after = this._captureUndoDomain( domain );
		const before = this.undoBaselines.get( domain );
		this.undoBaselines.set( domain, structuredClone( after ) );
		if ( before === undefined || JSON.stringify( before ) === JSON.stringify( after ) ) return;
		if ( domain === 'material' && this._materialStructureChanged( before, after ) ) {

			// Replacing a material or texture disposes GPU-backed resources that a small
			// in-memory history cannot safely resurrect. Treat it as a history boundary.
			this._resetUndoHistory();
			return;

		}

		const undoState = structuredClone( before );
		const redoState = structuredClone( after );
		undoManager.record( {
			label,
			coalesceKey: domain,
			undo: () => this._restoreUndoDomain( domain, undoState ),
			redo: () => this._restoreUndoDomain( domain, redoState ),
		} );

	}

	_materialStructureChanged( before, after ) {

		if ( ! before || ! after || before.uuid !== after.uuid ) return true;
		if ( JSON.stringify( before.materialIds ) !== JSON.stringify( after.materialIds ) ) return true;
		if ( JSON.stringify( before.textureIds ) !== JSON.stringify( after.textureIds ) ) return true;
		const textureShape = snapshot => snapshot.materials.map( material => Object.fromEntries(
			Object.entries( material.textures || {} ).map( ( [ key, value ] ) => [ key, value !== null ] )
		) );
		return JSON.stringify( textureShape( before ) ) !== JSON.stringify( textureShape( after ) );

	}

	async _restoreUndoDomain( domain, state ) {

		const app = getApp();
		if ( ! app ) return;
		if ( domain === 'render' ) {

			this.applyRenderState( state );
			app.reset();

		} else if ( domain === 'camera' ) {

			app.cameraManager?.restoreProjectState?.( state?.engine );
			if ( typeof state?.ui?.zoomToCursor === 'boolean' && app.cameraManager?.controls ) {

				app.cameraManager.controls.zoomToCursor = state.ui.zoomToCursor;

			}

			useCameraStore.setState( {
				...( state?.ui || {} ),
				cameraNames: app.cameraManager?.getCameraNames?.() || [],
				selectedCameraIndex: app.cameraManager?.currentCameraIndex || 0,
			} );
			useCameraStore.getState().applySensorSettings();

		} else if ( domain === 'lights' ) {

			const descriptors = state?.lights || [];
			const restored = app.lightManager?.replaceProjectState?.( descriptors ) || [];
			this.restoreLightResources( descriptors, restored );
			const selectedLightIndex = restored.length
				? Math.min( state.selectedLightIndex ?? 0, restored.length - 1 )
				: null;
			useLightStore.setState( { lights: restored, selectedLightIndex } );

		} else if ( domain === 'animation' ) {

			this.restoreAnimation( state, { preservePlayback: true } );
			app.reset();

		} else if ( domain === 'visibility' ) {

			for ( const item of state || [] ) {

				const object = app.meshScene?.getObjectByProperty?.( 'uuid', item.uuid );
				if ( object ) object.visible = item.visible;

			}

			app.updateAllMeshVisibility?.();
			window.dispatchEvent( new Event( 'meshVisibilityChanged' ) );

		} else if ( domain === 'material' && state ) {

			const object = app.meshScene?.getObjectByProperty?.( 'uuid', state.uuid );
			const materials = Array.isArray( object?.material ) ? object.material : object?.material ? [ object.material ] : [];
			materials.forEach( ( material, index ) => applyMaterialState( material, state.materials[ index ] ) );
			await app.rebuildMaterials?.();
			window.dispatchEvent( new Event( 'MaterialUpdate' ) );

		}

		this.undoBaselines.set( domain, structuredClone( this._captureUndoDomain( domain ) ) );
		this.markDirty();

	}

	_beginTransformUndo( target ) {

		if ( this.hydrating || undoManager.applying ) return;
		const object = target || getApp()?.transformManager?.attachedObject;
		if ( ! object ) return;
		if ( object.isLight ) {

			this.transformUndoStart = { light: true };
			return;

		}

		this.transformUndoStart = { uuid: object.uuid, state: captureNodeTransform( object ) };

	}

	_finishTransformUndo() {

		this.markDirty();
		const start = this.transformUndoStart;
		this.transformUndoStart = null;
		if ( ! start || this.hydrating || undoManager.applying ) return;
		if ( start.light ) {

			this._scheduleUndoCheckpoint( 'lights', 'Transform light' );
			return;

		}

		const object = getApp()?.meshScene?.getObjectByProperty?.( 'uuid', start.uuid );
		if ( ! object ) return;
		const after = captureNodeTransform( object );
		if ( JSON.stringify( start.state ) === JSON.stringify( after ) ) return;
		undoManager.record( {
			label: 'Transform object',
			undo: () => this._applyObjectTransform( start.uuid, start.state ),
			redo: () => this._applyObjectTransform( start.uuid, after ),
		} );

	}

	_applyObjectTransform( uuid, state ) {

		const app = getApp();
		const object = app?.meshScene?.getObjectByProperty?.( 'uuid', uuid );
		if ( ! object ) return;
		restoreNodeTransform( object, state );
		app.transformManager?.applyObjectTransform?.( object );
		this.markDirty();

	}

	capture() {

		const app = getApp();
		if ( ! app || ! this.current ) return this.current;
		const assets = this.unresolved.assets.map( asset => structuredClone( asset ) );
		const nodes = structuredClone( this.unresolved.nodes );
		const materials = structuredClone( this.unresolved.materials );
		const leds = this.unresolved.led.map( led => structuredClone( led ) );
		for ( const root of sceneRoots( app ) ) {

			const instanceId = root.userData.__rayzeeProjectInstanceId || createAssetId();
			root.userData.__rayzeeProjectInstanceId = instanceId;
			assets.push( {
				instanceId,
				catalogId: root.userData.__rayzeeCatalogId,
				assetVersion: root.userData.__rayzeeAssetVersion || 1,
				role: root.userData.__rayzeeAssetRole || ( root === app.sceneModel ? 'primary' : 'appended' ),
				name: root.userData.__rayzeeName || root.name || '',
			} );
			walkNodes( root, ( node, path ) => {

				const nodeKey = `${instanceId}:${path}`;
				nodes[ nodeKey ] = captureNodeTransform( node );
				if ( node.isMesh && node.material ) {

					const list = Array.isArray( node.material ) ? node.material : [ node.material ];
					list.forEach( ( material, index ) => materials[ `${nodeKey}:${index}` ] = serializeMaterial( material ) );

				}

			} );
			const ledMetadata = root.userData?.[ LED_ROOT_METADATA_KEY ];
			if ( ledMetadata?.isLEDVolume ) {

				const snapshot = LEDVideoManager.getSnapshot( root );
				leds.push( {
					wallInstanceId: instanceId,
					brightnessNits: ledMetadata.currentBrightnessNits,
					loop: !! ledMetadata.loop,
					placement: structuredClone( ledMetadata.videoPlacementTransform ),
					video: ledMetadata.videoSource ? {
						...ledMetadata.videoSource,
						currentTime: snapshot?.currentTime ?? ledMetadata.videoSource.currentTime ?? 0,
					} : null,
				} );

			}

		}

		const main = useStore.getState();
		const path = usePathTracerStore.getState();
		const animation = useAnimationStore.getState();
		const environment = useAssetsStore.getState().environment;
		return {
			...this.current,
			updatedAt: new Date().toISOString(),
			scene: {
				units: { length: 'metre', metresPerUnit: 1 },
				assets,
				nodes,
				materials,
				lights: app.lightManager?.getProjectState?.() || app.lightManager?.getAll?.() || [],
				environment: this.unresolved.environment || { catalogId: environment?.id || ( typeof environment === 'string' ? environment : DEFAULT_STATE.environment ) },
			},
			render: {
				engine: app.settings?.getAll?.() || {},
				ui: copySerializableState( path, RENDER_KEYS ),
			},
			cameras: {
				...( app.cameraManager?.getProjectState?.() || {} ),
				ui: copySerializableState( useCameraStore.getState(), CAMERA_KEYS ),
			},
			led: leds,
			animation: copySerializableState( animation, ANIMATION_KEYS ),
			workspace: {
				...this.current.workspace,
				appMode: main.appMode,
				activeTab: main.activeTab,
				transformMode: main.transformMode,
				transformSpace: main.transformSpace,
				selectedEntity: entityKeyForObject( main.selectedObject ),
			},
		};

	}

	async flush() {

		clearTimeout( this.saveTimer );
		if ( this.hydrating || this.scratch || ! this.current || ! this.dirty ) return this.current;
		this.savePromise = this.savePromise.catch( () => {} ).then( async () => {

			useProjectStore.getState().setStatus( 'saving' );
			const captured = this.capture();
			captured.revision = ( this.current.revision || 0 ) + 1;
			try {

				if ( this.current.projectId === this.defaultProjectId ) {

					const name = nextWorkingProjectName( await this.repository.list() );
					this.current = await this.repository.fork( this.defaultProjectId, captured, name );

				} else this.current = await this.repository.save( captured );
				this.dirty = false;
				useProjectStore.getState().setActiveProject( { ...this.current } );
				useProjectStore.getState().setStatus( 'saved' );
				await this.refreshList();

			} catch ( error ) {

				useProjectStore.getState().setStatus( 'error', error.message || 'Autosave failed.' );
				throw error;

			}

			return this.current;

		} );
		return this.savePromise;

	}

	async hydrate( document ) {

		if ( ! document ) throw new Error( 'Project not found.' );
		await this.flush();
		this.hydrating = true;
		this.scratch = false;
		useProjectStore.getState().setStatus( 'loading' );
		useProjectStore.getState().setMissingMedia( [] );
		useProjectStore.getState().setWarnings( [] );
		const app = getApp();
		try {

			const unresolvedAssets = document.scene.assets.filter( asset => ! MODEL_FILES.some( item => item.id === asset.catalogId ) );
			const unresolvedIds = new Set( unresolvedAssets.map( asset => asset.instanceId ) );
			const savedEnvironmentId = document.scene.environment?.catalogId || DEFAULT_STATE.environment;
			const savedEnvironment = EnvironmentService.getEnvironmentById( savedEnvironmentId );
			this.unresolved = {
				assets: unresolvedAssets,
				nodes: Object.fromEntries( Object.entries( document.scene.nodes || {} ).filter( ( [ key ] ) => unresolvedIds.has( key.slice( 0, key.indexOf( ':' ) ) ) ) ),
				materials: Object.fromEntries( Object.entries( document.scene.materials || {} ).filter( ( [ key ] ) => unresolvedIds.has( key.slice( 0, key.indexOf( ':' ) ) ) ) ),
				led: ( document.led || [] ).filter( led => unresolvedIds.has( led.wallInstanceId ) ),
				environment: savedEnvironment ? null : { catalogId: savedEnvironmentId },
			};
			const warnings = unresolvedAssets.map( asset => `Bundled asset “${asset.catalogId}” is unavailable.` );
			if ( ! savedEnvironment ) warnings.push( `Environment “${savedEnvironmentId}” is unavailable; the default is shown.` );
			useProjectStore.getState().setWarnings( warnings );

			app.animationManager?.stop?.();
			LEDVideoManager.disposeAll();
			this.videoStates.clear();
			const primary = document.scene.assets.find( asset => asset.role === 'primary' );
			if ( primary ) {

				const index = MODEL_FILES.findIndex( item => item.id === primary.catalogId );
				if ( index >= 0 ) {

					await app.loadExampleModels( index, MODEL_FILES );
					Object.assign( app.sceneModel.userData, {
						__rayzeeProjectInstanceId: primary.instanceId,
						__rayzeeCatalogId: primary.catalogId,
						__rayzeeAssetVersion: primary.assetVersion || 1,
						__rayzeeAssetRole: 'primary',
					} );

				} else app.unloadScene();

			} else {

				app.unloadScene();

			}

			const appendedAssets = document.scene.assets.filter( item => item.role !== 'primary' )
				.map( asset => ( { asset, catalog: MODEL_FILES.find( item => item.id === asset.catalogId ) } ) )
				.filter( item => item.catalog );
			await app.addModels( appendedAssets.map( ( { asset, catalog } ) => ( {
				url: catalog.url,
				name: asset.name || catalog.name,
				prepareRoot: root => {

					if ( catalog.led ) prepareLEDAssetRoot( root, catalog );
					Object.assign( root.userData, {
						__rayzeeProjectInstanceId: asset.instanceId,
						__rayzeeCatalogId: catalog.id,
						__rayzeeAssetVersion: asset.assetVersion || catalog.assetVersion || 1,
						__rayzeeAssetRole: 'appended',
					} );

				},
			} ) ), { deferRebuild: true } );

			for ( const [ key, state ] of Object.entries( document.scene.nodes || {} ) ) {

				const object = findEntity( app, key );
				if ( ! object ) continue;
				restoreNodeTransform( object, state );

			}

			for ( const [ key, state ] of Object.entries( document.scene.materials || {} ) ) {

				const separator = key.lastIndexOf( ':' );
				const object = findEntity( app, key.slice( 0, separator ) );
				const index = Number( key.slice( separator + 1 ) );
				let material = Array.isArray( object?.material ) ? object.material[ index ] : index === 0 ? object?.material : null;
				if ( material && state.catalogMaterial?.source === 'polyhaven' ) {

					try {

						const config = await PolyHavenService.loadCompleteMaterial( state.catalogMaterial );
						const restored = await PolyHavenMaterialLoader.createThreeJSMaterial( config );
						restored.userData.rayzeeCatalogMaterial = { ...state.catalogMaterial };
						if ( Array.isArray( object.material ) ) object.material[ index ] = restored;
						else object.material = restored;
						material = restored;

					} catch ( error ) {

						console.warn( `Catalog material ${state.catalogMaterial.assetId} could not be restored`, error );

					}

				}

				applyMaterialState( material, state );

			}

			// One final rebuild installs all appended assets and also restores the permanent
			// ground for a deliberately blank project.
			await app.loadSceneData();

			const environment = savedEnvironment || EnvironmentService.getEnvironmentById( DEFAULT_STATE.environment );
			if ( environment?.url ) {

				await app.loadEnvironment( environment.url );
				useAssetsStore.getState().setEnvironment( environment );

			}

			this.applyRenderState( document.render );
			const restoredLights = app.lightManager?.replaceProjectState?.( document.scene.lights || [] ) || [];
			this.restoreLightResources( document.scene.lights || [], restoredLights );
			app.cameraManager?.restoreProjectState?.( document.cameras );
			for ( const camera of [ app.cameraManager?.camera, ...( app.cameraManager?.cameras || [] ) ] ) if ( camera?.isPerspectiveCamera ) {

				camera.aspect = SENSOR_ASPECT_RATIO; camera.updateProjectionMatrix();

			}

			const initialCameraState = useCameraStore.getInitialState();
			const savedCameraUi = document.cameras?.ui;
			const legacyFocalLength = document.cameras?.active?.effects?.focalLength;
			useCameraStore.setState( {
				sensorPreset: initialCameraState.sensorPreset,
				sensorWidth: initialCameraState.sensorWidth,
				sensorHeight: initialCameraState.sensorHeight,
				frameOverlayRatio: initialCameraState.frameOverlayRatio,
				dofMode: app.settings?.get?.( 'dofMode' ) ?? initialCameraState.dofMode,
				dofBlur: app.settings?.get?.( 'dofBlur' ) ?? initialCameraState.dofBlur,
				unitsPerMetre: app.settings?.get?.( 'unitsPerMetre' ) ?? initialCameraState.unitsPerMetre,
				...( Number.isFinite( legacyFocalLength ) ? { focalLength: legacyFocalLength } : {} ),
				...( savedCameraUi || {} ),
				cameraNames: app.cameraManager?.getCameraNames?.() || [],
				selectedCameraIndex: app.cameraManager?.currentCameraIndex || 0,
			} );
			useCameraStore.getState().applySensorSettings();
			this.restoreAnimation( document.animation );
			await this.restoreLEDVideos( document );
			this.current = { ...document, lastOpenedAt: new Date().toISOString() };
			this.dirty = false;
			useStore.setState( {
				appMode: document.workspace?.appMode || 'preview',
				activeTab: document.workspace?.activeTab || 'pathtracer',
				transformMode: document.workspace?.transformMode || 'translate',
				transformSpace: document.workspace?.transformSpace || 'world',
			} );
			const selected = findEntity( app, document.workspace?.selectedEntity );
			if ( selected ) app.interactionManager?.select?.( selected );
			await this.repository.setActiveProjectId( document.projectId );
			// Opening the default project must be read-only. Other projects retain the
			// convenience last-opened timestamp in their local document.
			if ( document.projectId !== this.defaultProjectId ) await this.repository.save( this.current );
			useProjectStore.getState().setActiveProject( { ...this.current } );
			await this.refreshList();
			useProjectStore.getState().setStatus( 'saved' );
			window.dispatchEvent( new CustomEvent( 'project:hydrated', { detail: { projectId: document.projectId } } ) );
			app.reset();
			this._resetUndoHistory();
			useStore.getState().resetLoading();

		} catch ( error ) {

			// A failed append can leave some project roots in the scene. Clear them so
			// the next project opens from a known state instead of inheriting them.
			try {

				app.unloadScene();

			} catch ( cleanupError ) {

				console.warn( 'Could not clear the failed project load', cleanupError );

			}

			this.current = null;
			useProjectStore.getState().setActiveProject( null );
			const message = error.message || 'Project loading failed.';
			useProjectStore.getState().setStatus( 'error', message );
			useStore.getState().setLoading( {
				isLoading: true,
				failed: true,
				failedTitle: 'Project loading failed',
				status: message,
				progress: 0,
				canCancel: false,
			} );
			throw error;

		} finally {

			this.hydrating = false;

		}

	}

	applyRenderState( render = {} ) {

		const app = getApp();
		const savedUi = render.ui || {};
		const resolution = Math.max( savedUi.canvasWidth || 0, savedUi.canvasHeight || 0 ) || savedUi.resolution || DEFAULT_STATE.resolution;
		const dimensions = computeOutputDimensions( savedUi, resolution );
		const ui = { ...savedUi, canvasWidth: dimensions.width, canvasHeight: dimensions.height, aspectRatioPreset: '16:9', orientation: 'landscape' };
		const defaultPathTracerEnabled = usePathTracerStore.getInitialState().enablePathTracer;
		const enablePathTracer = typeof ui.enablePathTracer === 'boolean'
			? ui.enablePathTracer
			: defaultPathTracerEnabled;
		usePathTracerStore.setState( { ...ui, enablePathTracer } );
		app.settings?.setMany?.( { dofMode: 'legacy', dofBlur: DEFAULT_STATE.dofBlur, unitsPerMetre: DEFAULT_STATE.unitsPerMetre, ...( render.engine || {} ) }, { reset: false } );
		if ( Number.isFinite( ui.toneMapping ) ) app.renderer.toneMapping = ui.toneMapping;
		if ( Number.isFinite( ui.maxTextureSize ) ) app.setMaxTextureSize?.( ui.maxTextureSize, { reprocess: false } );
		if ( Number.isFinite( ui.canvasWidth ) && Number.isFinite( ui.canvasHeight ) ) app.setCanvasSize( ui.canvasWidth, ui.canvasHeight );
		if ( ui.denoiserStrategy ) app.denoisingManager?.setDenoiserStrategy?.(
			ui.denoiserStrategy,
			ui.denoiserStrategy === 'nrd' ? ui.nrdQualityPreset : ui.asvgfQualityPreset
		);
		const nrdParams = Object.fromEntries( Object.entries( {
			maxAccumulatedFrameNum: ui.nrdMaxAccumulatedFrameNum,
			maxBlurRadius: ui.nrdMaxBlurRadius,
			prepassBlurRadius: ui.nrdPrepassBlurRadius,
			enableAntiFirefly: ui.nrdAntiFirefly,
		} ).filter( ( [ , value ] ) => value !== undefined ) );
		if ( Object.keys( nrdParams ).length ) app.denoisingManager?.setNRDParams?.( nrdParams );
		if ( Number.isFinite( ui.nrdDebugMode ) ) app.denoisingManager?.setNRDDebugMode?.( ui.nrdDebugMode );
		app.denoisingManager?.setOIDNEnabled?.( !! ui.enableOIDN );
		if ( ui.upscalerBackend ) app.denoisingManager?.setUpscalerBackend?.( ui.upscalerBackend );
		app.denoisingManager?.setUpscalerEnabled?.( !! ui.enableUpscaler );
		const neuralSettings = Object.fromEntries( Object.entries( {
			intensity: ui.nrIntensity,
			localTone: ui.nrLocalTone,
			localStructure: ui.nrLocalStructure,
			colorStrength: ui.nrColorStrength,
		} ).filter( ( [ , value ] ) => value !== undefined ) );
		app.denoisingManager?.setNeuralRendering?.( !! ui.neuralRendering, neuralSettings );
		app.environmentManager?.setMode?.( ui.environmentMode || 'hdri' );
		// Keep the LED coordinator's saved preference and the engine in lock-step.
		// Direct assignment here used to leave its startup snapshot at `true`, allowing
		// it to re-enable tracing while the UI still showed raster mode.
		LEDVideoManager.attachApp( app );
		LEDVideoManager.setUserPathTracerPreference( enablePathTracer );

	}

	restoreLightResources( saved, restored ) {

		const app = getApp();
		restored.forEach( ( light, index ) => {

			const source = saved[ index ];
			if ( source?.gobo ) app.goboManager?.setLightGobo?.( light.uuid, source.gobo, {
				intensity: source.goboIntensity ?? 1,
				inverted: !! source.goboInverted,
				scale: source.goboScale ?? 5,
			} );
			if ( source?.ies ) app.iesManager?.setSpotLightProfile?.( light.uuid, source.ies, source.iesIntensity ?? 1, { applyAutoCone: false } );

		} );

	}

	restoreAnimation( state = {}, { preservePlayback = false } = {} ) {

		const previous = useAnimationStore.getState();
		const selectedClip = state.selectedClip || 0;
		const storeState = {
			selectedClip,
			speed: state.speed || 1,
			loop: state.loop !== false,
			loopCount: state.loopCount || 1,
			isPlaying: preservePlayback ? previous.isPlaying : false,
			isPaused: preservePlayback ? previous.isPaused : false,
		};
		useAnimationStore.setState( storeState );
		const manager = getApp()?.animationManager;
		manager?.setSpeed?.( storeState.speed );
		manager?.setLoop?.( storeState.loop );
		if ( preservePlayback && selectedClip !== previous.selectedClip ) {

			if ( previous.isPlaying ) manager?.play?.( selectedClip );
			else if ( previous.isPaused ) {

				manager?.play?.( selectedClip );
				manager?.pause?.();

			}

		}

	}

	async restoreLEDVideos( document ) {

		LEDVideoManager.syncScene();
		const roots = sceneRoots( getApp() );
		const missing = [];
		for ( const saved of document.led || [] ) {

			const root = roots.find( item => item.userData.__rayzeeProjectInstanceId === saved.wallInstanceId );
			if ( ! root ) continue;
			const metadata = root.userData[ LED_ROOT_METADATA_KEY ];
			metadata.currentBrightnessNits = saved.brightnessNits ?? metadata.currentBrightnessNits;
			metadata.loop = saved.loop ?? metadata.loop;
			if ( saved.placement ) metadata.videoPlacementTransform = structuredClone( saved.placement );
			if ( ! saved.video ) continue;
			metadata.videoSource = { ...saved.video };
			if ( saved.video.plateSetId ) {

				try {

					const { LocalPlateLibrary } = await import( '../plates/LocalPlateLibrary.js' );
					const { PlateSetSource } = await import( '../plates/PlateSetSource.js' );
					const library = new LocalPlateLibrary();
					const { getPlateLibraryService } = await import( '../plates/PlateLibraryService.js' );
					const service = getPlateLibraryService();
					const records = await library.list();
					let manifest = records.find( item => item.manifest.id === saved.video.plateSetId )?.manifest;
					try { manifest = ( await service.list() ).find( item => item.id === saved.video.plateSetId ) || manifest; } catch { /* Local files remain usable offline. */ }
					if ( ! manifest ) throw new Error( 'This driving plate set is no longer available.' );
					const local = await service.ensure( manifest );
					const source = await PlateSetSource.open( library, local.manifest, { encoding: local.encoding } );
					await LEDVideoManager.choosePlate( root, source, { view: saved.video.plateView || 'front', initialTime: saved.video.currentTime || 0, autoplay: false } );
					LEDVideoManager.setBrightness( root, metadata.currentBrightnessNits );
					LEDVideoManager.setPlacement( root, saved.placement || {}, { commit: true } );

				} catch ( error ) {

					LEDVideoManager.setMissingVideo( root, saved.video, error.message );
					missing.push( { wallInstanceId: saved.wallInstanceId, video: saved.video, permission: 'missing' } );

				}

				continue;

			}

			// Pinned preset media is a project resource. Reconnect once when opening
			// the project, never when selecting an object-state preset.
			const pinned = document.extensions?.localPresetMedia?.[ saved.wallInstanceId ];
			if ( pinned ) {

				const { getAdminPresetRepository } = await import( '../presets/PresetRepository.js' );
				const repository = getAdminPresetRepository();
				const asset = await repository.getAssetMetadata?.( pinned );
				const { getPlateLibraryService } = await import( '../plates/PlateLibraryService.js' );
				const service = getPlateLibraryService();
				const match = asset && await service.findAsset( asset );
				if ( match ) {

					const local = await service.ensure( match.manifest );
					const { PlateSetSource } = await import( '../plates/PlateSetSource.js' );
					const source = await PlateSetSource.open( service.library, local.manifest, { encoding: local.encoding } );
					await LEDVideoManager.choosePlate( root, source, { view: match.view, initialTime: saved.video.currentTime || 0, autoplay: false } );
					LEDVideoManager.setBrightness( root, metadata.currentBrightnessNits );
					LEDVideoManager.setPlacement( root, saved.placement || {}, { commit: true } );
					continue;

				}
				const blob = await repository.getAsset( pinned );
				if ( blob ) {

					await LEDVideoManager.chooseVideo( root, new File( [ blob ], saved.video.name, { type: blob.type, lastModified: saved.video.lastModified || 0 } ), { sourceRef: saved.video, initialTime: saved.video.currentTime || 0 } );
					LEDVideoManager.setBrightness( root, metadata.currentBrightnessNits );
					LEDVideoManager.setPlacement( root, saved.placement || {}, { commit: true } );
					continue;

				}

			}

			const handle = await this.repository.getHandle( document.projectId, saved.video.assetId );
			let permission = 'denied';
			let reconnectMessage = 'Reconnect this video to restore it.';
			try {

				permission = handle?.queryPermission ? await handle.queryPermission( { mode: 'read' } ) : 'denied';

			} catch {

				permission = 'denied';

			}

			if ( handle && permission === 'granted' ) {

				try {

					const file = await handle.getFile();
					if ( file.name !== saved.video.name || file.size !== saved.video.size ||
						( saved.video.lastModified && file.lastModified !== saved.video.lastModified ) ) {

						throw new Error( 'The linked video has changed.' );

					}

					await LEDVideoManager.chooseVideo( root, file, { sourceRef: saved.video, initialTime: saved.video.currentTime || 0 } );
					LEDVideoManager.setBrightness( root, metadata.currentBrightnessNits );
					LEDVideoManager.setPlacement( root, saved.placement || {}, { commit: true } );
					continue;

				} catch ( error ) {

					reconnectMessage = error.message || reconnectMessage;

				}

			}

			LEDVideoManager.setMissingVideo( root, saved.video, reconnectMessage );
			missing.push( { wallInstanceId: saved.wallInstanceId, video: saved.video, permission } );

		}

		useProjectStore.getState().setMissingMedia( missing );

	}

	async refreshList() {

		useProjectStore.getState().setProjects( await this.repository.list() );

	}

	async switchTo( projectId ) {

		const document = await this.repository.get( projectId );
		await this.hydrate( document );

	}

	async create( name = 'Untitled Project' ) {

		await this.flush();
		const document = await this.repository.create( { name } );
		await this.hydrate( document );
		return document;

	}

	async rename( projectId, name ) {

		if ( projectId === this.defaultProjectId ) throw new Error( 'The default project is read-only.' );
		if ( projectId === this.current?.projectId ) await this.flush();
		const document = await this.repository.get( projectId );
		if ( ! document ) return;
		document.name = name.trim() || document.name;
		document.updatedAt = new Date().toISOString();
		document.revision = ( document.revision || 0 ) + 1;
		await this.repository.save( document );
		if ( projectId === this.current?.projectId ) {

			this.current = document;
			useProjectStore.getState().setActiveProject( { ...document } );

		}

		await this.refreshList();

	}

	async saveCurrentAsDefault() {

		if ( this.scratch ) throw new Error( 'Scratch scenes cannot replace the default project.' );
		if ( ! this.current || ! this.defaultProjectId ) throw new Error( 'No default project is available.' );
		clearTimeout( this.saveTimer );
		// Preserve a normal working project before promoting its current scene. When
		// the default itself is active, deliberately bypass flush(): this command is
		// the one authorized path that writes it instead of silently forking it.
		if ( this.current.projectId !== this.defaultProjectId ) await this.flush();
		else await this.savePromise.catch( () => {} );

		useProjectStore.getState().setStatus( 'saving' );
		try {

			const sourceProjectId = this.current.projectId;
			const existingDefault = await this.repository.get( this.defaultProjectId );
			if ( ! existingDefault ) throw new Error( 'The default project could not be found.' );
			const captured = this.capture();
			const replacement = createDefaultReplacement( captured, existingDefault );
			this.current = await this.repository.replaceDefault(
				sourceProjectId,
				this.defaultProjectId,
				replacement
			);
			this.dirty = false;
			useProjectStore.getState().setActiveProject( { ...this.current } );
			useProjectStore.getState().setStatus( 'saved' );
			await this.refreshList();
			return this.current;

		} catch ( error ) {

			useProjectStore.getState().setStatus( 'error', error.message || 'Saving the default project failed.' );
			throw error;

		}

	}

	async duplicate( projectId ) {

		if ( projectId === this.current?.projectId ) await this.flush();
		const copy = await this.repository.duplicate( projectId );
		await this.refreshList();
		return copy;

	}

	async delete( projectId ) {

		if ( projectId === this.defaultProjectId ) throw new Error( 'The default project cannot be deleted.' );
		const wasActive = projectId === this.current?.projectId;
		if ( wasActive ) await this.flush();
		await this.repository.delete( projectId );
		let projects = await this.repository.list();
		if ( projects.length === 0 ) projects = [ await this.repository.create( { name: 'Untitled Project' } ) ];
		if ( wasActive ) {

			this.current = null;
			await this.hydrate( projects[ 0 ] );

		} else await this.refreshList();

	}

	async exportProject( projectId = this.current?.projectId ) {

		if ( projectId === this.current?.projectId ) await this.flush();
		const project = await this.repository.get( projectId );
		const blob = new Blob( [ this.repository.serialize( project ) ], { type: PROJECT_MIME_TYPE } );
		const filename = `${project.name.replace( /[^a-z0-9-_]+/gi, '-' ) || 'project'}${PROJECT_FILE_EXTENSION}`;
		if ( window.showSaveFilePicker ) {

			const handle = await window.showSaveFilePicker( {
				suggestedName: filename,
				types: [ { description: 'Rayzee Project', accept: { [ PROJECT_MIME_TYPE ]: [ PROJECT_FILE_EXTENSION ] } } ],
			} );
			const writable = await handle.createWritable();
			await writable.write( blob );
			await writable.close();

		} else {

			const url = URL.createObjectURL( blob );
			const link = Object.assign( globalThis.document.createElement( 'a' ), { href: url, download: filename } );
			link.click();
			URL.revokeObjectURL( url );

		}

	}

	async importProject() {

		let file;
		if ( window.showOpenFilePicker ) {

			const [ handle ] = await window.showOpenFilePicker( {
				types: [ { description: 'Rayzee Project', accept: { [ PROJECT_MIME_TYPE ]: [ PROJECT_FILE_EXTENSION, '.json' ] } } ],
			} );
			file = await handle.getFile();

		} else {

			file = await new Promise( resolve => {

				const input = Object.assign( document.createElement( 'input' ), { type: 'file', accept: '.rayzee,.json' } );
				input.onchange = () => resolve( input.files?.[ 0 ] || null );
				input.click();

			} );

		}

		if ( ! file ) return null;
		const imported = this.repository.deserialize( await file.text() );
		await this.repository.save( imported );
		await this.hydrate( imported );
		return imported;

	}

	async chooseLEDVideo( root ) {

		if ( ! window.showOpenFilePicker ) throw new Error( 'Rayzee video persistence requires desktop Chrome or Edge.' );
		const [ handle ] = await window.showOpenFilePicker( {
			types: [ {
				description: 'H.264 video (MP4 or MOV)',
				accept: {
					'video/mp4': [ '.mp4' ],
					'video/quicktime': [ '.mov' ],
				},
			} ],
		} );
		const file = await handle.getFile();
		const existing = root.userData?.[ LED_ROOT_METADATA_KEY ]?.videoSource;
		const sourceRef = {
			assetId: existing?.assetId || createAssetId(),
			name: file.name,
			type: getLEDVideoMimeType( file ),
			size: file.size,
			lastModified: file.lastModified || 0,
		};
		await LEDVideoManager.chooseVideo( root, file, { sourceRef } );
		// Fork a read-only default before storing a handle, otherwise replacing a
		// default LED's video would overwrite the template's retained permission.
		this.markDirty();
		await this.flush();
		try {

			await this.repository.putHandle( this.current.projectId, sourceRef.assetId, handle );

		} catch ( error ) {

			useProjectStore.getState().setStatus( 'error', 'The video handle could not be retained.' );
			throw error;

		}

		useProjectStore.getState().setMissingMedia( useProjectStore.getState().missingMedia.filter( item => item.wallInstanceId !== root.userData.__rayzeeProjectInstanceId ) );
		this.markDirty();
		await this.flush();

	}

	async reconnectLEDVideo( root ) {

		const source = root.userData?.[ LED_ROOT_METADATA_KEY ]?.videoSource;
		const handle = source && await this.repository.getHandle( this.current.projectId, source.assetId );
		if ( handle?.requestPermission ) {

			try {

				if ( await handle.requestPermission( { mode: 'read' } ) === 'granted' ) {

					const file = await handle.getFile();
					const differs = file.name !== source.name || file.size !== source.size ||
						( source.lastModified && file.lastModified !== source.lastModified );
					if ( differs && ! window.confirm( `The selected file’s details differ from the saved video “${source.name}”. Use it anyway?` ) ) return;
					const updatedSource = {
						...source,
						name: file.name,
						type: getLEDVideoMimeType( file ),
						size: file.size,
						lastModified: file.lastModified || 0,
					};
					await LEDVideoManager.chooseVideo( root, file, { sourceRef: updatedSource, initialTime: source.currentTime || 0 } );
					useProjectStore.getState().setMissingMedia( useProjectStore.getState().missingMedia.filter( item => item.wallInstanceId !== root.userData.__rayzeeProjectInstanceId ) );
					this.markDirty();
					await this.flush();
					return;

				}

			} catch { /* fall through to relink picker */ }

		}

		await this.chooseLEDVideo( root );

	}

	async clearLEDVideo( root ) {

		const source = root.userData?.[ LED_ROOT_METADATA_KEY ]?.videoSource;
		LEDVideoManager.clearVideo( root );
		this.markDirty();
		await this.flush();
		if ( source?.assetId ) await this.repository.deleteHandle( this.current.projectId, source.assetId );

	}

	async enterScratch() {

		await this.flush();
		this.scratch = true;
		clearTimeout( this.saveTimer );
		useProjectStore.getState().setStatus( 'scratch' );

	}

}

export const projectSession = new ProjectSession();
