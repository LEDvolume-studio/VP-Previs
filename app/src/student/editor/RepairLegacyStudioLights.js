// The original shared studio timeline inherited two review lights that were
// absent from the admin scene. Identify those specific unchanged fixtures only;
// do not remove a student's independently adjusted or newly added lights.
import legacyLights from './legacyStudioLights.json';
import { serializeStudentCatalogueContent } from '../../previs/domain/StudentCatalogueSchema.js';

const legacy = new Set( legacyLights.map( serializeStudentCatalogueContent ) );

export function repairLegacyStudioLights( document ) {

	let repaired = null;
	for ( const [ id, shot ] of Object.entries( document.shots ) ) {

		if ( shot.baseScene.sceneId !== 'local-fixture-led-mannequin-studio-suv' || shot.baseScene.version !== 'fixture-1' ) continue;
		const lights = shot.snapshot.lights.filter( light => {

			return ! legacy.has( serializeStudentCatalogueContent( light ) );

		} );
		if ( lights.length === shot.snapshot.lights.length ) continue;
		repaired ||= structuredClone( document );
		repaired.shots[ id ].snapshot.lights = structuredClone( lights );

	}
	return repaired;

}
