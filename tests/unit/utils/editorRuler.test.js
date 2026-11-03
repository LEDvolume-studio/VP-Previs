import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import {
	constrainRulerPoint, rulerLength, rulerPointFromClient, rulerScreenPoint,
} from '../../../app/src/utils/editorRuler.js';

const rect = { left: 100, top: 50, width: 800, height: 400 };
const target = new Vector3( 2, 3, 4 );

function cameraFor( mode ) {

	const camera = new OrthographicCamera( - 10, 10, 5, - 5, 0.1, 100 );
	const offset = mode === 'top' ? [ 0, 20, 0 ] : mode === 'front' ? [ 0, 0, 20 ] : [ 20, 0, 0 ];
	camera.position.copy( target ).add( new Vector3( ...offset ) );
	camera.up.set( ...( mode === 'top' ? [ 0, 0, - 1 ] : [ 0, 1, 0 ] ) );
	camera.lookAt( target );
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld( true );
	return camera;

}

describe( 'orthographic ruler geometry', () => {

	it( 'maps the canvas centre to the camera target for all views and projects it back', () => {

		for ( const mode of [ 'top', 'front', 'side' ] ) {

			const camera = cameraFor( mode );
			const point = rulerPointFromClient( camera, target, mode, rect, 500, 250 );
			point.forEach( ( value, i ) => expect( value ).toBeCloseTo( target.toArray()[ i ] ) );
			expect( rulerScreenPoint( camera, point, 800, 400 ) ).toEqual( { x: 400, y: 200 } );

		}

	} );

	it( 'keeps measurements in metres when zoom changes', () => {

		const camera = cameraFor( 'front' );
		const start = rulerPointFromClient( camera, target, 'front', rect, 500, 250 );
		const end = rulerPointFromClient( camera, target, 'front', rect, 900, 250 );
		expect( rulerLength( start, end ) ).toBeCloseTo( 10 );
		camera.zoom = 2;
		camera.updateProjectionMatrix();
		expect( rulerLength( start, end ) ).toBeCloseTo( 10 );
		expect( rulerScreenPoint( camera, end, 800, 400 ).x ).toBeCloseTo( 1200 );

	} );

	it( 'constrains Shift to the nearest horizontal or vertical axis in each view', () => {

		expect( constrainRulerPoint( [ 0, 0, 0 ], [ 5, 0, 2 ], 'top', true ) ).toEqual( [ 5, 0, 0 ] );
		expect( constrainRulerPoint( [ 0, 0, 0 ], [ 5, 7, 0 ], 'front', true ) ).toEqual( [ 0, 7, 0 ] );
		expect( constrainRulerPoint( [ 0, 0, 0 ], [ 0, 7, 2 ], 'side', true ) ).toEqual( [ 0, 7, 0 ] );
		expect( constrainRulerPoint( [ 0, 0, 0 ], [ 5, 7, 2 ], 'front', false ) ).toEqual( [ 5, 7, 2 ] );

	} );

} );
