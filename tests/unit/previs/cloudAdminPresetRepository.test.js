import { describe, expect, it, vi } from 'vitest';
import { CloudAdminPresetRepository } from '../../../app/src/services/presets/CloudAdminPresetRepository.js';
import { createProjectDocument } from '../../../app/src/services/projects/ProjectSchema.js';
import { studentFixture } from './studentFixtures.js';

const origin = 'https://teacher.example';
const json = ( value, { status = 200, headers = {} } = {} ) => new Response( JSON.stringify( value ), { status, headers: { 'Content-Type': 'application/json', ETag: `"${value.revision ?? 0}"`, ...headers } } );
const input = () => {

	const document = studentFixture();
	return {
		name: 'Wide shot', adminDocument: createProjectDocument( { projectId: 'admin-source', name: 'Source' } ),
		studentPreset: { format: 'rayzee-student-preset', schemaVersion: 1, presetId: 'capture', version: '1', name: 'Wide shot', description: '', category: 'Studio', defaultDurationFrames: 96, thumbnail: null, assets: document.assets, baseScene: document.baseScenes[ 'studio@1' ], snapshot: document.shots.shotA.snapshot },
	};

};

const record = ( body, presetId = 'preset-1', revision = 0 ) => ( {
	format: 'rayzee-local-preset', schemaVersion: 1, presetId, revision, name: body.name,
	createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', adminDocument: body.adminDocument, studentPreset: body.studentPreset, thumbnail: null,
} );
function repository( fetch, extra = {} ) {

	let serial = 0;
	return new CloudAdminPresetRepository( { baseURL: origin, origin, fetch, createId: () => `generated-${++ serial}`, channelFactory: () => null, ...extra } );

}

describe( 'Cloudflare admin preset repository', () => {

	it( 'removes a preset using guarded catalogue availability and retains the same operation after a lost acknowledgement', async () => {

		const value = input(); value.studentPreset.presetId = 'preset-1';
		const fetch = vi.fn( async url => url.includes( 'preset-editor/' ) ? json( record( value ) ) : json( { presetId: 'preset-1', version: '1', available: false, headRevision: 1, replayed: true }, { headers: { ETag: '"1"' } } ) );
		const repo = repository( fetch ), listener = vi.fn(); repo.subscribe( listener );
		fetch.mockImplementationOnce( async () => json( record( value ) ) ).mockRejectedValueOnce( new Error( 'Acknowledgement lost' ) );
		await expect( repo.remove( 'preset-1', { expectedRevision: 0 } ) ).rejects.toMatchObject( { code: 'NETWORK' } );
		expect( listener ).not.toHaveBeenCalled();
		await repo.remove( 'preset-1', { expectedRevision: 0 } );
		expect( fetch.mock.calls[ 1 ] ).toEqual( fetch.mock.calls[ 3 ] );
		expect( fetch.mock.calls[ 3 ] ).toEqual( [ `${origin}/v1/admin/catalogue/presets/preset-1/availability`, expect.objectContaining( { method: 'POST', body: '{"available":false,"version":"1"}', headers: expect.objectContaining( { 'If-Match': '"0"' } ) } ) ] );
		expect( listener ).toHaveBeenCalledWith( { type: 'changed', presetId: 'preset-1', revision: 1 } );

	} );

	it( 'uploads a generated thumbnail then atomically saves a shared record with cookie auth and create precondition', async () => {

		const uploadAsset = vi.fn( async () => ( { verified: true } ) );
		const fetch = vi.fn( async ( url, options ) => json( record( JSON.parse( options.body ), 'generated-1' ), { status: 201 } ) );
		const repo = repository( fetch, { catalogueClient: { uploadAsset } } );
		const listener = vi.fn(); repo.subscribe( listener );
		const value = input(), thumbnail = new Blob( [ 'png-bytes' ], { type: 'image/png' } );
		const saved = await repo.save( { ...value, thumbnail }, { expectedRevision: null } );
		expect( saved.presetId ).toBe( 'generated-1' );
		expect( saved.revision ).toBe( 0 );
		expect( saved.thumbnail ).toEqual( thumbnail );
		expect( saved.studentPreset.version ).toBe( '1' );
		expect( uploadAsset ).toHaveBeenCalledOnce();
		const [ asset, bytes ] = uploadAsset.mock.calls[ 0 ];
		expect( asset ).toMatchObject( { kind: 'image', mimeType: 'image/png', byteLength: thumbnail.size } );
		expect( new Uint8Array( bytes ) ).toEqual( new Uint8Array( await thumbnail.arrayBuffer() ) );
		expect( fetch.mock.calls[ 0 ] ).toEqual( [ `${origin}/v1/admin/preset-editor/generated-1`, expect.objectContaining( { method: 'PUT', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', headers: expect.objectContaining( { 'If-None-Match': '*', 'Idempotency-Key': 'generated-2' } ) } ) ] );
		expect( listener ).toHaveBeenCalledWith( { type: 'changed', presetId: 'generated-1', revision: 0 } );

	} );

	it( 'retains exact create identity, body and idempotency key after an uncertain network failure', async () => {

		const fetch = vi.fn().mockRejectedValueOnce( new Error( 'private credentials and host' ) ).mockImplementationOnce( async ( url, options ) => json( record( JSON.parse( options.body ), 'generated-1' ) ) );
		const repo = repository( fetch ), value = input();
		await expect( repo.save( value, { expectedRevision: null } ) ).rejects.toMatchObject( { code: 'NETWORK', retryable: true } );
		const saved = await repo.save( value, { expectedRevision: null } );
		expect( saved.presetId ).toBe( 'generated-1' );
		expect( fetch.mock.calls[ 1 ] ).toEqual( fetch.mock.calls[ 0 ] );

	} );

	it( 'updates the requested head revision and rejects forged acknowledgements', async () => {

		const value = { ...input(), presetId: 'preset-1' };
		const fetch = vi.fn( async ( url, options ) => json( record( JSON.parse( options.body ), 'preset-1', 4 ) ) );
		const repo = repository( fetch );
		const saved = await repo.save( value, { expectedRevision: 3 } );
		expect( saved.studentPreset.version ).toBe( '5' );
		expect( fetch.mock.calls[ 0 ][ 1 ].headers ).toMatchObject( { 'If-Match': '"3"' } );
		fetch.mockImplementationOnce( async ( url, options ) => json( record( JSON.parse( options.body ), 'other-preset', 4 ) ) );
		await expect( repo.save( value, { expectedRevision: 3 } ) ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it.each( [[ 401, 'AUTHORIZATION' ], [ 403, 'AUTHORIZATION' ], [ 409, 'REVISION_CONFLICT' ], [ 503, 'SERVER' ]] )( 'surfaces shared-library status %s without a device storage fallback or server-text leak', async ( status, code ) => {

		const fetch = vi.fn( async () => new Response( 'private server details', { status } ) );
		const repo = repository( fetch );
		await expect( repo.list() ).rejects.toMatchObject( { code, status } );
		expect( fetch ).toHaveBeenCalledOnce();
		expect( repo.storage ).toBe( 'cloud' );

	} );

	it( 'loads protected records and resolves thumbnail bytes using pinned student asset metadata', async () => {

		const value = input(); value.studentPreset.presetId = 'preset-1';
		const thumbnailAsset = { assetId: 'thumb', version: '1', kind: 'image', mimeType: 'image/png', sha256: 'a'.repeat( 64 ), byteLength: 3, durationUs: null };
		value.studentPreset.assets[ 'thumb@1' ] = thumbnailAsset; value.studentPreset.thumbnail = { assetId: 'thumb', version: '1' };
		const row = record( value );
		const summary = { presetId: row.presetId, revision: row.revision, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt, thumbnailAsset };
		const fetch = vi.fn().mockResolvedValueOnce( json( { presets: [ summary ] } ) ).mockResolvedValueOnce( json( row ) );
		const getAssetBytes = vi.fn( async () => new Uint8Array( [ 1, 2, 3 ] ) );
		const repo = repository( fetch, { studentClient: { getAssetBytes } } );
		const listed = await repo.list();
		expect( listed[ 0 ].thumbnail ).toBeInstanceOf( Blob );
		expect( await listed[ 0 ].thumbnail.arrayBuffer() ).toEqual( new Uint8Array( [ 1, 2, 3 ] ).buffer );
		expect( getAssetBytes ).toHaveBeenCalledWith( thumbnailAsset );
		expect( fetch.mock.calls[ 0 ][ 0 ] ).toBe( `${origin}/v1/admin/preset-editor?summary=1` );
		expect( listed[ 0 ] ).not.toHaveProperty( 'adminDocument' );
		expect( listed[ 0 ] ).not.toHaveProperty( 'studentPreset' );
		const loaded = await repo.get( 'preset-1' );
		expect( loaded.name ).toBe( 'Wide shot' );
		expect( fetch.mock.calls[ 1 ][ 0 ] ).toBe( `${origin}/v1/admin/preset-editor/preset-1` );

	} );

	it( 'accepts compression-weakened ETags for reads and writes while rejecting mismatched revisions', async () => {

		const value = input(); value.studentPreset.presetId = 'preset-1';
		const fetch = vi.fn()
			.mockResolvedValueOnce( json( record( value ), { headers: { ETag: 'W/"0"' } } ) )
			.mockImplementationOnce( async ( url, options ) => json( record( JSON.parse( options.body ), 'preset-1', 1 ), { headers: { ETag: 'W/"1"' } } ) )
			.mockResolvedValueOnce( json( record( value ), { headers: { ETag: 'W/"1"' } } ) );
		const repo = repository( fetch );
		expect( ( await repo.get( 'preset-1' ) ).revision ).toBe( 0 );
		expect( ( await repo.save( { ...value, presetId: 'preset-1' }, { expectedRevision: 0 } ) ).revision ).toBe( 1 );
		expect( fetch.mock.calls[ 1 ][ 1 ].headers[ 'If-Match' ] ).toBe( '"0"' );
		await expect( repo.get( 'preset-1' ) ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'lists compact summaries without downloading authoring scenes or accepting malformed thumbnail metadata', async () => {

		const summary = { presetId: 'wide', revision: 4, name: 'Wide', createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T01:00:00.000Z', thumbnailAsset: null };
		const fetch = vi.fn().mockResolvedValueOnce( json( { presets: [ summary ] } ) ).mockResolvedValueOnce( json( { presets: [ { ...summary, thumbnailAsset: { assetId: 'bad' } } ] } ) );
		const repo = repository( fetch );
		expect( await repo.list() ).toEqual( [ { ...summary, thumbnail: null } ] );
		expect( fetch ).toHaveBeenCalledOnce();
		await expect( repo.list() ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'renames by advancing the cloud record and immutable student version together', async () => {

		const value = input(); value.studentPreset.presetId = 'preset-1';
		const fetch = vi.fn().mockResolvedValueOnce( json( record( value, 'preset-1', 2 ) ) ).mockImplementationOnce( async ( url, options ) => json( record( JSON.parse( options.body ), 'preset-1', 3 ) ) );
		const repo = repository( fetch );
		const saved = await repo.rename( 'preset-1', 'Driver view', { expectedRevision: 2 } );
		expect( saved.name ).toBe( 'Driver view' );
		expect( saved.studentPreset.name ).toBe( 'Driver view' );
		expect( saved.studentPreset.version ).toBe( '4' );
		expect( fetch.mock.calls[ 1 ][ 1 ].headers[ 'If-Match' ] ).toBe( '"2"' );

	} );

	it( 'rejects stale rename and malformed or oversized responses without mutations', async () => {

		const value = input(); value.studentPreset.presetId = 'preset-1';
		const fetch = vi.fn().mockResolvedValueOnce( json( record( value, 'preset-1', 7 ) ) ).mockResolvedValueOnce( json( { presets: [ { bad: true } ] } ) ).mockResolvedValueOnce( new Response( '{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String( 33 * 1024 * 1024 ) } } ) );
		const repo = repository( fetch );
		await expect( repo.rename( 'preset-1', 'Driver', { expectedRevision: 2 } ) ).rejects.toMatchObject( { code: 'REVISION_CONFLICT' } );
		await expect( repo.list() ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );
		await expect( repo.list() ).rejects.toMatchObject( { code: 'RESPONSE_TOO_LARGE' } );
		expect( fetch.mock.calls.every( ( [ , options ] ) => options.method === 'GET' ) ).toBe( true );

	} );

	it( 'validates uploaded metadata and thumbnail bounds before issuing requests', async () => {

		const fetch = vi.fn(), repo = repository( fetch );
		await expect( repo.save( { ...input(), thumbnail: new Blob( [ 'x' ], { type: 'text/html' } ) }, { expectedRevision: null } ) ).rejects.toThrow( /thumbnail/ );
		await expect( repo.save( input(), {} ) ).rejects.toThrow( /expectedRevision/ );
		expect( fetch ).not.toHaveBeenCalled();

	} );

} );

it( 'resolves scene media metadata from compact summaries before downloading asset bytes after a reload', async () => {
	const value = input(); value.studentPreset.presetId = 'preset-1';
	const row = record( value );
	const summary = { presetId: row.presetId, revision: row.revision, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt, thumbnailAsset: null };
	const fetch = vi.fn().mockResolvedValueOnce( json( { presets: [ summary ] } ) ).mockResolvedValueOnce( json( row ) );
	const getAssetBytes = vi.fn();
	const repo = repository( fetch, { studentClient: { getAssetBytes } } );
	const asset = Object.values( value.studentPreset.assets ).find( item => item.kind === 'video' );
	expect( await repo.getAssetMetadata( { assetId: asset.assetId, version: asset.version } ) ).toEqual( asset );
	expect( getAssetBytes ).not.toHaveBeenCalled();
} );
