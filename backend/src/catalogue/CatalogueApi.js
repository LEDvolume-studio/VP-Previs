import { validateStudentPresetVersion, validateStudentLibraryAsset, createCatalogueSummary } from '../../../app/src/previs/domain/StudentCatalogueSchema.js';

import { validateStudentSceneDefinition } from '../../../app/src/previs/domain/StudentSceneDefinition.js';
import { validateDefinitionModelBytes, validatePresetModelBytes } from '../../../app/src/previs/engine/SupportedGLB.js';
import { migrateProjectDocument } from '../../../app/src/services/projects/ProjectSchema.js';

const MODEL_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const requestPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const hex = bytes => Array.from( new Uint8Array( bytes ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const digest = async bytes => hex( await crypto.subtle.digest( 'SHA-256', typeof bytes === 'string' ? encoder.encode( bytes ) : bytes ) );
const canonical = value => JSON.stringify( sort( value ) );
function sort( value ) {

	if ( Array.isArray( value ) ) return value.map( sort );
	if ( value && typeof value === 'object' ) return Object.fromEntries( Object.keys( value ).sort().map( key => [ key, sort( value[ key ] ) ] ) );
	return value;

}

export class CatalogueError extends Error {

	constructor( status, code, message ) {

		super( message ); Object.assign( this, { status, code } );

	}

}
const fail = ( status, code, message ) => {

	throw new CatalogueError( status, code, message );

};

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
export const catalogueReply = ( body, status = 200, extra = {} ) => new Response( JSON.stringify( body ), { status, headers: { ...headers, 'Content-Type': 'application/json', ...extra } } );
const statement = ( env, sql, ...values ) => env.DB.prepare( sql ).bind( ...values );
function maximum( env, name ) {

	const value = Number( env[ name ] );
	if ( ! Number.isSafeInteger( value ) || value < 1 ) fail( 503, 'CATALOGUE_NOT_CONFIGURED', 'Local catalogue bounds must be configured.' );
	return value;

}

function configured( env ) {

	const development = [ 'local', 'test' ].includes( env.ENVIRONMENT );
	const hosted = [ 'preview', 'production' ].includes( env.ENVIRONMENT ) && env.ENABLE_HOSTED_CATALOGUE_API === 'true';
	if ( ! ( development || hosted ) || env.ENABLE_CATALOGUE_API !== 'true' || ! env.DB || ! env.LIBRARY ) fail( 503, 'CATALOGUE_NOT_CONFIGURED', 'The catalogue is not enabled.' );
	maximum( env, 'MAX_JSON_BYTES' ); maximum( env, 'MAX_LIBRARY_ASSET_BYTES' );

}

async function readBytes( request, bound ) {

	const declared = request.headers?.get( 'Content-Length' ) ?? null;
	if ( declared !== null && ( ! /^\d+$/.test( declared ) || Number( declared ) > bound ) ) fail( 413, 'PAYLOAD_TOO_LARGE', 'Request exceeds the local technical byte bound.' );
	const reader = request.body?.getReader();
	if ( ! reader ) return new Uint8Array();
	const chunks = []; let size = 0;
	try {

		while ( true ) {

			const { done, value } = await reader.read();
			if ( done ) break;
			size += value.byteLength;
			if ( size > bound ) {

				await reader.cancel(); fail( 413, 'PAYLOAD_TOO_LARGE', 'Request exceeds the local technical byte bound.' );

			}

			chunks.push( value );

		}

	} finally {

		reader.releaseLock();

	}

	const bytes = new Uint8Array( size ); let offset = 0;
	for ( const chunk of chunks ) {

		bytes.set( chunk, offset ); offset += chunk.byteLength;

	}

	return bytes;

}

async function readJson( request, env ) {

	if ( ! /^application\/json(?:\s*;.*)?$/i.test( request.headers.get( 'Content-Type' ) || '' ) ) fail( 415, 'CONTENT_TYPE', 'Expected application/json.' );
	const bytes = await readBytes( request, maximum( env, 'MAX_JSON_BYTES' ) );
	try {

		return JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes ) );

	} catch {

		fail( 400, 'INVALID_JSON', 'Expected valid UTF-8 JSON.' );

	}

}

function validate( validator, value, code ) {

	try {

		validator( value );

	} catch ( error ) {

		fail( 422, code, `Invalid catalogue content: ${error.message}` );

	}

}

const etag = value => `"${value}"`;
const acknowledgement = ( row, replayed = false ) => ( { presetId: row.preset_id, version: row.version, available: Boolean( row.available ), headRevision: row.result_revision, replayed } );
async function checkedAsset( env, asset ) {

	const row = await statement( env, 'SELECT * FROM library_assets WHERE asset_id=? AND version=?', asset.assetId, asset.version ).first();
	if ( ! row || row.metadata_json !== canonical( asset ) ) fail( 409, 'ASSET_NOT_VERIFIED', `Asset ${asset.assetId}@${asset.version} has not been registered with these exact metadata.` );
	const object = await env.LIBRARY.head( row.object_key );
	if ( ! object || object.size !== row.byte_length || ! object.checksums.sha256 || hex( object.checksums.sha256 ) !== row.sha256 ) fail( 503, 'LIBRARY_UNAVAILABLE', 'Registered library bytes failed storage verification.' );
	return row;

}

async function checkedModelBytes( env, asset ) {

	if ( asset.kind !== 'model' || asset.byteLength > MODEL_BYTES ) fail( 422, 'UNSUPPORTED_SCENE_MODEL', 'Scene models must be supported GLB assets of at most 64 MiB.' );
	const row = await checkedAsset( env, asset );
	const object = await env.LIBRARY.get( row.object_key );
	if ( ! object || object.size !== asset.byteLength ) fail( 503, 'LIBRARY_UNAVAILABLE', 'Registered scene model is unavailable.' );
	const bytes = await readBytes( object, asset.byteLength );
	if ( bytes.byteLength !== asset.byteLength || await digest( bytes ) !== asset.sha256 ) fail( 503, 'LIBRARY_UNAVAILABLE', 'Registered scene model bytes failed integrity verification.' );
	return bytes;

}

async function checkedDefinition( env, definition, assets, preset = null ) {

	try {

		validateStudentSceneDefinition( definition, assets );
		for ( const model of definition.models ) {

			const asset = assets[ `${model.asset.assetId}@${model.asset.version}` ];
			const bytes = await checkedModelBytes( env, asset );
			if ( preset ) validatePresetModelBytes( preset, model, bytes );
			else validateDefinitionModelBytes( definition, model, bytes );

		}

	} catch ( error ) {

		if ( error instanceof CatalogueError ) throw error;
		fail( 422, 'UNSUPPORTED_SCENE_MODEL', `Unsupported scene model: ${error.message}` );

	}

}

async function putAsset( request, env, assetId, version ) {

	const rawMetadata = request.headers.get( 'X-Asset-Metadata' ) || '';
	if ( encoder.encode( rawMetadata ).byteLength > 16384 ) fail( 413, 'PAYLOAD_TOO_LARGE', 'Asset metadata exceeds the local technical header bound.' );
	let asset;
	try {

		asset = JSON.parse( rawMetadata );

	} catch {

		fail( 400, 'INVALID_ASSET_METADATA', 'X-Asset-Metadata must contain the asset metadata JSON.' );

	}

	validate( validateStudentLibraryAsset, asset, 'INVALID_ASSET_METADATA' );
	if ( asset.byteLength > maximum( env, 'MAX_LIBRARY_ASSET_BYTES' ) ) fail( 413, 'PAYLOAD_TOO_LARGE', 'Asset exceeds the local technical byte bound.' );
	if ( asset.assetId !== assetId || asset.version !== version ) fail( 422, 'IDENTITY_MISMATCH', 'Asset metadata identity must match the endpoint.' );
	if ( request.headers.get( 'Content-Type' ) !== asset.mimeType ) fail( 415, 'CONTENT_TYPE', 'Upload MIME type must match the asset metadata.' );
	const metadata = canonical( asset );
	const old = await statement( env, 'SELECT * FROM library_assets WHERE asset_id=? AND version=?', assetId, version ).first();
	if ( old && old.metadata_json !== metadata ) fail( 409, 'IMMUTABLE_ASSET', 'This asset version is already registered with different metadata.' );
	const objectKey = `library/assets/${assetId}/${version}/${asset.sha256}`;
	if ( asset.byteLength <= 64 * 1024 * 1024 ) {

		const bytes = await readBytes( request, asset.byteLength );
		if ( bytes.byteLength !== asset.byteLength || await digest( bytes ) !== asset.sha256 ) fail( 422, 'ASSET_MISMATCH', 'Actual asset bytes must match the exact SHA-256 and byte length.' );
		await env.LIBRARY.put( objectKey, bytes, { sha256: asset.sha256, onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: asset.mimeType } } );

	} else {

		// FixedLengthStream bounds the request without buffering the video in the
		// Worker; R2 verifies its SHA-256 before accepting the object.
		const length = request.headers.get( 'Content-Length' );
		if ( length !== null && ( ! /^\d+$/.test( length ) || Number( length ) !== asset.byteLength ) ) fail( 422, 'ASSET_MISMATCH', 'Asset length does not match metadata.' );
		if ( ! request.body ) fail( 422, 'ASSET_MISMATCH', 'Asset bytes are required.' );
		const stream = new FixedLengthStream( asset.byteLength );
		try {

			await Promise.all( [ request.body.pipeTo( stream.writable ), env.LIBRARY.put( objectKey, stream.readable, { sha256: asset.sha256, httpMetadata: { contentType: asset.mimeType } } ) ] );

		} catch {

			fail( 422, 'ASSET_MISMATCH', 'Asset upload failed length or integrity verification.' );

		}

	}
	const object = await env.LIBRARY.head( objectKey );
	if ( ! object || object.size !== asset.byteLength || ! object.checksums.sha256 || hex( object.checksums.sha256 ) !== asset.sha256 ) fail( 503, 'LIBRARY_UNAVAILABLE', 'Asset storage verification failed.' );
	await statement( env, 'INSERT OR IGNORE INTO library_assets VALUES(?,?,?,?,?,?)', assetId, version, metadata, objectKey, asset.sha256, asset.byteLength ).run();
	await checkedAsset( env, asset );
	return catalogueReply( { assetId, version, verified: true }, old ? 200 : 201, { ETag: etag( asset.sha256 ) } );

}

function condition( request ) {

	const match = request.headers.get( 'If-Match' ), absent = request.headers.get( 'If-None-Match' );
	if ( absent === '*' && match === null ) return - 1;
	if ( absent === null && /^"(?:0|[1-9]\d*)"$/.test( match || '' ) ) {

		const value = Number( match.slice( 1, - 1 ) );
		if ( Number.isSafeInteger( value ) && value < Number.MAX_SAFE_INTEGER ) return value;

	}

	fail( 428, 'PRECONDITION_REQUIRED', 'Use If-None-Match: * for initial publication, or the exact quoted head revision in If-Match.' );

}

async function replay( env, presetId, requestId, requestHash ) {

	const row = await statement( env, 'SELECT * FROM catalogue_operations WHERE preset_id=? AND request_id=?', presetId, requestId ).first();
	if ( row && row.request_hash !== requestHash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used with different content or preconditions.' );
	return row;

}

async function mutate( request, env, presetId, version, action ) {

	const editing = action === 'editor';
	if ( editing ) action = 'publish';
	const expected = condition( request );
	const requestId = request.headers.get( 'Idempotency-Key' ) || '';
	if ( ! requestPattern.test( requestId ) ) fail( 400, 'REQUEST_ID_REQUIRED', 'A stable Idempotency-Key is required.' );
	const input = await readJson( request, env );
	let body = input, editorDocument = null;
	if ( editing ) {

		if ( ! input || typeof input !== 'object' || Array.isArray( input ) || Object.keys( input ).sort().join() !== 'adminDocument,name,studentPreset' || typeof input.name !== 'string' || ! input.name.trim() || input.name.trim().length > 1024 ) fail( 422, 'INVALID_EDITOR_RECORD', 'Expected a named admin document and portable student preset.' );
		try {

			editorDocument = migrateProjectDocument( input.adminDocument );

		} catch ( error ) {

			fail( 422, 'INVALID_ADMIN_DOCUMENT', `Invalid admin scene: ${error.message}` );

		}

		body = input.studentPreset;
		version = body?.version;
		if ( body?.name !== input.name.trim() ) fail( 422, 'IDENTITY_MISMATCH', 'The student preset name must match the editor name.' );

	}

	if ( action === 'publish' ) {

		validate( validateStudentPresetVersion, body, 'INVALID_PRESET' );
		if ( body.presetId !== presetId || body.version !== version ) fail( 422, 'IDENTITY_MISMATCH', 'Preset identity must match the endpoint.' );

	} else {

		if ( ! body || typeof body !== 'object' || Array.isArray( body ) || Object.keys( body ).sort().join() !== 'available,version' || typeof body.version !== 'string' || ! idPattern.test( body.version ) || typeof body.available !== 'boolean' ) fail( 422, 'INVALID_AVAILABILITY', 'Expected {version,available} with an immutable version and boolean availability.' );
		version = body.version;
		if ( expected < 0 ) fail( 428, 'PRECONDITION_REQUIRED', 'Availability changes require the current head revision in If-Match.' );

	}

	const hash = await digest( canonical( [ editing ? 'editor' : action, expected, input ] ) );
	const prior = await replay( env, presetId, requestId, hash );
	if ( prior ) return catalogueReply( editing ? JSON.parse( prior.editor_record_json ) : acknowledgement( prior, true ), 200, { ETag: etag( prior.result_revision ) } );
	const head = await statement( env, 'SELECT * FROM catalogue_heads WHERE preset_id=?', presetId ).first();
	if ( ( head?.revision ?? - 1 ) !== expected ) fail( 409, 'CATALOGUE_CONFLICT', 'Catalogue head changed; refresh before publishing.' );
	if ( action === 'publish' ) {

		if ( await statement( env, 'SELECT 1 FROM catalogue_presets WHERE preset_id=? AND version=?', presetId, version ).first() ) fail( 409, 'IMMUTABLE_PRESET', 'Published preset versions cannot be overwritten or republished.' );
		for ( const asset of Object.values( body.assets ) ) await checkedAsset( env, asset );
		const scene = await statement( env, 'SELECT scene_json FROM library_base_scenes WHERE scene_id=? AND version=?', body.baseScene.sceneId, body.baseScene.version ).first();
		if ( scene && scene.scene_json !== canonical( body.baseScene ) ) fail( 409, 'IMMUTABLE_BASE_SCENE', 'This base scene version has a different immutable asset inventory.' );
		if ( body.schemaVersion === 2 ) {

			await checkedDefinition( env, body.sceneDefinition, body.assets, body );
			const existing = await statement( env, 'SELECT definition_json FROM library_supported_scenes WHERE scene_id=? AND version=?', body.baseScene.sceneId, body.baseScene.version ).first();
			if ( existing && existing.definition_json !== canonical( body.sceneDefinition ) ) fail( 409, 'IMMUTABLE_SUPPORTED_SCENE', 'This supported scene version has a different immutable definition.' );

		}

	} else if ( ! head || head.version !== version ) fail( 409, 'CATALOGUE_CONFLICT', 'Availability changes must refer to the current head version.' );
	const documentJson = action === 'publish' ? canonical( body ) : null;
	const row = { preset_id: presetId, version, available: action === 'publish' ? 1 : Number( body.available ), result_revision: expected + 1 };
	let editorRecord = null;
	if ( editing ) {

		const previous = await statement( env, 'SELECT record_json FROM preset_editor_revisions WHERE preset_id=? ORDER BY revision DESC LIMIT 1', presetId ).first();
		const timestamp = new Date().toISOString();
		editorRecord = {
			format: 'rayzee-local-preset', schemaVersion: 1, presetId, revision: row.result_revision, name: input.name.trim(),
			createdAt: previous ? JSON.parse( previous.record_json ).createdAt : timestamp, updatedAt: timestamp,
			adminDocument: editorDocument, studentPreset: body, thumbnail: null,
		};
		// D1 limits an entire row to 2,000,000 bytes. The atomic operation
		// stores both the portable preset and its full authoring record.
		const strings = [ canonical( editorRecord ), documentJson, canonical( createCatalogueSummary( body ) ), canonical( body.baseScene ), body.schemaVersion === 2 ? canonical( body.sceneDefinition ) : '' ];
		if ( strings.reduce( ( length, value ) => length + encoder.encode( value ).byteLength, 0 ) > 1900000 ) fail( 413, 'PRESET_RECORD_TOO_LARGE', 'The preset scene exceeds the supported D1 record size. Reduce its scene metadata before saving.' );

	}

	try {

		const definitionJson = action === 'publish' && body.schemaVersion === 2 ? canonical( body.sceneDefinition ) : null;
		const result = await statement( env, `INSERT INTO catalogue_operations
		(preset_id,request_id,request_hash,action,version,available,expected_revision,result_revision,document_json,sha256,summary_json,scene_id,scene_version,scene_json${definitionJson ? ",scene_definition_json,scene_definition_sha256" : ""}${editing ? ",editor_record_json" : ""})
		SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?${definitionJson ? ",?,?" : ""}${editing ? ",?" : ""} WHERE
		(?=-1 AND NOT EXISTS(SELECT 1 FROM catalogue_heads WHERE preset_id=?)) OR
		EXISTS(SELECT 1 FROM catalogue_heads WHERE preset_id=? AND revision=?)`,
		presetId, requestId, hash, action, version, row.available, expected, row.result_revision, documentJson,
		documentJson ? await digest( documentJson ) : null, documentJson ? canonical( createCatalogueSummary( body ) ) : null,
		body.baseScene?.sceneId ?? null, body.baseScene?.version ?? null, body.baseScene ? canonical( body.baseScene ) : null,
		...( definitionJson ? [ definitionJson, await digest( definitionJson ) ] : [] ),
		...( editing ? [ canonical( editorRecord ) ] : [] ),
		expected, presetId, presetId, expected ).run();
		if ( result.meta.changes < 1 ) {

			const retry = await replay( env, presetId, requestId, hash );
			if ( retry ) return catalogueReply( editing ? JSON.parse( retry.editor_record_json ) : acknowledgement( retry, true ), 200, { ETag: etag( retry.result_revision ) } );
			fail( 409, 'CATALOGUE_CONFLICT', 'Catalogue head changed; refresh before publishing.' );

		}

	} catch ( error ) {

		if ( error instanceof CatalogueError ) throw error;
		const retry = await replay( env, presetId, requestId, hash );
		if ( retry ) return catalogueReply( editing ? JSON.parse( retry.editor_record_json ) : acknowledgement( retry, true ), 200, { ETag: etag( retry.result_revision ) } );
		if ( ( ( await statement( env, 'SELECT revision FROM catalogue_heads WHERE preset_id=?', presetId ).first() )?.revision ?? - 1 ) !== expected ) fail( 409, 'CATALOGUE_CONFLICT', 'Catalogue head changed; refresh before publishing.' );
		if ( action === 'publish' && await statement( env, 'SELECT 1 FROM catalogue_presets WHERE preset_id=? AND version=?', presetId, version ).first() ) fail( 409, 'IMMUTABLE_PRESET', 'Published preset versions cannot be overwritten.' );
		if ( action === 'publish' ) {

			const scene = await statement( env, 'SELECT scene_json FROM library_base_scenes WHERE scene_id=? AND version=?', body.baseScene.sceneId, body.baseScene.version ).first();
			if ( scene && scene.scene_json !== canonical( body.baseScene ) ) fail( 409, 'IMMUTABLE_BASE_SCENE', 'This base scene version has a different immutable asset inventory.' );
			if ( body.schemaVersion === 2 ) {

				const registered = await statement( env, 'SELECT definition_json FROM library_supported_scenes WHERE scene_id=? AND version=?', body.baseScene.sceneId, body.baseScene.version ).first();
				if ( registered && registered.definition_json !== canonical( body.sceneDefinition ) ) fail( 409, 'IMMUTABLE_SUPPORTED_SCENE', 'This supported scene version has a different immutable definition.' );

			}

		}

		throw error;

	}

	return catalogueReply( editing ? editorRecord : acknowledgement( row ), action === 'publish' ? 201 : 200, { ETag: etag( row.result_revision ) } );

}

async function list( request, env ) {

	const { results } = await statement( env, `SELECT p.summary_json FROM catalogue_heads h JOIN catalogue_presets p
	ON p.preset_id=h.preset_id AND p.version=h.version WHERE h.available=1 ORDER BY h.preset_id` ).all();
	const body = { format: 'rayzee-student-catalogue', schemaVersion: 1, presets: results.map( row => JSON.parse( row.summary_json ) ) };
	const serialized = canonical( body );
	if ( encoder.encode( serialized ).byteLength > maximum( env, 'MAX_JSON_BYTES' ) ) fail( 503, 'CATALOGUE_TOO_LARGE', 'Catalogue exceeds the local technical JSON bound; pagination is required before further growth.' );
	const tag = etag( await digest( serialized ) );
	if ( request.headers.get( 'If-None-Match' ) === tag ) return new Response( null, { status: 304, headers: { ...headers, ETag: tag } } );
	return catalogueReply( body, 200, { ETag: tag } );

}

async function readPreset( request, env, presetId, version ) {

	const row = await statement( env, 'SELECT * FROM catalogue_presets WHERE preset_id=? AND version=?', presetId, version ).first();
	if ( ! row ) fail( 404, 'PRESET_NOT_FOUND', 'Preset version is not published.' );
	if ( await digest( row.document_json ) !== row.sha256 ) fail( 503, 'LIBRARY_UNAVAILABLE', 'Preset storage verification failed.' );
	const preset = JSON.parse( row.document_json );
	validate( validateStudentPresetVersion, preset, 'INVALID_PRESET' );
	for ( const asset of Object.values( preset.assets ) ) await checkedAsset( env, asset );
	const tag = etag( row.sha256 );
	if ( request.headers.get( 'If-None-Match' ) === tag ) return new Response( null, { status: 304, headers: { ...headers, ETag: tag } } );
	return catalogueReply( preset, 200, { ETag: tag } );

}

async function readScene( request, env, sceneId, version ) {

	const row = await statement( env, 'SELECT * FROM library_supported_scenes WHERE scene_id=? AND version=?', sceneId, version ).first();
	if ( ! row ) fail( 404, 'SCENE_NOT_FOUND', 'Supported scene version is not published.' );
	if ( await digest( row.definition_json ) !== row.sha256 ) fail( 503, 'LIBRARY_UNAVAILABLE', 'Supported scene storage verification failed.' );
	const sceneDefinition = JSON.parse( row.definition_json );
	if ( sceneDefinition.baseScene.sceneId !== sceneId || sceneDefinition.baseScene.version !== version ) fail( 503, 'LIBRARY_UNAVAILABLE', 'Supported scene identity verification failed.' );
	const assets = {};
	for ( const reference of sceneDefinition.baseScene.assets ) {

		const asset = await statement( env, 'SELECT metadata_json FROM library_assets WHERE asset_id=? AND version=?', reference.assetId, reference.version ).first();
		if ( ! asset ) fail( 503, 'LIBRARY_UNAVAILABLE', 'Supported scene model metadata is unavailable.' );
		assets[ `${reference.assetId}@${reference.version}` ] = JSON.parse( asset.metadata_json );

	}

	await checkedDefinition( env, sceneDefinition, assets );
	const tag = etag( row.sha256 );
	if ( request.headers.get( 'If-None-Match' ) === tag ) return new Response( null, { status: 304, headers: { ...headers, ETag: tag } } );
	return catalogueReply( { sceneDefinition, assets }, 200, { ETag: tag } );

}

function range( value, size ) {

	const match = /^bytes=(\d*)-(\d*)$/.exec( value );
	if ( ! match || ( ! match[ 1 ] && ! match[ 2 ] ) ) return null;
	let start = match[ 1 ] ? Number( match[ 1 ] ) : Math.max( 0, size - Number( match[ 2 ] ) );
	let end = match[ 1 ] && match[ 2 ] ? Number( match[ 2 ] ) : size - 1;
	if ( ! [ start, end ].every( Number.isSafeInteger ) || start < 0 || start >= size || end < start || ( ! match[ 1 ] && Number( match[ 2 ] ) === 0 ) ) return null;
	end = Math.min( end, size - 1 ); return { offset: start, length: end - start + 1 };

}

async function readAsset( request, env, assetId, version ) {

	const row = await statement( env, 'SELECT * FROM library_assets WHERE asset_id=? AND version=?', assetId, version ).first();
	if ( ! row ) fail( 404, 'ASSET_NOT_FOUND', 'Asset version is not registered.' );
	await checkedAsset( env, JSON.parse( row.metadata_json ) );
	const tag = etag( row.sha256 );
	const extra = { ...headers, ETag: tag, 'Accept-Ranges': 'bytes', 'Content-Type': JSON.parse( row.metadata_json ).mimeType, 'Content-Disposition': 'inline' };
	if ( request.headers.get( 'If-None-Match' ) === tag ) return new Response( null, { status: 304, headers: extra } );
	const raw = request.headers.get( 'Range' );
	const useRange = raw && ( ! request.headers.has( 'If-Range' ) || request.headers.get( 'If-Range' ) === tag );
	const slice = useRange ? range( raw, row.byte_length ) : null;
	if ( useRange && ! slice ) return new Response( null, { status: 416, headers: { ...extra, 'Content-Range': `bytes */${row.byte_length}` } } );
	const object = await env.LIBRARY.get( row.object_key, slice ? { range: slice } : undefined );
	if ( ! object || object.size !== row.byte_length || ! object.checksums.sha256 || hex( object.checksums.sha256 ) !== row.sha256 ) fail( 503, 'LIBRARY_UNAVAILABLE', 'Library storage became unavailable.' );
	return new Response( object.body, { status: slice ? 206 : 200, headers: {
		...extra, 'Content-Length': String( slice?.length ?? row.byte_length ),
		...( slice ? { 'Content-Range': `bytes ${slice.offset}-${slice.offset + slice.length - 1}/${row.byte_length}` } : {} )
	} } );

}

export async function handleCatalogueRoute( request, env ) {

	const path = new URL( request.url ).pathname;
	const editor = /^\/v1\/admin\/preset-editor(?:\/([^/]+))?$/.exec( path );
	if ( path !== '/v1/catalogue' && ! path.startsWith( '/v1/catalogue/' ) && ! path.startsWith( '/v1/admin/catalogue/' ) && ! editor ) return null;
	configured( env );
	if ( editor ) {

		const presetId = editor[ 1 ];
		if ( presetId && ! idPattern.test( presetId ) ) fail( 404, 'NOT_FOUND', 'Preset editor endpoint not found.' );
		if ( presetId && request.method === 'PUT' ) return mutate( request, env, presetId, null, 'editor' );
		if ( request.method === 'GET' ) {

			if ( presetId ) {

				const row = await statement( env, 'SELECT record_json FROM preset_editor_revisions WHERE preset_id=? ORDER BY revision DESC LIMIT 1', presetId ).first();
				if ( ! row ) fail( 404, 'PRESET_NOT_FOUND', 'This editable preset was not found.' );
				const record = JSON.parse( row.record_json );
				return catalogueReply( record, 200, { ETag: etag( record.revision ) } );

			}

			if ( new URL( request.url ).searchParams.get( 'summary' ) === '1' ) {

				const { results } = await statement( env, `SELECT p.preset_id,p.revision,
				json_extract(p.record_json,'$.name') AS name,
				json_extract(p.record_json,'$.createdAt') AS created_at,
				json_extract(p.record_json,'$.updatedAt') AS updated_at,
				json_extract(p.record_json,'$.studentPreset.assets."' || json_extract(p.record_json,'$.studentPreset.thumbnail.assetId') || '@' || json_extract(p.record_json,'$.studentPreset.thumbnail.version') || '"') AS thumbnail_json
				FROM preset_editor_revisions p JOIN catalogue_heads h ON h.preset_id=p.preset_id AND h.revision=p.revision
				WHERE h.available=1 ORDER BY p.preset_id` ).all();
				const body = { presets: results.map( row => ( {
					presetId: row.preset_id, revision: row.revision, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at,
					thumbnailAsset: row.thumbnail_json ? JSON.parse( row.thumbnail_json ) : null,
				} ) ) };
				if ( encoder.encode( canonical( body ) ).byteLength > maximum( env, 'MAX_JSON_BYTES' ) ) fail( 503, 'CATALOGUE_TOO_LARGE', 'Editable preset list exceeds the configured JSON bound.' );
				return catalogueReply( body );

			}

			const { results } = await statement( env, `SELECT p.record_json FROM preset_editor_revisions p
			WHERE p.revision=(SELECT MAX(r.revision) FROM preset_editor_revisions r WHERE r.preset_id=p.preset_id) ORDER BY p.preset_id` ).all();
			const body = { presets: results.map( row => JSON.parse( row.record_json ) ) };
			if ( encoder.encode( canonical( body ) ).byteLength > maximum( env, 'MAX_JSON_BYTES' ) ) fail( 503, 'CATALOGUE_TOO_LARGE', 'Editable preset list exceeds the configured JSON bound.' );
			return catalogueReply( body );

		}

		fail( 404, 'NOT_FOUND', 'Preset editor endpoint not found.' );

	}

	if ( path === '/v1/catalogue' && request.method === 'GET' ) return list( request, env );
	const match = /^\/v1\/(admin\/)?catalogue\/(assets|presets|scenes)\/([^/]+)(?:\/([^/]+))?$/.exec( path );
	if ( ! match || ! idPattern.test( match[ 3 ] ) || ( match[ 4 ] && ! idPattern.test( match[ 4 ] ) ) ) fail( 404, 'NOT_FOUND', 'Catalogue endpoint not found.' );
	const [ , admin, type, id, version ] = match;
	if ( admin && type === 'presets' && version === 'availability' && request.method === 'POST' ) return mutate( request, env, id, null, 'availability' );
	if ( admin && type === 'presets' && ! version && request.method === 'GET' ) {

		const head = await statement( env, 'SELECT *,revision AS result_revision FROM catalogue_heads WHERE preset_id=?', id ).first();
		if ( ! head ) fail( 404, 'PRESET_NOT_FOUND', 'Preset has not been published.' );
		return catalogueReply( acknowledgement( head ), 200, { ETag: etag( head.revision ) } );

	}

	if ( ! version ) fail( 404, 'NOT_FOUND', 'Catalogue endpoint not found.' );
	if ( type === 'scenes' ) {

		if ( ! admin && request.method === 'GET' ) return readScene( request, env, id, version );
		fail( 404, 'NOT_FOUND', 'Catalogue endpoint not found.' );

	}

	if ( admin && request.method === 'PUT' ) return type === 'assets' ? putAsset( request, env, id, version ) : mutate( request, env, id, version, 'publish' );
	if ( ! admin && request.method === 'GET' ) return type === 'assets' ? readAsset( request, env, id, version ) : readPreset( request, env, id, version );
	fail( 404, 'NOT_FOUND', 'Catalogue endpoint not found.' );

}
