import { serializeStudentCatalogueContent } from '../../previs/domain/StudentCatalogueSchema.js';
import { assetVersionKey } from '../../previs/domain/StudentProjectSchema.js';

/** Same-origin device library; portable JSON supplies identities, never URLs. */
export function createLocalPresetCatalogue( repository, { fallback } = {} ) {

	return {
		async hasScene( reference ) {

			return Boolean( await repository.getScene( reference ) );

		},
		async getScene( reference, { signal } = {} ) {

			signal?.throwIfAborted();
			const value = await repository.getScene( reference );
			signal?.throwIfAborted();
			if ( ! value && fallback ) return fallback.getScene( reference, { signal } );
			if ( ! value ) throw new Error( 'This local preset scene is unavailable on this device.' );
			return structuredClone( value );

		},
		async getAssetBytes( asset, { signal } = {} ) {

			signal?.throwIfAborted();
			const record = await repository.getAssetRecord( asset );
			signal?.throwIfAborted();
			if ( ! record && fallback ) return fallback.getAssetBytes( asset, { signal } );
			if ( ! record || serializeStudentCatalogueContent( record.asset ) !== serializeStudentCatalogueContent( asset ) ) throw new Error( `Local preset asset ${assetVersionKey( asset )} is missing or has different metadata.` );
			const bytes = new Uint8Array( await record.blob.arrayBuffer() );
			signal?.throwIfAborted();
			if ( bytes.byteLength !== asset.byteLength ) throw new Error( 'Local preset asset size changed.' );
			const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			if ( hash !== asset.sha256 ) throw new Error( 'Local preset asset hash changed.' );
			return bytes;

		},
	};

}
