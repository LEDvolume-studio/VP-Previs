import { createThreeShotPorts } from '../../previs/engine/ThreeShotPorts.js';
import { loadVerifiedStudentScene } from '../../previs/engine/VerifiedStudentSceneLoader.js';
import { captureRasterAppearance } from '../../previs/engine/RasterAppearance.js';
import { loadVerifiedStudentEnvironment } from '../../previs/engine/VerifiedStudentEnvironment.js';
import { inspectSupportedGLB, validatePresetModelBytes } from '../../previs/engine/SupportedGLB.js';
import { MAX_STUDENT_MODEL_BYTES, MAX_STUDENT_SCENE_BYTES } from '../../previs/domain/StudentSceneDefinition.js';
import { validateStudentPresetVersion } from '../../previs/domain/StudentCatalogueSchema.js';
import { assetVersionKey } from '../../previs/domain/StudentProjectSchema.js';
import { serializeMaterial, TEXTURE_SLOTS } from '../projects/MaterialState.js';
import { mannequinPose, prepareMannequin } from '../../utils/mannequinPoses.js';

const fail = message => {

	throw new Error( `Cannot save student preset: ${message}` );

};

const abort = signal => signal?.throwIfAborted();
const digest = async bytes => Array.from( new Uint8Array( await globalThis.crypto.subtle.digest( 'SHA-256', bytes ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const reference = asset => ( { assetId: asset.assetId, version: asset.version } );
const transform = object => ( { position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), visible: object.visible } );
const same = ( a, b ) => JSON.stringify( a ) === JSON.stringify( b );
const rear = object => object.userData?.rayzeeLEDDisplay?.role === 'black-rear-surface';
const lightType = light => ( { AmbientLight: 'ambient', DirectionalLight: 'directional', PointLight: 'point', SpotLight: 'spot', RectAreaLight: 'rectArea', HemisphereLight: 'hemisphere' } )[ light.type ];

function compareAttribute( original, current, convert = value => value, packed = false ) {

	if ( ! original || ! current || original.count !== current.count || original.itemSize !== current.itemSize || ( ! packed && original.normalized !== current.normalized ) ) return false;
	const getters = [ 'getX', 'getY', 'getZ', 'getW' ];
	if ( original.itemSize > getters.length ) return false;
	for ( let index = 0; index < original.count; index ++ ) for ( let component = 0; component < original.itemSize; component ++ ) {

		let expected = convert( original[ getters[ component ] ]( index ), component );
		if ( packed ) expected = Math.round( Math.max( - 1, Math.min( 1, expected ) ) * 32767 ) / 32767;
		if ( Math.abs( expected - current[ getters[ component ] ]( index ) ) > 1e-5 ) return false;

	}

	return true;

}

function compareGeometry( baseline, current, ledDefinition ) {

	if ( ! baseline || ! current || ! same( Object.keys( baseline.attributes ).sort(), Object.keys( current.attributes ).sort() ) || ! same( baseline.groups, current.groups ) || ! same( baseline.drawRange, current.drawRange ) ) fail( 'edited geometry requires a new supported model asset.' );
	if ( Boolean( baseline.index ) !== Boolean( current.index ) || ( baseline.index && ! compareAttribute( baseline.index, current.index ) ) ) fail( 'edited model indices are unsupported.' );
	for ( const [ name, attribute ] of Object.entries( baseline.attributes ) ) {

		const selectedUV = ledDefinition && name === ( ledDefinition.uvChannel ? `uv${ledDefinition.uvChannel}` : 'uv' );
		const convert = selectedUV ? ( value, component ) => {

			const bounds = ledDefinition.uvBounds;
			if ( component === 0 ) return ledDefinition.flipU ? ( bounds.maxU - value ) / ( bounds.maxU - bounds.minU ) : ( value - bounds.minU ) / ( bounds.maxU - bounds.minU );
			return ( value - bounds.minV ) / ( bounds.maxV - bounds.minV );

		} : undefined;
		// Admin extraction packs these exact float attributes to snorm16 in
		// place. Compare the known quantization, not its raw storage format.
		const actual = current.attributes[ name ];
		const packed = [ 'normal', 'tangent', 'color' ].includes( name ) && ! attribute.normalized && attribute.array instanceof Float32Array && actual?.normalized && actual.array instanceof Int16Array;
		if ( ! compareAttribute( attribute, actual, convert, packed ) ) fail( `edited ${name} geometry requires a new supported model asset.` );

	}

}

function imagePixels( image ) {

	if ( ! image || ! Number.isSafeInteger( image.width ) || ! Number.isSafeInteger( image.height ) || image.width < 1 || image.height < 1 || image.width * image.height > 16 * 1024 * 1024 ) fail( 'a bounded readable embedded texture image is required.' );
	if ( image.data && ArrayBuffer.isView( image.data ) ) return new Uint8Array( image.data.buffer, image.data.byteOffset, image.data.byteLength );
	const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas( image.width, image.height ) : globalThis.document?.createElement( 'canvas' );
	if ( ! canvas ) fail( 'embedded texture verification needs Canvas2D.' );
	canvas.width = image.width; canvas.height = image.height;
	try {

		const context = canvas.getContext( '2d', { willReadFrequently: true } );
		if ( ! context ) fail( 'embedded texture verification needs Canvas2D.' );
		context.drawImage( image, 0, 0 );
		return context.getImageData( 0, 0, image.width, image.height ).data;

	} catch {

		fail( 'the current texture image cannot be verified against its embedded model image.' );

	} finally {

		canvas.width = 0; canvas.height = 0;

	}

}

async function captureMaterial( material, baseline, imageHashes ) {

	if ( ! material || ! baseline || material.type !== baseline.type || ! [ 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial' ].includes( material.type ) || material.isNodeMaterial || material.onBeforeCompile?.toString() !== baseline.onBeforeCompile?.toString() ) fail( 'custom material shaders or changed material types require another supported capability.' );
	for ( const property of [ 'blending', 'blendSrc', 'blendDst', 'blendEquation', 'depthTest', 'depthWrite', 'colorWrite', 'toneMapped', 'vertexColors', 'flatShading', 'wireframe', 'premultipliedAlpha', 'alphaHash', 'alphaToCoverage', 'forceSinglePass', 'normalMapType', 'aoMapIntensity', 'lightMapIntensity', 'envMapIntensity', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits' ] ) if ( material[ property ] !== baseline[ property ] ) fail( `material ${property} changes are not portable yet.` );
	const hashImage = async image => {

		if ( ! imageHashes.has( image ) ) imageHashes.set( image, digest( imagePixels( image ) ) );
		return imageHashes.get( image );

	};

	for ( const property of Object.keys( material ) ) if ( material[ property ]?.isTexture && ! TEXTURE_SLOTS.includes( property ) ) fail( `material texture slot ${property} is unsupported.` );
	for ( const slot of TEXTURE_SLOTS ) {

		const texture = material[ slot ], original = baseline[ slot ];
		if ( ! texture ) continue;
		if ( ! original || texture.isVideoTexture || texture.isCanvasTexture || texture.isRenderTargetTexture ) fail( 'only the model’s embedded material images are supported.' );
		for ( const property of [ 'mapping', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy', 'format', 'type', 'colorSpace', 'generateMipmaps', 'premultiplyAlpha', 'unpackAlignment', 'matrixAutoUpdate' ] ) if ( texture[ property ] !== original[ property ] ) fail( `changed embedded texture ${property} is not portable yet.` );
		if ( texture.image?.width !== original.image?.width || texture.image?.height !== original.image?.height || await hashImage( texture.image ) !== await hashImage( original.image ) ) fail( 'a replaced or resized texture image requires a new model asset.' );

	}

	const state = serializeMaterial( material );
	if ( state.catalogMaterial ) fail( 'external catalogue material assignments require embedded model assets.' );
	return state;

}

/** Capture native admin state without modifying the editor, stores or source document.
 * Every model is pinned to freshly checked catalogue GLB bytes. Unsupported
 * hierarchy, image, shader and render edits fail before the repository commits.
 */
export async function captureAdminPreset( { app, source, modelFiles, environment, ledManager, cameraMetadata, loadBlob, signal, playingWalls } ) {

	abort( signal );
	const sceneRoot = app?.getScene?.() || app?.meshScene;
	if ( ! sceneRoot?.isObject3D || ! Array.isArray( source?.scene?.assets ) || ! Array.isArray( modelFiles ) || typeof loadBlob !== 'function' ) fail( 'a ready admin scene and trusted model catalogue are required.' );
	if ( ( app.environmentManager?.envParams?.mode ?? app.settings.get( 'environmentMode' ) ) !== 'hdri' ) fail( 'only the existing HDRI environment mode is supported.' );
	const rasterAppearance = captureRasterAppearance( { settings: app.settings, renderer: app.renderer, realtimeRenderer: app.realtimeRenderer } );
	const roots = sceneRoot.children.filter( object => object.userData?.__rayzeeProjectInstanceId );
	if ( ! roots.length || roots.length > 64 || roots.length !== source.scene.assets.length ) fail( 'all scene model roots must resolve to catalogue assets.' );
	if ( sceneRoot.children.some( object => ! roots.includes( object ) && object !== app.assetLoader?.floorPlane && ( object.isMesh || object.children?.length ) ) ) fail( 'the scene contains an unregistered model or helper hierarchy.' );
	if ( app.assetLoader?.floorPlane?.visible ) fail( 'the editor ground helper must be hidden; use an authored floor model.' );
	const assets = {}, assetBlobs = [], models = [], nodes = {}, materials = {}, nodeObjects = new Map(), ledWalls = [], humanPoseRoots = [], mediaBindings = {};
	const modelBytes = new Map(), imageHashes = new WeakMap();
	let totalModelBytes = 0;
	async function pin( blob, { assetId, kind, mimeType, durationUs = null, maximum } ) {

		abort( signal );
		if ( ! ( blob instanceof Blob ) || blob.size < 1 || blob.size > maximum ) fail( `a complete bounded ${kind} file is required.` );
		const bytes = new Uint8Array( await blob.arrayBuffer() );
		const sha256 = await digest( bytes );
		abort( signal );
		const asset = { assetId: assetId ? `${assetId}-${sha256}` : `admin-${kind}-${sha256}`, version: '1', kind, sha256, byteLength: blob.size, mimeType, durationUs };
		assets[ assetVersionKey( asset ) ] = asset;
		assetBlobs.push( { asset, blob: blob.slice( 0, blob.size, mimeType ) } );
		return { asset, bytes };

	}

	for ( const [ modelIndex, root ] of roots.entries() ) {

		abort( signal );
		const saved = source.scene.assets.find( entry => entry.instanceId === root.userData.__rayzeeProjectInstanceId );
		const catalog = modelFiles.find( entry => entry.id === root.userData.__rayzeeCatalogId );
		if ( ! saved || ! catalog || saved.catalogId !== catalog.id || ( saved.assetVersion || 1 ) !== ( catalog.assetVersion || 1 ) || ! /\.glb(?:\?|$)/i.test( catalog.url || '' ) ) fail( 'a scene model no longer matches its trusted catalogue version.' );
		const modelBlob = await loadBlob( catalog.url, { signal, maximumBytes: MAX_STUDENT_MODEL_BYTES } );
		const { asset, bytes } = await pin( modelBlob, { assetId: `admin-model-${modelIndex}`, kind: 'model', mimeType: 'model/gltf-binary', maximum: MAX_STUDENT_MODEL_BYTES } );
		totalModelBytes += asset.byteLength;
		if ( totalModelBytes > MAX_STUDENT_SCENE_BYTES ) fail( 'the complete scene exceeds the supported model memory limit.' );
		const json = inspectSupportedGLB( bytes );
		const assetRef = reference( asset ), rootId = `model-${modelIndex}-root`;
		const mapping = { asset: assetRef, nodes: [ { instanceId: rootId, nodeId: 'root', gltfNodeIndex: null, expectedName: null }, ...json.nodes.map( ( node, index ) => ( { instanceId: `model-${modelIndex}-node-${index}`, nodeId: `node-${index}`, gltfNodeIndex: index, expectedName: node.name || '' } ) ) ] };
		models.push( mapping ); modelBytes.set( assetVersionKey( assetRef ), bytes );
		let verified;
		try {

			verified = await loadVerifiedStudentScene( {
				assets: { [ assetVersionKey( asset ) ]: asset }, baseScene: { sceneId: 'capture-baseline', version: '1', assets: [ assetRef ] },
				models: [ { ...mapping, source: `/v1/catalogue/assets/${asset.assetId}/${asset.version}` } ],
			}, { signal, fetchBytes: async () => bytes } );
			abort( signal );
			const baselineRoot = verified.nodeObjects.get( rootId );
			const baselineMappings = new Map( mapping.nodes.map( mapped => [ verified.nodeObjects.get( mapped.instanceId ), mapped ] ) );
			const pose = mannequinPose( root );
			if ( pose !== null ) {

				if ( ! [ 'standing', 'sitting' ].includes( pose ) || ! prepareMannequin( baselineRoot, pose ) ) fail( 'the current human pose is unsupported.' );
				humanPoseRoots.push( rootId );

			}

			const indices = new Set();
			const ledMetadata = root.userData.rayzeeLED;
			const display = ledMetadata?.isLEDVolume ? ledManager?.getRecord( root )?.displayMesh : null;
			if ( ledMetadata?.isLEDVolume && ( ! catalog.led || ! display ) ) fail( 'the LED display is not ready.' );
			let displayId;
			const walk = async ( baseline, object, anchor = rootId, path = [] ) => {

				abort( signal );
				if ( ! object || Boolean( baseline.isMesh ) !== Boolean( object.isMesh ) || Boolean( baseline.isSkinnedMesh ) !== Boolean( object.isSkinnedMesh ) || Boolean( baseline.isBone ) !== Boolean( object.isBone ) || object.isCamera || object.isLight || object.matrixWorldAutoUpdate === false ) fail( 'the model hierarchy differs from its pinned GLB.' );
				if ( ! same( baseline.morphTargetInfluences, object.morphTargetInfluences ) || ( baseline.isSkinnedMesh && ( ! same( baseline.bindMatrix.toArray(), object.bindMatrix.toArray() ) || baseline.bindMode !== object.bindMode ) ) ) fail( 'unsupported morph or skin binding edits require a new model capability.' );
				const mapped = baselineMappings.get( baseline );
				if ( mapped ) {

					if ( ! mapped || indices.has( mapped.instanceId ) ) fail( 'the GLB node inventory is ambiguous.' );
					indices.add( mapped.instanceId ); anchor = mapped.instanceId; path = [];
					nodeObjects.set( anchor, object );
					nodes[ anchor ] = { asset: assetRef, nodeId: mapped.nodeId, transform: transform( object ), humanPose: baseline === baselineRoot ? pose : null, doorAngles: {} };

				} else if ( ! same( transform( baseline ), transform( object ) ) ) fail( 'transforms on unmapped model primitives are unsupported.' );
				if ( baseline.isMesh ) {

					compareGeometry( baseline.geometry, object.geometry, object === display ? catalog.led : null );
					if ( object === display ) {

						if ( mapped?.gltfNodeIndex == null ) fail( 'the LED display must be an explicitly mapped GLB node.' );
						displayId = anchor;

					} else {

						const current = Array.isArray( object.material ) ? object.material : [ object.material ];
						const original = Array.isArray( baseline.material ) ? baseline.material : [ baseline.material ];
						if ( current.length !== original.length ) fail( 'the model material slot inventory changed.' );
						materials[ anchor ] ||= [];
						for ( const [ slot, material ] of current.entries() ) {

							materials[ anchor ].push( { path: [ ...path ], slot, state: await captureMaterial( material, original[ slot ], imageHashes ) } );

						}

					}

				}

				const children = object.children.filter( child => ! ( object === display && rear( child ) ) );
				if ( children.length !== baseline.children.length || ( object !== display && object.children.some( rear ) ) ) fail( 'the model contains an unsupported added or removed child.' );
				for ( const [ childIndex, child ] of baseline.children.entries() ) await walk( child, children[ childIndex ], anchor, [ ...path, childIndex ] );

			};

			await walk( baselineRoot, root );
			if ( indices.size !== mapping.nodes.length ) fail( 'the complete GLB node inventory could not be mapped.' );
			if ( display ) {

				const live = ledManager.getSnapshot( root ), record = ledManager.getRecord( root );
				if ( ! displayId || ! live || live.seeking || [ 'loading', 'error', 'missing' ].includes( live.status ) ) fail( 'finish loading or reconnect the LED video before saving.' );
				let media = null;
				if ( ledMetadata.videoSource || record.file ) {

					if ( ! record.file || ! [ 'video/mp4', 'video/webm' ].includes( record.file.type ) || ! Number.isFinite( live.duration ) || live.duration <= 0 ) fail( 'the LED video bytes and decoded duration must be available as MP4 or WebM.' );
					media = reference( ( await pin( record.file, { kind: 'video', mimeType: record.file.type, durationUs: Math.round( live.duration * 1000000 ), maximum: 128 * 1024 * 1024 } ) ).asset );

				}

				mediaBindings[ saved.instanceId ] = media;
				const placement = ledMetadata.videoPlacementTransform, bounds = catalog.led.uvBounds;
				ledWalls.push( {
					wallId: `wall-${modelIndex}`, presentationVersion: 1, nodeInstanceId: displayId, media, mode: media && ( playingWalls ? playingWalls.has( root.uuid ) : live.isPlaying ) ? 'play' : 'freeze', inPointUs: media ? Math.round( live.currentTime * 1000000 ) : 0,
					loop: Boolean( ledMetadata.loop ), playbackRate: record.video?.playbackRate || 1, brightnessNits: ledMetadata.currentBrightnessNits,
					placement: { position: [ placement.position.x, placement.position.y ], scale: [ placement.scale.x, placement.scale.y ], rotationDegrees: placement.rotationDegrees, aspectRatioLocked: placement.aspectRatioLocked, fitMode: placement.fitMode },
					surface: { nativeCanvas: [ catalog.led.nativeCanvas.width, catalog.led.nativeCanvas.height ], uvChannel: catalog.led.uvChannel, uvBounds: [ bounds.minU, bounds.maxU, bounds.minV, bounds.maxV ], flipU: Boolean( catalog.led.flipU ) },
				} );

			}

		} finally {

			verified?.dispose();

		}

	}

	let environmentAsset = null;
	if ( environment?.url ) {

		if ( source.scene.environment?.catalogId !== environment.id ) fail( 'the active HDRI does not match the trusted environment catalogue.' );
		const mimeType = /\.exr(?:\?|$)/i.test( environment.url ) ? 'image/x-exr' : /\.hdr(?:\?|$)/i.test( environment.url ) ? 'image/vnd.radiance' : null;
		if ( ! mimeType ) fail( 'only catalogue HDR and EXR environments are supported.' );
		const pinned = await pin( await loadBlob( environment.url, { signal, maximumBytes: 32 * 1024 * 1024 } ), { kind: 'environment', mimeType, maximum: 32 * 1024 * 1024 } );
		const expected = await loadVerifiedStudentEnvironment( pinned.asset, { getAssetBytes: async () => pinned.bytes }, { signal } );
		try {

			const current = app.realtimeRenderer.lightScene.environment || sceneRoot.environment || app.realtimeRenderer._environment;
			if ( ! current?.isTexture || current.type !== expected.type || current.image?.width !== expected.image.width || current.image?.height !== expected.image.height || await digest( imagePixels( current.image ) ) !== await digest( imagePixels( expected.image ) ) ) fail( 'the active HDRI differs from its catalogue bytes; reload the environment before saving.' );

		} finally {

			expected.dispose();

		}

		environmentAsset = reference( pinned.asset );

	} else if ( app.settings.get( 'enableEnvironment' ) || app.settings.get( 'showBackground' ) ) fail( 'the active environment must resolve to a trusted HDRI asset.' );
	const modelIdentity = await digest( new TextEncoder().encode( JSON.stringify( models ) ) );
	const baseScene = { sceneId: `local-admin-scene-${modelIdentity.slice( 0, 24 )}`, version: '1', assets: models.map( model => model.asset ) };
	const lightObjects = new Map();
	const canonicalLights = app.lightManager?.scene?.getObjectsByProperty( 'isLight', true ) || [];
	const lightBindings = canonicalLights.map( ( light, index ) => {

		const type = lightType( light ), lightId = `light-${index}`;
		if ( ! type ) fail( `unsupported native light type ${light.type}.` );
		lightObjects.set( lightId, light );
		return { lightId, type };

	} );
	const dummy = { read() {}, capture() {}, apply() {}, restore() {}, validate() {} };
	const ports = createThreeShotPorts( {
		binding: { ready: true, baseScene: { sceneId: baseScene.sceneId, version: baseScene.version }, assets: Object.values( assets ), nodes: Object.entries( nodes ).map( ( [ instanceId, node ] ) => ( { instanceId, asset: node.asset, nodeId: node.nodeId } ) ), lights: lightBindings, ledWalls: ledWalls.map( ( { wallId } ) => ( { wallId } ) ) },
		sceneRoot, nodeObjects, lightObjects, cameraManager: app.cameraManager, settings: app.settings, cameraMetadata, lightManager: app.lightManager,
		updateNodes() {}, pose: dummy, environment: dummy, media: dummy,
	} );
	const camera = ports.camera.read(); ports.camera.validate( camera );
	const lights = ports.lights.read(); ports.lights.validate( lights );
	const studentPreset = {
		format: 'rayzee-student-preset', schemaVersion: 2, presetId: 'capture', version: '1', name: source.name,
		description: '', category: 'Camera presets', defaultDurationFrames: 96, thumbnail: null,
		assets, baseScene, sceneDefinition: { format: 'rayzee-student-scene', schemaVersion: 1, baseScene, models, humanPoseRoots },
		snapshot: { camera, nodes, lights, materials, ledWalls, rasterAppearance, environment: { asset: environmentAsset, intensity: app.settings.get( 'environmentIntensity' ), rotation: [ 0, app.settings.get( 'environmentRotation' ) * Math.PI / 180, 0 ], background: rasterAppearance.showBackground } },
	};
	validateStudentPresetVersion( studentPreset );
	for ( const model of models ) validatePresetModelBytes( studentPreset, model, modelBytes.get( assetVersionKey( model.asset ) ) );
	abort( signal );
	return { studentPreset, assetBlobs, mediaBindings };

}
