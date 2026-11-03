import { AmbientLight, DirectionalLight, HemisphereLight, PointLight, RectAreaLight, Scene, SpotLight } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { CameraManager } from '../../../rayzee/src/managers/CameraManager.js';
import { LightManager } from '../../../rayzee/src/managers/LightManager.js';
import { RealtimeRenderer } from '../../../rayzee/src/managers/RealtimeRenderer.js';
import { RenderSettings } from '../../../rayzee/src/RenderSettings.js';
import { createSequenceEvaluator } from '../previs/sequence/evaluateSequence.js';
import { assetVersionKey, baseSceneVersionKey, validateStudentProjectDocument } from '../previs/domain/StudentProjectSchema.js';
import { serializeStudentCatalogueContent } from '../previs/domain/StudentCatalogueSchema.js';
import { validateSupportedPresetScene } from '../previs/domain/StudentSceneDefinition.js';
import { createThreeShotPorts } from '../previs/engine/ThreeShotPorts.js';
import { ShotSceneAdapter } from '../previs/engine/ShotSceneAdapter.js';
import { SequenceRasterAdapter } from '../previs/engine/SequenceRasterAdapter.js';
import { createRasterAppearancePort } from '../previs/engine/RasterAppearance.js';
import { createStudentPosePort } from '../previs/engine/StudentPosePort.js';
import { createStudentMaterialPort } from '../previs/engine/StudentMaterialPort.js';
import { loadVerifiedStudentEnvironment } from '../previs/engine/VerifiedStudentEnvironment.js';
import { createStudentEnvironmentPort } from '../previs/engine/StudentEnvironmentPort.js';
import { loadVerifiedStudentScene } from '../previs/engine/VerifiedStudentSceneLoader.js';
import { createShotViewportCompatibility } from '../previs/engine/ShotViewportCompatibility.js';
import { createStudentLEDWallService } from '../previs/media/StudentLEDWallService.js';
import { compareLEDBlur } from '../previs/media/CompareLEDBlur.js';
import { openStudentLEDSource } from '../previs/media/OpenStudentLEDSource.js';
import { prepareMannequin } from '../utils/mannequinPoses.js';
import { drawFramingBars } from '../previs/engine/FrameFraming.js';
import { createShotCameraNavigation } from './ShotCameraNavigation.js';
import { createStudentViewModes } from './StudentViewModes.js';
import { createShotLightPool } from './ShotLightPool.js';

const LIGHTS = { ambient: AmbientLight, directional: DirectionalLight, hemisphere: HemisphereLight, point: PointLight, rectArea: RectAreaLight, spot: SpotLight };
const MAX_MEDIA_BYTES = 128 * 1024 * 1024;
const clone = value => structuredClone( value );

/** One explicitly selected shot. This is not the sequence transport or an admin runtime. */
export async function createPublishedShotViewport( { document: input, shotId, catalogue, signal, inspectionCamera = null, onStatus = () => {}, onNavigationStart = () => {}, onCameraChange = () => {}, onError = () => {} } ) {

	validateStudentProjectDocument( input );
	let project = clone( input );
	let shot = project.shots[ shotId ];
	if ( ! shot ) throw new Error( 'Choose a saved shot to preview.' );
	let loaded, renderer, realtime, cameraManager, inspectionManager, media, sequence, navigation, inspectionNavigation;
	const decoded = new Map();
	const environmentTextures = new Map();
	let closed = false, disposed = false, unusable = false, disposal;
	let localFrame = 0, timelineFrame, warmedRevision = null;
	const warmedShots = new Set();
	let requestedInteractive = true, pendingOperations = 0;
	const lifetime = new AbortController();
	let active = Promise.resolve();
	const canvas = Object.assign( document.createElement( 'canvas' ), { width: 1920, height: 1080 } );
	canvas.className = 'published-shot-canvas';
	canvas.tabIndex = 0;
	canvas.setAttribute( 'aria-label', `Shot preview: ${shot.name}` );
	const gpuCanvas = document.createElement( 'canvas' );
	const context = canvas.getContext( '2d' );
	const dispose = () => disposal ||= ( async () => {

		closed = true;
		navigation?.dispose();
		inspectionNavigation?.dispose();
		lifetime.abort( new DOMException( 'Shot preview has been closed.', 'AbortError' ) );
		await active.catch( () => {} );
		const errors = [];
		for ( const cleanup of [ () => sequence?.restore(), () => media?.dispose(), ...[ ...decoded.values() ].map( source => () => source.dispose() ), () => realtime?.dispose(), ...[ ...environmentTextures.values() ].map( texture => () => texture.dispose() ), () => cameraManager?.dispose(), () => inspectionManager?.dispose(), () => loaded?.dispose(), () => renderer?.dispose(), () => canvas.remove() ] ) {

			try {

				await cleanup();

			} catch ( error ) {

				errors.push( error );

			}

		}

		decoded.clear();
		disposed = true;
		if ( errors.length ) throw new AggregateError( errors, 'Shot preview resources could not all be released.' );

	} )();
	try {

		signal?.throwIfAborted();
		onStatus( 'Resolving the published scene version…' );
		const { sceneDefinition, assets } = await catalogue.getScene( shot.baseScene, { signal } );
		signal?.throwIfAborted();
		const scene = project.baseScenes[ baseSceneVersionKey( shot.baseScene ) ];
		const supported = {
			format: 'rayzee-student-preset', schemaVersion: 2, presetId: shot.sourcePreset?.presetId || 'local-shot', version: shot.sourcePreset?.version || 'local-1', name: shot.name,
			description: '', category: 'Preview', defaultDurationFrames: 125, thumbnail: null, assets: project.assets, baseScene: scene, snapshot: shot.snapshot, sceneDefinition,
		};
		validateSupportedPresetScene( supported );
		for ( const reference of scene.assets ) {

			const key = assetVersionKey( reference );
			if ( serializeStudentCatalogueContent( project.assets[ key ] ) !== serializeStudentCatalogueContent( assets[ key ] ) ) throw new Error( 'Saved model metadata disagrees with the published immutable version.' );

		}

		onStatus( 'Verifying and loading published model bytes…' );
		loaded = await loadVerifiedStudentScene( {
			assets, baseScene: sceneDefinition.baseScene,
			models: sceneDefinition.models.map( model => ( { ...clone( model ), source: `/v1/catalogue/assets/${model.asset.assetId}/${model.asset.version}` } ) ),
		}, { signal, fetchBytes: ( source, options ) => catalogue.getAssetBytes( options.asset, { signal: options.signal } ) } );
		signal?.throwIfAborted();
		for ( const id of sceneDefinition.humanPoseRoots ) if ( ! prepareMannequin( loaded.nodeObjects.get( id ), 'standing' ) ) throw new Error( 'The published human rig does not support the required poses.' );
		const walls = shot.snapshot.ledWalls;
		const requiredMedia = new Map();
		const prepareSource = async ( asset, preparationSignal ) => {

			const key = assetVersionKey( asset );
			if ( decoded.has( key ) ) {

				if ( serializeStudentCatalogueContent( requiredMedia.get( key ) ) !== serializeStudentCatalogueContent( asset ) ) throw new Error( 'Prepared LED metadata changed.' );
				return decoded.get( key );

			}

			const residentBytes = [ ...decoded.values() ].reduce( ( size, source ) => size + source.residentBytes, 0 );
			const source = await openStudentLEDSource( asset, catalogue, { signal: preparationSignal, maximumResidentBytes: MAX_MEDIA_BYTES - residentBytes } );
			try {

				preparationSignal?.throwIfAborted();
				if ( Math.abs( source.duration * 1000000 - asset.durationUs ) > 1000 ) throw new Error( 'The LED video duration disagrees with its published metadata.' );
				decoded.set( key, source ); requiredMedia.set( key, clone( asset ) );
				return source;

			} catch ( error ) {

				await source.dispose(); throw error;

			}

		};

		for ( const wall of walls.filter( wall => wall.media ) ) {

			onStatus( 'Verifying and decoding the shot’s LED media…' );
			await prepareSource( project.assets[ assetVersionKey( wall.media ) ], signal );

		}

		if ( shot.snapshot.environment.asset ) {

			onStatus( 'Verifying and preparing authored environment lighting…' );
			const key = assetVersionKey( shot.snapshot.environment.asset );
			environmentTextures.set( key, await loadVerifiedStudentEnvironment( project.assets[ key ], catalogue, { signal } ) );

		}

		renderer = new WebGPURenderer( { canvas: gpuCanvas, alpha: true, powerPreference: 'high-performance' } );
		await renderer.init();
		signal?.throwIfAborted();
		if ( ! renderer.backend.isWebGPUBackend ) throw new Error( 'Shot preview requires a WebGPU-capable browser.' );
		const renderScene = new Scene(), lightScene = new Scene();
		renderScene.add( loaded.sceneRoot );
		const lightObjects = new Map();
		const lightPool = createShotLightPool( project, shotId );
		for ( const light of lightPool.inventory ) {

			const object = new LIGHTS[ light.type ]();
			lightObjects.set( light.lightId, object );
			lightScene.add( object );

		}

		const settings = new RenderSettings();
		settings.setMany( { autoExposure: false, enableGroundCatcher: false, groundProjectionEnabled: false, enableEnvironment: false, showBackground: false, environmentIntensity: 0 }, { silent: true, reset: false } );
		// The normal Rayzee navigation owns input on the surface students see.
		// GPU rendering remains on its separate physical-resolution backing canvas.
		cameraManager = new CameraManager( canvas );
		cameraManager.controls.enabled = false;
		inspectionManager = new CameraManager( canvas );
		inspectionManager.controls.enabled = false;
		const camera = cameraManager.camera;
		const views = createStudentViewModes( { shotCamera: camera, inspectionCamera: inspectionManager.camera } );
		realtime = new RealtimeRenderer( { renderer, scene: renderScene, lightScene, camera, settings, stableLightInventory: true } );
		const lightManager = new LightManager( lightScene, null, null, { onChange: () => realtime.syncLights() } );
		media = createStudentLEDWallService( { nodeObjects: loaded.nodeObjects, mediaSources: decoded } );
		await media.apply( walls );
		signal?.throwIfAborted();
		const pose = createStudentPosePort( { nodeObjects: loaded.nodeObjects, humanRoots: new Set( sceneDefinition.humanPoseRoots ), onGeometryChanged: () => loaded.sceneRoot.updateMatrixWorld( true ) } );
		const environment = createStudentEnvironmentPort( { textures: environmentTextures, initial: { asset: null, intensity: 0, rotation: [ 0, 0, 0 ], background: false }, settings, realtimeRenderer: realtime } );
		const materials = shot.snapshot.materials ? createStudentMaterialPort( { nodeObjects: loaded.nodeObjects, inventory: shot.snapshot.materials, trackResources: loaded.trackResources, onChanged: () => realtime.syncLights() } ) : null;
		const binding = {
			get ready() {

				loaded.assertReady(); return ! disposed;

			},
			baseScene: clone( shot.baseScene ), nodes: clone( loaded.binding.nodes ),
			assets: [ ...scene.assets.map( clone ), ...[ ...requiredMedia.values() ].map( asset => ( { assetId: asset.assetId, version: asset.version } ) ), ...[ shot.snapshot.environment.asset ].filter( Boolean ) ],
			lights: lightPool.inventory.map( ( { lightId, type } ) => ( { lightId, type } ) ), ledWalls: walls.map( ( { wallId } ) => ( { wallId } ) ),
		};
		const cameraMetadata = { sensorWidth: 36, sensorHeight: 20.25, frameOverlayRatio: '16:9' };
		const ports = createThreeShotPorts( {
			binding, sceneRoot: loaded.sceneRoot, nodeObjects: loaded.nodeObjects, lightObjects, cameraManager, settings, cameraMetadata, lightManager,
			pose, environment, media, ...( materials ? { materials } : {} ), rasterAppearance: createRasterAppearancePort( { settings, renderer, realtimeRenderer: realtime } ),
			updateNodes: () => loaded.sceneRoot.updateMatrixWorld( true ),
			onCameraChanged: () => {

				renderer.toneMappingExposure = settings.get( 'exposure' );

			},
		} );
		const nativeSceneAdapter = new ShotSceneAdapter( ports );
		const sceneAdapter = {
			captureState: ( document, id ) => nativeSceneAdapter.captureState( lightPool.documentFor( document, id ), id ),
			applyShot: ( document, id, options ) => nativeSceneAdapter.applyShot( lightPool.documentFor( document, id ), id, options ),
			restoreState: token => nativeSceneAdapter.restoreState( token ),
		};
		let inspectionSnapshot = inspectionCamera ? clone( inspectionCamera ) : null;
		if ( inspectionSnapshot ) {

			views.restoreInspectionCamera( inspectionSnapshot );
			inspectionManager.controls.target.fromArray( inspectionSnapshot.target );

		}

		const paintNative = () => {

			views.render( () => {

				camera.updateMatrixWorld( true );
				realtime.render( { width: 1920, height: 1080 } );
				context.drawImage( gpuCanvas, 0, 0, 1920, 1080 );

			} );

		};

		const finishFrame = () => {

			// SequenceRasterAdapter masks photographic framing. Inspection shows
			// the full separate editor camera and must never inherit those masks.
			if ( views.mode === 'inspection' ) context.drawImage( gpuCanvas, 0, 0, 1920, 1080 );

		};

		const compatible = createShotViewportCompatibility( { document: project, shotId, sceneDefinition, lightInventory: lightPool.inventory } );
		const canUpdate = ( candidate, selectedShotId ) => {

			if ( closed || unusable || ! compatible( candidate, selectedShotId ) ) return false;
			try {

				const snapshot = candidate.shots[ selectedShotId ].snapshot;
				for ( const name of [ 'scene', 'pose', 'camera', 'lights', 'environment', 'rasterAppearance', 'media', ...( materials ? [ 'materials' ] : [] ) ] ) ports[ name ].validate?.( snapshot[ name === 'scene' || name === 'pose' ? 'nodes' : name === 'media' ? 'ledWalls' : name ], binding );
				loaded.assertReady();
				return true;

			} catch {

				return false;

			}

		};

		const prepareShotMedia = async ( revision, selectedShotId ) => {

			if ( ! compatible.canPrepare( revision, selectedShotId ) ) return false;
			for ( const wall of revision.shots[ selectedShotId ].snapshot.ledWalls ) {

				if ( ! wall.media ) continue;
				const key = assetVersionKey( wall.media ), asset = revision.assets[ key ];
				const source = await prepareSource( asset, lifetime.signal );
				await media.registerSource( key, source );
				compatible.registerPreparedAsset( asset );
				if ( ! binding.assets.some( entry => assetVersionKey( entry ) === key ) ) binding.assets.push( { assetId: asset.assetId, version: asset.version } );

			}

			return canUpdate( revision, selectedShotId );

		};

		const previewDocumentFor = ( revision, selectedShotId ) => {

			const value = clone( revision );
			value.clips = [ { clipId: 'selected-shot-preview', shotId: selectedShotId, durationFrames: 22500 } ];
			return value;

		};

		const createSequence = ( revision, selectedShotId, compile = false ) => {

			// Each evaluator owns one detached revision. Replacing it releases its
			// captured state token; scene/model/GPU/decoder ownership stays here.
			const previewDocument = previewDocumentFor( revision, selectedShotId );
			return new SequenceRasterAdapter( {
				document: previewDocument, sceneAdapter: {
					captureState: ( ...args ) => sceneAdapter.captureState( ...args ),
					restoreState: ( ...args ) => sceneAdapter.restoreState( ...args ),
					applyShot: ( document, id, options ) => sceneAdapter.applyShot( document, id, { ...options, changedResourcesOnly: true } ),
				}, canvas, editingShotId: selectedShotId,
				prepare: compile ? () => realtime.precompile() : async () => {},
				renderMedia: ( evaluation, options ) => media.renderEvaluation( evaluation, options ),
				render: paintNative,
			} );

		};

		const operationSignal = value => value ? AbortSignal.any( [ lifetime.signal, value ] ) : lifetime.signal;
		const syncNavigation = () => {

			const enabled = requestedInteractive && ! pendingOperations && ! closed && ! unusable;
			navigation?.setEnabled( enabled && views.mode === 'shot' );
			inspectionNavigation?.setEnabled( enabled && views.mode === 'inspection' );

		};

		const enqueue = ( operation, { suspendNavigation = true } = {} ) => {

			if ( closed || unusable ) return Promise.reject( new Error( 'Shot preview must be reloaded.' ) );
			if ( suspendNavigation ) {

				pendingOperations ++;
				syncNavigation();

			}

			const result = active.then( () => {

				if ( closed || unusable ) throw new Error( 'Shot preview must be reloaded.' );
				return operation();

			} ).finally( () => {

				if ( suspendNavigation ) {

					pendingOperations --;
					syncNavigation();

				}

			} );
			active = result.catch( () => {} );
			return result;

		};

		await sceneAdapter.applyShot( project, shotId );
		sequence = createSequence( project, shotId, true );
		onStatus( 'Compiling and rendering the shot…' );
		await sequence.prepare( { signal } );
		signal?.throwIfAborted();
		await sequence.renderFrame( 0, { signal } );
		signal?.throwIfAborted();
		navigation = createShotCameraNavigation( {
			cameraManager,
			paint: () => enqueue( () => {

				if ( ! cameraManager.controls.enabled || closed ) return;
				paintNative();
				drawFramingBars( context, cameraMetadata.frameOverlayRatio );

			}, { suspendNavigation: false } ),
			capture: () => clone( ports.camera.read() ),
			onStart: onNavigationStart,
			onChange: onCameraChange,
			onError: error => {

				onStatus( 'Camera navigation stopped. Save or reopen the shot to retry.' );
				Promise.resolve().then( () => onError( error ) ).catch( () => {} );

			},
		} );
		inspectionNavigation = createShotCameraNavigation( {
			cameraManager: inspectionManager,
			paint: () => enqueue( () => {

				if ( ! inspectionManager.controls.enabled || closed || views.mode !== 'inspection' ) return;
				paintNative();

			}, { suspendNavigation: false } ),
			capture: () => null,
			onError: error => {

				onStatus( 'Inspection navigation stopped. Reopen the scene to retry.' );
				Promise.resolve().then( () => onError( error ) ).catch( () => {} );

			},
		} );
		syncNavigation();
		return {
			canvas, dispose, canUpdate,
			prepareShot( candidate, selectedShotId ) {

				const revision = clone( candidate );
				return enqueue( () => prepareShotMedia( revision, selectedShotId ) );

			},
			prepareCut( selectedShotId, frame ) {

				if ( closed ) return Promise.resolve();
				const target = project.shots[ selectedShotId ];
				const times = frame === undefined ? null : createSequenceEvaluator( project ).evaluate( frame, { timelineFrame: frame } ).led;
				return Promise.all( ( target?.snapshot.ledWalls || [] ).filter( wall => wall.media && decoded.has( assetVersionKey( wall.media ) ) ).map( wall => decoded.get( assetVersionKey( wall.media ) ).prepareFrame( times?.find( entry => entry.wallId === wall.wallId )?.sourceTimeSeconds ?? wall.inPointUs / 1000000 ) ) );

			},
			preparePlayback( candidate, frame = 0 ) {

				const revision = clone( candidate );
				return enqueue( async () => {

					validateStudentProjectDocument( revision );
					const evaluator = createSequenceEvaluator( revision );
					const upcoming = evaluator.spans.filter( span => span.endFrame > frame );
					for ( const span of upcoming ) {

						if ( ! await prepareShotMedia( revision, span.shotId ) ) return false;

					}

					// Warm imminent cut frames last; each decoder retains at most four.
					for ( const span of upcoming.slice( 0, 4 ).reverse() ) for ( const entry of evaluator.evaluate( Math.max( frame, span.startFrame ), { timelineFrame: Math.max( frame, span.startFrame ) } ).led ) {

						await decoded.get( assetVersionKey( entry.media ) ).prepareFrame( entry.sourceTimeSeconds );

					}

					const signature = serializeStudentCatalogueContent( revision );
					if ( warmedRevision !== signature ) warmedShots.clear();
					const pendingShots = [ ...new Set( upcoming.map( span => span.shotId ) ) ].filter( id => ! warmedShots.has( id ) );
					if ( pendingShots.length ) {

						const token = await sceneAdapter.captureState( project, shot.shotId );
						let preparationError;
						try {

							for ( const id of pendingShots ) {

								lifetime.signal.throwIfAborted();
								const start = Math.max( frame, upcoming.find( span => span.shotId === id ).startFrame );
								const evaluation = evaluator.evaluate( start, { timelineFrame: start } );
								await sceneAdapter.applyShot( revision, id, { changedResourcesOnly: true, mediaTimes: new Map( evaluation.led.map( entry => [ entry.wallId, entry.sourceTimeSeconds ] ) ) } );
								await realtime.precompile();
								camera.updateMatrixWorld( true );
								// Warm visibility/pose/shadow/post variants offscreen. The
								// visible Canvas2D frame must not change during preparation.
								realtime.render( { width: 1920, height: 1080 } );

							}

						} catch ( error ) {

							preparationError = error;

						}

						try {

							await sceneAdapter.restoreState( token );

						} catch ( error ) {

							unusable = true;
							throw new AggregateError( [ preparationError, error ].filter( Boolean ), 'Playback preparation could not restore the preview. Reopen this scene.' );

						}

						if ( preparationError ) throw preparationError;

						warmedRevision = signature;
						for ( const id of pendingShots ) warmedShots.add( id );

					}

					return true;

				} );

			},
			get viewMode() {

				return views.mode;

			},
			setViewMode( mode, options = {} ) {

				if ( ! [ 'shot', 'inspection' ].includes( mode ) ) return Promise.reject( new TypeError( 'Unknown student view mode.' ) );
				const viewSignal = operationSignal( options.signal );
				return enqueue( () => {

					viewSignal.throwIfAborted();
					if ( mode === 'inspection' && ! views.initialized ) {

						inspectionManager.controls.target.copy( cameraManager.controls.target );
						inspectionSnapshot = clone( ports.camera.read() );

					}

					views.setMode( mode );
					paintNative();
					if ( mode === 'shot' ) drawFramingBars( context, cameraMetadata.frameOverlayRatio );

				} );

			},
			captureInspectionCamera() {

				return enqueue( () => {

					if ( ! views.initialized ) return null;
					const value = clone( inspectionSnapshot || ports.camera.read() );
					const inspected = views.initialized ? inspectionManager.camera : camera;
					value.transform = { position: inspected.position.toArray(), quaternion: inspected.quaternion.toArray(), scale: inspected.scale.toArray(), visible: inspected.visible };
					value.target = ( views.initialized ? inspectionManager : cameraManager ).controls.target.toArray();
					for ( const key of Object.keys( value.projection ) ) if ( key !== 'type' ) value.projection[ key ] = key === 'clipStart' ? inspected.userData.clipStart ?? 0 : inspected[ key ];
					return value;

				} );

			},
			setInteractive( enabled ) {

				requestedInteractive = Boolean( enabled );
				syncNavigation();

			},
			captureCamera() {

				return enqueue( () => clone( ports.camera.read() ) );

			},
			previewFocalLength( value ) {

				camera.fov = value.projection.fov;
				camera.updateProjectionMatrix();
				settings.set( 'focalLength', value.lens.focalLength, { silent: true, reset: false } );
				paintNative();
				if ( views.mode === 'shot' ) drawFramingBars( context, cameraMetadata.frameOverlayRatio );

			},
			previewLEDBlur( wallId, value ) {

				media.previewBlur( wallId, value );
				paintNative();
				if ( views.mode === 'shot' ) drawFramingBars( context, cameraMetadata.frameOverlayRatio );

			},
			compareLEDBlur( wallId, amount, onProgress ) {

				return enqueue( async () => {

					const wall = shot.snapshot.ledWalls.find( item => item.wallId === wallId );
					if ( ! wall?.media ) throw new Error( 'Choose an LED screen with video to compare playback.' );
					const duration = decoded.get( assetVersionKey( wall.media ) ).duration;
					const baseline = createSequenceEvaluator( previewDocumentFor( project, shot.shotId ) ).evaluate( 0 );
					const savedMode = views.mode;
					views.setMode( 'shot' );
					try {

						return await compareLEDBlur( {
							amount, signal: lifetime.signal, onProgress,
							select: value => media.previewBlur( wallId, value ),
							complete: () => renderer.backend.device.queue.onSubmittedWorkDone(),
							render: async frame => {

								const time = wall.inPointUs / 1000000 + frame / 25 * wall.playbackRate;
								const sourceTimeSeconds = wall.loop ? time % duration : Math.min( time, Math.max( 0, duration - 0.000001 ) );
								const led = baseline.led.map( entry => entry.wallId === wallId ? { ...entry, sourceTimeSeconds } : entry );
								await media.renderEvaluation( { ended: false, led }, { signal: lifetime.signal } );
								paintNative(); drawFramingBars( context, cameraMetadata.frameOverlayRatio );

							},
						} );

					} finally {

						media.previewBlur( wallId, null ); views.setMode( savedMode );
						if ( ! closed ) {

							await sequence.renderFrame( localFrame, { timelineFrame, signal: lifetime.signal } ); finishFrame();

						}

					}

				} );

			},
			inspect() {

				let meshCount = 0;
				loaded.sceneRoot.traverse( node => {

					if ( node.isMesh ) meshCount ++;

				} );
				return {
					meshCount, decodedCount: decoded.size,
					residentMediaBytes: [ ...decoded.values() ].reduce( ( size, source ) => size + source.residentBytes, 0 ),
					encodedMediaBytes: [ ...requiredMedia.values() ].reduce( ( size, asset ) => size + asset.byteLength, 0 ),
					geometryIds: [ ...new Set( [ ...loaded.nodeObjects.values() ].filter( node => node.isMesh ).map( node => node.geometry.uuid ) ) ],
					ledResourceIds: shot.snapshot.ledWalls.map( wall => {

						const material = loaded.nodeObjects.get( wall.nodeInstanceId )?.material;
						return { wallId: wall.wallId, material: material?.uuid, texture: material?.emissiveMap?.uuid };

					} ),
					rendererInfo: { calls: renderer.info.calls, frame: renderer.info.frame, memory: { ...renderer.info.memory }, render: { ...renderer.info.render }, compute: { ...renderer.info.compute } },
				};

			},
			get shotId() {

				return shot.shotId;

			},
			get capabilities() {

				return {
					nodes: sceneDefinition.models.flatMap( model => model.nodes.filter( node => node.gltfNodeIndex === null ).map( node => ( { instanceId: node.instanceId, label: model.asset.assetId, humanPose: sceneDefinition.humanPoseRoots.includes( node.instanceId ) } ) ) ),
					lights: binding.lights.map( clone ),
					walls: shot.snapshot.ledWalls.map( wall => ( { wallId: wall.wallId, sourceDurationUs: wall.media ? project.assets[ assetVersionKey( wall.media ) ].durationUs : null } ) ),
				};

			},
			updateDocument( candidate, selectedShotId, options = {} ) {

				// Copy at call time, before queued work can observe an editor mutation.
				let revision;
				try {

					revision = clone( candidate );
					if ( ! canUpdate( revision, selectedShotId ) ) throw new Error( 'This saved shot requires a different prepared scene; reload the preview.' );

				} catch ( error ) {

					return Promise.reject( error );

				}

				const updateSignal = operationSignal( options.signal );
				return enqueue( async () => {

					updateSignal.throwIfAborted();
					if ( options.playback && revision.projectId === project.projectId && revision.revision === project.revision && serializeStudentCatalogueContent( revision ) === serializeStudentCatalogueContent( project ) ) {

						sequence.retarget( previewDocumentFor( revision, selectedShotId ), selectedShotId );
						project = revision; shot = project.shots[ selectedShotId ];
						canvas.setAttribute( 'aria-label', `Shot preview: ${shot.name}` );
						return;

					}

					const previousFrame = localFrame, previousTimelineFrame = timelineFrame;
					try {

						await sequence.restore();

					} catch ( error ) {

						unusable = true;
						throw new AggregateError( [ error ], 'Shot revision restoration failed; preview must be reloaded.' );

					}

					sequence = createSequence( revision, selectedShotId );
					try {

						updateSignal.throwIfAborted();
						await sequence.prepare( { signal: updateSignal } );
						const evaluation = await sequence.renderFrame( 0, { signal: updateSignal, timelineFrame: options.timelineFrame } );
						finishFrame();
						updateSignal.throwIfAborted();
						project = revision; shot = project.shots[ selectedShotId ]; localFrame = 0; timelineFrame = options.timelineFrame;
						canvas.setAttribute( 'aria-label', `Shot preview: ${shot.name}` );
						return evaluation;

					} catch ( error ) {

						try {

							await sequence.restore();
							if ( ! closed ) {

								sequence = createSequence( project, shot.shotId );
								await sequence.prepare( { signal: lifetime.signal } );
								await sequence.renderFrame( previousFrame, { signal: lifetime.signal, timelineFrame: previousTimelineFrame } );
								finishFrame();

							}

						} catch ( restoreError ) {

							unusable = true;
							throw new AggregateError( [ error, restoreError ], 'Shot revision and rollback failed; preview must be reloaded.' );

						}

						throw error;

					}

				} );

			},
			renderFrame( requestedFrame, options = {} ) {

				const frame = requestedFrame;
				const frameSignal = operationSignal( options.signal );
				return enqueue( async () => {

					const evaluation = await sequence.renderFrame( frame, { ...options, signal: frameSignal } );
					finishFrame();
					// Retain only the last successful time, for transactional edit rollback.
					localFrame = frame;
					timelineFrame = options.timelineFrame;
					return evaluation;

				} );

			},
		};

	} catch ( error ) {

		try {

			await dispose();

		} catch ( cleanupError ) {

			throw new AggregateError( [ error, cleanupError ], 'Shot preview preparation and cleanup failed.' );

		}

		throw error;

	}

}
