/**
 * CameraRay.js — primary camera ray generation.
 *
 * Two projections behind one `cameraProjection` uniform: 0 = pinhole (NDC through
 * cameraProjectionMatrixInverse), 1 = equirectangular 360 panorama. Both branches live in the same
 * kernel, so switching modes writes a uniform and resets accumulation — it never recompiles WGSL.
 *
 * Equirect mapping, for uv ∈ [0,1] with v = 0 at the top row:
 *   lon = mix( lonMin, lonMax, u ),  lat = mix( latMax, latMin, v )
 *   dirCam = ( sin(lon)·cos(lat), sin(lat), -cos(lon)·cos(lat) )
 * so lon = lat = 0 is camera-forward (image centre), u = 0.75 is camera-right and v = 0 is the zenith.
 */

import {
	Fn, vec3, vec4, float, int,
	If, normalize, mat3, mix, sin, cos, cross, dot, max, select,
} from 'three/tsl';

import { Ray } from './Struct.js';
import { constructTBN } from './Common.js';
import { RandomPointInCircle } from './Random.js';

/** World-space primary ray direction for pixel uv. Origin is always cameraWorldMatrix[3]. */
export const cameraRayDirection = Fn( ( [
	uv01, cameraWorldMatrix, cameraProjectionMatrixInverse,
	cameraProjection, panoLonRange, panoLatRange, panoLevelHorizon
] ) => {

	const direction = vec3( 0.0 ).toVar();

	If( cameraProjection.equal( int( 1 ) ), () => {

		const lon = mix( panoLonRange.x, panoLonRange.y, uv01.x ).toVar();
		const lat = mix( panoLatRange.y, panoLatRange.x, uv01.y ).toVar();
		const cosLat = cos( lat ).toVar();

		const right = vec3( 0.0 ).toVar();
		const up = vec3( 0.0 ).toVar();
		const back = vec3( 0.0 ).toVar();

		If( panoLevelHorizon.equal( int( 1 ) ), () => {

			// Yaw-only frame — orbit pitch/roll must not tilt the panorama. The flattened column
			// is normalized below, so it needs no pre-normalize.
			const flat = vec3( cameraWorldMatrix[ 2 ].x, 0.0, cameraWorldMatrix[ 2 ].z ).toVar();
			// Straight up/down: the camera's own up vector is the horizontal one.
			If( dot( flat, flat ).lessThan( float( 1e-8 ) ), () => {

				flat.assign( vec3( cameraWorldMatrix[ 1 ].x, 0.0, cameraWorldMatrix[ 1 ].z ) );

			} );

			back.assign( normalize( flat ) );
			up.assign( vec3( 0.0, 1.0, 0.0 ) );
			right.assign( cross( up, back ) );

		} ).Else( () => {

			right.assign( normalize( vec3( cameraWorldMatrix[ 0 ] ) ) );
			up.assign( normalize( vec3( cameraWorldMatrix[ 1 ] ) ) );
			back.assign( normalize( vec3( cameraWorldMatrix[ 2 ] ) ) );

		} );

		direction.assign( normalize(
			right.mul( sin( lon ).mul( cosLat ) )
				.add( up.mul( sin( lat ) ) )
				.sub( back.mul( cos( lon ).mul( cosLat ) ) )
		) );

	} ).Else( () => {

		const ndcPos = vec3( uv01.x.mul( 2.0 ).sub( 1.0 ), float( 1.0 ).sub( uv01.y.mul( 2.0 ) ), 1.0 );
		const rayDirCS = cameraProjectionMatrixInverse.mul( vec4( ndcPos, 1.0 ) );

		direction.assign( normalize( mat3(
			cameraWorldMatrix[ 0 ].xyz,
			cameraWorldMatrix[ 1 ].xyz,
			cameraWorldMatrix[ 2 ].xyz
		).mul( rayDirCS.xyz.div( rayDirCS.w ) ) ) );

	} );

	return direction;

} );

// A perspective camera clips on a plane; a panorama clips on a sphere.
export const cameraClipDistance = ( direction, clipStart, cameraWorldMatrix, cameraProjection ) => select(
	cameraProjection.equal( int( 1 ) ), clipStart,
	clipStart.div( max( dot( direction, normalize( vec3( cameraWorldMatrix[ 2 ] ) ) ).negate(), 1e-4 ) )
);

export const generateRayFromCamera = Fn( ( [
	uv01, rngState,
	cameraWorldMatrix, cameraProjectionMatrixInverse,
	cameraProjection, panoLonRange, panoLatRange, panoLevelHorizon,
	enableDOF, focalLength, aperture, focusDistance, sceneScale, apertureScale, anamorphicRatio,
	unitsPerMetre = float( 1 ), dofMode = int( 2 ), dofBlur = float( 0.05 )
] ) => {

	const rayOriginWorld = vec3( cameraWorldMatrix[ 3 ] ).toVar();
	// .toVar() so the two reads below don't inline the whole projection graph twice.
	const rayDirectionWorld = cameraRayDirection(
		uv01, cameraWorldMatrix, cameraProjectionMatrixInverse,
		cameraProjection, panoLonRange, panoLatRange, panoLevelHorizon
	).toVar();

	const resultOrigin = rayOriginWorld.toVar();
	const resultDirection = rayDirectionWorld.toVar();

	const lookMode = dofMode.equal( int( 1 ) );
	const legacyMode = dofMode.equal( int( 2 ) );
	const lensOpen = lookMode.and( dofBlur.greaterThan( 0.0 ) ).or( lookMode.not().and( focalLength.greaterThan( 0.0 ) ).and( aperture.lessThan( 64.0 ) ) );
	If( enableDOF.and( lensOpen ).and( focusDistance.greaterThan( 0.001 ) ), () => {

		const effectiveAperture = focalLength.div( aperture );
		const legacyRadius = effectiveAperture.mul( 0.001 ).mul( sceneScale ).mul( apertureScale );
		const halfViewHeight = select( cameraProjection.equal( int( 1 ) ), panoLatRange.y.sub( panoLatRange.x ).mul( 0.5 ), cameraProjectionMatrixInverse[ 1 ].y );
		const physicalRadius = focalLength.div( max( aperture, 1e-4 ).mul( 2 ) ).mul( 0.001 ).mul( unitsPerMetre ).mul( apertureScale );
		const apertureRadius = select( legacyMode, legacyRadius,
			select( lookMode, dofBlur.mul( focusDistance ).mul( halfViewHeight ), physicalRadius ) );

		const randomPoint = RandomPointInCircle( rngState );
		// Anamorphic squeeze — stretch horizontally for oval bokeh
		const lensX = randomPoint.x.mul( anamorphicRatio.max( 0.01 ) );
		const lensY = randomPoint.y;

		const lensOffset = vec3( 0.0 ).toVar();
		const focusAlongRay = focusDistance.toVar();

		If( cameraProjection.equal( int( 1 ) ), () => {

			// Every pixel points a different way, so the lens plane is built around the ray. The
			// camera's right/up would skew bokeh into a slit away from the image centre.
			lensOffset.assign( constructTBN( { N: rayDirectionWorld } ).mul( vec3( lensX, lensY, 0.0 ) ) );

		} ).Else( () => {

			const camRight = normalize( vec3( cameraWorldMatrix[ 0 ] ) );
			const camUp = normalize( vec3( cameraWorldMatrix[ 1 ] ) );
			lensOffset.assign( camRight.mul( lensX ).add( camUp.mul( lensY ) ) );
			If( legacyMode.not(), () => {

				focusAlongRay.assign( focusDistance.div( max( dot( rayDirectionWorld, normalize( vec3( cameraWorldMatrix[ 2 ] ) ) ).negate(), 1e-4 ) ) );

			} );

		} );

		resultOrigin.assign( rayOriginWorld.add( lensOffset.mul( apertureRadius ) ) );
		resultDirection.assign( normalize( rayOriginWorld.add( rayDirectionWorld.mul( focusAlongRay ) ).sub( resultOrigin ) ) );

	} );

	return Ray( {
		origin: resultOrigin,
		direction: resultDirection,
	} );

} );
