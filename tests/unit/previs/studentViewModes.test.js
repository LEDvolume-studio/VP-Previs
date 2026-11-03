import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { studentFixture } from './studentFixtures.js';
import { createStudentViewModes } from '../../../app/src/student/StudentViewModes.js';

const state = camera => ( { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), projection: camera.projectionMatrix.toArray(), inverse: camera.projectionMatrixInverse.toArray(), fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far, scale: camera.scale.toArray(), visible: camera.visible, userData: structuredClone( camera.userData ) } );
function fixture() {

	const shot = new PerspectiveCamera( 35, 16 / 9, 0.1, 1000 );
	shot.position.set( 2, 3, 4 ); shot.lookAt( 0, 1, 0 ); shot.userData.clipStart = 0.4;
	const inspection = new PerspectiveCamera();
	const views = createStudentViewModes( { shotCamera: shot, inspectionCamera: inspection } );
	return { shot, inspection, views };

}

describe( 'Independent student shot and inspection camera views', () => {

	it( 'defaults to the photographic shot and initializes a separate inspection camera only on first entry', () => {

		const { shot, inspection, views } = fixture();
		expect( views.mode ).toBe( 'shot' );
		expect( views.initialized ).toBe( false );
		const authored = state( shot );
		views.setMode( 'inspection' );
		expect( state( inspection ) ).toEqual( authored );
		expect( inspection ).not.toBe( shot );
		inspection.position.x += 5;
		expect( state( shot ) ).toEqual( authored );

	} );

	it( 'preserves inspection exploration across shot edits, cuts and repeated mode changes', () => {

		const { shot, inspection, views } = fixture();
		views.setMode( 'inspection' );
		inspection.position.set( 12, 5, - 4 ); inspection.lookAt( 2, 0, 0 );
		const explored = state( inspection );
		for ( let index = 0; index < 24; index ++ ) {

			views.setMode( 'shot' ); shot.position.x = index; shot.fov = 40 + index; shot.updateProjectionMatrix();
			views.setMode( 'inspection' );
			expect( state( inspection ) ).toEqual( explored );

		}

	} );

	it( 'restores a workspace camera into a rebuilt viewport without initializing it from the new shot', () => {

		const { shot, inspection, views } = fixture();
		const snapshot = structuredClone( studentFixture().shots.shotA.snapshot.camera );
		snapshot.transform.position = [ 18, 6, - 9 ];
		snapshot.transform.quaternion = [ 0, 1, 0, 0 ];
		snapshot.projection.fov = 68;
		const authored = state( shot );
		views.restoreInspectionCamera( snapshot );
		expect( views.mode ).toBe( 'shot' );
		expect( views.initialized ).toBe( true );
		views.setMode( 'inspection' );
		expect( inspection.position.toArray() ).toEqual( snapshot.transform.position );
		expect( inspection.quaternion.toArray() ).toEqual( snapshot.transform.quaternion );
		expect( inspection.fov ).toBe( 68 );
		expect( state( shot ) ).toEqual( authored );
		views.setMode( 'shot' ); shot.position.set( - 3, 2, 1 ); views.setMode( 'inspection' );
		expect( inspection.position.toArray() ).toEqual( snapshot.transform.position );

	} );

	it( 'draws the independent camera through stable post-stack matrix references then restores exact authoring state', () => {

		const { shot, inspection, views } = fixture();
		views.setMode( 'inspection' );
		inspection.position.set( - 1, 7, 12 ); inspection.lookAt( 0, 0, 0 ); inspection.fov = 70; inspection.updateProjectionMatrix();
		const authored = state( shot );
		const nativeId = shot.uuid, projection = shot.projectionMatrix, inverse = shot.projectionMatrixInverse, world = shot.matrixWorld;
		const result = views.render( () => {

			expect( state( shot ) ).toEqual( state( inspection ) );
			expect( shot.uuid ).toBe( nativeId );
			expect( shot.projectionMatrix ).toBe( projection );
			expect( shot.projectionMatrixInverse ).toBe( inverse );
			expect( shot.matrixWorld ).toBe( world );
			return 'rendered';

		} );
		expect( result ).toBe( 'rendered' );
		expect( state( shot ) ).toEqual( authored );

	} );

	it( 'restores the shot camera even when inspection rendering fails', () => {

		const { shot, inspection, views } = fixture();
		views.setMode( 'inspection' ); inspection.position.set( 5, 6, 7 );
		const authored = state( shot );
		expect( () => views.render( () => {

			throw new Error( 'GPU frame failed' );

		} ) ).toThrow( 'GPU frame failed' );
		expect( state( shot ) ).toEqual( authored );
		views.setMode( 'shot' );
		views.render( () => {

			expect( state( shot ) ).toEqual( authored );

		} );

	} );

	it( 'rejects unknown modes and aliased native cameras without changing valid state', () => {

		const { shot, views } = fixture();
		expect( () => views.setMode( 'free-ish' ) ).toThrow( 'Unknown' );
		expect( views.mode ).toBe( 'shot' );
		expect( () => createStudentViewModes( { shotCamera: shot, inspectionCamera: shot } ) ).toThrow( 'Independent' );

	} );

} );
