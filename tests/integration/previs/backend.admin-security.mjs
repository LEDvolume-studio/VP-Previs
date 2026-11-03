import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { studentOfflinePlugin } from '../../../app/build/studentOfflinePlugin.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const root = fileURLToPath( new URL( '../../../', import.meta.url ) );
const password = randomUUID(); // Ephemeral test material, never a deployed password.
const salt = randomBytes( 16 ), secret = randomBytes( 32 );
const verifier = `pbkdf2-sha256$1000$${salt.toString( 'base64url' )}$${pbkdf2Sync( password, salt, 1000, 32, 'sha256' ).toString( 'base64url' )}`;
const origin = 'https://previs.example.test';
let script, migration, compiledPages;
const html = '<!doctype html><title>Student workspace fixture</title>';
const graph = {
	'student/index.html': { type: 'asset', source: html },
	'assets/student.js': { type: 'chunk', isEntry: true, name: 'student', fileName: 'assets/student.js', code: 'globalThis.studentFixture = true;', imports: [ 'assets/shared.js' ], dynamicImports: [ 'assets/student-viewport.js' ] },
	'assets/student-viewport.js': { type: 'chunk', code: 'globalThis.studentViewport = true;', imports: [] },
	'assets/shared.js': { type: 'chunk', code: 'globalThis.sharedFixture = true;', imports: [] },
	'assets/admin.js': { type: 'chunk', isEntry: true, name: 'index', code: 'private admin fixture', imports: [] },
	'assets/diagnostic.js': { type: 'chunk', isEntry: true, name: 'studentDiagnostic', code: 'private diagnostic fixture', imports: [] }
};
const emitted = [];
studentOfflinePlugin().generateBundle.handler.call( { emitFile: value => emitted.push( value ) }, {}, graph );
const securityManifest = emitted.find( value => value.fileName === 'student/edge-public-assets.json' );
const serviceWorker = emitted.find( value => value.fileName === 'student/sw.js' );
const assetFixtures = {
	'/': { type: 'text/html', body: '<!doctype html>PRIVATE ADMIN HTML' },
	'/student/': { type: 'text/html', body: html },
	'/student/index.html': { type: 'text/html', body: html },
	'/student/sw.js': { type: 'text/javascript', body: serviceWorker.source },
	'/student/edge-public-assets.json': { type: 'application/json', body: securityManifest.source },
	'/assets/student.js': { type: 'text/javascript', body: graph[ 'assets/student.js' ].code },
	'/assets/student-viewport.js': { type: 'text/javascript', body: graph[ 'assets/student-viewport.js' ].code },
	'/assets/shared.js': { type: 'text/javascript', body: graph[ 'assets/shared.js' ].code },
	'/assets/admin.js': { type: 'text/javascript', body: 'PRIVATE ADMIN JS' },
	'/student/diagnostic/': { type: 'text/html', body: 'PRIVATE DIAGNOSTIC HTML' }
};

before( async () => {
	script = ( await build( {
		stdin: { contents: `import { onRequest } from './functions/_middleware.js'; export default {fetch(request,env){return onRequest({request,env,next:()=>env.ASSETS.fetch(request)});}};`, resolveDir: root },
		bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022'
	} ) ).outputFiles[ 0 ].text;
	migration = await readFile( `${root}backend/migrations/0003_admin_password.sql`, 'utf8' );
	const packaged = spawnSync( process.execPath, [ `${root}backend/scripts/local-cli.mjs`, 'pages' ], { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } } );
	assert.equal( packaged.status, 0, packaged.stderr );
	compiledPages = await readFile( `${root}backend/dist-pages/index.js`, 'utf8' );
	const routes = JSON.parse( await readFile( `${root}backend/dist-pages/_routes.json`, 'utf8' ) );
	assert.deepEqual( routes.include, [ '/*' ] );
	assert.deepEqual( routes.exclude, [] );
} );

async function harness( t, { bindings = {}, files = {}, cf = { country: 'AU' }, configured = true, edgeScript = script } = {} ) {
	const env = { ENVIRONMENT: 'test', ALLOW_LOCAL_GEO_EXEMPTION: 'false', ADMIN_SESSION_SECONDS: '3600', ADMIN_LOGIN_ATTEMPTS_PER_MINUTE: '10', ...( configured ? { ADMIN_PASSWORD_VERIFIER: verifier, ADMIN_SESSION_SECRET: secret.toString( 'base64url' ) } : {} ), ...bindings };
	const instance = new Miniflare( {
		cf,
		workers: [
			{ name: 'edge', modules: true, script: edgeScript, compatibilityDate: '2026-07-30', bindings: env, d1Databases: [ 'ADMIN_AUTH_DB' ], serviceBindings: { ASSETS: 'assets' } },
			{ name: 'assets', modules: true, compatibilityDate: '2026-07-30', bindings: { FILES: JSON.stringify( { ...assetFixtures, ...files } ) }, script: `let calls=[]; export default {fetch(request,env){const path=new URL(request.url).pathname;if(path==='/__calls')return Response.json(calls);calls.push(path);if(request.headers.has('If-None-Match')||request.headers.has('If-Modified-Since'))return new Response(null,{status:304});if(request.headers.has('Range'))return new Response('partial',{status:206});const file=JSON.parse(env.FILES)[path]||{type:'text/html',body:'PRIVATE ADMIN HTML FALLBACK'};return new Response(file.body,{status:file.status||200,headers:{'Content-Type':file.type,...file.headers}});}};` }
		]
	} );
	t.after( () => instance.dispose() );
	const db = await instance.getD1Database( 'ADMIN_AUTH_DB', 'edge' );
	await db.batch( splitSql( migration ).map( query => db.prepare( query ) ) );
	const fetch = ( path, init = {} ) => instance.dispatchFetch( `${origin}${path}`, { redirect: 'manual', ...init } );
	const login = ( value = password, headers = {} ) => fetch( '/v1/admin/session', { method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify( { password: value } ) } );
	const calls = async () => ( await ( await instance.getWorker( 'assets' ) ).fetch( `${origin}/__calls` ) ).json();
	return { instance, fetch, login, calls, db };
}
const sessionCookie = response => response.headers.get( 'Set-Cookie' ).split( ';' )[ 0 ];

test( 'build emits an exact public student graph; root/admin/diagnostic entries are absent', () => {
	const manifest = JSON.parse( securityManifest.source );
	const paths = manifest.files.map( file => file.path );
	assert.deepEqual( paths.sort(), [ '/assets/shared.js', '/assets/student.js', '/assets/student-viewport.js', '/student/', '/student/index.html', '/student/sw.js' ].sort() );
	assert.ok( serviceWorker.source.includes( '/assets/student-viewport.js' ) );
	assert.ok( ! serviceWorker.source.includes( '/assets/admin.js' ) );
	assert.ok( ! serviceWorker.source.includes( '/student/diagnostic/' ) );
	for ( const file of manifest.files ) {
		assert.equal( file.byteLength, Buffer.byteLength( assetFixtures[ file.path ].body ) );
		assert.equal( file.sha256, createHash( 'sha256' ).update( assetFixtures[ file.path ].body ).digest( 'hex' ) );
	}
} );

test( 'root/admin and diagnostic HTML redirect before any static fetch; published API also needs the shared-password session', async t => {
	const app = await harness( t );
	for ( const path of [ '/', '/index.html', '/admin/', '/admin/student-presets/', '/admin/student-presets/index.html', '/student/diagnostic/', '/student/diagnostic/index.html', '/student/scene/', '/student/scene/index.html' ] ) {
		const response = await app.fetch( path );
		assert.equal( response.status, 302 );
		assert.equal( response.headers.get( 'Location' ), '/admin/sign-in' );
		assert.equal( await response.text(), '' );
	}
	assert.deepEqual( await app.calls(), [] );
	const response = await app.fetch( '/v1/admin/presets', { headers: { Authorization: 'Bearer forged', 'Cf-Access-Authenticated-User-Email': 'teacher@example.test' } } );
	assert.equal( response.status, 401 );
	assert.equal( ( await response.json() ).error.code, 'ADMIN_SESSION_REQUIRED' );
} );

test( 'password login issues a finite HttpOnly signed cookie for same-origin admin HTML and API; logout clears it', async t => {
	const app = await harness( t );
	assert.equal( ( await app.login( 'wrong' ) ).status, 401 );
	const signIn = await app.fetch( '/admin/sign-in' );
	assert.equal( signIn.status, 200 );
	assert.match( await signIn.text(), /type="password"/ );
	const login = await app.login();
	assert.equal( login.status, 200 );
	const setCookie = login.headers.get( 'Set-Cookie' );
	for ( const marker of [ '__Host-rayzee-admin=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=3600' ] ) assert.ok( setCookie.includes( marker ) );
	assert.ok( ! setCookie.includes( 'Domain=' ) );
	const state = await login.json();
	assert.equal( state.authenticated, true );
	assert.ok( ! JSON.stringify( state ).includes( password ) );
	const headers = { Cookie: sessionCookie( login ) };
	const admin = await app.fetch( '/', { headers } );
	assert.equal( admin.status, 200 );
	assert.match( await admin.text(), /PRIVATE ADMIN HTML/ );
	assert.equal( admin.headers.get( 'Cache-Control' ), 'no-store' );
	assert.equal( ( await app.fetch( '/assets/admin.js', { headers } ) ).status, 200 );
	assert.equal( ( await app.fetch( '/v1/admin/presets', { method: 'POST', headers: { ...headers, Origin: origin } } ) ).status, 501 );
	assert.equal( ( await app.fetch( '/v1/admin/session', { headers } ) ).status, 200 );
	const logout = await app.fetch( '/v1/admin/session', { method: 'DELETE', headers: { ...headers, Origin: origin } } );
	assert.equal( logout.status, 200 );
	assert.match( logout.headers.get( 'Set-Cookie' ), /Max-Age=0/ );
} );

test( 'browser form uses a same-origin referrer policy, shows friendly errors and signs in without weakening origin checks', async t => {
	const app = await harness( t );
	const page = await app.fetch( '/admin/sign-in' );
	assert.equal( page.headers.get( 'Referrer-Policy' ), 'same-origin' );
	assert.match( page.headers.get( 'Content-Security-Policy' ), /form-action 'self'/ );
	const form = value => app.fetch( '/v1/admin/session', { method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams( { password: value } ).toString(), redirect: 'manual' } );
	const wrong = await form( 'wrong' );
	assert.equal( wrong.status, 401 );
	assert.match( wrong.headers.get( 'Content-Type' ), /text\/html/ );
	assert.match( await wrong.text(), /password was not accepted/ );
	const result = await form( password );
	assert.equal( result.status, 303 );
	assert.equal( result.headers.get( 'Location' ), '/' );
	assert.match( result.headers.get( 'Set-Cookie' ), /__Host-rayzee-admin=/ );
	const hostile = await app.fetch( '/v1/admin/session', { method: 'POST', headers: { Origin: 'null', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=wrong' } );
	assert.equal( hostile.status, 403 );
} );

test( 'cross-origin/password and cookie writes fail; forged, expired, future, wrong-origin and rotated-verifier sessions fail', async t => {
	const app = await harness( t );
	for ( const headers of [ { Origin: 'https://attacker.example' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' } ] ) assert.equal( ( await app.login( password, headers ) ).status, 403 );
	const login = await app.login();
	const cookie = sessionCookie( login );
	assert.equal( ( await app.fetch( '/v1/admin/presets', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://attacker.example' } } ) ).status, 403 );
	assert.equal( ( await app.fetch( '/v1/admin/session', { method: 'DELETE', headers: { Cookie: cookie } } ) ).status, 403 );
	const original = JSON.parse( Buffer.from( cookie.split( '=' )[ 1 ].split( '.' )[ 0 ], 'base64url' ) );
	const signedCookie = payload => {
		const encoded = Buffer.from( JSON.stringify( payload ) ).toString( 'base64url' );
		return `__Host-rayzee-admin=${encoded}.${createHmac( 'sha256', secret ).update( encoded ).digest( 'base64url' )}`;
	};
	const variants = [
		'__Host-rayzee-admin=forged.invalid',
		signedCookie( { ...original, iat: original.iat - 7200, exp: original.exp - 7200 } ),
		signedCookie( { ...original, iat: original.iat + 60, exp: original.exp + 60 } ),
		signedCookie( { ...original, origin: 'https://other.example' } ),
		signedCookie( { ...original, credentialVersion: 'previous-password-verifier' } )
	];
	for ( const Cookie of variants ) assert.equal( ( await app.fetch( '/v1/admin/session', { headers: { Cookie } } ) ).status, 401 );
} );

test( 'password work is throttled in real D1 before hashing; missing secrets fail closed without default passwords', async t => {
	const app = await harness( t, { bindings: { ADMIN_LOGIN_ATTEMPTS_PER_MINUTE: '2' } } );
	assert.equal( ( await app.login( 'wrong-1' ) ).status, 401 );
	assert.equal( ( await app.login( 'wrong-2' ) ).status, 401 );
	assert.equal( ( await app.login() ).status, 429 );
	const row = await app.db.prepare( 'SELECT attempts FROM admin_login_budgets' ).first();
	assert.equal( row.attempts, 3 );
	const absent = await harness( t, { configured: false } );
	for ( const path of [ '/', '/admin/sign-in', '/v1/admin/presets' ] ) assert.equal( ( await absent.fetch( path ) ).status, 503 );
	assert.equal( ( await absent.login() ).status, 503 );
	assert.equal( ( await absent.fetch( '/student/' ) ).status, 200 );
} );

test( 'public asset verification ignores conditional and range request headers when fetching the complete asset', async t => {
	const app = await harness( t );
	for ( const headers of [ { 'If-None-Match': '"cached"' }, { 'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT' }, { Range: 'bytes=0-3', 'If-Range': '"cached"' }, { 'If-Match': '"cached"', 'If-Unmodified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT' } ] ) {
		const response = await app.fetch( '/assets/shared.js', { headers } );
		assert.equal( response.status, 200 );
		assert.equal( await response.text(), graph[ 'assets/shared.js' ].code );
	}
} );

test( 'public student files match exact manifest bytes; admin JS and SPA fallback aliases never become public', async t => {
	const app = await harness( t );
	for ( const path of [ '/student/', '/student/index.html', '/student/sw.js', '/assets/student.js', '/assets/shared.js', '/assets/student-viewport.js' ] ) {
		const response = await app.fetch( path );
		assert.equal( response.status, 200 );
		assert.equal( response.headers.get( 'Cross-Origin-Opener-Policy' ), 'same-origin' );
		assert.equal( response.headers.get( 'Cross-Origin-Embedder-Policy' ), 'credentialless' );
	}
	for ( const path of [ '/assets/admin.js', '/student/missing.html', '/assets/missing.js', '/other.html' ] ) {
		const response = await app.fetch( path );
		assert.equal( response.status, 302 );
		assert.ok( ! ( await response.text() ).includes( 'PRIVATE' ) );
	}
	const tampered = await harness( t, { files: { '/student/': { type: 'text/html', body: 'PRIVATE ADMIN HTML FALLBACK' }, '/assets/student.js': { type: 'text/html', body: 'PRIVATE ADMIN HTML FALLBACK' }, '/assets/shared.js': { type: 'text/javascript', body: 'PRIVATE ADMIN JS' } } } );
	for ( const path of [ '/student/', '/assets/student.js', '/assets/shared.js' ] ) {
		const response = await tampered.fetch( path );
		assert.equal( response.status, 503 );
		assert.ok( ! ( await response.text() ).includes( 'PRIVATE' ) );
	}
	const malformed = await harness( t, { files: { '/student/edge-public-assets.json': { type: 'text/html', body: 'PRIVATE ADMIN HTML FALLBACK' } } } );
	assert.equal( ( await malformed.fetch( '/student/' ) ).status, 503 );
} );

test( 'trusted Australia metadata gates the entire site, login, assets and APIs; spoofable headers and hosted exemptions fail', async t => {
	for ( const cf of [ { country: 'US' }, {}, { country: null } ] ) {
		const app = await harness( t, { cf, bindings: { ENVIRONMENT: 'production', ALLOW_LOCAL_GEO_EXEMPTION: 'true' } } );
		for ( const path of [ '/', '/student/', '/assets/student.js', '/admin/sign-in', '/v1/drafts', '/v1/admin/session' ] ) {
			const response = await app.fetch( path, { headers: { 'CF-IPCountry': 'AU', 'X-Country': 'AU' } } );
			assert.equal( response.status, 403 );
			assert.equal( ( await response.json() ).error.code, 'AUSTRALIA_ONLY' );
		}
		assert.deepEqual( await app.calls(), [] );
	}
	const local = await harness( t, { cf: { country: 'US' }, bindings: { ALLOW_LOCAL_GEO_EXEMPTION: 'true' } } );
	assert.equal( ( await local.fetch( '/student/' ) ).status, 200 );
	const hosted = await harness( t, { cf: { country: 'AU' }, bindings: { ENVIRONMENT: 'production', ENABLE_DRAFT_API: 'true' } } );
	assert.equal( ( await hosted.fetch( '/student/' ) ).status, 200 );
	assert.equal( ( await hosted.fetch( '/v1/drafts' ) ).status, 503 );
	assert.equal( ( await hosted.fetch( '/admin/sign-in' ) ).status, 503 );
	assert.equal( ( await hosted.login() ).status, 503 );
} );

test( 'actual Wrangler Pages bundle invokes the middleware before static assets on every route', async t => {
	const app = await harness( t, { edgeScript: compiledPages } );
	assert.equal( ( await app.fetch( '/' ) ).status, 302 );
	assert.equal( ( await app.fetch( '/assets/admin.js' ) ).status, 302 );
	assert.equal( ( await app.fetch( '/student/' ) ).status, 200 );
	const login = await app.login();
	assert.equal( login.status, 200 );
	const response = await app.fetch( '/', { headers: { Cookie: sessionCookie( login ) } } );
	assert.equal( response.status, 200 );
	assert.match( await response.text(), /PRIVATE ADMIN HTML/ );
	const overseas = await harness( t, { edgeScript: compiledPages, cf: { country: 'US' } } );
	assert.equal( ( await overseas.fetch( '/student/' ) ).status, 403 );
	assert.deepEqual( await overseas.calls(), [] );
} );

test( 'hosted activation rejects the test work factor and verifies an actual 600000-iteration password only after explicit activation', async t => {
	const weak = await harness( t, { bindings: { ENVIRONMENT: 'production', ENABLE_HOSTED_ADMIN_AUTH: 'true' } } );
	assert.equal( ( await weak.login() ).status, 503 );
	const strongVerifier = `pbkdf2-sha256$600000$${salt.toString( 'base64url' )}$${pbkdf2Sync( password, salt, 600000, 32, 'sha256' ).toString( 'base64url' )}`;
	const disabled = await harness( t, { bindings: { ENVIRONMENT: 'production', ADMIN_PASSWORD_VERIFIER: strongVerifier } } );
	assert.equal( ( await disabled.login() ).status, 503 );
	const enabled = await harness( t, { edgeScript: compiledPages, bindings: { ENVIRONMENT: 'production', ENABLE_HOSTED_ADMIN_AUTH: 'true', ADMIN_PASSWORD_VERIFIER: strongVerifier } } );
	const login = await enabled.login();
	assert.equal( login.status, 200 );
	assert.equal( ( await enabled.fetch( '/', { headers: { Cookie: sessionCookie( login ) } } ) ).status, 200 );
} );

test( 'student project review hierarchy requires admin session before redirecting to the private entry', async t => {
 const app = await harness( t );
 const user = '66c45b30-4185-4096-89a9-13f0235e2157', project = 'ed517464-ce73-4f44-a3cb-cf14e7b8d3a2';
 const path = `/admin/users/${user}/projects/${project}/`;
 const denied = await app.fetch( path ); assert.equal( denied.status, 302 ); assert.equal( denied.headers.get( 'Location' ), '/admin/sign-in' );
 for ( const privatePath of [ '/admin/users/', `/admin/users/review/?user=${user}&project=${project}`, path ] ) {
  const student = await app.fetch( privatePath, { headers: { Authorization: `Bearer ${user}` } } );
  assert.equal( student.status, 302 ); assert.equal( student.headers.get( 'Location' ), '/admin/sign-in' );
 }
 const login = await app.login(); const allowed = await app.fetch( path, { headers: { Cookie: sessionCookie( login ) } } );
 assert.equal( allowed.status, 302 ); assert.equal( allowed.headers.get( 'Location' ), `/admin/users/review/?user=${user}&project=${project}` );
 assert.equal( allowed.headers.get( 'Cache-Control' ), 'no-store' ); assert.deepEqual( await app.calls(), [] );
} );
