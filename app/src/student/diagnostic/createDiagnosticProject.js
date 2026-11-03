import { createStudentProjectDocument } from '../../previs/domain/StudentProjectSchema.js';

const transform = object => ( { position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), visible: object.visible } );

/** Real hashed generated video; no invented teacher catalogue or model versions. */
export async function createDiagnosticProject( camera, wall, video ) {

	camera = camera.clone();
	const bytes = await video.arrayBuffer();
	const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	const document = createStudentProjectDocument( { name: 'Raster sequence fixture' } );
	document.assets[ 'timecode@1' ] = { assetId: 'timecode', version: '1', kind: 'video', sha256: hash, byteLength: video.size, mimeType: 'video/mp4', durationUs: 3000000 };
	document.baseScenes[ 'diagnostic@1' ] = { sceneId: 'diagnostic', version: '1', assets: [] };
	for ( const [ shotId, position, mode, inPointUs, frameOverlayRatio ] of [
		[ 'freeze', [ 6, 3.5, 8 ], 'freeze', 1000000, '4:3' ],
		[ 'play', [ - 5, 2.8, 6 ], 'play', 480000, '2.40:1' ],
	] ) {

		camera.position.set( ...position );
		camera.lookAt( 0, 1.8, - 0.5 );
		document.shots[ shotId ] = {
			shotId, name: shotId, baseScene: { sceneId: 'diagnostic', version: '1' }, sourcePreset: null,
			snapshot: {
				camera: {
					transform: transform( camera ), target: [ 0, 1.8, - 0.5 ],
					projection: { type: 'perspective', fov: camera.fov, aspect: 16 / 9, near: camera.near, far: camera.far, zoom: camera.zoom, clipStart: 0, filmGauge: camera.filmGauge, filmOffset: camera.filmOffset },
					renderProjection: { type: 'perspective', panoramaLonRange: [ - 180, 180 ], panoramaLatRange: [ - 90, 90 ], panoramaLevelHorizon: true },
					lens: { focalLength: camera.getFocalLength(), sensorWidth: 36, sensorHeight: 20.25, focusDistance: 5, aperture: 2.8, enableDOF: false, dofMode: 'physical', dofBlur: 0.05, apertureScale: 1, anamorphicRatio: 1, autoFocusMode: 'manual', afScreenPoint: [ 0.5, 0.5 ], afSmoothingFactor: 0.15, unitsPerMetre: 1 },
					exposure: 1, frameOverlayRatio,
				},
				// Proxy scenery/lights/door remain fixture-owned. This proves the
				// shared evaluator/camera/media path, not real asset/rig conversion.
				nodes: {}, lights: [],
				ledWalls: [ { wallId: 'wall', media: { assetId: 'timecode', version: '1' }, mode, inPointUs, loop: true, playbackRate: 1, brightness: 1, transform: transform( wall ) } ],
				environment: { asset: null, intensity: 1, rotation: [ 0, 0, 0 ], background: true },
			},
		};
		document.clips.push( { clipId: shotId, shotId, durationFrames: 125 } );

	}

	return document;

}
