import { expect, it, vi } from 'vitest';
import { PlateLibraryService } from '../../../app/src/services/plates/PlateLibraryService.js';
import { choosePlateEncoding } from '../../../app/src/services/plates/PlateCodec.js';

const manifest = { id: 'drive', frameCount: 25, files: Object.fromEntries( [ 'front', 'right', 'rear', 'left' ].flatMap( view => [ 'hevc', 'h264' ].map( encoding => [ `${view}-${encoding}`, { codec: `${view}-${encoding}`, width: 1280, height: 720, sha256: `${view}-${encoding}`, size: 100 } ] ) ) ) };

it( 'prefers HEVC only when the playback decoder supports every view', async () => {
	const decoder = { isConfigSupported: vi.fn().mockResolvedValue( { supported: true } ) };
	expect( await choosePlateEncoding( manifest, decoder ) ).toBe( 'hevc' );
	expect( decoder.isConfigSupported ).toHaveBeenCalledTimes( 4 );
	decoder.isConfigSupported.mockImplementation( async config => ( { supported: config.codec !== 'rear-hevc' } ) );
	expect( await choosePlateEncoding( manifest, decoder ) ).toBe( 'h264' );
	expect( await choosePlateEncoding( manifest, {} ) ).toBe( 'h264' );
} );

it( 'matches a saved asset by its full content hash and timing rather than a filename or file size', async () => {
	const service = new PlateLibraryService( { library: { list: async () => [] }, client: { list: async () => [ manifest ] }, downloader: {} } );
	const asset = { mimeType: 'video/mp4', durationUs: 1000000, sha256: 'rear-hevc', byteLength: 100 };
	expect( await service.findAsset( asset ) ).toEqual( { manifest, view: 'rear' } );
	expect( await service.findAsset( { ...asset, sha256: 'unrelated' } ) ).toBeNull();
	expect( await service.findAsset( { ...asset, durationUs: 2000000 } ) ).toBeNull();
} );

it( 'shares one automatic download across concurrent scene requests and retains a ready set', async () => {
	let complete;
	const pending = new Promise( resolve => { complete = resolve; } );
	const downloader = { start: vi.fn().mockReturnValue( pending ), getSnapshot: () => ( {} ) };
	const library = { list: vi.fn().mockResolvedValue( [] ) };
	const service = new PlateLibraryService( { library, client: {}, downloader, chooseEncoding: async () => 'h264' } );
	const a = service.ensure( manifest ), b = service.ensure( manifest );
	await vi.waitFor( () => expect( downloader.start ).toHaveBeenCalledOnce() );
	complete( { ...manifest, downloadedEncodings: [ 'h264' ] } );
	expect( ( await a ).encoding ).toBe( 'h264' ); expect( await b ).toEqual( await a );
	library.list.mockResolvedValue( [ { ready: true, manifest: { ...manifest, downloadedEncodings: [ 'h264' ] } } ] );
	await service.ensure( manifest ); expect( downloader.start ).toHaveBeenCalledOnce();
} );

it( 'does not treat a paused or failed download as a ready scene and allows retry', async () => {
	const downloader = { start: vi.fn().mockResolvedValueOnce( undefined ).mockResolvedValueOnce( manifest ), getSnapshot: () => ( { drive: { error: 'Connection interrupted' } } ) };
	const service = new PlateLibraryService( { library: { list: async () => [] }, client: {}, downloader, chooseEncoding: async () => 'hevc' } );
	await expect( service.ensure( manifest ) ).rejects.toThrow( 'Connection interrupted' );
	expect( ( await service.ensure( manifest ) ).encoding ).toBe( 'hevc' );
} );

it( 'uses downloaded content metadata without contacting the catalogue when offline', async () => {
	const client = { list: vi.fn().mockRejectedValue( new Error( 'Offline' ) ) };
	const service = new PlateLibraryService( { library: { list: async () => [ { ready: true, manifest } ] }, client, downloader: {} } );
	expect( await service.findAsset( { mimeType: 'video/mp4', durationUs: 1000000, sha256: 'rear-hevc', byteLength: 100 } ) ).toEqual( { manifest, view: 'rear' } );
	expect( client.list ).not.toHaveBeenCalled();
} );
