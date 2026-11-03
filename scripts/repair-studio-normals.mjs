/**
 * Repair Studio One's architectural edges without changing its triangles,
 * metre scale, 25 material primitives, or manifest node paths.
 * Run: node scripts/repair-studio-normals.mjs [path-to-studio-one.glb]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { BufferAttribute, BufferGeometry } from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const path = process.argv[ 2 ] || 'app/public/models/studio-one.glb';
const original = await readFile( path );
const jsonLength = original.readUInt32LE( 12 );
const document = JSON.parse( original.subarray( 20, 20 + jsonLength ).toString() );
const binary = original.subarray( 28 + jsonLength );
if ( document.meshes.length !== 1 || document.buffers.length !== 1 ) throw new Error( 'Expected the standalone Studio One mesh.' );

function readAttribute( index ) {

	const accessor = document.accessors[ index ];
	const view = document.bufferViews[ accessor.bufferView ];
	if ( accessor.sparse ) throw new Error( 'Sparse data is unsupported.' );
	const ArrayType = { 5120: Int8Array, 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[ accessor.componentType ];
	const itemSize = { SCALAR: 1, VEC3: 3 }[ accessor.type ];
	if ( ! ArrayType || ! itemSize ) throw new Error( 'Unsupported studio attribute.' );
	const offset = ( view.byteOffset || 0 ) + ( accessor.byteOffset || 0 );
	const itemBytes = itemSize * ArrayType.BYTES_PER_ELEMENT;
	const stride = view.byteStride || itemBytes;
	const copy = new Uint8Array( accessor.count * itemBytes );
	for ( let item = 0; item < accessor.count; item ++ ) {

		copy.set( binary.subarray( offset + item * stride, offset + item * stride + itemBytes ), item * itemBytes );

	}
	return new BufferAttribute( new ArrayType( copy.buffer ), itemSize, accessor.normalized || false );

}

// Separate vertices at creases, retaining smooth normals along curved parts.
const geometries = document.meshes[ 0 ].primitives.map( primitive => {

	if ( ( primitive.mode ?? 4 ) !== 4 || primitive.targets || Object.keys( primitive.attributes ).some( key => ! [ 'POSITION', 'NORMAL' ].includes( key ) ) ) {

		throw new Error( 'Expected untextured, static studio triangles.' );

	}

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', readAttribute( primitive.attributes.POSITION ) );
	geometry.setAttribute( 'normal', readAttribute( primitive.attributes.NORMAL ) );
	if ( primitive.indices !== undefined ) geometry.setIndex( readAttribute( primitive.indices ) );
	const expanded = geometry.index ? geometry.toNonIndexed() : geometry;
	const repaired = toCreasedNormals( geometry, Math.PI / 4 );
	const before = expanded.attributes.position.array;
	const after = repaired.attributes.position.array;
	if ( before.length !== after.length || before.some( ( value, index ) => value !== after[ index ] ) ) {

		throw new Error( 'Repair changed triangle positions.' );

	}

	return repaired;

} );

document.accessors = [];
document.bufferViews = [];
const chunks = [];
let byteLength = 0;
for ( const [ index, geometry ] of geometries.entries() ) {

	const primitive = document.meshes[ 0 ].primitives[ index ];
	delete primitive.indices;
	for ( const [ semantic, attributeName ] of [ [ 'POSITION', 'position' ], [ 'NORMAL', 'normal' ] ] ) {

		const attribute = geometry.attributes[ attributeName ];
		const array = attribute.array;
		const bufferView = document.bufferViews.length;
		document.bufferViews.push( { buffer: 0, byteOffset: byteLength, byteLength: array.byteLength, target: 34962 } );
		const accessor = { bufferView, componentType: 5126, count: attribute.count, type: 'VEC3' };
		if ( semantic === 'POSITION' ) {

			geometry.computeBoundingBox();
			accessor.min = geometry.boundingBox.min.toArray();
			accessor.max = geometry.boundingBox.max.toArray();

		}

		primitive.attributes[ semantic ] = document.accessors.length;
		document.accessors.push( accessor );
		chunks.push( Buffer.from( array.buffer, array.byteOffset, array.byteLength ) );
		byteLength += array.byteLength;

	}

}

document.buffers = [ { byteLength } ];
const json = Buffer.from( JSON.stringify( document ) );
const paddedJson = Buffer.alloc( Math.ceil( json.length / 4 ) * 4, 0x20 );
json.copy( paddedJson );
const header = Buffer.alloc( 20 );
header.writeUInt32LE( 0x46546c67, 0 );
header.writeUInt32LE( 2, 4 );
header.writeUInt32LE( 28 + paddedJson.length + byteLength, 8 );
header.writeUInt32LE( paddedJson.length, 12 );
header.writeUInt32LE( 0x4e4f534a, 16 );
const binaryHeader = Buffer.alloc( 8 );
binaryHeader.writeUInt32LE( byteLength, 0 );
binaryHeader.writeUInt32LE( 0x004e4942, 4 );
await writeFile( path, Buffer.concat( [ header, paddedJson, binaryHeader, ...chunks ] ) );
console.log( `Repaired ${geometries.length} studio primitives; triangle positions and hierarchy unchanged.` );
