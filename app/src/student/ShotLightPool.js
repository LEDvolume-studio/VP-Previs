import { baseSceneVersionKey } from '../previs/domain/StudentProjectSchema.js';

const copy = value => structuredClone( value );

/** One native light inventory for all saved shots of the loaded scene. */
export function createShotLightPool( document, shotId ) {

	const initial = document.shots[ shotId ], sceneKey = baseSceneVersionKey( initial.baseScene );
	const lights = new Map( initial.snapshot.lights.map( light => [ light.lightId, copy( light ) ] ) );
	for ( const shot of Object.values( document.shots ) ) {

		if ( baseSceneVersionKey( shot.baseScene ) !== sceneKey ) continue;
		for ( const light of shot.snapshot.lights ) if ( ! lights.has( light.lightId ) ) lights.set( light.lightId, copy( light ) );

	}

	const inventory = [ ...lights.values() ];
	const lightsFor = snapshot => {

		const authored = new Map( snapshot.lights.map( light => [ light.lightId, light ] ) );
		for ( const light of authored.values() ) if ( lights.get( light.lightId )?.type !== light.type ) throw new Error( 'This shot requires an unprepared light type.' );
		return inventory.map( template => {

			const light = authored.get( template.lightId );
			if ( light ) return copy( light );
			// Absent lights remain allocated, but never illuminate another shot.
			const hidden = copy( template ); hidden.transform.visible = false; hidden.intensity = 0;
			return hidden;

		} );

	};

	return {
		inventory: copy( inventory ), lightsFor,
		documentFor( candidate, selectedShotId ) {

			const preview = copy( candidate );
			preview.shots[ selectedShotId ].snapshot.lights = lightsFor( preview.shots[ selectedShotId ].snapshot );
			return preview;

		},
	};

}
