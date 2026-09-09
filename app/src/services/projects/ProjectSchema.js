export const PROJECT_FORMAT = 'rayzee-project';
export const PROJECT_SCHEMA_VERSION = 1;
export const PROJECT_FILE_EXTENSION = '.rayzee';
export const PROJECT_MIME_TYPE = 'application/vnd.rayzee.project+json';

const clone = value => typeof structuredClone === 'function'
	? structuredClone( value )
	: JSON.parse( JSON.stringify( value ) );

export function createProjectId() {

	return globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}`;

}

export function createAssetId() {

	return globalThis.crypto?.randomUUID?.() || `asset-${Date.now()}-${Math.random().toString( 36 ).slice( 2 )}`;

}

export function createProjectDocument( {
	name = 'Untitled Project',
	projectId = createProjectId(),
	primaryCatalogId = null,
	environmentId = 'aristea_wreck_puresky',
} = {} ) {

	const now = new Date().toISOString();
	return {
		format: PROJECT_FORMAT,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		projectId,
		name,
		createdAt: now,
		updatedAt: now,
		revision: 0,
		scene: {
			assets: primaryCatalogId ? [ {
				instanceId: createAssetId(),
				catalogId: primaryCatalogId,
				role: 'primary',
				assetVersion: 1,
			} ] : [],
			nodes: {},
			materials: {},
			lights: [],
			environment: { catalogId: environmentId },
		},
		render: {},
		cameras: null,
		led: [],
		animation: { selectedClip: 0, speed: 1, loop: true, loopCount: 1 },
		workspace: {
			panelLayout: [ 20, 60, 20 ],
			appMode: 'preview',
			activeTab: 'pathtracer',
			viewport: { mode: 'auto', scale: 100 },
			selectedEntity: null,
		},
		extensions: {},
	};

}

const MIGRATIONS = new Map();

export function registerProjectMigration( fromVersion, migrate ) {

	if ( ! Number.isInteger( fromVersion ) || fromVersion < 1 || typeof migrate !== 'function' ) throw new Error( 'Invalid project migration.' );
	MIGRATIONS.set( fromVersion, migrate );

}

export function migrateProjectDocument( input ) {

	if ( ! input || typeof input !== 'object' ) throw new Error( 'The selected file is not a Rayzee project.' );
	if ( input.format !== PROJECT_FORMAT ) throw new Error( 'The selected file is not a Rayzee project.' );
	if ( ! Number.isInteger( input.schemaVersion ) || input.schemaVersion < 1 ) throw new Error( 'The project schema version is invalid.' );
	if ( input.schemaVersion > PROJECT_SCHEMA_VERSION ) {

		throw new Error( `This project requires a newer Rayzee version (schema ${input.schemaVersion}).` );

	}

	let document = clone( input );
	while ( document.schemaVersion < PROJECT_SCHEMA_VERSION ) {

		const migrate = MIGRATIONS.get( document.schemaVersion );
		if ( ! migrate ) throw new Error( `No migration is available for project schema ${document.schemaVersion}.` );
		document = migrate( document );

	}

	validateProjectDocument( document );
	return document;

}

export function validateProjectDocument( document ) {

	if ( document?.format !== PROJECT_FORMAT ) throw new Error( 'Invalid Rayzee project format.' );
	if ( document.schemaVersion !== PROJECT_SCHEMA_VERSION ) throw new Error( 'Unsupported Rayzee project schema.' );
	if ( typeof document.projectId !== 'string' || ! document.projectId ) throw new Error( 'Project ID is missing.' );
	if ( typeof document.name !== 'string' || ! document.name.trim() ) throw new Error( 'Project name is missing.' );
	if ( ! document.scene || ! Array.isArray( document.scene.assets ) ) throw new Error( 'Project scene data is invalid.' );
	if ( ! Array.isArray( document.led ) ) throw new Error( 'Project LED data is invalid.' );
	const instanceIds = new Set();
	for ( const asset of document.scene.assets ) {

		if ( typeof asset.instanceId !== 'string' || ! asset.instanceId || typeof asset.catalogId !== 'string' || ! asset.catalogId ) throw new Error( 'Project asset identity is invalid.' );
		if ( instanceIds.has( asset.instanceId ) ) throw new Error( `Duplicate project asset ID: ${asset.instanceId}` );
		instanceIds.add( asset.instanceId );

	}

	return true;

}

export function prepareProjectExport( document ) {

	const exported = migrateProjectDocument( document );
	delete exported.lastOpenedAt;
	exported.exportedAt = new Date().toISOString();
	// FileSystemHandles live only in the repository's handle store. Defensively
	// remove any accidental implementation detail before JSON serialization.
	for ( const led of exported.led ) {

		if ( led.video ) {

			delete led.video.handle;
			delete led.video.path;

		}

	}

	return exported;

}

export function importProjectDocument( input ) {

	const imported = migrateProjectDocument( input );
	const now = new Date().toISOString();
	return {
		...imported,
		projectId: createProjectId(),
		name: imported.name,
		createdAt: now,
		updatedAt: now,
		revision: 0,
		importedFromProjectId: imported.projectId,
	};

}
