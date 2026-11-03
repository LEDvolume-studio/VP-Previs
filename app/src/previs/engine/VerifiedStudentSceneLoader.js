import { Group } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareRasterMaterial } from '../../../../rayzee/src/Processor/RasterMaterialPreparation.js';
import { assetVersionKey, baseSceneVersionKey, createStudentProjectDocument, validateStudentProjectDocument } from '../domain/StudentProjectSchema.js';

import { MAX_STUDENT_MODEL_BYTES as MAX_MODEL_BYTES, MAX_STUDENT_SCENE_BYTES as MAX_SCENE_BYTES } from '../domain/StudentSceneDefinition.js';
import { validateSceneModelBytes } from './SupportedGLB.js';
const fail = message => {

	throw new Error( `Verified student scene: ${message}` );

};

const checkAbort = signal => {

	if ( signal?.aborted ) throw new DOMException( 'Scene loading cancelled.', 'AbortError' );

};

const freeze = value => {

	if ( value && typeof value === 'object' ) {

		Object.values( value ).forEach( freeze ); Object.freeze( value );

	}

	return value;

};

async function fetchBundledBytes( source, { signal, byteLength } ) {

	const response = await globalThis.fetch( source, { signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' } );
	if ( ! response.ok || ! response.body ) fail( 'bundled model could not be read' );
	const reader = response.body.getReader();
	const bytes = new Uint8Array( byteLength );
	let offset = 0;
	try {

		while ( true ) {

			checkAbort( signal );
			const { done, value } = await reader.read();
			if ( done ) break;
			if ( offset + value.byteLength > byteLength ) fail( 'model exceeds immutable manifest size' );
			bytes.set( value, offset );
			offset += value.byteLength;

		}

		if ( offset !== byteLength ) fail( 'model does not match immutable manifest size' );
		return bytes;

	} finally {

		await reader.cancel().catch( () => {} );
		reader.releaseLock();

	}

}

function createResourceOwner() {

	const resources = new Set();
	const disposed = new Set();
	const images = new Set();
	const remember = value => {

		if ( ! value ) return;
		if ( Array.isArray( value ) ) {

			value.forEach( remember ); return;

		}

		if ( value.isObject3D ) {

			resources.add( value );
			value.traverse( object => {

				remember( object.geometry ); remember( object.material ); if ( object.skeleton ) resources.add( object.skeleton );

			} );

		} else if ( value.isMaterial ) {

			resources.add( value );
			for ( const property of Object.values( value ) ) if ( property?.isTexture ) resources.add( property );

		} else if ( value.isBufferGeometry || value.isTexture ) resources.add( value );

	};

	return {
		remember,
		dispose() {

			// Refresh traversals: an owned preparation service may clone geometry or
			// replace material textures after parsing. Both original and current
			// allocations belong to this load; shared allocations dispose once.
			for ( const resource of [ ...resources ] ) remember( resource );
			const errors = [];
			for ( const resource of resources ) {

				if ( disposed.has( resource ) ) continue;
				disposed.add( resource );
				if ( resource.isObject3D ) continue;
				try {

					resource.dispose?.();

				} catch ( error ) {

					errors.push( error );

				}

				if ( resource.isTexture && resource.image?.close && ! images.has( resource.image ) ) {

					images.add( resource.image );
					try {

						resource.image.close();

					} catch ( error ) {

						errors.push( error );

					}

				}

			}

			if ( errors.length ) throw new AggregateError( errors, 'Student model resource cleanup failed.' );

		},
	};

}

/** App-owned, immutable-byte model loading. Source locations are runtime-only;
 * a trusted host registry supplies this manifest, never imported project JSON.
 * Embedded assets only: no decoder workers or external resource requests.
 */
export async function loadVerifiedStudentScene( manifest, { signal, fetchBytes = fetchBundledBytes, createGLTFLoader = () => new GLTFLoader() } = {} ) {

	checkAbort( signal );
	const input = structuredClone( manifest );
	const validation = createStudentProjectDocument( { projectId: 'scene-loader-validation' } );
	validation.assets = input.assets;
	validation.baseScenes = { [ baseSceneVersionKey( input.baseScene ) ]: input.baseScene };
	validateStudentProjectDocument( validation );
	if ( ! Array.isArray( input.models ) || ! input.models.length || typeof fetchBytes !== 'function' || typeof createGLTFLoader !== 'function' ) fail( 'model inventory and loader callbacks are required' );
	const assetKeys = Object.keys( input.assets );
	const baseKeys = input.baseScene.assets.map( assetVersionKey );
	const modelKeys = input.models.map( model => assetVersionKey( model.asset ) );
	if ( assetKeys.length !== baseKeys.length || new Set( baseKeys ).size !== baseKeys.length || assetKeys.some( key => ! baseKeys.includes( key ) ) || modelKeys.length !== assetKeys.length || new Set( modelKeys ).size !== modelKeys.length || modelKeys.some( key => ! assetKeys.includes( key ) ) ) fail( 'models must exactly cover the immutable base-scene asset inventory' );
	let total = 0;
	const stableIds = new Set();
	for ( const model of input.models ) {

		const asset = input.assets[ assetVersionKey( model.asset ) ];
		if ( asset.kind !== 'model' || asset.mimeType !== 'model/gltf-binary' || asset.byteLength > MAX_MODEL_BYTES ) fail( 'only bounded binary model assets are supported' );
		total += asset.byteLength;
		if ( total > MAX_SCENE_BYTES ) fail( 'scene exceeds the local loader memory limit' );
		if ( typeof model.source !== 'string' || ! ( /^\/[A-Za-z0-9_./-]+\.glb$/.test( model.source ) || /^\/v1\/catalogue\/assets\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test( model.source ) ) || model.source.startsWith( '//' ) || model.source.split( '/' ).includes( '..' ) ) fail( 'a bundled or catalogue absolute model path is required' );
		if ( ! Array.isArray( model.nodes ) || ! model.nodes.length ) fail( 'complete explicit node mappings are required' );
		const nodeIds = new Set();
		for ( const node of model.nodes ) {

			if ( typeof node.instanceId !== 'string' || ! node.instanceId || typeof node.nodeId !== 'string' || ! node.nodeId || stableIds.has( node.instanceId ) || nodeIds.has( node.nodeId ) ) fail( 'node IDs must map uniquely within each immutable version and scene instance' );
			stableIds.add( node.instanceId );
			nodeIds.add( node.nodeId );

		}

	}

	const owner = createResourceOwner();
	const sceneRoot = new Group();
	sceneRoot.name = 'Student immutable scene';
	const nodeObjects = new Map();
	const bindingNodes = [];
	let ready = false;
	let publishedBinding;
	const dispose = () => {

		ready = false;
		owner.remember( sceneRoot );
		try {

			owner.dispose();

		} finally {

			sceneRoot.removeFromParent(); sceneRoot.clear();

		}

	};

	try {

		for ( const model of input.models ) {

			checkAbort( signal );
			const asset = input.assets[ assetVersionKey( model.asset ) ];
			const loaded = await fetchBytes( model.source, { signal, byteLength: asset.byteLength, asset: freeze( structuredClone( asset ) ) } );
			checkAbort( signal );
			const source = loaded instanceof Uint8Array ? loaded : loaded instanceof ArrayBuffer ? new Uint8Array( loaded ) : null;
			if ( ! source || source.byteLength !== asset.byteLength ) fail( 'model does not match immutable manifest size' );
			const bytes = new Uint8Array( source );
			const hash = Array.from( new Uint8Array( await globalThis.crypto.subtle.digest( 'SHA-256', bytes ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			checkAbort( signal );
			if ( hash !== asset.sha256 ) fail( 'model does not match immutable manifest hash' );
			const json = validateSceneModelBytes( model, bytes );

			const loader = createGLTFLoader();
			const pending = [];
			loader.register( parser => ( {
				name: 'RayzeeVerifiedResourceOwnership',
				beforeRoot() {

					// Track every individual dependency, including successful siblings
					// when another dependency rejects. Drain them before cleanup.
					for ( const [ type, plural ] of [[ 'scene', 'scenes' ], [ 'mesh', 'meshes' ], [ 'material', 'materials' ], [ 'texture', 'textures' ]] ) for ( let index = 0; index < ( parser.json[ plural ] || [] ).length; index ++ ) {

						const promise = parser.getDependency( type, index ).then( value => {

							owner.remember( value );

						} );
						pending.push( promise );
						promise.catch( () => {} );

					}

				},
			} ) );
			let gltf;
			let parseError;
			try {

				gltf = await loader.parseAsync( bytes.buffer, '' );

			} catch ( error ) {

				parseError = error;

			}

			const settled = await Promise.allSettled( pending );
			if ( parseError ) throw parseError;
			if ( settled.some( result => result.status === 'rejected' ) ) throw settled.find( result => result.status === 'rejected' ).reason;

			owner.remember( gltf.scenes );
			checkAbort( signal );
			// Admin performs this during GeometryExtractor processing even in
			// raster mode. Students do not build its path-tracing geometry/BVH.
			gltf.scene.traverse( object => {

				if ( object.isMesh ) for ( const material of Array.isArray( object.material ) ? object.material : [ object.material ] ) if ( material ) prepareRasterMaterial( material );

			} );
			const objects = new Map();
			gltf.scene.traverse( object => {

				if ( object.isCamera || object.isLight ) fail( 'unmapped embedded camera or light' );
				const index = gltf.parser.associations.get( object )?.nodes;
				if ( index === undefined ) return;
				if ( objects.has( index ) ) fail( 'multiple loaded objects map to the same immutable node' );
				objects.set( index, object );

			} );
			if ( objects.size !== json.nodes.length ) fail( 'loaded node inventory differs from the immutable mapping' );
			sceneRoot.add( gltf.scene );
			for ( const mapped of model.nodes ) {

				const object = mapped.gltfNodeIndex === null ? gltf.scene : objects.get( mapped.gltfNodeIndex );
				if ( ! object || [ ...nodeObjects.values() ].includes( object ) ) fail( 'node mapping is missing or ambiguous' );
				nodeObjects.set( mapped.instanceId, object );
				bindingNodes.push( { instanceId: mapped.instanceId, asset: model.asset, nodeId: mapped.nodeId } );

			}

		}

		sceneRoot.updateMatrixWorld( true );
		ready = true;
		publishedBinding = freeze( { get ready() {

			return ready;

		}, baseScene: { sceneId: input.baseScene.sceneId, version: input.baseScene.version }, assets: input.baseScene.assets, nodes: bindingNodes, lights: [], ledWalls: [] } );
		const expectedMapping = new Map( nodeObjects );
		const assertReady = () => {

			if ( ! ready || nodeObjects.size !== publishedBinding.nodes.length ) fail( 'scene binding has been disposed or altered' );
			for ( const [ id, object ] of expectedMapping ) if ( nodeObjects.get( id ) !== object || sceneRoot.getObjectById( object.id ) !== object ) fail( 'scene binding is stale; reload the immutable scene' );
			return publishedBinding;

		};

		return { sceneRoot, nodeObjects, lightObjects: new Map(), assets: freeze( input.assets ), baseScene: freeze( input.baseScene ), binding: publishedBinding, assertReady, trackResources: owner.remember, dispose };

	} catch ( error ) {

		try {

			dispose();

		} catch ( cleanupError ) {

			throw new AggregateError( [ error, cleanupError ], 'Scene loading and cleanup failed.' );

		}

		throw error;

	}

}
