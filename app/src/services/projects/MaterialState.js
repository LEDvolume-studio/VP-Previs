/** Shared native material capture/restoration used by admin and student views. */
export const MATERIAL_SCALARS = [
	'roughness', 'metalness', 'ior', 'opacity', 'transmission', 'thickness',
	'attenuationDistance', 'dispersion', 'sheen', 'sheenRoughness',
	'specularIntensity', 'clearcoat', 'clearcoatRoughness', 'iridescence',
	'iridescenceIOR', 'subsurface', 'subsurfaceRadiusScale',
	'subsurfaceAnisotropy', 'anisotropy', 'anisotropyRotation', 'emissiveIntensity',
	'transparent', 'alphaTest', 'side', 'normalScale', 'bumpScale',
	'displacementScale', 'displacementBias',
];
export const MATERIAL_COLORS = [ 'color', 'emissive', 'attenuationColor', 'sheenColor', 'specularColor', 'subsurfaceColor' ];
export const MATERIAL_ARRAYS = [ 'iridescenceThicknessRange', 'subsurfaceRadius' ];
export const TEXTURE_SLOTS = [
	'map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap',
	'aoMap', 'alphaMap', 'lightMap', 'specularMap', 'clearcoatNormalMap',
	'displacementMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'transmissionMap',
	'thicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap',
	'specularColorMap', 'iridescenceMap', 'iridescenceThicknessMap',
];

const finiteOrNull = value => typeof value === 'number' && ! Number.isFinite( value ) ? null : value;

function serializeTexture( texture ) {

	if ( ! texture?.isTexture ) return null;
	return {
		name: texture.name || '',
		offset: texture.offset?.toArray?.() || [ 0, 0 ],
		repeat: texture.repeat?.toArray?.() || [ 1, 1 ],
		center: texture.center?.toArray?.() || [ 0, 0 ],
		rotation: texture.rotation || 0,
		flipY: !! texture.flipY,
		channel: texture.channel || 0,
	};

}

export function serializeMaterial( material ) {

	const result = { name: material.name || '', type: material.type, values: {}, colors: {}, arrays: {}, textures: {} };
	for ( const key of MATERIAL_SCALARS ) {

		let value = material[ key ];
		if ( value?.isVector2 ) value = value.toArray();
		if ( value !== undefined ) result.values[ key ] = finiteOrNull( value );

	}

	for ( const key of MATERIAL_COLORS ) if ( material[ key ]?.isColor ) result.colors[ key ] = `#${material[ key ].getHexString()}`;
	for ( const key of MATERIAL_ARRAYS ) if ( material[ key ] != null ) result.arrays[ key ] = Array.from( material[ key ] );
	for ( const key of TEXTURE_SLOTS ) {

		const texture = serializeTexture( material[ key ] );
		result.textures[ key ] = texture;

	}

	if ( material.userData?.rayzeeCatalogMaterial ) result.catalogMaterial = { ...material.userData.rayzeeCatalogMaterial };
	return result;

}

export function applyMaterialState( material, state ) {

	if ( ! material || ! state ) return;
	material.name = state.name || material.name;
	for ( const [ key, value ] of Object.entries( state.values || {} ) ) {

		const resolved = key === 'attenuationDistance' && value === null ? Infinity : value;
		if ( material[ key ]?.isVector2 && Array.isArray( resolved ) ) material[ key ].fromArray( resolved );
		else material[ key ] = resolved;

	}

	for ( const [ key, value ] of Object.entries( state.colors || {} ) ) material[ key ]?.set?.( value );
	for ( const [ key, value ] of Object.entries( state.arrays || {} ) ) material[ key ] = [ ...value ];
	for ( const [ key, value ] of Object.entries( state.textures || {} ) ) {

		if ( value === null ) {

			material[ key ] = null;
			continue;

		}

		const texture = material[ key ];
		if ( ! texture ) continue;
		if ( value.offset ) texture.offset.fromArray( value.offset );
		if ( value.repeat ) texture.repeat.fromArray( value.repeat );
		if ( value.center ) texture.center.fromArray( value.center );
		texture.rotation = value.rotation || 0;
		texture.flipY = !! value.flipY;
		texture.channel = value.channel || 0;
		texture.updateMatrix?.();
		texture.needsUpdate = true;

	}

	material.needsUpdate = true;

}

