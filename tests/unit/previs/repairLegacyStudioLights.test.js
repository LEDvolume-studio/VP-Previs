import { expect, it } from 'vitest';
import { repairLegacyStudioLights } from '../../../app/src/student/editor/RepairLegacyStudioLights.js';
import legacyLights from '../../../app/src/student/editor/legacyStudioLights.json';

it( 'repairs only unchanged legacy studio fixtures and preserves student edits', () => {

	const light = structuredClone( legacyLights[ 0 ] );
	const project = { shots: {
		a: { baseScene: { sceneId: 'local-fixture-led-mannequin-studio-suv', version: 'fixture-1' }, snapshot: { lights: [ light, { ...structuredClone( legacyLights[ 1 ] ), intensity: 12 } ] } },
		b: { baseScene: { sceneId: 'another-scene', version: 'fixture-1' }, snapshot: { lights: structuredClone( legacyLights ) } },
	} };
	const repaired = repairLegacyStudioLights( project );
	expect( repaired.shots.a.snapshot.lights ).toHaveLength( 1 );
	expect( repaired.shots.a.snapshot.lights[ 0 ].intensity ).toBe( 12 );
	expect( repaired.shots.b.snapshot.lights ).toEqual( legacyLights );
	expect( project.shots.a.snapshot.lights ).toHaveLength( 2 );
	expect( repairLegacyStudioLights( repaired ) ).toBeNull();

} );
