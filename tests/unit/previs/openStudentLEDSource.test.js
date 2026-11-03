import { expect, it, vi } from 'vitest';
import { openStudentLEDSource } from '../../../app/src/previs/media/OpenStudentLEDSource.js';
import { createLocalPresetCatalogue } from '../../../app/src/services/presets/LocalPresetCatalogue.js';

async function fixture() {

	const file = new Blob( [ 'the actual rear video' ], { type: 'video/mp4' } );
	const sha256 = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await file.arrayBuffer() ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	const asset = { assetId: 'rear', version: '1', kind: 'video', byteLength: file.size, sha256, mimeType: file.type, durationUs: 180000000 };
	const release = vi.fn(), dispose = vi.fn();
	const library = {
		list: vi.fn().mockResolvedValue( [ { ready: true, manifest: { id: 'advanced', frameCount: 4500, downloadedEncodings: [ 'hevc' ], files: { 'rear-hevc': { size: file.size } } } } ] ),
		lease: vi.fn().mockResolvedValue( release ),
		root: async () => ( { getDirectoryHandle: async () => ( { getFileHandle: async () => ( { getFile: async () => file } ) } ) } ),
	};
	const catalogue = { getAssetBytes: vi.fn().mockResolvedValue( new Uint8Array( await file.arrayBuffer() ) ) };
	const openSource = vi.fn().mockResolvedValue( { dispose } );
	return { file, asset, library, catalogue, release, dispose, openSource };

}

it( 'decodes the exact downloaded view without reading the catalogue and holds its lease through disposal', async () => {

	const context = await fixture();
	const source = await openStudentLEDSource( context.asset, context.catalogue, context );
	expect( context.openSource ).toHaveBeenCalledWith( context.file );
	expect( context.catalogue.getAssetBytes ).not.toHaveBeenCalled();
	expect( source.downloadedPlate ).toEqual( { setId: 'advanced', view: 'rear', encoding: 'hevc' } );
	expect( context.release ).not.toHaveBeenCalled();
	expect( source.residentBytes ).toBe( 0 );
	await source.dispose(); await source.dispose();
	expect( context.release ).toHaveBeenCalledOnce();
	expect( context.dispose ).toHaveBeenCalledOnce();

} );

it( 'permits file-backed plates with a zero resident-byte budget but rejects memory-backed media before fetching', async () => {

	const context = await fixture();
	await expect( openStudentLEDSource( context.asset, context.catalogue, { ...context, maximumResidentBytes: 0 } ) ).resolves.toMatchObject( { residentBytes: 0 } );
	context.library.list.mockResolvedValue( [] );
	await expect( openStudentLEDSource( context.asset, context.catalogue, { ...context, maximumResidentBytes: 0 } ) ).rejects.toThrow( 'memory budget' );
	expect( context.catalogue.getAssetBytes ).not.toHaveBeenCalled();

} );

it( 'rejects a same-size different video as a substitute and falls back to the pinned catalogue', async () => {

	const context = await fixture(); context.asset.sha256 = 'a'.repeat( 64 );
	await openStudentLEDSource( context.asset, context.catalogue, context );
	expect( context.catalogue.getAssetBytes ).toHaveBeenCalledWith( context.asset, { signal: undefined } );
	expect( context.release ).toHaveBeenCalledOnce();

} );

it( 'uses the catalogue when browser storage is disabled and propagates cancellation', async () => {

	const context = await fixture(); context.library.list.mockRejectedValue( new Error( 'Storage disabled' ) );
	await openStudentLEDSource( context.asset, context.catalogue, context );
	expect( context.catalogue.getAssetBytes ).toHaveBeenCalledOnce();
	const controller = new AbortController(); controller.abort();
	await expect( openStudentLEDSource( context.asset, context.catalogue, { ...context, signal: controller.signal } ) ).rejects.toMatchObject( { name: 'AbortError' } );

} );

it( 'resolves new preset media alongside an existing demo scene without falling back on corrupt bytes', async () => {

	const { asset, file } = await fixture();
	const fallback = { getScene: vi.fn().mockResolvedValue( { sceneDefinition: {} } ), getAssetBytes: vi.fn() };
	const repository = { getScene: vi.fn().mockResolvedValue( null ), getAssetRecord: vi.fn().mockResolvedValue( { asset, blob: file } ) };
	const catalogue = createLocalPresetCatalogue( repository, { fallback } );
	expect( await catalogue.getScene( { sceneId: 'demo', version: '1' } ) ).toEqual( { sceneDefinition: {} } );
	expect( await catalogue.getAssetBytes( asset ) ).toEqual( new Uint8Array( await file.arrayBuffer() ) );
	expect( fallback.getAssetBytes ).not.toHaveBeenCalled();
	repository.getAssetRecord.mockResolvedValueOnce( { asset, blob: new Blob( [ 'broken' ] ) } );
	await expect( catalogue.getAssetBytes( asset ) ).rejects.toThrow( 'size changed' );
	expect( fallback.getAssetBytes ).not.toHaveBeenCalled();

} );

it( 'automatically downloads the device-compatible encoding while retaining the saved camera view', async () => {
	const context = await fixture();
	const h264 = new Blob( [ 'h264 rear frames' ], { type: 'video/mp4' } );
	const manifest = { id: 'advanced', frameCount: 4500 };
	const library = { lease: vi.fn().mockResolvedValue( context.release ), filesFor: vi.fn().mockResolvedValue( { rear: h264 } ) };
	const plateService = { library, findAsset: vi.fn().mockResolvedValue( { manifest, view: 'rear' } ), ensure: vi.fn().mockResolvedValue( { manifest, encoding: 'h264' } ) };
	const source = await openStudentLEDSource( context.asset, context.catalogue, { ...context, plateService, maximumResidentBytes: 0 } );
	expect( plateService.ensure ).toHaveBeenCalledWith( manifest, { signal: undefined } );
	expect( context.openSource ).toHaveBeenCalledWith( h264 );
	expect( source.downloadedPlate ).toEqual( { setId: 'advanced', view: 'rear', encoding: 'h264' } );
	expect( context.catalogue.getAssetBytes ).not.toHaveBeenCalled();
	await source.dispose(); expect( context.release ).toHaveBeenCalledOnce();
} );
