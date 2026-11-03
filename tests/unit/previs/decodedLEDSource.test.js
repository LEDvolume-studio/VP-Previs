import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DecodedLEDSource } from '../../../app/src/previs/media/DecodedLEDSource.js';

const state = vi.hoisted( () => ( { input: null, track: null, getSample: null } ) );
vi.mock( 'mediabunny', () => ( {
	ALL_FORMATS: [], BlobSource: class {},
	Input: class {

		constructor() {

			return state.input;

		}

	},
	VideoSampleSink: class {

		constructor() {

			return { getSample: state.getSample };

		}

	},
} ) );

beforeEach( () => {

	state.track = { canDecode: vi.fn().mockResolvedValue( true ), computeDuration: vi.fn().mockResolvedValue( 3 ) };
	state.input = { getPrimaryVideoTrack: vi.fn( async () => state.track ), dispose: vi.fn() };
	state.getSample = vi.fn();

} );
const context = () => ( { canvas: { width: 320, height: 180 } } );
const sample = timestamp => ( { timestamp, duration: 0.04, close: vi.fn(), draw: vi.fn() } );

describe( 'decoded LED source completion ownership', () => {

	it( 'closes input when video decoding is unsupported', async () => {

		state.track.canDecode.mockResolvedValue( false );
		await expect( DecodedLEDSource.open( new Blob() ) ).rejects.toThrow( /decodable/ );
		expect( state.input.dispose ).toHaveBeenCalledOnce();

	} );

	it( 'invalid times do not ask the decoder for an arbitrary frame', async () => {

		const source = await DecodedLEDSource.open( new Blob() );
		for ( const time of [ NaN, - 1, 3, Infinity ] ) await expect( source.drawAt( time, context() ) ).rejects.toThrow( /outside/ );
		expect( state.getSample ).not.toHaveBeenCalled();

	} );

	it( 'rapid A→B→A only paints the final generation and closes all samples', async () => {

		const finish = [];
		state.getSample.mockImplementation( () => new Promise( resolve => finish.push( resolve ) ) );
		const source = await DecodedLEDSource.open( new Blob() );
		const target = context();
		const first = source.drawAt( 1, target );
		const middle = source.drawAt( 2, target );
		const latest = source.drawAt( 1, target );
		const samples = [ sample( 1 ), sample( 2 ), sample( 1 ) ];
		finish[ 2 ]( samples[ 2 ] );
		expect( await latest ).toEqual( { timestamp: 1, duration: 0.04 } );
		finish[ 1 ]( samples[ 1 ] );
		finish[ 0 ]( samples[ 0 ] );
		expect( await middle ).toBe( false );
		expect( await first ).toBe( false );
		expect( samples[ 2 ].draw ).toHaveBeenCalledWith( target, 0, 0, 320, 180 );
		expect( samples[ 0 ].draw ).not.toHaveBeenCalled();
		expect( samples[ 1 ].draw ).not.toHaveBeenCalled();
		for ( const decoded of samples ) expect( decoded.close ).toHaveBeenCalledOnce();

	} );

	it( 'cancellation after decode starts still releases its returned sample', async () => {

		const controller = new AbortController();
		let finish;
		state.getSample.mockImplementation( () => new Promise( resolve => {

			finish = resolve;

		} ) );
		const source = await DecodedLEDSource.open( new Blob() );
		const pending = source.drawAt( 1, context(), { signal: controller.signal } );
		controller.abort();
		const decoded = sample( 1 );
		finish( decoded );
		await expect( pending ).rejects.toThrow();
		expect( decoded.draw ).not.toHaveBeenCalled();
		expect( decoded.close ).toHaveBeenCalledOnce();

	} );

	it( 'disposal invalidates a pending frame before it can paint', async () => {

		let finish;
		state.getSample.mockImplementation( () => new Promise( resolve => {

			finish = resolve;

		} ) );
		const source = await DecodedLEDSource.open( new Blob() );
		const pending = source.drawAt( 1, context() );
		source.dispose();
		const decoded = sample( 1 );
		finish( decoded );
		expect( await pending ).toBe( false );
		expect( decoded.draw ).not.toHaveBeenCalled();
		expect( decoded.close ).toHaveBeenCalledOnce();
		expect( state.input.dispose ).toHaveBeenCalledOnce();

	} );

	it( 'failed paint closes the sample and missing frames fail explicitly', async () => {

		const decoded = sample( 1 );
		decoded.draw.mockImplementation( () => {

			throw new Error( 'paint failed' );

		} );
		state.getSample.mockResolvedValueOnce( decoded ).mockResolvedValueOnce( null );
		const source = await DecodedLEDSource.open( new Blob() );
		await expect( source.drawAt( 1, context() ) ).rejects.toThrow( 'paint failed' );
		expect( decoded.close ).toHaveBeenCalledOnce();
		await expect( source.drawAt( 2, context() ) ).rejects.toThrow( /No decoded LED frame/ );

	} );

} );

it( 'predecodes a cut frame once, consumes it without decoding again and closes it after drawing', async () => {

	const frame = sample( 0.4 ), copy = sample( 0.4 ); frame.clone = vi.fn().mockReturnValueOnce( copy ).mockImplementation( () => sample( 0.4 ) ); state.getSample.mockResolvedValue( frame );
	const source = await DecodedLEDSource.open( new Blob() );
	await source.prepareFrame( 0.4 ); await source.prepareFrame( 0.4 );
	expect( state.getSample ).toHaveBeenCalledOnce(); expect( frame.close ).not.toHaveBeenCalled();
	await source.drawAt( 0.4, context() );
	expect( state.getSample ).toHaveBeenCalledOnce(); expect( copy.draw ).toHaveBeenCalledOnce(); expect( copy.close ).toHaveBeenCalledOnce();
	await source.drawAt( 0.4, context() ); expect( state.getSample ).toHaveBeenCalledOnce();
	source.dispose(); await Promise.resolve(); expect( frame.close ).toHaveBeenCalledOnce();

} );

it( 'bounds predecoded samples and closes retained samples on disposal', async () => {

	const samples = Array.from( { length: 6 }, ( _, index ) => sample( index / 10 ) );
	state.getSample.mockImplementation( time => Promise.resolve( samples[ Math.round( time * 10 ) ] ) );
	const source = await DecodedLEDSource.open( new Blob() );
	for ( let index = 0; index < 6; index ++ ) await source.prepareFrame( index / 10 );
	expect( source.prepared.size ).toBe( 4 );
	source.dispose(); await Promise.resolve();
	for ( const frame of samples ) expect( frame.close ).toHaveBeenCalledOnce();

} );
