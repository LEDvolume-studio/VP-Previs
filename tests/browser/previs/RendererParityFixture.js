import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { AssetLoader } from '../../../rayzee/src/Processor/AssetLoader.js';
import { GeometryExtractor } from '../../../rayzee/src/Processor/GeometryExtractor.js';
import { RealtimeRenderer } from '../../../rayzee/src/managers/RealtimeRenderer.js';
import { RenderSettings } from '../../../rayzee/src/RenderSettings.js';
import { LightManager } from '../../../rayzee/src/managers/LightManager.js';
import { applyMaterialState, serializeMaterial } from '../../../app/src/services/projects/MaterialState.js';
import { createPublishedShotViewport } from '../../../app/src/student/PublishedShotViewport.js';
import { createStudentDemoProject } from '../../../app/src/student/demo/StudentDemo.js';
import { createBundledStudentSceneManifest } from '../../../app/src/previs/fixtures/BundledStudentScene.js';
import { createCameraShotEdit } from '../../../app/src/previs/domain/StudentShotEdits.js';
import appearance from '../../../app/src/student/demo/admin-appearance.json';

export async function compareRenderers() {

	const clone = value => structuredClone( value );
	const manifest = createBundledStudentSceneManifest( { models: [ 'suv' ] } );
	const model = manifest.models[ 0 ];
	const original = await createStudentDemoProject( { matchAdmin: true } );
	const project = clone( original.document ), reference = { sceneId: manifest.baseScene.sceneId, version: manifest.baseScene.version };
	const shot = createCameraShotEdit( project.shots.wide, { position: [ 5.8, 1.8, 7.5 ], target: [ 0, 1.2, 0 ], fov: 48, exposure: appearance.exposure, frameOverlayRatio: '16:9' } );
	shot.baseScene = reference; shot.snapshot.ledWalls = [];
	shot.snapshot.nodes = Object.fromEntries( Object.entries( shot.snapshot.nodes ).filter( ( [ id ] ) => id.startsWith( 'suv-' ) ) );
	project.assets = { ...manifest.assets, [ `${appearance.environmentAsset.assetId}@${appearance.environmentAsset.version}` ]: appearance.environmentAsset };
	project.baseScenes = { [ `${reference.sceneId}@${reference.version}` ]: manifest.baseScene };
	project.shots = { wide: shot }; project.clips = [ { clipId: 'wide', shotId: 'wide', durationFrames: 125 } ];
	const definition = { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: manifest.baseScene, models: [ { asset: model.asset, nodes: model.nodes } ], humanPoseRoots: [] };
	const catalogue = { getScene: async () => ( { sceneDefinition: definition, assets: manifest.assets } ), getAssetBytes: ( ...args ) => original.catalogue.getAssetBytes( ...args ) };
	const viewport = await createPublishedShotViewport( { document: project, shotId: 'wide', catalogue } );
	viewport.setInteractive( false );
	const canvas = document.createElement( 'canvas' ), scene = new THREE.Scene(), lightScene = new THREE.Scene();
	const renderer = new WebGPURenderer( { canvas, alpha: true, powerPreference: 'high-performance' } ); await renderer.init();
	renderer.toneMapping = shot.snapshot.rasterAppearance.toneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMappingExposure = shot.snapshot.camera.exposure;
	const camera = new THREE.PerspectiveCamera(), saved = shot.snapshot.camera;
	for ( const [ key, value ] of Object.entries( saved.projection ) ) if ( key !== 'type' && key !== 'clipStart' ) camera[ key ] = value;
	camera.position.fromArray( saved.transform.position ); camera.quaternion.fromArray( saved.transform.quaternion ); camera.scale.fromArray( saved.transform.scale ); camera.updateProjectionMatrix(); camera.updateMatrixWorld( true );
	const settings = new RenderSettings(); settings.setMany( { ...shot.snapshot.rasterAppearance, autoExposure: false, enableGroundCatcher: false, groundProjectionEnabled: false, environmentIntensity: shot.snapshot.environment.intensity, environmentRotation: shot.snapshot.environment.rotation[ 1 ] * 180 / Math.PI }, { silent: true, reset: false } );
	const loader = new AssetLoader( lightScene, camera, { target: new THREE.Vector3() } ); loader.renderer = renderer;
	const gltfLoader = await loader.createGLTFLoader();
	const bytes = await catalogue.getAssetBytes( manifest.assets[ `${model.asset.assetId}@${model.asset.version}` ] );
	const gltf = await gltfLoader.parseAsync( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ), '' ); loader._disposeGLTFLoader( gltfLoader ); loader.processModelObjects( gltf.scene );
	const objects = new Map(); gltf.scene.traverse( object => {

		const index = gltf.parser.associations.get( object )?.nodes; if ( index !== undefined ) objects.set( index, object );

	} );
	for ( const mapping of model.nodes ) {

		const object = mapping.gltfNodeIndex === null ? gltf.scene : objects.get( mapping.gltfNodeIndex ), value = shot.snapshot.nodes[ mapping.instanceId ].transform;
		object.position.fromArray( value.position ); object.quaternion.fromArray( value.quaternion ); object.scale.fromArray( value.scale ); object.visible = value.visible; object.updateMatrix();
		for ( const entry of shot.snapshot.materials[ mapping.instanceId ] || [] ) {

			let mesh = object; for ( const index of entry.path ) mesh = mesh.children[ index ];
			applyMaterialState( Array.isArray( mesh.material ) ? mesh.material[ entry.slot ] : mesh.material, entry.state );

		}

	}

	// Admin loadSceneData processes materials through extraction even in raster
	// mode. Include its native material preparation, not just GLTFLoader defaults.
	new GeometryExtractor().extractMaterialsOnly( gltf.scene );
	scene.add( gltf.scene ); scene.updateMatrixWorld( true );
	const helpers = { visible: false, clear() {}, update() {} }, manager = new LightManager( lightScene, helpers ); manager.replaceProjectState( appearance.lights );
	const hdr = await loader.loadEnvironmentByExtension( '/src/student/demo/environment/aristea_wreck_puresky_1k.hdr', 'hdr' ); hdr.generateMipmaps = true; lightScene.environment = hdr;
	const realtime = new RealtimeRenderer( { renderer, scene, lightScene, camera, settings } ); await realtime.precompile();
	const capture = document.createElement( 'canvas' ); capture.width = 1920; capture.height = 1080; const context = capture.getContext( '2d' );
	const outputs = [];
	try {

		for ( let index = 0; index < 2; index ++ ) {

			await viewport.renderFrame( 0 ); realtime.render( { width: 1920, height: 1080 } ); await renderer.backend.device.queue.onSubmittedWorkDone(); context.drawImage( canvas, 0, 0 );

		}

		const admin = context.getImageData( 0, 0, 1920, 1080 ).data, student = viewport.canvas.getContext( '2d' ).getImageData( 0, 0, 1920, 1080 ).data;
		let total = 0, maximum = 0, changed = 0;
		for ( let index = 0; index < admin.length; index ++ ) {

			const difference = Math.abs( admin[ index ] - student[ index ] ); total += difference; maximum = Math.max( maximum, difference ); if ( difference ) changed ++;

		}

		outputs.push( { name: 'admin-reference.png', data: capture.toDataURL() }, { name: 'student.png', data: viewport.canvas.toDataURL() } );
		const painted = gltf.scene.getObjectsByProperty( 'isMesh', true ).find( mesh => mesh.material.name === 'KB3D_CEV_MidSuvExteriorBody' );
		return { meanChannelError: total / admin.length, maximumChannelError: maximum, changedChannels: changed, outputs, paintNormalScale: serializeMaterial( painted.material ).values.normalScale, environmentDimensions: [ hdr.image.width, hdr.image.height ], referenceState: { camera: camera.position.toArray(), background: scene.background?.isTexture, envIntensity: scene.environmentIntensity, exposure: renderer.toneMappingExposure, renderSize: [ canvas.width, canvas.height ], lights: realtime.lightProxies.length }, geometryMeshes: gltf.scene.getObjectsByProperty( 'isMesh', true ).length };

	} finally {

		await viewport.dispose(); realtime.dispose(); manager.dispose(); hdr.dispose(); renderer.dispose(); loader.dispose();

	}

}
