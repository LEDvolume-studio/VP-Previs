import { describe, expect, it } from 'vitest';
import { Color, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { createCameraShotEdit, createLEDShotEdit, createLightShotEdit, createNodeShotEdit } from '../../../app/src/previs/domain/StudentShotEdits.js';
import { applyStudentCommand } from '../../../app/src/previs/domain/StudentCommands.js';
import { validateStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { studentFixture, TEST_NOW } from './studentFixtures.js';

const cameraValues = () => ( { position: [ 4, 3, 8 ], target: [ 0, 1, 0 ], fov: 48, exposure: 0.35, frameOverlayRatio: '4:3' } );
const ledValues = () => ( { wallId: 'wall', mode: 'freeze', inPointFrames: 12, loop: false, brightnessNits: 320 } );

function editingFixture() {

	const document = studentFixture();
	const snapshot = document.shots.shotA.snapshot;
	snapshot.nodes.humanInstance = { ...structuredClone( snapshot.nodes.carInstance ), nodeId: 'human', humanPose: 'standing' };
	snapshot.ledWalls = [ {
		wallId: 'wall', presentationVersion: 1, nodeInstanceId: 'carInstance',
		media: { assetId: 'video', version: '1' }, mode: 'play', inPointUs: 800000, loop: true, playbackRate: 1.5,
		brightnessNits: 558, placement: { position: [ 0.446, 0.544 ], scale: [ 0.75, 1 ], rotationDegrees: - 37, aspectRatioLocked: true, fitMode: 'contain' },
		surface: { nativeCanvas: [ 6144, 2592 ], uvChannel: 1, uvBounds: [ - 0.0007, 1, 0.2888, 0.7109 ], flipU: true },
	} ];
	return document;

}

function freeze( value ) {

	if ( value && typeof value === 'object' ) {

		Object.values( value ).forEach( freeze );
		Object.freeze( value );

	}

	return value;

}

const apply = ( document, command ) => applyStudentCommand( document, command, { now: TEST_NOW } );

describe( 'simplified camera shot edits', () => {

	it.each( [
		[[ 0, 0, 1 ], [ 0, 0, 0 ]],
		[[ 0, 0, - 1 ], [ 0, 0, 0 ]],
		[[ 1, 0, 0 ], [ 0, 0, 0 ]],
		[[ - 1, 0, 0 ], [ 0, 0, 0 ]],
		[[ 4, 3, 8 ], [ - 2, 1, - 3 ]],
		[[ - 8, - 3, - 4 ], [ 2, 1, 3 ]],
		[[ 1e-9, 10, 0 ], [ 0, 0, 0 ]],
	] )( 'matches the existing Three camera orientation from %j toward %j', ( position, target ) => {

		const shot = freeze( editingFixture().shots.shotA );
		const edited = createCameraShotEdit( shot, { ...cameraValues(), position, target } );
		const expected = new Quaternion().setFromRotationMatrix( new Matrix4().lookAt( new Vector3( ...position ), new Vector3( ...target ), new Vector3( 0, 1, 0 ) ) );
		const actual = new Quaternion( ...edited.snapshot.camera.transform.quaternion );
		expect( Math.abs( actual.dot( expected ) ) ).toBeCloseTo( 1, 14 );
		expect( actual.length() ).toBeCloseTo( 1, 14 );
		const direction = new Vector3( 0, 0, - 1 ).applyQuaternion( actual );
		expect( direction.distanceTo( new Vector3( ...target ).sub( new Vector3( ...position ) ).normalize() ) ).toBeLessThan( 1e-12 );

	} );

	it.each( [[ 16 / 9, 1 ], [ 3 / 4, 2 ]] )( 'updates focal length from existing film gauge and aspect, keeping zoom (%s, %s)', ( aspect, zoom ) => {

		const shot = editingFixture().shots.shotA;
		Object.assign( shot.snapshot.camera.projection, { aspect, zoom, filmGauge: 43, filmOffset: 2 } );
		const before = structuredClone( shot );
		const values = freeze( cameraValues() );
		const edited = createCameraShotEdit( freeze( shot ), values );
		const expectedCamera = new PerspectiveCamera( values.fov, 16 / 9 );
		expectedCamera.filmGauge = 43;
		expectedCamera.zoom = zoom;
		expect( edited.snapshot.camera.lens.focalLength ).toBeCloseTo( expectedCamera.getFocalLength(), 12 );
		const expected = structuredClone( before );
		Object.assign( expected.snapshot.camera, { target: [ ...values.target ], exposure: values.exposure, frameOverlayRatio: values.frameOverlayRatio } );
		Object.assign( expected.snapshot.camera.transform, { position: [ ...values.position ], quaternion: edited.snapshot.camera.transform.quaternion } );
		expected.snapshot.camera.projection.fov = values.fov;
		expected.snapshot.camera.projection.aspect = 16 / 9;
		expected.snapshot.camera.lens.focalLength = expectedCamera.getFocalLength();
		expect( edited ).toEqual( expected );
		expect( shot ).toEqual( before );
		edited.snapshot.camera.lens.afScreenPoint[ 0 ] = 0.9;
		edited.snapshot.nodes.carInstance.transform.position[ 0 ] = 100;
		expect( shot ).toEqual( before );

	} );

	it.each( [
		{ fov: 0.5 }, { fov: 179.1 }, { fov: Infinity }, { exposure: - 1 }, { exposure: NaN },
		{ position: [ 1, 2 ] }, { position: [ 0, undefined, 0 ] }, { target: [ 0, NaN, 0 ] },
		{ position: [ 0, 0, 0 ], target: [ 0, 0, 0 ] },
		{ position: [ 0, 0, 0 ], target: [ 0, 1, 0 ] },
		{ position: [ 0, 0, 0 ], target: [ 0, - 1, 0 ] },
		{ position: [ Number.MAX_VALUE, 0, 0 ], target: [ - Number.MAX_VALUE, 0, 0 ] },
		{ frameOverlayRatio: 'cinema' }, { focusDistance: 12 },
	] )( 'rejects invalid camera input atomically: %j', values => {

		const shot = editingFixture().shots.shotA;
		const before = structuredClone( shot );
		expect( () => createCameraShotEdit( freeze( shot ), { ...cameraValues(), ...values } ) ).toThrow();
		expect( shot ).toEqual( before );

	} );

	it( 'requires the complete exposed form and does not invent a perspective conversion', () => {

		const shot = editingFixture().shots.shotA;
		expect( () => createCameraShotEdit( shot, { fov: 50 } ) ).toThrow( /Missing/ );
		shot.snapshot.camera.projection.type = 'orthographic';
		expect( () => createCameraShotEdit( shot, cameraValues() ) ).toThrow( /perspective/ );

	} );

	it( 'uses the schema exposure range and accepts inclusive UI FOV bounds', () => {

		const shot = editingFixture().shots.shotA;
		for ( const fov of [ 1, 179 ] ) {

			const replacement = createCameraShotEdit( shot, { ...cameraValues(), fov, exposure: 120 } );
			expect( replacement.snapshot.camera.exposure ).toBe( 120 );
			expect( replacement.snapshot.camera.projection.fov ).toBe( fov );

		}

	} );

	it( 'preserves authored camera roll and focal length when changing only exposure or framing', () => {

		const shot = editingFixture().shots.shotA;
		shot.snapshot.camera.transform.quaternion = new Quaternion().setFromAxisAngle( new Vector3( 0, 0, 1 ), 0.4 ).toArray();
		const before = structuredClone( shot );
		const values = { position: [ 0, 0, 0 ], target: [ 0, 0, - 1 ], fov: 50, exposure: 0.75, frameOverlayRatio: '2.40:1' };
		const edited = createCameraShotEdit( freeze( shot ), values );
		const expected = structuredClone( before );
		expected.snapshot.camera.exposure = 0.75;
		expected.snapshot.camera.frameOverlayRatio = '2.40:1';
		expect( edited ).toEqual( expected );
		const changedFov = createCameraShotEdit( shot, { ...values, fov: 65 } );
		expect( changedFov.snapshot.camera.lens.focalLength ).not.toBe( shot.snapshot.camera.lens.focalLength );
		expect( changedFov.snapshot.camera.transform.quaternion ).toEqual( shot.snapshot.camera.transform.quaternion );

	} );

} );

describe( 'simplified node and light shot edits', () => {

	it( 'moves a node while preserving rotation, scale, visibility, doors and sibling content', () => {

		const shot = editingFixture().shots.shotA;
		Object.assign( shot.snapshot.nodes.carInstance.transform, { quaternion: [ 0, 0.6, 0, 0.8 ], scale: [ 2, 3, 4 ], visible: false } );
		const expected = structuredClone( shot );
		expected.snapshot.nodes.carInstance.transform.position = [ - 2, 1, 4 ];
		const input = freeze( { instanceId: 'carInstance', position: [ - 2, 1, 4 ] } );
		const edited = createNodeShotEdit( freeze( shot ), input );
		expect( edited ).toEqual( expected );
		edited.snapshot.nodes.humanInstance.transform.position[ 0 ] = 22;
		expect( shot.snapshot.nodes.humanInstance.transform.position[ 0 ] ).toBe( 0 );

	} );

	it( 'changes a recognized human pose and position without touching car doors', () => {

		const shot = freeze( editingFixture().shots.shotA );
		const edited = createNodeShotEdit( shot, { instanceId: 'humanInstance', position: [ 2, 0, 0 ], humanPose: 'sitting' } );
		expect( edited.snapshot.nodes.humanInstance.humanPose ).toBe( 'sitting' );
		expect( edited.snapshot.nodes.humanInstance.transform.position ).toEqual( [ 2, 0, 0 ] );
		expect( edited.snapshot.nodes.carInstance ).toEqual( shot.snapshot.nodes.carInstance );

	} );

	it.each( [
		{ instanceId: 'missing', position: [ 0, 0, 0 ] },
		{ instanceId: 'carInstance', position: [ 0, 0, 0 ], humanPose: 'sitting' },
		{ instanceId: 'humanInstance', position: [ 0, 0, 0 ], humanPose: 'running' },
		{ instanceId: 'humanInstance', position: [ 0, 0, 0 ], yawDegrees: 90 },
		{ instanceId: 'humanInstance', position: [ NaN, 0, 0 ] },
		{ instanceId: 'humanInstance', position: [ 0, 0, 0 ], humanPose: undefined },
	] )( 'rejects invalid node changes atomically: %j', values => {

		expect( () => createNodeShotEdit( freeze( editingFixture().shots.shotA ), values ) ).toThrow();

	} );

	it( 'sets intensity without dropping emission, shape parameters, orientation or color', () => {

		const shot = freeze( editingFixture().shots.shotA );
		const expected = structuredClone( shot );
		expected.snapshot.lights[ 0 ].intensity = 0;
		const edited = createLightShotEdit( shot, { lightId: 'key', intensity: 0 } );
		expect( edited ).toEqual( expected );
		edited.snapshot.lights[ 0 ].emission.exposure = 9;
		expect( shot.snapshot.lights[ 0 ].emission.exposure ).toBe( 0 );

	} );

	it.each( [ '#000000', '#ffffff', '#1280Af', '#090a0b' ] )( 'stores %s as linear RGB, matching existing Three color semantics', color => {

		const edited = createLightShotEdit( freeze( editingFixture().shots.shotA ), { lightId: 'key', intensity: 14, color } );
		const expected = new Color( color ).toArray();
		edited.snapshot.lights[ 0 ].color.forEach( ( component, index ) => expect( component ).toBeCloseTo( expected[ index ], 8 ) );

	} );

	it.each( [
		{ lightId: 'absent', intensity: 1 }, { lightId: 'key', intensity: - 1 },
		{ lightId: 'key', intensity: Infinity }, { lightId: 'key', intensity: 1, color: '#fff' },
		{ lightId: 'key', intensity: 1, color: '#zzzzzz' }, { lightId: 'key', intensity: 1, color: undefined },
		{ lightId: 'key', intensity: 1, temperature: 5000 },
	] )( 'rejects invalid light changes: %j', values => {

		expect( () => createLightShotEdit( freeze( editingFixture().shots.shotA ), values ) ).toThrow();

	} );

} );

describe( 'explicit LED shot edits', () => {

	it( 'uses exact 25fps frame timestamps and preserves UV mapping, placement, playback rate and source identity', () => {

		const shot = freeze( editingFixture().shots.shotA );
		const expected = structuredClone( shot );
		Object.assign( expected.snapshot.ledWalls[ 0 ], { mode: 'freeze', inPointUs: 480000, loop: false, brightnessNits: 320 } );
		const edited = createLEDShotEdit( shot, freeze( ledValues() ) );
		expect( edited ).toEqual( expected );
		edited.snapshot.ledWalls[ 0 ].surface.uvBounds[ 0 ] = 99;
		expect( shot.snapshot.ledWalls[ 0 ].surface.uvBounds[ 0 ] ).toBe( - 0.0007 );

	} );

	it( 'preserves a blank wall while adjusting brightness, never inventing a media source', () => {

		const shot = editingFixture().shots.shotA;
		Object.assign( shot.snapshot.ledWalls[ 0 ], { media: null, mode: 'freeze', inPointUs: 0 } );
		const edited = createLEDShotEdit( freeze( shot ), { ...ledValues(), inPointFrames: 0, brightnessNits: 0 } );
		expect( edited.snapshot.ledWalls[ 0 ] ).toMatchObject( { media: null, mode: 'freeze', inPointUs: 0, brightnessNits: 0 } );
		for ( const values of [ { mode: 'play', inPointFrames: 0 }, { inPointFrames: 1 } ] ) expect( () => createLEDShotEdit( shot, { ...ledValues(), ...values } ) ).toThrow( /blank/ );

	} );

	it( 'preserves authored sub-frame microseconds unless a new in-point is explicitly supplied', () => {

		const shot = editingFixture().shots.shotA;
		shot.snapshot.ledWalls[ 0 ].inPointUs = 7893555;
		const values = { wallId: 'wall', mode: 'play', loop: false, brightnessNits: 777 };
		const edited = createLEDShotEdit( freeze( shot ), values );
		expect( edited.snapshot.ledWalls[ 0 ] ).toMatchObject( { inPointUs: 7893555, brightnessNits: 777, loop: false } );
		expect( createLEDShotEdit( shot, { ...values, inPointFrames: 197 } ).snapshot.ledWalls[ 0 ].inPointUs ).toBe( 7880000 );
		expect( shot.snapshot.ledWalls[ 0 ].inPointUs ).toBe( 7893555 );

	} );

	it.each( [
		{ wallId: 'missing' }, { mode: 'pause' }, { inPointFrames: - 1 }, { inPointFrames: 0.5 },
		{ inPointFrames: '12' }, { inPointFrames: Number.MAX_SAFE_INTEGER }, { loop: 1 },
		{ brightnessNits: - 1 }, { brightnessNits: NaN }, { playbackRate: 2 },
	] )( 'rejects invalid LED changes: %j', values => {

		expect( () => createLEDShotEdit( freeze( editingFixture().shots.shotA ), { ...ledValues(), ...values } ) ).toThrow();

	} );

	it( 'never reinterprets legacy brightness units as nits', () => {

		expect( () => createLEDShotEdit( freeze( studentFixture().shots.shotA ), ledValues() ) ).toThrow( /legacy brightness/ );

	} );

	it( 'leaves source-duration validation to the complete project transaction', () => {

		const document = editingFixture();
		const before = structuredClone( document );
		const shot = createLEDShotEdit( document.shots.shotA, { ...ledValues(), inPointFrames: 25 } );
		expect( () => apply( document, { type: 'replaceShot', shot } ) ).toThrow( /inPointUs/ );
		expect( document ).toEqual( before );

	} );

} );

describe( 'completed shot edit transactions', () => {

	it.each( [
		shot => createCameraShotEdit( shot, cameraValues() ),
		shot => createNodeShotEdit( shot, { instanceId: 'humanInstance', position: [ 2, 0, 1 ], humanPose: 'sitting' } ),
		shot => createLightShotEdit( shot, { lightId: 'key', intensity: 75, color: '#8090a0' } ),
		shot => createLEDShotEdit( shot, ledValues() ),
	] )( 'commits a full replacement with one revision and exact undo/redo', edit => {

		const original = freeze( editingFixture() );
		expect( validateStudentProjectDocument( original ) ).toBe( true );
		const shot = edit( original.shots.shotA );
		const result = apply( original, { type: 'replaceShot', shot } );
		expect( result.changed ).toBe( true );
		expect( result.document.revision ).toBe( 1 );
		expect( result.document.shots.shotA ).toEqual( shot );
		expect( result.document.shots.shotB ).toEqual( original.shots.shotB );
		expect( result.document.narration ).toEqual( original.narration );
		expect( result.document.clips ).toEqual( original.clips );
		const undone = apply( result.document, result.inverse );
		expect( undone.document.shots ).toEqual( original.shots );
		expect( undone.document.revision ).toBe( 2 );
		const redone = apply( undone.document, undone.inverse );
		expect( redone.document.shots ).toEqual( result.document.shots );
		expect( redone.document.revision ).toBe( 3 );

	} );

	it( 'does not revise a camera, node, light or LED form submitted unchanged', () => {

		const original = editingFixture();
		for ( const shot of [
			createCameraShotEdit( original.shots.shotA, { position: [ 0, 0, 0 ], target: [ 0, 0, - 1 ], fov: 50, exposure: 1, frameOverlayRatio: '16:9' } ),
			createNodeShotEdit( original.shots.shotA, { instanceId: 'humanInstance', position: [ 0, 0, 0 ], humanPose: 'standing' } ),
			createLightShotEdit( original.shots.shotA, { lightId: 'key', intensity: 5 } ),
			createLEDShotEdit( original.shots.shotA, { wallId: 'wall', mode: 'play', inPointFrames: 20, loop: true, brightnessNits: 558 } ),
		] ) expect( apply( original, { type: 'replaceShot', shot } ) ).toEqual( { document: original, changed: false, inverse: null } );

	} );

	it.each( [ null, [], {}, { unknown: 1 } ] )( 'rejects absent or unsupported form records: %j', values => {

		const shot = freeze( editingFixture().shots.shotA );
		for ( const edit of [ createCameraShotEdit, createNodeShotEdit, createLightShotEdit, createLEDShotEdit ] ) expect( () => edit( shot, values ) ).toThrow();

	} );

} );
