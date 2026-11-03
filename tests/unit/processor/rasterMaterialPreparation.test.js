import { MeshStandardMaterial, Texture } from 'three';
import { expect, it } from 'vitest';
import { GeometryExtractor } from '../../../rayzee/src/Processor/GeometryExtractor.js';
import { prepareRasterMaterial } from '../../../rayzee/src/Processor/RasterMaterialPreparation.js';

it.each( [ 1, 0.06 ] )( 'matches admin depth preparation without altering authored opacity %s or alpha textures', opacity => {

	const material = new MeshStandardMaterial( { transparent: true, opacity, depthWrite: false, alphaMap: new Texture() } );
	const admin = material.clone(), alpha = material.alphaMap;
	new GeometryExtractor().processMaterial( admin );
	expect( prepareRasterMaterial( material ) ).toBe( true );
	expect( material.depthWrite ).toBe( admin.depthWrite );
	expect( material.depthWrite ).toBe( true );
	expect( material.opacity ).toBe( opacity ); expect( material.transparent ).toBe( true );
	expect( material.alphaMap ).toBe( alpha );
	expect( prepareRasterMaterial( material ) ).toBe( false );
	material.dispose(); admin.dispose(); alpha.dispose();

} );
