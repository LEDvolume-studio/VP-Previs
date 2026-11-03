import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyVehicleDoorPose, vehicleDoorHinges, vehicleDoorOpenStates, vehicleDoorPose, VEHICLE_DOOR_POSES } from '@/utils/vehicleDoorPoses';
import { captureNodeTransform, restoreNodeTransform } from '@/services/projects/projectStateUtils';

const state = vi.hoisted( () => ( { app: null, loading: { isLoading: false } } ) );
vi.mock( '@/lib/appProxy', () => ( { getApp: () => state.app } ) );
vi.mock( '@/store', () => ( { useStore: { getState: () => state } } ) );
import { restoreVehicleDoorState, setVehicleDoorOpen, setVehicleDoorPose, vehicleDoorState } from '@/services/VehicleDoorPoseService';
import { restoreVehicleWindowState, setVehicleWindowTransparency, vehicleWindowState, vehicleWindowTransparency } from '@/services/VehicleWindowService';

const bytes = readFileSync( new URL( '../../../app/public/vehicles/mid-suv/mid-suv.glb', import.meta.url ) );
const jsonLength = bytes.readUInt32LE( 12 );
const asset = JSON.parse( bytes.subarray( 20, 20 + jsonLength ) );
let source;

async function fixture() {

	if ( ! source ) {

		// Load the actual delivered geometry and hinges in Node. Browser image
		// decoding is excluded here; embedded textures are checked separately.
		const document = structuredClone( asset );
		document.materials = document.materials.map( material => ( { name: material.name, extras: material.extras } ) );
		document.images = [];
		document.textures = [];
		let json = Buffer.from( JSON.stringify( document ) );
		json = Buffer.concat( [ json, Buffer.alloc( ( 4 - json.length % 4 ) % 4, 32 ) ] );
		const binary = bytes.subarray( 20 + jsonLength );
		const header = Buffer.alloc( 20 );
		header.writeUInt32LE( 0x46546c67, 0 );
		header.writeUInt32LE( 2, 4 );
		header.writeUInt32LE( 20 + json.length + binary.length, 8 );
		header.writeUInt32LE( json.length, 12 );
		header.writeUInt32LE( 0x4e4f534a, 16 );
		const glb = Buffer.concat( [ header, json, binary ] );
		source = ( await new GLTFLoader().parseAsync( glb.buffer.slice( glb.byteOffset, glb.byteOffset + glb.byteLength ), '' ) ).scene;

	}

	const root = source.clone( true );
	const materials = new Map();
	root.traverse( node => {

		if ( ! node.isMesh ) return;
		if ( ! materials.has( node.material ) ) materials.set( node.material, node.material.clone() );
		node.material = materials.get( node.material );

	} );
	return root;

}

function parts( root ) {

	const meshes = [];
	root.traverse( node => {

		if ( node.isMesh ) meshes.push( node );

	} );
	return meshes;

}

afterEach( () => {

	state.app = null; state.loading.isLoading = false;

} );

describe( 'Mid SUV door rig', () => {

	it( 'ships embedded PBR images and separately identified hinge groups', () => {

		expect( asset.images.length ).toBeGreaterThan( 30 );
		expect( asset.images.every( image => image.bufferView !== undefined && ! image.uri ) ).toBe( true );
		expect( asset.materials.some( material => material.pbrMetallicRoughness?.baseColorTexture ) ).toBe( true );
		expect( asset.materials.some( material => material.normalTexture ) ).toBe( true );
		expect( asset.nodes.filter( node => node.extras?.rayzeeVehicleDoor ).map( node => node.extras.rayzeeVehicleDoor ).sort() ).toEqual( [ 'left', 'right' ] );

	} );

	it( 'fades only dedicated window glass, with independent instances and restorable state', async () => {

		const root = await fixture();
		const other = await fixture();
		const meshes = parts( root );
		meshes.forEach( ( mesh, index ) => {

			mesh.userData.materialIndex = index;

		} );
		const glass = meshes.filter( mesh => mesh.material.userData.rayzeeVehicleWindowGlass );
		expect( glass ).toHaveLength( 6 );
		expect( asset.materials.find( material => material.extras?.rayzeeVehicleWindowGlass ).name ).toBe( 'KB3D_MidSUV_WindowGlass' );
		expect( meshes.some( mesh => mesh.material.name === 'KB3D_CEV_TranslElemMidSUV' && ! mesh.material.userData.rayzeeVehicleWindowGlass ) ).toBe( true );
		state.app = { sceneMeshes: meshes, setMaterialProperty: vi.fn(), dispatchEvent: vi.fn(), loadSceneData: vi.fn() };
		const before = vehicleWindowState( root );
		const opaque = meshes.filter( mesh => ! glass.includes( mesh ) ).map( mesh => ( { material: mesh.material, opacity: mesh.material.opacity, transparent: mesh.material.transparent } ) );
		for ( const percent of [ 0, 65, 100 ] ) {

			setVehicleWindowTransparency( root, percent );
			expect( vehicleWindowTransparency( root ) ).toBe( percent );
			expect( glass.every( mesh => mesh.material.opacity === 1 - percent / 100 && mesh.material.transparent ) ).toBe( true );
			expect( vehicleWindowTransparency( other ) ).toBe( 0 );
			opaque.forEach( item => {

				expect( item.material.opacity ).toBe( item.opacity );
				expect( item.material.transparent ).toBe( item.transparent );

			} );

		}

		restoreVehicleWindowState( root, before );
		expect( vehicleWindowState( root ) ).toEqual( before );
		expect( state.app.setMaterialProperty.mock.calls.every( ( [ index ] ) => glass.includes( meshes[ index ] ) ) ).toBe( true );
		expect( state.app.loadSceneData ).not.toHaveBeenCalled();
		expect( () => setVehicleWindowTransparency( root, NaN ) ).toThrow( /between 0 and 100/ );
		state.loading.isLoading = true;
		expect( () => setVehicleWindowTransparency( root, 50 ) ).toThrow( /Wait/ );

	} );

	it( 'opens complete door assemblies around fixed hinges without changing body geometry', async () => {

		const root = await fixture();
		root.position.set( 3, 1, - 4 );
		root.rotation.y = 0.5;
		root.scale.set( 1.1, 0.9, 1.2 );
		root.updateWorldMatrix( true, true );
		const hinges = vehicleDoorHinges( root );
		expect( hinges ).toHaveLength( 2 );
		for ( const hinge of hinges ) expect( parts( hinge ) ).toHaveLength( 6 );
		const pivots = hinges.map( hinge => hinge.getWorldPosition( new Vector3() ).toArray() );
		const original = parts( root ).map( mesh => ( { geometry: mesh.geometry, positions: mesh.geometry.attributes.position.array, world: mesh.matrixWorld.clone() } ) );
		const other = root.clone( true );
		for ( const pose of VEHICLE_DOOR_POSES ) {

			applyVehicleDoorPose( root, pose.id );
			expect( vehicleDoorPose( root ) ).toBe( pose.id );
			expect( hinges.map( hinge => hinge.getWorldPosition( new Vector3() ).toArray() ) ).toEqual( pivots );
			expect( vehicleDoorPose( other ) ).toBe( 'closed' );
			parts( root ).forEach( ( mesh, index ) => {

				expect( mesh.geometry ).toBe( original[ index ].geometry );
				expect( mesh.geometry.attributes.position.array ).toBe( original[ index ].positions );
				if ( ! mesh.name.includes( 'FrontDoor' ) ) expect( mesh.matrixWorld.equals( original[ index ].world ) ).toBe( true );

			} );

		}

		applyVehicleDoorPose( root, 'closed' );
		parts( root ).forEach( ( mesh, index ) => expect( mesh.matrixWorld.elements ).toEqual( original[ index ].world.elements ) );
		applyVehicleDoorPose( root, 'both-open' );
		const saved = JSON.parse( JSON.stringify( hinges.map( captureNodeTransform ) ) );
		const restored = await fixture();
		vehicleDoorHinges( restored ).forEach( ( hinge, index ) => restoreNodeTransform( hinge, saved[ index ] ) );
		expect( vehicleDoorPose( restored ) ).toBe( 'both-open' );

	} );

	it( 'toggles one door without disturbing a custom angle on the other door', async () => {

		const root = await fixture();
		state.app = { sceneMeshes: parts( root ), updateMeshTransforms: vi.fn(), dispatchEvent: vi.fn() };
		const left = vehicleDoorHinges( root ).find( hinge => hinge.userData.rayzeeVehicleDoor === 'left' );
		left.rotation.y = 0.25;
		const custom = left.quaternion.clone();
		expect( vehicleDoorOpenStates( root ) ).toEqual( { left: true, right: false } );
		setVehicleDoorOpen( root, 'right', true );
		expect( vehicleDoorOpenStates( root ) ).toEqual( { left: true, right: true } );
		expect( left.quaternion.equals( custom ) ).toBe( true );
		setVehicleDoorOpen( root, 'right', false );
		expect( left.quaternion.equals( custom ) ).toBe( true );
		setVehicleDoorOpen( root, 'left', false );
		expect( vehicleDoorPose( root ) ).toBe( 'closed' );
		setVehicleDoorOpen( root, 'right', true );
		expect( vehicleDoorPose( root ) ).toBe( 'right-open' );
		setVehicleDoorOpen( root, 'left', true );
		expect( vehicleDoorPose( root ) ).toBe( 'both-open' );
		setVehicleDoorOpen( root, 'right', false );
		expect( vehicleDoorPose( root ) ).toBe( 'left-open' );

	} );

	it( 'updates only door placement matrices and restores custom-angle undo states', async () => {

		const root = await fixture();
		const meshes = parts( root );
		state.app = { sceneMeshes: [ new Mesh(), ...meshes ], updateMeshTransforms: vi.fn(), loadSceneData: vi.fn(), refitBLASes: vi.fn(), dispatchEvent: vi.fn() };
		vehicleDoorHinges( root )[ 0 ].rotation.y = 0.25;
		const custom = vehicleDoorState( root );
		expect( vehicleDoorPose( root ) ).toBe( 'custom' );
		setVehicleDoorPose( root, 'both-open' );
		const indices = state.app.updateMeshTransforms.mock.calls[ 0 ][ 0 ];
		expect( indices ).toHaveLength( 12 );
		expect( indices.every( index => state.app.sceneMeshes[ index ].name.includes( 'FrontDoor' ) ) ).toBe( true );
		expect( state.app.loadSceneData ).not.toHaveBeenCalled();
		expect( state.app.refitBLASes ).not.toHaveBeenCalled();
		restoreVehicleDoorState( root, custom );
		expect( vehicleDoorState( root ) ).toEqual( custom );
		expect( state.app.dispatchEvent ).toHaveBeenCalledWith( { type: 'VehiclePoseChanged', id: root.uuid } );

	} );

	it( 'rolls back failed uploads and rejects scene-load overlaps', async () => {

		const root = await fixture();
		state.app = { sceneMeshes: parts( root ), updateMeshTransforms: vi.fn().mockImplementationOnce( () => {

			throw new Error( 'GPU update failed' );

		} ), dispatchEvent: vi.fn() };
		expect( () => setVehicleDoorPose( root, 'left-open' ) ).toThrow( 'GPU update failed' );
		expect( vehicleDoorPose( root ) ).toBe( 'closed' );
		expect( state.app.updateMeshTransforms ).toHaveBeenCalledTimes( 2 );
		state.loading.isLoading = true;
		expect( () => setVehicleDoorPose( root, 'right-open' ) ).toThrow( 'Wait for the current scene update' );
		expect( vehicleDoorPose( root ) ).toBe( 'closed' );

	} );

} );
