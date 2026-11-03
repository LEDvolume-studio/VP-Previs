import { describe, expect, it } from 'vitest';
import {
	PROJECT_FORMAT,
	PROJECT_SCHEMA_VERSION,
	createProjectDocument,
	importProjectDocument,
	migrateProjectDocument,
	prepareProjectExport,
	validateProjectDocument,
} from '../../../app/src/services/projects/ProjectSchema';
import {
	captureNodeTransform,
	createDefaultReplacement,
	hasChangedKeys,
	nextWorkingProjectName,
	restoreNodeTransform,
} from '../../../app/src/services/projects/projectStateUtils';

describe( 'ProjectSchema', () => {

	it( 'declares metres in portable projects and backfills legacy units without rescaling nodes', () => {

		const project = createProjectDocument();
		expect( project.scene.units ).toEqual( { length: 'metre', metresPerUnit: 1 } );
		project.scene.nodes.example = { position: [ 3, 4, 5 ], scale: [ 2, 2, 2 ] };
		delete project.scene.units;
		const migrated = migrateProjectDocument( project );
		expect( migrated.scene.units ).toEqual( { length: 'metre', metresPerUnit: 1 } );
		expect( migrated.scene.nodes ).toEqual( project.scene.nodes );
		expect( prepareProjectExport( migrated ).scene.units ).toEqual( migrated.scene.units );
		migrated.scene.units.metresPerUnit = 0.01;
		expect( () => migrateProjectDocument( migrated ) ).toThrow( 'Unsupported world units' );

	} );

	it( 'increments silent working-copy names without reusing earlier numbers', () => {

		expect( nextWorkingProjectName( [] ) ).toBe( 'New Project 01' );
		expect( nextWorkingProjectName( [
			{ name: 'New Project 01' },
			{ name: 'Renamed Project', extensions: { workingCopyNumber: 7 } },
			{ name: 'New Project 09' },
		] ) ).toBe( 'New Project 10' );

	} );

	it( 'promotes authored state while preserving default identity', () => {

		const existing = createProjectDocument( { name: 'Welcome Project' } );
		existing.revision = 6;
		const working = createProjectDocument( { name: 'Lighting Study' } );
		working.scene.lights.push( { type: 'PointLight' } );
		working.extensions.workingCopyNumber = 3;
		working.lastOpenedAt = 'temporary';
		working.importedFromProjectId = 'portable-source';
		const replacement = createDefaultReplacement( working, existing, '2026-09-08T04:00:00.000Z' );

		expect( replacement ).toMatchObject( {
			projectId: existing.projectId,
			name: 'Welcome Project',
			createdAt: existing.createdAt,
			updatedAt: '2026-09-08T04:00:00.000Z',
			revision: 7,
			extensions: {},
		} );
		expect( replacement.scene.lights ).toEqual( [ { type: 'PointLight' } ] );
		expect( replacement.lastOpenedAt ).toBeUndefined();
		expect( replacement.importedFromProjectId ).toBeUndefined();

	} );

	it( 'detects changes from both array and Set key collections', () => {

		const previous = { samples: 10, mode: 'preview' };
		expect( hasChangedKeys( { ...previous, samples: 11 }, previous, new Set( [ 'samples' ] ) ) ).toBe( true );
		expect( hasChangedKeys( { ...previous }, previous, [ 'mode' ] ) ).toBe( false );

	} );

	it( 'round-trips authored position, rotation, scale, and visibility', () => {

		const vector = values => ( {
			values: [ ...values ],
			toArray() {

				return [ ...this.values ];

			},
			fromArray( next ) {

				this.values = [ ...next ];

			},
		} );
		const source = { name: 'Wall', position: vector( [ 1, 2, 3 ] ), quaternion: vector( [ 0.1, 0.2, 0.3, 0.9 ] ), scale: vector( [ 2, 3, 4 ] ), visible: false };
		const target = { name: '', position: vector( [ 0, 0, 0 ] ), quaternion: vector( [ 0, 0, 0, 1 ] ), scale: vector( [ 1, 1, 1 ] ), visible: true };
		restoreNodeTransform( target, captureNodeTransform( source ) );
		expect( captureNodeTransform( target ) ).toEqual( captureNodeTransform( source ) );

	} );

	it( 'creates a versioned JSON-safe project with stable instance references', () => {

		const project = createProjectDocument( { name: 'Studio', primaryCatalogId: 'model-camera' } );
		expect( project.format ).toBe( PROJECT_FORMAT );
		expect( project.schemaVersion ).toBe( PROJECT_SCHEMA_VERSION );
		expect( project.scene.assets[ 0 ] ).toMatchObject( { catalogId: 'model-camera', role: 'primary' } );
		expect( project.scene.assets[ 0 ].instanceId ).toEqual( expect.any( String ) );
		expect( () => JSON.stringify( project ) ).not.toThrow();
		expect( validateProjectDocument( project ) ).toBe( true );

	} );

	it( 'rejects newer schemas without mutating the source document', () => {

		const project = createProjectDocument();
		const future = { ...project, schemaVersion: PROJECT_SCHEMA_VERSION + 1 };
		expect( () => migrateProjectDocument( future ) ).toThrow( /newer Rayzee version/ );
		expect( future.schemaVersion ).toBe( PROJECT_SCHEMA_VERSION + 1 );

	} );

	it( 'backfills editor view state in existing version-1 projects', () => {

		const legacy = createProjectDocument();
		delete legacy.workspace.editorView;
		const migrated = migrateProjectDocument( legacy );

		expect( migrated.workspace.editorView ).toEqual( {
			mode: 'perspective',
			style: 'solid',
			gridVisible: true,
			views: {},
		} );
		expect( legacy.workspace.editorView ).toBeUndefined();

	} );

	it( 'repairs unsupported persisted editor view values', () => {

		const project = createProjectDocument();
		project.workspace.editorView = { mode: 'right', style: 'lit', views: null };
		const migrated = migrateProjectDocument( project );

		expect( migrated.workspace.editorView ).toEqual( {
			mode: 'perspective',
			style: 'solid',
			gridVisible: true,
			views: {},
		} );

	} );

	it( 'rejects duplicate scene instance identities', () => {

		const project = createProjectDocument( { primaryCatalogId: 'model-camera' } );
		project.scene.assets.push( { ...project.scene.assets[ 0 ], role: 'appended' } );
		expect( () => validateProjectDocument( project ) ).toThrow( /Duplicate project asset ID/ );

	} );

	it( 'omits handles and native paths from exported video references', () => {

		const project = createProjectDocument();
		project.led.push( { wallInstanceId: 'wall-1', video: { assetId: 'video-1', name: 'wall.mp4', handle: { native: true }, path: '/private/wall.mp4' } } );
		const exported = prepareProjectExport( project );
		expect( exported.led[ 0 ].video ).toEqual( { assetId: 'video-1', name: 'wall.mp4' } );
		expect( project.led[ 0 ].video.path ).toBe( '/private/wall.mp4' );

	} );

	it( 'imports as a distinct local project and preserves authored data', () => {

		const project = createProjectDocument( { name: 'Portable' } );
		project.workspace.viewport = { mode: 'manual', scale: 137 };
		const imported = importProjectDocument( project );
		expect( imported.projectId ).not.toBe( project.projectId );
		expect( imported.importedFromProjectId ).toBe( project.projectId );
		expect( imported.workspace.viewport ).toEqual( { mode: 'manual', scale: 137 } );
		expect( imported.revision ).toBe( 0 );

	} );

} );
