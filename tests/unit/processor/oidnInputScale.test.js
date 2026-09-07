import { describe, expect, it } from 'vitest';
import { oidnInputScale } from '@/core/Passes/OIDNDenoiser.js';

describe( 'OIDN input scale', () => {

	it( 'stays finite when path-traced input contains NaN or infinities', () => {

		const pixels = new Float32Array( [
			Number.NaN, 1, 2, 1,
			Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5, 1,
		] );

		const scale = oidnInputScale( pixels, 2 );
		expect( Number.isFinite( scale ) ).toBe( true );
		expect( scale ).toBeGreaterThan( 0 );
		expect( scale ).toBe( oidnInputScale( new Float32Array( [
			0, 1, 2, 1,
			1e7, 0, 0.5, 1,
		] ), 2 ) );

	} );

	it( 'returns the neutral fallback for an invalid empty input', () => {

		expect( oidnInputScale( new Float32Array(), 0 ) ).toBe( 1 );

	} );

} );
