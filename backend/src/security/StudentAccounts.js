import { requireAccountService } from './AccountConfiguration.js';

const encoder = new TextEncoder();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const requestPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;

export class AccountError extends Error {

	constructor( status, code, message ) {

		super( message ); Object.assign( this, { status, code } );

	}

}
const fail = ( status, code, message ) => {

	throw new AccountError( status, code, message );

};

const stmt = ( env, sql, ...args ) => env.DB.prepare( sql ).bind( ...args );
const digest = async text => Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', encoder.encode( text ) ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
const reply = ( body, status = 200 ) => new Response( JSON.stringify( body ), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } } );
const publicUser = row => ( { userId: row.user_id, firstName: row.first_name, lastName: row.last_name, graduationYear: row.graduation_year, active: row.access_state === 'active', createdAt: row.created_at, updatedAt: row.updated_at, lastCloudActivityAt: row.last_cloud_activity_at ?? null } );

function key( request ) {

	const value = request.headers.get( 'Idempotency-Key' ) || '';
	if ( ! requestPattern.test( value ) ) fail( 400, 'REQUEST_ID_REQUIRED', 'A stable Idempotency-Key is required.' );
	return value;

}

function fields( body, creating ) {

	if ( ! body || typeof body !== 'object' || Array.isArray( body ) ) fail( 400, 'INVALID_BODY', 'Unexpected request shape.' );
	const allowed = [ 'firstName', 'lastName', 'graduationYear', ...( creating ? [] : [ 'active' ] ) ];
	if ( Object.keys( body ).some( field => ! allowed.includes( field ) ) || ( creating && ! [ 'firstName', 'lastName', 'graduationYear' ].every( field => Object.hasOwn( body, field ) ) ) || ! Object.keys( body ).length ) fail( 400, 'INVALID_BODY', 'Unexpected request shape.' );
	const out = {};
	for ( const name of [ 'firstName', 'lastName' ] ) if ( Object.hasOwn( body, name ) ) {

		if ( typeof body[ name ] !== 'string' || ! body[ name ].trim() || body[ name ].trim().length > 100 ) fail( 400, 'INVALID_BODY', 'A valid name is required.' );
		out[ name ] = body[ name ].trim();

	}

	if ( Object.hasOwn( body, 'graduationYear' ) ) {

		if ( ! Number.isInteger( body.graduationYear ) || body.graduationYear < 1900 || body.graduationYear > 9999 ) fail( 400, 'INVALID_BODY', 'A valid graduation year is required.' );
		out.graduationYear = body.graduationYear;

	}

	if ( Object.hasOwn( body, 'active' ) ) {

		if ( typeof body.active !== 'boolean' ) fail( 400, 'INVALID_BODY', 'Invalid access state.' );
		out.active = body.active;

	}

	return out;

}

function requestHash( request, body ) {

	return digest( JSON.stringify( [ request.method, new URL( request.url ).pathname, body ] ) );

}

async function adminReplay( env, id, hash ) {

	const row = await stmt( env, 'SELECT * FROM student_admin_operations WHERE request_id = ?', id ).first();
	if ( ! row ) return null;
	if ( row.request_hash !== hash ) fail( 409, 'IDEMPOTENCY_CONFLICT', 'Request identity was already used.' );
	return reply( JSON.parse( row.result_json ), row.response_status );

}

export async function authenticateStudent( request, env ) {

	requireAccountService( request, env );
	const match = /^Bearer ([a-f0-9-]+)$/.exec( request.headers.get( 'Authorization' ) || '' );
	if ( ! match || ! uuid.test( match[ 1 ] ) ) fail( 401, 'UNAUTHORIZED', 'Student credential required.' );
	const hash = await digest( match[ 1 ] );
	const row = await stmt( env, 'SELECT * FROM student_users WHERE credential_hash = ?', hash ).first();
	if ( ! row ) fail( 401, 'UNAUTHORIZED', 'Student credential required.' );
	if ( row.access_state !== 'active' ) fail( 403, 'ACCESS_REVOKED', 'Student access has been revoked.' );
	return { userId: row.user_id, generation: row.access_generation, user: publicUser( row ) };

}

// Embed this predicate in the final D1 mutation, in the same statement as its
// data change. Authentication at request start alone does not fence revocation.
export function studentProjectWriteGuard( principal, projectId ) {

	return { sql: `EXISTS (SELECT 1 FROM student_projects p JOIN student_users u ON u.user_id = p.user_id WHERE p.project_id = ? AND p.user_id = ? AND p.state = 'live' AND p.archived = 0 AND u.access_state = 'active' AND u.access_generation = ?)`, bindings: [ projectId, principal.userId, principal.generation ] };

}

export async function handleStudentAccountRoute( request, env, readJson ) {

	const url = new URL( request.url ), path = url.pathname;
	const isMe = path === '/v1/student/me';
	const isUsers = path === '/v1/admin/users';
	const match = /^\/v1\/admin\/users\/([^/]+)(\/access-link)?$/.exec( path );
	if ( ! isMe && ! isUsers && ! match ) return null;
	requireAccountService( request, env );
	if ( isMe && request.method === 'GET' ) {

		const principal = await authenticateStudent( request, env );
		const { userId, firstName, lastName, graduationYear } = principal.user;
		return reply( { user: { userId, firstName, lastName, graduationYear }, accessGeneration: principal.generation } );

	}

	if ( isUsers && request.method === 'GET' ) {

		const rawLimit = url.searchParams.get( 'limit' ) || '25';
		if ( ! /^\d+$/.test( rawLimit ) || Number( rawLimit ) < 1 ) fail( 400, 'INVALID_QUERY', 'Invalid page size.' );
		const max = Math.min( Number( rawLimit ), 100 );
		let cursor = null;
		try {

			if ( url.searchParams.has( 'cursor' ) ) {

				cursor = JSON.parse( atob( url.searchParams.get( 'cursor' ) ) ); if ( ! Array.isArray( cursor ) || cursor.length !== 2 || ! Number.isSafeInteger( cursor[ 0 ] ) || ! uuid.test( cursor[ 1 ] ) ) throw new Error();

			}

		} catch {

			fail( 400, 'INVALID_QUERY', 'Invalid cursor.' );

		}

		const q = ( url.searchParams.get( 'q' ) || '' ).trim().toLowerCase();
		if ( q.length > 100 ) fail( 400, 'INVALID_QUERY', 'Invalid search.' );
		const rows = await stmt( env, `SELECT u.*, (SELECT MAX(p.updated_at) FROM student_projects p WHERE p.user_id=u.user_id AND p.state='live') AS last_cloud_activity_at FROM student_users u WHERE (? = '' OR instr(lower(first_name || ' ' || last_name || ' ' || graduation_year), ?) > 0) AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND user_id < ?)) ORDER BY updated_at DESC, user_id DESC LIMIT ?`, q, q, cursor?.[ 0 ] ?? null, cursor?.[ 0 ] ?? null, cursor?.[ 0 ] ?? null, cursor?.[ 1 ] ?? '', max + 1 ).all();
		const items = rows.results.slice( 0, max );
		return reply( { items: items.map( publicUser ), nextCursor: rows.results.length > max ? btoa( JSON.stringify( [ items.at( - 1 ).updated_at, items.at( - 1 ).user_id ] ) ) : null } );

	}

	if ( match && ! uuid.test( match[ 1 ] ) ) fail( 404, 'NOT_FOUND', 'User not found.' );
	if ( match && ! match[ 2 ] && request.method === 'GET' ) {

		const row = await stmt( env, "SELECT u.*, (SELECT MAX(p.updated_at) FROM student_projects p WHERE p.user_id=u.user_id AND p.state='live') AS last_cloud_activity_at FROM student_users u WHERE u.user_id = ?", match[ 1 ] ).first();
		if ( ! row ) fail( 404, 'NOT_FOUND', 'User not found.' );
		return reply( { user: publicUser( row ) } );

	}

	if ( ( isUsers && request.method === 'POST' ) || ( match && ! match[ 2 ] && request.method === 'PATCH' ) ) {

		const id = key( request ), body = fields( await readJson( request, env ), isUsers ), hash = await requestHash( request, body );
		const replay = await adminReplay( env, id, hash ); if ( replay ) return replay;
		const now = Date.now(), userId = isUsers ? crypto.randomUUID() : match[ 1 ];
		const old = isUsers ? null : await stmt( env, 'SELECT * FROM student_users WHERE user_id = ?', userId ).first();
		if ( ! isUsers && ! old ) fail( 404, 'NOT_FOUND', 'User not found.' );
		const status = isUsers ? 201 : 200;
		// Only mutate fields actually supplied, so a name edit racing a revocation
		// cannot restore stale access state. Evaluate access changes in D1 itself.
		const requestedState = body.active === undefined ? null : body.active ? 'active' : 'revoked';
		const mutation = isUsers ? stmt( env, 'INSERT INTO student_users (user_id,first_name,last_name,graduation_year,created_at,updated_at) VALUES (?,?,?,?,?,?)', userId, body.firstName, body.lastName, body.graduationYear, now, now ) : stmt( env, `UPDATE student_users SET first_name=COALESCE(?,first_name),last_name=COALESCE(?,last_name),graduation_year=COALESCE(?,graduation_year),access_generation=access_generation+CASE WHEN ? IS NOT NULL AND access_state<>? THEN 1 ELSE 0 END,credential_hash=CASE WHEN ?='active' AND access_state='revoked' THEN NULL ELSE credential_hash END,access_state=COALESCE(?,access_state),updated_at=? WHERE user_id=?`, body.firstName ?? null, body.lastName ?? null, body.graduationYear ?? null, requestedState, requestedState, requestedState, requestedState, now, userId );
		try {

			// Capture the actual committed user state in the same D1 transaction.
			// A concurrent revoke or profile edit cannot make the replay stale.
			await env.DB.batch( [ mutation, stmt( env, `INSERT INTO student_admin_operations SELECT ?,?,json_object('user',json_object('userId',user_id,'firstName',first_name,'lastName',last_name,'graduationYear',graduation_year,'active',json(CASE WHEN access_state='active' THEN 'true' ELSE 'false' END),'createdAt',created_at,'updatedAt',updated_at,'lastCloudActivityAt',NULL)),?,? FROM student_users WHERE user_id=?`, id, hash, status, now, userId ) ] );

		} catch ( error ) {

			const previous = await adminReplay( env, id, hash ); if ( previous ) return previous; throw error;

		}

		return await adminReplay( env, id, hash );

	}

	if ( match && match[ 2 ] && request.method === 'POST' ) {

		let loginOrigin = url.origin;
		if ( env.STUDENT_LOGIN_ORIGIN ) {

			try {

				const configuredOrigin = new URL( env.STUDENT_LOGIN_ORIGIN );
				if ( configuredOrigin.protocol !== 'https:' || configuredOrigin.origin !== env.STUDENT_LOGIN_ORIGIN || configuredOrigin.username || configuredOrigin.password ) throw new Error();
				loginOrigin = configuredOrigin.origin;

			} catch {

				fail( 503, 'NOT_CONFIGURED', 'The student login origin is unavailable.' );

			}

		}

		const id = key( request ), body = await readJson( request, env );
		if ( ! body || typeof body !== 'object' || Array.isArray( body ) || Object.keys( body ).length ) fail( 400, 'INVALID_BODY', 'Unexpected request shape.' );
		const hash = await requestHash( request, body ), userId = match[ 1 ];
		const replay = async () => {

			const row = await stmt( env, 'SELECT request_hash FROM student_access_issuance_operations WHERE user_id=? AND request_id=?', userId, id ).first(); if ( row ) fail( 409, row.request_hash === hash ? 'LINK_ALREADY_ISSUED' : 'IDEMPOTENCY_CONFLICT', 'Request identity was already used.' );

		};

		await replay();
		const credential = crypto.randomUUID(), credentialHash = await digest( credential ), now = Date.now();
		const results = await env.DB.batch( [ stmt( env, `UPDATE student_users SET credential_hash=?,access_generation=access_generation+1,updated_at=? WHERE user_id=? AND access_state='active' AND NOT EXISTS (SELECT 1 FROM student_access_issuance_operations WHERE user_id=? AND request_id=?)`, credentialHash, now, userId, userId, id ), stmt( env, `INSERT OR IGNORE INTO student_access_issuance_operations SELECT user_id,?,?,access_generation,? FROM student_users WHERE user_id=? AND credential_hash=?`, id, hash, now, userId, credentialHash ) ] );
		if ( ! results[ 0 ].meta.changes ) {

			await replay(); const user = await stmt( env, 'SELECT access_state FROM student_users WHERE user_id=?', userId ).first(); if ( ! user ) fail( 404, 'NOT_FOUND', 'User not found.' ); fail( 409, 'ACCESS_REVOKED', 'Restore access before issuing a link.' );

		}

		const operation = await stmt( env, 'SELECT access_generation FROM student_access_issuance_operations WHERE user_id=? AND request_id=?', userId, id ).first();
		return reply( { loginUrl: `${loginOrigin}/student/#login=${credential}`, accessGeneration: operation.access_generation } );

	}

	fail( 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.' );

}
