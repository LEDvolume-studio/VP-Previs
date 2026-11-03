import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { inspectSupportedGLB, validateDefinitionModelBytes, validatePresetModelBytes, validateSceneModelBytes } from '../../../app/src/previs/engine/SupportedGLB.js';
import { createBundledStudentSceneManifest } from '../../../app/src/previs/fixtures/BundledStudentScene.js';

const readBytes = async source => new Uint8Array( await readFile( new URL( `../../../app/public${source}`, import.meta.url ) ) );
function rebuild( bytes, mutate ) {

	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const oldJSONLength = view.getUint32( 12, true );
	const json = JSON.parse( new TextDecoder().decode( bytes.subarray( 20, 20 + oldJSONLength ) ) );
	mutate( json );
	const encoded = new TextEncoder().encode( JSON.stringify( json ) ), length = Math.ceil( encoded.byteLength / 4 ) * 4;
	const output = new Uint8Array( bytes.byteLength - oldJSONLength + length );
	output.set( bytes.subarray( 0, 20 ) ); output.fill( 32, 20, 20 + length ); output.set( encoded, 20 ); output.set( bytes.subarray( 20 + oldJSONLength ), 20 + length );
	const outputView = new DataView( output.buffer );
	outputView.setUint32( 8, output.byteLength, true ); outputView.setUint32( 12, length, true );
	return output;

}

describe( 'Shared publication/parser GLB byte preflight', () => {

	it.each( [ 'studio', 'suv', 'mannequin', 'led' ] )( 'accepts the actual bundled %s bytes without DOM or GLTFLoader', async key => {

		const manifest = createBundledStudentSceneManifest( { models: [ key ] } ), model = manifest.models[ 0 ];
		const bytes = await readBytes( model.source );
		expect( validateSceneModelBytes( model, bytes ).nodes ).toHaveLength( model.nodes.length - 1 );
		const offsetBytes = new Uint8Array( bytes.byteLength + 16 ); offsetBytes.set( bytes, 8 );
		expect( inspectSupportedGLB( offsetBytes.subarray( 8, 8 + bytes.byteLength ) ).asset.version ).toBe( '2.0' );

	} );

	it.each( [ 'header-length', 'truncated-bin', 'extra-header', 'unaligned', 'bin-type', 'duplicate-json' ] )( 'rejects malformed %s container before parser allocation', async kind => {

		let bytes = await readBytes( '/models/led/main-led-volume-wall.glb' );
		const jsonLength = new DataView( bytes.buffer ).getUint32( 12, true ), binOffset = 20 + jsonLength;
		if ( kind === 'truncated-bin' ) bytes = bytes.slice( 0, - 4 );
		if ( kind === 'extra-header' ) {

			const larger = new Uint8Array( bytes.byteLength + 4 ); larger.set( bytes ); bytes = larger;

		}

		const view = new DataView( bytes.buffer );
		view.setUint32( 8, bytes.byteLength, true );
		if ( kind === 'header-length' ) view.setUint32( 8, bytes.byteLength + 4, true );
		if ( kind === 'unaligned' ) view.setUint32( binOffset, view.getUint32( binOffset, true ) - 1, true );
		if ( kind === 'bin-type' ) view.setUint32( binOffset + 4, 0x12345678, true );
		if ( kind === 'duplicate-json' ) view.setUint32( binOffset + 4, 0x4e4f534a, true );
		expect( () => inspectSupportedGLB( bytes ) ).toThrow();

	} );

	it.each( [
		json => {

			json.buffers[ 0 ].uri = 'https://untrusted.invalid/model.bin';

		},
		json => {

			json.images = [ { uri: 'data:image/png;base64,AA' } ];

		},
		json => {

			json.images = [ { bufferView: 99999 } ];

		},
		json => {

			json.buffers[ 0 ].byteLength += 4;

		},
		json => {

			json.bufferViews[ 0 ].byteLength += json.buffers[ 0 ].byteLength;

		},
		json => {

			json.extensionsUsed = [ 'KHR_draco_mesh_compression' ];

		},
		json => {

			json.cameras = [ {} ];

		},
		json => {

			json.nodes[ 0 ].camera = 0;

		},
		json => {

			json.animations = [ {} ];

		},
		json => {

			json.scenes[ 0 ].nodes.push( 0 );

		},
		json => {

			json.nodes[ 0 ].children = [ 0 ];

		},
		json => {

			json.nodes.push( { name: 'Unreachable' } );

		},
		json => {

			json.scenes[ 0 ].nodes = [ 999 ];

		},
		json => {

			json.nodes[ 0 ].mesh = 999;

		},
		json => {

			json.meshes[ 0 ].primitives[ 0 ].attributes.POSITION = 999;

		},
		json => {

			json.accessors[ 0 ].bufferView = 999;

		},
		json => {

			json.accessors[ 0 ].count *= 1000;

		},
		json => {

			json.accessors[ 0 ].sparse = { indices: { bufferView: 999 }, values: { bufferView: 0 } };

		},
	] )( 'rejects external, unsupported or incomplete embedded structure %#', async mutate => {

		const bytes = rebuild( await readBytes( '/models/led/main-led-volume-wall.glb' ), mutate );
		expect( () => inspectSupportedGLB( bytes ) ).toThrow();

	} );

	it( 'bounds cumulative decoded accessor allocation even without backing buffer views', async () => {

		const bytes = rebuild( await readBytes( '/models/led/main-led-volume-wall.glb' ), json => {

			json.accessors.push( ...Array.from( { length: 3 }, () => ( { componentType: 5126, type: 'VEC4', count: 4 * 1024 * 1024 } ) ) );

		} );
		expect( () => inspectSupportedGLB( bytes ) ).toThrow( /memory limit/ );

	} );

	it( 'verifies real mannequin standing/sitting normal and position samples for its declared root', async () => {

		const manifest = createBundledStudentSceneManifest( { models: [ 'mannequin' ] } ), model = manifest.models[ 0 ];
		const definition = { humanPoseRoots: [ 'mannequin-root' ] }, bytes = await readBytes( model.source );
		expect( validateDefinitionModelBytes( definition, model, bytes ).meshes.length ).toBeGreaterThan( 0 );
		const invalid = rebuild( bytes, json => {

			delete json.meshes[ 0 ].primitives[ 0 ].targets[ 1 ].NORMAL;

		} );
		expect( () => validateDefinitionModelBytes( definition, model, invalid ) ).toThrow( /samples/ );
		const untagged = rebuild( bytes, json => {

			delete json.nodes[ 69 ].extras.rayzeePoseModel;

		} );
		expect( () => validateDefinitionModelBytes( definition, model, untagged ) ).toThrow( /tagged/ );

	} );

	it( 'validates the actual LED display mesh and native UV1 channel at publication', async () => {

		const model = createBundledStudentSceneManifest( { models: [ 'led' ] } ).models[ 0 ];
		const bytes = await readBytes( model.source );
		const preset = { sceneDefinition: { humanPoseRoots: [] }, snapshot: { ledWalls: [ { nodeInstanceId: 'led-instance-0', surface: { uvChannel: 1 } } ] } };
		expect( validatePresetModelBytes( preset, model, bytes ).nodes[ 0 ].name ).toBe( 'QuadWall' );
		preset.snapshot.ledWalls[ 0 ].surface.uvChannel = 3;
		expect( () => validatePresetModelBytes( preset, model, bytes ) ).toThrow( /UV channel/ );
		preset.snapshot.ledWalls[ 0 ].surface.uvChannel = 1;
		const multiPrimitive = rebuild( bytes, json => {

			json.meshes[ 0 ].primitives.push( structuredClone( json.meshes[ 0 ].primitives[ 0 ] ) );

		} );
		expect( () => validatePresetModelBytes( preset, model, multiPrimitive ) ).toThrow( /triangle mesh/ );
		const group = rebuild( bytes, json => {

			delete json.nodes[ 0 ].mesh;

		} );
		expect( () => validatePresetModelBytes( preset, model, group ) ).toThrow( /triangle mesh/ );

	} );

	it( 'rejects a nonhuman model falsely declared as a pose root', async () => {

		const model = createBundledStudentSceneManifest( { models: [ 'led' ] } ).models[ 0 ];
		expect( () => validateDefinitionModelBytes( { humanPoseRoots: [ 'led-root' ] }, model, new Uint8Array( [] ) ) ).toThrow();
		const bytes = await readBytes( model.source );
		expect( () => validateDefinitionModelBytes( { humanPoseRoots: [ 'led-root' ] }, model, bytes ) ).toThrow( /tagged/ );

	} );

} );
