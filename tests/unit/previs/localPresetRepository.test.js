import { describe, expect, it, vi } from 'vitest';
import { LocalPresetRepository } from '../../../app/src/services/presets/LocalPresetRepository.js';
import { createProjectDocument } from '../../../app/src/services/projects/ProjectSchema.js';
import { studentFixture } from './studentFixtures.js';

function input() {

	const document = studentFixture();
	return {
		presetId: 'wide', name: 'Wide', adminDocument: createProjectDocument(), thumbnail: null,
		studentPreset: {
			format: 'rayzee-student-preset', schemaVersion: 1, presetId: 'wide', version: '1', name: 'Wide',
			description: '', category: 'Studio', defaultDurationFrames: 125, thumbnail: null,
			assets: document.assets, baseScene: document.baseScenes[ 'studio@1' ], snapshot: document.shots.shotA.snapshot,
		},
	};

}

const repository = options => new LocalPresetRepository( { databaseFactory: null, channelFactory: () => null, ...options } );

describe( 'Device-local preset library validation and notifications', () => {

	it( 'requires an explicit expected revision and preserves input on validation failure', async () => {

		const value = input(), before = structuredClone( value );
		await expect( repository().save( value ) ).rejects.toThrow( 'expectedRevision' );
		expect( value ).toEqual( before );

	} );

	it( 'rejects invalid admin scenes and unsupported portable student contents before opening storage', async () => {

		const value = input();
		delete value.adminDocument.scene;
		await expect( repository().save( value, { expectedRevision: null } ) ).rejects.toThrow( 'scene data' );
		const unsafe = input();
		unsafe.studentPreset.snapshot.camera.exposure = NaN;
		await expect( repository().save( unsafe, { expectedRevision: null } ) ).rejects.toThrow( 'finite' );

	} );

	it.each( [ new Blob( [ 'x' ], { type: 'text/html' } ), new Blob( [ new Uint8Array( 1024 * 1024 + 1 ) ], { type: 'image/png' } ), new Blob( [], { type: 'image/png' } ) ] )( 'rejects unsafe or oversized thumbnails before saving', async thumbnail => {

		await expect( repository().save( { ...input(), thumbnail }, { expectedRevision: null } ) ).rejects.toThrow( 'thumbnail up to 1 MiB' );

	} );

	it( 'rejects mismatched pinned asset bytes before opening a transaction', async () => {

		const value = input();
		value.assetBlobs = [ { asset: value.studentPreset.assets[ 'car@1' ], blob: new Blob( [ new Uint8Array( 100 ) ] ) } ];
		await expect( repository().save( value, { expectedRevision: null } ) ).rejects.toThrow( 'SHA-256' );

	} );

	it( 'delivers detached events locally and across tabs without rebroadcast loops', () => {

		const channel = { postMessage: vi.fn(), close: vi.fn() };
		const repo = repository( { channelFactory: () => channel } );
		const received = [];
		const unsubscribe = repo.subscribe( event => {

			received.push( event ); event.presetId = 'mutated';

		} );
		const event = { type: 'changed', presetId: 'wide', revision: 0 };
		repo.notify( event );
		expect( event.presetId ).toBe( 'wide' );
		expect( channel.postMessage ).toHaveBeenCalledExactlyOnceWith( event );
		channel.onmessage( { data: { type: 'changed', presetId: 'close', revision: 3 } } );
		channel.onmessage( { data: { type: 'changed', presetId: 'invalid', revision: - 1 } } );
		expect( received ).toHaveLength( 2 );
		expect( channel.postMessage ).toHaveBeenCalledTimes( 1 );
		unsubscribe();
		repo.notify( event );
		expect( received ).toHaveLength( 2 );
		repo.close();
		expect( channel.close ).toHaveBeenCalledOnce();

	} );

} );
