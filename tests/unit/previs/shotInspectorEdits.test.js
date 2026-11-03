import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { createInspectorCameraEdit } from '../../../app/src/student/editor/ShotInspectorEdits.js';
import { validateStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { studentFixture } from './studentFixtures.js';

describe( 'compact shot inspector camera edits', () => {

	it.each( [ 0.6, 1, 16 / 9, 2.4 ] )( 'matches Rayzee/Three focal length for aspect %s and preserves unexposed fields', aspect => {

		const document = studentFixture();
		const shot = document.shots.shotA;
		shot.snapshot.camera.projection.aspect = aspect;
		const source = structuredClone( shot );
		const replacement = createInspectorCameraEdit( shot, 'focalLength', 85 );
		const expected = new PerspectiveCamera();
		expected.aspect = aspect;
		expected.filmGauge = shot.snapshot.camera.projection.filmGauge;
		expected.setFocalLength( 85 );
		expect( replacement.snapshot.camera.projection.fov ).toBeCloseTo( expected.fov, 12 );
		expect( replacement.snapshot.camera.lens.focalLength ).toBe( 85 );
		const restored = structuredClone( replacement );
		restored.snapshot.camera.projection.fov = shot.snapshot.camera.projection.fov;
		restored.snapshot.camera.lens.focalLength = shot.snapshot.camera.lens.focalLength;
		expect( restored ).toEqual( source );
		expect( shot ).toEqual( source );
		document.shots.shotA = replacement;
		expect( validateStudentProjectDocument( document ) ).toBe( true );

	} );

	it( 'changes world Y while preserving heading, roll, target distance and all scene state', () => {

		const shot = studentFixture().shots.shotA;
		const before = structuredClone( shot );
		const camera = before.snapshot.camera;
		const replacement = createInspectorCameraEdit( shot, 'height', 3.25 );
		const updated = replacement.snapshot.camera;
		expect( updated.transform.position ).toEqual( [ camera.transform.position[ 0 ], 3.25, camera.transform.position[ 2 ] ] );
		expect( updated.target[ 1 ] - updated.transform.position[ 1 ] ).toBeCloseTo( camera.target[ 1 ] - camera.transform.position[ 1 ], 12 );
		expect( updated.transform.quaternion ).toEqual( camera.transform.quaternion );
		updated.transform.position = camera.transform.position;
		updated.target = camera.target;
		expect( replacement ).toEqual( before );
		expect( shot ).toEqual( before );

	} );

	it( 'changes only exposure, including zero, without reaiming the camera', () => {

		const shot = studentFixture().shots.shotA;
		const replacement = createInspectorCameraEdit( shot, 'exposure', 0 );
		expect( replacement.snapshot.camera.exposure ).toBe( 0 );
		replacement.snapshot.camera.exposure = shot.snapshot.camera.exposure;
		expect( replacement ).toEqual( shot );

	} );

	it.each( [[ 'focalLength', 0 ], [ 'focalLength', - 3 ], [ 'focalLength', 1e10 ], [ 'height', Infinity ], [ 'height', NaN ], [ 'exposure', - 0.1 ], [ 'unknown', 1 ]] )( 'rejects unsupported %s=%s without modifying the shot', ( field, value ) => {

		const shot = studentFixture().shots.shotA;
		const before = structuredClone( shot );
		expect( () => createInspectorCameraEdit( shot, field, value ) ).toThrow();
		expect( shot ).toEqual( before );

	} );

} );
