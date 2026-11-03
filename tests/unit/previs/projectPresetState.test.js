import { describe, expect, it, vi } from 'vitest';
import { Scene, Group, Mesh, BoxGeometry, MeshStandardMaterial, DirectionalLight } from 'three';
import { captureProjectPresetState, applyProjectPresetState, adoptLegacyPresetState, restorePresetLightIntensities } from '../../../app/src/services/presets/ProjectPresetState.js';

function fixture() {

	const scene = new Scene(), root = new Group(), mesh = new Mesh( new BoxGeometry(), new MeshStandardMaterial() ), light = new DirectionalLight();
	root.userData.__rayzeeProjectInstanceId = 'car'; root.add( mesh ); scene.add( root, light );
	const source = { projectId: 'project', scene: { assets: [ { instanceId: 'car', catalogId: 'suv', assetVersion: 1 } ], nodes: { 'car:0': { position: [ 2, 3, 4 ], quaternion: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], visible: false }, 'car:0/0': { position: [ 0, 2, 0 ], quaternion: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], visible: true } }, lights: [ { type: 'DirectionalLight', intensity: 42, position: [ 5, 6, 7 ], target: [ 1, 2, 3 ], visible: false } ] } };
	const app = { meshScene: scene, transformManager: { applyObjectTransform: vi.fn() }, lightManager: { updateLights: vi.fn() }, updateAllMeshVisibility: vi.fn(), reset: vi.fn() };
	return { scene, root, mesh, light, source, app };

}

describe( 'Project-owned transform presets', () => {

	it( 'updates parent/child visibility and light positions while retaining all GPU resources', () => {

		const { app, source, root, mesh, light } = fixture();
		const geometry = mesh.geometry, material = mesh.material;
		const state = captureProjectPresetState( source, { exposure: 1 } );
		applyProjectPresetState( app, state, 'project' );
		expect( root.position.toArray() ).toEqual( [ 2, 3, 4 ] );
		expect( root.visible ).toBe( false ); expect( mesh.visible ).toBe( true );
		expect( light.position.toArray() ).toEqual( [ 5, 6, 7 ] ); expect( light.visible ).toBe( false );
		expect( light.intensity ).toBe( 42 );
		state.lights[ 0 ].intensity = 0; state.lights[ 0 ].visible = true;
		expect( mesh.geometry ).toBe( geometry ); expect( mesh.material ).toBe( material );
		expect( app.updateAllMeshVisibility ).toHaveBeenCalledOnce();
		expect( app.transformManager.applyObjectTransform ).toHaveBeenCalledWith( root );
		state.nodes[ 'car:0' ].visible = true; state.nodes[ 'car:0/0' ].visible = false;
		applyProjectPresetState( app, state, 'project' );
		expect( root.visible ).toBe( true ); expect( mesh.visible ).toBe( false );
		expect( light.intensity ).toBe( 0 ); expect( light.visible ).toBe( true );
		expect( app.transformManager.applyObjectTransform ).toHaveBeenCalledOnce();

	} );

	it( 'rejects another project or a missing object before changing the scene', () => {

		const { app, source, root } = fixture(); const state = captureProjectPresetState( source, {} );
		expect( () => applyProjectPresetState( app, state, 'house' ) ).toThrow( 'different project' );
		state.nodes[ 'missing:0' ] = state.nodes[ 'car:0' ];
		expect( () => applyProjectPresetState( app, state, 'project' ) ).toThrow( 'no longer' );
		expect( root.position.toArray() ).toEqual( [ 0, 0, 0 ] );

	} );

	it( 'adopts compatible legacy state by mapping existing assets and refuses new assets', () => {

		const { source } = fixture(); const legacy = structuredClone( source ); legacy.projectId = 'legacy';
		legacy.scene.assets[ 0 ].instanceId = 'old-car';
		legacy.scene.nodes = Object.fromEntries( Object.entries( legacy.scene.nodes ).map( ( [ key, value ] ) => [ key.replace( 'car:', 'old-car:' ), value ] ) );
		const record = { adminDocument: legacy, studentPreset: { snapshot: { camera: {} } } };
		expect( adoptLegacyPresetState( record, source ).nodes ).toHaveProperty( 'car:0' );
		legacy.scene.assets.push( { instanceId: 'house', catalogId: 'house', assetVersion: 1 } );
		expect( adoptLegacyPresetState( record, source ) ).toBeNull();

	} );

} );


it( 'recovers intensities of old presets from their saved documents and preserves explicit zero', () => {

	const { source, app, light } = fixture();
	const state = captureProjectPresetState( source, {} ); delete state.lights[ 0 ].intensity;
	const restored = restorePresetLightIntensities( state, source );
	applyProjectPresetState( app, restored, 'project' ); expect( light.intensity ).toBe( 42 );
	state.lights[ 0 ].intensity = 0;
	expect( restorePresetLightIntensities( state, source ).lights[ 0 ].intensity ).toBe( 0 );

} );


it( 'captures the plate direction independently of the selected set', () => {

	const { source } = fixture();
	source.extensions = { drivingPlate: { setId: 'location-a', view: 'left' } };
	const saved = captureProjectPresetState( source, {} );
	expect( saved.plateView ).toBe( 'left' );
	expect( saved ).not.toHaveProperty( 'plateSetId' );

} );
