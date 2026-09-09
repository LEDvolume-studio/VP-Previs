import { DEFAULT_STATE, MODEL_FILES } from '@/Constants';
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
import { LEDVideoManager, LED_ROOT_METADATA_KEY, prepareLEDAssetRoot } from '@/services/LEDVideoManager';
import { createAssetId, PROJECT_FILE_EXTENSION, PROJECT_MIME_TYPE } from './ProjectSchema';
import { projectRepository } from './ProjectRepository';
import { useProjectStore } from './projectStore';
import {
	captureNodeTransform,
	createDefaultReplacement,
	hasChangedKeys,
	nextWorkingProjectName,
	restoreNodeTransform,
} from './projectStateUtils';

const AUTOSAVE_DELAY = 750;
const VIDEO_CHECKPOINT_INTERVAL = 5000;
const RENDER_KEYS = new Set( [ ...Object.keys( DEFAULT_STATE ),
	'GIIntensity', 'asvgfQualityPreset', 'denoiserStrategy', 'filterStrength',
	'edgeAtrousIterations', 'edgePhiLuminance', 'edgePhiNormal', 'edgePhiDepth',
	'oidnQuality', 'enableOIDN', 'enableUpscaler', 'upscalerScale', 'upscalerQuality',
	'upscalerHdr', 'showAsvgfHeatmap',
] );
const WORKSPACE_KEYS = [ 'appMode', 'activeTab', 'transformMode', 'transformSpace' ];
const ANIMATION_KEYS = [ 'selectedClip', 'speed', 'loop', 'loopCount' ];
const MATERIAL_SCALARS = [
	'roughness', 'metalness', 'ior', 'opacity', 'transmission', 'thickness',
	'attenuationDistance', 'dispersion', 'sheen', 'sheenRoughness',
	'specularIntensity', 'clearcoat', 'clearcoatRoughness', 'iridescence',
	'iridescenceIOR', 'subsurface', 'subsurfaceRadiusScale',
	'subsurfaceAnisotropy', 'anisotropy', 'anisotropyRotation', 'emissiveIntensity',
	'transparent', 'alphaTest', 'side', 'normalScale', 'bumpScale',
	'displacementScale', 'displacementBias',
];
const MATERIAL_COLORS = [ 'color', 'emissive', 'attenuationColor', 'sheenColor', 'specularColor', 'subsurfaceColor' ];
const MATERIAL_ARRAYS = [ 'iridescenceThicknessRange', 'subsurfaceRadius' ];
const TEXTURE_SLOTS = [
	'map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap',
	'aoMap', 'alphaMap', 'lightMap', 'specularMap', 'clearcoatNormalMap',
	'displacementMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'transmissionMap',
	'thicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap',
	'specularColorMap', 'iridescenceMap', 'iridescenceThicknessMap',
];

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

function serializeTexture( texture ) {

	if ( ! texture?.isTexture ) return null;
	return {
		name: texture.name || '',
		offset: texture.offset?.toArray?.() || [ 0, 0 ],
		repeat: texture.repeat?.toArray?.() || [ 1, 1 ],
		center: texture.center?.toArray?.() || [ 0, 0 ],
		rotation: texture.rotation || 0,
		flipY: !! texture.flipY,
		channel: texture.channel || 0,
	};

}

function serializeMaterial( material ) {

	const result = { name: material.name || '', type: material.type, values: {}, colors: {}, arrays: {}, textures: {} };
	for ( const key of MATERIAL_SCALARS ) {

		let value = material[ key ];
		if ( value?.isVector2 ) value = value.toArray();
		if ( value !== undefined ) result.values[ key ] = finiteOrNull( value );

	}

	for ( const key of MATERIAL_COLORS ) if ( material[ key ]?.isColor ) result.colors[ key ] = `#${material[ key ].getHexString()}`;
	for ( const key of MATERIAL_ARRAYS ) if ( material[ key ] != null ) result.arrays[ key ] = Array.from( material[ key ] );
	for ( const key of TEXTURE_SLOTS ) {

		const texture = serializeTexture( material[ key ] );
		result.textures[ key ] = texture;

	}

	if ( material.userData?.rayzeeCatalogMaterial ) result.catalogMaterial = { ...material.userData.rayzeeCatalogMaterial };
	return result;

}

function applyMaterialState( material, state ) {

	if ( ! material || ! state ) return;
	material.name = state.name || material.name;
	for ( const [ key, value ] of Object.entries( state.values || {} ) ) {

		const resolved = key === 'attenuationDistance' && value === null ? Infinity : value;
		if ( material[ key ]?.isVector2 && Array.isArray( resolved ) ) material[ key ].fromArray( resolved );
		else material[ key ] = resolved;

	}

	for ( const [ key, value ] of Object.entries( state.colors || {} ) ) material[ key ]?.set?.( value );
	for ( const [ key, value ] of Object.entries( state.arrays || {} ) ) material[ key ] = [ ...value ];
	for ( const [ key, value ] of Object.entries( state.textures || {} ) ) {

		if ( value === null ) {

			material[ key ] = null;
			continue;

		}

		const texture = material[ key ];
		if ( ! texture ) continue;
		if ( value.offset ) texture.offset.fromArray( value.offset );
		if ( value.repeat ) texture.repeat.fromArray( value.repeat );
		if ( value.center ) texture.center.fromArray( value.center );
		texture.rotation = value.rotation || 0;
		texture.flipY = !! value.flipY;
		texture.channel = value.channel || 0;
		texture.updateMatrix?.();
		texture.needsUpdate = true;

	}

	material.needsUpdate = true;

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

	}

	async initialize() {

		useProjectStore.getState().setStatus( 'loading' );
		await this.repository.init();
		globalThis.navigator?.storage?.persist?.().catch( () => false );
		let projects = await this.repository.list();
		if ( projects.length === 0 ) {

			const catalog = MODEL_FILES[ DEFAULT_STATE.model ];
			projects = [ await this.repository.create( { name: 'Welcome Project', primaryCatalogId: catalog?.id } ) ];

		}

		let defaultProjectId = await this.repository.getDefaultProjectId();
		if ( ! projects.some( project => project.projectId === defaultProjectId ) ) {

			const welcome = projects.find( project => project.name === 'Welcome Project' );
			const oldest = [ ...projects ].sort( ( a, b ) => new Date( a.createdAt ) - new Date( b.createdAt ) )[ 0 ];
			defaultProjectId = ( welcome || oldest ).projectId;
			await this.repository.setDefaultProjectId( defaultProjectId );

		}

		this.defaultProjectId = defaultProjectId;
		useProjectStore.getState().setDefaultProjectId( defaultProjectId );

		const activeId = await this.repository.getActiveProjectId();
		const active = projects.find( project => project.projectId === activeId ) || projects[ 0 ];
		this.bindAutosave();
		await this.hydrate( active );
		return active;

	}

	bindAutosave() {

		if ( this.unsubscribers.length ) return;
		this.unsubscribers.push( useStore.subscribe( ( next, previous ) => {

			if ( hasChangedKeys( next, previous, WORKSPACE_KEYS ) || next.selectedObject !== previous.selectedObject ) this.markDirty();

		} ) );
		this.unsubscribers.push( usePathTracerStore.subscribe( ( next, previous ) => {

			if ( hasChangedKeys( next, previous, RENDER_KEYS ) ) this.markDirty();

		} ) );
		this.unsubscribers.push( useLightStore.subscribe( ( next, previous ) => {

			if ( next.lights !== previous.lights ) this.markDirty();

		} ) );
		this.unsubscribers.push( useCameraStore.subscribe( ( next, previous ) => {

			if ( next.cameraNames !== previous.cameraNames || next.selectedCameraIndex !== previous.selectedCameraIndex ||
				next.focusDistance !== previous.focusDistance || next.autoFocusMode !== previous.autoFocusMode ) this.markDirty();

		} ) );
		this.unsubscribers.push( useAnimationStore.subscribe( ( next, previous ) => {

			if ( hasChangedKeys( next, previous, ANIMATION_KEYS ) ) this.markDirty();

		} ) );
		const app = getApp();
		const events = [ 'engine:settingChanged', 'engine:objectTransformEnd', 'SceneRebuild', 'ModelAdded', 'ModelLoaded', 'SceneObjectRemoved', 'EnvironmentLoaded' ];
		const onChange = () => this.markDirty();
		for ( const type of events ) {

			app?.addEventListener?.( type, onChange );
			this.unsubscribers.push( () => app?.removeEventListener?.( type, onChange ) );

		}

		const onCamera = () => this.markDirty();
		app?.cameraManager?.controls?.addEventListener?.( 'change', onCamera );
		this.unsubscribers.push( () => app?.cameraManager?.controls?.removeEventListener?.( 'change', onCamera ) );
		const onMaterial = () => this.markDirty();
		window.addEventListener( 'MaterialUpdate', onMaterial );
		this.unsubscribers.push( () => window.removeEventListener( 'MaterialUpdate', onMaterial ) );
		window.addEventListener( 'meshVisibilityChanged', onMaterial );
		this.unsubscribers.push( () => window.removeEventListener( 'meshVisibilityChanged', onMaterial ) );
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
						currentTime: snapshot?.currentTime || ledMetadata.videoSource.currentTime || 0,
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
			cameras: app.cameraManager?.getProjectState?.() || null,
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
			useCameraStore.setState( {
				cameraNames: app.cameraManager?.getCameraNames?.() || [],
				selectedCameraIndex: app.cameraManager?.currentCameraIndex || 0,
			} );
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

		} catch ( error ) {

			useProjectStore.getState().setStatus( 'error', error.message || 'Project loading failed.' );
			throw error;

		} finally {

			this.hydrating = false;

		}

	}

	applyRenderState( render = {} ) {

		const app = getApp();
		const ui = render.ui || {};
		usePathTracerStore.setState( ui );
		app.settings?.setMany?.( render.engine || {}, { reset: false } );
		if ( Number.isFinite( ui.toneMapping ) ) app.renderer.toneMapping = ui.toneMapping;
		if ( Number.isFinite( ui.maxTextureSize ) ) app.setMaxTextureSize?.( ui.maxTextureSize, { reprocess: false } );
		if ( Number.isFinite( ui.canvasWidth ) && Number.isFinite( ui.canvasHeight ) ) app.setCanvasSize( ui.canvasWidth, ui.canvasHeight );
		if ( ui.denoiserStrategy ) app.denoisingManager?.setDenoiserStrategy?.( ui.denoiserStrategy, ui.asvgfQualityPreset );
		app.denoisingManager?.setOIDNEnabled?.( !! ui.enableOIDN );
		app.denoisingManager?.setUpscalerEnabled?.( !! ui.enableUpscaler );
		app.environmentManager?.setMode?.( ui.environmentMode || 'hdri' );
		app.pathTracerEnabled = ui.enablePathTracer !== false;

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

	restoreAnimation( state = {} ) {

		const storeState = {
			selectedClip: state.selectedClip || 0,
			speed: state.speed || 1,
			loop: state.loop !== false,
			loopCount: state.loopCount || 1,
			isPlaying: false,
			isPaused: false,
		};
		useAnimationStore.setState( storeState );
		getApp()?.animationManager?.setSpeed?.( storeState.speed );
		getApp()?.animationManager?.setLoop?.( storeState.loop );

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
			types: [ { description: 'H.264 MP4 video', accept: { 'video/mp4': [ '.mp4' ] } } ],
		} );
		const file = await handle.getFile();
		const existing = root.userData?.[ LED_ROOT_METADATA_KEY ]?.videoSource;
		const sourceRef = {
			assetId: existing?.assetId || createAssetId(),
			name: file.name,
			type: file.type || 'video/mp4',
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
						type: file.type || 'video/mp4',
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
