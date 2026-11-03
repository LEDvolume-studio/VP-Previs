import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { EquirectangularReflectionMapping, FloatType, LinearFilter } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { expect, it } from 'vitest';
import { loadVerifiedStudentEnvironment } from '../../../app/src/previs/engine/VerifiedStudentEnvironment.js';
import appearance from '../../../app/src/student/demo/admin-appearance.json';

it( 'decodes verified real HDRI using the admin float loader and preserves its exact linear pixels', async () => {

	const bytes = await readFile( new URL( '../../../app/src/student/demo/environment/aristea_wreck_puresky_1k.hdr', import.meta.url ) );
	const texture = await loadVerifiedStudentEnvironment( appearance.environmentAsset, { getAssetBytes: async () => bytes } );
	const admin = new HDRLoader().setDataType( FloatType ).createDataTexture( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) );
	expect( Buffer.from( texture.image.data.buffer ).equals( Buffer.from( admin.image.data.buffer ) ) ).toBe( true );
	expect( texture.mapping ).toBe( EquirectangularReflectionMapping ); expect( texture.type ).toBe( FloatType );
	expect( texture.minFilter ).toBe( LinearFilter ); expect( texture.flipY ).toBe( admin.flipY );
	expect( texture.colorSpace ).toBe( admin.colorSpace );
	texture.dispose(); admin.dispose();

} );

it( 'rejects changed HDRI bytes and cancellation before decoding', async () => {

	const bytes = await readFile( new URL( '../../../app/src/student/demo/environment/aristea_wreck_puresky_1k.hdr', import.meta.url ) );
	bytes[ 500 ] ^= 1;
	await expect( loadVerifiedStudentEnvironment( appearance.environmentAsset, { getAssetBytes: async () => bytes } ) ).rejects.toThrow( 'immutable hash' );
	const controller = new AbortController(); controller.abort();
	await expect( loadVerifiedStudentEnvironment( appearance.environmentAsset, { getAssetBytes: async () => bytes }, { signal: controller.signal } ) ).rejects.toMatchObject( { name: 'AbortError' } );

} );
