import { Group } from 'three';
import { expect, it, vi } from 'vitest';
import prepared from '../../../app/src/student/demo/studio-review.preset.json';
import { createSeedAdminDocument, ensureLocalPresetSeeds } from '../../../app/src/services/presets/LocalPresetSeeds.js';

vi.mock( '../../../app/src/Constants.js', () => ( { MODEL_FILES: [] } ) );

it( 'does not recreate student presets deliberately removed by an admin', async () => {

	const repository = { get: vi.fn().mockResolvedValue( null ), isDeleted: vi.fn().mockResolvedValue( true ), save: vi.fn() };
	await ensureLocalPresetSeeds( { repository } );
	expect( repository.isDeleted ).toHaveBeenCalledTimes( 6 );
	expect( repository.save ).not.toHaveBeenCalled();

} );

it( 'builds native admin focus objects and trusted catalogue versions rather than portable array shapes', () => {

	const preset = structuredClone( prepared );
	preset.sceneDefinition.models = [ { asset: {}, nodes: [ { instanceId: 'led-root', gltfNodeIndex: null } ] } ];
	preset.snapshot.nodes[ 'led-root' ] = { transform: { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], visible: true }, humanPose: null };
	const document = createSeedAdminDocument( preset, { nodeObjects: new Map( [[ 'led-root', new Group() ]] ) }, { lights: [] }, [ { id: 'main-led-volume-wall-v1', assetVersion: 4 } ] );
	expect( document.scene.assets[ 0 ].assetVersion ).toBe( 4 );
	const expected = { x: preset.snapshot.camera.lens.afScreenPoint[ 0 ], y: preset.snapshot.camera.lens.afScreenPoint[ 1 ] };
	expect( document.cameras.active.effects.afScreenPoint ).toEqual( expected );
	expect( document.cameras.ui.afScreenPoint ).toEqual( expected );
	expect( document.render.ui.environmentMode ).toBe( 'hdri' );
	expect( document.render.ui.canvasWidth / document.render.ui.canvasHeight ).toBe( 16 / 9 );

} );
