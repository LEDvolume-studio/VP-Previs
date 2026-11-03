import { describe, expect, it, vi } from 'vitest';
import { LocalPlateLibrary } from '../../../app/src/services/plates/LocalPlateLibrary.js';
import { PLATE_SLOTS } from '../../../app/src/services/plates/PlateSet.js';

const files = () => Object.fromEntries( PLATE_SLOTS.map( slot => [ slot, new File( [ new Uint8Array( 32 ) ], `${slot}.mp4` ) ] ) );
function setup( { failAtWrite = Infinity } = {} ) {

	const directories = new Map(); let writes = 0, aborts = 0;
	const makeDirectory = () => {

		const contents = new Map();
		return { kind: 'directory', async getFileHandle( name, { create = false } = {} ) {

			if ( ! contents.has( name ) && ! create ) throw new DOMException( 'Missing', 'NotFoundError' );
			if ( ! contents.has( name ) ) contents.set( name, new Blob() );
			return { getFile: async () => contents.get( name ), createWritable: async () => {

				const chunks = [];
				return { write: async value => {

					if ( ++ writes === failAtWrite ) throw new DOMException( 'Disk full', 'QuotaExceededError' );
					chunks.push( value );

				}, close: async () => contents.set( name, new Blob( chunks ) ), abort: async () => {

					aborts ++;

				} };

			} };

		} };

	};

	const root = { entries: async function* () {

		yield* directories.entries();

	}, getDirectoryHandle: async ( id, { create = false } = {} ) => {

		if ( ! directories.has( id ) && ! create ) throw new DOMException( 'Missing', 'NotFoundError' );
		if ( ! directories.has( id ) ) directories.set( id, makeDirectory() );
		return directories.get( id );

	}, removeEntry: async id => directories.delete( id ) };
	const storage = { estimate: async () => ( { quota: 1024 ** 3, usage: 0 } ) };
	const inspect = vi.fn( async ( file, encoding ) => ( { encoding, width: 1280, height: 720, fps: 25, frameCount: 50, size: file.size } ) );
	const library = new LocalPlateLibrary( { storage, inspect, locks: { request: async ( name, options, task ) => task( {} ) } } );
	library.root = async () => root;
	return { library, directories, inspect, aborts: () => aborts };

}

describe( 'plate library commit and recovery', () => {

	it( 'commits all eight files and reads verified bytes back without original handles', async () => {

		const { library, inspect } = setup();
		const manifest = await library.importSet( { name: 'Country road', files: files() } );
		expect( inspect ).toHaveBeenCalledTimes( 8 );
		expect( await library.list() ).toEqual( [ { manifest, ready: true } ] );
		const reopened = await library.filesFor( manifest, 'h264' );
		expect( Object.keys( reopened ) ).toEqual( [ 'front', 'right', 'rear', 'left' ] );
		expect( new Uint8Array( await reopened.front.arrayBuffer() ) ).toEqual( new Uint8Array( 32 ) );

	} );

	it( 'rejects mismatched views before making any destination directory', async () => {

		const { library, inspect, directories } = setup();
		inspect.mockImplementationOnce( async file => ( { encoding: 'hevc', frameCount: 49, size: file.size } ) );
		await expect( library.importSet( { name: 'Mismatch', files: files() } ) ).rejects.toThrow( /frame count/ );
		expect( directories.size ).toBe( 0 );

	} );

	it( 'aborts the active writer and removes a partial set after disk fills', async () => {

		const { library, directories, aborts } = setup( { failAtWrite: 4 } );
		await expect( library.importSet( { name: 'Interrupted', files: files() } ) ).rejects.toThrow( /storage filled/ );
		expect( aborts() ).toBe( 1 ); expect( directories.size ).toBe( 0 ); expect( await library.list() ).toEqual( [] );

	} );

	it( 'cancels a copy and never exposes it as a complete set', async () => {

		const { library, directories } = setup(), controller = new AbortController();
		await expect( library.importSet( { name: 'Cancelled', files: files() }, { signal: controller.signal, onProgress: progress => {

			if ( progress.phase === 'saving' ) controller.abort();

		} } ) ).rejects.toThrow();
		expect( directories.size ).toBe( 0 );

	} );

	it( 'cleans abandoned copies without deleting completed sets', async () => {

		const { library, directories } = setup();
		await library.importSet( { name: 'Keep this', files: files() } );
		await ( await library.root() ).getDirectoryHandle( 'abandoned-copy', { create: true } );
		expect( ( await library.list() ).length ).toBe( 1 );
		expect( await library.discardInterruptedImports() ).toBe( 1 );
		expect( directories.size ).toBe( 1 );

	} );

	it( 'does not clean an import being written in another tab', async () => {

		const { library } = setup(); library.locks.request = async ( name, options, task ) => task( null );
		await expect( library.discardInterruptedImports() ).rejects.toThrow( /still running/ );
		await expect( library.importSet( { name: 'Blocked', files: files() } ) ).rejects.toThrow( /Another plate import/ );

	} );

} );

it( 'enriches older manifests without changing their downloaded encodings or video inventory', async () => {
	const { library } = setup();
	const original = await library.importSet( { name: 'Drive', files: files() } );
	const enriched = structuredClone( original );
	for ( const slot of PLATE_SLOTS ) enriched.files[ slot ].sha256 = 'a'.repeat( 64 );
	await library.updateMetadata( enriched );
	const saved = ( await library.list() )[ 0 ].manifest;
	expect( saved.downloadedEncodings ).toEqual( original.downloadedEncodings );
	expect( saved.files[ 'front-hevc' ].sha256 ).toBe( 'a'.repeat( 64 ) );
	const changed = structuredClone( enriched ); changed.files[ 'front-hevc' ].size ++;
	await library.updateMetadata( changed );
	expect( ( await library.list() )[ 0 ].manifest.files[ 'front-hevc' ].size ).toBe( original.files[ 'front-hevc' ].size );
} );
