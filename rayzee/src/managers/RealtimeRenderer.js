import {
	Box3, Color, MathUtils, Object3D, PCFShadowMap, UnsignedByteType, Vector3
} from 'three';
import { RenderPipeline } from 'three/webgpu';
import {
	emissive, metalness, mrt, normalView, output, packNormalToRGB,
	pass, roughness, sample, unpackRGBToNormal, vec2, vec3, vec4,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { blackbodyToLinearRGB } from '../Processor/blackbody.js';

const INV_4PI = 1 / ( 4 * Math.PI );
const RASTER_PROXY_KEY = '__rayzeeRasterLightProxy';
const PATH_ONLY_LIGHT_LAYER = 31;
const MAX_REALTIME_DIMENSION = 2560;
const MAX_REALTIME_PIXEL_RATIO = 2;

/**
 * Real-time WebGPU renderer used while path tracing is disabled.
 *
 * The path tracer deliberately owns a light-only scene whose intensities use
 * Blender-style power units. Raster rendering uses meshScene and Three.js light
 * units, so this manager mirrors those canonical lights into raster-only proxies
 * instead of mutating the path tracer's validated representation.
 */
export class RealtimeRenderer {

	constructor( { renderer, scene, lightScene, camera, settings, postProcessing = true } ) {

		this.renderer = renderer;
		this.scene = scene;
		this.lightScene = lightScene;
		this.camera = camera;
		this.settings = settings;
		this.lightProxies = [];
		this._meshShadowState = new Map();
		this._sourceLightMasks = new Map();
		this._environment = null;
		this.pipeline = null;
		this.scenePass = null;
		this.aoPass = null;
		this.ssrPass = null;
		this.bloomPass = null;
		this.aaPass = null;
		this._active = false;
		this._pathTracerWidth = renderer.domElement?.width || 1;
		this._pathTracerHeight = renderer.domElement?.height || 1;
		this._displayWidth = 0;
		this._displayHeight = 0;

		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = PCFShadowMap;
		if ( postProcessing ) this._initPostProcessing();

	}

	render() {

		if ( ! this._active ) this.activate();
		this._syncDisplaySize();

		if ( this.pipeline ) {

			this.pipeline.render();

		} else {

			this.renderer.render( this.scene, this.camera );

		}

	}

	/** Switch the shared canvas to view-resolution rendering. */
	activate() {

		if ( this._active ) return;
		this._active = true;
		this._syncDisplaySize( true );

	}

	/** Restore the path tracer's independently configured output resolution. */
	deactivate() {

		if ( ! this._active ) return;
		this._active = false;
		this._displayWidth = 0;
		this._displayHeight = 0;
		this.renderer?.setSize( this._pathTracerWidth, this._pathTracerHeight, false );

	}

	/** Record the output size to restore after leaving real-time mode. */
	setPathTracerSize( width, height ) {

		this._pathTracerWidth = width;
		this._pathTracerHeight = height;
		if ( this._active ) this._syncDisplaySize( true );

	}

	/** Synchronize scene-level PBR lighting and backdrop controls. */
	syncEnvironment() {

		if ( ! this.scene || ! this.lightScene || ! this.settings ) return;

		const environment = this.lightScene.environment || this.scene.environment || this._environment;
		if ( environment ) this._environment = environment;
		const enabled = this.settings.get( 'enableEnvironment' ) !== false;
		const showBackground = this.settings.get( 'showBackground' ) !== false;
		const transparent = this.settings.get( 'transparentBackground' ) === true;
		const rotation = MathUtils.degToRad( Number( this.settings.get( 'environmentRotation' ) ) || 0 );

		this.scene.environment = enabled ? environment : null;
		this.scene.environmentIntensity = Number( this.settings.get( 'environmentIntensity' ) ) || 0;
		this.scene.environmentRotation.set( 0, rotation, 0 );
		this.scene.backgroundIntensity = Number( this.settings.get( 'backgroundIntensity' ) ) || 0;
		this.scene.backgroundBlurriness = Math.max( 0, Math.min( 1, Number( this.settings.get( 'backgroundBlurriness' ) ) || 0 ) );
		this.scene.backgroundRotation.set( 0, rotation, 0 );

		if ( transparent ) {

			this.scene.background = null;

		} else if ( showBackground ) {

			this.scene.background = environment;

		} else {

			this.scene.background = new Color( this.settings.get( 'backgroundColor' ) || '#000000' );

		}

	}

	/** Rebuild Three.js-native light proxies and shadow policy from canonical lights. */
	syncLights() {

		if ( ! this.scene || ! this.lightScene ) return;

		this._removeLightProxies();
		this._isolateImportedLights();
		this._configureMeshShadows();
		const bounds = new Box3().setFromObject( this.scene );
		this._fitScreenSpaceEffects( bounds );

		const sources = this.lightScene.getObjectsByProperty( 'isLight', true )
			.filter( light => ! light.userData?.[ RASTER_PROXY_KEY ] );
		const shadowCandidates = sources
			.filter( light => light.visible && ( light.isDirectionalLight || light.isSpotLight || light.isPointLight ) )
			.sort( ( a, b ) => this._shadowPriority( b ) - this._shadowPriority( a ) );
		const shadowSources = new Set( shadowCandidates.slice( 0, 4 ) );

		for ( const source of sources ) {

			const proxy = this._createLightProxy( source, shadowSources.has( source ), bounds );
			if ( ! proxy ) continue;
			this.scene.add( proxy );
			this.lightProxies.push( proxy );

			if ( proxy.target ) {

				this.scene.add( proxy.target );
				this.lightProxies.push( proxy.target );

			}

		}

	}

	syncScene() {

		this.syncEnvironment();
		this.syncLights();

	}

	invalidate() {

		for ( const object of this.lightProxies ) {

			if ( object.isLight && object.shadow ) object.shadow.needsUpdate = true;

		}

	}

	precompile() {

		if ( ! this.renderer || ! this.scene || ! this.camera ) return Promise.resolve();
		this.syncScene();
		return this.renderer.compileAsync( this.scene, this.camera );

	}

	dispose() {

		this._removeLightProxies();
		this._restoreImportedLightLayers();
		this._restoreMeshShadows();
		this.scenePass?.dispose();
		this.aoPass?.dispose();
		this.ssrPass?.dispose();
		this.bloomPass?.dispose();
		this.aaPass?.dispose();
		this.pipeline?.dispose();
		this.pipeline = null;
		this.scenePass = null;
		this.aoPass = null;
		this.ssrPass = null;
		this.bloomPass = null;
		this.aaPass = null;
		this._active = false;
		this.renderer = null;
		this.scene = null;
		this.lightScene = null;
		this.camera = null;
		this.settings = null;
		this._environment = null;

	}

	_initPostProcessing() {

		this.pipeline = new RenderPipeline( this.renderer );
		this.scenePass = pass( this.scene, this.camera );
		this.scenePass.setMRT( mrt( {
			output,
			normal: packNormalToRGB( normalView ),
			metalrough: vec2( metalness, roughness ),
			emissive,
		} ) );

		const colorNode = this.scenePass.getTextureNode( 'output' );
		const depthNode = this.scenePass.getTextureNode( 'depth' );
		const packedNormalNode = this.scenePass.getTextureNode( 'normal' );
		const metalRoughNode = this.scenePass.getTextureNode( 'metalrough' );
		const emissiveNode = this.scenePass.getTextureNode( 'emissive' );

		// Normals and scalar material properties do not need FP16 bandwidth.
		this.scenePass.getTexture( 'normal' ).type = UnsignedByteType;
		this.scenePass.getTexture( 'metalrough' ).type = UnsignedByteType;
		const normalNode = sample( uv => unpackRGBToNormal( packedNormalNode.sample( uv ) ) );

		this.aoPass = ao( depthNode, normalNode, this.camera );
		this.aoPass.resolutionScale = 0.75;
		this.aoPass.samples.value = 16;
		this.aoPass.scale.value = 1.15;

		this.ssrPass = ssr( colorNode, depthNode, normalNode, {
			metalnessNode: metalRoughNode.r,
			roughnessNode: metalRoughNode.g,
			reflectNonMetals: true,
		} );
		// Keep reflections at the canvas' native backing resolution. Half-resolution
		// SSR was visibly pixelated after upscaling, especially on broad glossy floors.
		this.ssrPass.resolutionScale = 1;
		this.ssrPass.quality.value = 0.35;
		this.ssrPass.blurQuality = 1;
		this.ssrPass.intensity.value = 0.65;
		this.ssrPass.screenEdgeFadeBlack = true;

		this.bloomPass = bloom( emissiveNode, 0.3, 0.35, 0.8 );

		const occlusion = vec3( this.aoPass.getTextureNode().r );
		const finalColor = colorNode.rgb.mul( occlusion )
			.add( this.ssrPass.rgb )
			.add( this.bloomPass.rgb );
		this.aaPass = smaa( vec4( finalColor, colorNode.a ) );
		this.pipeline.outputNode = this.aaPass;

	}

	_fitScreenSpaceEffects( bounds ) {

		if ( ! this.aoPass || ! this.ssrPass ) return;
		const size = bounds.isEmpty() ? new Vector3( 10, 10, 10 ) : bounds.getSize( new Vector3() );
		const span = Math.max( size.x, size.y, size.z, 1e-3 );

		this.aoPass.radius.value = span * 0.04;
		this.aoPass.thickness.value = span * 0.08;
		this.ssrPass.maxDistance.value = span * 0.5;
		this.ssrPass.thickness.value = span * 0.005;

	}

	_syncDisplaySize( force = false ) {

		if ( ! this._active || ! this.renderer?.domElement ) return;

		const canvas = this.renderer.domElement;
		const rect = canvas.getBoundingClientRect?.();
		const cssWidth = rect?.width || canvas.clientWidth || this._pathTracerWidth;
		const cssHeight = rect?.height || canvas.clientHeight || this._pathTracerHeight;
		const pixelRatio = Math.min(
			typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
			MAX_REALTIME_PIXEL_RATIO
		);
		let width = Math.max( 1, Math.round( cssWidth * pixelRatio ) );
		let height = Math.max( 1, Math.round( cssHeight * pixelRatio ) );
		const scale = Math.min( 1, MAX_REALTIME_DIMENSION / Math.max( width, height ) );
		width = Math.max( 1, Math.round( width * scale ) );
		height = Math.max( 1, Math.round( height * scale ) );

		if ( ! force && width === this._displayWidth && height === this._displayHeight ) return;
		this._displayWidth = width;
		this._displayHeight = height;
		this.renderer.setSize( width, height, false );

	}

	_createLightProxy( source, castShadow, bounds ) {

		const proxy = source.clone();
		proxy.userData = { ...source.userData, [ RASTER_PROXY_KEY ]: source.uuid };
		proxy.layers.set( 0 );

		source.updateWorldMatrix( true, false );
		source.getWorldPosition( proxy.position );
		source.getWorldQuaternion( proxy.quaternion );
		source.getWorldScale( proxy.scale );

		if ( proxy.isRectAreaLight ) {

			proxy.width *= Math.abs( proxy.scale.x );
			proxy.height *= Math.abs( proxy.scale.y );
			proxy.scale.set( 1, 1, 1 );

		}

		if ( ( source.isSpotLight || source.isDirectionalLight ) && source.target ) {

			const target = new Object3D();
			source.target.updateWorldMatrix( true, false );
			source.target.getWorldPosition( target.position );
			target.userData[ RASTER_PROXY_KEY ] = source.uuid;
			proxy.target = target;

		}

		this._applyEmission( source, proxy );
		this._configureLightShadow( proxy, castShadow, bounds );
		return proxy;

	}

	_applyEmission( source, proxy ) {

		const userData = source.userData || {};
		const exposure = Number.isFinite( userData.exposure ) ? userData.exposure : 0;
		const power = source.intensity * Math.pow( 2, exposure );
		proxy.color.copy( source.color );

		if ( userData.useTemperature ) {

			const [ r, g, b ] = blackbodyToLinearRGB( userData.temperature ?? 6500 );
			proxy.color.r *= r;
			proxy.color.g *= g;
			proxy.color.b *= b;

		}

		if ( proxy.isPointLight || proxy.isSpotLight ) {

			// Match the path tracer, which treats both as isotropic radiant power.
			proxy.intensity = power * INV_4PI;

		} else if ( proxy.isRectAreaLight ) {

			const normalize = userData.normalize ?? true;
			const area = Math.max( 1e-8, Math.abs( proxy.width * proxy.height ) );
			proxy.intensity = power / ( Math.PI * ( normalize ? area : 1 ) );

		} else {

			proxy.intensity = power;

		}

	}

	_configureLightShadow( light, enabled, bounds ) {

		if ( ! light.shadow ) return;
		light.castShadow = enabled;
		if ( ! enabled ) return;

		const size = bounds.isEmpty() ? new Vector3( 10, 10, 10 ) : bounds.getSize( new Vector3() );
		const center = bounds.isEmpty() ? new Vector3() : bounds.getCenter( new Vector3() );
		const span = Math.max( size.x, size.y, size.z, 1 );
		light.shadow.mapSize.set( light.isDirectionalLight ? 2048 : 1024, light.isDirectionalLight ? 2048 : 1024 );
		light.shadow.bias = - 0.00005;
		light.shadow.normalBias = Math.min( 0.005, Math.max( 0.0001, span * 0.00005 ) );
		light.shadow.radius = 2;
		light.shadow.autoUpdate = false;
		light.shadow.needsUpdate = true;

		if ( light.isDirectionalLight ) {

			const direction = light.target.position.clone().sub( light.position ).normalize();
			if ( direction.lengthSq() === 0 ) direction.set( 0, - 1, 0 );
			const half = span * 0.9;
			light.shadow.camera.left = - half;
			light.shadow.camera.right = half;
			light.shadow.camera.top = half;
			light.shadow.camera.bottom = - half;
			light.shadow.camera.near = Math.max( span * 0.001, 0.01 );
			light.shadow.camera.far = span * 4;
			light.target.position.copy( center );
			light.position.copy( center ).addScaledVector( direction, - span * 2 );

		} else {

			light.shadow.camera.near = Math.max( span * 0.001, 0.01 );
			const sceneFar = light.position.distanceTo( center ) + span;
			light.shadow.camera.far = light.distance > 0 ? Math.min( light.distance, sceneFar ) : sceneFar;

		}

		light.shadow.camera.updateProjectionMatrix();

	}

	_configureMeshShadows() {

		this._restoreMeshShadows();
		this.scene.traverse( object => {

			if ( ! object.isMesh ) return;
			this._meshShadowState.set( object, { castShadow: object.castShadow, receiveShadow: object.receiveShadow } );
			const materials = Array.isArray( object.material ) ? object.material : [ object.material ];
			const transmissive = materials.some( material => ( material?.transmission || 0 ) > 0 );
			object.castShadow = object.userData?.rayzeeCastShadow ?? ! transmissive;
			object.receiveShadow = object.userData?.rayzeeReceiveShadow ?? true;

		} );

	}

	_restoreMeshShadows() {

		for ( const [ mesh, state ] of this._meshShadowState ) {

			mesh.castShadow = state.castShadow;
			mesh.receiveShadow = state.receiveShadow;

		}

		this._meshShadowState.clear();

	}

	_isolateImportedLights() {

		// Scene rebuilds replace imported objects. Restore and release any prior refs
		// before tracking the current source lights.
		this._restoreImportedLightLayers();
		this.scene.getObjectsByProperty( 'isLight', true ).forEach( light => {

			if ( light.userData?.[ RASTER_PROXY_KEY ] ) return;
			if ( ! this._sourceLightMasks.has( light ) ) this._sourceLightMasks.set( light, light.layers.mask );
			light.layers.set( PATH_ONLY_LIGHT_LAYER );

		} );

	}

	_restoreImportedLightLayers() {

		for ( const [ light, mask ] of this._sourceLightMasks ) {

			light.layers.mask = mask;

		}

		this._sourceLightMasks.clear();

	}

	_removeLightProxies() {

		for ( const object of this.lightProxies ) {

			object.removeFromParent();
			object.shadow?.dispose?.();

		}

		this.lightProxies.length = 0;

	}

	_shadowPriority( light ) {

		const typeWeight = light.isDirectionalLight ? 1e12 : light.isSpotLight ? 1e9 : 0;
		return typeWeight + Math.max( 0, light.intensity || 0 );

	}

}

export { RASTER_PROXY_KEY };
