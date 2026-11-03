import { Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createStudentMaterialPort } from '../../../app/src/previs/engine/StudentMaterialPort.js';
import { validateStudentMaterials } from '../../../app/src/previs/domain/StudentMaterialState.js';
import { applyMaterialState, serializeMaterial } from '../../../app/src/services/projects/MaterialState.js';

function fixture() {

	const root = new Group(), shared = new MeshStandardMaterial();
	shared.normalMap = new Texture(); shared.map = new Texture();
	const mesh = new Mesh( undefined, shared ), sibling = new Mesh( undefined, shared );
	root.add( mesh, sibling );
	const state = serializeMaterial( shared ); state.values.normalScale = [ 1, - 1 ]; state.values.opacity = 0.06; state.values.transparent = true;
	const inventory = { body: [ { path: [ 0 ], slot: 0, state } ] };
	const trackResources = vi.fn(), onChanged = vi.fn();
	const port = createStudentMaterialPort( { nodeObjects: new Map( [[ 'body', root ]] ), inventory, trackResources, onChanged } );
	return { root, shared, mesh, sibling, inventory, port, trackResources, onChanged };

}

describe( 'authored student materials', () => {

	it( 'uses identical admin restoration for normal orientation, glass opacity and UV transforms without mutating shared model materials', () => {

		const { shared, mesh, sibling, inventory, port, trackResources } = fixture();
		inventory.body[ 0 ].state.textures.map.repeat = [ 2, 3 ];
		const admin = shared.clone(); admin.map = shared.map.clone(); applyMaterialState( admin, inventory.body[ 0 ].state );
		port.apply( inventory );
		expect( serializeMaterial( mesh.material ) ).toEqual( serializeMaterial( admin ) );
		expect( mesh.material.normalScale.toArray() ).toEqual( [ 1, - 1 ] );
		expect( mesh.material.opacity ).toBe( 0.06 );
		expect( sibling.material ).toBe( shared ); expect( shared.opacity ).toBe( 1 );
		expect( shared.map.repeat.toArray() ).toEqual( [ 1, 1 ] );
		expect( trackResources ).toHaveBeenCalledWith( mesh.material );

	} );

	it( 'captures and restores materials across shots including null→embedded texture restoration', () => {

		const { mesh, inventory, port } = fixture();
		port.apply( inventory ); const before = port.capture();
		const edited = structuredClone( before ); edited.body[ 0 ].state.textures.map = null; edited.body[ 0 ].state.values.opacity = 0.9;
		port.apply( edited ); expect( mesh.material.map ).toBeNull(); expect( mesh.material.opacity ).toBe( 0.9 );
		port.restore( before ); expect( mesh.material.map.isTexture ).toBe( true ); expect( port.read() ).toEqual( before );

	} );

	it( 'updates renderer material-dependent lighting only after applying or restoring state', () => {

		const { inventory, port, onChanged } = fixture();
		port.validate( inventory ); expect( onChanged ).not.toHaveBeenCalled();
		port.apply( inventory ); expect( onChanged ).toHaveBeenCalledTimes( 1 );
		port.restore( inventory ); expect( onChanged ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'rejects aliased node mappings before mutating either mesh material', () => {

		const root = new Group(), mesh = new Mesh( undefined, new MeshStandardMaterial() ); root.add( mesh );
		const original = mesh.material, state = serializeMaterial( original );
		expect( () => createStudentMaterialPort( {
			nodeObjects: new Map( [[ 'parent', root ], [ 'child', mesh ]] ),
			inventory: { parent: [ { path: [ 0 ], slot: 0, state } ], child: [ { path: [], slot: 0, state } ] },
		} ) ).toThrow( 'same model primitive twice' );
		expect( mesh.material ).toBe( original );

	} );

	it.each( [
		value => {

			value.body[ 0 ].state.values.onBeforeCompile = 'code';

		},
		value => {

			value.body[ 0 ].state.textures.map.url = 'https://invalid.test/image';

		},
		value => {

			value.body[ 0 ].state.values.normalScale = [ 1, null ];

		},
		value => {

			value.body[ 0 ].path = [ - 1 ];

		},
		value => {

			value.body[ 0 ].state.catalogMaterial = {};

		},
	] )( 'rejects unsafe or unsupported portable material fields before mutation %#', mutate => {

		const { mesh, inventory, port } = fixture(); const before = serializeMaterial( mesh.material ); mutate( inventory );
		expect( () => validateStudentMaterials( inventory, { body: {} } ) ).toThrow();
		expect( () => port.apply( inventory ) ).toThrow(); expect( serializeMaterial( mesh.material ) ).toEqual( before );

	} );

	it( 'rejects missing primitive bindings and unavailable texture slots', () => {

		const { inventory, port } = fixture();
		const unknown = structuredClone( inventory ); unknown.body[ 0 ].path = [ 9 ];
		expect( () => port.apply( unknown ) ).toThrow( 'mapping changed' );
		inventory.body[ 0 ].state.textures.emissiveMap = structuredClone( inventory.body[ 0 ].state.textures.map );
		expect( () => port.apply( inventory ) ).toThrow( 'not embedded' );

	} );

} );
