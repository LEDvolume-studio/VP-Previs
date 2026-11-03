import { expect, it } from 'vitest';
import { ledBlurKernel, validateLEDBlur } from '../../../app/src/previs/media/LEDBlur.js';
import { createInspectorLEDBlurEdit } from '../../../app/src/student/editor/ShotInspectorEdits.js';
import { validateStudentProjectDocument, prepareStudentProjectExport, importStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { applyStudentCommand } from '../../../app/src/previs/domain/StudentCommands.js';
import { studentFixture } from './studentFixtures.js';

it.each( [ 'fast', 'gaussian', 'lens' ] )( '%s blur preserves constant brightness and has a bounded kernel', method => {

	const kernel = ledBlurKernel( method );
	expect( kernel.reduce( ( sum, item ) => sum + item[ 2 ], 0 ) ).toBeCloseTo( 1, 12 );
	for ( const [ x, y, weight ] of kernel ) {

		expect( Math.abs( x ) ).toBeLessThanOrEqual( 1 ); expect( Math.abs( y ) ).toBeLessThanOrEqual( 1 ); expect( weight ).toBeGreaterThan( 0 );
		if ( method === 'lens' ) expect( Math.hypot( x, y ) ).toBeLessThanOrEqual( 1 );

	}

} );

it.each( [ { method: 'unknown', amount: 2 }, { method: 'lens', amount: - 1 }, { method: 'lens', amount: NaN }, { method: 'fast', amount: 41 }, { method: 'off', amount: 0, extra: 1 } ] )( 'rejects invalid settings %j', value => expect( () => validateLEDBlur( value ) ).toThrow() );

it( 'round trips per-screen blur through commands, undo and portable project export', () => {

	const document = studentFixture(), shot = document.shots.shotA;
	shot.snapshot.ledWalls = [ {
		wallId: 'screen', presentationVersion: 1, nodeInstanceId: 'carInstance', media: null, mode: 'freeze', inPointUs: 0, loop: false, playbackRate: 1, brightnessNits: 300,
		placement: { position: [ 0.5, 0.5 ], scale: [ 1, 1 ], rotationDegrees: 0, aspectRatioLocked: true, fitMode: 'contain' },
		surface: { nativeCanvas: [ 1920, 1080 ], uvChannel: 0, uvBounds: [ 0, 1, 0, 1 ], flipU: false },
	} ];
	const before = structuredClone( document );
	const replacement = createInspectorLEDBlurEdit( shot, 'screen', { method: 'lens', amount: 20 } );
	const result = applyStudentCommand( document, { type: 'replaceShot', shot: replacement } );
	expect( validateStudentProjectDocument( result.document ) ).toBe( true );
	expect( document ).toEqual( before );
	const imported = importStudentProjectDocument( prepareStudentProjectExport( result.document ) );
	expect( imported.shots.shotA.snapshot.ledWalls[ 0 ].blur ).toEqual( { method: 'lens', amount: 20 } );
	expect( applyStudentCommand( result.document, result.inverse ).document.shots ).toEqual( before.shots );
	result.document.shots.shotA.snapshot.ledWalls[ 0 ].blur.amount = 41;
	expect( () => validateStudentProjectDocument( result.document ) ).toThrow();

} );
