import { handleCatalogueRoute, CatalogueError, catalogueReply } from './catalogue/CatalogueApi.js';
import { handleR2Plates } from './plates/R2PlateDelivery.js';
import { validateStudentProjectDocument } from '../../app/src/previs/domain/StudentProjectSchema.js';
import { assertAustralianRequest, handleAdminSessionRoute, requireAdminSession, SecurityError, securityErrorResponse } from './security/AdminSecurity.js';
import { handleStudentAccountRoute, AccountError } from './security/StudentAccounts.js';
import { handleAccountProjectRoute } from './projects/AccountProjects.js';
import { handleStudentDefaultRoute, handleStudentDefaultReadRoute } from './defaults/StudentDefaultApi.js';

const encoder = new TextEncoder();
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const requestPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const mediaPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}@[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const mimeTypes = new Set( [ 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav' ] );

class ApiError extends Error {

	constructor( status, code, message ) {

		super( message );
		Object.assign( this, { status, code } );

	}

}
const fail = ( status, code, message ) => {

	throw new ApiError( status, code, message );

};

const reply = ( body, status = 200, headers = {} ) => new Response( JSON.stringify( body ), {
	status,
	headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...headers }
} );
const hex = bytes => Array.from( new Uint8Array( bytes ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const digest = async value => hex( await crypto.subtle.digest( 'SHA-256', typeof value === 'string' ? encoder.encode( value ) : value ) );
const statement = ( env, sql, ...values ) => env.DB.prepare( sql ).bind( ...values );
const limit = ( env, name ) => {

	const value = Number( env[ name ] );
	if ( ! Number.isSafeInteger( value ) || value <= 0 ) fail( 503, 'NOT_CONFIGURED', 'Development limits must be configured.' );
	return value;

};

function configured( env ) {

	// Hosted activation requires a deliberate separate implementation/review.
	if ( ! [ 'local', 'test' ].includes( env.ENVIRONMENT ) || env.ENABLE_DRAFT_API !== 'true' || ! env.DB || ! env.DOCUMENTS || ! env.NARRATION ) fail( 503, 'NOT_CONFIGURED', 'Student backend is not enabled.' );
	for ( const name of [ 'MAX_JSON_BYTES', 'MAX_NARRATION_BYTES', 'MAX_DRAFT_REVISIONS', 'MAX_DRAFT_MEDIA', 'MAX_DRAFT_CREATIONS_PER_MINUTE' ] ) limit( env, name );

}

function shape( input, fields ) {

	if ( ! input || typeof input !== 'object' || Array.isArray( input ) || Object.keys( input ).length !== fields.length || ! fields.every( field => Object.hasOwn( input, field ) ) ) fail( 400, 'INVALID_BODY', 'Unexpected request shape.' );

}

async function readBytes( request, maximum ) {

	const declared = request.headers.get( 'Content-Length' );
	if ( declared !== null && ( ! /^\d+$/.test( declared ) || Number( declared ) > maximum ) ) fail( 413, 'PAYLOAD_TOO_LARGE', 'Request exceeds the configured byte limit.' );
	const reader = request.body?.getReader();
	if ( ! reader ) return new Uint8Array();
	const chunks = [];
	let size = 0;
	try {

		while ( true ) {

			const { value, done } = await reader.read();
			if ( done ) break;
			size += value.byteLength;
			if ( size > maximum ) {

				await reader.cancel();
				fail( 413, 'PAYLOAD_TOO_LARGE', 'Request exceeds the configured byte limit.' );

			}

			chunks.push( value );

		}

	} finally {

		reader.releaseLock();

	}

	const bytes = new Uint8Array( size );
	let offset = 0;
	for ( const chunk of chunks ) {

		bytes.set( chunk, offset ); offset += chunk.byteLength;

	}

	return bytes;

}

async function readJson( request, env ) {

	if ( ! /^application\/json(?:\s*;.*)?$/i.test( request.headers.get( 'Content-Type' ) || '' ) ) fail( 415, 'CONTENT_TYPE', 'Expected application/json.' );
	const bytes = await readBytes( request, limit( env, 'MAX_JSON_BYTES' ) );
	try {

		return JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes ) );

	} catch {

		fail( 400, 'INVALID_JSON', 'Expected valid UTF-8 JSON.' );

	}

}

async function capabilityHash( request ) {

	const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec( request.headers.get( 'Authorization' ) || '' );
	// 32 bytes have only four significant bits in their final base64url character.
	if ( ! match || ! /[AEIMQUYcgkosw048]$/.test( match[ 1 ] ) ) fail( 401, 'UNAUTHORIZED', 'Draft ownership capability required.' );
	return digest( match[ 1 ] );

}

function requestId( request ) {

	const value = request.headers.get( 'Idempotency-Key' ) || '';
	if ( ! requestPattern.test( value ) ) fail( 400, 'REQUEST_ID_REQUIRED', 'A stable Idempotency-Key is required.' );
	return value;

}

async function owner( request, env, draftId ) {

	const hash = await capabilityHash( request );
	const draft = await statement( env, 'SELECT * FROM drafts WHERE draft_id = ? AND capability_hash = ? AND revoked = 0', draftId, hash ).first();
	if ( ! draft ) fail( 401, 'UNAUTHORIZED', 'Draft ownership capability required.' );
	return draft;

}

function validateDocument( document ) {

	try {

		validateStudentProjectDocument( document );

	} catch {

		fail( 422, 'INVALID_DOCUMENT', 'Document does not match the student schema.' );

	}

}

async function verifyMedia( env, draftId, document ) {

	const references = [];
	for ( const [ mediaId, asset ] of Object.entries( document.narration.assets ) ) {

		const media = await statement( env, "SELECT * FROM media_objects WHERE draft_id = ? AND media_id = ? AND state = 'complete'", draftId, mediaId ).first();
		if ( ! media || media.sha256 !== asset.sha256 || media.byte_length !== asset.byteLength || media.mime_type !== asset.mimeType ) fail( 409, 'MEDIA_NOT_READY', 'Required narration is not verified for this draft.' );
		const object = await env.NARRATION.head( media.object_key );
		if ( ! object || object.size !== media.byte_length || hex( object.checksums.sha256 ) !== media.sha256 ) fail( 409, 'MEDIA_NOT_READY', 'Required narration is not verified for this draft.' );
		references.push( mediaId );

	}

	return references;

}

const acknowledgement = ( row, document, replayed = false ) => ( {
	draftId: row.draft_id,
	serverRevision: row.server_revision,
	documentRevision: row.document_revision,
	// There is no trusted teacher asset catalogue in this local foundation.
	// Uploaded narration is verified, but portable library claims alone are not.
	dependenciesVerified: Object.keys( document.assets ).length === 0 && Object.keys( document.baseScenes ).length === 0,
	replayed
} );

async function findReplay( env, draftId, id, hash ) {

	const row = await statement( env, 'SELECT * FROM draft_revisions WHERE draft_id = ? AND request_id = ?', draftId, id ).first();
	if ( row && row.request_hash !== hash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for different content or preconditions.' );
	return row;

}

async function appendRevision( env, draft, document, id, hash, baseRevision ) {

	if ( baseRevision + 1 >= limit( env, 'MAX_DRAFT_REVISIONS' ) ) fail( 429, 'DEVELOPMENT_LIMIT', 'Development revision limit reached.' );
	const references = await verifyMedia( env, draft.draft_id, document );
	const serialized = JSON.stringify( document );
	const sha256 = await digest( serialized );
	const byteLength = encoder.encode( serialized ).byteLength;
	// A unique reservation per attempt avoids cleanup/retry key reuse races.
	const objectKey = `drafts/${draft.draft_id}/${crypto.randomUUID()}.json`;
	await statement( env, "INSERT INTO object_reservations VALUES (?, 'pending', ?)", objectKey, Date.now() ).run();
	await env.DOCUMENTS.put( objectKey, serialized, { sha256, onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } } );
	const object = await env.DOCUMENTS.head( objectKey );
	if ( ! object || object.size !== byteLength || hex( object.checksums.sha256 ) !== sha256 ) fail( 503, 'STORAGE_UNAVAILABLE', 'Document storage verification failed.' );
	const serverRevision = baseRevision + 1;
	// The conditional INSERT is authoritative. Triggers commit the head/pointer
	// atomically. Media references share the same D1 transaction via batch().
	const queries = [ statement( env, `INSERT INTO draft_revisions
		(draft_id, server_revision, document_revision, project_id, request_id, request_hash, object_key, sha256, byte_length, created_at)
		SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM drafts d
		WHERE d.draft_id = ? AND d.capability_hash = ? AND d.revoked = 0 AND d.head_revision = ?
		AND EXISTS (SELECT 1 FROM object_reservations WHERE object_key = ? AND state = 'pending')`,
	draft.draft_id, serverRevision, document.revision, document.projectId, id, hash, objectKey, sha256, byteLength, Date.now(),
	draft.draft_id, draft.capability_hash, baseRevision, objectKey ) ];
	for ( const mediaId of references ) queries.push( statement( env, `INSERT INTO revision_media SELECT ?, ?, ?
		WHERE EXISTS (SELECT 1 FROM draft_revisions WHERE draft_id = ? AND server_revision = ? AND object_key = ?)`, draft.draft_id, serverRevision, mediaId, draft.draft_id, serverRevision, objectKey ) );
	try {

		const results = await env.DB.batch( queries );
		if ( results[ 0 ].meta.changes < 1 ) {

			const replay = await findReplay( env, draft.draft_id, id, hash );
			if ( replay ) return acknowledgement( replay, document, true );
			fail( 409, 'REVISION_CONFLICT', 'The draft has changed; preserve a local recovery copy before resolving.' );

		}

	} catch ( error ) {

		if ( error instanceof ApiError ) throw error;
		const replay = await findReplay( env, draft.draft_id, id, hash );
		if ( replay ) return acknowledgement( replay, document, true );
		throw error;

	}

	return acknowledgement( { draft_id: draft.draft_id, server_revision: serverRevision, document_revision: document.revision }, document );

}

async function createDraft( request, env ) {

	const hash = await capabilityHash( request );
	const id = requestId( request );
	const body = await readJson( request, env );
	shape( body, [ 'draftId', 'document' ] );
	if ( ! uuidPattern.test( body.draftId ) ) fail( 400, 'INVALID_ID', 'Expected a UUID v4 draft ID.' );
	validateDocument( body.document );
	const requestHash = await digest( JSON.stringify( [ 'create', body.document ] ) );
	let draft = await statement( env, 'SELECT * FROM drafts WHERE draft_id = ?', body.draftId ).first();
	if ( ! draft ) {

		const minute = Math.floor( Date.now() / 60000 );
		await env.DB.batch( [
			statement( env, `INSERT INTO creation_budgets VALUES (?, 1)
			ON CONFLICT(minute) DO UPDATE SET creations = creations + 1`, minute ),
			statement( env, `INSERT OR IGNORE INTO drafts
			(draft_id, capability_hash, create_request_id, create_request_hash, created_at)
			SELECT ?, ?, ?, ?, ? FROM creation_budgets WHERE minute = ? AND creations <= ?`, body.draftId, hash, id, requestHash, Date.now(), minute, limit( env, 'MAX_DRAFT_CREATIONS_PER_MINUTE' ) )
		] );
		draft = await statement( env, 'SELECT * FROM drafts WHERE draft_id = ?', body.draftId ).first();
		if ( ! draft ) fail( 429, 'DEVELOPMENT_LIMIT', 'Development draft creation limit reached.' );

	}

	if ( draft.capability_hash !== hash || draft.revoked ) fail( 401, 'UNAUTHORIZED', 'Draft ownership capability required.' );
	if ( draft.create_request_id !== id || draft.create_request_hash !== requestHash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Draft ID was already used by another creation request.' );
	const replay = await findReplay( env, draft.draft_id, id, requestHash );
	if ( replay ) return reply( acknowledgement( replay, body.document, true ) );
	return reply( await appendRevision( env, draft, body.document, id, requestHash, - 1 ), 201 );

}

async function updateDraft( request, env, draftId ) {

	const draft = await owner( request, env, draftId );
	const id = requestId( request );
	const match = /^"(0|[1-9]\d*)"$/.exec( request.headers.get( 'If-Match' ) || '' );
	if ( ! match || ! Number.isSafeInteger( Number( match[ 1 ] ) ) ) fail( 428, 'PRECONDITION_REQUIRED', 'An exact quoted server revision is required in If-Match.' );
	const baseRevision = Number( match[ 1 ] );
	const body = await readJson( request, env );
	shape( body, [ 'document' ] );
	validateDocument( body.document );
	const hash = await digest( JSON.stringify( [ 'update', baseRevision, body.document ] ) );
	const replay = await findReplay( env, draftId, id, hash );
	if ( replay ) return reply( acknowledgement( replay, body.document, true ) );
	if ( draft.head_revision !== baseRevision ) fail( 409, 'REVISION_CONFLICT', 'The draft has changed; preserve a local recovery copy before resolving.' );
	const previous = await statement( env, 'SELECT project_id, document_revision FROM draft_revisions WHERE draft_id = ? AND server_revision = ?', draftId, baseRevision ).first();
	if ( ! previous || previous.project_id !== body.document.projectId || previous.document_revision >= body.document.revision ) fail( 422, 'INVALID_SUCCESSOR', 'A successor must retain project identity and increase the portable edit revision.' );
	return reply( await appendRevision( env, draft, body.document, id, hash, baseRevision ) );

}

async function readDraft( request, env, draftId ) {

	const draft = await owner( request, env, draftId );
	const row = await statement( env, 'SELECT * FROM draft_revisions WHERE draft_id = ? AND server_revision = ?', draftId, draft.head_revision ).first();
	if ( ! row ) fail( 409, 'CREATE_INCOMPLETE', 'Retry the original draft creation request.' );
	const object = await env.DOCUMENTS.get( row.object_key );
	if ( ! object ) fail( 503, 'STORAGE_UNAVAILABLE', 'Document storage is unavailable.' );
	if ( object.size !== row.byte_length || object.size > limit( env, 'MAX_JSON_BYTES' ) ) fail( 503, 'STORAGE_UNAVAILABLE', 'Document storage verification failed.' );
	const bytes = await object.arrayBuffer();
	if ( bytes.byteLength !== row.byte_length || await digest( bytes ) !== row.sha256 ) fail( 503, 'STORAGE_UNAVAILABLE', 'Document storage verification failed.' );
	const document = JSON.parse( new TextDecoder().decode( bytes ) );
	return reply( { ...acknowledgement( row, document ), document }, 200, { ETag: `"${row.server_revision}"` } );

}

async function initiateNarration( request, env, draftId ) {

	await owner( request, env, draftId );
	const id = requestId( request );
	const body = await readJson( request, env );
	shape( body, [ 'mediaId', 'sha256', 'byteLength', 'mimeType' ] );
	if ( ! mediaPattern.test( body.mediaId ) || ! /^[a-f0-9]{64}$/.test( body.sha256 ) || ! Number.isSafeInteger( body.byteLength ) || body.byteLength < 1 || body.byteLength > limit( env, 'MAX_NARRATION_BYTES' ) || ! mimeTypes.has( body.mimeType ) ) fail( 422, 'INVALID_MEDIA', 'Invalid narration identity, digest, size or supported MIME type.' );
	const hash = await digest( JSON.stringify( body ) );
	await statement( env, `INSERT OR IGNORE INTO media_objects
		(draft_id, media_id, request_id, request_hash, object_key, sha256, byte_length, mime_type, created_at)
		SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM media_objects WHERE draft_id = ?) < ?`, draftId, body.mediaId, id, hash, `narration/${draftId}/${crypto.randomUUID()}`, body.sha256, body.byteLength, body.mimeType, Date.now(), draftId, limit( env, 'MAX_DRAFT_MEDIA' ) ).run();
	const media = await statement( env, 'SELECT * FROM media_objects WHERE draft_id = ? AND request_id = ?', draftId, id ).first();
	if ( ! media ) {

		const existing = await statement( env, 'SELECT 1 FROM media_objects WHERE draft_id = ? AND media_id = ?', draftId, body.mediaId ).first();
		if ( existing ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Media identity is immutable and already reserved.' );
		fail( 429, 'DEVELOPMENT_LIMIT', 'Development media limit reached.' );

	}

	if ( media.request_hash !== hash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for different media.' );
	// Relative owner-only endpoints; no public bucket URL or editing secret.
	return reply( { mediaId: media.media_id, state: media.state, uploadPath: `/v1/drafts/${draftId}/narration/${encodeURIComponent( media.media_id )}/content`, completePath: `/v1/drafts/${draftId}/narration/${encodeURIComponent( media.media_id )}/complete` } );

}

async function narration( request, env, draftId, mediaId, operation ) {

	await owner( request, env, draftId );
	const media = await statement( env, 'SELECT * FROM media_objects WHERE draft_id = ? AND media_id = ?', draftId, mediaId ).first();
	if ( ! media ) fail( 404, 'MEDIA_NOT_FOUND', 'Narration upload is not reserved for this draft.' );
	if ( operation === 'content' && request.method === 'PUT' ) {

		if ( request.headers.get( 'Content-Type' ) !== media.mime_type ) fail( 415, 'CONTENT_TYPE', 'Upload MIME type does not match the reservation.' );
		const bytes = await readBytes( request, Math.min( media.byte_length, limit( env, 'MAX_NARRATION_BYTES' ) ) );
		if ( bytes.byteLength !== media.byte_length || await digest( bytes ) !== media.sha256 ) fail( 422, 'MEDIA_MISMATCH', 'Upload bytes do not match the reserved digest and length.' );
		await env.NARRATION.put( media.object_key, bytes, { sha256: media.sha256, onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: media.mime_type } } );
		const object = await env.NARRATION.head( media.object_key );
		if ( ! object || object.size !== media.byte_length || hex( object.checksums.sha256 ) !== media.sha256 ) fail( 503, 'STORAGE_UNAVAILABLE', 'Narration storage verification failed.' );
		return reply( { mediaId, uploaded: true } );

	}

	if ( operation === 'complete' && request.method === 'POST' ) {

		const object = await env.NARRATION.head( media.object_key );
		if ( ! object || object.size !== media.byte_length || hex( object.checksums.sha256 ) !== media.sha256 ) fail( 409, 'MEDIA_NOT_READY', 'Narration upload has not been verified.' );
		await statement( env, "UPDATE media_objects SET state = 'complete' WHERE draft_id = ? AND media_id = ?", draftId, mediaId ).run();
		return reply( { mediaId, state: 'complete' } );

	}

	fail( 404, 'NOT_FOUND', 'Endpoint not found.' );

}

// Explicit maintenance utility, never an HTTP endpoint or automatic timer. Its
// cutoff is supplied by an operator, not an invented retention policy. Fence in
// D1 before deleting R2, retain tombstones and revisit them on later runs so a
// delayed in-flight put cannot resurrect an untracked object permanently.
export async function cleanupAbandonedDocuments( env, { cutoff, maximum = 100 } ) {

	configured( env );
	if ( ! Number.isSafeInteger( cutoff ) || ! Number.isSafeInteger( maximum ) || maximum < 1 || maximum > 1000 ) throw new TypeError( 'Invalid cleanup bounds.' );
	await statement( env, `UPDATE object_reservations SET state = 'deleting' WHERE object_key IN (
		SELECT r.object_key FROM object_reservations r WHERE r.state = 'pending' AND r.created_at < ?
		AND NOT EXISTS (SELECT 1 FROM draft_revisions v WHERE v.object_key = r.object_key) LIMIT ?
	)`, cutoff, maximum ).run();
	const { results } = await statement( env, `SELECT r.object_key FROM object_reservations r
		LEFT JOIN object_cleanup_attempts a ON a.object_key = r.object_key
		WHERE r.state = 'deleting' ORDER BY coalesce(a.last_swept_at, 0), r.created_at LIMIT ?`, maximum ).all();
	for ( const row of results ) {

		await env.DOCUMENTS.delete( row.object_key );
		await statement( env, `INSERT INTO object_cleanup_attempts VALUES (?, ?)
			ON CONFLICT(object_key) DO UPDATE SET last_swept_at = excluded.last_swept_at`, row.object_key, Date.now() ).run();

	}

	return { deleted: results.length };

}

export default {
	async fetch( request, env ) {

		try {

			assertAustralianRequest( request, env );
			const path = new URL( request.url ).pathname;
			if ( path === '/v1/student/starting-project' ) {

				if ( request.method !== 'GET' ) return reply( { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } }, 405 );
				if ( ! env.LIBRARY || env.ENABLE_CATALOGUE_API !== 'true' ) return reply( { error: { code: 'NOT_CONFIGURED', message: 'The starting project is unavailable.' } }, 503 );
				const object = await env.LIBRARY.get( 'student/shared-starting-project.json' );
				if ( ! object ) return reply( { error: { code: 'NOT_FOUND', message: 'No shared starting project is configured.' } }, 404 );
				if ( object.size > 2 * 1024 * 1024 ) return reply( { error: { code: 'INVALID_PROJECT', message: 'The shared starting project is invalid.' } }, 503 );
				let project;
				try {

					project = await object.json(); validateStudentProjectDocument( project );

				} catch {

					return reply( { error: { code: 'INVALID_PROJECT', message: 'The shared starting project is invalid.' } }, 503 );

				}

				return reply( project );

			}

			const plates = await handleR2Plates( request, env );
			if ( plates ) return plates;
			const sessionResponse = await handleAdminSessionRoute( request, env );
			if ( sessionResponse ) return sessionResponse;
			if ( path === '/v1/admin' || path.startsWith( '/v1/admin/' ) ) {

				await requireAdminSession( request, env );
				const defaults = await handleStudentDefaultRoute( request, env, readJson );
				if ( defaults ) return defaults;
				const projectRoute = await handleAccountProjectRoute( request, env, readJson, true );
				if ( projectRoute ) return projectRoute;
				const accounts = await handleStudentAccountRoute( request, env, readJson );
				if ( accounts ) return accounts;
				const catalogue = await handleCatalogueRoute( request, env );
				if ( catalogue ) return catalogue;
				return reply( { error: { code: 'ADMIN_OPERATION_NOT_IMPLEMENTED', message: 'This admin operation is not implemented.' } }, 501 );

			}

			const studentDefault = await handleStudentDefaultReadRoute( request, env );
			if ( studentDefault ) return studentDefault;
			const projectRoute = await handleAccountProjectRoute( request, env, readJson );
			if ( projectRoute ) return projectRoute;
			const accounts = await handleStudentAccountRoute( request, env, readJson );
			if ( accounts ) return accounts;
			const catalogue = await handleCatalogueRoute( request, env );
			if ( catalogue ) return catalogue;
			configured( env );
			if ( path === '/v1/drafts' && request.method === 'POST' ) return await createDraft( request, env );
			const draftPath = /^\/v1\/drafts\/([^/]+)$/.exec( path );
			if ( draftPath && uuidPattern.test( draftPath[ 1 ] ) ) {

				if ( request.method === 'GET' ) return await readDraft( request, env, draftPath[ 1 ] );
				if ( request.method === 'PUT' ) return await updateDraft( request, env, draftPath[ 1 ] );

			}

			const mediaPath = /^\/v1\/drafts\/([^/]+)\/narration(?:\/([^/]+)\/(content|complete))?$/.exec( path );
			if ( mediaPath && uuidPattern.test( mediaPath[ 1 ] ) ) {

				if ( ! mediaPath[ 2 ] && request.method === 'POST' ) return await initiateNarration( request, env, mediaPath[ 1 ] );
				let mediaId;
				try {

					mediaId = decodeURIComponent( mediaPath[ 2 ] || '' );

				} catch {

					fail( 400, 'INVALID_ID', 'Invalid media ID.' );

				}

				if ( mediaPattern.test( mediaId ) ) return await narration( request, env, mediaPath[ 1 ], mediaId, mediaPath[ 3 ] );

			}

			fail( 404, 'NOT_FOUND', 'Endpoint not found.' );

		} catch ( error ) {

			if ( error instanceof SecurityError ) return securityErrorResponse( error );
			if ( error instanceof AccountError ) return reply( { error: { code: error.code, message: error.message } }, error.status );
			if ( error instanceof CatalogueError ) return catalogueReply( { error: { code: error.code, message: error.message } }, error.status );
			if ( error instanceof ApiError ) return reply( { error: { code: error.code, message: error.message } }, error.status );
			// Do not log request/body/capability or expose provider error details.
			return reply( { error: { code: 'INTERNAL_ERROR', message: 'Backend operation failed; retry with the same request identity.' } }, 500 );

		}

	}
};
