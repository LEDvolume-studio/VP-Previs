/**
 * Preserve Rayzee's imported-material depth policy without requiring geometry
 * extraction in raster-only hosts. glTF BLEND defaults to depthWrite=false;
 * leaving it disabled lets later transparent meshes draw through opaque texels.
 * Alpha/opacity remain authored, so window glass still blends normally.
 * Returns whether the existing admin preparation changed the material.
 */
export function prepareRasterMaterial( material ) {

	if ( material.depthWrite !== false ) return false;
	material.depthWrite = true;
	return true;

}
