import prepared from './studio-review.preset.json';
import environmentURL from './environment/aristea_wreck_puresky_1k.hdr?url';
import { adminEnvironmentAsset, applyAdminReviewAppearance } from './AdminAppearance.js';
import timecodeURL from './timecode.mp4?url';
import { StudentCatalogueClient } from '../../previs/api/StudentCatalogueClient.js';
import { createBundledStudentSceneManifest } from '../../previs/fixtures/BundledStudentScene.js';
import { assetVersionKey, baseSceneVersionKey, createStudentProjectDocument, validateStudentProjectDocument } from '../../previs/domain/StudentProjectSchema.js';
import { serializeStudentCatalogueContent, validateStudentPresetVersion } from '../../previs/domain/StudentCatalogueSchema.js';
import { createCameraShotEdit, createLEDShotEdit, createLightShotEdit, createNodeShotEdit } from '../../previs/domain/StudentShotEdits.js';

const clone = value => structuredClone( value );
const manifest = createBundledStudentSceneManifest( { models: [ 'studio', 'suv', 'mannequin', 'led' ] } );
const mediaKey = 'fixture-timecode@generated-1';

/** Exact local fixture identity; a similarly named imported scene gains no authority. */
export function isStudentDemoScene( reference ) {

	return reference?.sceneId === manifest.baseScene.sceneId && reference?.version === manifest.baseScene.version;

}

function validatePreparedFixture() {

	validateStudentPresetVersion( prepared );
	if ( serializeStudentCatalogueContent( prepared.sceneDefinition.baseScene ) !== serializeStudentCatalogueContent( manifest.baseScene ) ) throw new Error( 'The local review scene no longer matches its verified fixture.' );
	const expected = manifest.models.map( ( { asset, nodes } ) => ( { asset, nodes } ) );
	if ( serializeStudentCatalogueContent( prepared.sceneDefinition.models ) !== serializeStudentCatalogueContent( expected ) ) throw new Error( 'The local review node mappings no longer match the bundled models.' );
	for ( const [ key, asset ] of Object.entries( manifest.assets ) ) {

		if ( serializeStudentCatalogueContent( prepared.assets[ key ] ) !== serializeStudentCatalogueContent( asset ) ) throw new Error( 'The local review model metadata has changed.' );

	}

}

/** Development-only catalogue adapter. No teacher endpoint, credential or GPU is used.
 * The normal catalogue client still enforces byte count, MIME, hash and cancellation.
 */
export function createStudentDemoCatalogue( { fetch = ( ...args ) => globalThis.fetch( ...args ), origin = globalThis.location?.origin || 'http://localhost' } = {} ) {

	validatePreparedFixture();
	const routes = new Map( manifest.models.map( model => [ `/v1/catalogue/assets/${model.asset.assetId}/${model.asset.version}`, model.source ] ) );
	routes.set( '/v1/catalogue/assets/fixture-timecode/generated-1', timecodeURL );
	routes.set( `/v1/catalogue/assets/${adminEnvironmentAsset.assetId}/${adminEnvironmentAsset.version}`, environmentURL );
	const sceneRoute = `/v1/catalogue/scenes/${manifest.baseScene.sceneId}/${manifest.baseScene.version}`;
	const client = new StudentCatalogueClient( {
		baseURL: origin, origin,
		fetch: async ( input, options ) => {

			options.signal?.throwIfAborted();
			const request = new URL( input );
			if ( request.origin !== new URL( origin ).origin || request.search || request.hash ) throw new Error( 'Unknown local review route.' );
			if ( request.pathname === sceneRoute ) return Response.json( { sceneDefinition: clone( prepared.sceneDefinition ), assets: clone( manifest.assets ) } );
			const source = routes.get( request.pathname );
			if ( ! source ) throw new Error( 'Unknown local review asset.' );
			const response = await fetch( source, options );
			if ( source !== environmentURL || ! response.ok ) return response;
			return new Response( response.body, { status: response.status, headers: { 'Content-Type': adminEnvironmentAsset.mimeType, 'Content-Length': String( adminEnvironmentAsset.byteLength ) } } );

		},
	} );
	return {
		async getScene( reference, options ) {

			if ( ! isStudentDemoScene( reference ) ) throw new Error( 'This is not the bundled local review scene.' );
			return client.getScene( reference, options );

		},
		async getAssetBytes( asset, options ) {

			const expected = assetVersionKey( asset || {} ) === assetVersionKey( adminEnvironmentAsset ) ? adminEnvironmentAsset : prepared.assets[ assetVersionKey( asset || {} ) ];
			if ( ! expected || serializeStudentCatalogueContent( asset ) !== serializeStudentCatalogueContent( expected ) ) throw new Error( 'Unknown or modified local review asset metadata.' );
			return client.getAssetBytes( clone( expected ), options );

		},
	};

}

/** Fresh editable local sequence; snapshots are detached from the source preset. */
export async function createStudentDemoProject( { signal, matchAdmin = false, ...catalogueOptions } = {} ) {

	signal?.throwIfAborted();
	const catalogue = createStudentDemoCatalogue( catalogueOptions );
	// The small generated clip is stable across reloads; verify its exact bundled
	// bytes before saving the document. Model verification happens in the viewer.
	await catalogue.getAssetBytes( prepared.assets[ mediaKey ], { signal } );
	signal?.throwIfAborted();
	const document = createStudentProjectDocument( { name: 'Local studio progress review' } );
	document.assets = clone( prepared.assets );
	document.baseScenes = { [ baseSceneVersionKey( prepared.baseScene ) ]: clone( prepared.baseScene ) };
	const wide = {
		shotId: 'wide', name: 'Wide — standing / frozen LED',
		baseScene: { sceneId: prepared.baseScene.sceneId, version: prepared.baseScene.version },
		sourcePreset: null, snapshot: clone( prepared.snapshot ),
	};
	let close = clone( wide );
	close.shotId = 'close';
	close.name = 'Reverse — sitting / playing LED';
	close = createCameraShotEdit( close, { position: [ - 5, 2.6, 6.5 ], target: [ 0, 1.3, 0 ], fov: 48, exposure: 0.35, frameOverlayRatio: '2.40:1' } );
	close = createNodeShotEdit( close, { instanceId: 'mannequin-root', position: [ - 2.7, 0, 0 ], humanPose: 'sitting' } );
	close = createLightShotEdit( close, { lightId: 'key', intensity: 6500 } );
	close = createLEDShotEdit( close, { wallId: 'main-wall', mode: 'play', inPointFrames: 12, loop: true, brightnessNits: 200 } );
	document.shots = { wide, close };
	document.clips = [ { clipId: 'wide', shotId: 'wide', durationFrames: 125 }, { clipId: 'close', shotId: 'close', durationFrames: 125 } ];
	validateStudentProjectDocument( document );
	for ( const shot of Object.values( document.shots ) ) validateStudentPresetVersion( { ...clone( prepared ), snapshot: shot.snapshot } );
	return { document: matchAdmin ? applyAdminReviewAppearance( document ) : document, catalogue };

}

/** Upgrade a demo as an independent project; retain the original saved work. */
export function copyDemoWithAdminAppearance( input ) {

	const document = applyAdminReviewAppearance( input );
	document.projectId = crypto.randomUUID(); document.revision = 0;
	document.name = `${input.name} · admin appearance`;
	document.createdAt = document.updatedAt = new Date().toISOString();
	validateStudentProjectDocument( document );
	return document;

}
