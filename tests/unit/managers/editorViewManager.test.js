import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, Scene, Vector3 } from 'three';
import { EDITOR_COORDINATE_SYSTEM, EditorViewManager } from '../../../rayzee/src/managers/EditorViewManager.js';

class TestCanvas extends EventTarget {

	constructor( width = 1000, height = 500 ) {

		super();
		this.clientWidth = width;
		this.clientHeight = height;
		this.style = {};
		this.ownerDocument = new EventTarget();

	}

	getRootNode() {

		return this.ownerDocument;

	}

	getBoundingClientRect() {

		return { width: this.clientWidth, height: this.clientHeight };

	}

}

const managers = [];

const createManager = () => {

	const bounds = new Box3( new Vector3( - 10, - 5, - 2 ), new Vector3( 10, 5, 8 ) );
	const realtimeRenderer = { renderEditor: vi.fn(), activate: vi.fn(), deactivate: vi.fn() };
	const manager = new EditorViewManager( {
		canvas: new TestCanvas(),
		realtimeRenderer,
		scene: new Scene(),
		getBounds: () => bounds,
		onChange: vi.fn(),
		onInvalidate: vi.fn(),
	} );
	managers.push( manager );
	return { manager, realtimeRenderer, bounds };

};

afterEach( () => {

	for ( const manager of managers.splice( 0 ) ) manager.dispose();

} );

describe( 'EditorViewManager', () => {

	it( 'persists the grid toggle across orthographic views and resets legacy projects to on', () => {

		const { manager } = createManager();
		manager.setMode( 'top' );
		manager.setGridVisible( false );
		expect( manager._gridHelpers.every( helper => ! helper.visible ) ).toBe( true );
		manager.setMode( 'front' );
		manager.camera.zoom = 4;
		manager.update();
		expect( manager._gridHelpers.every( helper => ! helper.visible ) ).toBe( true );
		const saved = JSON.parse( JSON.stringify( manager.getProjectState() ) );
		manager.setGridVisible( true );
		manager.restoreProjectState( saved );
		expect( manager.gridVisible ).toBe( false );
		expect( manager._gridHelpers.every( helper => ! helper.visible ) ).toBe( true );
		manager.restoreProjectState( { mode: 'side' } );
		expect( manager.gridVisible ).toBe( true );
		expect( manager._gridHelpers.every( helper => helper.visible ) ).toBe( true );

	} );

	it( 'labels Y-up views by their camera axis and keeps front upright', () => {

		const { manager, bounds } = createManager();
		const center = bounds.getCenter( new Vector3() );
		const screenDirection = axis => new Vector3().copy( center ).add( axis ).project( manager.camera )
			.sub( center.clone().project( manager.camera ) );

		manager.setMode( 'top' );
		expect( manager.camera.position.y ).toBeGreaterThan( center.y );
		expect( screenDirection( new Vector3( 1, 0, 0 ) ).x ).toBeGreaterThan( 0 );
		expect( screenDirection( new Vector3( 0, 0, 1 ) ).y ).toBeLessThan( 0 );

		manager.setMode( 'front' );
		expect( manager.camera.position.z ).toBeGreaterThan( center.z );
		expect( screenDirection( new Vector3( 0, 1, 0 ) ).y ).toBeGreaterThan( 0 );
		expect( screenDirection( new Vector3( 1, 0, 0 ) ).x ).toBeGreaterThan( 0 );

		manager.setMode( 'side' );
		expect( manager.camera.position.x ).toBeGreaterThan( center.x );
		expect( screenDirection( new Vector3( 0, 1, 0 ) ).y ).toBeGreaterThan( 0 );
		expect( screenDirection( new Vector3( 0, 0, 1 ) ).x ).toBeLessThan( 0 );

	} );

	it( 'uses the default RGB gizmo colors for X, Y up, and Z forward', () => {

		const { manager } = createManager();
		manager.setMode( 'front' );
		const axes = manager._gridHelpers[ 2 ];
		const colors = axes.geometry.getAttribute( 'color' );
		expect( [ colors.getX( 0 ), colors.getY( 0 ), colors.getZ( 0 ) ] ).toEqual( [ 1, 0, 0 ] );
		expect( [ colors.getX( 2 ), colors.getY( 2 ), colors.getZ( 2 ) ] ).toEqual( [ 0, 1, 0 ] );
		expect( [ colors.getX( 4 ), colors.getY( 4 ), colors.getZ( 4 ) ] ).toEqual( [ 0, 0, 1 ] );

	} );

	it( 'retains independent pan and zoom state for each view', () => {

		const { manager } = createManager();
		manager.setMode( 'top' );
		manager.activeControls.target.set( 3, 4, 5 );
		manager.camera.zoom = 7;
		manager.setMode( 'front' );
		manager.activeControls.target.set( - 2, 1, 6 );
		manager.camera.zoom = 2;

		manager.setMode( 'top' );
		expect( manager.activeControls.target.toArray() ).toEqual( [ 3, 4, 5 ] );
		expect( manager.camera.zoom ).toBe( 7 );

		manager.setMode( 'front' );
		expect( manager.activeControls.target.toArray() ).toEqual( [ - 2, 1, 6 ] );
		expect( manager.camera.zoom ).toBe( 2 );

	} );

	it( 'renders through the raster editor path and switches material style', () => {

		const { manager, realtimeRenderer } = createManager();
		manager.setMode( 'side' );
		manager.render();
		const solidMaterial = realtimeRenderer.renderEditor.mock.calls.at( - 1 )[ 0 ].overrideMaterial;
		expect( solidMaterial.wireframe ).toBe( false );

		manager.setStyle( 'wireframe' );
		manager.render();
		const wireMaterial = realtimeRenderer.renderEditor.mock.calls.at( - 1 )[ 0 ].overrideMaterial;
		expect( wireMaterial.wireframe ).toBe( true );
		expect( realtimeRenderer.renderEditor ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'clears view positions and style when switching to a project without saved views', () => {

		const { manager, bounds } = createManager();
		manager.setMode( 'top' );
		manager.activeControls.target.set( 100, 200, 300 );
		manager.camera.zoom = 7;
		manager.setStyle( 'wireframe' );
		manager.setMode( 'front' );

		manager.restoreProjectState( null );
		expect( manager.mode ).toBe( 'perspective' );
		expect( manager.style ).toBe( 'solid' );
		expect( manager.getProjectState().views ).toEqual( {} );

		manager.setMode( 'top' );
		expect( manager.activeControls.target.toArray() ).toEqual( bounds.getCenter( new Vector3() ).toArray() );
		expect( manager.camera.zoom ).toBe( 1 );

	} );

	it( 'reframes old Z-up camera poses but preserves Y-up poses', () => {

		const { manager, bounds } = createManager();
		const oldPose = { target: [ 10, 20, 30 ], position: [ 10, 20, 40 ], zoom: 7, halfHeight: 5, near: 0.1, far: 100 };
		manager.restoreProjectState( { mode: 'top', style: 'wireframe', coordinateSystem: 'unreal-z-up-v1', views: { top: oldPose } } );
		expect( manager.activeControls.target.toArray() ).toEqual( bounds.getCenter( new Vector3() ).toArray() );
		expect( manager.style ).toBe( 'wireframe' );

		manager.restoreProjectState( { mode: 'top', style: 'solid', coordinateSystem: EDITOR_COORDINATE_SYSTEM, views: { top: oldPose } } );
		manager.activeControls.target.toArray().forEach( ( value, index ) => expect( value ).toBeCloseTo( oldPose.target[ index ] ) );
		expect( manager.camera.zoom ).toBe( 7 );

	} );

} );
