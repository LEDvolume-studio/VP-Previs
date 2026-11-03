import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Color } from 'three';
import { capturePreparedAdminScene, convertAdminProjectToStudentPreset, prepareStudentSceneConversion } from '../../../app/src/previs/engine/AdminPresetConverter.js';
import { validateStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { studentFixture, TEST_NOW, transform } from './studentFixtures.js';

const clone = value => structuredClone( value );
const sha256 = bytes => createHash( 'sha256' ).update( bytes ).digest( 'hex' );
// A real one-pixel RGBE container: an explicit test HDRI, not a claim to own or
// have verified the remote aristea_wreck catalogue version in these unit tests.
const hdr = new Uint8Array( [ ...new TextEncoder().encode( '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n' ), 128, 128, 128, 129 ] );
const models = [
	[ 'suv', 'assets/model-authoring/suv/mid-suv-front-doors.rayzee', 'app/public/vehicles/mid-suv/mid-suv.glb' ],
	[ 'mannequin', 'assets/model-authoring/mannequin/mannequin-two-poses.rayzee', 'app/public/characters/mannequin/mannequin-presets.glb' ],
];
const fixtures = {};

beforeAll( async () => {

	for ( const [ name, projectFile, modelFile ] of models ) {

		const source = JSON.parse( await readFile( new URL( `../../../${projectFile}`, import.meta.url ), 'utf8' ) );
		const bytes = await readFile( new URL( `../../../${modelFile}`, import.meta.url ) );
		// Keep the source fixture's real hierarchy/transforms/poses and replace
		// only its remote HDRI with the explicit local test HDRI identity.
		source.scene.environment.catalogId = 'test-only-one-pixel-hdri';
		const model = { assetId: name, version: 'fixture-1', kind: 'model', sha256: sha256( bytes ), byteLength: bytes.byteLength, mimeType: 'model/gltf-binary', durationUs: null };
		const environment = { assetId: 'test-hdri', version: 'fixture-1', kind: 'environment', sha256: sha256( hdr ), byteLength: hdr.byteLength, mimeType: 'image/vnd.radiance', durationUs: null };
		const modelRef = { assetId: model.assetId, version: model.version };
		const envRef = { assetId: environment.assetId, version: environment.version };
		const assets = { [ `${model.assetId}@${model.version}` ]: model, 'test-hdri@fixture-1': environment };
		const baseScene = { sceneId: name, version: 'fixture-1', assets: [ modelRef, envRef ] };
		const preparedScene = await prepareStudentSceneConversion( { assets, baseScene }, asset => asset.kind === 'model' ? bytes : hdr );
		const snapshot = clone( studentFixture().shots.shotA.snapshot );
		snapshot.nodes = {};
		snapshot.lights = [];
		snapshot.ledWalls = [];
		snapshot.environment = { asset: envRef, intensity: 1, rotation: [ 0, 0, 0 ], background: true };
		const sourceCamera = source.cameras.active;
		snapshot.camera.transform.position = clone( sourceCamera.position );
		snapshot.camera.transform.quaternion = clone( sourceCamera.quaternion );
		snapshot.camera.target = clone( sourceCamera.orbitTarget );
		for ( const field of [ 'fov', 'near', 'far' ] ) snapshot.camera.projection[ field ] = sourceCamera[ field ];
		const mapping = { assets: {}, nodes: {}, lights: {}, environments: { 'test-only-one-pixel-hdri': envRef }, bakedMaterials: {} };
		for ( const asset of source.scene.assets ) mapping.assets[ asset.instanceId ] = { catalogId: asset.catalogId, assetVersion: asset.assetVersion, asset: modelRef };
		for ( const [ index, [ sourceKey, state ]] of Object.entries( source.scene.nodes ).entries() ) {

			// These fixture-specific IDs belong to this hash/version mapping only.
			// Production loaders must use their explicit published immutable map.
			const instanceId = `${name}-instance-${index}`;
			const nodeId = `${name}-node-${index}`;
			mapping.nodes[ sourceKey ] = { instanceId, nodeId, asset: modelRef };
			snapshot.nodes[ instanceId ] = { nodeId, asset: modelRef, transform: { position: clone( state.position ), quaternion: clone( state.quaternion ), scale: clone( state.scale ), visible: state.visible }, humanPose: state.pose ?? null, doorAngles: {} };

		}

		fixtures[ name ] = { source, preparedScene, mapping, capture: { sourceProjectId: source.projectId, sourceRevision: source.revision, snapshot }, preset: { presetId: name, version: 'fixture-1', name: source.name }, projectId: `${name}-student`, shotId: 'converted', now: TEST_NOW };

	}

	// Deliberately composed conversion fixture: the real saved welcome LED
	// hierarchy/brightness/placement plus actual local LED GLB bytes, attached to
	// the already supported SUV fixture. The inaccessible teacher video is
	// replaced explicitly with our local ten-second blue H.264 fixture.
	const value = input();
	const converted = convertAdminProjectToStudentPreset( value ).document;
	const assets = clone( converted.assets );
	const baseScene = clone( Object.values( converted.baseScenes )[ 0 ] );
	const welcome = JSON.parse( await readFile( new URL( '../../../app/src/data/default-scene.json', import.meta.url ), 'utf8' ) );
	const videoBytes = await readFile( new URL( './fixtures/led-test-h264.mp4', import.meta.url ) );
	const videoRef = { assetId: 'test-blue-led', version: 'fixture-1' };
	assets[ 'test-blue-led@fixture-1' ] = { ...videoRef, kind: 'video', sha256: sha256( videoBytes ), byteLength: videoBytes.byteLength, mimeType: 'video/mp4', durationUs: 10000000 };
	const bytesById = { suv: await readFile( new URL( '../../../app/public/vehicles/mid-suv/mid-suv.glb', import.meta.url ) ), 'test-hdri': hdr, 'test-blue-led': videoBytes };
	value.mapping.ledWalls = {};
	value.source.led = clone( welcome.led );
	for ( const [ index, saved ] of value.source.led.entries() ) {

		const sourceAsset = welcome.scene.assets.find( item => item.instanceId === saved.wallInstanceId );
		const modelId = index === 0 ? 'test-main-led' : 'test-square-led';
		const file = index === 0 ? 'main-led-volume-wall' : 'square-wild-wall';
		if ( ! bytesById[ modelId ] ) bytesById[ modelId ] = await readFile( new URL( `../../../app/public/models/led/${file}.glb`, import.meta.url ) );
		const bytes = bytesById[ modelId ];
		const modelRef = { assetId: modelId, version: 'fixture-1' };
		assets[ `${modelId}@fixture-1` ] = { ...modelRef, kind: 'model', sha256: sha256( bytes ), byteLength: bytes.byteLength, mimeType: 'model/gltf-binary', durationUs: null };
		if ( ! baseScene.assets.some( item => item.assetId === modelId ) ) baseScene.assets.push( modelRef );
		value.source.scene.assets.push( sourceAsset );
		value.mapping.assets[ sourceAsset.instanceId ] = { catalogId: sourceAsset.catalogId, assetVersion: sourceAsset.assetVersion, asset: modelRef };
		for ( const [ sourceKey, state ] of Object.entries( welcome.scene.nodes ).filter( ( [ key ] ) => key.startsWith( `${saved.wallInstanceId}:` ) ) ) {

			const suffix = sourceKey.split( ':' )[ 1 ].replaceAll( '/', '-' );
			const instanceId = `led-${index}-${suffix}`;
			const nodeId = `led-node-${suffix}`;
			value.source.scene.nodes[ sourceKey ] = clone( state );
			value.mapping.nodes[ sourceKey ] = { instanceId, nodeId, asset: modelRef };
			value.capture.snapshot.nodes[ instanceId ] = { asset: modelRef, nodeId, transform: { position: clone( state.position ), quaternion: clone( state.quaternion ), scale: clone( state.scale ), visible: state.visible }, humanPose: null, doorAngles: {} };

		}

		if ( saved.video ) saved.video = { assetId: 'explicit-test-blue-file', name: 'led-test-h264.mp4', type: 'video/mp4', size: videoBytes.byteLength, lastModified: 0, currentTime: saved.video.currentTime };
		const wallId = `portable-led-${index}`;
		const nodeInstanceId = `led-${index}-0-0`;
		const surface = { nativeCanvas: index === 0 ? [ 6144, 2592 ] : [ 1, 1 ], uvChannel: 1, uvBounds: [ 0, 1, 0, 1 ], flipU: false };
		const sourceVideo = saved.video ? Object.fromEntries( Object.entries( saved.video ).filter( ( [ key ] ) => key !== 'currentTime' ) ) : null;
		const media = saved.video ? videoRef : null;
		value.mapping.ledWalls[ saved.wallInstanceId ] = { wallId, nodeInstanceId, media, sourceVideo, mode: saved.video ? 'play' : 'freeze', playbackRate: 1, surface };
		value.capture.snapshot.ledWalls.push( { wallId, presentationVersion: 1, nodeInstanceId, media, mode: saved.video ? 'play' : 'freeze', inPointUs: saved.video ? Math.round( saved.video.currentTime * 1000000 ) : 0, loop: saved.loop, playbackRate: 1, brightnessNits: saved.brightnessNits, placement: { position: [ saved.placement.position.x, saved.placement.position.y ], scale: [ saved.placement.scale.x, saved.placement.scale.y ], rotationDegrees: saved.placement.rotationDegrees, aspectRatioLocked: saved.placement.aspectRatioLocked, fitMode: saved.placement.fitMode }, surface } );

	}

	value.preparedScene = await prepareStudentSceneConversion( { assets, baseScene }, asset => bytesById[ asset.assetId ] );
	fixtures.led = value;

} );

const input = ( name = 'suv' ) => {

	const { preparedScene, ...content } = fixtures[ name ];
	return { ...clone( content ), preparedScene };

};

const codes = result => result.diagnostics.map( item => item.code );
const rasterInput = () => {

	const value = input();
	const snapshot = value.capture.snapshot;
	snapshot.rasterAppearance = { version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb', enableEnvironment: true, showBackground: true, transparentBackground: false, backgroundIntensity: 0.8, backgroundBlurriness: 0.3, backgroundColor: '#778899' };
	value.source.cameras.active.effects = { aperture: snapshot.camera.lens.aperture };
	value.source.render = {
		engine: { exposure: snapshot.camera.exposure, saturation: 1.2, maxBounces: 8, backgroundIntensity: 0.8, backgroundBlurriness: 0.3, backgroundColor: '#778899', groundProjectionEnabled: false, enableGroundCatcher: false },
		ui: { environmentMode: 'hdri', toneMapping: 4, exposure: 999, aperture: 999, fov: 999, enableBloom: true, gradientZenithColor: '#ff0000', groundProjectionHeight: 999 },
	};
	return value;

};

describe( 'admin preset conversion against immutable prepared scene versions', () => {

	it.each( models.map( ( [ name ] ) => name ) )( 'preserves every real %s authoring node and validates the independent output', name => {

		const value = input( name );
		const result = convertAdminProjectToStudentPreset( value );
		expect( result.diagnostics.filter( item => item.severity === 'error' ) ).toEqual( [] );
		expect( result.ok ).toBe( true );
		expect( validateStudentProjectDocument( result.document ) ).toBe( true );
		expect( result.document.shots.converted.snapshot ).toEqual( value.capture.snapshot );
		expect( Object.keys( result.document.shots.converted.snapshot.nodes ) ).toHaveLength( Object.keys( value.source.scene.nodes ).length );
		expect( result.document.shots.converted.sourcePreset ).toEqual( { presetId: name, version: 'fixture-1' } );
		value.capture.snapshot.camera.transform.position[ 0 ] = 999;
		value.mapping.assets = {};
		value.source.scene.nodes = {};
		expect( result.document.shots.converted.snapshot.camera.transform.position[ 0 ] ).not.toBe( 999 );
		expect( JSON.stringify( result.document ) ).not.toMatch( /catalogId|wallInstanceId|\/Users\/|https?:|sourceProjectId/ );

	} );

	it( 'keeps real opposing open SUV hinge quaternions, without guessing scalar door angles', () => {

		const value = input();
		const result = convertAdminProjectToStudentPreset( value );
		const hinges = Object.entries( value.source.scene.nodes ).filter( ( [ , node ] ) => node.name.endsWith( '_Hinge' ) );
		expect( hinges ).toHaveLength( 2 );
		for ( const [ key, node ] of hinges ) expect( result.document.shots.converted.snapshot.nodes[ value.mapping.nodes[ key ].instanceId ].transform.quaternion ).toEqual( node.quaternion );
		expect( hinges[ 0 ][ 1 ].quaternion[ 1 ] * hinges[ 1 ][ 1 ].quaternion[ 1 ] ).toBeLessThan( 0 );

	} );

	it( 'retains both real standing and sitting mannequin pose metadata', () => {

		const result = convertAdminProjectToStudentPreset( input( 'mannequin' ) );
		const poses = Object.values( result.document.shots.converted.snapshot.nodes ).map( node => node.humanPose );
		expect( poses ).toContain( 'standing' );
		expect( poses ).toContain( 'sitting' );

	} );

	it.each( [ 'missing', 'fake' ] )( 'rejects %s byte-verification receipts', kind => {

		const value = input();
		value.preparedScene = kind === 'missing' ? undefined : {};
		expect( codes( convertAdminProjectToStudentPreset( value ) ) ).toContain( 'UNVERIFIED_SCENE' );

	} );

	it( 'checks both the exact byte length and the content hash before issuing a receipt', async () => {

		const asset = { assetId: 'hdr', version: '1', kind: 'environment', sha256: sha256( hdr ), byteLength: hdr.byteLength, mimeType: 'image/vnd.radiance', durationUs: null };
		const manifest = { assets: { 'hdr@1': asset }, baseScene: { sceneId: 'scene', version: '1', assets: [ { assetId: 'hdr', version: '1' } ] } };
		await expect( prepareStudentSceneConversion( manifest, () => hdr.subarray( 1 ) ) ).rejects.toThrow( 'size' );
		const wrong = hdr.slice();
		wrong[ 0 ] ^= 1;
		await expect( prepareStudentSceneConversion( manifest, () => wrong ) ).rejects.toThrow( 'hash' );
		await expect( prepareStudentSceneConversion( manifest, () => 'https://example.com/unverified.hdr' ) ).rejects.toThrow( 'size' );

	} );

	it( 'captures a private manifest copy before asynchronous byte loading', async () => {

		const value = input();
		const reference = { assetId: 'isolated', version: '1' };
		const asset = { ...reference, kind: 'environment', sha256: sha256( hdr ), byteLength: hdr.byteLength, mimeType: 'image/vnd.radiance', durationUs: null };
		const manifest = { assets: { 'isolated@1': asset }, baseScene: { sceneId: 'isolated', version: '1', assets: [ reference ] } };
		const receipt = await prepareStudentSceneConversion( manifest, async () => {

			manifest.baseScene.version = 'changed';
			manifest.assets[ 'isolated@1' ].sha256 = '0'.repeat( 64 );
			return hdr;

		} );
		// Receipt authenticity remains valid after caller-owned manifest mutation;
		// conversion fails on the intentionally unrelated model mappings only.
		value.preparedScene = receipt;
		const result = convertAdminProjectToStudentPreset( value );
		expect( codes( result ) ).not.toContain( 'UNVERIFIED_SCENE' );
		expect( result.ok ).toBe( false );

	} );

	it( 'assembles a complete detached live-port capture and refuses omitted nodes or a changed scene', async () => {

		const value = input();
		const snapshot = value.capture.snapshot;
		let binding = { ready: true, nodes: Object.entries( snapshot.nodes ).map( ( [ instanceId, node ] ) => ( { instanceId, asset: node.asset, nodeId: node.nodeId } ) ) };
		const transforms = Object.fromEntries( Object.entries( snapshot.nodes ).map( ( [ id, node ] ) => [ id, node.transform ] ) );
		const poses = Object.fromEntries( Object.entries( snapshot.nodes ).map( ( [ id, node ] ) => [ id, { humanPose: node.humanPose, doorAngles: node.doorAngles } ] ) );
		const ports = {
			scene: { getBindings: () => binding, read: async () => transforms }, pose: { read: async () => poses },
			camera: { read: async () => snapshot.camera }, lights: { read: async () => snapshot.lights },
			environment: { read: async () => snapshot.environment }, media: { read: async () => snapshot.ledWalls },
		};
		const captured = await capturePreparedAdminScene( { source: value.source, ports } );
		expect( captured ).toEqual( value.capture );
		captured.snapshot.camera.transform.position[ 0 ] = 1000;
		expect( snapshot.camera.transform.position[ 0 ] ).not.toBe( 1000 );
		transforms.unmapped = transform();
		await expect( capturePreparedAdminScene( { source: value.source, ports } ) ).rejects.toThrow( 'Unmapped' );
		delete transforms.unmapped;
		ports.media.read = async () => {

			binding = { ...binding };
			return snapshot.ledWalls;

		};

		await expect( capturePreparedAdminScene( { source: value.source, ports } ) ).rejects.toThrow( 'changed during capture' );

	} );

	it( 'includes a complete optional live raster appearance capture without inventing legacy defaults', async () => {

		const value = rasterInput();
		const snapshot = value.capture.snapshot;
		const binding = { ready: true, nodes: Object.entries( snapshot.nodes ).map( ( [ instanceId, node ] ) => ( { instanceId, asset: node.asset, nodeId: node.nodeId } ) ) };
		const ports = { scene: { getBindings: () => binding, read: () => Object.fromEntries( Object.entries( snapshot.nodes ).map( ( [ key, node ] ) => [ key, node.transform ] ) ) }, pose: { read: () => Object.fromEntries( Object.entries( snapshot.nodes ).map( ( [ key, node ] ) => [ key, { humanPose: node.humanPose, doorAngles: node.doorAngles } ] ) ) } };
		for ( const [ name, key ] of [[ 'camera', 'camera' ], [ 'lights', 'lights' ], [ 'environment', 'environment' ], [ 'media', 'ledWalls' ], [ 'rasterAppearance', 'rasterAppearance' ]] ) ports[ name ] = { read: () => snapshot[ key ] };
		const captured = await capturePreparedAdminScene( { source: value.source, ports } );
		expect( captured.snapshot.rasterAppearance ).toEqual( snapshot.rasterAppearance );
		captured.snapshot.rasterAppearance.backgroundIntensity = 99;
		expect( snapshot.rasterAppearance.backgroundIntensity ).toBe( 0.8 );

	} );

	it( 'preserves explicit admin raster appearance while acknowledging inactive path settings and stale UI copies', () => {

		const value = rasterInput();
		const result = convertAdminProjectToStudentPreset( value );
		expect( result.diagnostics.filter( item => item.severity === 'error' ) ).toEqual( [] );
		expect( result.ok ).toBe( true );
		expect( result.document.shots.converted.snapshot.rasterAppearance ).toEqual( value.capture.snapshot.rasterAppearance );
		expect( result.diagnostics ).toContainEqual( expect.objectContaining( { code: 'PATH_SETTING_OMITTED', path: 'render.engine.saturation' } ) );
		expect( result.document.shots.converted.snapshot.camera.exposure ).not.toBe( 999 );

	} );

	it.each( [
		[ 'engine', 'backgroundIntensity', 9 ],
		[ 'engine', 'exposure', 999 ],
		[ 'engine', 'groundProjectionEnabled', true ],
		[ 'engine', 'enableGroundCatcher', true ],
		[ 'ui', 'autoExposure', true ],
		[ 'ui', 'maxTextureSize', 4096 ],
		[ 'ui', 'inventedColourGrade', 1.5 ],
	] )( 'blocks unsupported or inconsistent raster setting %s.%s', ( scope, field, setting ) => {

		const value = rasterInput();
		value.source.render[ scope ][ field ] = setting;
		const result = convertAdminProjectToStudentPreset( value );
		expect( result.document ).toBeNull();
		expect( result.diagnostics ).toContainEqual( expect.objectContaining( { code: 'UNSUPPORTED_RENDER_STATE', path: `render.${scope}.${field}` } ) );

	} );

	it.each( [
		[ 'STALE_CAPTURE', value => value.capture.sourceRevision ++ ],
		[ 'INVALID_ADMIN_PROJECT', value => value.source.scene.lights = {} ],
		[ 'INVALID_ADMIN_PROJECT', value => delete value.source.scene.units ],
		[ 'UNMAPPED_ASSET', value => value.mapping.assets[ value.source.scene.assets[ 0 ].instanceId ].assetVersion ++ ],
		[ 'UNMAPPED_NODE', value => delete value.mapping.nodes[ Object.keys( value.mapping.nodes )[ 0 ] ] ],
		[ 'NODE_CAPTURE_MISMATCH', value => Object.values( value.capture.snapshot.nodes )[ 0 ].transform.position[ 0 ] ++ ],
		[ 'CAMERA_CAPTURE_MISMATCH', value => value.capture.snapshot.camera.projection.fov ++ ],
		[ 'CAMERA_CAPTURE_MISMATCH', value => value.source.cameras.ui = { sensorWidth: 70 } ],
		[ 'CAMERA_CAPTURE_MISMATCH', value => value.source.cameras.autoFocusMode = 'auto' ],
		[ 'UNSUPPORTED_MATERIAL_OVERRIDE', value => value.source.scene.materials.edited = { roughness: 0.3 } ],
		[ 'UNMAPPED_ENVIRONMENT', value => value.source.scene.environment.catalogId = 'unpublished' ],
		[ 'UNSUPPORTED_RENDER_STATE', value => value.source.render.engine = { saturation: 1.2 } ],
		[ 'UNSUPPORTED_RENDER_STATE', value => value.source.render.engine = { groundProjectionEnabled: true } ],
		[ 'UNSUPPORTED_RENDER_STATE', value => value.source.render.ui = { environmentMode: 'procedural' } ],
		[ 'UNSUPPORTED_EXTENSIONS', value => value.source.extensions.customRig = { enabled: true } ],
		[ 'INVALID_STUDENT_CAPTURE', value => delete value.capture.snapshot.camera.projection.zoom ],
		[ 'UNSUPPORTED_DOOR_ANGLES', value => Object.values( value.capture.snapshot.nodes )[ 0 ].doorAngles.left = 0.4 ],
	] )( 'reports %s and publishes no partial document', ( code, mutate ) => {

		const value = input();
		mutate( value );
		const result = convertAdminProjectToStudentPreset( value );
		expect( codes( result ) ).toContain( code );
		expect( result.ok ).toBe( false );
		expect( result.document ).toBeNull();

	} );

	it( 'rejects two admin nodes mapped to the same portable instance', () => {

		const value = input();
		const [ first, second ] = Object.keys( value.mapping.nodes );
		value.mapping.nodes[ second ] = clone( value.mapping.nodes[ first ] );
		expect( codes( convertAdminProjectToStudentPreset( value ) ) ).toContain( 'UNMAPPED_NODE' );

	} );

	it( 'compares actual captured linear light colour against the quantized admin descriptor', () => {

		const value = input();
		const color = new Color( '#f0c080' );
		value.source.scene.lights = [ { uuid: 'admin-light-uuid', type: 'SpotLight', visible: true, position: [ 0, 2, 1 ], color: '#f0c080', intensity: 45, angle: 30, distance: 100, decay: 2, radius: 0.1, penumbra: 0.3, target: [ 0, 1, 0 ], temperature: 4000, useTemperature: true, exposure: 0.5 } ];
		value.mapping.lights = { 'admin-light-uuid': 'key' };
		value.capture.snapshot.lights = [ { lightId: 'key', type: 'spot', transform: { ...transform(), position: [ 0, 2, 1 ] }, color: color.toArray(), intensity: 45, emission: { temperature: 4000, useTemperature: true, exposure: 0.5 }, target: [ 0, 1, 0 ], parameters: { distance: 100, decay: 2, radius: 0.1, angle: Math.PI / 6, penumbra: 0.3 } } ];
		const result = convertAdminProjectToStudentPreset( value );
		expect( result.diagnostics.filter( item => item.severity === 'error' ) ).toEqual( [] );
		expect( result.document.shots.converted.snapshot.lights[ 0 ].color ).toEqual( color.toArray() );
		value.source.scene.lights[ 0 ].gobo = 'unversioned.png';
		expect( codes( convertAdminProjectToStudentPreset( value ) ) ).toContain( 'UNSUPPORTED_FIELD' );

	} );

	it( 'rejects admin LED UV placement and file identity rather than silently losing them', () => {

		const value = input();
		value.source.led = [ { wallInstanceId: 'wall', placement: { scale: { x: 0.7, y: 1 } }, video: { name: 'teacher.mp4', currentTime: 1 } } ];
		expect( codes( convertAdminProjectToStudentPreset( value ) ) ).toContain( 'UNMAPPED_LED_WALL' );

	} );

	it( 'preserves real welcome LED placement/nits and a blank wall with actual verified local model/video bytes', () => {

		const value = input( 'led' );
		const result = convertAdminProjectToStudentPreset( value );
		expect( result.diagnostics.filter( item => item.severity === 'error' ) ).toEqual( [] );
		expect( result.ok ).toBe( true );
		const walls = result.document.shots.converted.snapshot.ledWalls;
		expect( walls ).toEqual( value.capture.snapshot.ledWalls );
		expect( walls.map( wall => wall.brightnessNits ) ).toEqual( [ 558, 1510, 10000 ] );
		expect( walls[ 0 ] ).toMatchObject( { inPointUs: 7903555, placement: { position: [ 0.44667986527543957, 0.5439198073780784 ], scale: [ 0.75, 1 ], fitMode: 'contain', aspectRatioLocked: true } } );
		expect( walls[ 2 ] ).toMatchObject( { media: null, mode: 'freeze', inPointUs: 0 } );
		expect( JSON.stringify( result.document ) ).not.toMatch( /wallInstanceId|sourceVideo|lastModified|led-test-h264\.mp4/ );
		value.capture.snapshot.ledWalls[ 0 ].placement.position[ 0 ] = 99;
		expect( walls[ 0 ].placement.position[ 0 ] ).toBe( 0.44667986527543957 );

	} );

	it.each( [
		[ 'LED_CAPTURE_MISMATCH', value => value.capture.snapshot.ledWalls[ 0 ].brightnessNits ++ ],
		[ 'LED_CAPTURE_MISMATCH', value => value.capture.snapshot.ledWalls[ 0 ].placement.rotationDegrees = 45 ],
		[ 'LED_CAPTURE_MISMATCH', value => value.capture.snapshot.ledWalls[ 0 ].placement.scale[ 0 ] = 0.4 ],
		[ 'LED_CAPTURE_MISMATCH', value => value.capture.snapshot.ledWalls[ 0 ].placement.aspectRatioLocked = false ],
		[ 'LED_CAPTURE_MISMATCH', value => value.capture.snapshot.ledWalls[ 0 ].surface = { ...value.capture.snapshot.ledWalls[ 0 ].surface, flipU: true } ],
		[ 'LED_CAPTURE_MISMATCH', value => value.capture.snapshot.ledWalls[ 0 ].inPointUs ++ ],
		[ 'LED_CAPTURE_MISMATCH', value => value.mapping.ledWalls[ value.source.led[ 0 ].wallInstanceId ].mode = 'freeze' ],
		[ 'UNVERIFIED_LED_MEDIA', value => value.mapping.ledWalls[ value.source.led[ 0 ].wallInstanceId ].sourceVideo.name = 'same-size-other-file.mp4' ],
		[ 'UNVERIFIED_LED_MEDIA', value => value.mapping.ledWalls[ value.source.led[ 0 ].wallInstanceId ].media = { assetId: 'test-blue-led', version: 'unverified' } ],
		[ 'UNVERIFIED_LED_MEDIA', value => value.source.led[ 0 ].video.size ++ ],
		[ 'UNMAPPED_LED_WALL', value => value.mapping.ledWalls[ value.source.led[ 0 ].wallInstanceId ].nodeInstanceId = Object.keys( value.capture.snapshot.nodes )[ 0 ] ],
		[ 'LED_CAPTURE_MISMATCH', value => value.mapping.ledWalls[ value.source.led[ 2 ].wallInstanceId ].media = { assetId: 'test-blue-led', version: 'fixture-1' } ],
		[ 'LED_INVENTORY_MISMATCH', value => value.mapping.ledWalls.extra = clone( Object.values( value.mapping.ledWalls )[ 0 ] ) ],
		[ 'UNSUPPORTED_FIELD', value => value.source.led[ 0 ].placement.unknownCrop = true ],
	] )( 'blocks mismatched LED state with %s', ( code, mutate ) => {

		const value = input( 'led' );
		mutate( value );
		const result = convertAdminProjectToStudentPreset( value );
		expect( codes( result ) ).toContain( code );
		expect( result.document ).toBeNull();

	} );

	it( 'leaves the current representative welcome project blocked by explicit appearance/media diagnostics', async () => {

		const value = input();
		value.source = JSON.parse( await readFile( new URL( '../../../app/src/data/default-scene.json', import.meta.url ), 'utf8' ) );
		value.capture.sourceProjectId = value.source.projectId;
		value.capture.sourceRevision = value.source.revision;
		const result = convertAdminProjectToStudentPreset( value );
		expect( result.ok ).toBe( false );
		expect( codes( result ) ).toContain( 'UNMAPPED_LED_WALL' );
		expect( result.diagnostics ).toContainEqual( expect.objectContaining( { path: 'render.engine.saturation', code: 'UNSUPPORTED_RENDER_STATE' } ) );

	} );

} );
