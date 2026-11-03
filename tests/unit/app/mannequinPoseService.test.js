import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isPoseMesh, mannequinPose, prepareMannequin } from '@/utils/mannequinPoses';

const state = vi.hoisted( () => ( { app: null, loading: { isLoading: false }, selectedObject: null } ) );
vi.mock( '@/lib/appProxy', () => ( { getApp: () => state.app } ) );
vi.mock( '@/store', () => ( {
	useStore: { getState: () => ( {
		...state,
		setLoading: value => {

			state.loading = value;

		},
		resetLoading: () => {

			state.loading = { isLoading: false };

		},
	} ) },
} ) );
import { setMannequinPose } from '@/services/MannequinPoseService';

async function fixture() {

	const buffer = readFileSync( new URL( '../../../app/public/characters/mannequin/mannequin-presets.glb', import.meta.url ) );
	const data = await new GLTFLoader().parseAsync( buffer.buffer.slice( buffer.byteOffset, buffer.byteOffset + buffer.byteLength ), '' );
	prepareMannequin( data.scene );
	state.selectedObject = data.scene;
	const sceneMeshes = [ { name: 'Unrelated ground' } ];
	data.scene.traverse( mesh => {

		if ( isPoseMesh( mesh ) ) sceneMeshes.push( mesh );

	} );
	state.app = { sceneMeshes, pauseRendering: false, reset: vi.fn(), loadSceneData: vi.fn(), refitBLASes: vi.fn(), dispatchEvent: vi.fn(), interactionManager: { select: vi.fn() } };
	state.app._paused = false;
	state.app.pause = vi.fn( () => {

		state.app._paused = true;

	} );
	state.app.resume = vi.fn( () => {

		state.app._paused = false;

	} );
	return data.scene;

}

afterEach( () => {

	state.app = null;
	state.loading = { isLoading: false };
	state.selectedObject = null;

} );

describe( 'mannequin pose uploads', () => {

	it( 'pauses rendering during upload and restores selection and render state', async () => {

		const root = await fixture();
		state.app.refitBLASes.mockImplementation( ( indices, positions, normals ) => {

			expect( state.app.pauseRendering ).toBe( true );
			expect( state.app._paused ).toBe( true );
			expect( mannequinPose( root ) ).toBe( 'sitting' );
			expect( indices ).toEqual( [ 1, 2 ] );
			expect( state.loading.isLoading ).toBe( false );
			for ( const index of indices ) {

				const mesh = state.app.sceneMeshes[ index ];
				const count = mesh.geometry.index.count * 3;
				expect( positions( index ) ).toHaveLength( count );
				expect( normals( index ) ).toHaveLength( count );
				expect( normals( index ).every( Number.isFinite ) ).toBe( true );

			}

		} );
		await setMannequinPose( root, 'sitting' );
		expect( state.app.pauseRendering ).toBe( false );
		expect( state.app.resume ).toHaveBeenCalledOnce();
		expect( state.app.interactionManager.select ).not.toHaveBeenCalled();
		expect( state.app.loadSceneData ).not.toHaveBeenCalled();
		expect( state.app.dispatchEvent ).toHaveBeenCalledWith( { type: 'MannequinPoseChanged', id: root.uuid, pose: 'sitting' } );
		expect( state.loading.isLoading ).toBe( false );

	} );

	it( 'rolls back geometry when upload fails and leaves a paused renderer paused', async () => {

		const root = await fixture();
		state.app.pauseRendering = true;
		state.app._paused = true;
		state.app.refitBLASes.mockImplementationOnce( () => {

			throw new Error( 'GPU upload failed' );

		} );
		await expect( setMannequinPose( root, 'sitting' ) ).rejects.toThrow( 'GPU upload failed' );
		expect( mannequinPose( root ) ).toBe( 'standing' );
		expect( state.app.refitBLASes ).toHaveBeenCalledTimes( 2 );
		expect( state.app.loadSceneData ).not.toHaveBeenCalled();
		expect( state.app.pauseRendering ).toBe( true );
		expect( state.app.resume ).not.toHaveBeenCalled();
		expect( state.loading.isLoading ).toBe( false );

	} );

	it( 'refuses to overlap a scene load and does not alter its geometry', async () => {

		const root = await fixture();
		state.loading.isLoading = true;
		await expect( setMannequinPose( root, 'sitting' ) ).rejects.toThrow( 'Wait for the current scene update' );
		expect( mannequinPose( root ) ).toBe( 'standing' );
		expect( state.app.loadSceneData ).not.toHaveBeenCalled();

	} );

} );
