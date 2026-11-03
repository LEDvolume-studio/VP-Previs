import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

export const TEST_NOW = '2026-10-21T00:00:00.000Z';
export const transform = () => ( { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], visible: true } );

export function studentFixture() {

	const document = createStudentProjectDocument( { projectId: 'fixture', now: TEST_NOW } );
	document.assets = {
		'car@1': { assetId: 'car', version: '1', kind: 'model', sha256: 'a'.repeat( 64 ), byteLength: 100, mimeType: 'model/gltf-binary', durationUs: null },
		'video@1': { assetId: 'video', version: '1', kind: 'video', sha256: 'b'.repeat( 64 ), byteLength: 200, mimeType: 'video/mp4', durationUs: 1000000 },
	};
	document.baseScenes = { 'studio@1': { sceneId: 'studio', version: '1', assets: [ { assetId: 'car', version: '1' } ] } };
	document.shots = {
		shotA: {
			shotId: 'shotA', name: 'Wide', baseScene: { sceneId: 'studio', version: '1' }, sourcePreset: { presetId: 'wide', version: '1' },
			snapshot: {
				camera: {
					transform: transform(), target: [ 0, 0, - 1 ],
					projection: { type: 'perspective', fov: 50, aspect: 16 / 9, near: 0.01, far: 1000, zoom: 1, clipStart: 0, filmGauge: 35, filmOffset: 0 },
					renderProjection: { type: 'perspective', panoramaLonRange: [ - 180, 180 ], panoramaLatRange: [ - 90, 90 ], panoramaLevelHorizon: true },
					lens: { focalLength: 50, sensorWidth: 36, sensorHeight: 20.25, focusDistance: 5, aperture: 2.8, enableDOF: true, dofMode: 'physical', dofBlur: 0.05, apertureScale: 1, anamorphicRatio: 1, autoFocusMode: 'manual', afScreenPoint: [ 0.5, 0.5 ], afSmoothingFactor: 0.15, unitsPerMetre: 1 },
					exposure: 1, frameOverlayRatio: '16:9',
				},
				nodes: { carInstance: { asset: { assetId: 'car', version: '1' }, nodeId: 'root', transform: transform(), humanPose: null, doorAngles: { leftFront: 0.3 } } },
				lights: [ { lightId: 'key', type: 'spot', transform: transform(), target: [ 0, 1, 0 ], color: [ 1, 0.9, 0.8 ], intensity: 5, emission: { temperature: 6500, useTemperature: false, exposure: 0 }, parameters: { distance: 100, decay: 2, radius: 0, angle: 0.5, penumbra: 0.1 } } ],
				ledWalls: [ { wallId: 'wall', media: { assetId: 'video', version: '1' }, mode: 'play', inPointUs: 800000, loop: true, playbackRate: 1, brightness: 1, transform: transform() } ],
				environment: { asset: null, intensity: 1, rotation: [ 0, 0, 0 ], background: true },
			},
		},
	};
	document.shots.shotB = { ...structuredClone( document.shots.shotA ), shotId: 'shotB', name: 'Close' };
	document.shots.shotB.snapshot.ledWalls[ 0 ].mode = 'freeze';
	document.clips = [ { clipId: 'clipA', shotId: 'shotA', durationFrames: 25 }, { clipId: 'clipB', shotId: 'shotB', durationFrames: 25 } ];
	document.narration.assets = { 'voice@1': {
		assetId: 'voice', version: '1', sha256: 'c'.repeat( 64 ), byteLength: 1000, mimeType: 'audio/webm', codec: 'opus',
		sampleRate: 48000, channels: 1, durationSamples: 480000,
		segments: [ { index: 0, sha256: 'd'.repeat( 64 ), byteLength: 600 }, { index: 1, sha256: 'e'.repeat( 64 ), byteLength: 400 } ],
	} };
	document.narration.clips = [
		{ narrationClipId: 'voiceShot', media: { assetId: 'voice', version: '1' }, anchor: { type: 'clip', clipId: 'clipA' }, offsetFrames: 5, sourceStartSample: 100, lengthSamples: 96000, gain: 0.5, muted: false },
		{ narrationClipId: 'voiceSequence', media: { assetId: 'voice', version: '1' }, anchor: { type: 'sequence' }, offsetFrames: 0, sourceStartSample: 1000, lengthSamples: 480000 - 1000, gain: 1, muted: false },
	];
	return document;

}
