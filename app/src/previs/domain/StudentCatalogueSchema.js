import { validateSupportedPresetScene } from './StudentSceneDefinition.js';
import { assetVersionKey, baseSceneVersionKey, createStudentProjectDocument, MAX_SEQUENCE_FRAMES, validateStudentProjectDocument } from './StudentProjectSchema.js';

export const STUDENT_PRESET_FORMAT = 'rayzee-student-preset';
export const STUDENT_CATALOGUE_FORMAT = 'rayzee-student-catalogue';
const summaryFields = [ 'presetId', 'version', 'name', 'description', 'category', 'defaultDurationFrames', 'thumbnail' ];
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const fail = message => {

	throw new Error( `Student catalogue: ${message}` );

};

const shape = ( value, fields ) => {

	if ( ! value || ! [ Object.prototype, null ].includes( Object.getPrototypeOf( value ) ) || Object.keys( value ).length !== fields.length || ! fields.every( field => Object.hasOwn( value, field ) ) ) fail( 'Unexpected record fields.' );

};

const text = ( value, maximum, empty = false ) => {

	if ( typeof value !== 'string' || value.length > maximum || ( ! empty && ! value.trim() ) ) fail( 'Invalid descriptive text.' );

};

export const validateCatalogueId = value => {

	if ( typeof value !== 'string' || ! idPattern.test( value ) ) fail( 'Invalid immutable identifier.' );
	return value;

};

const reference = value => {

	shape( value, [ 'assetId', 'version' ] );
	validateCatalogueId( value.assetId ); validateCatalogueId( value.version );

};

function summary( value ) {

	validateCatalogueId( value.presetId ); validateCatalogueId( value.version );
	text( value.name, 1024 ); text( value.description, 4096, true ); text( value.category, 128 );
	if ( ! Number.isSafeInteger( value.defaultDurationFrames ) || value.defaultDurationFrames < 1 || value.defaultDurationFrames > MAX_SEQUENCE_FRAMES ) fail( 'Invalid default duration.' );
	if ( value.thumbnail !== null ) reference( value.thumbnail );

}

const validationDocument = () => createStudentProjectDocument( { projectId: 'catalogue-validation', now: '2026-10-23T00:00:00.000Z' } );
const allowedMimeTypes = {
	model: [ 'model/gltf-binary' ],
	environment: [ 'image/vnd.radiance', 'image/x-hdr', 'image/x-exr' ],
	video: [ 'video/mp4', 'video/webm' ],
	image: [ 'image/png', 'image/jpeg', 'image/webp' ],
};

/** Integrity metadata only: duration/codec decoding is a separate publication preflight. */
export function validateStudentLibraryAsset( asset ) {

	const document = validationDocument();
	document.assets = { [ assetVersionKey( asset || {} ) ]: asset };
	validateStudentProjectDocument( document );
	if ( ! allowedMimeTypes[ asset.kind ]?.includes( asset.mimeType ) ) fail( 'Unsupported library content type.' );
	return asset;

}

/** A complete immutable preset contains portable content, never URLs or editing authority. */
export function validateStudentPresetVersion( preset ) {

	shape( preset, [ 'format', 'schemaVersion', ...summaryFields, 'assets', 'baseScene', 'snapshot', ...( preset?.schemaVersion === 2 ? [ 'sceneDefinition' ] : [] ) ] );
	if ( preset.format !== STUDENT_PRESET_FORMAT || ! [ 1, 2 ].includes( preset.schemaVersion ) ) fail( 'Unsupported preset format/version.' );
	summary( preset );
	const document = validationDocument();
	document.assets = preset.assets;
	document.baseScenes = { [ baseSceneVersionKey( preset.baseScene || {} ) ]: preset.baseScene };
	document.shots = { 'catalogue-shot': {
		shotId: 'catalogue-shot', name: preset.name,
		baseScene: { sceneId: preset.baseScene?.sceneId, version: preset.baseScene?.version },
		sourcePreset: { presetId: preset.presetId, version: preset.version }, snapshot: preset.snapshot,
	} };
	validateStudentProjectDocument( document );
	for ( const asset of Object.values( preset.assets ) ) validateStudentLibraryAsset( asset );
	if ( preset.thumbnail !== null && preset.assets[ assetVersionKey( preset.thumbnail ) ]?.kind !== 'image' ) fail( 'Thumbnail requires a pinned image asset.' );
	if ( preset.schemaVersion === 2 ) validateSupportedPresetScene( preset );
	return preset;

}

export function createCatalogueSummary( preset ) {

	validateStudentPresetVersion( preset );
	return structuredClone( Object.fromEntries( summaryFields.map( field => [ field, preset[ field ] ] ) ) );

}

export function validateStudentCatalogue( catalogue ) {

	shape( catalogue, [ 'format', 'schemaVersion', 'presets' ] );
	if ( catalogue.format !== STUDENT_CATALOGUE_FORMAT || catalogue.schemaVersion !== 1 || ! Array.isArray( catalogue.presets ) ) fail( 'Unsupported catalogue format/version.' );
	const seen = new Set();
	for ( const preset of catalogue.presets ) {

		shape( preset, summaryFields ); summary( preset );
		if ( seen.has( preset.presetId ) ) fail( 'Duplicate available preset.' );
		seen.add( preset.presetId );

	}

	return catalogue;

}

/** Stable bytes/equality for already validated JSON records; array order stays meaningful. */
export function serializeStudentCatalogueContent( value ) {

	const ordered = item => Array.isArray( item ) ? item.map( ordered ) : item && typeof item === 'object' ? Object.fromEntries( Object.keys( item ).sort().map( key => [ key, ordered( item[ key ] ) ] ) ) : item;
	return JSON.stringify( ordered( value ) );

}
