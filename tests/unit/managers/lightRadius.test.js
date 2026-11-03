import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { Scene } from 'three';
import { LightManager } from '@/core/managers/LightManager.js';
import { PathTracer } from '@/core/Stages/PathTracer.js';
import { setApp } from '@/lib/appProxy.js';

const helpers = () => ( { clear: vi.fn(), visible: false } );

// Import stores with the same minimal browser storage available to project tests.
vi.stubGlobal( 'window', { dispatchEvent: vi.fn() } );
vi.stubGlobal( 'localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } );
const { useLightStore } = await import( '@/store.js' );
afterEach( () => setApp( null ) );
afterAll( () => vi.unstubAllGlobals() );

describe( 'point/spot light radius in the VP workflow', () => {

	it.each( [ 'PointLight', 'SpotLight' ] )( 'round-trips %s radius through save/restore and light edits', type => {

		const scene = new Scene();
		const lm = new LightManager( scene, helpers(), { updateLights: vi.fn() } );
		const descriptor = lm.addLight( type );
		const light = scene.getObjectByProperty( 'uuid', descriptor.uuid );
		setApp( { isInitialized: true, scene, lightManager: lm, reset: vi.fn() } );
		useLightStore.setState( { lights: [ descriptor ] } );
		useLightStore.getState().updateLight( 0, 'radius', [ 0.75 ] );
		expect( light.userData.radius ).toBe( 0.75 );
		expect( useLightStore.getState().lights[ 0 ].radius ).toBe( 0.75 );
		const saved = JSON.parse( JSON.stringify( lm.getProjectState() ) );
		const restored = lm.replaceProjectState( saved );
		expect( restored[ 0 ].radius ).toBe( 0.75 );
		delete saved[ 0 ].radius;
		expect( lm.replaceProjectState( saved )[ 0 ].radius ).toBe( 0 );

	} );

	it( 'compiles disc sampling only while a point or spot light needs it', () => {

		const pt = {
			numPointLights: { value: 2 }, numSpotLights: { value: 1 },
			pointLightsBufferNode: { array: new Float32Array( 20 ) },
			spotLightsBufferNode: { array: new Float32Array( 20 ) },
		};
		expect( PathTracer.prototype._lightRadiusNeeded.call( pt ) ).toBe( false );
		pt.pointLightsBufferNode.array[ 19 ] = 1;
		expect( PathTracer.prototype._lightRadiusNeeded.call( pt ) ).toBe( true );
		pt.pointLightsBufferNode.array[ 19 ] = 0;
		pt.spotLightsBufferNode.array[ 18 ] = 0.5;
		expect( PathTracer.prototype._lightRadiusNeeded.call( pt ) ).toBe( true );

	} );

} );
