import { Color, Scene } from 'three';
import { LightManager } from '../../../../rayzee/src/managers/LightManager.js';
import appearance from './admin-appearance.json';

export const adminEnvironmentAsset = appearance.environmentAsset;

/** Authored values from the exported admin revision; no guessed glass/paint tuning. */
export function applyAdminReviewAppearance( document ) {

	const result = structuredClone( document );
	result.assets[ `${adminEnvironmentAsset.assetId}@${adminEnvironmentAsset.version}` ] = structuredClone( adminEnvironmentAsset );
	const helpers = { visible: false, clear() {}, update() {} };
	const scene = new Scene(), manager = new LightManager( scene, helpers );
	manager.replaceProjectState( appearance.lights );
	const lights = scene.getObjectsByProperty( 'isLight', true ).map( ( light, index ) => ( {
		lightId: index === 0 ? 'key' : 'fill', type: light.isDirectionalLight ? 'directional' : 'spot',
		transform: { position: light.position.toArray(), quaternion: light.quaternion.toArray(), scale: light.scale.toArray(), visible: light.visible },
		target: light.target.position.toArray(), color: new Color( light.color ).toArray(), intensity: light.intensity,
		emission: { temperature: light.userData.temperature, useTemperature: light.userData.useTemperature, exposure: light.userData.exposure },
		parameters: light.isDirectionalLight ? { angle: light.userData.angle } : { angle: light.angle, distance: light.distance, decay: light.decay, radius: light.userData.radius, penumbra: light.penumbra },
	} ) );
	for ( const shot of Object.values( result.shots ) ) {

		shot.snapshot.materials = structuredClone( appearance.materials );
		shot.snapshot.environment = structuredClone( appearance.environment );
		shot.snapshot.camera.exposure = appearance.exposure;
		shot.snapshot.lights = structuredClone( lights );
		Object.assign( shot.snapshot.rasterAppearance, { enableEnvironment: true, showBackground: true, backgroundColor: '#000000', backgroundIntensity: 1, backgroundBlurriness: 0 } );

	}

	manager.dispose?.();
	return result;

}
