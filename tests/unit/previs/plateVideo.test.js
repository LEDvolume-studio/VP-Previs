import { describe, expect, it, vi } from 'vitest';
import { createPlateVideo } from '../../../app/src/services/plates/PlateVideo.js';

function fixture() {

	const canvas = new EventTarget(); canvas.getContext = () => ( {} );
	let clock = 0, next = 0; const callbacks = new Map();
	const requestFrame = callback => {

		callbacks.set( ++ next, callback ); return next;

	};

	const cancelFrame = id => callbacks.delete( id );
	const source = { manifest: { frameCount: 250, files: { 'front-hevc': { width: 1280, height: 890 } } }, duration: 10,
		drawAt: vi.fn( async time => ( { frame: Math.min( 249, Math.floor( time * 25 + 1e-7 ) ), timestamp: time } ) ), dispose: vi.fn().mockResolvedValue() };
	return { canvas, source, options: { canvas, now: () => clock, requestFrame, cancelFrame }, setClock: value => {

		clock = value;

	}, tick: async () => {

		const [ id, callback ] = callbacks.entries().next().value; callbacks.delete( id ); await callback();

	}, callbacks };

}

describe( 'decoded plate canvas media lifecycle', () => {

	it( 'changes view at the same frame and preserves paused state', async () => {

		const { source, options } = fixture();
		const video = await createPlateVideo( source, { ...options, initialTime: 4.32 } );
		await video.setPlateView( 'left' );
		expect( video.currentTime ).toBe( 4.32 ); expect( video.paused ).toBe( true ); expect( video.plateView ).toBe( 'left' );
		expect( source.drawAt.mock.calls.at( - 1 ) ).toMatchObject( [ 4.32, {}, { view: 'left' } ] );
		expect( video.videoHeight ).toBe( 890 ); video.load(); expect( source.dispose ).toHaveBeenCalledOnce();

	} );

	it( 'preserves playback and its clock after switching angles', async () => {

		const { source, options, setClock, tick } = fixture(), video = await createPlateVideo( source, options );
		await video.play(); setClock( 400 ); await tick(); expect( video.currentTime ).toBe( 0.4 );
		await video.setPlateView( 'rear' ); expect( video.currentTime ).toBe( 0.4 ); expect( video.paused ).toBe( false );
		setClock( 800 ); await tick(); expect( video.currentTime ).toBe( 0.8 ); expect( video.plateView ).toBe( 'rear' );
		video.pause(); expect( video.paused ).toBe( true ); video.load();

	} );

	it( 'cancels pending decode and animation on disposal without firing a late callback', async () => {

		const { source, options, setClock, tick, callbacks } = fixture(), video = await createPlateVideo( source, options );
		const callback = vi.fn(); video.requestVideoFrameCallback( callback );
		let finish;
		source.drawAt.mockImplementationOnce( ( time, context, { signal } ) => new Promise( ( resolve, reject ) => {

			finish = resolve; signal.addEventListener( 'abort', () => reject( signal.reason ), { once: true } );

		} ) );
		await video.play(); setClock( 400 ); const pending = tick();
		video.load(); finish( { frame: 10 } ); await pending;
		expect( callback ).not.toHaveBeenCalled(); expect( callbacks.size ).toBe( 0 ); expect( source.dispose ).toHaveBeenCalledOnce();

	} );

	it( 'reports ended on the exact last source frame and can restart', async () => {

		const { source, options, setClock, tick } = fixture(), video = await createPlateVideo( source, options );
		await video.play(); setClock( 10000 ); await tick();
		expect( video.ended ).toBe( true ); expect( video.paused ).toBe( true ); expect( video.currentTime ).toBe( 9.96 );
		await video.play(); expect( video.currentTime ).toBe( 0 ); expect( video.ended ).toBe( false ); video.load();

	} );

} );
