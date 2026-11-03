import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createStudentDemoCatalogue, createStudentDemoProject, isStudentDemoScene, copyDemoWithAdminAppearance } from '../../../app/src/student/demo/StudentDemo.js';
import prepared from '../../../app/src/student/demo/studio-review.preset.json';
import { validateStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { validatePresetModelBytes } from '../../../app/src/previs/engine/SupportedGLB.js';

const root = new URL( '../../../', import.meta.url );
async function bundledFetch( source ) {

	const path = source.includes( 'timecode.mp4' ) ? 'app/src/student/demo/timecode.mp4' : `app/public${source}`;
	const bytes = await readFile( new URL( path, root ) );
	return new Response( bytes, { headers: { 'Content-Type': source.includes( 'timecode.mp4' ) ? 'video/mp4' : 'model/gltf-binary', 'Content-Length': String( bytes.length ) } } );

}

describe( 'explicit local development student demo', () => {

	it( 'copies existing edits into an independent admin-appearance study without overwriting the original project', async () => {

		const { document } = await createStudentDemoProject( { fetch: bundledFetch } );
		document.shots.wide.snapshot.camera.transform.position[ 0 ] = 15;
		document.clips[ 0 ].durationFrames = 155;
		const original = structuredClone( document ), updated = copyDemoWithAdminAppearance( document );
		expect( validateStudentProjectDocument( updated ) ).toBe( true );
		expect( updated.projectId ).not.toBe( original.projectId );
		expect( updated.clips ).toEqual( original.clips );
		expect( updated.shots.wide.snapshot.camera.transform ).toEqual( original.shots.wide.snapshot.camera.transform );
		expect( updated.shots.wide.snapshot.nodes ).toEqual( original.shots.wide.snapshot.nodes );
		expect( updated.shots.wide.snapshot.materials[ 'suv-instance-0' ][ 0 ].state.values.normalScale ).toEqual( [ 1, - 1 ] );
		expect( updated.shots.wide.snapshot.lights.map( light => light.type ) ).toEqual( [ 'directional', 'spot' ] );
		expect( updated.shots.wide.snapshot.environment.asset.assetId ).toBe( 'local-admin-aristea' );
		expect( document ).toEqual( original );

	} );

	it( 'creates detached valid editable shots with real stable media identity', async () => {

		const { document, catalogue } = await createStudentDemoProject( { fetch: bundledFetch } );
		expect( validateStudentProjectDocument( document ) ).toBe( true );
		expect( document.clips.map( clip => clip.durationFrames ) ).toEqual( [ 125, 125 ] );
		expect( document.shots.wide.sourcePreset ).toBeNull();
		expect( document.shots.close.snapshot.nodes[ 'mannequin-root' ].humanPose ).toBe( 'sitting' );
		expect( document.shots.wide.snapshot.nodes[ 'mannequin-root' ].humanPose ).toBe( 'standing' );
		expect( document.shots.close.snapshot.ledWalls[ 0 ].mode ).toBe( 'play' );
		expect( document.shots.close.snapshot.camera.transform.position ).toEqual( [ - 5, 2.6, 6.5 ] );
		document.shots.wide.snapshot.nodes[ 'mannequin-root' ].transform.position[ 0 ] = 123;
		expect( prepared.snapshot.nodes[ 'mannequin-root' ].transform.position[ 0 ] ).toBe( 2.7 );
		const scene = await catalogue.getScene( document.shots.wide.baseScene );
		scene.sceneDefinition.humanPoseRoots.length = 0;
		expect( ( await catalogue.getScene( document.shots.wide.baseScene ) ).sceneDefinition.humanPoseRoots ).toEqual( [ 'mannequin-root' ] );

	} );

	it( 'reopens saved local scene metadata and verifies all real model bytes and mappings', async () => {

		const catalogue = createStudentDemoCatalogue( { fetch: bundledFetch } );
		const { sceneDefinition } = await catalogue.getScene( prepared.baseScene );
		for ( const model of sceneDefinition.models ) {

			const bytes = await catalogue.getAssetBytes( prepared.assets[ `${model.asset.assetId}@${model.asset.version}` ] );
			expect( () => validatePresetModelBytes( prepared, model, bytes ) ).not.toThrow();

		}

	} );

	it( 'recognizes only the exact pinned local scene', async () => {

		const fetch = vi.fn();
		const catalogue = createStudentDemoCatalogue( { fetch } );
		expect( isStudentDemoScene( prepared.baseScene ) ).toBe( true );
		for ( const reference of [ undefined, {}, { ...prepared.baseScene, sceneId: `${prepared.baseScene.sceneId}-other` }, { ...prepared.baseScene, version: 'fixture-2' } ] ) {

			expect( isStudentDemoScene( reference ) ).toBe( false );
			await expect( catalogue.getScene( reference ) ).rejects.toThrow( 'not the bundled' );

		}

		expect( fetch ).not.toHaveBeenCalled();

	} );

	it( 'rejects altered immutable asset metadata before requesting files', async () => {

		const fetch = vi.fn();
		const catalogue = createStudentDemoCatalogue( { fetch } );
		await expect( catalogue.getAssetBytes( { ...prepared.assets[ 'fixture-timecode@generated-1' ], sha256: '0'.repeat( 64 ) } ) ).rejects.toThrow( 'modified' );
		await expect( catalogue.getAssetBytes( { assetId: 'unknown', version: '1' } ) ).rejects.toThrow( 'Unknown' );
		expect( fetch ).not.toHaveBeenCalled();

	} );

	it( 'uses normal byte verification and omits credentials on local file requests', async () => {

		const fetch = vi.fn( async ( source, options ) => {

			expect( options.credentials ).toBe( 'omit' );
			expect( options.redirect ).toBe( 'error' );
			expect( options.method ).toBe( 'GET' );
			const original = await bundledFetch( source );
			const bytes = new Uint8Array( await original.arrayBuffer() );
			bytes[ 100 ] ^= 1;
			return new Response( bytes, { headers: original.headers } );

		} );
		const catalogue = createStudentDemoCatalogue( { fetch } );
		await expect( catalogue.getAssetBytes( prepared.assets[ 'fixture-timecode@generated-1' ] ) ).rejects.toMatchObject( { code: 'ASSET_MISMATCH' } );
		expect( fetch ).toHaveBeenCalledTimes( 1 );

	} );

	it( 'honors cancellation before saving or fetching any local demo', async () => {

		const fetch = vi.fn();
		const controller = new AbortController();
		controller.abort();
		await expect( createStudentDemoProject( { fetch, signal: controller.signal } ) ).rejects.toMatchObject( { name: 'AbortError' } );
		const catalogue = createStudentDemoCatalogue( { fetch } );
		await expect( catalogue.getScene( prepared.baseScene, { signal: controller.signal } ) ).rejects.toMatchObject( { code: 'CANCELLED' } );
		await expect( catalogue.getAssetBytes( prepared.assets[ 'fixture-timecode@generated-1' ], { signal: controller.signal } ) ).rejects.toMatchObject( { code: 'CANCELLED' } );
		expect( fetch ).not.toHaveBeenCalled();

	} );

} );
