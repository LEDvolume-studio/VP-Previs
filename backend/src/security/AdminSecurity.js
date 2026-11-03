const encoder = new TextEncoder();
export const ADMIN_COOKIE = '__Host-rayzee-admin';
const cookiePattern = new RegExp( `(?:^|;\\s*)${ADMIN_COOKIE}=([^;]*)` );
const baseHeaders = {
	'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
	'X-Content-Type-Options': 'nosniff',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'credentialless'
};

export class SecurityError extends Error {

	constructor( status, code, message ) {

		super( message );
		Object.assign( this, { status, code } );

	}

}
const reject = ( status, code, message ) => {

	throw new SecurityError( status, code, message );

};

export const securityResponse = ( body, status = 200, headers = {} ) => new Response( JSON.stringify( body ), { status, headers: { ...baseHeaders, 'Content-Type': 'application/json', ...headers } } );
export const securityErrorResponse = error => securityResponse( { error: { code: error instanceof SecurityError ? error.code : 'SECURITY_UNAVAILABLE', message: error instanceof SecurityError ? error.message : 'Security checks are unavailable.' } }, error instanceof SecurityError ? error.status : 503 );

export function assertAustralianRequest( request, env ) {

	// Never read CF-IPCountry, X-Country or any other caller-supplied header.
	// Hosted environments cannot activate the local exemption with a flag alone.
	if ( [ 'local', 'test' ].includes( env.ENVIRONMENT ) && env.ALLOW_LOCAL_GEO_EXEMPTION === 'true' ) return;
	if ( request.cf?.country !== 'AU' ) reject( 403, 'AUSTRALIA_ONLY', 'This service is available in Australia only.' );

}

function encode( value ) {

	return btoa( String.fromCharCode( ...new Uint8Array( value ) ) ).replaceAll( '+', '-' ).replaceAll( '/', '_' ).replace( /=+$/, '' );

}

function decode( value ) {

	if ( typeof value !== 'string' || ! /^[A-Za-z0-9_-]+$/.test( value ) ) throw new Error( 'Invalid encoding.' );
	const bytes = Uint8Array.from( atob( value.replaceAll( '-', '+' ).replaceAll( '_', '/' ) ), character => character.charCodeAt( 0 ) );
	if ( encode( bytes ) !== value ) throw new Error( 'Noncanonical encoding.' );
	return bytes;

}

const credentialVersion = async verifier => encode( await crypto.subtle.digest( 'SHA-256', encoder.encode( verifier ) ) );

function configuration( env ) {

	const development = [ 'local', 'test' ].includes( env.ENVIRONMENT );
	if ( ! development && env.ENABLE_HOSTED_ADMIN_AUTH !== 'true' ) reject( 503, 'HOSTED_ADMIN_AUTH_NOT_ENABLED', 'Hosted admin password protection has not been enabled.' );
	try {

		const match = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec( env.ADMIN_PASSWORD_VERIFIER || '' );
		if ( ! match ) throw new Error( 'Missing verifier.' );
		const iterations = Number( match[ 1 ] );
		const salt = decode( match[ 2 ] ), expected = decode( match[ 3 ] );
		const secret = decode( env.ADMIN_SESSION_SECRET || '' );
		// The iteration count is provisioned explicitly with the verifier. The
		// low test bound is not a production password-strength recommendation.
		if ( ! Number.isSafeInteger( iterations ) || iterations < ( development ? 1000 : 100000 ) || iterations > 2000000 || salt.byteLength < 16 || salt.byteLength > 64 || expected.byteLength !== 32 || secret.byteLength !== 32 ) throw new Error( 'Invalid verifier.' );
		const lifetime = Number( env.ADMIN_SESSION_SECONDS ?? 3600 );
		const attemptLimit = Number( env.ADMIN_LOGIN_ATTEMPTS_PER_MINUTE ?? 10 );
		if ( ! Number.isSafeInteger( lifetime ) || lifetime < 60 || lifetime > 86400 || ! Number.isSafeInteger( attemptLimit ) || attemptLimit < 1 || attemptLimit > 1000 ) throw new Error( 'Invalid session bounds.' );
		if ( ! env.ADMIN_AUTH_DB ) throw new Error( 'Missing auth database.' );
		return { iterations, salt, expected, secret, lifetime, attemptLimit };

	} catch {

		reject( 503, 'ADMIN_AUTH_NOT_CONFIGURED', 'Admin password protection is not configured.' );

	}

}

function sameOrigin( request ) {

	const origin = new URL( request.url ).origin;
	const site = request.headers.get( 'Sec-Fetch-Site' );
	if ( request.headers.get( 'Origin' ) !== origin || ( site && site !== 'same-origin' ) ) reject( 403, 'SAME_ORIGIN_REQUIRED', 'A same-origin request is required.' );

}

function transport( request, env ) {

	if ( new URL( request.url ).protocol !== 'https:' && ! ( [ 'local', 'test' ].includes( env.ENVIRONMENT ) && [ 'localhost', '127.0.0.1', '[::1]' ].includes( new URL( request.url ).hostname ) ) ) reject( 403, 'HTTPS_REQUIRED', 'HTTPS is required.' );

}

const signingKey = config => crypto.subtle.importKey( 'raw', config.secret, { name: 'HMAC', hash: 'SHA-256' }, false, [ 'sign', 'verify' ] );
const cookie = ( value, age ) => `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

async function readPassword( request ) {

	const maximum = 4096;
	const reader = request.body?.getReader();
	if ( ! reader ) reject( 400, 'INVALID_LOGIN', 'Enter the admin password.' );
	const chunks = [];
	let size = 0;
	try {

		while ( true ) {

			const { value, done } = await reader.read();
			if ( done ) break;
			size += value.byteLength;
			if ( size > maximum ) {

				await reader.cancel(); reject( 413, 'PAYLOAD_TOO_LARGE', 'Login request is too large.' );

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

	let password;
	try {

		const text = new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes );
		const type = request.headers.get( 'Content-Type' )?.split( ';' )[ 0 ].trim();
		if ( type === 'application/json' ) {

			const value = JSON.parse( text );
			if ( ! value || Object.keys( value ).length !== 1 || ! Object.hasOwn( value, 'password' ) ) throw new Error( 'Invalid shape.' );
			password = value.password;

		} else if ( type === 'application/x-www-form-urlencoded' ) {

			const form = new URLSearchParams( text );
			if ( [ ...form.keys() ].length !== 1 || ! form.has( 'password' ) ) throw new Error( 'Invalid form.' );
			password = form.get( 'password' );

		} else throw new Error( 'Unsupported content type.' );

	} catch {

		reject( 400, 'INVALID_LOGIN', 'Enter the admin password.' );

	}

	if ( typeof password !== 'string' || ! password.length || encoder.encode( password ).byteLength > 1024 ) reject( 400, 'INVALID_LOGIN', 'Enter the admin password.' );
	return password;

}

async function issueSession( request, env, config ) {

	const minute = Math.floor( Date.now() / 60000 );
	const result = await configDatabase( env ).prepare( `INSERT INTO admin_login_budgets VALUES (?, 1)
		ON CONFLICT(minute) DO UPDATE SET attempts = attempts + 1 RETURNING attempts` ).bind( minute ).first();
	if ( result.attempts > config.attemptLimit ) reject( 429, 'LOGIN_RATE_LIMITED', 'Too many sign-in attempts. Try again later.' );
	const password = await readPassword( request );
	const material = await crypto.subtle.importKey( 'raw', encoder.encode( password ), 'PBKDF2', false, [ 'deriveBits' ] );
	const actual = await crypto.subtle.deriveBits( { name: 'PBKDF2', salt: config.salt, iterations: config.iterations, hash: 'SHA-256' }, material, 256 );
	if ( ! crypto.subtle.timingSafeEqual( actual, config.expected ) ) reject( 401, 'INVALID_PASSWORD', 'The admin password was not accepted.' );
	const now = Math.floor( Date.now() / 1000 );
	const payload = { v: 1, iat: now, exp: now + config.lifetime, origin: new URL( request.url ).origin, credentialVersion: await credentialVersion( env.ADMIN_PASSWORD_VERIFIER ), nonce: crypto.randomUUID() };
	const encoded = encode( encoder.encode( JSON.stringify( payload ) ) );
	const signature = encode( await crypto.subtle.sign( 'HMAC', await signingKey( config ), encoder.encode( encoded ) ) );
	const headers = { 'Set-Cookie': cookie( `${encoded}.${signature}`, config.lifetime ) };
	if ( request.headers.get( 'Content-Type' )?.startsWith( 'application/x-www-form-urlencoded' ) ) return new Response( null, { status: 303, headers: { ...baseHeaders, ...headers, Location: '/' } } );
	return securityResponse( { authenticated: true, expiresAt: new Date( payload.exp * 1000 ).toISOString() }, 200, headers );

}

const configDatabase = env => env.ADMIN_AUTH_DB;

export async function requireAdminSession( request, env ) {

	transport( request, env );
	const config = configuration( env );
	if ( ! [ 'GET', 'HEAD', 'OPTIONS' ].includes( request.method ) ) sameOrigin( request );
	try {

		const token = cookiePattern.exec( request.headers.get( 'Cookie' ) || '' )?.[ 1 ];
		if ( ! token || token.length > 2048 ) throw new Error( 'Missing session.' );
		const parts = token.split( '.' );
		if ( parts.length !== 2 || ! await crypto.subtle.verify( 'HMAC', await signingKey( config ), decode( parts[ 1 ] ), encoder.encode( parts[ 0 ] ) ) ) throw new Error( 'Invalid signature.' );
		const payload = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( decode( parts[ 0 ] ) ) );
		const now = Math.floor( Date.now() / 1000 );
		if ( payload.v !== 1 || ! Number.isSafeInteger( payload.iat ) || ! Number.isSafeInteger( payload.exp ) || payload.iat > now || payload.exp <= now || payload.exp - payload.iat !== config.lifetime || payload.origin !== new URL( request.url ).origin || payload.credentialVersion !== await credentialVersion( env.ADMIN_PASSWORD_VERIFIER ) ) throw new Error( 'Expired or invalid session.' );
		return payload;

	} catch {

		reject( 401, 'ADMIN_SESSION_REQUIRED', 'Sign in with the admin password.' );

	}

}

function signInPage( { status = 200, message = '' } = {} ) {

	// Only fixed server-defined messages are inserted into this page.
	const notice = message ? `<div class="notice" role="alert">${message}</div>` : '';
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Admin sign in · Sim Trav</title><style>
	*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0e1219;color:#eef2f7;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(100%,430px);padding:36px;border:1px solid #303b4b;border-radius:18px;background:#171e29;box-shadow:0 24px 70px #0006}.brand{color:#9db0c9;font-size:12px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}.badge{display:inline-grid;place-items:center;width:38px;height:38px;margin-right:10px;border-radius:11px;background:#284b68;color:#b9dfff;font-size:18px;vertical-align:middle}h1{margin:28px 0 8px;font-size:28px;line-height:1.2;letter-spacing:-.03em}p{margin:0;color:#adb9c9}.description{margin-bottom:26px}label{display:block;margin-bottom:8px;font-size:14px;font-weight:650}input{width:100%;height:50px;padding:0 14px;border:1px solid #4a5a6e;border-radius:9px;background:#0d131d;color:#fff;font:inherit}input:focus{outline:2px solid #75c8f5;outline-offset:2px}button{width:100%;height:50px;margin-top:18px;border:0;border-radius:9px;background:#a1daf7;color:#102435;font:inherit;font-weight:750;cursor:pointer}button:hover{background:#c3e9fc}button:focus-visible,a:focus-visible{outline:2px solid #75c8f5;outline-offset:3px}.notice{margin-bottom:20px;padding:12px 14px;border:1px solid #a54f4f;border-radius:9px;background:#3d2329;color:#ffd2d2;font-size:14px}.student{margin-top:27px;padding-top:22px;border-top:1px solid #303b4b;font-size:14px}.student a{color:#a1daf7;text-decoration:none}.student a:hover{text-decoration:underline}@media(max-width:480px){main{padding:27px}}
	</style></head><body><main><div class="brand"><span class="badge" aria-hidden="true">◈</span> Sim Trav</div><h1>Admin sign in</h1><p class="description">Enter your admin password to open the editor and manage scene presets and driving plates.</p>${notice}<form method="post" action="/v1/admin/session"><label for="password">Admin password</label><input id="password" type="password" name="password" autocomplete="current-password" required autofocus><button type="submit">Sign in to editor</button></form><p class="student">Looking for the student editor? <a href="/student/">Open student workspace →</a></p></main></body></html>`;
	return new Response( html, { status, headers: { ...baseHeaders, 'Referrer-Policy': 'same-origin', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } } );

}

export async function handleAdminSessionRoute( request, env ) {

	const path = new URL( request.url ).pathname;
	if ( path === '/admin/sign-in' && request.method === 'GET' ) {

		transport( request, env );
		configuration( env );
		return signInPage();

	}

	if ( path !== '/v1/admin/session' ) return null;
	transport( request, env );
	if ( request.method === 'POST' ) {

		sameOrigin( request );
		try {

			return await issueSession( request, env, configuration( env ) );

		} catch ( error ) {

			if ( request.headers.get( 'Content-Type' )?.split( ';' )[ 0 ].trim() === 'application/x-www-form-urlencoded' && error instanceof SecurityError ) {

				if ( error.code === 'INVALID_PASSWORD' || error.code === 'INVALID_LOGIN' ) return signInPage( { status: error.status, message: 'That password was not accepted. Please try again.' } );
				if ( error.code === 'LOGIN_RATE_LIMITED' ) return signInPage( { status: error.status, message: 'Too many attempts. Please wait a minute and try again.' } );

			}

			throw error;

		}

	}

	if ( request.method === 'DELETE' ) {

		await requireAdminSession( request, env );
		return securityResponse( { authenticated: false }, 200, { 'Set-Cookie': cookie( '', 0 ) } );

	}

	if ( request.method === 'GET' ) {

		const session = await requireAdminSession( request, env );
		return securityResponse( { authenticated: true, expiresAt: new Date( session.exp * 1000 ).toISOString() } );

	}

	return securityResponse( { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } }, 405 );

}
