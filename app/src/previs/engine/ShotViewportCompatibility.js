import { assetVersionKey, baseSceneVersionKey, validateStudentProjectDocument } from '../domain/StudentProjectSchema.js';
import { serializeStudentCatalogueContent } from '../domain/StudentCatalogueSchema.js';
import { validateSupportedPresetScene } from '../domain/StudentSceneDefinition.js';

/** Check one saved shot against a trusted, already prepared immutable scene. */
export function validateViewportShot( document, shotId, sceneDefinition ) {

	validateStudentProjectDocument( document );
	const shot = document.shots[ shotId ];
	if ( ! shot ) throw new Error( 'Choose a saved shot to preview.' );
	const baseScene = document.baseScenes[ baseSceneVersionKey( shot.baseScene ) ];
	validateSupportedPresetScene( { assets: document.assets, baseScene, snapshot: shot.snapshot, sceneDefinition } );
	return shot;

}

/**
 * A capability closure, independent of GPU state. Only loaded asset versions are
 * pinned: unrelated shots/assets and descriptive metadata can change freely.
 * Concrete runtime ports additionally check their native mesh/decoder support.
 */
export function createShotViewportCompatibility( { document, shotId, sceneDefinition, lightInventory = null } ) {

	const definition = structuredClone( sceneDefinition );
	const initial = validateViewportShot( document, shotId, definition );
	const preparedLights = lightInventory && new Map( lightInventory.map( light => [ light.lightId, light.type ] ) );
	const baseScene = serializeStudentCatalogueContent( document.baseScenes[ baseSceneVersionKey( initial.baseScene ) ] );
	const inventory = snapshot => serializeStudentCatalogueContent( {
		lights: preparedLights ? null : snapshot.lights.map( ( { lightId, type } ) => ( { lightId, type } ) ).sort( ( a, b ) => a.lightId.localeCompare( b.lightId ) ),
		materials: Object.entries( snapshot.materials || {} ).map( ( [ id, entries ] ) => [ id, entries.map( entry => ( { path: entry.path, slot: entry.slot, type: entry.state.type } ) ) ] ),
		walls: snapshot.ledWalls.map( ( { wallId, nodeInstanceId } ) => ( { wallId, nodeInstanceId } ) ).sort( ( a, b ) => a.wallId.localeCompare( b.wallId ) ),
	} );
	const preparedInventory = inventory( initial.snapshot );
	const prepared = new Map( [
		...definition.baseScene.assets,
		...initial.snapshot.ledWalls.map( wall => wall.media ).filter( Boolean ),
		...[ initial.snapshot.environment.asset ].filter( Boolean ),
	].map( reference => {

		const key = assetVersionKey( reference );
		return [ key, serializeStudentCatalogueContent( document.assets[ key ] ) ];

	} ) );
	const check = ( candidate, selectedShotId, allowNewMedia = false ) => {

		try {

			const shot = validateViewportShot( candidate, selectedShotId, definition );
			if ( preparedLights && shot.snapshot.lights.some( light => preparedLights.get( light.lightId ) !== light.type ) ) return false;
			if ( serializeStudentCatalogueContent( candidate.baseScenes[ baseSceneVersionKey( shot.baseScene ) ] ) !== baseScene || inventory( shot.snapshot ) !== preparedInventory ) return false;
			const media = new Set( shot.snapshot.ledWalls.filter( wall => wall.media ).map( wall => assetVersionKey( wall.media ) ) );
			const references = [ ...definition.baseScene.assets, ...shot.snapshot.ledWalls.map( wall => wall.media ).filter( Boolean ), ...[ shot.snapshot.environment.asset ].filter( Boolean ) ];
			return references.every( reference => {

				const key = assetVersionKey( reference );
				return ! prepared.has( key ) ? allowNewMedia && media.has( key ) : prepared.get( key ) === serializeStudentCatalogueContent( candidate.assets[ key ] );

			} );

		} catch {

			return false;

		}

	};

	const compatible = ( ...args ) => check( ...args );
	compatible.canPrepare = ( candidate, selectedShotId ) => check( candidate, selectedShotId, true );

	// Host calls this only after verifying bytes and opening the owned decoder.
	compatible.registerPreparedAsset = asset => {

		const key = assetVersionKey( asset ), serialized = serializeStudentCatalogueContent( asset );
		if ( prepared.has( key ) && prepared.get( key ) !== serialized ) throw new Error( 'Prepared immutable asset metadata changed.' );
		prepared.set( key, serialized );

	};

	return compatible;

}
