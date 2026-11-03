import { EquirectangularReflectionMapping, FloatType, LinearFilter } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

/** Same HDR/EXR loaders, float storage, mapping and filtering as admin AssetLoader. */
export async function loadVerifiedStudentEnvironment( asset, catalogue, { signal } = {} ) {

	if ( asset?.kind !== 'environment' || asset.byteLength > 32 * 1024 * 1024 || ! [ 'image/vnd.radiance', 'image/x-hdr', 'image/x-exr' ].includes( asset.mimeType ) ) throw new Error( 'Unsupported bounded HDRI environment.' );
	const bytes = await catalogue.getAssetBytes( asset, { signal } );
	signal?.throwIfAborted();
	if ( bytes.byteLength !== asset.byteLength ) throw new Error( 'HDRI bytes do not match immutable size.' );
	const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	if ( hash !== asset.sha256 ) throw new Error( 'HDRI bytes do not match immutable hash.' );
	signal?.throwIfAborted();
	const loader = asset.mimeType === 'image/x-exr' ? new EXRLoader() : new HDRLoader();
	const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
	const texture = loader.setDataType( FloatType ).createDataTexture( buffer );
	if ( texture.image.width * texture.image.height > 8 * 1024 * 1024 ) {

		texture.dispose(); throw new Error( 'HDRI decoded image exceeds the supported limit.' );

	}

	texture.mapping = EquirectangularReflectionMapping;
	texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
	texture.generateMipmaps = true; texture.needsUpdate = true;
	return texture;

}
