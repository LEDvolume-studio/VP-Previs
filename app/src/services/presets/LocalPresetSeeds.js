import { getLocalPresetRepository } from './LocalPresetRepository.js';
import { createProjectDocument } from '../projects/ProjectSchema.js';
import { serializeMaterial } from '../projects/MaterialState.js';
import { RenderSettings } from '../../../../rayzee/src/RenderSettings.js';
import { assetVersionKey, baseSceneVersionKey } from '../../previs/domain/StudentProjectSchema.js';
import { loadVerifiedStudentScene } from '../../previs/engine/VerifiedStudentSceneLoader.js';
import { createCameraShotEdit } from '../../previs/domain/StudentShotEdits.js';

const pending = new WeakMap();
const clone = value => structuredClone( value );
const catalogIds = { studio: 'model-studio-one', suv: 'kb3d-mid-suv-v1', mannequin: 'rigged-mannequin-v1', led: 'main-led-volume-wall-v1' };
const descriptors = [[ 'wide', 'Wide' ], [ 'close', 'Reverse' ], [ 'front', 'Front three-quarter', [ 5.8, 1.6, 7.5 ]], [ 'side', 'Side view', [ 8, 1.6, 0 ]], [ 'rear', 'Rear three-quarter', [ - 5.8, 2, - 7 ]], [ 'high', 'High angle', [ 6, 6, 8 ]]];

function cameraState( camera ) {

	return {
		name: 'Preset camera', position: camera.transform.position, quaternion: camera.transform.quaternion,
		fov: camera.projection.fov, near: camera.projection.near, far: camera.projection.far,
		clipStart: camera.projection.clipStart, orbitTarget: camera.target, effects: { ...clone( camera.lens ), afScreenPoint: { x: camera.lens.afScreenPoint[ 0 ], y: camera.lens.afScreenPoint[ 1 ] } },
	};

}

/** Full admin documents for the existing six review cameras, not empty scenes. */
export function createSeedAdminDocument( preset, loaded, appearance, catalogue = [] ) {

	const document = createProjectDocument( { name: preset.name, environmentId: 'aristea_wreck_puresky' } );
	const objectPaths = new Map();
	for ( const model of preset.sceneDefinition.models ) {

		const prefix = model.nodes[ 0 ].instanceId.split( '-' )[ 0 ];
		const root = loaded.nodeObjects.get( model.nodes.find( node => node.gltfNodeIndex === null ).instanceId );
		const instanceId = `seed-${prefix}`;
		document.scene.assets.push( { instanceId, catalogId: catalogIds[ prefix ], assetVersion: catalogue.find( entry => entry.id === catalogIds[ prefix ] )?.assetVersion || 1, role: 'appended', name: prefix } );
		const walk = ( object, path ) => {

			const key = `${instanceId}:${path}`;
			objectPaths.set( object, key );
			document.scene.nodes[ key ] = { name: object.name, position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), visible: object.visible };
			if ( object.isMesh ) for ( const [ slot, material ] of ( Array.isArray( object.material ) ? object.material : [ object.material ] ).entries() ) document.scene.materials[ `${key}:${slot}` ] = serializeMaterial( material );
			object.children.forEach( ( child, index ) => walk( child, `${path}/${index}` ) );

		};

		walk( root, '0' );
		for ( const mapped of model.nodes ) {

			const object = loaded.nodeObjects.get( mapped.instanceId ), value = preset.snapshot.nodes[ mapped.instanceId ];
			Object.assign( document.scene.nodes[ objectPaths.get( object ) ], clone( value.transform ) );
			if ( value.humanPose ) object.traverse( child => {

				if ( child.isMesh && child.morphTargetDictionary?.standing !== undefined ) document.scene.nodes[ objectPaths.get( child ) ].pose = value.humanPose;

			} );
			for ( const entry of preset.snapshot.materials?.[ mapped.instanceId ] || [] ) {

				let mesh = object; for ( const index of entry.path ) mesh = mesh.children[ index ];
				document.scene.materials[ `${objectPaths.get( mesh )}:${entry.slot}` ] = clone( entry.state );

			}

		}

	}

	document.scene.lights = appearance.lights.map( ( light, index ) => ( { ...clone( light ), uuid: `seed-light-${index}` } ) );
	const snapshot = preset.snapshot, camera = snapshot.camera;
	const settings = new RenderSettings();
	document.render = { engine: { ...settings.getAll(), ...snapshot.rasterAppearance, ...camera.lens, enablePathTracer: false, autoExposure: false, exposure: camera.exposure, enableGroundCatcher: false, groundProjectionEnabled: false, environmentIntensity: snapshot.environment.intensity, environmentRotation: snapshot.environment.rotation[ 1 ] * 180 / Math.PI }, ui: { enablePathTracer: false, environmentMode: 'hdri', canvasWidth: 1920, canvasHeight: 1080 } };
	document.cameras = { activeIndex: 0, active: cameraState( camera ), cameras: [], autoFocusMode: camera.lens.autoFocusMode, afScreenPoint: { x: camera.lens.afScreenPoint[ 0 ], y: camera.lens.afScreenPoint[ 1 ] }, afSmoothingFactor: camera.lens.afSmoothingFactor, ui: { ...camera.lens, afScreenPoint: { x: camera.lens.afScreenPoint[ 0 ], y: camera.lens.afScreenPoint[ 1 ] }, frameOverlayRatio: camera.frameOverlayRatio } };
	document.workspace.activeTab = 'presets';
	document.led = snapshot.ledWalls.map( wall => ( {
		wallInstanceId: 'seed-led', brightnessNits: wall.brightnessNits, loop: wall.loop,
		placement: { ...wall.placement, position: { x: wall.placement.position[ 0 ], y: wall.placement.position[ 1 ] }, scale: { x: wall.placement.scale[ 0 ], y: wall.placement.scale[ 1 ] } },
		video: wall.media ? { assetId: wall.media.assetId, name: 'timecode.mp4', type: 'video/mp4', size: preset.assets[ assetVersionKey( wall.media ) ].byteLength, lastModified: 0, currentTime: wall.inPointUs / 1e6 } : null,
	} ) );
	// Local authoring metadata permits exact byte relinking after admin hydration.
	document.extensions.localPresetMedia = Object.fromEntries( snapshot.ledWalls.filter( wall => wall.media ).map( wall => [ 'seed-led', wall.media ] ) );
	return document;

}

async function seed( repository ) {

	if ( ! import.meta.env.DEV ) return;
	const { MODEL_FILES } = await import( '../../Constants.js' );
	const missing = [];
	for ( const descriptor of descriptors ) {

		const existing = await repository.get( `studio-camera-${descriptor[ 0 ]}` );
		if ( ! existing ) {

			if ( ! await repository.isDeleted?.( `studio-camera-${descriptor[ 0 ]}` ) ) missing.push( descriptor );
			continue;

		}

		// Repair only untouched development seeds from this implementation's
		// initial review. Edited/renamed presets and student shots are retained.
		if ( existing.revision === 0 && existing.adminDocument.scene.assets.every( asset => asset.instanceId.startsWith( 'seed-' ) ) ) {

			const updated = clone( existing.adminDocument );
			for ( const asset of updated.scene.assets ) asset.assetVersion = MODEL_FILES.find( item => item.id === asset.catalogId )?.assetVersion || asset.assetVersion;
			for ( const camera of [ updated.cameras.active, ...updated.cameras.cameras ] ) if ( Array.isArray( camera.effects?.afScreenPoint ) ) camera.effects.afScreenPoint = { x: camera.effects.afScreenPoint[ 0 ], y: camera.effects.afScreenPoint[ 1 ] };
			if ( Array.isArray( updated.cameras.ui?.afScreenPoint ) ) updated.cameras.ui.afScreenPoint = { x: updated.cameras.ui.afScreenPoint[ 0 ], y: updated.cameras.ui.afScreenPoint[ 1 ] };
			updated.render.ui = { ...updated.render.ui, enablePathTracer: false, environmentMode: 'hdri', canvasWidth: 1920, canvasHeight: 1080 };
			if ( JSON.stringify( updated ) !== JSON.stringify( existing.adminDocument ) ) try {

				await repository.save( { ...existing, adminDocument: updated }, { expectedRevision: existing.revision } );

			} catch ( error ) {

				if ( error.code !== 'REVISION_CONFLICT' ) throw error;

			}

		}

	}

	if ( ! missing.length ) return;
	const [ demoModule, { default: prepared }, { default: appearance }, { createPublishedShotViewport } ] = await Promise.all( [ import( '../../student/demo/StudentDemo.js' ), import( '../../student/demo/studio-review.preset.json' ), import( '../../student/demo/admin-appearance.json' ), import( '../../student/PublishedShotViewport.js' ) ] );
	const { document, catalogue } = await demoModule.createStudentDemoProject( { matchAdmin: true } );
	const assets = document.assets, assetBlobs = [];
	for ( const asset of Object.values( assets ) ) assetBlobs.push( { asset, blob: new Blob( [ await catalogue.getAssetBytes( asset ) ], { type: asset.mimeType } ) } );
	const definition = prepared.sceneDefinition;
	let loaded, viewport;
	try {

		loaded = await loadVerifiedStudentScene( { assets: Object.fromEntries( definition.baseScene.assets.map( ref => [ assetVersionKey( ref ), assets[ assetVersionKey( ref ) ] ] ) ), baseScene: definition.baseScene, models: definition.models.map( model => ( { ...model, source: `/v1/catalogue/assets/${model.asset.assetId}/${model.asset.version}` } ) ) }, { fetchBytes: async ( source, { asset } ) => new Uint8Array( await assetBlobs.find( item => assetVersionKey( item.asset ) === assetVersionKey( asset ) ).blob.arrayBuffer() ) } );
		viewport = await createPublishedShotViewport( { document, shotId: 'wide', catalogue } );
		viewport.setInteractive( false );
		for ( const [ id, name, position ] of missing ) {

			const shot = position ? createCameraShotEdit( document.shots.wide, { position, target: [ 0, 1.2, 0 ], fov: 48, exposure: document.shots.wide.snapshot.camera.exposure, frameOverlayRatio: '16:9' } ) : clone( document.shots[ id ] );
			const preview = clone( document ); preview.shots.wide = { ...shot, shotId: 'wide' };
			await viewport.updateDocument( preview, 'wide' ); await viewport.renderFrame( 0 );
			const canvas = globalThis.document.createElement( 'canvas' ); canvas.width = 480; canvas.height = 270;
			canvas.getContext( '2d' ).drawImage( viewport.canvas, 0, 0, 480, 270 );
			const thumbnail = await new Promise( resolve => canvas.toBlob( resolve, 'image/jpeg', 0.85 ) );
			if ( ! thumbnail ) throw new Error( 'The preset thumbnail could not be captured.' );
			const studentPreset = { ...clone( prepared ), presetId: `studio-camera-${id}`, version: '1', name, description: 'Studio scene preset', assets: clone( assets ), snapshot: clone( shot.snapshot ), baseScene: clone( document.baseScenes[ baseSceneVersionKey( shot.baseScene ) ] ) };
			try {

				await repository.save( { presetId: studentPreset.presetId, name, adminDocument: createSeedAdminDocument( studentPreset, loaded, appearance, MODEL_FILES ), studentPreset, thumbnail, assetBlobs }, { expectedRevision: null } );

			} catch ( error ) {

				if ( error.code !== 'REVISION_CONFLICT' ) throw error;

			}

		}

	} finally {

		await viewport?.dispose(); loaded?.dispose();

	}

}

export function ensureLocalPresetSeeds( { repository = getLocalPresetRepository() } = {} ) {

	if ( ! pending.has( repository ) ) pending.set( repository, seed( repository ).catch( error => {

		pending.delete( repository ); throw error;

	} ) );
	return pending.get( repository );

}
