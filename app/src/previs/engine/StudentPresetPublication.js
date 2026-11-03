import { STUDENT_PRESET_FORMAT, validateStudentPresetVersion } from '../domain/StudentCatalogueSchema.js';
import { validateStudentSceneDefinition } from '../domain/StudentSceneDefinition.js';
import { assetVersionKey, baseSceneVersionKey } from '../domain/StudentProjectSchema.js';
import { capturePreparedAdminScene, convertAdminProjectToStudentPreset, prepareStudentSceneConversion } from './AdminPresetConverter.js';
import { validatePresetModelBytes } from './SupportedGLB.js';

const metadataFields = [ 'presetId', 'version', 'name', 'description', 'category', 'defaultDurationFrames', 'thumbnail' ];
const clone = value => structuredClone( value );
const failure = ( code, path, message ) => ( { ok: false, preset: null, diagnostics: [ { severity: 'error', code, path, message } ] } );

/** Read-only publication preparation. The host suspends admin edits/transport;
 * this service never controls, writes to or publishes the shared admin scene.
 * Every call owns detached metadata, loads each asset once and retains no asset
 * bytes. A successful result remains a local preflight, not server authority.
 */
export async function prepareStudentPresetPublication( { source, mapping, sceneDefinition, assets, ports, metadata, loadAssetBytes, signal } = {} ) {

	let input, binding, sourceProjectId, sourceRevision;
	const current = () => {

		if ( signal?.aborted ) return failure( 'CANCELLED', 'publication', 'Publication preparation was cancelled.' );
		try {

			if ( source.projectId === sourceProjectId && source.revision === sourceRevision && ports.scene.getBindings() === binding && binding.ready ) return null;

		} catch { /* A disconnected live port is also a stale capture. */ }

		return failure( 'STALE_CAPTURE', 'source', 'The admin revision or prepared scene changed during publication preparation.' );

	};

	if ( signal?.aborted ) return failure( 'CANCELLED', 'publication', 'Publication preparation was cancelled.' );
	try {

		if ( ! metadata || Object.keys( metadata ).length !== metadataFields.length || ! metadataFields.every( key => Object.hasOwn( metadata, key ) ) || typeof loadAssetBytes !== 'function' ) throw new Error();
		input = clone( { source, mapping, sceneDefinition, assets, metadata } );
		if ( ! Number.isSafeInteger( source.revision ) || source.revision < 0 ) throw new Error();
		validateStudentSceneDefinition( input.sceneDefinition, input.assets );
		binding = ports.scene.getBindings();
		if ( ! binding?.ready ) throw new Error();
		sourceProjectId = source.projectId;
		sourceRevision = source.revision;

	} catch {

		return failure( 'INVALID_PUBLICATION_INPUT', 'publication', 'Complete immutable metadata, a supported scene definition and ready capture ports are required.' );

	}

	let preparedScene;
	try {

		preparedScene = await prepareStudentSceneConversion( { assets: input.assets, baseScene: input.sceneDefinition.baseScene }, async asset => {

			if ( current() ) throw new Error();
			const bytes = await loadAssetBytes( asset, { signal } );
			if ( current() ) throw new Error();
			const model = input.sceneDefinition.models.find( item => assetVersionKey( item.asset ) === assetVersionKey( asset ) );
			if ( model ) {

				// Verify before inspecting the GLB. The converter independently
				// verifies the same bytes before issuing its private integrity token.
				const view = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array( bytes ) : null;
				if ( ! view || view.byteLength !== asset.byteLength ) throw new Error();
				const digest = new Uint8Array( await globalThis.crypto.subtle.digest( 'SHA-256', view ) );
				if ( Array.from( digest, value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' ) !== asset.sha256 ) throw new Error();
				// Validate explicit display mappings now. The full converter later
				// requires every captured wall/node/surface to equal these mappings.
				// This avoids retaining model bytes while the live capture awaits.
				validatePresetModelBytes( { sceneDefinition: input.sceneDefinition, snapshot: { ledWalls: Object.values( input.mapping?.ledWalls || {} ) } }, model, view );

			}

			return bytes;

		} );

	} catch {

		return current() || failure( 'ASSET_VERIFICATION_FAILED', 'assets', 'Immutable asset bytes or their supported model mappings could not be verified.' );

	}

	if ( current() ) return current();
	let capture;
	try {

		capture = await capturePreparedAdminScene( { source, ports } );

	} catch {

		return current() || failure( 'CAPTURE_FAILED', 'capture', 'Complete live admin state could not be captured without changing its revision.' );

	}

	if ( current() ) return current();
	// The authoritative converter inspects the entire saved admin document. A
	// visually plausible live capture cannot bypass unsupported authored fields.
	let converted;
	try {

		converted = convertAdminProjectToStudentPreset( {
			source: input.source, mapping: input.mapping, preparedScene, capture,
			preset: input.metadata, projectId: 'preset-publication-validation', shotId: 'published-shot', now: '2026-10-23T00:00:00.000Z',
		} );

	} catch {

		return failure( 'CONVERSION_FAILED', 'source', 'The saved admin document or its explicit mappings could not be converted.' );

	}

	if ( ! converted.ok ) return { ok: false, preset: null, diagnostics: clone( converted.diagnostics ) };
	try {

		const document = converted.document;
		const preset = {
			format: STUDENT_PRESET_FORMAT, schemaVersion: 2, ...input.metadata,
			assets: document.assets, baseScene: document.baseScenes[ baseSceneVersionKey( input.sceneDefinition.baseScene ) ],
			snapshot: document.shots[ 'published-shot' ].snapshot, sceneDefinition: input.sceneDefinition,
		};
		validateStudentPresetVersion( preset );
		return { ok: true, preset: clone( preset ), diagnostics: clone( converted.diagnostics ) };

	} catch {

		const result = failure( 'UNSUPPORTED_PRESET_SCENE', 'preset', 'Converted content does not match the supported immutable scene and publication metadata.' );
		result.diagnostics.unshift( ...clone( converted.diagnostics ) );
		return result;

	}

}
