import { ACESFilmicToneMapping, Box3, PointLight, Scene, Vector3 } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { CameraManager } from '../../../../rayzee/src/managers/CameraManager.js';
import { LightManager } from '../../../../rayzee/src/managers/LightManager.js';
import { RealtimeRenderer } from '../../../../rayzee/src/managers/RealtimeRenderer.js';
import { RenderSettings } from '../../../../rayzee/src/RenderSettings.js';
import { createStudentProjectDocument, validateStudentProjectDocument } from '../../previs/domain/StudentProjectSchema.js';
import { createThreeShotPorts } from '../../previs/engine/ThreeShotPorts.js';
import { ShotSceneAdapter } from '../../previs/engine/ShotSceneAdapter.js';
import { SequenceRasterAdapter } from '../../previs/engine/SequenceRasterAdapter.js';
import { createRasterAppearancePort } from '../../previs/engine/RasterAppearance.js';
import { drawFramingBars } from '../../previs/engine/FrameFraming.js';
import { createStudentPosePort } from '../../previs/engine/StudentPosePort.js';
import { createStudentEnvironmentPort } from '../../previs/engine/StudentEnvironmentPort.js';
import { loadVerifiedStudentScene } from '../../previs/engine/VerifiedStudentSceneLoader.js';
import { createBundledStudentSceneManifest } from '../../previs/fixtures/BundledStudentScene.js';
import { createStudentLEDWallService } from '../../previs/media/StudentLEDWallService.js';
import { DecodedLEDSource } from '../../previs/media/DecodedLEDSource.js';
import { applyVehicleDoorPose, vehicleDoorHinges } from '../../utils/vehicleDoorPoses.js';
import { prepareMannequin } from '../../utils/mannequinPoses.js';
import { createTimecodeFixture } from '../diagnostic/DiagnosticScene.js';

const surface = ( width, height ) => Object.assign( document.createElement( 'canvas' ), { width, height } );
const clone = value => structuredClone( value );

/** Real bundled studio/car/rig/wall integration fixture. No admin singleton or
 * store is created; published catalogue identity remains a separate boundary.
 */
export async function createSupportedSceneViewport( viewport, { frameCount = 250, signal, onStatus = () => {} } = {} ) {

	if ( ! Number.isInteger( frameCount ) || frameCount < 126 || frameCount > 22500 ) throw new RangeError( 'Scene fixture requires 126–22500 frames' );
	let loaded, renderer, realtime, cameraManager, media, decoded;
	let disposed = false;
	let sequence;
	let capture;
	let disposal;
	const dispose = () => disposal ||= ( async () => {

		if ( disposed ) return;
		const errors = [];
		for ( const cleanup of [ () => sequence?.restore(), () => media?.dispose(), () => decoded?.dispose(), () => realtime?.dispose(), () => cameraManager?.dispose(), () => loaded?.dispose(), () => renderer?.dispose(), () => capture?.remove() ] ) {

			try {

				await cleanup();

			} catch ( error ) {

				errors.push( error );

			}

		}

		disposed = true;
		if ( errors.length ) throw new AggregateError( errors, 'Real scene cleanup failed' );

	} )();
	try {

		onStatus( 'Verifying bundled studio, SUV, mannequin and LED model bytes…' );
		const manifest = createBundledStudentSceneManifest( { models: [ 'studio', 'suv', 'mannequin', 'led' ] } );
		loaded = await loadVerifiedStudentScene( manifest, { signal } );
		signal?.throwIfAborted();
		renderer = new WebGPURenderer( { canvas: viewport, antialias: false } );
		await renderer.init();
		if ( ! renderer.backend.isWebGPUBackend ) throw new Error( 'The real scene requires WebGPU hardware support' );
		renderer.toneMapping = ACESFilmicToneMapping;
		const scene = new Scene();
		scene.add( loaded.sceneRoot );
		const canonicalLights = new Scene();
		const key = new PointLight( '#fff1dc', 8000 );
		key.position.set( 3, 5, 4 );
		const fill = new PointLight( '#cadfff', 4000 );
		fill.position.set( - 3, 3, 1 );
		canonicalLights.add( key, fill );
		const lightObjects = new Map( [[ 'key', key ], [ 'fill', fill ]] );
		const settings = new RenderSettings();
		settings.setMany( { enableEnvironment: false, showBackground: false, environmentIntensity: 0, environmentRotation: 0, backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#17212d', transparentBackground: false, autoExposure: false, enableGroundCatcher: false, groundProjectionEnabled: false, enableDOF: false, exposure: 0.35 }, { silent: true, reset: false } );
		cameraManager = new CameraManager( viewport );
		cameraManager.controls.enabled = false;
		cameraManager.setAutoFocusMode( 'manual' );
		const camera = cameraManager.camera;
		camera.aspect = 16 / 9;
		camera.near = 0.05;
		camera.far = 500;
		camera.fov = 48;
		camera.position.set( 5.8, 3, 7.5 );
		cameraManager.controls.target.set( 0, 1.4, 0 );
		camera.lookAt( cameraManager.controls.target );
		camera.updateProjectionMatrix();
		settings.set( 'focalLength', camera.getFocalLength(), { silent: true, reset: false } );
		realtime = new RealtimeRenderer( { renderer, scene, lightScene: canonicalLights, camera, settings } );
		const lightManager = new LightManager( canonicalLights, null, null, { onChange: () => realtime.syncLights() } );
		const car = loaded.nodeObjects.get( 'suv-root' );
		const human = loaded.nodeObjects.get( 'mannequin-root' );
		human.position.set( 2.7, 0, 0 );
		prepareMannequin( human, 'standing' );
		applyVehicleDoorPose( car, 'closed' );
		// Exact authored catalog pivot normalization; no guessed model centring.
		const display = loaded.nodeObjects.get( 'led-instance-0' );
		display.position.set( 0, 0, 0 );
		loaded.nodeObjects.get( 'led-root' ).position.set( 0, 0, - 4.5 );
		loaded.nodeObjects.get( 'led-root' ).rotation.y = Math.PI / 2;
		loaded.sceneRoot.updateMatrixWorld( true );
		const bounds = {};
		for ( const name of [ 'studio', 'suv', 'mannequin', 'led' ] ) {

			const box = new Box3().setFromObject( loaded.nodeObjects.get( `${name}-root` ) );
			bounds[ name ] = { min: box.min.toArray(), max: box.max.toArray() };

		}

		onStatus( 'Preparing deterministic LED decoder and concrete scene ports…' );
		const video = await createTimecodeFixture();
		const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await video.arrayBuffer() ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
		decoded = await DecodedLEDSource.open( video );
		const mediaRef = { assetId: 'fixture-timecode', version: 'generated-1' };
		const wall = {
			wallId: 'main-wall', presentationVersion: 1, nodeInstanceId: 'led-instance-0', media: mediaRef,
			mode: 'freeze', inPointUs: 1000000, loop: true, playbackRate: 1, brightnessNits: 200,
			placement: { position: [ 0.5, 0.5 ], scale: [ 1, 1 ], rotationDegrees: 0, aspectRatioLocked: true, fitMode: 'stretch' },
			surface: { nativeCanvas: [ 6144, 2592 ], uvChannel: 1, uvBounds: [ - 0.000700951, 1, 0.288818359, 0.7109375 ], flipU: true },
		};
		media = createStudentLEDWallService( { nodeObjects: loaded.nodeObjects, mediaSources: new Map( [[ 'fixture-timecode@generated-1', decoded ]] ) } );
		await media.apply( [ wall ] );
		const environment = createStudentEnvironmentPort( { initial: { asset: null, intensity: 0, rotation: [ 0, 0, 0 ], background: false }, settings, realtimeRenderer: realtime } );
		const pose = createStudentPosePort( { nodeObjects: loaded.nodeObjects, humanRoots: new Set( [ 'mannequin-root' ] ), onGeometryChanged: () => loaded.sceneRoot.updateMatrixWorld( true ) } );
		const binding = {
			get ready() {

				loaded.assertReady(); return ! disposed;

			},
			baseScene: clone( loaded.binding.baseScene ), nodes: clone( loaded.binding.nodes ),
			assets: [ ...clone( loaded.binding.assets ), mediaRef ],
			lights: [ { lightId: 'key', type: 'point' }, { lightId: 'fill', type: 'point' } ], ledWalls: [ { wallId: 'main-wall' } ],
		};
		const cameraMetadata = { sensorWidth: 36, sensorHeight: 20.25, frameOverlayRatio: '4:3' };
		let applies = 0;
		const ports = createThreeShotPorts( {
			binding, sceneRoot: loaded.sceneRoot, nodeObjects: loaded.nodeObjects, lightObjects, cameraManager, settings, cameraMetadata, lightManager,
			pose, environment, media, rasterAppearance: createRasterAppearancePort( { settings, renderer, realtimeRenderer: realtime } ),
			updateNodes: () => {

				loaded.assertReady(); loaded.sceneRoot.updateMatrixWorld( true );

			},
			onCameraChanged: () => {

				applies ++; renderer.toneMappingExposure = settings.get( 'exposure' );

			},
		} );
		const readSnapshot = async () => {

			const transforms = ports.scene.read();
			const poses = pose.read();
			return {
				nodes: Object.fromEntries( binding.nodes.map( node => [ node.instanceId, { asset: clone( node.asset ), nodeId: node.nodeId, transform: transforms[ node.instanceId ], ...poses[ node.instanceId ] } ] ) ),
				camera: ports.camera.read(), lights: ports.lights.read(), environment: environment.read(), ledWalls: await media.read(), rasterAppearance: ports.rasterAppearance.read(),
			};

		};

		const document = createStudentProjectDocument( { name: 'Verified studio / SUV / mannequin / LED fixture' } );
		document.assets = { ...clone( manifest.assets ), 'fixture-timecode@generated-1': { ...mediaRef, kind: 'video', sha256: hash, byteLength: video.size, mimeType: 'video/mp4', durationUs: 3000000 } };
		document.baseScenes = { [ `${manifest.baseScene.sceneId}@${manifest.baseScene.version}` ]: clone( manifest.baseScene ) };
		const makeShot = async ( shotId, name ) => ( { shotId, name, baseScene: clone( binding.baseScene ), sourcePreset: null, snapshot: await readSnapshot() } );
		document.shots.wide = await makeShot( 'wide', 'Standing / closed doors / frozen LED' );
		prepareMannequin( human, 'sitting' );
		human.position.set( - 2.7, 0, 0 );
		applyVehicleDoorPose( car, 'both-open' );
		camera.position.set( - 5, 2.6, 6.5 );
		camera.lookAt( 0, 1.3, 0 );
		cameraManager.controls.target.set( 0, 1.3, 0 );
		cameraMetadata.frameOverlayRatio = '2.40:1';
		key.intensity = 6500;
		const secondWall = clone( wall );
		secondWall.mode = 'play';
		secondWall.inPointUs = 480000;
		secondWall.placement = { position: [ 0.52, 0.48 ], scale: [ 0.9, 0.9 ], rotationDegrees: 6, aspectRatioLocked: true, fitMode: 'contain' };
		await media.apply( [ secondWall ] );
		document.shots.close = await makeShot( 'close', 'Sitting / open doors / advancing LED' );
		document.clips = [ { clipId: 'wide', shotId: 'wide', durationFrames: 125 }, { clipId: 'close', shotId: 'close', durationFrames: frameCount - 125 } ];
		validateStudentProjectDocument( document );
		const sceneAdapter = new ShotSceneAdapter( ports );
		await sceneAdapter.applyShot( document, 'wide' );
		capture = surface( 1920, 1080 );
		capture.className = 'raster-capture';
		viewport.after( capture );
		const context = capture.getContext( '2d' );
		let lastEvaluation;
		sequence = new SequenceRasterAdapter( {
			document, sceneAdapter, canvas: capture, editingShotId: 'wide',
			prepare: async () => {

				signal?.throwIfAborted(); await realtime.precompile();

			},
			renderMedia: async ( evaluation, options ) => {

				await media.renderEvaluation( evaluation, options ); lastEvaluation = evaluation;

			},
			render: () => {

				realtime.render( { width: 1920, height: 1080 } ); context.drawImage( viewport, 0, 0, 1920, 1080 );

			},
			restore: () => {

				realtime.render( { width: 1920, height: 1080 } );
				context.drawImage( viewport, 0, 0, 1920, 1080 );
				drawFramingBars( context, cameraMetadata.frameOverlayRatio );
				lastEvaluation = null;

			},
		} );
		onStatus( 'Compiling the existing admin raster post stack…' );
		await sequence.prepare( { signal } );
		await sequence.renderFrame( 0, { signal } );
		await sequence.restore();
		let meshCount = 0;
		loaded.sceneRoot.traverse( object => {

			if ( object.isMesh ) meshCount ++;

		} );
		const poseGeometry = () => {

			const signature = [];
			human.traverse( object => {

				const positions = object.geometry?.getAttribute( 'position' );
				if ( ! positions ) return;
				let sum = 0;
				for ( let i = 0; i < positions.count; i += Math.max( 1, Math.floor( positions.count / 64 ) ) ) sum += positions.getY( i ) * ( i + 1 );
				signature.push( { vertices: positions.count, weightedY: sum } );

			} );
			return signature;

		};

		const state = () => ( {
			meshCount, bounds, applies, backend: renderer.backend.constructor.name, frameCount,
			poseGeometry: poseGeometry(), ledScreenPoint: new Box3().setFromObject( display ).getCenter( new Vector3() ).add( new Vector3( 0, 1, 0 ) ).project( camera ).toArray(),
			camera: camera.position.toArray(), pose: pose.read()[ 'mannequin-root' ].humanPose,
			doors: vehicleDoorHinges( car ).map( hinge => hinge.quaternion.toArray() ),
			ledTime: lastEvaluation?.led[ 0 ]?.sourceTimeSeconds, frame: lastEvaluation?.frame,
		} );
		return { document: clone( document ), adapter: sequence, sceneAdapter, state, dispose, renderer, ports, mediaDiagnostics: () => media.inspect(), captureShot: () => sceneAdapter.captureShot( document, 'wide' ), readFixtureVideo: async () => new Uint8Array( await video.arrayBuffer() ) };

	} catch ( error ) {

		try {

			await dispose();

		} catch { /* Preserve initialization failure. */ }

		throw error;

	}

}
