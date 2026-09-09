import { describe, expect, it, vi } from 'vitest';
import { MaterialDataManager } from '@/core/managers/MaterialDataManager.js';

describe( 'MaterialDataManager dynamic texture layers', () => {

	it( 'updates only the packed array layer and schedules a scoped GPU upload', () => {

		const manager = new MaterialDataManager( {} );
		const sourceTexture = { source: { uuid: 'video-frame' } };
		const arrayTexture = {
			image: { data: new Uint8Array( 24 ), width: 2, height: 1, depth: 3 },
			addLayerUpdate: vi.fn(),
			needsUpdate: false,
		};
		manager.srgbBuckets = [ arrayTexture ];
		manager._srgbTexPacked = new Map( [[ 'video-frame', 1 ]] );
		manager.callbacks.onReset = vi.fn();
		const frame = new Uint8ClampedArray( [ 1, 2, 3, 255, 4, 5, 6, 255 ] );

		expect( manager.getTextureLayerInfo( sourceTexture, true ) ).toEqual( {
			width: 2,
			height: 1,
			bucket: 0,
			layer: 1,
		} );
		expect( manager.updateTextureLayer( sourceTexture, frame, true ) ).toBe( true );
		expect( [ ...arrayTexture.image.data.slice( 8, 16 ) ] ).toEqual( [ ...frame ] );
		expect( arrayTexture.addLayerUpdate ).toHaveBeenCalledWith( 1 );
		expect( arrayTexture.needsUpdate ).toBe( true );
		expect( manager.callbacks.onReset ).toHaveBeenCalledOnce();

	} );

	it( 'rejects frames whose byte length does not match the packed layer', () => {

		const manager = new MaterialDataManager( {} );
		const sourceTexture = { uuid: 'video-frame' };
		manager.srgbBuckets = [ {
			image: { data: new Uint8Array( 8 ), width: 2, height: 1, depth: 1 },
			addLayerUpdate: vi.fn(),
		} ];
		manager._srgbTexPacked = new Map( [[ 'video-frame', 0 ]] );

		expect( manager.updateTextureLayer( sourceTexture, new Uint8Array( 4 ), true ) ).toBe( false );

	} );

} );
