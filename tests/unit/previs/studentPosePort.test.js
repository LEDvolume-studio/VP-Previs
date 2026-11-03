import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Group } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { isPoseMesh, prepareMannequin } from '../../../app/src/utils/mannequinPoses.js';
import { createStudentPosePort } from '../../../app/src/previs/engine/StudentPosePort.js';

let model;
beforeAll( async () => {

	const bytes = await readFile( new URL( '../../../app/public/characters/mannequin/mannequin-presets.glb', import.meta.url ) );
	model = ( await new GLTFLoader().parseAsync( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ), '' ) ).scene;

} );
const poseMeshes = root => {

	const meshes = [];
	root.traverse( object => {

		if ( isPoseMesh( object ) ) meshes.push( object );

	} );
	return meshes;

};

const positions = root => poseMeshes( root ).map( mesh => Array.from( mesh.geometry.attributes.position.array ) );
function fixture() {

	const human = clone( model );
	prepareMannequin( human, 'standing' );
	const hinge = new Group();
	hinge.rotation.y = 0.7;
	const onGeometryChanged = vi.fn();
	const nodeObjects = new Map( [[ 'human', human ], [ 'hinge', hinge ]] );
	const humanRoots = new Set( [ 'human' ] );
	const port = createStudentPosePort( { nodeObjects, humanRoots, onGeometryChanged } );
	return { human, hinge, nodeObjects, humanRoots, port, onGeometryChanged };

}

describe( 'student raster mannequin pose port against the actual bundled GLB', () => {

	it( 'changes real pose geometry A → B → A without drift, door rotation changes or shared-instance mutation', () => {

		const view = fixture();
		const other = fixture();
		const original = positions( view.human );
		const otherOriginal = positions( other.human );
		const hinge = view.hinge.quaternion.toArray();
		const saved = view.port.capture();
		expect( saved ).toEqual( { human: { humanPose: 'standing', doorAngles: {} }, hinge: { humanPose: null, doorAngles: {} } } );
		view.port.apply( saved );
		expect( view.onGeometryChanged ).not.toHaveBeenCalled();
		for ( let index = 0; index < 3; index ++ ) {

			view.port.apply( { human: { humanPose: 'sitting', doorAngles: {} }, hinge: { humanPose: null, doorAngles: {} } } );
			expect( positions( view.human ) ).not.toEqual( original );
			expect( positions( other.human ) ).toEqual( otherOriginal );
			expect( view.hinge.quaternion.toArray() ).toEqual( hinge );
			view.port.restore( saved );
			expect( positions( view.human ) ).toEqual( original );

		}

		expect( view.onGeometryChanged ).toHaveBeenCalledTimes( 6 );
		for ( const mesh of poseMeshes( view.human ) ) {

			expect( mesh.morphTargetInfluences ).toEqual( [ 0, 0 ] );
			expect( mesh.geometry.boundingBox ).not.toBeNull();
			expect( mesh.geometry.boundingSphere ).not.toBeNull();

		}

	} );

	it( 'keeps owned GPU attribute and array identity across repeated pose cuts', () => {

		const view = fixture();
		const original = poseMeshes( view.human ).map( mesh => ( { geometry: mesh.geometry, position: mesh.geometry.getAttribute( 'position' ), normal: mesh.geometry.getAttribute( 'normal' ) } ) );
		const saved = view.port.capture();
		const sitting = structuredClone( saved );
		sitting.human.humanPose = 'sitting';
		for ( let iteration = 0; iteration < 8; iteration ++ ) {

			view.port.apply( sitting );
			view.port.restore( saved );
			poseMeshes( view.human ).forEach( ( mesh, index ) => {

				expect( mesh.geometry ).toBe( original[ index ].geometry );
				for ( const name of [ 'position', 'normal' ] ) {

					expect( mesh.geometry.getAttribute( name ) ).toBe( original[ index ][ name ] );
					expect( mesh.geometry.getAttribute( name ).version ).toBe( ( iteration + 1 ) * 2 );

				}

			} );

		}

	} );

	it( 'returns detached read-only captures and keeps its copied root/node mapping', () => {

		const view = fixture();
		const before = positions( view.human );
		const captured = view.port.read();
		captured.human.humanPose = 'sitting';
		captured.human.doorAngles.invented = 9;
		expect( view.port.read().human ).toEqual( { humanPose: 'standing', doorAngles: {} } );
		expect( positions( view.human ) ).toEqual( before );
		view.nodeObjects.clear();
		view.humanRoots.clear();
		view.port.apply( { human: { humanPose: 'sitting', doorAngles: {} }, hinge: { humanPose: null, doorAngles: {} } } );
		expect( view.port.read().human.humanPose ).toBe( 'sitting' );

	} );

	it.each( [
		[ 'missing inventory', values => delete values.hinge ],
		[ 'unknown inventory', values => values.extra = { humanPose: null, doorAngles: {} } ],
		[ 'unsupported pose', values => values.human.humanPose = 'running' ],
		[ 'pose on a non-human node', values => values.hinge.humanPose = 'sitting' ],
		[ 'scalar door reconstruction', values => values.hinge.doorAngles = { leftFront: 0.3 } ],
	] )( 'rejects %s before geometry changes', ( _, mutate ) => {

		const view = fixture();
		const before = positions( view.human );
		const values = view.port.read();
		mutate( values );
		expect( () => view.port.validate( values ) ).toThrow();
		expect( () => view.port.apply( values ) ).toThrow();
		expect( positions( view.human ) ).toEqual( before );
		expect( view.onGeometryChanged ).not.toHaveBeenCalled();

	} );

	it.each( [
		[ 'missing sitting dictionary', mesh => delete mesh.morphTargetDictionary.sitting ],
		[ 'missing sitting normal samples', mesh => mesh.geometry.morphAttributes.normal.pop() ],
		[ 'missing base normals', mesh => mesh.geometry.deleteAttribute( 'normal' ) ],
		[ 'missing influence array', mesh => mesh.morphTargetInfluences = null ],
	] )( 'rejects an unprepared rig with %s at construction', ( _, mutate ) => {

		const root = clone( model );
		// Own the attributes before deliberately damaging a fixture.
		for ( const mesh of poseMeshes( root ) ) mesh.geometry = mesh.geometry.clone();
		mutate( poseMeshes( root )[ 0 ] );
		expect( () => createStudentPosePort( { nodeObjects: new Map( [[ 'human', root ]] ), humanRoots: new Set( [ 'human' ] ) } ) ).toThrow( /ready mannequin|complete standing\/sitting/ );

	} );

} );
