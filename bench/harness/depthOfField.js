import { StorageBufferAttribute } from 'three/webgpu';
import { Matrix4, PerspectiveCamera } from 'three';
import { Fn, storage, instanceIndex, vec2, vec4, float, int, uint, mat4, bool } from 'three/tsl';
import { generateRayFromCamera } from '../../rayzee/src/TSL/CameraRay.js';
import { Ray } from '../../rayzee/src/TSL/Struct.js';

/** Validate lens geometry on the GPU, including compatibility with the legacy lens. */
export async function checkDepthOfField( app ) {

	const renderer = app.renderer;
	const count = 128;
	const camera = new PerspectiveCamera( 60, 1, 0.01, 10000 );
	const evaluate = async ( mode, { scale = 1, enabled = true, blur = 0.05 } = {} ) => {

		const attr = new StorageBufferAttribute( count * 2, 4 );
		const output = storage( attr, 'vec4', count * 2 );
		const kernel = Fn( () => {

			const seed = uint( instanceIndex ).add( 1 ).toVar();
			const ray = Ray.wrap( generateRayFromCamera(
				vec2( 0.8, 0.5 ), seed, mat4( new Matrix4() ), mat4( camera.projectionMatrixInverse ),
				int( 0 ), vec2( - Math.PI, Math.PI ), vec2( - Math.PI / 2, Math.PI / 2 ), int( 1 ),
				bool( enabled ), float( 50 ), float( 2 ), float( 5 * scale ), float( 1 ), float( 1 ), float( 1 ),
				float( scale ), int( mode ), float( blur )
			) );
			output.element( instanceIndex.mul( 2 ) ).assign( vec4( ray.origin, 1 ) );
			output.element( instanceIndex.mul( 2 ).add( 1 ) ).assign( vec4( ray.direction, 1 ) );

		} )().compute( count );
		try {

			await renderer.computeAsync( kernel );
			return new Float32Array( await renderer.getArrayBufferAsync( attr ) );

		} finally {

			kernel.dispose();
			renderer.backend.get( attr ).buffer?.destroy();
			renderer.backend.delete( attr );

		}

	};

	const legacy = await evaluate( 2 );
	const physical = await evaluate( 0 );
	const physicalScaled = await evaluate( 0, { scale: 100 } );
	const look = await evaluate( 1 );
	const lookScaled = await evaluate( 1, { scale: 100 } );
	const noBlur = await evaluate( 1, { blur: 0 } );
	const disabled = await evaluate( 0, { enabled: false } );
	const close = ( a, b, label, epsilon = 1e-5 ) => {

		if ( ! Number.isFinite( a ) || Math.abs( a - b ) > epsilon ) throw new Error( `${label}: ${a}, expected ${b}` );

	};

	const tanHalf = Math.tan( Math.PI / 6 );
	const axisX = 0.6 * tanHalf;
	const radialLength = Math.hypot( axisX, 1 );
	for ( let i = 0; i < count; i ++ ) {

		const j = i * 8;
		for ( const rays of [ legacy, physical, physicalScaled, look, lookScaled, noBlur, disabled ] ) {

			for ( let k = 0; k < 8; k ++ ) if ( ! Number.isFinite( rays[ j + k ] ) ) throw new Error( 'non-finite lens ray' );

		}

		for ( const component of [ 0, 1 ] ) {

			close( physical[ j + component ], legacy[ j + component ] / 2, 'physical lens is half the legacy radius' );
			close( physicalScaled[ j + component ] / 100, physical[ j + component ], 'physical scene units' );
			close( lookScaled[ j + component ] / 100, look[ j + component ], 'look scene scale' );
			close( look[ j + component ], legacy[ j + component ] * ( 0.05 * 5 * tanHalf / 0.025 ), 'look blur fraction' );
			close( noBlur[ j + component ], 0, 'zero look blur is pinhole' );
			close( disabled[ j + component ], 0, 'disabled DOF is pinhole' );

		}

		for ( const component of [ 4, 5, 6 ] ) {

			close( physicalScaled[ j + component ], physical[ j + component ], 'physical scale-invariant direction' );
			close( lookScaled[ j + component ], look[ j + component ], 'look scale-invariant direction' );

		}

		// All physical rays through the same pixel meet on a flat focal plane.
		const t = - 5 / physical[ j + 6 ];
		close( physical[ j ] + physical[ j + 4 ] * t, axisX * 5, 'flat focal plane' );
		close( physical[ j + 1 ] + physical[ j + 5 ] * t, 0, 'flat focal plane y' );
		// The legacy ray continues to meet its old spherical focus target.
		const legacyT = ( - 5 / radialLength ) / legacy[ j + 6 ];
		close( legacy[ j ] + legacy[ j + 4 ] * legacyT, axisX * 5 / radialLength, 'legacy spherical focus' );

	}

	const rendered = [];
	for ( const mode of [ 'legacy', 'physical', 'look' ] ) {

		app.settings.setMany( { enableDOF: true, dofMode: mode, unitsPerMetre: 1, dofBlur: 0.05, focusDistance: 3, aperture: 2 } );
		await app.renderFrames( 2, { reset: true } );
		const { data } = await app.renderToBuffer( { colorSpace: 'linear' } );
		if ( ! data.every( Number.isFinite ) ) throw new Error( `non-finite render in ${mode} mode` );
		rendered.push( mode );

	}

	// Debug kernels share the lens model and must compile with the same arguments.
	app.settings.set( 'visMode', 4 );
	await app.renderFrames( 2, { reset: true } );
	app.settings.set( 'visMode', 0 );
	return { checkedRaysPerModel: count, legacyRadiusPreserved: true, flatFocus: true, scaledModels: [ 'physical', 'look' ], rendered };

}
