import { afterEach, expect, it, vi } from 'vitest';
import { CloudStudentPresetRepository } from '../../../app/src/services/presets/CloudStudentPresetRepository.js';
import { studentFixture } from './studentFixtures.js';

afterEach( () => vi.restoreAllMocks() );

function setup() {

	const document = studentFixture();
	const preset = { presetId: 'wide', version: '1', name: 'Wide', assets: document.assets, thumbnail: null, snapshot: document.shots.shotA.snapshot };
	const catalogue = { presets: [ { presetId: 'wide', version: '1', name: 'Wide' } ] };
	const client = { list: vi.fn( async () => structuredClone( catalogue ) ), getPreset: vi.fn( async () => structuredClone( preset ) ), getScene: vi.fn(), getAssetBytes: vi.fn( async () => new Uint8Array( [ 1, 2, 3 ] ) ) };
	const eventTarget = new EventTarget(), setInterval = vi.fn().mockReturnValue( 23 ), clearInterval = vi.fn();
	const repository = new CloudStudentPresetRepository( { client, eventTarget, setInterval, clearInterval } );
	return { repository, client, preset, catalogue, eventTarget, setInterval, clearInterval };

}

it( 'reads only public catalogue methods and returns detached student content', async () => {

	const { repository, client, preset } = setup();
	const result = await repository.list();
	expect( repository.storage ).toBe( 'cloud' );
	expect( client.list ).toHaveBeenCalledOnce(); expect( client.getPreset ).toHaveBeenCalledWith( { presetId: 'wide', version: '1', name: 'Wide' } );
	expect( result[ 0 ] ).toMatchObject( { presetId: 'wide', name: 'Wide', revision: '1', thumbnail: null } );
	expect( result[ 0 ].adminDocument ).toBeUndefined(); expect( repository.save ).toBeUndefined();
	result[ 0 ].studentPreset.snapshot.camera.exposure = 42;
	expect( preset.snapshot.camera.exposure ).toBe( 1 );

} );

it( 'fetches verified thumbnail bytes once per immutable version and releases superseded thumbnails', async () => {

	const { repository, client, preset, catalogue } = setup();
	preset.thumbnail = { assetId: 'thumbnail', version: '1' };
	preset.assets[ 'thumbnail@1' ] = { assetId: 'thumbnail', version: '1', kind: 'image', byteLength: 3, mimeType: 'image/jpeg', sha256: 'a'.repeat( 64 ), durationUs: null };
	const first = await repository.list(); await repository.list();
	expect( client.getAssetBytes ).toHaveBeenCalledOnce();
	expect( first[ 0 ].thumbnail.type ).toBe( 'image/jpeg' ); expect( first[ 0 ].thumbnail.size ).toBe( 3 );
	catalogue.presets = []; await repository.list();
	expect( repository.thumbnails.size ).toBe( 0 );

} );

it( 'polls and refreshes on focus, notifies only changed catalogue revisions and tears down when unsubscribed', async () => {

	const { repository, catalogue, eventTarget, setInterval, clearInterval } = setup();
	await repository.list(); const listener = vi.fn(), unsubscribe = repository.subscribe( listener );
	expect( setInterval ).toHaveBeenCalledWith( expect.any( Function ), 15000 );
	await repository.poll(); expect( listener ).not.toHaveBeenCalled();
	catalogue.presets[ 0 ].version = '2'; catalogue.presets[ 0 ].name = 'New name';
	eventTarget.dispatchEvent( new Event( 'focus' ) ); await repository.polling;
	expect( listener ).toHaveBeenCalledExactlyOnceWith( { type: 'changed' } );
	await repository.list(); await repository.poll(); expect( listener ).toHaveBeenCalledOnce();
	unsubscribe(); expect( clearInterval ).toHaveBeenCalledWith( 23 );
	expect( repository.listeners.size ).toBe( 0 );

} );

it( 'retains the gallery during polling failures and retries a changed catalogue until refresh succeeds', async () => {

	const { repository, client, catalogue } = setup();
	await repository.list(); const listener = vi.fn(); repository.subscribe( listener );
	client.list.mockRejectedValueOnce( new Error( 'Offline' ) ); await repository.poll();
	expect( listener ).not.toHaveBeenCalled();
	catalogue.presets[ 0 ].version = '2'; await repository.poll(); await repository.poll();
	expect( listener ).toHaveBeenCalledTimes( 2 ); repository.close();

} );

it( 'resolves cloud scene history and asset metadata without authoring access or local storage', async () => {

	const { repository, client, preset } = setup();
	const scene = { sceneDefinition: { baseScene: { sceneId: 'studio', version: '1' } }, assets: preset.assets };
	client.getScene.mockResolvedValueOnce( scene );
	expect( await repository.getScene( { sceneId: 'studio', version: '1' } ) ).toBe( scene );
	const record = await repository.getAssetRecord( { assetId: 'car', version: '1' } );
	expect( record.asset ).toEqual( preset.assets[ 'car@1' ] );
	expect( client.getAssetBytes ).toHaveBeenCalledWith( preset.assets[ 'car@1' ], undefined );
	expect( await repository.getAssetRecord( { assetId: 'absent', version: '1' } ) ).toBeNull();
	client.getScene.mockRejectedValueOnce( Object.assign( new Error(), { code: 'NOT_FOUND' } ) );
	expect( await repository.getScene( { sceneId: 'missing', version: '1' } ) ).toBeNull();
	client.getScene.mockRejectedValueOnce( Object.assign( new Error( 'Offline' ), { code: 'NETWORK' } ) );
	await expect( repository.getScene( { sceneId: 'missing', version: '1' } ) ).rejects.toThrow( 'Offline' );

} );
