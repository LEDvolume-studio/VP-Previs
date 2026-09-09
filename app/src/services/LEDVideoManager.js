import * as THREE from 'three';
import { EngineEvents } from 'rayzee';
import { getApp } from '@/lib/appProxy';

export const LED_NITS_PER_EMISSION_UNIT = 100;
export const LED_ROOT_METADATA_KEY = 'rayzeeLED';
export const LED_DISPLAY_METADATA_KEY = 'rayzeeLEDDisplay';
const LED_REAR_SURFACE_ROLE = 'black-rear-surface';

const VIDEO_EVENTS = [
	'loadedmetadata', 'loadeddata', 'canplay', 'play', 'pause', 'timeupdate',
	'seeking', 'seeked', 'ended', 'error',
];

// Updating accumulation for every decoded frame is prohibitively expensive at 30/60 fps.
// This is intentionally a preview cadence while the live path-tracing mode is experimental.
const LIVE_PATH_TRACER_FPS = 12;
const LIVE_PATH_TRACER_FRAME_INTERVAL = 1000 / LIVE_PATH_TRACER_FPS;
const VIDEO_FRAME_WATCHDOG_INTERVAL = 1000 / 30;
const VIDEO_FRAME_CALLBACK_STALL_THRESHOLD = 150;
// Matches the editor's default material-texture ceiling while avoiding a 4K/6K
// 2D canvas upload on every decoded video frame.
const MAX_LED_COMPOSITE_DIMENSION = 2048;

const clamp = ( value, min, max ) => Math.min( max, Math.max( min, Number( value ) || 0 ) );

function containsAscii( bytes, text ) {

	const needle = [ ...text ].map( char => char.charCodeAt( 0 ) );
	outer: for ( let i = 0; i <= bytes.length - needle.length; i ++ ) {

		for ( let j = 0; j < needle.length; j ++ ) {

			if ( bytes[ i + j ] !== needle[ j ] ) continue outer;

		}

		return true;

	}

	return false;

}

async function readMP4ProbeBytes( file ) {

	const probeSize = 4 * 1024 * 1024;
	if ( file.size <= probeSize * 2 ) return new Uint8Array( await file.arrayBuffer() );

	const [ head, tail ] = await Promise.all( [
		file.slice( 0, probeSize ).arrayBuffer(),
		file.slice( file.size - probeSize ).arrayBuffer(),
	] );
	const bytes = new Uint8Array( probeSize * 2 );
	bytes.set( new Uint8Array( head ) );
	bytes.set( new Uint8Array( tail ), probeSize );
	return bytes;

}

/** Validate the MP4 container, its H.264 sample entry, and baseline browser support. */
export async function validateLEDVideoFile( file ) {

	if ( ! file ) throw new Error( 'Choose an MP4 file.' );
	if ( ! /\.mp4$/i.test( file.name || '' ) ) throw new Error( 'LED video must use the .mp4 container.' );
	if ( file.type && file.type !== 'video/mp4' && file.type !== 'application/mp4' ) {

		throw new Error( `Expected an MP4 MIME type, received ${file.type}.` );

	}

	if ( file.size < 16 ) throw new Error( 'The selected MP4 is empty or malformed.' );

	const bytes = await readMP4ProbeBytes( file );
	if ( ! containsAscii( bytes.subarray( 0, Math.min( bytes.length, 64 ) ), 'ftyp' ) ) {

		throw new Error( 'The selected file does not contain a valid MP4 ftyp box.' );

	}

	if ( ! containsAscii( bytes, 'avc1' ) && ! containsAscii( bytes, 'avc3' ) ) {

		throw new Error( 'This MP4 does not advertise H.264 video (avc1/avc3).' );

	}

	const probe = document.createElement( 'video' );
	if ( probe.canPlayType( 'video/mp4; codecs="avc1.42E01E"' ) === '' ) {

		throw new Error( 'This browser does not report H.264/MP4 decoding support.' );

	}

	return true;

}

export function resolveLEDAssetRoot( object ) {

	let current = object || null;
	while ( current ) {

		if ( current.userData?.[ LED_ROOT_METADATA_KEY ]?.isLEDVolume ) return current;
		current = current.parent;

	}

	return null;

}

export function findLEDDisplayMesh( root ) {

	const wanted = root?.userData?.[ LED_ROOT_METADATA_KEY ]?.displayMeshIdentifier;
	let found = null;
	root?.traverse?.( child => {

		if ( found || ! child.isMesh ) return;
		if ( child.userData?.[ LED_DISPLAY_METADATA_KEY ]?.identifier === wanted || child.name === wanted ) found = child;

	} );
	return found;

}

/** Bake an LED model's authored UV island into normalized display coordinates. */
export function normalizeLEDDisplayUVs( mesh, definition ) {

	const attributeName = definition.uvChannel === 0 ? 'uv' : `uv${definition.uvChannel}`;
	const sourceUVs = mesh.geometry?.getAttribute?.( attributeName );
	if ( ! sourceUVs ) return false;

	// Keep the catalog asset immutable in case its BufferGeometry is shared by a loader cache.
	mesh.geometry = mesh.geometry.clone();
	const uvs = mesh.geometry.getAttribute( attributeName );
	const bounds = definition.uvBounds;
	const du = Math.max( 1e-8, bounds.maxU - bounds.minU );
	const dv = Math.max( 1e-8, bounds.maxV - bounds.minV );
	for ( let index = 0; index < uvs.count; index ++ ) {

		const sourceU = uvs.getX( index );
		const normalizedU = definition.flipU
			? ( bounds.maxU - sourceU ) / du
			: ( sourceU - bounds.minU ) / du;
		uvs.setXY( index, normalizedU, ( uvs.getY( index ) - bounds.minV ) / dv );

	}

	uvs.needsUpdate = true;
	return true;

}

/**
 * Apply versioned, JSON-safe LED authoring data before the engine processes the asset.
 * Transient DOM/media/texture resources never enter userData.
 */
export function prepareLEDAssetRoot( root, catalogItem ) {

	const definition = catalogItem?.led;
	if ( ! root || ! definition ) throw new Error( 'Invalid LED asset definition.' );

	let sourceNode = root.getObjectByName( definition.sourceNodeName );
	if ( ! sourceNode ) {

		root.traverse( child => {

			if ( ! sourceNode && child.isMesh ) sourceNode = child;

		} );

	}

	if ( ! sourceNode?.isMesh ) throw new Error( `LED display mesh "${definition.sourceNodeName}" was not found.` );
	const normalizedDisplayUVs = normalizeLEDDisplayUVs( sourceNode, definition );

	// The supplied GLBs were exported from a larger Unreal stage. Keep their geometry,
	// scale, and orientation, but put the authored base-centre pivot at the insertion origin.
	sourceNode.position.fromArray( definition.normalization?.translation || [ 0, 0, 0 ] );
	sourceNode.updateMatrix();

	const oldMaterials = Array.isArray( sourceNode.material ) ? sourceNode.material : [ sourceNode.material ];
	const displayMaterial = new THREE.MeshStandardMaterial( {
		name: 'LED Display Surface',
		color: 0x000000,
		emissive: 0x000000,
		emissiveIntensity: 0,
		metalness: 0,
		roughness: 0.72,
		side: THREE.FrontSide,
	} );
	displayMaterial.toneMapped = true;
	sourceNode.material = displayMaterial;
	oldMaterials.forEach( material => material?.dispose?.() );

	// Keep video and emission on the authored front face only. A coincident
	// back-facing surface makes the other side opaque black in both raster and
	// path tracing; side culling ensures the two surfaces never fight for a pixel.
	const previousRearSurface = sourceNode.children.find( child => child.userData?.[ LED_DISPLAY_METADATA_KEY ]?.role === LED_REAR_SURFACE_ROLE );
	if ( previousRearSurface ) {

		sourceNode.remove( previousRearSurface );
		previousRearSurface.material?.dispose?.();

	}

	const rearMaterial = new THREE.MeshBasicMaterial( {
		name: 'LED Black Rear Surface',
		color: 0x000000,
		side: THREE.BackSide,
	} );
	rearMaterial.toneMapped = false;
	const rearSurface = new THREE.Mesh( sourceNode.geometry, rearMaterial );
	rearSurface.name = `${definition.displayMeshName}_Back`;
	rearSurface.userData[ LED_DISPLAY_METADATA_KEY ] = {
		version: definition.version,
		identifier: rearSurface.name,
		role: LED_REAR_SURFACE_ROLE,
	};
	sourceNode.add( rearSurface );

	sourceNode.name = definition.displayMeshName;
	sourceNode.userData[ LED_DISPLAY_METADATA_KEY ] = {
		version: definition.version,
		identifier: definition.displayMeshName,
		role: 'visible-display-surface',
		uvChannel: definition.uvChannel,
	};
	// SceneProcessor stores one UV set per triangle. This mesh-level hint lets it
	// serialize the same channel selected by the raster VideoTexture.
	sourceNode.userData.rayzeeUVChannel = definition.uvChannel;

	root.userData[ LED_ROOT_METADATA_KEY ] = {
		version: definition.version,
		isLEDVolume: true,
		assetId: catalogItem.id,
		assetType: definition.assetType,
		displayMeshIdentifier: definition.displayMeshName,
		physicalDimensions: { ...definition.physicalDimensions },
		nativeCanvas: { ...definition.nativeCanvas },
		maxBrightnessNits: definition.maxBrightnessNits,
		currentBrightnessNits: definition.defaultBrightnessNits,
		uvChannel: definition.uvChannel,
		uvBounds: normalizedDisplayUVs
			? { minU: 0, maxU: 1, minV: 0, maxV: 1 }
			: { ...definition.uvBounds },
		flipU: normalizedDisplayUVs ? false : !! definition.flipU,
		videoPlacementTransform: {
			position: { x: 0.5, y: 0.5 },
			scale: { x: 1, y: 1 },
			rotationDegrees: 0,
			aspectRatioLocked: true,
			fitMode: 'stretch',
		},
		loop: true,
		videoSource: null,
	};

	root.updateMatrixWorld( true );
	return root;

}

export function nitsToEmission( nits ) {

	return Math.max( 0, Number( nits ) || 0 ) / LED_NITS_PER_EMISSION_UNIT;

}

/** Compute normalized rectangle dimensions for contain/cover/stretch. */
export function fitLEDPlacement( fitMode, videoWidth, videoHeight, canvasWidth, canvasHeight ) {

	if ( fitMode === 'stretch' || ! videoWidth || ! videoHeight ) return { x: 1, y: 1 };
	const relativeAspect = ( videoWidth / videoHeight ) / ( canvasWidth / canvasHeight );
	if ( fitMode === 'contain' ) {

		return relativeAspect >= 1 ? { x: 1, y: 1 / relativeAspect } : { x: relativeAspect, y: 1 };

	}

	return relativeAspect >= 1 ? { x: relativeAspect, y: 1 } : { x: 1, y: 1 / relativeAspect };

}

/** Draw one video frame into its authored rectangle, leaving uncovered LED pixels black. */
export function drawLEDVideoFrame( context, video, width, height, placement ) {

	context.fillStyle = '#000000';
	context.fillRect( 0, 0, width, height );
	context.save();
	context.translate( placement.position.x * width, placement.position.y * height );
	context.rotate( THREE.MathUtils.degToRad( placement.rotationDegrees || 0 ) );
	context.drawImage(
		video,
		- placement.scale.x * width / 2,
		- placement.scale.y * height / 2,
		placement.scale.x * width,
		placement.scale.y * height,
	);
	context.restore();

}

/**
 * Matrix from authored display UVs to source-video UVs. UV channel 1 in both supplied
 * GLBs is top-left-origin; media textures therefore use flipY=false. Transform order is:
 * authored UV normalization/optional U mirror, inverse placement rotation about its
 * centre, then inverse normalized rectangle scale.
 */
export function createLEDTextureMatrix( metadata ) {

	const bounds = metadata.uvBounds;
	const placement = metadata.videoPlacementTransform;
	const du = Math.max( 1e-8, bounds.maxU - bounds.minU );
	const dv = Math.max( 1e-8, bounds.maxV - bounds.minV );
	const bx = metadata.flipU ? - 1 / du : 1 / du;
	const tx = metadata.flipU ? bounds.maxU / du : - bounds.minU / du;
	const by = 1 / dv;
	const ty = - bounds.minV / dv;

	const sx = Math.max( 1e-4, placement.scale.x );
	const sy = Math.max( 1e-4, placement.scale.y );
	const angle = THREE.MathUtils.degToRad( placement.rotationDegrees || 0 );
	const cosine = Math.cos( angle );
	const sine = Math.sin( angle );
	const cx = placement.position.x;
	const cy = placement.position.y;

	// Placement inverse in top-left/editor coordinates.
	const p00 = cosine / sx;
	const p01 = sine / sx;
	const p10 = - sine / sy;
	const p11 = cosine / sy;
	const p02 = 0.5 - p00 * cx - p01 * cy;
	const p12 = 0.5 - p10 * cx - p11 * cy;

	return new THREE.Matrix3().set(
		p00 * bx, p01 * by, p00 * tx + p01 * ty + p02,
		p10 * bx, p11 * by, p10 * tx + p11 * ty + p12,
		0, 0, 1,
	);

}

function mediaErrorMessage( video ) {

	const messages = {
		1: 'Video loading was aborted.',
		2: 'The MP4 could not be read.',
		3: 'The MP4 could not be decoded. Verify that it contains browser-compatible H.264 video.',
		4: 'This MP4/H.264 profile is not supported by the browser.',
	};
	return messages[ video?.error?.code ] || 'The video failed to load or decode.';

}

export class LEDVideoManagerImpl {

	constructor() {

		this.records = new Map();
		this.listeners = new Set();
		this.app = null;
		this.appListeners = [];
		this.preferredPathTracing = null;
		this.experimentalLivePathTracing = false;
		this.modeOperation = 0;
		this.materialSyncPromise = Promise.resolve();
		this.pendingStaticSync = false;

	}

	attachApp( app = getApp() ) {

		if ( ! app || this.app === app ) return;
		this.detachApp();
		this.app = app;
		this.preferredPathTracing = !! app.pathTracerEnabled;

		const on = ( target, type, handler ) => {

			target?.addEventListener?.( type, handler );
			this.appListeners.push( [ target, type, handler ] );

		};

		on( app, 'SceneRebuild', () => this.syncScene() );
		on( app, 'SceneWillReplace', () => this.disposeAll() );
		on( app, 'SceneUnloaded', () => this.disposeAll() );
		on( app, 'SceneObjectRemoved', event => this.disposeRecord( event.id, { rebuild: false } ) );
		on( app, EngineEvents.DEVICE_LOST, () => this.handleDeviceLoss() );
		on( app, EngineEvents.DISPOSE, () => this.detachApp( { disposeRecords: true } ) );
		this.syncScene();

	}

	detachApp( { disposeRecords = false } = {} ) {

		this.appListeners.forEach( ( [ target, type, handler ] ) => target?.removeEventListener?.( type, handler ) );
		this.appListeners = [];
		if ( disposeRecords ) this.disposeAll();
		this.app = null;

	}

	subscribe( listener ) {

		this.listeners.add( listener );
		return () => this.listeners.delete( listener );

	}

	emit( record ) {

		this.listeners.forEach( listener => listener( record?.root?.uuid ) );

	}

	getRecord( rootOrId ) {

		const id = typeof rootOrId === 'string' ? rootOrId : rootOrId?.uuid;
		return id ? this.records.get( id ) || null : null;

	}

	getSnapshot( rootOrId ) {

		const record = this.getRecord( rootOrId );
		if ( ! record ) return null;
		const metadata = record.root.userData[ LED_ROOT_METADATA_KEY ];
		return {
			rootId: record.root.uuid,
			name: record.root.userData.__rayzeeName || record.root.name || metadata.assetType,
			status: record.status,
			error: record.error,
			filename: record.file?.name || metadata.videoSource?.name || '',
			videoWidth: record.video?.videoWidth || 0,
			videoHeight: record.video?.videoHeight || 0,
			duration: Number.isFinite( record.video?.duration ) ? record.video.duration : 0,
			currentTime: Number.isFinite( record.video?.currentTime ) ? record.video.currentTime : 0,
			seeking: !! record.video?.seeking,
			isPlaying: record.status === 'playing',
			videoSource: metadata.videoSource || null,
			metadata,
		};

	}

	syncScene() {

		const scene = this.app?.getScene?.();
		if ( ! scene ) return;
		const present = new Set();
		scene.traverse( object => {

			if ( ! object.userData?.[ LED_ROOT_METADATA_KEY ]?.isLEDVolume ) return;
			present.add( object.uuid );
			this.register( object );

		} );
		for ( const id of [ ...this.records.keys() ] ) {

			if ( ! present.has( id ) ) this.disposeRecord( id, { rebuild: false } );

		}

	}

	register( root ) {

		if ( this.records.has( root.uuid ) ) return this.records.get( root.uuid );
		const displayMesh = findLEDDisplayMesh( root );
		if ( ! displayMesh ) return null;
		const record = {
			root,
			displayMesh,
			file: null,
			objectUrl: null,
			video: null,
			videoCanvas: null,
			videoTexture: null,
			pausedCanvas: null,
			pausedTexture: null,
			reconnectCanvas: null,
			reconnectTexture: null,
			eventHandlers: [],
			videoFrameCallbackHandle: null,
			videoFrameWatchdogHandle: null,
			lastVideoFrameCallbackAt: - Infinity,
			livePathTracerCanvas: null,
			lastLivePathTracerUpload: - Infinity,
			livePathTracerErrorLogged: false,
			generation: 0,
			captureOperation: 0,
			placementTimer: null,
			status: 'empty',
			error: '',
		};
		this.records.set( root.uuid, record );
		this.emit( record );
		return record;

	}

	async chooseVideo( rootOrId, file, { sourceRef = null, initialTime = 0 } = {} ) {

		const record = this.getRecord( rootOrId );
		if ( ! record ) throw new Error( 'The selected object is not an LED wall.' );
		await validateLEDVideoFile( file );
		this.releaseMedia( record, { clearDisplay: true } );
		const generation = ++ record.generation;
		record.file = file;
		record.root.userData[ LED_ROOT_METADATA_KEY ].videoSource = sourceRef || {
			assetId: globalThis.crypto?.randomUUID?.() || `video-${Date.now()}`,
			name: file.name,
			type: file.type || 'video/mp4',
			size: file.size,
			lastModified: file.lastModified || 0,
		};
		record.objectUrl = URL.createObjectURL( file );
		record.error = '';
		record.status = 'loading';

		const video = document.createElement( 'video' );
		video.muted = true;
		video.defaultMuted = true;
		video.playsInline = true;
		video.controls = false;
		video.preload = 'auto';
		video.loop = !! record.root.userData[ LED_ROOT_METADATA_KEY ].loop;
		record.video = video;

		this.bindVideoEvents( record, generation );

		const canPlay = new Promise( ( resolve, reject ) => {

			const ready = () => {

				cleanup();
				resolve();

			};

			const failed = () => {

				cleanup();
				reject( new Error( mediaErrorMessage( video ) ) );

			};

			const cleanup = () => {

				video.removeEventListener( 'canplay', ready );
				video.removeEventListener( 'error', failed );

			};

			video.addEventListener( 'canplay', ready );
			video.addEventListener( 'error', failed );

		} );

		video.src = record.objectUrl;
		video.load();
		this.emit( record );
		try {

			await canPlay;
			if ( generation !== record.generation ) return;
			if ( Number.isFinite( initialTime ) && initialTime > 0 && Number.isFinite( video.duration ) ) {

				const target = clamp( initialTime, 0, video.duration );
				if ( Math.abs( video.currentTime - target ) > 0.01 ) {

					await new Promise( resolve => {

						const timeout = setTimeout( resolve, 3000 );
						video.addEventListener( 'seeked', () => {

							clearTimeout( timeout ); resolve();

						}, { once: true } );
						video.currentTime = target;

					} );

				}

			}

			await this.capturePausedFrame( record, generation );

		} catch ( error ) {

			if ( generation !== record.generation ) return;
			record.status = 'error';
			record.error = error.message;
			this.emit( record );
			throw error;

		}

	}

	setMissingVideo( rootOrId, sourceRef, message = 'Reconnect this video to restore it.' ) {

		const record = this.getRecord( rootOrId );
		if ( ! record ) return;
		record.root.userData[ LED_ROOT_METADATA_KEY ].videoSource = sourceRef;
		record.status = 'missing';
		record.error = message;
		this.applyReconnectPlaceholder( record );
		this.emit( record );
		this.scheduleStaticMaterialSync();

	}

	bindVideoEvents( record, generation ) {

		const video = record.video;
		const handler = event => {

			if ( generation !== record.generation ) return;
			switch ( event.type ) {

				case 'loadedmetadata':
				case 'loadeddata':
				case 'canplay':
					record.status = video.paused ? 'ready' : 'playing';
					break;
				case 'play':
					this.onPlay( record );
					break;
				case 'pause':
					if ( ! video.ended ) this.onStopped( record, 'paused' );
					break;
				case 'ended':
					this.onStopped( record, 'ended' );
					break;
				case 'seeked':
					if ( video.paused ) this.capturePausedFrame( record, generation );
					break;
				case 'error':
					record.status = 'error';
					record.error = mediaErrorMessage( video );
					this.cancelVideoFrameNotifications( record );
					this.applyDisplayTexture( record, record.pausedTexture );
					this.reconcileRendererMode();
					this.scheduleStaticMaterialSync();
					break;
				default:
					break;

			}

			this.emit( record );

		};

		VIDEO_EVENTS.forEach( type => {

			video.addEventListener( type, handler );
			record.eventHandlers.push( [ type, handler ] );

		} );

	}

	configureTexture( record, texture, { composited = false } = {} ) {

		const metadata = record.root.userData[ LED_ROOT_METADATA_KEY ];
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.flipY = false;
		texture.channel = metadata.uvChannel;
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.generateMipmaps = false;
		texture.wrapS = THREE.ClampToEdgeWrapping;
		texture.wrapT = THREE.ClampToEdgeWrapping;
		texture.matrixAutoUpdate = false;
		texture.matrix.copy( createLEDTextureMatrix( composited ? {
			...metadata,
			videoPlacementTransform: {
				position: { x: 0.5, y: 0.5 },
				scale: { x: 1, y: 1 },
				rotationDegrees: 0,
			},
		} : metadata ) );
		texture.needsUpdate = true;

	}

	getCompositeDimensions( record ) {

		const metadata = record.root.userData[ LED_ROOT_METADATA_KEY ];
		const aspect = metadata.nativeCanvas.width / metadata.nativeCanvas.height;
		const sourceMax = Math.max( record.video?.videoWidth || 0, record.video?.videoHeight || 0, 1024 );
		const longest = Math.min( MAX_LED_COMPOSITE_DIMENSION, sourceMax );
		return aspect >= 1
			? { width: Math.round( longest ), height: Math.max( 1, Math.round( longest / aspect ) ) }
			: { width: Math.max( 1, Math.round( longest * aspect ) ), height: Math.round( longest ) };

	}

	composeVideoFrame( record, canvas ) {

		if ( ! record.video?.videoWidth || ! record.video?.videoHeight ) return false;
		const { width, height } = this.getCompositeDimensions( record );
		if ( canvas.width !== width ) canvas.width = width;
		if ( canvas.height !== height ) canvas.height = height;
		const context = canvas.getContext( '2d', { alpha: false } );
		if ( ! context ) return false;
		drawLEDVideoFrame(
			context,
			record.video,
			width,
			height,
			record.root.userData[ LED_ROOT_METADATA_KEY ].videoPlacementTransform,
		);
		return true;

	}

	updateRasterVideoFrame( record ) {

		let canvas = record.videoCanvas;
		if ( ! canvas ) canvas = document.createElement( 'canvas' );
		if ( ! this.composeVideoFrame( record, canvas ) ) return false;
		record.videoCanvas = canvas;
		if ( ! record.videoTexture ) {

			record.videoTexture = new THREE.CanvasTexture( canvas );
			this.configureTexture( record, record.videoTexture, { composited: true } );

		} else record.videoTexture.needsUpdate = true;
		return true;

	}

	invalidateRenderedFrame() {

		const app = this.app || getApp();
		if ( ! app ) return;
		// WebGPU's realtime material pipeline can retain the previously sampled canvas
		// even after CanvasTexture.needsUpdate. reset() invalidates that rendered result;
		// this is the same path that already made brightness edits reveal the latest frame.
		if ( ! app.pathTracerEnabled && typeof app.reset === 'function' ) app.reset();
		else app.wake?.();

	}

	applyReconnectPlaceholder( record ) {

		const metadata = record.root.userData[ LED_ROOT_METADATA_KEY ];
		const aspect = metadata.nativeCanvas.width / metadata.nativeCanvas.height;
		const width = 1024;
		const height = Math.max( 256, Math.round( width / aspect ) );
		const canvas = document.createElement( 'canvas' );
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext( '2d', { alpha: false } );
		context.fillStyle = '#24272b';
		context.fillRect( 0, 0, width, height );
		context.fillStyle = '#d9dde2';
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.font = `600 ${Math.max( 34, Math.round( height * 0.13 ) )}px sans-serif`;
		context.fillText( 'Please reconnect file', width / 2, height / 2, width * 0.86 );

		const texture = new THREE.CanvasTexture( canvas );
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.flipY = false;
		texture.channel = metadata.uvChannel;
		texture.minFilter = THREE.LinearFilter;
		texture.magFilter = THREE.LinearFilter;
		texture.generateMipmaps = true;
		texture.wrapS = THREE.ClampToEdgeWrapping;
		texture.wrapT = THREE.ClampToEdgeWrapping;
		texture.matrixAutoUpdate = false;
		texture.matrix.copy( createLEDTextureMatrix( {
			...metadata,
			videoPlacementTransform: {
				position: { x: 0.5, y: 0.5 },
				scale: { x: 1, y: 1 },
				rotationDegrees: 0,
			},
		} ) );
		texture.needsUpdate = true;
		record.reconnectTexture?.dispose();
		record.reconnectCanvas = canvas;
		record.reconnectTexture = texture;

		const material = record.displayMesh.material;
		material.map = null;
		material.emissiveMap = texture;
		material.emissive.set( 0xffffff );
		material.emissiveIntensity = 0.45;
		material.needsUpdate = true;
		this.app?.wake?.();

	}

	applyDisplayTexture( record, texture ) {

		const material = record.displayMesh.material;
		material.map = null;
		material.emissiveMap = texture || null;
		material.emissive.set( texture ? 0xffffff : 0x000000 );
		material.emissiveIntensity = texture
			? nitsToEmission( record.root.userData[ LED_ROOT_METADATA_KEY ].currentBrightnessNits )
			: 0;
		material.needsUpdate = true;

	}

	onPlay( record ) {

		record.status = 'playing';
		record.error = '';
		this.updateRasterVideoFrame( record );
		this.applyDisplayTexture( record, record.videoTexture );
		this.startVideoFrameNotifications( record );
		this.reconcileRendererMode();
		this.invalidateRenderedFrame();

	}

	async onStopped( record, status ) {

		record.status = status;
		this.cancelVideoFrameNotifications( record );
		this.reconcileRendererMode();
		await this.capturePausedFrame( record, record.generation );

	}

	startVideoFrameNotifications( record ) {

		this.cancelVideoFrameNotifications( record );
		const tick = now => {

			if ( record.status !== 'playing' || ! record.video ) return;
			record.lastVideoFrameCallbackAt = now;
			this.updateRasterVideoFrame( record );
			this.updateLivePathTracerFrame( record, now );
			this.invalidateRenderedFrame();
			record.videoFrameCallbackHandle = record.video.requestVideoFrameCallback( tick );

		};

		if ( typeof record.video?.requestVideoFrameCallback === 'function' ) {

			record.lastVideoFrameCallbackAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
			record.videoFrameCallbackHandle = record.video.requestVideoFrameCallback( tick );

		}

		// Chromium can occasionally stop delivering decoded-frame callbacks to one
		// of several detached video elements. Keep an independent per-wall watchdog
		// so one stalled callback cannot freeze that wall while the others continue.
		record.videoFrameWatchdogHandle = setInterval( () => {

			if ( record.status !== 'playing' || ! record.video ) return;
			const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
			const callbackUnavailable = typeof record.video.requestVideoFrameCallback !== 'function';
			if ( ! callbackUnavailable && now - record.lastVideoFrameCallbackAt < VIDEO_FRAME_CALLBACK_STALL_THRESHOLD ) return;
			this.updateRasterVideoFrame( record );
			this.updateLivePathTracerFrame( record, now );
			this.invalidateRenderedFrame();

		}, VIDEO_FRAME_WATCHDOG_INTERVAL );

	}

	updateLivePathTracerFrame( record, now = performance.now() ) {

		if ( ! this.experimentalLivePathTracing || ! this.preferredPathTracing ) return false;
		if ( record.status !== 'playing' || ! record.video || ! record.pausedTexture ) return false;
		if ( now - record.lastLivePathTracerUpload < LIVE_PATH_TRACER_FRAME_INTERVAL ) return false;

		const app = this.app || getApp();
		const info = app?.getMaterialTextureLayerInfo?.( record.pausedTexture, true );
		if ( ! info ) return false;

		try {

			let canvas = record.livePathTracerCanvas;
			if ( ! canvas ) canvas = document.createElement( 'canvas' );
			if ( canvas.width !== info.width || canvas.height !== info.height ) {

				canvas.width = info.width;
				canvas.height = info.height;

			}

			const context = canvas.getContext( '2d', { alpha: false, willReadFrequently: true } );
			if ( ! context ) return false;
			context.drawImage( record.videoTexture?.image || record.video, 0, 0, info.width, info.height );
			const pixels = context.getImageData( 0, 0, info.width, info.height ).data;
			if ( ! app.updateMaterialTextureLayer?.( record.pausedTexture, pixels, true ) ) return false;

			record.livePathTracerCanvas = canvas;
			record.lastLivePathTracerUpload = now;
			record.livePathTracerErrorLogged = false;
			app.wake?.();
			return true;

		} catch ( error ) {

			if ( ! record.livePathTracerErrorLogged ) {

				console.warn( '[LEDVideoManager] Live path-tracer frame upload failed:', error );
				record.livePathTracerErrorLogged = true;

			}

			return false;

		}

	}

	cancelVideoFrameNotifications( record ) {

		if ( record.videoFrameCallbackHandle !== null && typeof record.video?.cancelVideoFrameCallback === 'function' ) {

			record.video.cancelVideoFrameCallback( record.videoFrameCallbackHandle );

		}

		record.videoFrameCallbackHandle = null;
		if ( record.videoFrameWatchdogHandle !== null ) clearInterval( record.videoFrameWatchdogHandle );
		record.videoFrameWatchdogHandle = null;
		record.lastVideoFrameCallbackAt = - Infinity;

	}

	async capturePausedFrame( record, generation = record.generation ) {

		const video = record.video;
		if ( ! video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || ! video.videoWidth || generation !== record.generation ) return;
		const operation = ++ record.captureOperation;
		let canvas = record.pausedCanvas;
		if ( ! canvas ) canvas = document.createElement( 'canvas' );
		if ( ! this.composeVideoFrame( record, canvas ) ) return;
		if ( generation !== record.generation || operation !== record.captureOperation ) return;

		record.pausedCanvas = canvas;
		if ( ! record.pausedTexture ) {

			record.pausedTexture = new THREE.CanvasTexture( canvas );
			this.configureTexture( record, record.pausedTexture, { composited: true } );

		} else {

			record.pausedTexture.needsUpdate = true;

		}

		this.applyDisplayTexture( record, record.pausedTexture );
		if ( record.status !== 'ended' ) record.status = 'paused';
		this.emit( record );
		await this.scheduleStaticMaterialSync( generation );

	}

	activeVideoCount() {

		let count = 0;
		this.records.forEach( record => {

			if ( record.status === 'playing' && ! record.video?.paused && ! record.video?.ended ) count ++;

		} );
		return count;

	}

	reconcileRendererMode() {

		const app = this.app || getApp();
		if ( ! app ) return;
		const operation = ++ this.modeOperation;
		if ( this.activeVideoCount() > 0 ) {

			app.pathTracerEnabled = this.experimentalLivePathTracing && !! this.preferredPathTracing;
			app.wake?.();
			return;

		}

		if ( this.pendingStaticSync ) {

			this.scheduleStaticMaterialSync();
			return;

		}

		queueMicrotask( () => {

			if ( operation !== this.modeOperation || this.activeVideoCount() > 0 ) return;
			app.pathTracerEnabled = !! this.preferredPathTracing;
			app.reset?.();

		} );

	}

	async scheduleStaticMaterialSync( generation = null ) {

		if ( this.activeVideoCount() > 0 ) {

			this.pendingStaticSync = true;
			return;

		}

		this.pendingStaticSync = false;
		const operation = ++ this.modeOperation;
		const app = this.app || getApp();
		if ( ! app ) return;
		app.pathTracerEnabled = false;
		app.wake?.();

		this.materialSyncPromise = this.materialSyncPromise
			.catch( () => {} )
			.then( async () => {

				if ( generation !== null && ! [ ...this.records.values() ].some( r => r.generation === generation ) ) return;
				if ( this.activeVideoCount() > 0 ) {

					this.pendingStaticSync = true;
					return;

				}

				await app.rebuildMaterials();
				for ( const record of this.records.values() ) this.syncBrightnessToPathTracer( record );
				if ( operation === this.modeOperation && this.activeVideoCount() === 0 ) {

					app.pathTracerEnabled = !! this.preferredPathTracing;
					app.reset?.();

				}

			} )
			.catch( error => {

				console.error( '[LEDVideoManager] Failed to upload paused LED frame:', error );

			} );
		return this.materialSyncPromise;

	}

	syncBrightnessToPathTracer( record ) {

		const index = record.displayMesh.userData?.materialIndex;
		if ( index === undefined ) return;
		const hasTexture = !! record.displayMesh.material.emissiveMap;
		this.app?.setMaterialProperty?.( index, 'emissive', new THREE.Color( hasTexture ? 0xffffff : 0x000000 ) );
		const intensity = record.status === 'missing'
			? 0.45
			: hasTexture ? nitsToEmission( record.root.userData[ LED_ROOT_METADATA_KEY ].currentBrightnessNits ) : 0;
		this.app?.setMaterialProperty?.( index, 'emissiveIntensity', intensity );

	}

	setUserPathTracerPreference( enabled ) {

		this.preferredPathTracing = !! enabled;
		const app = this.app || getApp();
		if ( ! app ) return;
		if ( this.activeVideoCount() > 0 ) {

			app.pathTracerEnabled = this.experimentalLivePathTracing && !! enabled;
			app.wake?.();

		} else if ( this.pendingStaticSync ) {

			app.pathTracerEnabled = false;
			app.wake?.();

		} else {

			app.pathTracerEnabled = !! enabled;

		}

	}

	setExperimentalLivePathTracing( enabled ) {

		this.experimentalLivePathTracing = !! enabled;
		for ( const record of this.records.values() ) record.lastLivePathTracerUpload = - Infinity;
		this.reconcileRendererMode();
		if ( this.experimentalLivePathTracing && this.preferredPathTracing ) {

			const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
			for ( const record of this.records.values() ) this.updateLivePathTracerFrame( record, now );

		}

		return this.experimentalLivePathTracing;

	}

	async play( rootOrId ) {

		const record = this.getRecord( rootOrId );
		if ( ! record?.video ) throw new Error( 'Choose a video first.' );
		const generation = record.generation;
		await this.materialSyncPromise.catch( () => {} );
		if ( generation !== record.generation ) return;
		try {

			await record.video.play();

		} catch ( error ) {

			record.status = 'paused';
			record.error = error?.name === 'NotAllowedError'
				? 'Playback was blocked by the browser. Click Play again after interacting with the page.'
				: `Playback failed: ${error.message}`;
			this.emit( record );
			this.reconcileRendererMode();
			throw new Error( record.error );

		}

	}

	pause( rootOrId ) {

		this.getRecord( rootOrId )?.video?.pause();

	}

	restart( rootOrId ) {

		const video = this.getRecord( rootOrId )?.video;
		if ( video ) video.currentTime = 0;

	}

	seek( rootOrId, time ) {

		const video = this.getRecord( rootOrId )?.video;
		if ( ! video || ! Number.isFinite( video.duration ) ) return;
		video.currentTime = clamp( time, 0, video.duration );

	}

	setLoop( rootOrId, loop ) {

		const record = this.getRecord( rootOrId );
		if ( ! record ) return;
		record.root.userData[ LED_ROOT_METADATA_KEY ].loop = !! loop;
		if ( record.video ) record.video.loop = !! loop;
		this.emit( record );

	}

	setBrightness( rootOrId, nits ) {

		const record = this.getRecord( rootOrId );
		if ( ! record ) return;
		const metadata = record.root.userData[ LED_ROOT_METADATA_KEY ];
		metadata.currentBrightnessNits = clamp( nits, 0, metadata.maxBrightnessNits );
		if ( record.displayMesh.material.emissiveMap && record.status !== 'missing' ) {

			record.displayMesh.material.emissiveIntensity = nitsToEmission( metadata.currentBrightnessNits );
			this.syncBrightnessToPathTracer( record );

		}

		this.emit( record );

	}

	setPlacement( rootOrId, patch, { commit = true } = {} ) {

		const record = this.getRecord( rootOrId );
		if ( ! record ) return;
		const metadata = record.root.userData[ LED_ROOT_METADATA_KEY ];
		const placement = metadata.videoPlacementTransform;
		if ( patch.position ) placement.position = { ...placement.position, ...patch.position };
		if ( patch.scale ) placement.scale = {
			x: Math.max( 1e-4, Number( patch.scale.x ?? placement.scale.x ) ),
			y: Math.max( 1e-4, Number( patch.scale.y ?? placement.scale.y ) ),
		};
		if ( patch.rotationDegrees !== undefined ) placement.rotationDegrees = Number( patch.rotationDegrees ) || 0;
		if ( patch.aspectRatioLocked !== undefined ) placement.aspectRatioLocked = !! patch.aspectRatioLocked;
		if ( patch.fitMode !== undefined ) placement.fitMode = patch.fitMode;
		if ( record.videoCanvas && this.composeVideoFrame( record, record.videoCanvas ) && record.videoTexture ) record.videoTexture.needsUpdate = true;
		if ( record.pausedCanvas && this.composeVideoFrame( record, record.pausedCanvas ) && record.pausedTexture ) record.pausedTexture.needsUpdate = true;
		if ( record.status === 'playing' ) {

			const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
			this.updateLivePathTracerFrame( record, now );

		}

		this.invalidateRenderedFrame();

		clearTimeout( record.placementTimer );
		if ( commit ) record.placementTimer = setTimeout( () => this.commitPlacement( record ), 160 );
		this.emit( record );

	}

	commitPlacement( record ) {

		if ( this.activeVideoCount() > 0 || ! record.pausedTexture ) return;
		this.scheduleStaticMaterialSync( record.generation );

	}

	applyFit( rootOrId, mode ) {

		const record = this.getRecord( rootOrId );
		if ( ! record ) return;
		const metadata = record.root.userData[ LED_ROOT_METADATA_KEY ];
		const dimensions = fitLEDPlacement(
			mode,
			record.video?.videoWidth,
			record.video?.videoHeight,
			metadata.nativeCanvas.width,
			metadata.nativeCanvas.height,
		);
		this.setPlacement( record.root.uuid, {
			position: { x: 0.5, y: 0.5 },
			scale: dimensions,
			rotationDegrees: 0,
			fitMode: mode,
			aspectRatioLocked: mode !== 'stretch',
		} );

	}

	clearVideo( rootOrId ) {

		const record = this.getRecord( rootOrId );
		if ( ! record ) return;
		this.releaseMedia( record, { clearDisplay: true } );
		record.root.userData[ LED_ROOT_METADATA_KEY ].videoSource = null;
		this.emit( record );
		this.reconcileRendererMode();
		this.scheduleStaticMaterialSync();

	}

	releaseMedia( record, { clearDisplay = true } = {} ) {

		record.generation ++;
		record.captureOperation ++;
		clearTimeout( record.placementTimer );
		this.cancelVideoFrameNotifications( record );
		for ( const [ type, handler ] of record.eventHandlers ) record.video?.removeEventListener( type, handler );
		record.eventHandlers = [];
		if ( record.video ) {

			record.video.pause();
			record.video.removeAttribute( 'src' );
			record.video.load();

		}

		record.videoTexture?.dispose();
		record.pausedTexture?.dispose();
		record.reconnectTexture?.dispose();
		if ( record.objectUrl ) URL.revokeObjectURL( record.objectUrl );
		record.file = null;
		record.objectUrl = null;
		record.video = null;
		record.videoCanvas = null;
		record.videoTexture = null;
		record.pausedCanvas = null;
		record.pausedTexture = null;
		record.livePathTracerCanvas = null;
		record.lastLivePathTracerUpload = - Infinity;
		record.livePathTracerErrorLogged = false;
		record.reconnectCanvas = null;
		record.reconnectTexture = null;
		record.status = 'empty';
		record.error = '';
		if ( clearDisplay ) this.applyDisplayTexture( record, null );

	}

	disposeRecord( rootOrId, { rebuild = false } = {} ) {

		const record = this.getRecord( rootOrId );
		if ( ! record ) return;
		this.releaseMedia( record, { clearDisplay: false } );
		this.records.delete( record.root.uuid );
		this.emit( record );
		this.reconcileRendererMode();
		if ( rebuild ) this.scheduleStaticMaterialSync();

	}

	disposeAll() {

		for ( const record of [ ...this.records.values() ] ) this.disposeRecord( record.root.uuid, { rebuild: false } );
		this.records.clear();
		this.reconcileRendererMode();

	}

	handleDeviceLoss() {

		for ( const record of this.records.values() ) {

			this.releaseMedia( record, { clearDisplay: false } );
			record.status = 'error';
			record.error = 'The WebGPU device was lost. Reload the application before choosing video again.';
			this.emit( record );

		}

	}

}

export const LEDVideoManager = new LEDVideoManagerImpl();
