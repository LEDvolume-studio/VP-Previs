import { describe, it, expect } from 'vitest';
import { generateViewportStyles } from '@/utils/viewport.js';

describe( 'generateViewportStyles', () => {

	it( 'returns wrapper, container, and canvas styles', () => {

		const styles = generateViewportStyles( 800, 600, 100 );
		expect( styles ).toHaveProperty( 'wrapperStyle' );
		expect( styles ).toHaveProperty( 'containerStyle' );
		expect( styles ).toHaveProperty( 'canvasStyle' );

	} );

	it( 'wrapper has correct dimensions and scale', () => {

		const styles = generateViewportStyles( 1024, 768, 50 );
		expect( styles.wrapperStyle.width ).toBe( '512px' );
		expect( styles.wrapperStyle.height ).toBe( '384px' );
		expect( styles.wrapperStyle.flex ).toBe( '0 0 auto' );

	} );

	it( 'container has correct dimensions', () => {

		const styles = generateViewportStyles( 512, 512, 100 );
		expect( styles.containerStyle.width ).toBe( '100%' );
		expect( styles.containerStyle.height ).toBe( '100%' );
		expect( styles.containerStyle.position ).toBe( 'relative' );

	} );

	it( 'canvas has absolute positioning', () => {

		const styles = generateViewportStyles( 800, 600, 100 );
		expect( styles.canvasStyle.position ).toBe( 'absolute' );
		expect( styles.canvasStyle.top ).toBe( 0 );
		expect( styles.canvasStyle.left ).toBe( 0 );
		expect( styles.canvasStyle.width ).toBe( '100%' );
		expect( styles.canvasStyle.height ).toBe( '100%' );

	} );

	it( 'zooms with real layout dimensions so flex cannot shrink one axis independently', () => {

		const styles = generateViewportStyles( 100, 100, 200 );
		expect( styles.wrapperStyle.width ).toBe( '200px' );
		expect( styles.wrapperStyle.height ).toBe( '200px' );
		expect( styles.wrapperStyle ).not.toHaveProperty( 'transform' );

	} );

} );
