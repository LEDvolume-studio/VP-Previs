import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh } from 'three';
import { editObjectAttribute, readObjectAttributes } from '@/utils/objectAttributes';
import { captureNodeTransform, restoreNodeTransform } from '@/services/projects/projectStateUtils';

function fixture() {

	const root = new Group();
	const folder = new Group();
	const mesh = new Mesh( new BoxGeometry( 2, 4, 6 ) );
	root.add( folder );
	folder.add( mesh );
	root.position.x = 10;
	folder.position.x = 3;
	root.scale.setScalar( 2 );
	return { root, folder, mesh };

}

describe( 'object attributes', () => {

	it( 'measures nested geometry in world units while showing local transforms', () => {

		const { folder, mesh } = fixture();
		mesh.visible = false;
		expect( readObjectAttributes( folder ) ).toEqual( {
			position: [ 3, 0, 0 ], rotation: [ 0, 0, 0 ], scale: [ 1, 1, 1 ], size: [ 4, 8, 12 ],
		} );
		folder.rotation.z = Math.PI / 2;
		const { size } = readObjectAttributes( folder );
		expect( size[ 0 ] ).toBeCloseTo( 8 );
		expect( size[ 1 ] ).toBeCloseTo( 4 );

	} );

	it( 'edits a whole folder without baking transforms into children and brackets updates for undo', () => {

		const { folder, mesh } = fixture();
		const before = captureNodeTransform( mesh );
		const events = [];
		const app = {
			dispatchEvent: event => events.push( [ event.type, event.object.rotation.y ] ),
			transformManager: { applyObjectTransform: vi.fn() },
		};
		expect( editObjectAttribute( app, folder, 'rotation', 'y', 90 ) ).toBe( true );
		expect( events ).toEqual( [[ 'engine:objectTransformStart', 0 ], [ 'engine:objectTransformEnd', Math.PI / 2 ]] );
		expect( app.transformManager.applyObjectTransform ).toHaveBeenCalledWith( folder );
		expect( captureNodeTransform( mesh ) ).toEqual( before );

	} );

	it( 'round trips nested local transforms through JSON without applying parent scale twice', () => {

		const { root, folder, mesh } = fixture();
		folder.rotation.y = 0.8;
		mesh.position.z = 5;
		mesh.scale.x = - 2;
		const expected = readObjectAttributes( root );
		const saved = JSON.parse( JSON.stringify( [ root, folder, mesh ].map( captureNodeTransform ) ) );
		const restored = fixture();
		[ restored.root, restored.folder, restored.mesh ].forEach( ( node, i ) => restoreNodeTransform( node, saved[ i ] ) );
		readObjectAttributes( restored.root ).size.forEach( ( value, i ) => expect( value ).toBeCloseTo( expected.size[ i ] ) );

	} );

	it( 'rejects non-finite inputs and singular scales before any mutation or undo event', () => {

		const { folder } = fixture();
		const app = { dispatchEvent: vi.fn(), transformManager: { applyObjectTransform: vi.fn() } };
		for ( const value of [ NaN, Infinity, - Infinity, 0, 1e-10 ] ) {

			expect( editObjectAttribute( app, folder, 'scale', 'x', value ) ).toBe( false );

		}

		expect( folder.scale.x ).toBe( 1 );
		expect( app.dispatchEvent ).not.toHaveBeenCalled();
		expect( readObjectAttributes( new Group() ).size ).toBeNull();

	} );

} );
