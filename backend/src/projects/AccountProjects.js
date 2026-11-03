import { requireAccountService } from '../security/AccountConfiguration.js';
import { reserveNarrationCopy, abandonNarrationCopy } from './NarrationCopyReservations.js';
import { authenticateStudent, AccountError } from '../security/StudentAccounts.js';
import { validateStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

const encoder = new TextEncoder();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const stmt = ( env, sql, ...args ) => env.DB.prepare( sql ).bind( ...args );
const fail = ( status, code, message ) => {

	throw new AccountError( status, code, message );

};

const reply = ( value, status = 200, extra = {} ) => new Response( JSON.stringify( value ), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...extra } } );
const digest = async bytes => Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', typeof bytes === 'string' ? encoder.encode( bytes ) : bytes ) ), x => x.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const requestId = request => {

	const id = request.headers.get( 'Idempotency-Key' ) || ''; if ( ! keyPattern.test( id ) ) fail( 400, 'REQUEST_ID_REQUIRED', 'A stable Idempotency-Key is required.' ); return id;

};

const expected = request => {

	const m = /^"(0|[1-9]\d*)"$/.exec( request.headers.get( 'If-Match' ) || '' ); if ( ! m || ! Number.isSafeInteger( Number( m[ 1 ] ) ) ) fail( 428, 'PRECONDITION_REQUIRED', 'An exact revision is required.' ); return Number( m[ 1 ] );

};

const fields = ( body, names ) => {

	if ( ! body || typeof body !== 'object' || Array.isArray( body ) || Object.keys( body ).some( k => ! names.includes( k ) ) ) fail( 400, 'INVALID_BODY', 'Unexpected request shape.' );

};

const validDoc = d => {

	try {

		validateStudentProjectDocument( d );

	} catch {

		fail( 422, 'INVALID_DOCUMENT', 'Document does not match the student schema.' );

	}

};

const guard = `EXISTS (SELECT 1 FROM student_users u WHERE u.user_id=? AND u.access_state='active' AND u.access_generation=?)`;
const summary = row => ( { projectId: row.project_id, ownerId: row.user_id, name: row.title, createdAt: row.created_at, updatedAt: row.updated_at, serverRevision: row.head_revision, metadataRevision: row.metadata_revision, archived: !! row.archived } );
const selectProject = `SELECT p.*,d.head_revision FROM student_projects p LEFT JOIN drafts d ON d.draft_id=p.draft_id`;
async function project( env, id, owner = null ) {

	const row = await stmt( env, `${selectProject} WHERE p.project_id=? AND p.state='live' AND (? IS NULL OR p.user_id=?)`, id, owner, owner ).first(); if ( ! row ) fail( 404, 'NOT_FOUND', 'Project not found.' ); return row;

}

async function replay( env, principal, id, hash ) {

	await currentAccess( env, principal ); const r = await stmt( env, 'SELECT * FROM account_project_requests WHERE user_id=? AND request_id=?', principal.userId, id ).first(); if ( ! r ) return null; if ( r.request_hash !== hash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Request identity was already used.' ); return reply( JSON.parse( r.response_json ), r.response_status );

}

async function readObject( env, key, sha, size ) {

	const object = await env.DOCUMENTS.get( key ); if ( ! object || object.size !== size || size > Number( env.MAX_JSON_BYTES ) ) fail( 503, 'STORAGE_UNAVAILABLE', 'Document storage is unavailable.' ); const bytes = await object.arrayBuffer(); if ( bytes.byteLength !== size || await digest( bytes ) !== sha ) fail( 503, 'STORAGE_UNAVAILABLE', 'Document storage verification failed.' ); try {

		const d = JSON.parse( new TextDecoder().decode( bytes ) ); validDoc( d ); return d;

	} catch {

		fail( 503, 'STORAGE_UNAVAILABLE', 'Document storage verification failed.' );

	}

}

async function readRevision( env, p, revision ) {

	const r = await stmt( env, 'SELECT * FROM draft_revisions WHERE draft_id=? AND server_revision=?', p.draft_id, revision ).first(); if ( ! r ) fail( 404, 'NOT_FOUND', 'Revision not found.' ); return readObject( env, r.object_key, r.sha256, r.byte_length );

}

async function readNarration( env, p, encodedId ) {

	let mediaId; try {

		mediaId = decodeURIComponent( encodedId );

	} catch {

		fail( 404, 'NOT_FOUND', 'Narration not found.' );

	}

	if ( ! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}@[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test( mediaId ) ) fail( 404, 'NOT_FOUND', 'Narration not found.' );
	const row = await stmt( env, "SELECT * FROM media_objects WHERE draft_id=? AND media_id=? AND state='complete'", p.draft_id, mediaId ).first();
	if ( ! row ) fail( 404, 'NOT_FOUND', 'Narration not found.' );
	const object = await env.NARRATION?.get( row.object_key );
	if ( ! object || object.size !== row.byte_length || object.size > Number( env.MAX_NARRATION_BYTES ) || object.httpMetadata?.contentType !== row.mime_type ) fail( 503, 'STORAGE_UNAVAILABLE', 'Narration storage is unavailable.' );
	const bytes = await object.arrayBuffer();
	if ( bytes.byteLength !== row.byte_length || await digest( bytes ) !== row.sha256 ) fail( 503, 'STORAGE_UNAVAILABLE', 'Narration storage verification failed.' );
	return new Response( bytes, { headers: { 'Content-Type': row.mime_type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } } );

}

async function currentAccess( env, principal ) {

	const u = await stmt( env, `SELECT 1 AS ok FROM student_users WHERE user_id=? AND access_state='active' AND access_generation=?`, principal.userId, principal.generation ).first(); if ( ! u ) fail( 403, 'ACCESS_REVOKED', 'Student access has been revoked.' );

}

async function copyNarration( env, principal, source, target, doc ) {

	for ( const [ mediaId, asset ] of Object.entries( doc.narration.assets ) ) {

		const existing = await stmt( env, "SELECT * FROM media_objects WHERE draft_id=? AND media_id=? AND state='complete'", target.draft_id, mediaId ).first();
		if ( existing ) {

			if ( existing.sha256 !== asset.sha256 || existing.byte_length !== asset.byteLength || existing.mime_type !== asset.mimeType ) fail( 409, 'MEDIA_NOT_READY', 'Required narration is not verified for this project.' ); continue;

		}

		const original = await stmt( env, "SELECT * FROM media_objects WHERE draft_id=? AND media_id=? AND state='complete'", source.draft_id, mediaId ).first();
		if ( ! original || original.sha256 !== asset.sha256 || original.byte_length !== asset.byteLength || original.mime_type !== asset.mimeType ) fail( 409, 'MEDIA_NOT_READY', 'Required narration is not verified for this project.' );
		const object = await env.NARRATION?.get( original.object_key );
		if ( ! object || object.size !== original.byte_length || object.httpMetadata?.contentType !== original.mime_type ) fail( 409, 'MEDIA_NOT_READY', 'Required narration is not verified for this project.' );
		const bytes = await object.arrayBuffer(); if ( await digest( bytes ) !== original.sha256 ) fail( 409, 'MEDIA_NOT_READY', 'Required narration is not verified for this project.' );
		const objectKey = `account-narration/${target.project_id}/${crypto.randomUUID()}`;
		await reserveNarrationCopy( env, objectKey );
		try {

			await env.NARRATION.put( objectKey, bytes, { sha256: original.sha256, onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: original.mime_type } } );
			const stored = await env.NARRATION.get( objectKey );
			if ( ! stored || stored.size !== original.byte_length || await digest( await stored.arrayBuffer() ) !== original.sha256 ) fail( 503, 'STORAGE_UNAVAILABLE', 'Narration storage verification failed.' );
			await env.DB.batch( [
				stmt( env, `INSERT OR IGNORE INTO media_objects (draft_id,media_id,request_id,request_hash,object_key,sha256,byte_length,mime_type,state,created_at) SELECT ?,?,?,?,?,?,?,?,'complete',? WHERE ${guard} AND EXISTS (SELECT 1 FROM student_projects WHERE project_id=? AND user_id=? AND state='reserved') AND EXISTS (SELECT 1 FROM narration_copy_reservations WHERE object_key=? AND state='pending')`, target.draft_id, mediaId, `duplicate:${mediaId}`, original.sha256, objectKey, original.sha256, original.byte_length, original.mime_type, Date.now(), principal.userId, principal.generation, target.project_id, principal.userId, objectKey ),
				stmt( env, "UPDATE narration_copy_reservations SET state='live' WHERE object_key=? AND state='pending' AND EXISTS (SELECT 1 FROM media_objects WHERE object_key=?)", objectKey, objectKey )
			] );

		} finally {

			await abandonNarrationCopy( env, objectKey );

		}

		await currentAccess( env, principal );
		const copied = await stmt( env, "SELECT * FROM media_objects WHERE draft_id=? AND media_id=? AND state='complete'", target.draft_id, mediaId ).first();
		if ( ! copied || copied.sha256 !== original.sha256 || copied.byte_length !== original.byte_length || copied.mime_type !== original.mime_type ) fail( 409, 'MEDIA_NOT_READY', 'Required narration is not verified for this project.' );

	}

}

async function copyDefaultNarration( env, principal, target, doc ) {

	for ( const [ mediaId, asset ] of Object.entries( doc.narration.assets ) ) {

		const existing = await stmt( env, "SELECT * FROM media_objects WHERE draft_id=? AND media_id=? AND state='complete'", target.draft_id, mediaId ).first();
		if ( existing ) {

			if ( existing.sha256 !== asset.sha256 || existing.byte_length !== asset.byteLength || existing.mime_type !== asset.mimeType ) fail( 409, 'MEDIA_NOT_READY', 'Default narration is unavailable.' );
			continue;

		}

		const source = await stmt( env, 'SELECT * FROM student_default_media_objects WHERE sha256=?', asset.sha256 ).first();
		if ( ! source || source.byte_length !== asset.byteLength || source.mime_type !== asset.mimeType ) fail( 409, 'MEDIA_NOT_READY', 'Default narration is unavailable.' );
		const object = await env.NARRATION?.get( source.object_key );
		if ( ! object || object.size !== asset.byteLength || object.httpMetadata?.contentType !== asset.mimeType ) fail( 409, 'MEDIA_NOT_READY', 'Default narration is unavailable.' );
		const bytes = await object.arrayBuffer();
		if ( await digest( bytes ) !== asset.sha256 ) fail( 409, 'MEDIA_NOT_READY', 'Default narration failed verification.' );
		const objectKey = `account-narration/${target.project_id}/${crypto.randomUUID()}`;
		await reserveNarrationCopy( env, objectKey );
		try {

			await env.NARRATION.put( objectKey, bytes, { sha256: asset.sha256, onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: asset.mimeType } } );
			const stored = await env.NARRATION.get( objectKey );
			if ( ! stored || stored.size !== asset.byteLength || await digest( await stored.arrayBuffer() ) !== asset.sha256 ) fail( 503, 'STORAGE_UNAVAILABLE', 'Narration storage verification failed.' );
			await env.DB.batch( [
				stmt( env, `INSERT OR IGNORE INTO media_objects (draft_id,media_id,request_id,request_hash,object_key,sha256,byte_length,mime_type,state,created_at) SELECT ?,?,?,?,?,?,?,?,'complete',? WHERE ${guard} AND EXISTS (SELECT 1 FROM student_projects WHERE project_id=? AND user_id=? AND state='reserved') AND EXISTS (SELECT 1 FROM narration_copy_reservations WHERE object_key=? AND state='pending')`, target.draft_id, mediaId, `default:${mediaId}`, asset.sha256, objectKey, asset.sha256, asset.byteLength, asset.mimeType, Date.now(), principal.userId, principal.generation, target.project_id, principal.userId, objectKey ),
				stmt( env, "UPDATE narration_copy_reservations SET state='live' WHERE object_key=? AND state='pending' AND EXISTS (SELECT 1 FROM media_objects WHERE object_key=?)", objectKey, objectKey )
			] );

		} finally {

			await abandonNarrationCopy( env, objectKey );

		}

		await currentAccess( env, principal );
		const copied = await stmt( env, "SELECT * FROM media_objects WHERE draft_id=? AND media_id=? AND state='complete'", target.draft_id, mediaId ).first();
		if ( ! copied || copied.sha256 !== asset.sha256 || copied.byte_length !== asset.byteLength || copied.mime_type !== asset.mimeType ) fail( 409, 'MEDIA_NOT_READY', 'Default narration is unavailable.' );

	}

}

async function list( request, env, owner, includeArchived ) {

	const url = new URL( request.url ); let count = Number( url.searchParams.get( 'limit' ) || 25 ); if ( ! Number.isSafeInteger( count ) || count < 1 ) fail( 400, 'INVALID_QUERY', 'Invalid page size.' ); count = Math.min( count, 100 ); let cursor = null; try {

		if ( url.searchParams.has( 'cursor' ) ) {

			cursor = JSON.parse( atob( url.searchParams.get( 'cursor' ) ) ); if ( ! Array.isArray( cursor ) || cursor.length !== 2 || ! Number.isSafeInteger( cursor[ 0 ] ) || ! uuid.test( cursor[ 1 ] ) ) throw 0;

		}

	} catch {

		fail( 400, 'INVALID_QUERY', 'Invalid cursor.' );

	}

	const archived = includeArchived || url.searchParams.get( 'archived' ) === 'true'; const rows = ( await stmt( env, `${selectProject} WHERE p.user_id=? AND p.state='live' AND (?=1 OR p.archived=0) AND (? IS NULL OR p.updated_at<? OR (p.updated_at=? AND p.project_id<?)) ORDER BY p.updated_at DESC,p.project_id DESC LIMIT ?`, owner, archived ? 1 : 0, cursor?.[ 0 ] ?? null, cursor?.[ 0 ] ?? null, cursor?.[ 0 ] ?? null, cursor?.[ 1 ] ?? '', count + 1 ).all() ).results; const items = rows.slice( 0, count ); return reply( { items: items.map( summary ), nextCursor: rows.length > count ? btoa( JSON.stringify( [ items.at( - 1 ).updated_at, items.at( - 1 ).project_id ] ) ) : null } );

}

async function prepareProject( env, principal, id, doc, op, hash, preReserved = false ) {

	const now = Date.now();
	if ( ! preReserved ) await stmt( env, `INSERT OR IGNORE INTO student_projects (project_id,user_id,state,title,created_at,updated_at) SELECT ?,?,'reserved',?,?,? WHERE ${guard}`, id, principal.userId, doc.name, now, now, principal.userId, principal.generation ).run();
	const row = await stmt( env, 'SELECT * FROM student_projects WHERE project_id=?', id ).first();
	if ( ! row || row.user_id !== principal.userId ) {

		await currentAccess( env, principal ); fail( 409, 'PROJECT_ID_CONFLICT', 'Project identity is already in use.' );

	}

	if ( row.state === 'live' ) return row;
	await env.DB.batch( [
		stmt( env, `INSERT OR IGNORE INTO drafts (draft_id,capability_hash,create_request_id,create_request_hash,created_at) SELECT ?,?,?,?,? WHERE ${guard} AND EXISTS (SELECT 1 FROM student_projects WHERE project_id=? AND user_id=? AND state='reserved')`, id, await digest( crypto.randomUUID() ), op, hash, now, principal.userId, principal.generation, id, principal.userId ),
		stmt( env, `UPDATE student_projects SET draft_id=? WHERE project_id=? AND user_id=? AND state='reserved' AND draft_id IS NULL AND ${guard} AND EXISTS (SELECT 1 FROM drafts WHERE draft_id=? AND create_request_id=? AND create_request_hash=?)`, id, id, principal.userId, principal.userId, principal.generation, id, op, hash )
	] );
	const draft = await stmt( env, 'SELECT * FROM drafts WHERE draft_id=?', id ).first();
	if ( ! draft || draft.create_request_id !== op || draft.create_request_hash !== hash ) {

		await currentAccess( env, principal ); fail( 409, 'IDEMPOTENCY_CONFLICT', 'Project creation conflicts with another request.' );

	}

	return { ...row, draft_id: id };

}

const canonical = value => Array.isArray( value ) ? `[${value.map( canonical ).join( ',' )}]` : value && typeof value === 'object' ? `{${Object.keys( value ).sort().map( k => `${JSON.stringify( k )}:${canonical( value[ k ] )}` ).join( ',' )}}` : JSON.stringify( value );

async function verifyCatalogue( env, doc ) {

	for ( const asset of Object.values( doc.assets ) ) {

		const row = await stmt( env, 'SELECT * FROM library_assets WHERE asset_id=? AND version=?', asset.assetId, asset.version ).first();
		if ( ! row || canonical( JSON.parse( row.metadata_json ) ) !== canonical( asset ) || row.sha256 !== asset.sha256 || row.byte_length !== asset.byteLength ) fail( 409, 'DEPENDENCY_UNAVAILABLE', 'A required catalogue asset is unavailable.' );
		const object = await env.LIBRARY?.head( row.object_key );
		if ( ! object || object.size !== asset.byteLength || ! object.checksums?.sha256 || Array.from( new Uint8Array( object.checksums.sha256 ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' ) !== asset.sha256 || object.httpMetadata?.contentType !== asset.mimeType ) fail( 409, 'DEPENDENCY_UNAVAILABLE', 'A required catalogue asset failed verification.' );

	}

	for ( const scene of Object.values( doc.baseScenes ) ) {

		const row = await stmt( env, 'SELECT b.scene_json,s.definition_json,s.sha256 FROM library_base_scenes b JOIN library_supported_scenes s ON s.scene_id=b.scene_id AND s.version=b.version WHERE b.scene_id=? AND b.version=?', scene.sceneId, scene.version ).first();
		if ( ! row || canonical( JSON.parse( row.scene_json ) ) !== canonical( scene ) || await digest( row.definition_json ) !== row.sha256 ) fail( 409, 'DEPENDENCY_UNAVAILABLE', 'A required scene definition is unavailable.' );

	}

}

async function append( env, principal, p, doc, id, hash, base, operation, bootstrap = false ) {

	await verifyCatalogue( env, doc );

	const mediaIds = Object.keys( doc.narration.assets );
	for ( const mediaId of mediaIds ) {

		const a = doc.narration.assets[ mediaId ];
		const m = await stmt( env, "SELECT * FROM media_objects WHERE draft_id=? AND media_id=? AND state='complete'", p.draft_id, mediaId ).first();
		if ( ! m || m.sha256 !== a.sha256 || m.byte_length !== a.byteLength || m.mime_type !== a.mimeType ) fail( 409, 'MEDIA_NOT_READY', 'Required narration is not verified for this project.' );
		const o = await env.NARRATION?.get( m.object_key );
		if ( ! o || o.size !== m.byte_length || o.httpMetadata?.contentType !== m.mime_type || await digest( await o.arrayBuffer() ) !== m.sha256 ) fail( 409, 'MEDIA_NOT_READY', 'Required narration is not verified for this project.' );

	}

	const bytes = JSON.stringify( doc ), sha = await digest( bytes ), length = encoder.encode( bytes ).byteLength;
	if ( length > Number( env.MAX_JSON_BYTES ) ) fail( 413, 'PAYLOAD_TOO_LARGE', 'Document is too large.' );
	const objectKey = `account-projects/${p.project_id}/${crypto.randomUUID()}.json`;
	await stmt( env, "INSERT INTO object_reservations VALUES (?, 'pending', ?)", objectKey, Date.now() ).run();
	await env.DOCUMENTS.put( objectKey, bytes, { sha256: sha, onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } } );
	const object = await env.DOCUMENTS.head( objectKey );
	if ( ! object || object.size !== length || ! object.checksums?.sha256 || Array.from( new Uint8Array( object.checksums.sha256 ), x => x.toString( 16 ).padStart( 2, '0' ) ).join( '' ) !== sha ) fail( 503, 'STORAGE_UNAVAILABLE', 'Document storage verification failed.' );
	const rev = base + 1, now = Date.now();
	const ack = { projectId: p.project_id, serverRevision: rev, documentRevision: doc.revision, dependenciesVerified: true };
	const queries = [ stmt( env, `INSERT INTO draft_revisions (draft_id,server_revision,document_revision,project_id,request_id,request_hash,object_key,sha256,byte_length,created_at)
 SELECT d.draft_id,?,?,?,?,?,?,?,?,? FROM drafts d JOIN student_projects p ON p.draft_id=d.draft_id
 WHERE p.project_id=? AND p.user_id=? AND p.archived=0 AND d.head_revision=? AND d.revoked=0 AND ${guard} AND EXISTS (SELECT 1 FROM object_reservations WHERE object_key=? AND state='pending')`, rev, doc.revision, p.project_id, id, hash, objectKey, sha, length, now, p.project_id, principal.userId, base, principal.userId, principal.generation, objectKey ),
	];
	for ( const mediaId of mediaIds ) queries.push( stmt( env, `INSERT INTO revision_media SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM draft_revisions WHERE draft_id=? AND server_revision=? AND object_key=?)`, p.draft_id, rev, mediaId, p.draft_id, rev, objectKey ) );
	queries.push( stmt( env, `UPDATE student_projects SET title=CASE WHEN state='reserved' THEN ? ELSE title END,state='live',updated_at=? WHERE project_id=? AND user_id=? AND ${guard} AND EXISTS (SELECT 1 FROM draft_revisions WHERE draft_id=? AND server_revision=? AND object_key=?)`, doc.name, now, p.project_id, principal.userId, principal.userId, principal.generation, p.draft_id, rev, objectKey ) );
	if ( bootstrap ) queries.push( stmt( env, `UPDATE student_bootstraps SET state='complete',updated_at=? WHERE user_id=? AND project_id=? AND ${guard} AND EXISTS (SELECT 1 FROM draft_revisions WHERE draft_id=? AND server_revision=0 AND object_key=?)`, now, principal.userId, p.project_id, principal.userId, principal.generation, p.draft_id, objectKey ) );
	else queries.push( stmt( env, `INSERT INTO account_project_requests (user_id,request_id,request_hash,project_id,response_json,response_status,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard} AND EXISTS (SELECT 1 FROM draft_revisions WHERE draft_id=? AND server_revision=? AND object_key=?)`, principal.userId, id, hash, p.project_id, JSON.stringify( ack ), operation === 'create' ? 201 : 200, now, principal.userId, principal.generation, p.draft_id, rev, objectKey ) );
	try {

		const r = await env.DB.batch( queries ); if ( r[ 0 ].meta.changes ) return ack;

	} catch ( e ) {

		if ( ! bootstrap ) {

			const old = await replay( env, principal, id, hash ); if ( old ) return old;

		}

		await currentAccess( env, principal ); throw e;

	}

	await currentAccess( env, principal );
	if ( ! bootstrap ) {

		const old = await replay( env, principal, id, hash ); if ( old ) return old;

	}

	const current = await stmt( env, 'SELECT archived FROM student_projects WHERE project_id=? AND user_id=?', p.project_id, principal.userId ).first();
	if ( current?.archived ) fail( 409, 'PROJECT_ARCHIVED', 'Project is archived.' );
	fail( 409, 'REVISION_CONFLICT', 'Project has changed; preserve local changes.' );

}

async function bootstrap( request, env, principal, readJson ) {

	requestId( request ); fields( await readJson( request, env ), [] );
	let b = await stmt( env, 'SELECT * FROM student_bootstraps WHERE user_id=?', principal.userId ).first();
	if ( ! b ) {

		const id = crypto.randomUUID(), now = Date.now();
		await env.DB.batch( [
			stmt( env, `INSERT OR IGNORE INTO student_projects (project_id,user_id,state,title,created_at,updated_at) SELECT ?,?,'reserved','Starting project',?,? WHERE ${guard} AND EXISTS (SELECT 1 FROM student_default_head WHERE singleton=1) AND NOT EXISTS (SELECT 1 FROM student_bootstraps WHERE user_id=?)`, id, principal.userId, now, now, principal.userId, principal.generation, principal.userId ),
			stmt( env, `INSERT OR IGNORE INTO student_bootstraps (user_id,project_id,default_version_id,state,created_at,updated_at) SELECT ?,?,h.version_id,'reserved',?,? FROM student_default_head h WHERE h.singleton=1 AND ${guard} AND EXISTS (SELECT 1 FROM student_projects WHERE project_id=? AND user_id=?)`, principal.userId, id, now, now, principal.userId, principal.generation, id, principal.userId )
		] );
		b = await stmt( env, 'SELECT * FROM student_bootstraps WHERE user_id=?', principal.userId ).first();

	}

	if ( ! b ) {

		await currentAccess( env, principal ); fail( 503, 'DEFAULT_UNAVAILABLE', 'The student default is unavailable.' );

	}

	if ( b.state !== 'complete' ) {

		const v = await stmt( env, `SELECT v.* FROM student_default_versions v JOIN object_reservations o ON o.object_key=v.object_key AND o.state='live' WHERE v.version_id=?`, b.default_version_id ).first();
		if ( ! v ) fail( 503, 'DEFAULT_UNAVAILABLE', 'The student default is unavailable.' );
		const doc = await readObject( env, v.object_key, v.sha256, v.byte_length );
		doc.projectId = b.project_id; doc.revision = 0; doc.createdAt = new Date( b.created_at ).toISOString(); doc.updatedAt = doc.createdAt;
		const id = `bootstrap:${principal.userId}`, hash = await digest( JSON.stringify( doc ) );
		const p = await prepareProject( env, principal, b.project_id, doc, id, hash, true );
		if ( p.state !== 'live' ) {

			try {

				await copyDefaultNarration( env, principal, p, doc );
				await append( env, principal, p, doc, id, hash, - 1, 'create', true );

			} catch ( e ) {

				const done = await stmt( env, "SELECT 1 AS ok FROM student_bootstraps WHERE user_id=? AND state='complete'", principal.userId ).first(); if ( ! done ) throw e;

			}

		}

	}

	await currentAccess( env, principal );
	b = await stmt( env, "SELECT * FROM student_bootstraps WHERE user_id=? AND state='complete'", principal.userId ).first();
	if ( ! b ) fail( 409, 'CREATE_INCOMPLETE', 'Retry the original request.' );
	const p = await project( env, b.project_id, principal.userId ); return reply( { project: summary( p ), document: await readRevision( env, p, p.head_revision ), defaultVersionId: b.default_version_id } );

}

async function uploadBytes( request, maximum ) {

	const declared = request.headers.get( 'Content-Length' );
	if ( declared !== null && ( ! /^\d+$/.test( declared ) || Number( declared ) > maximum ) ) fail( 413, 'PAYLOAD_TOO_LARGE', 'Narration exceeds the configured limit.' );
	const reader = request.body?.getReader(); if ( ! reader ) return new Uint8Array();
	const chunks = []; let size = 0;
	try {

		while ( true ) {

			const { value, done } = await reader.read(); if ( done ) break;
			size += value.byteLength; if ( size > maximum ) {

				await reader.cancel(); fail( 413, 'PAYLOAD_TOO_LARGE', 'Narration exceeds the configured limit.' );

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

async function accountNarration( request, env, principal, projectId, encodedId, operation, readJson ) {

	const p = await stmt( env, 'SELECT * FROM student_projects WHERE project_id=? AND user_id=? AND draft_id IS NOT NULL', projectId, principal.userId ).first();
	if ( ! p ) fail( 404, 'NOT_FOUND', 'Project not found.' );
	if ( p.archived && request.method !== 'GET' ) fail( 409, 'PROJECT_ARCHIVED', 'Project is archived.' );
	const path = `/v1/student/projects/${projectId}/narration`;
	if ( ! encodedId && request.method === 'POST' ) {

		const id = requestId( request ), body = await readJson( request, env );
		fields( body, [ 'mediaId', 'sha256', 'byteLength', 'mimeType' ] );
		const maximum = Number( env.MAX_NARRATION_BYTES ), maxItems = Number( env.MAX_DRAFT_MEDIA );
		if ( ! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}@[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test( body.mediaId || '' ) || ! /^[a-f0-9]{64}$/.test( body.sha256 || '' ) || ! Number.isSafeInteger( maximum ) || ! Number.isSafeInteger( maxItems ) || ! Number.isSafeInteger( body.byteLength ) || body.byteLength < 1 || body.byteLength > maximum || ! /^audio\/(?:webm|ogg|mp4|wav)(?:;codecs=[A-Za-z0-9._-]+)?$/i.test( body.mimeType || '' ) ) fail( 422, 'INVALID_MEDIA', 'Invalid narration metadata.' );
		const hash = await digest( canonical( body ) );
		await stmt( env, `INSERT OR IGNORE INTO account_media_requests (draft_id,request_id,request_hash) SELECT ?,?,? WHERE ${guard} AND EXISTS (SELECT 1 FROM student_projects WHERE project_id=? AND user_id=? AND archived=0)`, p.draft_id, id, hash, principal.userId, principal.generation, projectId, principal.userId ).run();
		await currentAccess( env, principal );
		const operation = await stmt( env, 'SELECT request_hash FROM account_media_requests WHERE draft_id=? AND request_id=?', p.draft_id, id ).first();
		if ( ! operation ) fail( 409, 'PROJECT_ARCHIVED', 'Project is archived.' );
		if ( operation.request_hash !== hash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Request identity was already used.' );
		await stmt( env, `INSERT OR IGNORE INTO media_objects (draft_id,media_id,request_id,request_hash,object_key,sha256,byte_length,mime_type,created_at)
		SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard} AND EXISTS (SELECT 1 FROM student_projects WHERE project_id=? AND user_id=? AND archived=0) AND (SELECT count(*) FROM media_objects WHERE draft_id=?)<?`, p.draft_id, body.mediaId, id, hash, `account-narration/${projectId}/${crypto.randomUUID()}`, body.sha256, body.byteLength, body.mimeType, Date.now(), principal.userId, principal.generation, projectId, principal.userId, p.draft_id, maxItems ).run();
		await currentAccess( env, principal );
		let row = await stmt( env, 'SELECT * FROM media_objects WHERE draft_id=? AND request_id=?', p.draft_id, id ).first();
		if ( ! row ) {

			const current = await stmt( env, 'SELECT archived FROM student_projects WHERE project_id=? AND user_id=?', projectId, principal.userId ).first();
			if ( current?.archived ) fail( 409, 'PROJECT_ARCHIVED', 'Project is archived.' );
			row = await stmt( env, 'SELECT * FROM media_objects WHERE draft_id=? AND media_id=?', p.draft_id, body.mediaId ).first();
			if ( ! row ) fail( 429, 'DEVELOPMENT_LIMIT', 'Narration limit reached.' );
			if ( row.sha256 !== body.sha256 || row.byte_length !== body.byteLength || row.mime_type !== body.mimeType ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Narration identity is already reserved.' );
			return reply( { mediaId: row.media_id, state: row.state, uploadPath: `${path}/${encodeURIComponent( row.media_id )}/content`, completePath: `${path}/${encodeURIComponent( row.media_id )}/complete` } );

		}

		if ( row.request_hash !== hash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Request identity was already used.' );
		return reply( { mediaId: row.media_id, state: row.state, uploadPath: `${path}/${encodeURIComponent( row.media_id )}/content`, completePath: `${path}/${encodeURIComponent( row.media_id )}/complete` } );

	}

	let mediaId; try {

		mediaId = decodeURIComponent( encodedId || '' );

	} catch {

		fail( 404, 'NOT_FOUND', 'Narration not found.' );

	}

	const media = await stmt( env, 'SELECT * FROM media_objects WHERE draft_id=? AND media_id=?', p.draft_id, mediaId ).first();
	if ( ! media ) fail( 404, 'NOT_FOUND', 'Narration not found.' );
	if ( operation === 'content' && request.method === 'GET' ) return readNarration( env, p, encodedId );
	if ( operation === 'content' && request.method === 'PUT' ) {

		if ( request.headers.get( 'Content-Type' ) !== media.mime_type ) fail( 415, 'CONTENT_TYPE', 'Narration MIME type does not match.' );
		const bytes = await uploadBytes( request, media.byte_length );
		if ( bytes.byteLength !== media.byte_length || await digest( bytes ) !== media.sha256 ) fail( 422, 'MEDIA_MISMATCH', 'Narration bytes do not match the reservation.' );
		await env.NARRATION.put( media.object_key, bytes, { sha256: media.sha256, onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: media.mime_type } } );
		const object = await env.NARRATION.get( media.object_key );
		if ( ! object || object.size !== media.byte_length || await digest( await object.arrayBuffer() ) !== media.sha256 || object.httpMetadata?.contentType !== media.mime_type ) fail( 503, 'STORAGE_UNAVAILABLE', 'Narration storage verification failed.' );
		await currentAccess( env, principal ); return reply( { mediaId, uploaded: true } );

	}

	if ( operation === 'complete' && request.method === 'POST' ) {

		const object = await env.NARRATION.get( media.object_key );
		if ( ! object || object.size !== media.byte_length || await digest( await object.arrayBuffer() ) !== media.sha256 || object.httpMetadata?.contentType !== media.mime_type ) fail( 409, 'MEDIA_NOT_READY', 'Narration upload has not been verified.' );
		const result = await stmt( env, `UPDATE media_objects SET state='complete' WHERE draft_id=? AND media_id=? AND ${guard} AND EXISTS (SELECT 1 FROM student_projects WHERE project_id=? AND user_id=? AND archived=0)`, p.draft_id, mediaId, principal.userId, principal.generation, projectId, principal.userId ).run();
		if ( ! result.meta.changes ) {

			await currentAccess( env, principal ); fail( 409, 'PROJECT_ARCHIVED', 'Project is archived.' );

		}

		return reply( { mediaId, state: 'complete' } );

	}

	fail( 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.' );

}

export async function handleAccountProjectRoute( request, env, readJson, admin = false ) {

	const path = new URL( request.url ).pathname;
	const adminList = /^\/v1\/admin\/users\/([^/]+)\/projects$/.exec( path );
	const adminRead = /^\/v1\/admin\/projects\/([^/]+)(?:\/revisions\/(\d+))?$/.exec( path );
	const adminMedia = /^\/v1\/admin\/projects\/([^/]+)\/narration\/([^/]+)\/content$/.exec( path );
	const studentRoot = path === '/v1/student/projects', isBootstrap = path === '/v1/student/bootstrap';
	const match = /^\/v1\/student\/projects\/([^/]+)(?:\/(metadata|duplicate|revisions\/\d+))?$/.exec( path );
	const studentMedia = /^\/v1\/student\/projects\/([^/]+)\/narration(?:\/([^/]+)\/(content|complete))?$/.exec( path );
	const reservation = /^\/v1\/student\/projects\/([^/]+)\/reservation$/.exec( path );
	if ( ! adminList && ! adminRead && ! adminMedia && ! studentRoot && ! isBootstrap && ! match && ! studentMedia && ! reservation ) return null;
	requireAccountService( request, env, [ 'DOCUMENTS', 'NARRATION', 'LIBRARY' ] );
	if ( adminList || adminRead || adminMedia ) {

		if ( ! admin ) fail( 401, 'UNAUTHORIZED', 'Admin access required.' );
		if ( request.method !== 'GET' ) fail( 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.' );
		if ( adminList ) {

			if ( ! uuid.test( adminList[ 1 ] ) ) fail( 404, 'NOT_FOUND', 'User not found.' ); return list( request, env, adminList[ 1 ], true );

		}

		if ( adminMedia ) {

			if ( ! uuid.test( adminMedia[ 1 ] ) ) fail( 404, 'NOT_FOUND', 'Project not found.' ); return readNarration( env, await project( env, adminMedia[ 1 ] ), adminMedia[ 2 ] );

		}

		if ( ! uuid.test( adminRead[ 1 ] ) ) fail( 404, 'NOT_FOUND', 'Project not found.' );
		const p = await project( env, adminRead[ 1 ] ), rev = adminRead[ 2 ] === undefined ? p.head_revision : Number( adminRead[ 2 ] );
		return reply( { project: summary( p ), document: await readRevision( env, p, rev ), ...( adminRead[ 2 ] === undefined ? {} : { projectId: p.project_id, serverRevision: rev } ) } );

	}

	const principal = await authenticateStudent( request, env );
	if ( studentMedia ) {

		if ( ! uuid.test( studentMedia[ 1 ] ) ) fail( 404, 'NOT_FOUND', 'Project not found.' );
		return accountNarration( request, env, principal, studentMedia[ 1 ], studentMedia[ 2 ], studentMedia[ 3 ], readJson );

	}

	if ( reservation ) {

		if ( request.method !== 'POST' || ! uuid.test( reservation[ 1 ] ) ) fail( 404, 'NOT_FOUND', 'Project not found.' );
		const id = requestId( request ), body = await readJson( request, env ); fields( body, [ 'projectId', 'document' ] );
		if ( body.projectId !== reservation[ 1 ] || body.document?.projectId !== body.projectId ) fail( 400, 'INVALID_ID', 'Project identity is invalid.' ); validDoc( body.document );
		const hash = await digest( JSON.stringify( [ 'POST', '/v1/student/projects', body ] ) );
		const p = await prepareProject( env, principal, body.projectId, body.document, id, hash );
		if ( p.state === 'live' ) {

			const old = await replay( env, principal, id, hash ); if ( ! old ) fail( 409, 'PROJECT_ID_CONFLICT', 'Project identity is already in use.' );

		}

		return reply( { projectId: body.projectId, state: p.state } );

	}

	if ( isBootstrap && request.method === 'POST' ) return bootstrap( request, env, principal, readJson );
	if ( studentRoot && request.method === 'GET' ) return list( request, env, principal.userId, false );
	if ( studentRoot && request.method === 'POST' ) {

		const id = requestId( request ), body = await readJson( request, env ); fields( body, [ 'projectId', 'document' ] );
		if ( ! uuid.test( body.projectId || '' ) || body.document?.projectId !== body.projectId ) fail( 400, 'INVALID_ID', 'Project identity is invalid.' ); validDoc( body.document );
		const hash = await digest( JSON.stringify( [ request.method, path, body ] ) ), old = await replay( env, principal, id, hash ); if ( old ) return old;
		const p = await prepareProject( env, principal, body.projectId, body.document, id, hash );
		if ( p.state === 'live' ) {

			const existing = await replay( env, principal, id, hash ); if ( existing ) return existing; fail( 409, 'PROJECT_ID_CONFLICT', 'Project identity is already in use.' );

		}

		const result = await append( env, principal, p, body.document, id, hash, - 1, 'create' ); return result instanceof Response ? result : reply( result, 201 );

	}

	if ( ! match || ! uuid.test( match[ 1 ] ) ) fail( 404, 'NOT_FOUND', 'Project not found.' );
	const p = await project( env, match[ 1 ], principal.userId ), action = match[ 2 ];
	if ( request.method === 'GET' && ( ! action || action.startsWith( 'revisions/' ) ) ) {

		const rev = action ? Number( action.slice( 10 ) ) : p.head_revision; return reply( { project: summary( p ), document: await readRevision( env, p, rev ), ...( action ? { projectId: p.project_id, serverRevision: rev } : {} ) } );

	}

	if ( request.method === 'PUT' && ! action ) {

		const id = requestId( request ), base = expected( request ), body = await readJson( request, env ); fields( body, [ 'document' ] ); validDoc( body.document );
		const hash = await digest( JSON.stringify( [ request.method, path, base, body ] ) ), old = await replay( env, principal, id, hash ); if ( old ) return old;
		if ( p.archived ) fail( 409, 'PROJECT_ARCHIVED', 'Project is archived.' );
		if ( p.head_revision !== base ) fail( 409, 'REVISION_CONFLICT', 'Project has changed; preserve local changes.' );
		const previous = await stmt( env, 'SELECT document_revision FROM draft_revisions WHERE draft_id=? AND server_revision=?', p.draft_id, base ).first();
		if ( body.document.projectId !== p.project_id || ! previous || body.document.revision <= previous.document_revision ) fail( 422, 'INVALID_SUCCESSOR', 'Document is not a valid successor.' );
		const result = await append( env, principal, p, body.document, id, hash, base, 'update' ); return result instanceof Response ? result : reply( result );

	}

	if ( request.method === 'PATCH' && action === 'metadata' ) {

		const id = requestId( request ), base = expected( request ), body = await readJson( request, env ); fields( body, [ 'name', 'archived' ] );
		if ( ! Object.keys( body ).length || ( Object.hasOwn( body, 'name' ) && ( typeof body.name !== 'string' || ! body.name.trim() || body.name.trim().length > 200 ) ) || ( Object.hasOwn( body, 'archived' ) && typeof body.archived !== 'boolean' ) ) fail( 400, 'INVALID_BODY', 'Invalid project metadata.' );
		const hash = await digest( JSON.stringify( [ request.method, path, base, body ] ) ), old = await replay( env, principal, id, hash ); if ( old ) return old;
		const now = Date.now();
		try {

			const result = await env.DB.batch( [
				stmt( env, `UPDATE student_projects SET title=COALESCE(?,title),archived=COALESCE(?,archived),metadata_revision=metadata_revision+1,updated_at=? WHERE project_id=? AND user_id=? AND state='live' AND metadata_revision=? AND ${guard}`, body.name?.trim() ?? null, body.archived === undefined ? null : + body.archived, now, p.project_id, principal.userId, base, principal.userId, principal.generation ),
				stmt( env, `INSERT INTO account_project_requests SELECT ?,?,?,p.project_id,json_object('project',json_object('projectId',p.project_id,'ownerId',p.user_id,'name',p.title,'createdAt',p.created_at,'updatedAt',p.updated_at,'serverRevision',d.head_revision,'metadataRevision',p.metadata_revision,'archived',json(CASE WHEN p.archived=1 THEN 'true' ELSE 'false' END))),200,? FROM student_projects p JOIN drafts d ON d.draft_id=p.draft_id WHERE p.project_id=? AND changes()=1`, principal.userId, id, hash, now, p.project_id )
			] );
			if ( result[ 0 ].meta.changes ) return replay( env, principal, id, hash );

		} catch ( e ) {

			const previous = await replay( env, principal, id, hash ); if ( previous ) return previous; throw e;

		}

		await currentAccess( env, principal ); fail( 409, 'METADATA_CONFLICT', 'Project metadata has changed.' );

	}

	if ( request.method === 'POST' && action === 'duplicate' ) {

		const id = requestId( request ), body = await readJson( request, env ); fields( body, [ 'projectId', 'sourceServerRevision' ] );
		if ( ! uuid.test( body.projectId || '' ) || ! Number.isSafeInteger( body.sourceServerRevision ) || body.sourceServerRevision < 0 ) fail( 400, 'INVALID_BODY', 'Invalid duplicate request.' );
		const hash = await digest( JSON.stringify( [ request.method, path, body ] ) ), old = await replay( env, principal, id, hash ); if ( old ) return old;
		const doc = await readRevision( env, p, body.sourceServerRevision ); doc.projectId = body.projectId; doc.revision = 0;
		const now = new Date().toISOString(); doc.createdAt = now; doc.updatedAt = now;
		const target = await prepareProject( env, principal, body.projectId, doc, id, hash );
		if ( target.state === 'live' ) {

			const existing = await replay( env, principal, id, hash ); if ( existing ) return existing; fail( 409, 'PROJECT_ID_CONFLICT', 'Project identity is already in use.' );

		}

		await copyNarration( env, principal, p, target, doc );
		const result = await append( env, principal, target, doc, id, hash, - 1, 'create' ); return result instanceof Response ? result : reply( result, 201 );

	}

	fail( 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.' );

}
