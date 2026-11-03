import { describe, expect, it } from 'vitest';
import { toEditorAxes, toEngineAxes } from '../../../app/src/utils/editorCoordinates.js';

describe( 'editor coordinates', () => {

	it( 'maps engine Y to Unreal Z and round-trips saved coordinates', () => {

		const stored = [ 3, 7, 11 ];
		expect( toEditorAxes( stored ) ).toEqual( [ 3, 11, 7 ] );
		expect( toEngineAxes( toEditorAxes( stored ) ) ).toEqual( stored );

	} );

} );
