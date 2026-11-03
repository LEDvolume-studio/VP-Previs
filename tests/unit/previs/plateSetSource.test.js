import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlateSetSource } from '../../../app/src/services/plates/PlateSetSource.js';
import { PLATE_SLOTS, PLATE_VIEWS } from '../../../app/src/services/plates/PlateSet.js';

const manifest = () => ( { format: 'rayzee-driving-plates', schemaVersion: 1, id: 'set', name: 'Drive', frameCount: 50, headingOffset: 0, files: Object.fromEntries( PLATE_SLOTS.map( slot => [ slot, { encoding: slot.split( '-' )[ 1 ], frameCount: 50, size: 32, width: 1280, height: 720, fps: 25, chunks: [ '0'.repeat( 64 ) ] } ] ) ) } );
const library = () => {

	const release = vi.fn();
	return { release, lease: vi.fn( async () => release ), filesFor: vi.fn( async ( manifest, encoding ) => Object.fromEntries( PLATE_VIEWS.map( view => [ view, { view, encoding } ] ) ) ) };

};

const decoder = () => ( { drawAt: vi.fn( async time => ( { timestamp: time, duration: 0.04 } ) ), dispose: vi.fn() } );
const context = () => ( { canvas: { width: 1280, height: 720 }, drawImage: vi.fn() } );
afterEach( () => vi.unstubAllGlobals() );
const installCanvas = () => vi.stubGlobal( 'OffscreenCanvas', class {

	getContext() {

		return {};

	}

} );

describe( 'four-view shared frame source', () => {

	it( 'falls back as a complete group and closes partially opened HEVC decoders', async () => {

		const store = library(), opened = [];
		const source = await PlateSetSource.open( store, manifest(), { openSource: async file => {

			if ( file.encoding === 'hevc' && file.view === 'right' ) throw new Error( 'No HEVC decoder' );
			const item = decoder(); opened.push( item ); return item;

		} } );
		expect( source.encoding ).toBe( 'h264' ); expect( opened[ 0 ].dispose ).toHaveBeenCalledOnce();
		expect( source.sources.size ).toBe( 4 ); await source.dispose();
		expect( opened.every( item => item.dispose.mock.calls.length === 1 ) ).toBe( true ); expect( store.release ).toHaveBeenCalledOnce();

	} );

	it( 'never retries another encoding after cancellation and releases its lease', async () => {

		const store = library(), abort = new AbortController(); abort.abort();
		const openSource = vi.fn();
		await expect( PlateSetSource.open( store, manifest(), { signal: abort.signal, openSource } ) ).rejects.toThrow();
		expect( openSource ).not.toHaveBeenCalled(); expect( store.filesFor ).toHaveBeenCalledOnce(); expect( store.release ).toHaveBeenCalledOnce();

	} );

	it( 'uses the same frame across angles and never commits a superseded angle', async () => {

		installCanvas(); const store = library(), decoders = Object.fromEntries( PLATE_VIEWS.map( view => [ view, decoder() ] ) );
		let finish;
		decoders.front.drawAt.mockImplementationOnce( () => new Promise( resolve => {

			finish = resolve;

		} ) );
		const source = await PlateSetSource.open( store, manifest(), { encoding: 'h264', openSource: async file => decoders[ file.view ] } );
		const target = context(), first = source.drawAt( 0.68, target, { heading: 0 } );
		await vi.waitFor( () => expect( finish ).toBeTypeOf( 'function' ) );
		const latest = source.drawAt( 0.68, target, { heading: 90 } );
		finish( { timestamp: 0.68, duration: 0.04 } );
		expect( await first ).toBe( false );
		expect( await latest ).toMatchObject( { frame: 17, view: 'right', timestamp: 0.68 } );
		expect( target.drawImage ).toHaveBeenCalledOnce();
		await source.dispose();

	} );

	it( 'rejects an incorrectly timed decoded sample without painting it', async () => {

		installCanvas(); const item = decoder(); item.drawAt.mockResolvedValue( { timestamp: 0, duration: 0.04 } );
		const source = await PlateSetSource.open( library(), manifest(), { openSource: async () => item } );
		const target = context();
		await expect( source.drawAt( 0.68, target ) ).rejects.toThrow( /shared timeline/ );
		expect( target.drawImage ).not.toHaveBeenCalled(); await source.dispose();

	} );

} );
