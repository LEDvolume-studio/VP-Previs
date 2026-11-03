import { describe, expect, it } from 'vitest';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { createCatalogueSummary, serializeStudentCatalogueContent, validateStudentCatalogue, validateStudentLibraryAsset, validateStudentPresetVersion } from '../../../app/src/previs/domain/StudentCatalogueSchema.js';
import { applyStudentCommand } from '../../../app/src/previs/domain/StudentCommands.js';
import { studentFixture, TEST_NOW } from './studentFixtures.js';

function presetFixture() {

	const document = studentFixture();
	return { format: 'rayzee-student-preset', schemaVersion: 1, presetId: 'wide', version: '1', name: 'Wide', description: '', category: 'Studio', defaultDurationFrames: 125, thumbnail: null, assets: document.assets, baseScene: document.baseScenes[ 'studio@1' ], snapshot: document.shots.shotA.snapshot };

}

const empty = () => createStudentProjectDocument( { projectId: 'local', now: TEST_NOW } );
const copy = preset => ( { type: 'addPresetShot', preset, shotId: 'copy', clipId: 'placement' } );

describe( 'Immutable portable teacher preset contracts', () => {

	it( 'validates a complete detached preset and a list with only public summary metadata', () => {

		const preset = presetFixture();
		expect( validateStudentPresetVersion( preset ) ).toBe( preset );
		const summary = createCatalogueSummary( preset );
		expect( summary ).not.toHaveProperty( 'snapshot' );
		expect( validateStudentCatalogue( { format: 'rayzee-student-catalogue', schemaVersion: 1, presets: [ summary ] } ).presets ).toEqual( [ summary ] );
		summary.name = 'Local change';
		expect( preset.name ).toBe( 'Wide' );

	} );

	it.each( [
		preset => {

			preset.url = 'https://untrusted.invalid/file';

		},
		preset => {

			preset.schemaVersion = 2;

		},
		preset => {

			preset.presetId = '../preset';

		},
		preset => {

			preset.defaultDurationFrames = 22501;

		},
		preset => {

			preset.defaultDurationFrames = 1.5;

		},
		preset => {

			preset.category = '';

		},
		preset => {

			preset.snapshot.camera.exposure = NaN;

		},
		preset => {

			delete preset.assets[ 'video@1' ];

		},
		preset => {

			preset.baseScene.assets = [];

		},
		preset => {

			preset.assets[ 'car@1' ].sha256 = 'fake';

		},
		preset => {

			preset.assets[ 'car@1' ].mimeType = 'text/html';

		},
		preset => {

			preset.thumbnail = { assetId: 'video', version: '1' };

		},
		preset => {

			preset.thumbnail = { assetId: 'poster', version: '1', url: '/poster.png' };

		},
	] )( 'rejects unsupported, incomplete or unsafe preset content %s', mutate => {

		const preset = presetFixture(); mutate( preset );
		expect( () => validateStudentPresetVersion( preset ) ).toThrow();

	} );

	it( 'validates the thumbnail only through an immutable image reference', () => {

		const preset = presetFixture();
		preset.assets[ 'poster@1' ] = { assetId: 'poster', version: '1', kind: 'image', sha256: 'c'.repeat( 64 ), byteLength: 500, mimeType: 'image/png', durationUs: null };
		preset.thumbnail = { assetId: 'poster', version: '1' };
		expect( validateStudentLibraryAsset( preset.assets[ 'poster@1' ] ) ).toBe( preset.assets[ 'poster@1' ] );
		expect( validateStudentPresetVersion( preset ) ).toBe( preset );

	} );

	it( 'rejects duplicate available choices and summary-only unknown fields', () => {

		const summary = createCatalogueSummary( presetFixture() );
		const catalogue = { format: 'rayzee-student-catalogue', schemaVersion: 1, presets: [ summary, { ...summary, version: '2' } ] };
		expect( () => validateStudentCatalogue( catalogue ) ).toThrow( /Duplicate/ );
		catalogue.presets = [ { ...summary, editSecret: 'never portable' } ];
		expect( () => validateStudentCatalogue( catalogue ) ).toThrow();

	} );

	it( 'canonical equality ignores object order but retains array order', () => {

		expect( serializeStudentCatalogueContent( { b: [ 1, 2 ], a: { c: 1, b: 2 } } ) ).toBe( serializeStudentCatalogueContent( { a: { b: 2, c: 1 }, b: [ 1, 2 ] } ) );
		expect( serializeStudentCatalogueContent( [ 1, 2 ] ) ).not.toBe( serializeStudentCatalogueContent( [ 2, 1 ] ) );

	} );

} );

describe( 'Atomic saved preset copying', () => {

	it( 'adds the independent shot, placement and dependencies in one revision and undoes everything together', () => {

		const preset = presetFixture(), before = empty();
		const result = applyStudentCommand( before, copy( preset ), { now: TEST_NOW } );
		expect( result.document.revision ).toBe( 1 );
		expect( result.document.clips ).toEqual( [ { clipId: 'placement', shotId: 'copy', durationFrames: 125 } ] );
		expect( result.document.shots.copy.sourcePreset ).toEqual( { presetId: 'wide', version: '1' } );
		expect( result.document.shots.copy.baseScene ).toEqual( { sceneId: 'studio', version: '1' } );
		preset.snapshot.camera.exposure = 3;
		expect( result.document.shots.copy.snapshot.camera.exposure ).toBe( 1 );
		expect( Object.keys( before.shots ) ).toHaveLength( 0 );
		const undone = applyStudentCommand( result.document, result.inverse, { now: TEST_NOW } );
		expect( undone.document.revision ).toBe( 2 );
		expect( undone.document.assets ).toEqual( {} );
		expect( undone.document.baseScenes ).toEqual( {} );
		expect( undone.document.clips ).toEqual( [] );
		expect( undone.document.shots ).toEqual( {} );

	} );

	it( 'accepts matching pinned dependencies but refuses silently replaced asset and scene versions', () => {

		const preset = presetFixture();
		const first = applyStudentCommand( empty(), copy( preset ) ).document;
		expect( () => applyStudentCommand( first, { ...copy( preset ), shotId: 'second', clipId: 'second-placement' } ) ).not.toThrow();
		const changed = structuredClone( preset ); changed.assets[ 'car@1' ].sha256 = 'c'.repeat( 64 );
		expect( () => applyStudentCommand( first, { ...copy( changed ), shotId: 'second', clipId: 'second-placement' } ) ).toThrow( /Immutable/ );
		const sceneChanged = structuredClone( preset ); sceneChanged.baseScene.assets.push( { assetId: 'video', version: '1' } );
		expect( () => applyStudentCommand( first, { ...copy( sceneChanged ), shotId: 'second', clipId: 'second-placement' } ) ).toThrow( /Immutable/ );
		expect( first.assets[ 'car@1' ].sha256 ).toBe( preset.assets[ 'car@1' ].sha256 );

	} );

	it( 'rejects duplicate placement identities and duration overflow without mutating the original', () => {

		const preset = presetFixture(); preset.defaultDurationFrames = 22500;
		const first = applyStudentCommand( empty(), copy( preset ) ).document;
		const frozen = structuredClone( first );
		expect( () => applyStudentCommand( first, { ...copy( preset ), shotId: 'second' } ) ).toThrow( /duplicate clip/i );
		expect( () => applyStudentCommand( first, { ...copy( preset ), shotId: 'second', clipId: 'second' } ) ).toThrow( /exceeds/ );
		expect( first ).toEqual( frozen );

	} );

} );
