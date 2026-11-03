import { describe, expect, it, vi } from 'vitest';
import { RealtimeRenderer } from '../../../rayzee/src/managers/RealtimeRenderer.js';

describe( 'explicit raster output pixels', () => {

	it( 'ignores CSS, DPR and display limits for export, then resumes view sizing', () => {

		const canvas = { width: 300, height: 200, getBoundingClientRect: () => ( { width: 300, height: 200 } ) };
		const renderer = {
			domElement: canvas, shadowMap: {}, render: vi.fn(), setPixelRatio: vi.fn(),
			setSize: vi.fn( ( width, height ) => Object.assign( canvas, { width, height } ) ),
		};
		const manager = new RealtimeRenderer( { renderer, scene: {}, lightScene: {}, camera: {}, settings: {}, postProcessing: false } );
		manager.render( { width: 1920, height: 1080 } );
		expect( [ canvas.width, canvas.height ] ).toEqual( [ 1920, 1080 ] );
		expect( renderer.setPixelRatio ).toHaveBeenLastCalledWith( 1 );
		manager.render( { width: 4000, height: 3000 } );
		expect( canvas.width ).toBe( 4000 );
		manager.render();
		expect( [ canvas.width, canvas.height ] ).toEqual( [ 300, 200 ] );

	} );

	it.each( [ {}, { width: 1920 }, { width: NaN, height: 1080 }, { width: 0, height: 1080 }, { width: 1920.5, height: 1080 } ].slice( 1 ) )( 'rejects invalid dimensions before touching renderer: %j', size => {

		const manager = Object.create( RealtimeRenderer.prototype );
		manager.activate = vi.fn();
		expect( () => manager.render( size ) ).toThrow( /positive integer/ );
		expect( manager.activate ).not.toHaveBeenCalled();

	} );

} );
