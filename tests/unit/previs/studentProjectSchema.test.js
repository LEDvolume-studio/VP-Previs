import { describe, expect, it } from 'vitest';
import { createStudentProjectDocument, importStudentProjectDocument, migrateStudentProjectDocument, prepareStudentProjectExport, validateStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { studentFixture, TEST_NOW } from './studentFixtures.js';

describe( 'student portable schema', () => {

	it( 'creates an empty sequence independently of the admin project format', () => {

		const document = createStudentProjectDocument( { projectId: 'new', now: TEST_NOW } );
		expect( validateStudentProjectDocument( document ) ).toBe( true );
		expect( document ).toMatchObject( { format: 'rayzee-student-project', schemaVersion: 1, revision: 0, clips: [], output: { width: 1920, height: 1080, fps: 25 } } );
		expect( () => migrateStudentProjectDocument( { ...document, format: 'rayzee-project' } ) ).toThrow( /student/ );
		expect( () => migrateStudentProjectDocument( { ...document, schemaVersion: 2 } ) ).toThrow( /schema version/ );

	} );
	it( 'round trips all fixed-shot categories and independently clones imports/exports', () => {

		const document = studentFixture();
		const exported = prepareStudentProjectExport( document );
		expect( JSON.parse( JSON.stringify( exported ) ) ).toEqual( document );
		const imported = importStudentProjectDocument( exported, { projectId: 'new', now: '2026-10-22T00:00:00.000Z' } );
		expect( imported ).toMatchObject( { projectId: 'new', revision: 0, createdAt: '2026-10-22T00:00:00.000Z' } );
		expect( imported.shots ).toEqual( document.shots );
		imported.shots.shotA.snapshot.nodes.carInstance.transform.position[ 0 ] = 99;
		expect( document.shots.shotA.snapshot.nodes.carInstance.transform.position[ 0 ] ).toBe( 0 );
		expect( exported.shots.shotA.snapshot.nodes.carInstance.transform.position[ 0 ] ).toBe( 0 );

	} );
	it.each( [
		[ 'output fps', document => document.output.fps = 30 ],
		[ 'output width', document => document.output.width = 1280 ],
		[ 'world units', document => document.units.metresPerUnit = 100 ],
		[ 'negative revision', document => document.revision = - 1 ],
		[ 'fractional duration', document => document.clips[ 0 ].durationFrames = 1.1 ],
		[ 'empty duration', document => document.clips[ 0 ].durationFrames = 0 ],
		[ 'maximum total', document => document.clips[ 0 ].durationFrames = 22500 ],
		[ 'duplicate placement', document => document.clips[ 1 ].clipId = 'clipA' ],
		[ 'missing shot', document => document.clips[ 0 ].shotId = 'missing' ],
		[ 'missing base scene version', document => document.shots.shotA.baseScene.version = '2' ],
		[ 'missing model version', document => document.shots.shotA.snapshot.nodes.carInstance.asset.version = '2' ],
		[ 'missing LED version', document => document.shots.shotA.snapshot.ledWalls[ 0 ].media.version = '2' ],
		[ 'LED source past end', document => document.shots.shotA.snapshot.ledWalls[ 0 ].inPointUs = 1000000 ],
		[ 'LED invalid rate', document => document.shots.shotA.snapshot.ledWalls[ 0 ].playbackRate = - 1 ],
		[ 'live Three value', document => document.shots.shotA.snapshot.camera.transform.position = new Float32Array( 3 ) ],
		[ 'invalid quaternion', document => document.shots.shotA.snapshot.camera.transform.quaternion = [ 0, 0, 0, 2 ] ],
		[ 'nonfinite camera', document => document.shots.shotA.snapshot.camera.lens.focusDistance = Infinity ],
		[ 'obsolete autofocus enum', document => document.shots.shotA.snapshot.camera.lens.autoFocusMode = 'off' ],
		[ 'invalid focus smoothing', document => document.shots.shotA.snapshot.camera.lens.afSmoothingFactor = 1.1 ],
		[ 'invalid lens scale', document => document.shots.shotA.snapshot.camera.lens.unitsPerMetre = 0 ],
		[ 'unsupported framing overlay', document => document.shots.shotA.snapshot.camera.frameOverlayRatio = '1:1' ],
		[ 'negative ray clip', document => document.shots.shotA.snapshot.camera.projection.clipStart = - 1 ],
		[ 'invalid panorama bounds', document => document.shots.shotA.snapshot.camera.renderProjection.panoramaLatRange = [ - 91, 90 ] ],
		[ 'reversed panorama bounds', document => document.shots.shotA.snapshot.camera.renderProjection.panoramaLonRange = [ 20, - 20 ] ],
		[ 'invalid light', document => document.shots.shotA.snapshot.lights[ 0 ].parameters.penumbra = 2 ],
		[ 'nonfinite light emission', document => document.shots.shotA.snapshot.lights[ 0 ].emission.temperature = Infinity ],
		[ 'negative light radius', document => document.shots.shotA.snapshot.lights[ 0 ].parameters.radius = - 1 ],
		[ 'missing narration media', document => document.narration.clips[ 0 ].media.version = '2' ],
		[ 'sample overflow', document => document.narration.clips[ 0 ].lengthSamples = 480001 ],
		[ 'noninteger samples', document => document.narration.clips[ 0 ].sourceStartSample = 0.5 ],
		[ 'noncontiguous segment', document => document.narration.assets[ 'voice@1' ].segments[ 1 ].index = 4 ],
		[ 'incomplete bytes', document => document.narration.assets[ 'voice@1' ].segments.pop() ],
		[ 'invalid timestamp', document => document.updatedAt = 'yesterday' ],
		[ 'asset-key mismatch', document => document.assets[ 'car@1' ].version = '2' ],
	] )( 'rejects %s at content/import boundary', ( _, edit ) => {

		const document = studentFixture();
		edit( document );
		expect( () => validateStudentProjectDocument( document ) ).toThrow();
		expect( () => migrateStudentProjectDocument( document ) ).toThrow();

	} );
	it.each( [
		[ 'ambient', {} ],
		[ 'directional', { angle: 0.02 } ],
		[ 'point', { distance: 100, decay: 2, radius: 0.5 } ],
		[ 'spot', { distance: 100, decay: 2, radius: 0.5, angle: 0.4, penumbra: 0.5 } ],
		[ 'rectArea', { width: 2, height: 1, normalize: true, spread: Math.PI, shape: 'ellipse' } ],
		[ 'hemisphere', { groundColor: [ 0.1, 0.2, 0.3 ] } ],
	] )( 'preserves %s type-specific light settings', ( type, parameters ) => {

		const document = studentFixture();
		Object.assign( document.shots.shotA.snapshot.lights[ 0 ], { type, parameters } );
		expect( prepareStudentProjectExport( document ).shots.shotA.snapshot.lights[ 0 ].parameters ).toEqual( parameters );

	} );
	it( 'accepts exactly 22500 frames, including a retained orphan narration anchor', () => {

		const document = studentFixture();
		document.clips = [ { clipId: 'long', shotId: 'shotA', durationFrames: 22500 } ];
		expect( validateStudentProjectDocument( document ) ).toBe( true );

	} );
	it.each( [
		document => document.ownerCapability = 'private',
		document => document.sync = { capability: 'private' },
		document => document.assets[ 'video@1' ].url = 'https://private.invalid/video?token=private',
		document => document.shots.shotA.snapshot.camera.lens.fileHandle = {},
		document => document.shots.shotA.snapshot.nodes.carInstance.path = '/Users/private/model.glb',
		document => document.shots.shotA.snapshot.lights[ 0 ].parameters.gobo = 'unversioned-profile',
		document => document.shots.shotA.snapshot.lights[ 0 ].ies = 'unversioned-profile',
		document => document.narration.assets[ 'voice@1' ].segments[ 0 ].uploadToken = 'private',
	] )( 'rejects accidental private/implementation fields before portable export', edit => {

		const document = studentFixture();
		edit( document );
		expect( () => prepareStudentProjectExport( document ) ).toThrow( /unsupported field/ );

	} );

} );
