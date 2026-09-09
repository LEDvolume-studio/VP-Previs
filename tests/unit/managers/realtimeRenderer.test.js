import {
	BoxGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial,
	PerspectiveCamera, PointLight, Scene, SpotLight,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeRenderer, RASTER_PROXY_KEY } from '../../../rayzee/src/managers/RealtimeRenderer.js';

function createSettings( overrides = {} ) {

	const values = {
		enableEnvironment: true,
		showBackground: true,
		transparentBackground: false,
		environmentRotation: 90,
		environmentIntensity: 1.5,
		backgroundIntensity: 0.75,
		backgroundBlurriness: 0.25,
		backgroundColor: '#112233',
		...overrides,
	};

	return {
		get: key => values[ key ],
		set: ( key, value ) => {

			values[ key ] = value;

		},
	};

}

function createHarness( settings = createSettings() ) {

	const renderer = {
		shadowMap: {},
		render: vi.fn(),
		compileAsync: vi.fn().mockResolvedValue(),
	};
	const scene = new Scene();
	const lightScene = new Scene();
	const camera = new PerspectiveCamera();
	const manager = new RealtimeRenderer( {
		renderer, scene, lightScene, camera, settings, postProcessing: false,
	} );

	return { renderer, scene, lightScene, camera, manager, settings };

}

describe( 'RealtimeRenderer', () => {

	afterEach( () => vi.unstubAllGlobals() );

	it( 'builds the real-time WebGPU effects graph', () => {

		vi.stubGlobal( 'Image', class {} );
		const renderer = {
			shadowMap: {},
			toneMapping: 0,
			outputColorSpace: '',
		};
		const manager = new RealtimeRenderer( {
			renderer,
			scene: new Scene(),
			lightScene: new Scene(),
			camera: new PerspectiveCamera(),
			settings: createSettings(),
		} );

		expect( manager.pipeline ).not.toBeNull();
		expect( manager.scenePass ).not.toBeNull();
		expect( manager.aoPass.resolutionScale ).toBe( 0.75 );
		expect( manager.ssrPass.resolutionScale ).toBe( 1 );
		expect( manager.bloomPass ).not.toBeNull();
		expect( manager.aaPass ).not.toBeNull();

		manager.dispose();
		expect( manager.pipeline ).toBeNull();

	} );

	it( 'renders the mesh scene with the active camera', () => {

		const { renderer, scene, camera, manager } = createHarness();
		manager.render();

		expect( renderer.render ).toHaveBeenCalledWith( scene, camera );

	} );

	it( 'uses display resolution in real time and restores path-tracer resolution', () => {

		const renderer = {
			shadowMap: {},
			domElement: {
				width: 512,
				height: 512,
				getBoundingClientRect: () => ( { width: 900, height: 600 } ),
			},
			setSize: vi.fn(),
		};
		const manager = new RealtimeRenderer( {
			renderer,
			scene: new Scene(),
			lightScene: new Scene(),
			camera: new PerspectiveCamera(),
			settings: createSettings(),
			postProcessing: false,
		} );

		manager.activate();
		expect( renderer.setSize ).toHaveBeenLastCalledWith( 900, 600, false );

		manager.setPathTracerSize( 1024, 768 );
		manager.deactivate();
		expect( renderer.setSize ).toHaveBeenLastCalledWith( 1024, 768, false );

	} );

	it( 'synchronizes environment lighting and background controls', () => {

		const { scene, lightScene, manager } = createHarness();
		const environment = { isTexture: true };
		lightScene.environment = environment;

		manager.syncEnvironment();

		expect( scene.environment ).toBe( environment );
		expect( scene.background ).toBe( environment );
		expect( scene.environmentIntensity ).toBe( 1.5 );
		expect( scene.backgroundIntensity ).toBe( 0.75 );
		expect( scene.backgroundBlurriness ).toBe( 0.25 );
		expect( scene.environmentRotation.y ).toBeCloseTo( Math.PI / 2 );

	} );

	it( 'keeps the environment available as a backdrop when lighting is disabled', () => {

		const settings = createSettings( { enableEnvironment: false } );
		const { scene, lightScene, manager } = createHarness( settings );
		const environment = { isTexture: true };
		lightScene.environment = environment;

		manager.syncEnvironment();

		expect( scene.environment ).toBeNull();
		expect( scene.background ).toBe( environment );

	} );

	it( 'mirrors path-tracer power into native raster light units', () => {

		const { scene, lightScene, manager } = createHarness();
		const source = new PointLight( 0xffffff, 4 * Math.PI * 100 );
		lightScene.add( source );

		manager.syncLights();

		const proxy = scene.getObjectsByProperty( 'isLight', true )[ 0 ];
		expect( proxy.userData[ RASTER_PROXY_KEY ] ).toBe( source.uuid );
		expect( proxy.intensity ).toBeCloseTo( 100 );
		expect( proxy.castShadow ).toBe( true );

	} );

	it( 'isolates imported source lights so converted proxies do not double-light', () => {

		const { scene, lightScene, manager } = createHarness();
		const imported = new PointLight( 0xffffff, 100 );
		const canonical = imported.clone();
		scene.add( imported );
		lightScene.add( canonical );
		const originalMask = imported.layers.mask;

		manager.syncLights();

		expect( imported.layers.mask ).toBe( 2 ** 31 );
		expect( scene.getObjectsByProperty( 'isLight', true ) ).toHaveLength( 2 );

		manager.dispose();
		expect( imported.layers.mask ).toBe( originalMask );

	} );

	it( 'limits expensive raster shadows to four prioritized lights', () => {

		const { lightScene, manager } = createHarness();
		const points = Array.from( { length: 5 }, ( _, index ) => new PointLight( 0xffffff, index + 1 ) );
		points.forEach( light => lightScene.add( light ) );
		const sun = new DirectionalLight( 0xffffff, 0.1 );
		lightScene.add( sun );

		manager.syncLights();

		const shadowLights = manager.lightProxies.filter( light => light.isLight && light.castShadow );
		expect( shadowLights ).toHaveLength( 4 );
		expect( shadowLights.some( light => light.isDirectionalLight ) ).toBe( true );

	} );

	it( 'enables mesh shadows and restores authored flags on dispose', () => {

		const { scene, lightScene, manager } = createHarness();
		const mesh = new Mesh( new BoxGeometry(), new MeshStandardMaterial() );
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		scene.add( mesh );
		lightScene.add( new SpotLight() );

		manager.syncLights();
		expect( mesh.castShadow ).toBe( true );
		expect( mesh.receiveShadow ).toBe( true );

		manager.dispose();
		expect( mesh.castShadow ).toBe( false );
		expect( mesh.receiveShadow ).toBe( false );

	} );

	it( 'honors a solid background independently of environment reflections', () => {

		const settings = createSettings( { showBackground: false } );
		const { scene, lightScene, manager } = createHarness( settings );
		lightScene.environment = { isTexture: true };

		manager.syncEnvironment();

		expect( scene.environment ).toBe( lightScene.environment );
		expect( scene.background ).toBeInstanceOf( Color );
		expect( scene.background.getHexString() ).toBe( '112233' );

	} );

} );
