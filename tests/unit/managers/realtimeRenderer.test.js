import {
	BoxGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial,
	PerspectiveCamera, PointLight, Scene, SpotLight, Group, Texture, RectAreaLight, HemisphereLight, AmbientLight, Vector3,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RectAreaLightNode } from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
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

function createHarness( settings = createSettings(), options = {} ) {

	const renderer = {
		shadowMap: {},
		render: vi.fn(),
		compileAsync: vi.fn().mockResolvedValue(),
	};
	const scene = new Scene();
	const lightScene = new Scene();
	const camera = new PerspectiveCamera();
	const manager = new RealtimeRenderer( {
		renderer, scene, lightScene, camera, settings, postProcessing: false, ...options,
	} );

	return { renderer, scene, lightScene, camera, manager, settings };

}

describe( 'RealtimeRenderer', () => {

	afterEach( () => vi.unstubAllGlobals() );

	it( 'provides actual native area-light shader textures without an admin app bootstrap and reuses them across viewports', () => {

		const first = createHarness();
		const light = new RectAreaLight( '#ffffff', 20, 2, 3 );
		first.lightScene.add( light );
		first.manager.syncLights();
		const proxy = first.manager.lightProxies.find( object => object.isRectAreaLight );
		const node = new RectAreaLightNode( proxy );
		const textures = [ RectAreaLightTexturesLib.LTC_FLOAT_1, RectAreaLightTexturesLib.LTC_FLOAT_2, RectAreaLightTexturesLib.LTC_HALF_1, RectAreaLightTexturesLib.LTC_HALF_2 ];
		for ( const float32Filterable of [ true, false ] ) {

			// Exercise Three's actual capability-dependent shader input selection;
			// without setLTC registration this throws before shader compilation.
			const inputs = node.setupDirectRectArea( { isAvailable: capability => capability === 'float32Filterable' && float32Filterable } );
			expect( inputs.ltc_1.value ).toBe( textures[ float32Filterable ? 0 : 2 ] );
			expect( inputs.ltc_2.value ).toBe( textures[ float32Filterable ? 1 : 3 ] );
			for ( const texture of [ inputs.ltc_1.value, inputs.ltc_2.value ] ) {

				expect( texture.isDataTexture ).toBe( true );
				expect( texture.image.width ).toBe( 64 );
				expect( texture.image.height ).toBe( 64 );
				expect( texture.image.data ).toHaveLength( 64 * 64 * 4 );

			}

		}

		first.manager.dispose();
		const second = createHarness();
		expect( [ RectAreaLightTexturesLib.LTC_FLOAT_1, RectAreaLightTexturesLib.LTC_FLOAT_2, RectAreaLightTexturesLib.LTC_HALF_1, RectAreaLightTexturesLib.LTC_HALF_2 ] ).toEqual( textures );
		textures.forEach( texture => expect( texture.version ).toBe( 1 ) );
		second.manager.dispose();

	} );

	it( 'explicitly replaces HDRI → none → the same HDRI without reviving a cached map', () => {

		const { scene, lightScene, manager } = createHarness();
		const environment = new Texture();
		manager.setEnvironment( environment );
		expect( lightScene.environment ).toBe( environment );
		expect( scene.environment ).toBe( environment );
		expect( scene.background ).toBe( environment );
		manager.setEnvironment( null );
		for ( let index = 0; index < 3; index ++ ) manager.syncEnvironment();
		expect( lightScene.environment ).toBeNull();
		expect( scene.environment ).toBeNull();
		expect( scene.background ).toBeNull();
		manager.setEnvironment( environment );
		expect( lightScene.environment ).toBe( environment );
		expect( scene.environment ).toBe( environment );
		expect( scene.background ).toBe( environment );

	} );

	it( 'retains an explicitly replaced background map with lighting disabled and refuses invalid replacements before mutation', () => {

		const { scene, lightScene, manager } = createHarness( createSettings( { enableEnvironment: false } ) );
		const first = new Texture();
		const second = new Texture();
		manager.setEnvironment( first );
		manager.setEnvironment( second );
		expect( scene.environment ).toBeNull();
		expect( scene.background ).toBe( second );
		expect( lightScene.environment ).toBe( second );
		expect( () => manager.setEnvironment( { name: 'unprepared-hdri' } ) ).toThrow( /texture or null/ );
		expect( scene.environment ).toBeNull();
		expect( scene.background ).toBe( second );
		manager.setEnvironment( null );
		manager.syncEnvironment();
		expect( scene.environment ).toBeNull();
		expect( scene.background ).toBeNull();

	} );

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
		expect( manager.aoPass.resolutionScale ).toBe( 1 );
		expect( manager.ssrPass.resolutionScale ).toBe( 1 );
		expect( manager.aoDenoise ).not.toBeNull();
		expect( manager.bloomPass ).not.toBeNull();
		expect( manager.aaPass ).not.toBeNull();

		manager.dispose();
		expect( manager.pipeline ).toBeNull();

	} );

	it( 'fits effects and shadows to visible geometry, excluding hidden parent groups', () => {

		const { scene, lightScene, manager } = createHarness();
		const studio = new Mesh( new BoxGeometry( 17, 9, 14 ), new MeshStandardMaterial() );
		studio.position.set( 2, 4.5, - 3 );
		const hidden = new Group();
		hidden.visible = false;
		hidden.add( new Mesh( new BoxGeometry( 200, 1, 200 ), new MeshStandardMaterial() ) );
		scene.add( studio, hidden );
		lightScene.add( new DirectionalLight() );
		manager.aoPass = { radius: { value: 0 }, thickness: { value: 0 } };
		manager.ssrPass = { maxDistance: { value: 0 }, thickness: { value: 0 } };
		manager.syncLights();
		expect( manager._getVisibleBounds().getSize( studio.position.clone() ).toArray() ).toEqual( [ 17, 9, 14 ] );
		expect( manager.aoPass.radius.value ).toBeCloseTo( 0.255 );
		expect( manager.aoPass.thickness.value ).toBeCloseTo( 0.1275 );
		expect( manager.ssrPass.maxDistance.value ).toBe( 8.5 );
		expect( manager.lightProxies[ 0 ].shadow.camera.right ).toBeCloseTo( 17 * 0.9 );
		manager._fitScreenSpaceEffects( manager._getVisibleBounds().expandByScalar( 1000 ) );
		expect( manager.aoPass.radius.value ).toBe( 0.3 );

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

	it( 'repairs a changed drawing buffer even when the display-size cache is unchanged', () => {

		const { renderer, manager } = createHarness();
		renderer.domElement = { width: 512, height: 512, getBoundingClientRect: () => ( { width: 900, height: 600 } ) };
		renderer.setSize = vi.fn( ( width, height ) => Object.assign( renderer.domElement, { width, height } ) );
		renderer.setPixelRatio = vi.fn();
		renderer.getDrawingBufferSize = vector => vector.set( 900, 600 );
		manager.activate();
		renderer.setSize.mockClear();
		manager.render();
		expect( renderer.setSize ).not.toHaveBeenCalled();
		// Simulate another canvas owner/browser restoration overwriting the buffer.
		renderer.domElement.width = 600;
		manager.render();
		expect( renderer.setSize ).toHaveBeenLastCalledWith( 900, 600, false );
		expect( renderer.setPixelRatio ).toHaveBeenLastCalledWith( 1 );
		expect( manager.getPathTracerSize() ).toEqual( { width: 1, height: 1 } );

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

	it( 'keeps opt-in light and shadow slots stable while hidden lights contribute no illumination', () => {

		const { lightScene, manager } = createHarness( createSettings(), { stableLightInventory: true } );
		const sources = Array.from( { length: 6 }, ( _, index ) => new PointLight( 0xffffff, index + 1 ) );
		lightScene.add( ...sources ); manager.syncLights();
		const proxies = manager.lightProxies.filter( light => light.isLight );
		const shadows = proxies.map( light => light.castShadow );
		for ( const source of sources ) {

			source.visible = false; source.intensity = 1000;

		}

		manager.syncLights();
		expect( manager.lightProxies.filter( light => light.isLight ) ).toEqual( proxies );
		expect( proxies.every( light => light.visible && light.intensity === 0 ) ).toBe( true );
		expect( proxies.map( light => light.castShadow ) ).toEqual( shadows );
		sources[ 0 ].visible = true; manager.syncLights();
		expect( proxies[ 0 ].intensity ).toBeGreaterThan( 0 );
		expect( proxies.map( light => light.castShadow ) ).toEqual( shadows );
		expect( sources[ 1 ].visible ).toBe( false );
		expect( sources[ 1 ].intensity ).toBe( 1000 );

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

	it( 'keeps raster light, shadow, shadow camera and target identities through repeated edits and precompile', async () => {

		const { scene, lightScene, manager } = createHarness();
		const point = new PointLight( '#ffffff', 4 * Math.PI * 100 );
		const spot = new SpotLight( '#ffffff', 4 * Math.PI * 200 );
		lightScene.add( point, spot );
		manager.syncLights();
		const proxies = manager.lightProxies.filter( object => object.isLight );
		const identities = proxies.map( light => ( { light, uuid: light.uuid, shadow: light.shadow, camera: light.shadow.camera, target: light.target } ) );
		const disposed = proxies.map( light => vi.spyOn( light, 'dispose' ) );
		for ( let index = 0; index < 20; index ++ ) {

			point.position.set( index, 2, - index );
			point.intensity = 4 * Math.PI * ( 100 + index );
			spot.target.position.set( index, 0, - 1 );
			await manager.precompile();

		}

		for ( const identity of identities ) {

			expect( manager.lightProxies ).toContain( identity.light );
			expect( identity.light.uuid ).toBe( identity.uuid );
			expect( identity.light.shadow ).toBe( identity.shadow );
			expect( identity.light.shadow.camera ).toBe( identity.camera );
			expect( identity.light.target ).toBe( identity.target );

		}

		expect( proxies[ 0 ].position.toArray() ).toEqual( [ 19, 2, - 19 ] );
		expect( proxies[ 0 ].intensity ).toBeCloseTo( 119 );
		expect( proxies[ 1 ].target.position.toArray() ).toEqual( [ 19, 0, - 1 ] );
		expect( scene.getObjectsByProperty( 'isLight', true ) ).toHaveLength( 2 );
		for ( const dispose of disposed ) expect( dispose ).not.toHaveBeenCalled();
		manager.dispose();
		for ( const dispose of disposed ) expect( dispose ).toHaveBeenCalledTimes( 1 );

	} );

	it( 'refreshes point and spot fields, world transforms, temperature and exposure without changing canonical state', () => {

		const { lightScene, manager } = createHarness();
		const parent = new Group();
		parent.position.set( 3, 4, 5 );
		parent.rotation.y = Math.PI / 2;
		const source = new SpotLight( '#88ccff', 4 * Math.PI * 100, 15, 0.3, 0.1, 2 );
		source.position.set( 1, 2, 3 );
		parent.add( source, source.target );
		lightScene.add( parent );
		manager.syncLights();
		const proxy = manager.lightProxies.find( light => light.isLight );
		const target = proxy.target;
		source.color.set( '#ffcc88' );
		source.intensity = 4 * Math.PI * 60;
		source.distance = 45;
		source.decay = 1.5;
		source.angle = 0.6;
		source.penumbra = 0.4;
		source.map = new Texture();
		source.userData = { exposure: 2, useTemperature: true, temperature: 2800 };
		source.target.position.set( 0, 1, - 2 );
		source.shadow.intensity = 0.7;
		source.shadow.blurSamples = 12;
		source.shadow.focus = 0.8;
		source.shadow.aspect = 1.2;
		const sourceColor = source.color.clone();
		manager.syncLights();
		expect( manager.lightProxies.find( light => light.isLight ) ).toBe( proxy );
		expect( proxy.target ).toBe( target );
		expect( proxy.position.toArray() ).toEqual( source.getWorldPosition( new Vector3() ).toArray() );
		expect( proxy.target.position.toArray() ).toEqual( source.target.getWorldPosition( new Vector3() ).toArray() );
		expect( proxy.intensity ).toBeCloseTo( 240 );
		expect( proxy.distance ).toBe( 45 );
		expect( proxy.decay ).toBe( 1.5 );
		expect( proxy.angle ).toBe( 0.6 );
		expect( proxy.penumbra ).toBe( 0.4 );
		expect( proxy.map ).toBe( source.map );
		expect( proxy.color.equals( sourceColor ) ).toBe( false );
		expect( proxy.shadow.intensity ).toBe( 0.7 );
		expect( proxy.shadow.blurSamples ).toBe( 12 );
		expect( proxy.shadow.focus ).toBe( 0.8 );
		expect( proxy.shadow.aspect ).toBe( 1.2 );
		expect( source.color.equals( sourceColor ) ).toBe( true );
		expect( source.intensity ).toBeCloseTo( 4 * Math.PI * 60 );
		expect( source.position.toArray() ).toEqual( [ 1, 2, 3 ] );
		expect( source.target.position.toArray() ).toEqual( [ 0, 1, - 2 ] );
		source.userData.useTemperature = false;
		source.visible = false;
		manager.syncLights();
		expect( proxy.color.equals( sourceColor ) ).toBe( true );
		expect( proxy.visible ).toBe( false );
		expect( proxy.castShadow ).toBe( false );

	} );

	it( 'updates normalized area dimensions without compounding scale and mirrors hemisphere/ambient changes', () => {

		const { lightScene, manager } = createHarness();
		const area = new RectAreaLight( '#ffffff', 24 * Math.PI, 2, 3 );
		const hemisphere = new HemisphereLight( '#ffffff', '#111111', 2 );
		const ambient = new AmbientLight( '#ffffff', 1 );
		area.scale.set( 2, 3, 1 );
		lightScene.add( area, hemisphere, ambient );
		manager.syncLights();
		const proxies = manager.lightProxies.filter( light => light.isLight );
		expect( proxies[ 0 ].width ).toBe( 4 );
		expect( proxies[ 0 ].height ).toBe( 9 );
		expect( proxies[ 0 ].intensity ).toBeCloseTo( 24 / 36 );
		area.width = 4;
		area.height = 5;
		area.scale.set( 3, 2, 1 );
		hemisphere.groundColor.set( '#336699' );
		hemisphere.intensity = 3;
		ambient.userData.exposure = 2;
		manager.syncLights();
		manager.syncLights();
		expect( proxies[ 0 ].width ).toBe( 12 );
		expect( proxies[ 0 ].height ).toBe( 10 );
		expect( proxies[ 0 ].scale.toArray() ).toEqual( [ 1, 1, 1 ] );
		expect( proxies[ 0 ].intensity ).toBeCloseTo( 24 / 120 );
		expect( proxies[ 1 ].groundColor.getHexString() ).toBe( '336699' );
		expect( proxies[ 1 ].intensity ).toBe( 3 );
		expect( proxies[ 2 ].intensity ).toBe( 4 );
		area.userData.normalize = false;
		manager.syncLights();
		expect( proxies[ 0 ].intensity ).toBeCloseTo( 24 );
		expect( area.width ).toBe( 4 );
		expect( area.height ).toBe( 5 );
		expect( area.scale.toArray() ).toEqual( [ 3, 2, 1 ] );

	} );

	it( 'reassigns the four shadow slots as intensity changes while keeping all proxy resources stable', () => {

		const { lightScene, manager } = createHarness();
		const sources = Array.from( { length: 5 }, ( _, index ) => new PointLight( '#ffffff', index + 1 ) );
		lightScene.add( ...sources );
		manager.syncLights();
		const proxies = manager.lightProxies.filter( light => light.isLight );
		const shadows = proxies.map( light => light.shadow );
		expect( proxies[ 0 ].castShadow ).toBe( false );
		sources[ 0 ].intensity = 100;
		manager.syncLights();
		expect( proxies[ 0 ].castShadow ).toBe( true );
		expect( proxies[ 1 ].castShadow ).toBe( false );
		expect( proxies.filter( light => light.castShadow ) ).toHaveLength( 4 );
		expect( manager.lightProxies.filter( light => light.isLight ) ).toEqual( proxies );
		expect( proxies.map( light => light.shadow ) ).toEqual( shadows );

	} );

	it( 'disposes only removed or changed-type proxies and their targets, retaining unaffected resources', () => {

		const { scene, lightScene, manager } = createHarness();
		const point = new PointLight();
		const spot = new SpotLight();
		lightScene.add( point, spot );
		manager.syncLights();
		const [ pointProxy, spotProxy ] = manager.lightProxies.filter( light => light.isLight );
		const pointDispose = vi.spyOn( pointProxy, 'dispose' );
		const spotDispose = vi.spyOn( spotProxy, 'dispose' );
		const oldTarget = spotProxy.target;
		lightScene.remove( spot );
		manager.syncLights();
		expect( spotDispose ).toHaveBeenCalledTimes( 1 );
		expect( spotProxy.parent ).toBeNull();
		expect( oldTarget.parent ).toBeNull();
		expect( pointDispose ).not.toHaveBeenCalled();
		expect( manager.lightProxies ).toEqual( [ pointProxy ] );
		const replacement = new DirectionalLight();
		replacement.uuid = point.uuid;
		lightScene.remove( point );
		lightScene.add( replacement );
		manager.syncLights();
		expect( pointDispose ).toHaveBeenCalledTimes( 1 );
		expect( manager.lightProxies[ 0 ].isDirectionalLight ).toBe( true );
		expect( scene.getObjectsByProperty( 'isLight', true ) ).toHaveLength( 1 );
		manager.dispose();
		expect( pointDispose ).toHaveBeenCalledTimes( 1 );
		expect( spotDispose ).toHaveBeenCalledTimes( 1 );
		expect( manager._lightProxyBySource.size ).toBe( 0 );
		expect( manager.lightProxies ).toHaveLength( 0 );

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
