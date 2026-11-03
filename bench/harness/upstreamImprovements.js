import { StorageBufferAttribute } from 'three/webgpu';
import { Matrix4 } from 'three';
import { Fn, storage, instanceIndex, vec2, vec3, vec4, float, int, mat4 } from 'three/tsl';
import { samplePointLightWithAttenuation, sampleSpotLightWithRadius } from '../../rayzee/src/TSL/LightsSampling.js';
import { PointLight, SpotLight, LightSample } from '../../rayzee/src/TSL/LightsCore.js';
import { cameraClipDistance } from '../../rayzee/src/TSL/CameraRay.js';
import { withSceneResources } from '../../rayzee/src/TSL/SceneResources.js';

/** Numerical GPU checks for the selectively imported features; no golden replacement. */
export async function checkUpstreamImprovements( renderer ) {

	const count = 32 * 32;
	const evaluate = async build => {

		const attr = new StorageBufferAttribute( count, 4 );
		const output = storage( attr, 'vec4', count );
		const kernel = Fn( () => {

			const u = float( instanceIndex.div( 32 ) ).add( 0.5 ).div( 32 );
			const v = float( instanceIndex.mod( 32 ) ).add( 0.5 ).div( 32 );
			output.element( instanceIndex ).assign( build( vec2( u, v ) ) );

		} );
		const compute = withSceneResources( kernel(), { lightRadius: true } ).compute( count );
		try {

			await renderer.computeAsync( compute );
			return new Float32Array( await renderer.getArrayBufferAsync( attr ) );

		} finally {

			compute.dispose();
			renderer.backend.get( attr ).buffer?.destroy();
			renderer.backend.delete( attr );

		}

	};

	const requireClose = ( actual, expected, label, tolerance = 0.001 ) => {

		if ( ! Number.isFinite( actual ) || Math.abs( actual - expected ) > tolerance ) {

			throw new Error( `${label}: ${actual}, expected ${expected}` );

		}

	};

	const irradiance = async ( radius, spot = false, outside = false ) => {

		const out = await evaluate( uv => {

			const base = { position: vec3( 0, 2, 0 ), color: vec3( 1 ), intensity: float( 3 ), distance: float( 0 ), decay: float( 2 ), radius: float( radius ) };
			const light = spot ? SpotLight( { ...base, direction: vec3( 0, - 1, 0 ), angle: float( 0.3 ), penumbra: float( 0 ), goboIndex: int( - 1 ), goboIntensity: float( 1 ), iesIndex: int( - 1 ), iesIntensity: float( 1 ) } ) : PointLight( base );
			const at = vec3( outside ? 2 * Math.tan( 0.3 ) * 1.02 : 0, 0, 0 );
			const sample = LightSample.wrap( ( spot ? sampleSpotLightWithRadius : samplePointLightWithAttenuation )( light, at, float( 1 ), uv ) );
			return vec4( sample.emission.x.mul( sample.direction.y ), sample.distance, 0, 1 );

		} );
		let sum = 0;
		for ( let i = 0; i < count; i ++ ) sum += out[ i * 4 ];
		return sum / count;

	};

	const pointZero = await irradiance( 0 );
	const pointDisc = await irradiance( 1 );
	const spotDisc = await irradiance( 0.5, true );
	const outsideCone = await irradiance( 0.5, true, true );
	requireClose( pointZero, 3 / 4, 'zero-radius point light' );
	requireClose( pointDisc, 3 / 5, 'finite-radius point light' );
	requireClose( spotDisc, 3 / 4.25, 'finite-radius spot light' );
	requireClose( outsideCone, 0, 'spot cone uses centre direction' );
	const clip = await evaluate( () => {

		const world = mat4( new Matrix4() );
		return vec4(
			cameraClipDistance( vec3( 0, 0, - 1 ), float( 1.1 ), world, int( 0 ) ),
			cameraClipDistance( vec3( 0.6, 0, - 0.8 ), float( 1.1 ), world, int( 0 ) ),
			cameraClipDistance( vec3( 0.6, 0, - 0.8 ), float( 1.1 ), world, int( 1 ) ),
			cameraClipDistance( vec3( 0, 0, - 1 ), float( 0 ), world, int( 0 ) ),
		);

	} );
	requireClose( clip[ 0 ], 1.1, 'perspective centre clip' );
	requireClose( clip[ 1 ], 1.375, 'perspective off-axis clip' );
	requireClose( clip[ 2 ], 1.1, 'panorama spherical clip' );
	requireClose( clip[ 3 ], 0, 'unclipped default camera' );
	return { pointZero, pointDisc, spotDisc, outsideCone, clip: Array.from( clip.slice( 0, 4 ) ) };

}

/** Verify that primary-ray generation actually skips a foreground wall. */
export async function checkCameraClipRender( app ) {

	const { Group, Mesh, PlaneGeometry, MeshStandardMaterial } = await import( 'three' );
	const group = new Group();
	for ( const [ z, emission ] of [[ - 0.5, 0 ], [ - 3, 0xff0000 ]] ) {

		const plane = new Mesh( new PlaneGeometry( 20, 20 ), new MeshStandardMaterial( { color: 0, emissive: emission } ) );
		plane.position.z = z;
		group.add( plane );

	}

	await app.loadObject3D( group, 'camera-clip-regression' );
	app.lightManager.clearLights();
	app.setCanvasSize( 32, 32 );
	app.setDeterministicMode( true );
	app.settings.setMany( { enableDOF: false, environmentIntensity: 0, maxBounces: 1, enableGroundCatcher: false } );
	const camera = app.cameraManager.camera;
	camera.position.set( 0, 0, 0 );
	camera.quaternion.identity();
	camera.updateMatrixWorld( true );
	const capture = async clipStart => {

		camera.userData.clipStart = clipStart;
		await app.renderFrames( 2, { reset: true } );
		const output = await app.renderToBuffer( { colorSpace: 'linear' } );
		const pixels = output.data;
		let red = 0;
		for ( let i = 0; i < pixels.length; i += 4 ) red += pixels[ i ];
		return red / ( pixels.length / 4 );

	};

	const wall = await capture( 0 );
	const beyondWall = await capture( 1.1 );
	const restoredWall = await capture( 0 );
	if ( ! Number.isFinite( beyondWall ) || wall > 0.001 || beyondWall < 0.1 || restoredWall > 0.001 ) {

		throw new Error( `clip render mismatch: ${JSON.stringify( { wall, beyondWall, restoredWall } )}` );

	}

	return { wall, beyondWall, restoredWall };

}

/** Exercise runtime specialization when a light gains and loses its radius. */
export async function checkLightRadiusRender( app ) {

	const { Mesh, PlaneGeometry, MeshStandardMaterial } = await import( 'three' );
	const plane = new Mesh( new PlaneGeometry( 20, 20 ), new MeshStandardMaterial( { color: 0xffffff, roughness: 1, metalness: 0 } ) );
	plane.position.z = - 3;
	await app.loadObject3D( plane, 'light-radius-regression' );
	app.setCanvasSize( 32, 32 );
	app.setDeterministicMode( true );
	app.settings.setMany( { enableDOF: false, environmentIntensity: 0, maxBounces: 1, enableGroundCatcher: false } );
	const camera = app.cameraManager.camera;
	camera.position.set( 0, 0, 0 );
	camera.quaternion.identity();
	camera.userData.clipStart = 0;
	camera.updateMatrixWorld( true );
	app.lightManager.clearLights();
	const descriptor = app.lightManager.addLight( 'PointLight' );
	const light = app.scene.getObjectByProperty( 'uuid', descriptor.uuid );
	light.position.set( 0, 0, - 2 );
	light.intensity = 4 * Math.PI;
	const capture = async radius => {

		light.userData.radius = radius;
		app.lightManager.updateLights();
		await app.renderFrames( 32, { reset: true } );
		const { data } = await app.renderToBuffer( { colorSpace: 'linear' } );
		let sum = 0;
		for ( let i = 0; i < data.length; i += 4 ) sum += data[ i ];
		return { mean: sum / ( data.length / 4 ), compiled: app.stages.pathTracer._compiledLightRadius };

	};

	const point = await capture( 0 );
	const disc = await capture( 1 );
	const restoredPoint = await capture( 0 );
	if ( ! Number.isFinite( disc.mean ) || point.mean <= 0 || disc.mean <= 0 || disc.mean >= point.mean ||
		point.compiled || ! disc.compiled || restoredPoint.compiled || Math.abs( point.mean - restoredPoint.mean ) > 1e-5 ) {

		throw new Error( `light radius render mismatch: ${JSON.stringify( { point, disc, restoredPoint } )}` );

	}

	return { point, disc, restoredPoint };

}
