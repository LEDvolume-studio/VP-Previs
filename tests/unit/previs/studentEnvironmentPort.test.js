import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene, Texture } from 'three';
import { RenderSettings } from '../../../rayzee/src/RenderSettings.js';
import { RealtimeRenderer } from '../../../rayzee/src/managers/RealtimeRenderer.js';
import { createStudentEnvironmentPort } from '../../../app/src/previs/engine/StudentEnvironmentPort.js';

function fixture() {

	const settings = new RenderSettings();
	const scene = new Scene();
	const lightScene = new Scene();
	const realtimeRenderer = new RealtimeRenderer( { settings, renderer: { shadowMap: {} }, scene, lightScene, camera: new PerspectiveCamera(), postProcessing: false } );
	const first = new Texture();
	const second = new Texture();
	const textures = new Map( [[ 'hdri@1', first ], [ 'hdri@2', second ]] );
	const initial = { asset: { assetId: 'hdri', version: '1' }, intensity: 2.5, rotation: [ 0, Math.PI / 2, 0 ], background: true };
	const port = createStudentEnvironmentPort( { textures, initial, settings, lightScene, realtimeRenderer } );
	port.apply( initial );
	return { port, textures, initial, first, second, settings, scene, lightScene, realtimeRenderer };

}

describe( 'student prepared raster environment port', () => {

	it( 'round trips exact prepared versions, Y rotation and detached captured state through real Three scenes', () => {

		const view = fixture();
		const saved = view.port.capture();
		expect( view.scene.environment ).toBe( view.first );
		expect( view.scene.background ).toBe( view.first );
		expect( view.scene.environmentRotation.y ).toBeCloseTo( Math.PI / 2 );
		expect( view.settings.get( 'environmentRotation' ) ).toBe( 90 );
		const events = vi.fn();
		view.settings.addEventListener( 'engine:settingChanged', events );
		const next = { asset: { assetId: 'hdri', version: '2' }, intensity: 0.4, rotation: [ 0, - Math.PI, 0 ], background: false };
		view.port.apply( next );
		expect( view.port.read() ).toEqual( next );
		expect( view.scene.environment ).toBe( view.second );
		expect( view.scene.background.isColor ).toBe( true );
		expect( view.scene.environmentIntensity ).toBe( 0.4 );
		expect( view.scene.environmentRotation.y ).toBeCloseTo( - Math.PI );
		expect( view.scene.backgroundRotation.y ).toBeCloseTo( - Math.PI );
		expect( events ).not.toHaveBeenCalled();
		view.port.restore( saved );
		expect( view.port.read() ).toEqual( saved );
		expect( view.scene.environment ).toBe( view.first );
		expect( view.scene.background ).toBe( view.first );
		saved.asset.version = 'changed';
		saved.rotation[ 1 ] = 100;
		expect( view.port.read() ).toEqual( view.initial );

	} );

	it( 'clears cached HDRI for a null environment then restores the same version without leaking the prior map', () => {

		const view = fixture();
		const saved = view.port.capture();
		const blank = { asset: null, intensity: 1, rotation: [ 0, 0, 0 ], background: true };
		view.port.apply( blank );
		for ( let index = 0; index < 3; index ++ ) view.realtimeRenderer.syncEnvironment();
		expect( view.lightScene.environment ).toBeNull();
		expect( view.scene.environment ).toBeNull();
		expect( view.scene.background ).toBeNull();
		expect( view.port.read() ).toEqual( blank );
		view.port.restore( saved );
		expect( view.scene.environment ).toBe( view.first );
		expect( view.scene.background ).toBe( view.first );

	} );

	it( 'keeps the prepared version map independent of caller mutations', () => {

		const view = fixture();
		view.textures.set( 'hdri@1', view.second );
		view.textures.delete( 'hdri@2' );
		view.port.apply( view.initial );
		expect( view.scene.environment ).toBe( view.first );
		view.port.apply( { ...view.initial, asset: { assetId: 'hdri', version: '2' } } );
		expect( view.scene.environment ).toBe( view.second );

	} );

	it.each( [
		[ 'X-axis rotation', value => value.rotation[ 0 ] = 0.1 ],
		[ 'Z-axis rotation', value => value.rotation[ 2 ] = 0.1 ],
		[ 'nonfinite Y rotation', value => value.rotation[ 1 ] = NaN ],
		[ 'infinite Y rotation', value => value.rotation[ 1 ] = Infinity ],
		[ 'negative intensity', value => value.intensity = - 1 ],
		[ 'invalid background switch', value => value.background = 1 ],
		[ 'unprepared version', value => value.asset.version = 'unprepared' ],
	] )( 'rejects %s before scene/settings changes', ( _, mutate ) => {

		const view = fixture();
		const value = view.port.capture();
		const beforeSettings = view.settings.getAll();
		mutate( value );
		expect( () => view.port.validate( value ) ).toThrow();
		expect( () => view.port.apply( value ) ).toThrow();
		expect( view.port.read() ).toEqual( view.initial );
		expect( view.settings.getAll() ).toEqual( beforeSettings );
		expect( view.scene.environment ).toBe( view.first );

	} );

} );
