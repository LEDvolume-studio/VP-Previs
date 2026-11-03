import { MAX_STUDENT_MODEL_BYTES, MAX_STUDENT_SCENE_NODES } from '../domain/StudentSceneDefinition.js';

export const MAX_DECODED_STUDENT_ACCESSOR_BYTES = 128 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set( [ 'KHR_materials_emissive_strength', 'KHR_mesh_quantization' ] );
const fail = message => {

	throw new Error( `Supported student GLB: ${message}` );

};

const record = value => value && typeof value === 'object' && ! Array.isArray( value );
const index = ( value, values ) => Number.isSafeInteger( value ) && value >= 0 && value < ( values?.length || 0 );

/** DOM-free container/capability preflight shared by publication and actual parsing.
 * This is a bounded supported-subset check, not a replacement for GLTFLoader.
 */
export function inspectSupportedGLB( input ) {

	const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array( input ) : null;
	if ( ! bytes || bytes.byteLength < 28 || bytes.byteLength > MAX_STUDENT_MODEL_BYTES ) fail( 'a complete bounded binary glTF 2 container is required' );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	if ( view.getUint32( 0, true ) !== 0x46546c67 || view.getUint32( 4, true ) !== 2 || view.getUint32( 8, true ) !== bytes.byteLength ) fail( 'a complete binary glTF 2 container is required' );
	const chunks = [];
	for ( let offset = 12; offset < bytes.byteLength; ) {

		if ( bytes.byteLength - offset < 8 ) fail( 'truncated glTF chunk header' );
		const length = view.getUint32( offset, true ), type = view.getUint32( offset + 4, true );
		if ( length % 4 || length > bytes.byteLength - offset - 8 ) fail( 'invalid glTF chunk size' );
		chunks.push( { offset: offset + 8, length, type } );
		offset += 8 + length;

	}

	if ( chunks.length !== 2 || chunks[ 0 ].type !== 0x4e4f534a || chunks[ 1 ].type !== 0x004e4942 ) fail( 'exactly one JSON chunk followed by one embedded BIN chunk is required' );
	let json;
	try {

		json = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes.subarray( chunks[ 0 ].offset, chunks[ 0 ].offset + chunks[ 0 ].length ) ) );

	} catch {

		fail( 'invalid glTF JSON chunk' );

	}

	if ( ! record( json ) || json.asset?.version !== '2.0' || ! Array.isArray( json.scenes ) || json.scenes.length !== 1 || ! record( json.scenes[ 0 ] ) || ! Array.isArray( json.nodes ) || ! json.nodes.length || json.nodes.length >= MAX_STUDENT_SCENE_NODES || ( json.scene !== undefined && json.scene !== 0 ) ) fail( 'one complete glTF 2 scene is required' );
	if ( json.animations?.length || json.cameras?.length || json.extensions?.KHR_lights_punctual ) fail( 'animated, embedded-camera and embedded-light models require another loader capability' );
	for ( const key of [ 'extensionsUsed', 'extensionsRequired' ] ) if ( json[ key ] !== undefined && ( ! Array.isArray( json[ key ] ) || json[ key ].some( name => ! SUPPORTED_EXTENSIONS.has( name ) ) ) ) fail( 'unsupported glTF extension' );
	if ( ! Array.isArray( json.buffers ) || json.buffers.length !== 1 || ! record( json.buffers[ 0 ] ) || json.buffers[ 0 ].uri !== undefined || ! Number.isSafeInteger( json.buffers[ 0 ].byteLength ) || json.buffers[ 0 ].byteLength < 1 || json.buffers[ 0 ].byteLength > chunks[ 1 ].length || chunks[ 1 ].length - json.buffers[ 0 ].byteLength > 3 || ( json.images !== undefined && ! Array.isArray( json.images ) ) || ( json.images || [] ).some( image => ! record( image ) || image.uri !== undefined || ! index( image.bufferView, json.bufferViews ) ) ) fail( 'only self-contained GLB buffers and images are supported' );
	for ( const bufferView of json.bufferViews || [] ) {

		if ( ! record( bufferView ) || bufferView.buffer !== 0 || ! Number.isSafeInteger( bufferView.byteLength ) || bufferView.byteLength < 1 || ! Number.isSafeInteger( bufferView.byteOffset ?? 0 ) || ( bufferView.byteOffset ?? 0 ) < 0 || ( bufferView.byteOffset ?? 0 ) + bufferView.byteLength > json.buffers[ 0 ].byteLength ) fail( 'buffer view lies outside the embedded binary data' );

	}

	let decodedBytes = 0;
	for ( const accessor of json.accessors || [] ) {

		const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[ accessor?.componentType ];
		const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[ accessor?.type ];
		if ( ! record( accessor ) || ! Number.isSafeInteger( accessor.count ) || accessor.count < 1 || ! componentBytes || ! components ) fail( 'invalid embedded accessor' );
		const columns = accessor.type.startsWith( 'MAT' ) ? Math.sqrt( components ) : 1;
		const elementBytes = columns > 1 ? columns * Math.ceil( columns * componentBytes / 4 ) * 4 : components * componentBytes;
		decodedBytes += accessor.count * elementBytes;
		if ( accessor.count * elementBytes > MAX_STUDENT_MODEL_BYTES || decodedBytes > MAX_DECODED_STUDENT_ACCESSOR_BYTES ) fail( 'decoded accessor inventory exceeds the supported memory limit' );
		const range = ( viewIndex, offset, count, size, strided = false ) => {

			if ( ! index( viewIndex, json.bufferViews ) || ! Number.isSafeInteger( offset ) || offset < 0 ) fail( 'accessor references missing embedded data' );
			const bufferView = json.bufferViews[ viewIndex ];
			const stride = strided ? bufferView.byteStride ?? size : size;
			if ( ! Number.isSafeInteger( stride ) || stride < size || ( strided && bufferView.byteStride !== undefined && ( stride > 252 || stride % 4 ) ) || offset + ( count - 1 ) * stride + size > bufferView.byteLength ) fail( 'accessor lies outside its embedded buffer view' );

		};

		if ( accessor.bufferView !== undefined ) range( accessor.bufferView, accessor.byteOffset ?? 0, accessor.count, elementBytes, true );
		else if ( accessor.byteOffset !== undefined ) fail( 'accessor offset requires a buffer view' );
		if ( accessor.sparse ) {

			const sparse = accessor.sparse;
			const sparseBytes = { 5121: 1, 5123: 2, 5125: 4 }[ sparse.indices?.componentType ];
			if ( ! sparseBytes || ! Number.isSafeInteger( sparse.count ) || sparse.count < 1 || sparse.count > accessor.count ) fail( 'invalid sparse accessor inventory' );
			range( sparse.indices.bufferView, sparse.indices.byteOffset ?? 0, sparse.count, sparseBytes );
			range( sparse.values?.bufferView, sparse.values?.byteOffset ?? 0, sparse.count, elementBytes );

		}

	}

	for ( const mesh of json.meshes || [] ) {

		if ( ! Array.isArray( mesh?.primitives ) || ! mesh.primitives.length ) fail( 'mesh requires complete primitives' );
		for ( const primitive of mesh.primitives ) {

			if ( ! record( primitive.attributes ) || ! Object.keys( primitive.attributes ).length || Object.values( primitive.attributes ).some( value => ! index( value, json.accessors ) ) || ( primitive.indices !== undefined && ! index( primitive.indices, json.accessors ) ) || ( primitive.material !== undefined && ! index( primitive.material, json.materials ) ) ) fail( 'mesh primitive references missing embedded data' );
			for ( const target of primitive.targets || [] ) if ( ! record( target ) || Object.values( target ).some( value => ! index( value, json.accessors ) ) ) fail( 'morph target references missing embedded data' );

		}

	}

	const visited = new Set();
	const pending = [ ...( json.scenes[ 0 ].nodes || [] ) ];
	if ( ! Array.isArray( json.scenes[ 0 ].nodes ) ) fail( 'a complete scene root inventory is required' );
	while ( pending.length ) {

		const nodeIndex = pending.pop();
		if ( ! index( nodeIndex, json.nodes ) || visited.has( nodeIndex ) || ! record( json.nodes[ nodeIndex ] ) ) fail( 'glTF hierarchy contains missing or multiply placed nodes' );
		visited.add( nodeIndex );
		const node = json.nodes[ nodeIndex ];
		if ( ( node.mesh !== undefined && ! index( node.mesh, json.meshes ) ) || ( node.skin !== undefined && ! index( node.skin, json.skins ) ) ) fail( 'glTF node references a missing mesh or skin' );
		if ( node.camera !== undefined || node.extensions?.KHR_lights_punctual ) fail( 'embedded cameras and lights are unsupported' );
		if ( node.children !== undefined && ! Array.isArray( node.children ) ) fail( 'invalid glTF children inventory' );
		pending.push( ...( node.children || [] ) );

	}

	if ( visited.size !== json.nodes.length ) fail( 'unreachable glTF nodes are unsupported' );
	return json;

}

export function validateSceneModelBytes( model, bytes ) {

	const json = inspectSupportedGLB( bytes );
	if ( ! Array.isArray( model?.nodes ) || model.nodes.length !== json.nodes.length + 1 || model.nodes.filter( node => node.gltfNodeIndex === null && node.expectedName === null ).length !== 1 ) fail( 'mapping must cover exactly every embedded glTF node and its scene root' );
	const indices = new Set();
	for ( const node of model.nodes ) if ( node.gltfNodeIndex !== null ) {

		if ( ! index( node.gltfNodeIndex, json.nodes ) || indices.has( node.gltfNodeIndex ) || node.expectedName !== ( json.nodes[ node.gltfNodeIndex ].name || '' ) ) fail( 'node mapping is unresolved, duplicated or stale for these immutable bytes' );
		indices.add( node.gltfNodeIndex );

	}

	return json;

}

/** Declared human capability requires the same tagged morph geometry used by the
 * raster pose service. The renderer still validates parsed native attributes.
 */
export function validateDefinitionModelBytes( definition, model, bytes ) {

	const json = validateSceneModelBytes( model, bytes );
	const root = model.nodes.find( node => node.gltfNodeIndex === null );
	if ( ! definition.humanPoseRoots.includes( root.instanceId ) ) return json;
	let poseMeshes = 0;
	const pending = json.scenes[ 0 ].nodes.map( nodeIndex => [ nodeIndex, false ] );
	while ( pending.length ) {

		const [ nodeIndex, inherited ] = pending.pop(), node = json.nodes[ nodeIndex ];
		const tagged = inherited || node.extras?.rayzeePoseModel === 'mannequin-v1';
		pending.push( ...( node.children || [] ).map( child => [ child, tagged ] ) );
		if ( ! tagged || node.mesh === undefined ) continue;
		const mesh = json.meshes?.[ node.mesh ];
		const names = mesh?.extras?.targetNames;
		if ( ! Array.isArray( names ) || ! Array.isArray( mesh.primitives ) || ! mesh.primitives.length || ! [ 'standing', 'sitting' ].every( pose => names.includes( pose ) ) ) fail( 'human root requires complete standing/sitting morph geometry' );
		for ( const primitive of mesh.primitives ) for ( const name of [ 'POSITION', 'NORMAL' ] ) {

			const base = json.accessors?.[ primitive.attributes?.[ name ] ];
			for ( const pose of [ 'standing', 'sitting' ] ) {

				const morph = json.accessors?.[ primitive.targets?.[ names.indexOf( pose ) ]?.[ name ] ];
				if ( ! base || ! morph || base.type !== 'VEC3' || morph.type !== 'VEC3' || ! Number.isSafeInteger( base.count ) || base.count < 1 || morph.count !== base.count ) fail( 'human root requires complete standing/sitting position and normal samples' );

			}

		}

		poseMeshes ++;

	}

	if ( ! poseMeshes ) fail( 'human root requires a tagged supported mannequin rig' );
	return json;

}

/** Byte-level display checks depend on the preset's selected UV channel. */
export function validatePresetModelBytes( preset, model, bytes ) {

	const json = validateDefinitionModelBytes( preset.sceneDefinition, model, bytes );
	for ( const wall of preset.snapshot.ledWalls ) {

		const mapping = model.nodes.find( node => node.instanceId === wall.nodeInstanceId );
		if ( ! mapping ) continue;
		const node = json.nodes[ mapping.gltfNodeIndex ];
		const mesh = json.meshes?.[ node?.mesh ];
		const primitive = mesh?.primitives?.[ 0 ];
		const uv = json.accessors?.[ primitive?.attributes?.[ `TEXCOORD_${wall.surface.uvChannel}` ] ];
		if ( ! mesh || mesh.primitives.length !== 1 || ! [ undefined, 4 ].includes( primitive.mode ) || ! uv || uv.type !== 'VEC2' ) fail( 'LED display requires a mapped triangle mesh with its selected UV channel' );

	}

	return json;

}
