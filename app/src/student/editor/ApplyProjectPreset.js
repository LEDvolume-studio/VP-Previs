import { assetVersionKey } from '../../previs/domain/StudentProjectSchema.js';
import { serializeStudentCatalogueContent } from '../../previs/domain/StudentCatalogueSchema.js';

const copy = value => structuredClone( value );
const incompatible = () => {

	throw new Error( 'This preset belongs to a different scene setup or requires objects outside the current project.' );

};

// Bridge legacy scene IDs through verified model bytes and glTF node indices.
// Names, URLs and portable instance IDs alone cannot establish object identity.
function nodeMapping( active, preset, assets, definition ) {

	const mapping = new Map();
	if ( active.baseScene.sceneId === preset.baseScene.sceneId && active.baseScene.version === preset.baseScene.version ) {

		for ( const id of Object.keys( preset.snapshot.nodes ) ) {

			const current = active.snapshot.nodes[ id ], incoming = preset.snapshot.nodes[ id ];
			if ( ! current || current.nodeId !== incoming.nodeId || assetVersionKey( current.asset ) !== assetVersionKey( incoming.asset ) ) incompatible();
			mapping.set( id, id );

		}

		return mapping;

	}

	if ( ! definition || ! preset.sceneDefinition || definition.models.length !== preset.sceneDefinition.models.length ) incompatible();
	const remaining = [ ...definition.models ];
	for ( const model of preset.sceneDefinition.models ) {

		const metadata = preset.assets[ assetVersionKey( model.asset ) ];
		const candidates = remaining.filter( current => {

			const existing = assets[ assetVersionKey( current.asset ) ];
			return metadata?.kind === 'model' && existing?.kind === 'model' && metadata.sha256 === existing.sha256 && metadata.byteLength === existing.byteLength;

		} );
		// Multiple instances of identical GLBs require an explicit shared scene identity.
		if ( candidates.length !== 1 ) incompatible();
		const target = candidates[ 0 ]; remaining.splice( remaining.indexOf( target ), 1 );
		for ( const node of model.nodes ) {

			const matches = target.nodes.filter( current => current.gltfNodeIndex === node.gltfNodeIndex );
			if ( matches.length !== 1 || ! active.snapshot.nodes[ matches[ 0 ].instanceId ] ) incompatible();
			mapping.set( node.instanceId, matches[ 0 ].instanceId );

		}

	}

	return mapping;

}

/** Copy only the selected wall media inventory; never replace model identities. */
export function mergePresetMediaAssets( assets, snapshot, presetAssets ) {

	const result = copy( assets );
	for ( const wall of snapshot.ledWalls ) {

		if ( ! wall.media ) continue;
		const key = assetVersionKey( wall.media );
		const incoming = presetAssets[ key ] || result[ key ];
		if ( ! incoming || incoming.kind !== 'video' ) throw new Error( 'The preset LED video metadata is missing.' );
		if ( result[ key ] && serializeStudentCatalogueContent( result[ key ] ) !== serializeStudentCatalogueContent( incoming ) ) throw new Error( 'Immutable preset video metadata conflicts with this project.' );
		result[ key ] = copy( incoming );

	}

	return result;

}

/** Apply placement in place, or include authored lights/media when creating a preset shot. */
export function applyProjectPresetSnapshot( active, preset, assets, definition = null, { placementOnly = false } = {} ) {

	const mapping = nodeMapping( active, preset, assets, definition );
	const snapshot = copy( active.snapshot );
	snapshot.camera = copy( preset.snapshot.camera );
	for ( const [ id, node ] of Object.entries( preset.snapshot.nodes ) ) {

		const current = snapshot.nodes[ mapping.get( id ) ];
		if ( ! current ) incompatible();
		current.transform = copy( node.transform );
		// Explicit door angles are positional state, applied by the runtime after TRS.
		current.doorAngles = copy( node.doorAngles );

	}

	// Applying a thumbnail moves existing objects. Importing preset light/video
	// inventories here would invalidate the prepared viewport and reload its GPU.
	if ( placementOnly ) return snapshot;

	// The preset owns the complete light inventory, including an empty one.
	// A changed inventory causes the viewport to rebuild with the correct lights.
	snapshot.lights = copy( preset.snapshot.lights );
	for ( const wall of preset.snapshot.ledWalls ) {

		const existing = snapshot.ledWalls.find( item => item.wallId === wall.wallId || wall.nodeInstanceId && item.nodeInstanceId === mapping.get( wall.nodeInstanceId ) );
		if ( ! existing ) incompatible();
		if ( existing.presentationVersion !== wall.presentationVersion ) incompatible();

		// Keep the current scene's mesh identity after verified legacy node mapping.
		const identity = { wallId: existing.wallId, ...( existing.nodeInstanceId ? { nodeInstanceId: existing.nodeInstanceId } : {} ) };
		Object.assign( existing, copy( wall ), identity );

	}

	return snapshot;

}
