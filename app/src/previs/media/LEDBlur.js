import { Fn, If, materialReference, texture, uniform, uv, vec2, vec3 } from 'three/tsl';

export const LED_BLUR_METHODS = Object.freeze( [ 'off', 'fast', 'gaussian', 'lens' ] );
export const LED_BLUR_LABELS = Object.freeze( { off: 'Off', fast: 'Fast (box)', gaussian: 'Gaussian', lens: 'Lens (disc)' } );
export const DEFAULT_LED_BLUR = Object.freeze( { method: 'off', amount: 0 } );

export function validateLEDBlur( value ) {

	if ( ! value || Object.getPrototypeOf( value ) !== Object.prototype || Object.keys( value ).length !== 2 || ! LED_BLUR_METHODS.includes( value.method ) || ! Number.isFinite( value.amount ) || value.amount < 0 || value.amount > 40 ) throw new Error( 'LED blur requires a supported method and an amount between 0 and 40.' );
	return value;

}

// All kernels have unit energy. Radius is in pixels at a 1920-wide LED image.
// Disc sampling approximates a defocused circular aperture; it is not scene DOF.
export function ledBlurKernel( method ) {

	const samples = [];
	if ( method === 'lens' ) {

		for ( let i = 0; i < 48; i ++ ) {

			const radius = Math.sqrt( ( i + 0.5 ) / 48 ), angle = i * Math.PI * ( 3 - Math.sqrt( 5 ) );
			samples.push( [ radius * Math.cos( angle ), radius * Math.sin( angle ), 1 ] );

		}

	} else {

		const extent = method === 'gaussian' ? 2 : 1;
		for ( let y = - extent; y <= extent; y ++ ) for ( let x = - extent; x <= extent; x ++ ) samples.push( [ x / extent, y / extent, method === 'gaussian' ? Math.exp( - ( x * x + y * y ) / 2 ) : 1 ] );

	}

	const total = samples.reduce( ( sum, item ) => sum + item[ 2 ], 0 );
	return samples.map( ( [ x, y, weight ] ) => [ x, y, weight / total ] );

}

/** One stable shader graph per LED; changing method/amount only writes uniforms. */
export function createLEDBlurNode( map ) {

	const method = uniform( 0, 'int' ), amount = uniform( 0 ), aspect = uniform( map.image.width / map.image.height );
	const source = texture( map );
	const sampleUV = source.getTransformedUV( uv( map.channel ) );
	const node = Fn( () => {

		const color = vec3( 0 ).toVar();
		If( method.equal( 0 ).or( amount.lessThanEqual( 0 ) ), () => {

			color.assign( texture( map, sampleUV ).rgb );

		} ).Else( () => {

			const radius = vec2( amount.div( 1920 ), amount.div( 1920 ).mul( aspect ) );
			for ( const [ index, name ] of LED_BLUR_METHODS.entries() ) {

				if ( name === 'off' ) continue;
				If( method.equal( index ), () => {

					for ( const [ x, y, weight ] of ledBlurKernel( name ) ) color.addAssign( texture( map, sampleUV.add( radius.mul( vec2( x, y ) ) ) ).rgb.mul( weight ) );

				} );

			}

		} );
		return color.mul( materialReference( 'emissive', 'color' ) ).mul( materialReference( 'emissiveIntensity', 'float' ) );

	} )();
	return { node, set( value = DEFAULT_LED_BLUR ) {

		validateLEDBlur( value );
		method.value = LED_BLUR_METHODS.indexOf( value.method ); amount.value = value.amount;

	} };

}
