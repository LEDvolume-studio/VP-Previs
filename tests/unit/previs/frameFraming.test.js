import { describe, expect, it, vi } from 'vitest';
import { drawFramingBars, FRAMING_BAR_OPACITY, getFramingBars } from '../../../app/src/previs/engine/FrameFraming.js';

function context() {

	const stack = [];
	const state = { globalAlpha: 0.2, globalCompositeOperation: 'multiply', fillStyle: '#ffffff' };
	const surface = {
		canvas: { width: 1920, height: 1080 }, ...state,
		save: vi.fn( () => stack.push( { globalAlpha: surface.globalAlpha, globalCompositeOperation: surface.globalCompositeOperation, fillStyle: surface.fillStyle } ) ),
		restore: vi.fn( () => Object.assign( surface, stack.pop() ) ),
		resetTransform: vi.fn(),
		fillRect: vi.fn(),
	};
	return surface;

}

describe( 'shared preview/export framing bars', () => {

	it( 'leaves the complete 16:9 output undimmed', () => {

		expect( getFramingBars( '16:9', 1920, 1080 ) ).toEqual( [] );
		const surface = context();
		drawFramingBars( surface );
		expect( surface.save ).not.toHaveBeenCalled();
		expect( surface.fillRect ).not.toHaveBeenCalled();

	} );
	it( 'places exact 240-pixel side bars for 4:3 at 1920×1080', () => {

		expect( getFramingBars( '4:3', 1920, 1080 ) ).toEqual( [
			{ x: 0, y: 0, width: 240, height: 1080 },
			{ x: 1680, y: 0, width: 240, height: 1080 },
		] );

	} );
	it( 'places exact 140-pixel top/bottom bars for 2.40:1 at 1920×1080', () => {

		expect( getFramingBars( '2.40:1', 1920, 1080 ) ).toEqual( [
			{ x: 0, y: 0, width: 1920, height: 140 },
			{ x: 0, y: 940, width: 1920, height: 140 },
		] );

	} );
	it( 'uses exactly 50% source-over black without inheriting the caller alpha/transform', () => {

		const surface = context();
		const painted = [];
		surface.fillRect.mockImplementation( ( ...rect ) => painted.push( { rect, alpha: surface.globalAlpha, composite: surface.globalCompositeOperation, fill: surface.fillStyle } ) );
		drawFramingBars( surface, '4:3' );
		expect( FRAMING_BAR_OPACITY ).toBe( 0.5 );
		expect( painted ).toEqual( [
			{ rect: [ 0, 0, 240, 1080 ], alpha: 0.5, composite: 'source-over', fill: '#000000' },
			{ rect: [ 1680, 0, 240, 1080 ], alpha: 0.5, composite: 'source-over', fill: '#000000' },
		] );
		expect( surface.resetTransform ).toHaveBeenCalledOnce();
		expect( surface ).toMatchObject( { globalAlpha: 0.2, globalCompositeOperation: 'multiply', fillStyle: '#ffffff' } );
		expect( surface.restore ).toHaveBeenCalledOnce();

	} );
	it( 'restores the Canvas2D state even when compositing fails', () => {

		const surface = context();
		surface.fillRect.mockImplementationOnce( () => {

			throw new Error( 'surface lost' );

		} );
		expect( () => drawFramingBars( surface, '2.40:1' ) ).toThrow( 'surface lost' );
		expect( surface.restore ).toHaveBeenCalledOnce();
		expect( surface.globalAlpha ).toBe( 0.2 );

	} );
	it.each( [[ 0, 1080 ], [ 1920, - 1 ], [ NaN, 1080 ], [ 1920, Infinity ]] )( 'rejects invalid surface dimensions %s×%s before drawing', ( width, height ) => {

		expect( () => getFramingBars( '4:3', width, height ) ).toThrow( RangeError );

	} );
	it( 'rejects unsupported framing instead of guessing', () => {

		expect( () => getFramingBars( 'square', 1920, 1080 ) ).toThrow( /Unsupported framing/ );

	} );

} );
