import { describe, expect, it } from 'vitest';
import {
	SENSOR_ASPECT_RATIO,
	SENSOR_PRESETS,
	getFrameOverlayBars,
	sensorDimensionsFrom,
} from '@/utils/cameraSensor.js';

describe( 'camera sensor helpers', () => {

	it( 'defines every sensor preset at the fixed viewport ratio', () => {

		for ( const preset of Object.values( SENSOR_PRESETS ) ) {

			expect( preset.width / preset.height ).toBeCloseTo( SENSOR_ASPECT_RATIO );

		}

	} );

	it( 'locks custom dimensions to 16:9 from either field', () => {

		expect( sensorDimensionsFrom( 'width', 32 ) ).toEqual( { width: 32, height: 18 } );
		expect( sensorDimensionsFrom( 'height', 18 ) ).toEqual( { width: 32, height: 18 } );

	} );

	it( 'builds side masks for 4:3 and letterbox masks for 2.40:1', () => {

		expect( getFrameOverlayBars( '16:9' ) ).toBeNull();
		expect( getFrameOverlayBars( '4:3' ) ).toEqual( { orientation: 'vertical', size: 12.5 } );
		const widescreenBars = getFrameOverlayBars( '2.40:1' );
		expect( widescreenBars.orientation ).toBe( 'horizontal' );
		expect( widescreenBars.size ).toBeCloseTo( 12.96296, 4 );

	} );

} );
