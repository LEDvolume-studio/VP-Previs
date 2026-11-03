import { requireAccountService } from '../security/AccountConfiguration.js';
import { reserveNarrationCopy, abandonNarrationCopy } from '../projects/NarrationCopyReservations.js';
import { AccountError, authenticateStudent } from '../security/StudentAccounts.js';
import { validateStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

const enc = new TextEncoder();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const stmt = ( env, sql, ...args ) => env.DB.prepare( sql ).bind( ...args );
const fail = ( status, code, message ) => {

	throw new AccountError( status, code, message );

};

const reply = ( value, status = 200 ) => new Response( JSON.stringify( value ), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } } );
const digest = async value => Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', typeof value === 'string' ? enc.encode( value ) : value ) ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const hex = value => Array.from( new Uint8Array( value ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const canonical = value => Array.isArray( value ) ? `[${value.map( canonical ).join( ',' )}]` : value && typeof value === 'object' ? `{${Object.keys( value ).sort().map( k => `${JSON.stringify( k )}:${canonical( value[ k ] )}` ).join( ',' )}}` : JSON.stringify( value );
const key = request => {

	const result = request.headers.get( 'Idempotency-Key' ) || ''; if ( ! keyPattern.test( result ) ) fail( 400, 'REQUEST_ID_REQUIRED', 'A stable Idempotency-Key is required.' ); return result;

};

const checkDocument = doc => {

	try {

		validateStudentProjectDocument( doc );

	} catch {

		fail( 422, 'INVALID_DOCUMENT', 'Document does not match the student schema.' );

	}

};

async function verifiedObject( bucket, objectKey, sha, size, mime ) {

	const object = await bucket?.head( objectKey );
	if ( ! object || object.size !== size || ! object.checksums?.sha256 || hex( object.checksums.sha256 ) !== sha || ( mime && object.httpMetadata?.contentType !== mime ) ) fail( 409, 'DEPENDENCY_UNAVAILABLE', 'A required dependency is unavailable or failed verification.' );

}

async function mediaBytes( env, sha, size, mime ) {

	const row = await stmt( env, 'SELECT * FROM student_default_media_objects WHERE sha256=?', sha ).first();
	if ( ! row || row.byte_length !== size || row.mime_type !== mime ) fail( 409, 'MEDIA_NOT_READY', 'Required default narration is not verified.' );
	await verifiedObject( env.NARRATION, row.object_key, sha, size, mime );
	return row;

}

async function installMedia( env, bytes, sha, mime ) {

	const size = bytes.byteLength;
	if ( ! /^audio\/(?:webm|ogg|mp4|wav)(?:;codecs=[A-Za-z0-9._-]+)?$/i.test( mime ) || ! Number.isSafeInteger( Number( env.MAX_NARRATION_BYTES ) ) || size > Number( env.MAX_NARRATION_BYTES ) || await digest( bytes ) !== sha ) fail( 422, 'INVALID_MEDIA', 'Narration metadata or bytes are invalid.' );
	const existing = await stmt( env, 'SELECT * FROM student_default_media_objects WHERE sha256=?', sha ).first();
	if ( existing ) {

		if ( existing.byte_length !== size || existing.mime_type !== mime ) fail( 409, 'MEDIA_CONFLICT', 'Narration metadata conflicts with an existing object.' ); await verifiedObject( env.NARRATION, existing.object_key, sha, size, mime ); return;

	}

	const objectKey = `student-default/media/${sha}/${crypto.randomUUID()}`;
	await reserveNarrationCopy( env, objectKey );
	try {

		await env.NARRATION.put( objectKey, bytes, { sha256: sha, onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: mime } } );
		await verifiedObject( env.NARRATION, objectKey, sha, size, mime );
		await env.DB.batch( [
			stmt( env, "INSERT OR IGNORE INTO student_default_media_objects SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM narration_copy_reservations WHERE object_key=? AND state='pending')", sha, objectKey, size, mime, Date.now(), objectKey ),
			stmt( env, "UPDATE narration_copy_reservations SET state='live' WHERE object_key=? AND state='pending' AND EXISTS (SELECT 1 FROM student_default_media_objects WHERE object_key=?)", objectKey, objectKey )
		] );

	} finally {

		await abandonNarrationCopy( env, objectKey );

	}

	await mediaBytes( env, sha, size, mime );

}

async function boundedBytes( request, maximum ) {

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
				fail( 413, 'PAYLOAD_TOO_LARGE', 'Narration exceeds the configured limit.' );

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

async function sourceMedia( env, sourceProjectId, doc ) {

	const p = await stmt( env, "SELECT draft_id FROM student_projects WHERE project_id=? AND state='live'", sourceProjectId ).first();
	if ( ! p ) fail( 404, 'NOT_FOUND', 'Source project not found.' );
	for ( const [ mediaId, asset ] of Object.entries( doc.narration.assets ) ) {

		const row = await stmt( env, "SELECT * FROM media_objects WHERE draft_id=? AND media_id=? AND state='complete'", p.draft_id, mediaId ).first();
		if ( ! row || row.sha256 !== asset.sha256 || row.byte_length !== asset.byteLength || row.mime_type !== asset.mimeType ) fail( 409, 'MEDIA_NOT_READY', 'Source narration is unavailable.' );
		const object = await env.NARRATION.get( row.object_key );
		if ( ! object || object.size !== row.byte_length ) fail( 409, 'MEDIA_NOT_READY', 'Source narration is unavailable.' );
		await installMedia( env, await object.arrayBuffer(), asset.sha256, asset.mimeType );

	}

}

async function verifyDependencies( env, doc ) {

	const inventory = { assets: [], scenes: [], narration: [] };
	for ( const asset of Object.values( doc.assets ) ) {

		const row = await stmt( env, 'SELECT * FROM library_assets WHERE asset_id=? AND version=?', asset.assetId, asset.version ).first();
		if ( ! row || canonical( JSON.parse( row.metadata_json ) ) !== canonical( asset ) || row.sha256 !== asset.sha256 || row.byte_length !== asset.byteLength ) fail( 409, 'DEPENDENCY_UNAVAILABLE', 'A required catalogue asset is unavailable.' );
		await verifiedObject( env.LIBRARY, row.object_key, asset.sha256, asset.byteLength, asset.mimeType );
		inventory.assets.push( asset );

	}

	for ( const scene of Object.values( doc.baseScenes ) ) {

		const row = await stmt( env, 'SELECT b.scene_json,s.definition_json,s.sha256 FROM library_base_scenes b JOIN library_supported_scenes s ON s.scene_id=b.scene_id AND s.version=b.version WHERE b.scene_id=? AND b.version=?', scene.sceneId, scene.version ).first();
		if ( ! row || canonical( JSON.parse( row.scene_json ) ) !== canonical( scene ) || await digest( row.definition_json ) !== row.sha256 ) fail( 409, 'DEPENDENCY_UNAVAILABLE', 'A required scene definition is unavailable.' );
		inventory.scenes.push( { sceneId: scene.sceneId, version: scene.version, sha256: row.sha256 } );

	}

	for ( const [ mediaId, asset ] of Object.entries( doc.narration.assets ) ) {

		await mediaBytes( env, asset.sha256, asset.byteLength, asset.mimeType ); inventory.narration.push( { mediaId, sha256: asset.sha256, byteLength: asset.byteLength, mimeType: asset.mimeType } );

	}

	return inventory;

}

async function version( env, id ) {

	const row = await stmt( env, "SELECT v.* FROM student_default_versions v JOIN object_reservations o ON o.object_key=v.object_key AND o.state='live' WHERE v.version_id=?", id ).first();
	if ( ! row ) fail( 404, 'NOT_FOUND', 'Default version not found.' );
	const object = await env.DOCUMENTS.get( row.object_key );
	if ( ! object || object.size !== row.byte_length || row.byte_length > Number( env.MAX_JSON_BYTES ) ) fail( 503, 'STORAGE_UNAVAILABLE', 'Default document is unavailable.' );
	const bytes = await object.arrayBuffer();
	if ( await digest( bytes ) !== row.sha256 ) fail( 503, 'STORAGE_UNAVAILABLE', 'Default document failed integrity verification.' );
	let document; try {

		document = JSON.parse( new TextDecoder().decode( bytes ) ); checkDocument( document );

	} catch {

		fail( 503, 'STORAGE_UNAVAILABLE', 'Default document is invalid.' );

	}

	const dependencies = await verifyDependencies( env, document );
	if ( canonical( dependencies ) !== canonical( JSON.parse( row.dependencies_json ) ) ) fail( 503, 'STORAGE_UNAVAILABLE', 'Default inventory does not match the document.' );
	return { versionId: row.version_id, document, dependencies, sha256: row.sha256, createdAt: row.created_at };

}

export async function handleStudentDefaultRoute( request, env, readJson ) {

	const path = new URL( request.url ).pathname;
	const root = path === '/v1/admin/student-default';
	const versions = path === '/v1/admin/student-default/versions';
	const v = /^\/v1\/admin\/student-default\/versions\/([^/]+)$/.exec( path );
	const media = /^\/v1\/admin\/student-default\/media\/([a-f0-9]{64})$/.exec( path );
	if ( ! root && ! versions && ! v && ! media ) return null;
	requireAccountService( request, env, [ 'DOCUMENTS', 'LIBRARY', 'NARRATION' ] );
	if ( media && request.method === 'PUT' ) {

		const mime = request.headers.get( 'Content-Type' ) || '', declared = request.headers.get( 'Content-Length' );
		const maximum = Number( env.MAX_NARRATION_BYTES );
		if ( ! Number.isSafeInteger( maximum ) || maximum < 1 || ( declared && ( ! /^\d+$/.test( declared ) || Number( declared ) > maximum ) ) ) fail( 413, 'PAYLOAD_TOO_LARGE', 'Narration exceeds the configured limit.' );
		const bytes = await boundedBytes( request, maximum );
		await installMedia( env, bytes, media[ 1 ], mime ); return reply( { sha256: media[ 1 ], byteLength: bytes.byteLength } );

	}

	if ( v && request.method === 'GET' ) {

		if ( ! uuid.test( v[ 1 ] ) ) fail( 404, 'NOT_FOUND', 'Default version not found.' ); return reply( await version( env, v[ 1 ] ) );

	}

	if ( root && request.method === 'GET' ) {

		const head = await stmt( env, 'SELECT * FROM student_default_head WHERE singleton=1' ).first(); if ( ! head ) return reply( { versionId: null, revision: - 1 } ); const item = await version( env, head.version_id ); return reply( { versionId: head.version_id, revision: head.revision, version: item } );

	}

	if ( versions && request.method === 'POST' ) {

		const id = key( request ), body = await readJson( request, env );
		if ( ! body || typeof body !== 'object' || Array.isArray( body ) || Object.keys( body ).some( field => ! [ 'versionId', 'document', 'sourceProjectId' ].includes( field ) ) || ! uuid.test( body.versionId || '' ) || ( body.sourceProjectId !== undefined && ! uuid.test( body.sourceProjectId ) ) ) fail( 400, 'INVALID_BODY', 'Invalid default publication request.' );
		checkDocument( body.document );
		const hash = await digest( canonical( body ) );
		const previous = await stmt( env, 'SELECT * FROM student_default_stage_operations WHERE request_id=?', id ).first();
		if ( previous ) {

			if ( previous.request_hash !== hash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Request identity was already used.' ); return reply( await version( env, previous.version_id ), 201 );

		}

		if ( body.sourceProjectId ) await sourceMedia( env, body.sourceProjectId, body.document );
		const dependencies = await verifyDependencies( env, body.document );
		const bytes = JSON.stringify( body.document ), sha = await digest( bytes ), size = enc.encode( bytes ).byteLength;
		if ( size > Number( env.MAX_JSON_BYTES ) ) fail( 413, 'PAYLOAD_TOO_LARGE', 'Default document is too large.' );
		const objectKey = `student-default/versions/${body.versionId}/${crypto.randomUUID()}.json`, now = Date.now();
		await stmt( env, "INSERT INTO object_reservations VALUES (?, 'pending', ?)", objectKey, now ).run();
		await env.DOCUMENTS.put( objectKey, bytes, { sha256: sha, onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } } );
		await verifiedObject( env.DOCUMENTS, objectKey, sha, size, 'application/json' );
		try {

			await env.DB.batch( [ stmt( env, 'INSERT INTO student_default_versions VALUES (?,?,?,?,?,?)', body.versionId, objectKey, sha, size, JSON.stringify( dependencies ), now ), stmt( env, 'INSERT INTO student_default_stage_operations VALUES (?,?,?,?)', id, hash, body.versionId, now ) ] );

		} catch {

			const found = await stmt( env, 'SELECT * FROM student_default_stage_operations WHERE request_id=?', id ).first();
			if ( found ) {

				if ( found.request_hash !== hash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Request identity was already used.' ); return reply( await version( env, found.version_id ), 201 );

			}

			fail( 409, 'VERSION_CONFLICT', 'Default version already exists or could not be committed.' );

		}

		return reply( await version( env, body.versionId ), 201 );

	}

	if ( root && request.method === 'PUT' ) {

		const id = key( request ), body = await readJson( request, env ), match = /^"(-1|0|[1-9]\d*)"$/.exec( request.headers.get( 'If-Match' ) || '' );
		if ( ! match || ! Number.isSafeInteger( Number( match[ 1 ] ) ) ) fail( 428, 'PRECONDITION_REQUIRED', 'An exact default revision is required.' );
		if ( ! body || Object.keys( body ).length !== 1 || ! uuid.test( body.versionId || '' ) ) fail( 400, 'INVALID_BODY', 'Invalid default pointer request.' );
		const expected = Number( match[ 1 ] ), hash = await digest( canonical( [ body, expected ] ) );
		const replay = async () => {

			const row = await stmt( env, 'SELECT * FROM student_default_operations WHERE request_id=?', id ).first(); if ( ! row ) return null; if ( row.request_hash !== hash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Request identity was already used.' ); return reply( { versionId: row.version_id, revision: row.result_revision } );

		};

		const old = await replay(); if ( old ) return old;
		await version( env, body.versionId );
		try {

			await stmt( env, 'INSERT INTO student_default_operations VALUES (?,?,?,?,?,?)', id, hash, body.versionId, expected, expected + 1, Date.now() ).run();

		} catch {

			const retry = await replay(); if ( retry ) return retry; fail( 409, 'DEFAULT_CONFLICT', 'The default pointer changed; refresh before publishing.' );

		}

		return reply( { versionId: body.versionId, revision: expected + 1 } );

	}

	fail( 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.' );

}

/** Student reads use a pinned immutable version, never the mutable legacy key. */
export async function handleStudentDefaultReadRoute( request, env ) {

	const path = new URL( request.url ).pathname;
	const current = path === '/v1/student/default';
	const media = /^\/v1\/student\/default\/versions\/([^/]+)\/narration\/([a-f0-9]{64})$/.exec( path );
	if ( ! current && ! media ) return null;
	await authenticateStudent( request, env );
	if ( ! env.DOCUMENTS || ! env.LIBRARY || ! env.NARRATION ) fail( 503, 'NOT_CONFIGURED', 'Student defaults are unavailable.' );
	if ( request.method !== 'GET' ) fail( 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.' );
	if ( current ) {

		const head = await stmt( env, 'SELECT * FROM student_default_head WHERE singleton=1' ).first();
		if ( ! head ) fail( 404, 'NOT_FOUND', 'Student default is unavailable.' );
		return reply( { versionId: head.version_id, revision: head.revision, version: await version( env, head.version_id ) } );

	}

	if ( ! uuid.test( media[ 1 ] ) ) fail( 404, 'NOT_FOUND', 'Default version not found.' );
	const published = await stmt( env, 'SELECT 1 AS ok FROM student_default_operations WHERE version_id=? UNION SELECT 1 AS ok FROM student_default_head WHERE version_id=? LIMIT 1', media[ 1 ], media[ 1 ] ).first();
	if ( ! published ) fail( 404, 'NOT_FOUND', 'Default version not found.' );
	const item = await version( env, media[ 1 ] );
	const asset = Object.values( item.document.narration.assets ).find( value => value.sha256 === media[ 2 ] );
	if ( ! asset ) fail( 404, 'NOT_FOUND', 'Default narration not found.' );
	const row = await mediaBytes( env, asset.sha256, asset.byteLength, asset.mimeType );
	const object = await env.NARRATION.get( row.object_key );
	if ( ! object || object.size !== asset.byteLength ) fail( 503, 'STORAGE_UNAVAILABLE', 'Default narration is unavailable.' );
	const bytes = await object.arrayBuffer();
	if ( bytes.byteLength !== asset.byteLength || await digest( bytes ) !== asset.sha256 ) fail( 503, 'STORAGE_UNAVAILABLE', 'Default narration failed integrity verification.' );
	return new Response( bytes, { headers: { 'Content-Type': asset.mimeType, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } } );

}
