import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createProjectDocument } from '../../../app/src/services/projects/ProjectSchema.js';
import { createBundledStudentSceneManifest } from '../../../app/src/previs/fixtures/BundledStudentScene.js';
import { validateStudentPresetVersion } from '../../../app/src/previs/domain/StudentCatalogueSchema.js';
import { prepareStudentPresetPublication } from '../../../app/src/previs/engine/StudentPresetPublication.js';
import { studentFixture, transform } from './studentFixtures.js';

let modelBytes;
beforeAll( async () => {

	modelBytes = new Uint8Array( await readFile( new URL( '../../../app/public/models/led/main-led-volume-wall.glb', import.meta.url ) ) );

} );

function input() {

	const manifest = createBundledStudentSceneManifest( { models: [ 'led' ] } );
	const model = manifest.models[ 0 ];
	const source = createProjectDocument( { projectId: 'admin-publication', primaryCatalogId: 'test-led', environmentId: null } );
	source.scene.assets[ 0 ].instanceId = 'source-led';
	const snapshot = structuredClone( studentFixture().shots.shotA.snapshot );
	snapshot.nodes = {}; snapshot.lights = []; snapshot.ledWalls = [];
	snapshot.environment.asset = null;
	snapshot.rasterAppearance = { version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb', enableEnvironment: false, showBackground: true, transparentBackground: false, backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#778899' };
	source.cameras = { active: { position: [ ...snapshot.camera.transform.position ], quaternion: [ ...snapshot.camera.transform.quaternion ], orbitTarget: [ ...snapshot.camera.target ], fov: snapshot.camera.projection.fov, near: snapshot.camera.projection.near, far: snapshot.camera.projection.far } };
	const mapping = { assets: { 'source-led': { catalogId: 'test-led', assetVersion: 1, asset: model.asset } }, nodes: {}, lights: {}, environments: {}, bakedMaterials: {} };
	for ( const node of model.nodes ) {

		const sourceKey = `source-led:${node.gltfNodeIndex === null ? 'root' : node.gltfNodeIndex}`;
		mapping.nodes[ sourceKey ] = { instanceId: node.instanceId, nodeId: node.nodeId, asset: model.asset };
		source.scene.nodes[ sourceKey ] = { name: node.expectedName || 'Scene', ...transform() };
		snapshot.nodes[ node.instanceId ] = { nodeId: node.nodeId, asset: model.asset, transform: transform(), humanPose: null, doorAngles: {} };

	}

	const binding = { ready: true, nodes: model.nodes.map( node => ( { ...node, asset: model.asset } ) ) };
	const ports = {
		scene: { getBindings: () => binding, read: vi.fn( async () => Object.fromEntries( Object.entries( snapshot.nodes ).map( ( [ key, node ] ) => [ key, node.transform ] ) ) ) },
		pose: { read: async () => Object.fromEntries( Object.entries( snapshot.nodes ).map( ( [ key, node ] ) => [ key, { humanPose: node.humanPose, doorAngles: node.doorAngles } ] ) ) },
	};
	for ( const [ port, field ] of [[ 'camera', 'camera' ], [ 'lights', 'lights' ], [ 'media', 'ledWalls' ], [ 'environment', 'environment' ], [ 'rasterAppearance', 'rasterAppearance' ]] ) ports[ port ] = { read: vi.fn( async () => snapshot[ field ] ) };
	return {
		source, mapping, sceneDefinition: { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: manifest.baseScene, models: manifest.models.map( ( { asset, nodes } ) => ( { asset, nodes } ) ), humanPoseRoots: [] },
		assets: manifest.assets, ports,
		metadata: { presetId: 'teacher-led', version: '1', name: 'Teacher LED', description: 'Explicit test fixture', category: 'Studio', defaultDurationFrames: 125, thumbnail: null },
		loadAssetBytes: vi.fn( async () => modelBytes ),
	};

}

const errors = result => result.diagnostics.filter( item => item.severity === 'error' ).map( item => item.code );

describe( 'Read-only supported admin preset publication preparation', () => {

	it( 'verifies actual GLB bytes, captures all ports and packages a detached supported preset', async () => {

		const value = input(), original = structuredClone( value.source );
		const result = await prepareStudentPresetPublication( value );
		expect( result.diagnostics ).toEqual( expect.arrayContaining( [ expect.objectContaining( { code: 'ADMIN_WORKSPACE_OMITTED' } ) ] ) );
		expect( errors( result ) ).toEqual( [] );
		expect( result.ok ).toBe( true );
		expect( validateStudentPresetVersion( result.preset ) ).toBe( result.preset );
		expect( result.preset.schemaVersion ).toBe( 2 );
		expect( result.preset.snapshot.nodes ).toHaveProperty( 'led-root' );
		expect( value.source ).toEqual( original );
		expect( value.loadAssetBytes ).toHaveBeenCalledTimes( 1 );
		value.metadata.name = 'Changed'; value.sceneDefinition.models[ 0 ].nodes[ 0 ].nodeId = 'Changed';
		expect( result.preset.name ).toBe( 'Teacher LED' );
		expect( result.preset.sceneDefinition.models[ 0 ].nodes[ 0 ].nodeId ).toBe( 'led-root' );
		expect( JSON.stringify( result.preset ) ).not.toMatch( /source-led|sourceProjectId|https?:|user-data-dir/ );

	} );

	it.each( [
		[ 'UNSUPPORTED_FIELD', value => {

			value.source.scene.nodes[ 'source-led:0' ].customShader = 'unsupported';

		} ],
		[ 'UNSUPPORTED_MATERIAL_OVERRIDE', value => {

			value.source.scene.materials = { edited: { roughness: 0.5 } };

		} ],
		[ 'UNSUPPORTED_RENDER_STATE', value => {

			value.source.render.engine = { inventedEffect: true };

		} ],
		[ 'UNMAPPED_ENVIRONMENT', value => {

			value.source.scene.environment.catalogId = 'unverified-hdri';

		} ],
		[ 'UNMAPPED_ENVIRONMENT', value => {

			value.mapping.environments.unused = { assetId: 'fake', version: '1' };

		} ],
		[ 'UNSUPPORTED_RENDER_STATE', value => {

			value.source.render.engine = { environmentIntensity: 123 };

		} ],
		[ 'UNSUPPORTED_RENDER_STATE', value => {

			value.source.render.engine = { environmentRotation: 90 };

		} ],
	] )( 'preserves authoritative converter rejection %s', async ( code, mutate ) => {

		const value = input(); mutate( value );
		const result = await prepareStudentPresetPublication( value );
		expect( result.ok ).toBe( false );
		expect( result.preset ).toBeNull();
		expect( errors( result ) ).toContain( code );

	} );

	it.each( [ 'wrong-size', 'wrong-hash', 'wrong-map' ] )( 'rejects %s before reading live ports', async kind => {

		const value = input();
		if ( kind === 'wrong-size' ) value.loadAssetBytes = async () => modelBytes.subarray( 1 );
		if ( kind === 'wrong-hash' ) value.loadAssetBytes = async () => {

			const wrong = modelBytes.slice(); wrong[ 0 ] ^= 1; return wrong;

		};

		if ( kind === 'wrong-map' ) value.sceneDefinition.models[ 0 ].nodes[ 1 ].expectedName = 'Wrong';
		expect( errors( await prepareStudentPresetPublication( value ) ) ).toEqual( [ 'ASSET_VERIFICATION_FAILED' ] );
		expect( value.ports.scene.read ).not.toHaveBeenCalled();

	} );

	it.each( [[ 1, true ], [ 2, false ]] )( 'checks actual model UV channel %s against every captured LED mapping', async ( uvChannel, supported ) => {

		const value = input();
		const surface = { nativeCanvas: [ 6144, 2592 ], uvChannel, uvBounds: [ 0, 1, 0, 1 ], flipU: false };
		value.mapping.ledWalls = { 'source-led': { wallId: 'display', nodeInstanceId: 'led-instance-0', media: null, sourceVideo: null, mode: 'freeze', playbackRate: 1, surface } };
		value.source.led = [ { wallInstanceId: 'source-led', brightnessNits: 100, loop: true, placement: { position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotationDegrees: 0, aspectRatioLocked: true, fitMode: 'contain' }, video: null } ];
		value.ports.media.read = async () => [ { wallId: 'display', presentationVersion: 1, nodeInstanceId: 'led-instance-0', media: null, mode: 'freeze', inPointUs: 0, loop: true, playbackRate: 1, brightnessNits: 100, placement: { position: [ 0.5, 0.5 ], scale: [ 1, 1 ], rotationDegrees: 0, aspectRatioLocked: true, fitMode: 'contain' }, surface } ];
		const result = await prepareStudentPresetPublication( value );
		expect( result.ok ).toBe( supported );
		if ( supported ) expect( result.preset.snapshot.ledWalls[ 0 ].surface.uvChannel ).toBe( 1 );
		else expect( errors( result ) ).toEqual( [ 'ASSET_VERIFICATION_FAILED' ] );

	} );

	it.each( [ 'bytes', 'capture' ] )( 'rejects a revision change during %s', async phase => {

		const value = input();
		if ( phase === 'bytes' ) value.loadAssetBytes = async () => {

			value.source.revision ++; return modelBytes;

		};
		else value.ports.media.read = async () => {

			value.source.revision ++; return [];

		};

		expect( errors( await prepareStudentPresetPublication( value ) ) ).toEqual( [ 'STALE_CAPTURE' ] );

	} );

	it( 'rejects a replaced scene binding even when the project revision stays the same', async () => {

		const value = input();
		value.loadAssetBytes = async () => {

			const old = value.ports.scene.getBindings(); value.ports.scene.getBindings = () => ( { ...old } ); return modelBytes;

		};

		expect( errors( await prepareStudentPresetPublication( value ) ) ).toEqual( [ 'STALE_CAPTURE' ] );

	} );

	it.each( [ 'before', 'bytes', 'capture' ] )( 'supports cancellation %s work without a partial preset', async phase => {

		const value = input(), controller = new AbortController(); value.signal = controller.signal;
		if ( phase === 'before' ) controller.abort();
		if ( phase === 'bytes' ) value.loadAssetBytes = async () => {

			controller.abort(); return modelBytes;

		};

		if ( phase === 'capture' ) value.ports.media.read = async () => {

			controller.abort(); return [];

		};

		expect( errors( await prepareStudentPresetPublication( value ) ) ).toEqual( [ 'CANCELLED' ] );
		if ( phase !== 'capture' ) expect( value.ports.scene.read ).not.toHaveBeenCalled();

	} );

	it( 'does not disclose failed loader exception details', async () => {

		const value = input(); value.loadAssetBytes = async () => {

			throw new Error( 'secret https://credentials.invalid/private' );

		};

		const result = await prepareStudentPresetPublication( value );
		expect( errors( result ) ).toEqual( [ 'ASSET_VERIFICATION_FAILED' ] );
		expect( JSON.stringify( result ) ).not.toMatch( /secret|credentials/ );

	} );

	it.each( [
		value => {

			value.metadata.url = 'https://untrusted.invalid/';

		},
		value => {

			value.metadata.defaultDurationFrames = 22501;

		},
		value => {

			delete value.metadata.thumbnail;

		},
		value => {

			value.sceneDefinition.models[ 0 ].nodes.pop();

		},
		value => {

			delete value.ports.rasterAppearance;

		},
	] )( 'fails closed on incomplete or unsupported publication metadata/state %#', async mutate => {

		const value = input(); mutate( value );
		const result = await prepareStudentPresetPublication( value );
		expect( result.ok ).toBe( false );
		expect( result.preset ).toBeNull();
		expect( errors( result ).length ).toBeGreaterThan( 0 );

	} );

} );
