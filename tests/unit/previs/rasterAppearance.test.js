import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene, SRGBColorSpace } from 'three';
import { RenderSettings } from '../../../rayzee/src/RenderSettings.js';
import { RealtimeRenderer } from '../../../rayzee/src/managers/RealtimeRenderer.js';
import { applyRasterAppearance, captureRasterAppearance, classifyRasterRenderSetting, createRasterAppearancePort, validateRasterAppearance } from '../../../app/src/previs/engine/RasterAppearance.js';

// Only the SMAA lookup-image transport is replaced. Actual Three.js post nodes,
// actual RealtimeRenderer and actual RenderSettings are used without a GPU.
function host() {

	vi.stubGlobal( 'Image', class {} );
	const settings = new RenderSettings();
	const renderer = { toneMapping: 4, toneMappingExposure: 1, outputColorSpace: SRGBColorSpace, shadowMap: {}, domElement: { width: 100, height: 100 } };
	settings.bind( { renderer, stages: {}, resetCallback: vi.fn() } );
	const scene = new Scene();
	const lightScene = new Scene();
	lightScene.environment = { isTexture: true, name: 'verified HDRI texture' };
	const realtimeRenderer = new RealtimeRenderer( { settings, renderer, scene, lightScene, camera: new PerspectiveCamera() } );
	return { settings, renderer, realtimeRenderer, scene, lightScene };

}

afterEach( () => vi.unstubAllGlobals() );

describe( 'portable existing-admin raster appearance', () => {

	it( 'captures complete plain immutable output and uses the same native post nodes', () => {

		const view = host();
		const appearance = captureRasterAppearance( view );
		expect( validateRasterAppearance( appearance ) ).toBe( true );
		expect( appearance ).toEqual( {
			version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb',
			enableEnvironment: true, showBackground: true, transparentBackground: false,
			backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#000000',
		} );
		expect( view.realtimeRenderer.aaPass.constructor.name ).toBe( 'SMAANode' );
		appearance.backgroundColor = '#ff0000';
		expect( view.settings.get( 'backgroundColor' ) ).toBe( '#000000' );

	} );

	it( 'applies real environment/background controls and restores them without changing camera exposure or grade', () => {

		const view = host();
		view.settings.setMany( { exposure: 0.22, saturation: 1.2, environmentIntensity: 3, environmentRotation: 90 }, { silent: true } );
		const events = vi.fn();
		view.settings.addEventListener( 'engine:settingChanged', events );
		const port = createRasterAppearancePort( view );
		const saved = port.capture();
		const next = { ...saved, toneMapping: 6, enableEnvironment: false, showBackground: false, backgroundIntensity: 0.4, backgroundBlurriness: 0.25, backgroundColor: '#336699' };
		port.validate( next );
		port.apply( next );
		expect( port.read() ).toEqual( next );
		expect( view.scene.environment ).toBeNull();
		expect( view.scene.environmentIntensity ).toBe( 3 );
		expect( view.scene.background.getHexString() ).toBe( '336699' );
		expect( view.scene.environmentRotation.y ).toBeCloseTo( Math.PI / 2 );
		expect( view.scene.backgroundRotation.y ).toBeCloseTo( Math.PI / 2 );
		expect( view.scene.backgroundIntensity ).toBe( 0.4 );
		expect( view.scene.backgroundBlurriness ).toBe( 0.25 );
		expect( view.settings.get( 'saturation' ) ).toBe( 1.2 );
		expect( view.renderer.toneMappingExposure ).toBe( 0.22 );
		expect( events ).not.toHaveBeenCalled();
		port.restore( saved );
		expect( port.read() ).toEqual( saved );
		expect( view.scene.environment ).toBe( view.lightScene.environment );
		expect( view.scene.background ).toBe( view.lightScene.environment );

	} );

	it.each( [
		[ 'unknown field', value => {

			value.customGrade = true;

		} ],
		[ 'missing field', value => {

			delete value.backgroundColor;

		} ],
		[ 'custom tone mapper', value => {

			value.toneMapping = 5;

		} ],
		[ 'unknown tone mapper', value => {

			value.toneMapping = 100;

		} ],
		[ 'linear output', value => {

			value.outputColorSpace = 'srgb-linear';

		} ],
		[ 'negative intensity', value => {

			value.backgroundIntensity = - 1;

		} ],
		[ 'infinite intensity', value => {

			value.backgroundIntensity = Infinity;

		} ],
		[ 'blur beyond range', value => {

			value.backgroundBlurriness = 1.01;

		} ],
		[ 'unversioned stack', value => {

			value.postProcessing = 'raw';

		} ],
		[ 'nonboolean background', value => {

			value.showBackground = 1;

		} ],
		[ 'URL colour', value => {

			value.backgroundColor = 'https://example.com';

		} ],
	] )( 'rejects %s before mutating the renderer', ( _name, mutate ) => {

		const view = host();
		const saved = captureRasterAppearance( view );
		const next = structuredClone( saved );
		mutate( next );
		expect( () => applyRasterAppearance( next, view ) ).toThrow( 'Raster appearance' );
		expect( captureRasterAppearance( view ) ).toEqual( saved );

	} );

	it.each( [
		[ 'raw viewport', view => {

			view.realtimeRenderer.pipeline = null;

		} ],
		[ 'modified bloom', view => {

			view.realtimeRenderer.bloomPass.strength.value = 1;

		} ],
		[ 'missing SMAA output', view => {

			view.realtimeRenderer.pipeline.outputNode = view.realtimeRenderer.bloomPass;

		} ],
		[ 'automatic exposure', view => {

			view.settings.set( 'autoExposure', true );

		} ],
		[ 'ground projection', view => {

			view.settings.set( 'groundProjectionEnabled', true );

		} ],
		[ 'ground catcher', view => {

			view.settings.set( 'enableGroundCatcher', true );

		} ],
	] )( 'refuses unsupported %s without claiming existing stack equivalence', ( _name, mutate ) => {

		const view = host();
		mutate( view );
		expect( () => captureRasterAppearance( view ) ).toThrow( 'Raster appearance' );

	} );

	it( 'restores owned real settings and renderer after downstream environment synchronisation fails', () => {

		const view = host();
		const saved = captureRasterAppearance( view );
		const sync = view.realtimeRenderer.syncEnvironment.bind( view.realtimeRenderer );
		vi.spyOn( view.realtimeRenderer, 'syncEnvironment' ).mockImplementationOnce( () => {

			throw new Error( 'texture transition failed' );

		} ).mockImplementation( sync );
		expect( () => applyRasterAppearance( { ...saved, toneMapping: 6, backgroundColor: '#ff0000' }, view ) ).toThrow( 'texture transition failed' );
		expect( captureRasterAppearance( view ) ).toEqual( saved );
		expect( view.scene.background ).toBe( view.lightScene.environment );

	} );

	it( 'retains both errors if applying and restoring the environment fail', () => {

		const view = host();
		const saved = captureRasterAppearance( view );
		vi.spyOn( view.realtimeRenderer, 'syncEnvironment' ).mockImplementation( () => {

			throw new Error( 'device lost' );

		} );
		try {

			applyRasterAppearance( { ...saved, toneMapping: 6 }, view );
			throw new Error( 'Expected failure' );

		} catch ( error ) {

			expect( error ).toBeInstanceOf( AggregateError );
			expect( error.errors.map( item => item.message ) ).toEqual( [ 'device lost', 'device lost' ] );

		}

	} );

	it( 'classifies known compositor/path tuning explicitly while rejecting unknown enabled appearance', () => {

		expect( classifyRasterRenderSetting( 'saturation' ) ).toBe( 'path-only' );
		expect( classifyRasterRenderSetting( 'enableBloom' ) ).toBe( 'path-only' );
		expect( classifyRasterRenderSetting( 'skySunIntensity' ) ).toBe( 'inactive-hdri-input' );
		expect( classifyRasterRenderSetting( 'groundCatcherHeight' ) ).toBe( 'inactive-ground-input' );
		expect( classifyRasterRenderSetting( 'canvasWidth' ) ).toBe( 'runtime-only' );
		expect( classifyRasterRenderSetting( 'toneMapping' ) ).toBe( 'appearance' );
		for ( const key of [ 'enableNewGrade', 'maxTextureSize', 'autoExposure', 'environmentMode', 'groundProjectionEnabled' ] ) expect( classifyRasterRenderSetting( key ) ).toBeNull();

	} );

	it( 'captures real bundled welcome raster controls without adding its path-traced saturation to the image', async () => {

		const welcome = JSON.parse( await readFile( new URL( '../../../app/src/data/default-scene.json', import.meta.url ), 'utf8' ) );
		const view = host();
		view.settings.setMany( welcome.render.engine, { silent: true, reset: false } );
		view.settings.set( 'enableBloom', welcome.render.ui.enableBloom, { silent: true } );
		view.renderer.toneMapping = welcome.render.ui.toneMapping;
		const value = captureRasterAppearance( view );
		expect( value ).toEqual( {
			version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb',
			enableEnvironment: true, showBackground: true, transparentBackground: false,
			backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#000000',
		} );
		expect( view.settings.get( 'saturation' ) ).toBe( 1.2 );
		expect( view.renderer.toneMappingExposure ).toBe( 0.22 );
		expect( Object.hasOwn( value, 'saturation' ) ).toBe( false );
		view.realtimeRenderer.syncEnvironment();
		expect( view.scene.environmentRotation.y ).toBeCloseTo( 3 * Math.PI / 2 );
		expect( view.realtimeRenderer.bloomPass.strength.value ).toBe( 0.3 );
		expect( view.settings.get( 'enableBloom' ) ).toBe( false );

	} );

} );
