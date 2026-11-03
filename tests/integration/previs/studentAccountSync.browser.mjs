// Actual Worker / Miniflare D1 + R2 and native Chromium IndexedDB. Faults occur
// at the transport or local transaction boundary, not in an in-memory mock.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, pbkdf2Sync, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import puppeteer from 'puppeteer-core';
import { studentFixture } from '../../unit/previs/studentFixtures.js';

const root = fileURLToPath( new URL( '../../../', import.meta.url ) );
const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' ), { build } = require( 'esbuild' ), { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const sha = value => createHash( 'sha256' ).update( value ).digest( 'hex' );
const token = randomUUID(), userId = randomUUID(), password = randomUUID(), salt = randomBytes( 16 ), secret = randomBytes( 32 );
const verifier = `pbkdf2-sha256$1000$${salt.toString( 'base64url' )}$${pbkdf2Sync( password, salt, 1000, 32, 'sha256' ).toString( 'base64url' )}`;
const bundle = await build( { entryPoints: [ resolve( root, 'backend/src/worker.js' ) ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } );
const mf = new Miniflare( { modules: true, script: bundle.outputFiles[ 0 ].text, compatibilityDate: '2026-07-30', d1Databases: [ 'DB', 'ADMIN_AUTH_DB' ], r2Buckets: [ 'DOCUMENTS', 'NARRATION', 'LIBRARY' ], bindings: {
 ENVIRONMENT: 'test', ENABLE_DRAFT_API: 'true', ENABLE_CATALOGUE_API: 'true', ALLOW_LOCAL_GEO_EXEMPTION: 'true', ADMIN_PASSWORD_VERIFIER: verifier, ADMIN_SESSION_SECRET: secret.toString( 'base64url' ), ADMIN_SESSION_SECONDS: '3600', ADMIN_LOGIN_ATTEMPTS_PER_MINUTE: '30', MAX_JSON_BYTES: '1048576', MAX_LIBRARY_ASSET_BYTES: '67108864', MAX_NARRATION_BYTES: '16777216', MAX_DRAFT_REVISIONS: '10000', MAX_DRAFT_MEDIA: '100', MAX_DRAFT_CREATIONS_PER_MINUTE: '100'
} } );
const db = await mf.getD1Database( 'DB' ), auth = await mf.getD1Database( 'ADMIN_AUTH_DB' ), library = await mf.getR2Bucket( 'LIBRARY' );
for ( const name of ( await readdir( resolve( root, 'backend/migrations' ) ) ).filter( x => /^\d+_.*\.sql$/.test( x ) ).sort() ) {
 const sql = await readFile( resolve( root, 'backend/migrations', name ), 'utf8' );
 await db.batch( splitSql( sql ).map( query => db.prepare( query ) ) );
 if ( name === '0003_admin_password.sql' ) await auth.batch( splitSql( sql ).map( query => auth.prepare( query ) ) );
}
await db.prepare( 'INSERT INTO student_users (user_id,first_name,last_name,graduation_year,credential_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)' ).bind( userId, 'Test', 'Student', 2030, sha( token ), Date.now(), Date.now() ).run();
const document = studentFixture(); document.projectId = randomUUID();
for ( const asset of Object.values( document.assets ) ) {
 const bytes = Buffer.from( `verified ${asset.assetId} bytes` ); asset.sha256 = sha( bytes ); asset.byteLength = bytes.length;
 const key = `assets/${asset.assetId}/${asset.version}`;
 await library.put( key, bytes, { sha256: asset.sha256, httpMetadata: { contentType: asset.mimeType } } );
 await db.prepare( 'INSERT INTO library_assets VALUES (?,?,?,?,?,?)' ).bind( asset.assetId, asset.version, JSON.stringify( asset ), key, asset.sha256, asset.byteLength ).run();
}
for ( const scene of Object.values( document.baseScenes ) ) {
 const definition = JSON.stringify( { format: 'rayzee-student-scene', schemaVersion: 1, baseScene: scene, models: [], humanPoseRoots: [] } );
 await db.prepare( 'INSERT INTO library_base_scenes VALUES (?,?,?)' ).bind( scene.sceneId, scene.version, JSON.stringify( scene ) ).run();
 await db.prepare( 'INSERT INTO library_supported_scenes VALUES (?,?,?,?)' ).bind( scene.sceneId, scene.version, definition, sha( definition ) ).run();
}
const audio = Buffer.from( 'recorded audio fixture bytes' ), audioHash = sha( audio );
const a = document.narration.assets[ 'voice@1' ]; a.sha256 = audioHash; a.byteLength = audio.length; a.segments = [ { index: 0, sha256: audioHash, byteLength: audio.length } ];
let mode = '', held, entered;
const requests = [];
const server = createServer( async ( request, response ) => {
 try {
  const url = new URL( request.url, 'http://localhost' );
  if ( url.pathname.startsWith( '/v1/' ) ) {
   const chunks = []; for await ( const chunk of request ) chunks.push( chunk ); const body = Buffer.concat( chunks );
   const headers = { ...request.headers }; delete headers.host; delete headers.connection; delete headers[ 'content-length' ];
   let doc; try { doc = JSON.parse( body ).document; } catch { /* binary and empty requests */ }
   requests.push( { path: url.pathname, method: request.method, key: headers[ 'idempotency-key' ], revision: doc?.revision, match: headers[ 'if-match' ] } );
   if ( mode === 'unavailable-create' && request.method === 'POST' && url.pathname === '/v1/student/projects' ) { response.writeHead( 503 ); response.end(); return; }
   if ( mode === 'hold-document' && request.method === 'PUT' && /^\/v1\/student\/projects\/[^/]+$/.test( url.pathname ) ) { mode = ''; await new Promise( resolve => { held = resolve; entered(); } ); }
   const result = await mf.dispatchFetch( `http://localhost${url.pathname}${url.search}`, { method: request.method, headers, ...( body.length ? { body } : {} ) } );
   const bytes = Buffer.from( await result.arrayBuffer() );
   if ( mode === 'drop-media' && request.method === 'POST' && url.pathname.endsWith( '/narration/voice%401/complete' ) && result.ok ) { mode = ''; response.writeHead( 503 ); response.end(); return; }
   if ( mode === 'drop-create' && request.method === 'POST' && url.pathname === '/v1/student/projects' && result.ok ) { mode = ''; response.writeHead( 503 ); response.end(); return; }
   const outgoing = Object.fromEntries( result.headers ); delete outgoing[ 'content-length' ]; response.writeHead( result.status, outgoing ); response.end( bytes ); return;
  }
  if ( url.pathname === '/favicon.ico' ) { response.writeHead( 204 ); response.end(); return; }
  if ( url.pathname === '/' ) { response.writeHead( 200, { 'content-type': 'text/html' } ); response.end( '<!doctype html><title>Account sync integration</title>' ); return; }
  const path = resolve( root, `.${decodeURIComponent( url.pathname )}` ); if ( ! path.startsWith( `${root.replace( /\/$/, '' )}${sep}` ) ) throw new Error( 'Invalid path' );
  const source = await readFile( path ); response.writeHead( 200, { 'content-type': 'text/javascript' } ); response.end( source );
 } catch ( error ) { console.error( 'proxy error', error.message ); response.writeHead( 500 ); response.end(); }
} );
await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } );
 const page = await browser.newPage();
 page.on( 'pageerror', error => console.error( 'browser', error.message ) );
 const databaseName = `AccountSync-${randomUUID()}`, narrationName = `${databaseName}-audio`;
 const setup = async () => {
  await page.goto( origin );
  await page.evaluate( async ( { databaseName, narrationName, token } ) => {
   const { StudentProjectRepository } = await import( '/app/src/previs/persistence/StudentProjectRepository.js' );
   const { LocalNarrationStore } = await import( '/app/src/student/editor/LocalNarration.js' );
   const { AccountProjectClient } = await import( '/app/src/previs/api/AccountProjectClient.js' );
   const { AccountSyncService } = await import( '/app/src/previs/sync/AccountSyncService.js' );
   globalThis.repo = new StudentProjectRepository( { databaseName } );
   globalThis.narration = new LocalNarrationStore( { databaseName: narrationName } );
   globalThis.client = new AccountProjectClient( { baseURL: location.origin, credential: token, timeoutMs: 5000 } );
   globalThis.events = [];
   globalThis.service = new AccountSyncService( { repository: globalThis.repo, narration: globalThis.narration, client: globalThis.client, onStatus: status => globalThis.events.push( status ), maxAttempts: 1, probeMs: 60000 } );
   globalThis.edit = async ( id, name ) => { const previous = await globalThis.repo.get( id ); await globalThis.repo.save( { ...previous, name, revision: previous.revision + 1 }, { expectedRevision: previous.revision } ); };
  }, { databaseName, narrationName, token } );
 };
 await setup();
 await page.evaluate( async ( { document, audio } ) => {
  await globalThis.narration.put( { assetId: 'voice', projectId: document.projectId, blob: new Blob( [ new Uint8Array( audio ) ], { type: 'audio/webm' } ) } );
  await globalThis.repo.save( document, { expectedRevision: null } );
 }, { document, audio: [ ...audio ] } );
 mode = 'drop-media';
 await page.evaluate( async () => globalThis.service.start() );
 assert.equal( ( await db.prepare( 'SELECT count(*) AS n FROM draft_revisions' ).first() ).n, 0 );
 assert.equal( ( await db.prepare( "SELECT count(*) AS n FROM media_objects WHERE state='complete'" ).first() ).n, 1 );
 await page.evaluate( async () => { globalThis.service.stop(); globalThis.repo.close(); await globalThis.narration.close(); } );
 await setup(); mode = 'drop-create';
 await page.evaluate( async () => globalThis.service.start() );
 let state = await page.evaluate( id => globalThis.repo.backupState( id ), document.projectId );
 assert.equal( state.serverRevision ?? null, null ); assert.equal( state.inFlight.revision, 0 );
 assert.equal( ( await db.prepare( 'SELECT count(*) AS n FROM draft_revisions' ).first() ).n, 1 );
 await page.evaluate( async () => { globalThis.service.stop(); globalThis.repo.close(); await globalThis.narration.close(); } );
 await setup(); await page.evaluate( async () => globalThis.service.start() );
 state = await page.evaluate( id => globalThis.repo.backupState( id ), document.projectId );
 assert.equal( state.serverRevision, 0 ); assert.equal( state.acknowledgedRevision, 0 );
 assert.equal( ( await db.prepare( 'SELECT count(*) AS n FROM draft_revisions' ).first() ).n, 1 );
 const remote = await page.evaluate( id => globalThis.client.read( { projectId: id } ), document.projectId );
 assert.deepEqual( remote.document, document );
 const audioResponse = await fetch( `${origin}/v1/student/projects/${document.projectId}/narration/voice%401/content`, { headers: { Authorization: `Bearer ${token}` } } );
 assert.equal( audioResponse.status, 200 ); assert.deepEqual( Buffer.from( await audioResponse.arrayBuffer() ), audio );
 console.log( 'PASS revision-zero full scene and audio, lost media and creation responses, restart and exact durable replay' );
 // A separate browser storage namespace discovers the exact cloud head and
 // downloads its audio rather than treating document-only hydration as complete.
 const second = await browser.newPage(); await second.goto( origin );
 await second.evaluate( async ( { token } ) => {
  const { StudentProjectRepository } = await import( '/app/src/previs/persistence/StudentProjectRepository.js' );
  const { LocalNarrationStore } = await import( '/app/src/student/editor/LocalNarration.js' );
  const { AccountProjectClient } = await import( '/app/src/previs/api/AccountProjectClient.js' );
  const { AccountSyncService } = await import( '/app/src/previs/sync/AccountSyncService.js' );
  globalThis.repo = new StudentProjectRepository( { databaseName: `fresh-${crypto.randomUUID()}` } );
  globalThis.narration = new LocalNarrationStore( { databaseName: `fresh-audio-${crypto.randomUUID()}` } );
  globalThis.client = new AccountProjectClient( { baseURL: location.origin, credential: token } );
  globalThis.service = new AccountSyncService( { repository: globalThis.repo, narration: globalThis.narration, client: globalThis.client } );
  await globalThis.service.start();
 }, { token } );
 await second.waitForFunction( async id => !! ( await globalThis.repo.get( id ) ), { timeout: 10000 }, document.projectId );
 assert.deepEqual( await second.evaluate( id => globalThis.repo.get( id ), document.projectId ), document );
 assert.deepEqual( Buffer.from( await second.evaluate( async () => [ ...new Uint8Array( await ( await globalThis.narration.get( 'voice' ) ).blob.arrayBuffer() ) ] ) ), audio );
 assert.equal( ( await second.evaluate( id => globalThis.repo.pending( id ), document.projectId ) ).length, 0 );
 await second.evaluate( async () => { globalThis.service.stop(); globalThis.repo.close(); await globalThis.narration.close(); } ); await second.close();
 const login = await mf.dispatchFetch( 'http://localhost/v1/admin/session', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify( { password } ) } );
 assert.equal( login.status, 200 ); const cookie = login.headers.get( 'set-cookie' ).split( ';' )[ 0 ];
 const adminDocument = await mf.dispatchFetch( `http://localhost/v1/admin/projects/${document.projectId}`, { headers: { Cookie: cookie } } );
 assert.equal( adminDocument.status, 200 ); assert.deepEqual( ( await adminDocument.json() ).document, document );
 const adminAudio = await mf.dispatchFetch( `http://localhost/v1/admin/projects/${document.projectId}/narration/voice%401/content`, { headers: { Cookie: cookie } } );
 assert.equal( adminAudio.status, 200 ); assert.deepEqual( Buffer.from( await adminAudio.arrayBuffer() ), audio );
 console.log( 'PASS fresh browser and admin independently retrieve exact document and audio' );
 mode = 'hold-document'; const sending = new Promise( resolve => { entered = resolve; } );
 await page.evaluate( async id => { const ack = globalThis.repo.acknowledgeAccountBackup.bind( globalThis.repo ); globalThis.repo.acknowledgeAccountBackup = async ( projectId, value ) => { const result = await ack( projectId, value ); if ( value.revision === 1 ) globalThis.intermediate = await globalThis.repo.status( projectId ); return result; }; await globalThis.edit( id, 'Frozen N' ); globalThis.work = globalThis.service.notifyLocalCommit( id ); }, document.projectId );
 await sending;
 await page.evaluate( async id => { await globalThis.edit( id, 'Newer N+1' ); }, document.projectId ); held();
 await page.evaluate( async () => globalThis.work );
 await page.waitForFunction( async id => ( await globalThis.repo.backupState( id ) ).acknowledgedRevision === 2, {}, document.projectId );
 assert.equal( ( await page.evaluate( () => globalThis.intermediate ) ).backedUp, false );
 assert.equal( ( await db.prepare( 'SELECT count(*) AS n FROM draft_revisions' ).first() ).n, 3 );
 assert.deepEqual( requests.filter( r => r.method === 'PUT' && r.path === `/v1/student/projects/${document.projectId}` ).map( r => [ r.revision, r.match ] ), [ [ 1, '"0"' ], [ 2, '"1"' ] ] );
 console.log( 'PASS N+1 persists while N is in flight and receives separate acknowledgement' );
 // A genuinely independent writer advances the cloud head. The local edit must
 // survive in a recovery copy and no retry can overwrite the winning revision.
 await page.evaluate( async id => {
  globalThis.service.stop();
  const remote = await globalThis.client.read( { projectId: id } );
  await globalThis.client.update( { projectId: id, document: { ...remote.document, name: 'Other device', revision: 3 }, requestId: 'other-device:3', serverRevision: 2 } );
  await globalThis.edit( id, 'Local conflict work' );
  await globalThis.service.start();
 }, document.projectId );
 state = await page.evaluate( id => globalThis.repo.backupState( id ), document.projectId );
 assert.ok( state.conflict );
 assert.equal( ( await page.evaluate( id => globalThis.repo.get( id ), document.projectId ) ).name, 'Local conflict work' );
 assert.equal( ( await page.evaluate( async id => { const state = await globalThis.repo.backupState( id ); return ( await globalThis.repo.recoveries( id ) ).find( copy => copy.recoveryId === state.conflict.recoveryId ); }, document.projectId ) ).document.name, 'Local conflict work' );
 assert.equal( ( await page.evaluate( id => globalThis.client.read( { projectId: id } ), document.projectId ) ).document.name, 'Other device' );
 console.log( 'PASS cross-device conditional conflict preserves both durable versions' );
 // A project archived by another writer while this client is disconnected
 // must become a recovery choice, never an implicit restore.
 const archivedId = randomUUID(), archivedDoc = structuredClone( document ); archivedDoc.projectId = archivedId; archivedDoc.narration = { assets: {}, clips: [] };
 await page.evaluate( async d => { await globalThis.repo.save( d, { expectedRevision: null } ); await globalThis.service.notifyLocalCommit( d.projectId ); }, archivedDoc );
 await page.evaluate( async id => {
  globalThis.service.stop();
  await globalThis.client.metadata( { projectId: id, operation: { requestId: 'remote-archive', expectedMetadataRevision: 0, patch: { archived: true } } } );
  await globalThis.edit( id, 'Offline edit of archived project' );
  await globalThis.service.start();
 }, archivedId );
 const archivedState = await page.evaluate( id => globalThis.repo.backupState( id ), archivedId );
 assert.ok( archivedState.conflict?.recoveryId );
 assert.equal( ( await page.evaluate( id => globalThis.client.read( { projectId: id } ), archivedId ) ).project.archived, true );
 const archivedRecovery = await page.evaluate( async id => { const state = await globalThis.repo.backupState( id ); return ( await globalThis.repo.recoveries( id ) ).find( copy => copy.recoveryId === state.conflict.recoveryId ); }, archivedId );
 assert.equal( archivedRecovery.document.name, 'Offline edit of archived project' );
 assert.equal( ( await page.evaluate( id => globalThis.client.read( { projectId: id } ), archivedId ) ).project.serverRevision, 0 );
 console.log( 'PASS remotely archived project preserves offline edits as recovery without resurrection' );
 // Missing recording prevents remote creation and cannot claim a complete save.
 const missingId = randomUUID(), missingDoc = structuredClone( document ); missingDoc.projectId = missingId; missingDoc.narration.assets[ 'voice@1' ].assetId = 'missing';
 missingDoc.narration.assets[ 'missing@1' ] = missingDoc.narration.assets[ 'voice@1' ]; delete missingDoc.narration.assets[ 'voice@1' ];
 for ( const clip of missingDoc.narration.clips ) clip.media.assetId = 'missing';
 await page.evaluate( async d => { await globalThis.repo.save( d, { expectedRevision: null } ); await globalThis.service.notifyLocalCommit( d.projectId ); }, missingDoc );
 state = await page.evaluate( id => globalThis.repo.backupState( id ), missingId );
 assert.equal( state.serverRevision ?? null, null ); assert.ok( state.inFlight );
 assert.equal( ( await db.prepare( 'SELECT count(*) AS n FROM draft_revisions WHERE project_id=?' ).bind( missingId ).first() ).n, 0 );
 console.log( 'PASS missing audio cannot become a cloud acknowledgement' );
 const changedId = randomUUID(), changedDoc = structuredClone( document ); changedDoc.projectId = changedId; changedDoc.narration = { assets: {}, clips: [] }; changedDoc.assets[ 'video@1' ].sha256 = 'f'.repeat( 64 );
 await page.evaluate( async d => { await globalThis.repo.save( d, { expectedRevision: null } ); await globalThis.service.notifyLocalCommit( d.projectId ); }, changedDoc );
 state = await page.evaluate( id => globalThis.repo.backupState( id ), changedId );
 assert.equal( state.serverRevision ?? null, null ); assert.ok( state.inFlight );
 assert.equal( ( await db.prepare( 'SELECT count(*) AS n FROM draft_revisions WHERE project_id=?' ).bind( changedId ).first() ).n, 0 );
 console.log( 'PASS changed catalogue dependency prevents false complete sync' );
 // Multiple locally committed projects, including non-selected projects, are
 // found and synchronized after the service starts again.
 const inactive = [ structuredClone( document ), structuredClone( document ) ];
 inactive.forEach( ( d, i ) => { d.projectId = randomUUID(); d.name = `Inactive ${i}`; d.narration = { assets: {}, clips: [] }; } );
 mode = 'unavailable-create';
 await page.evaluate( async docs => { globalThis.service.stop(); for ( const d of docs ) { await globalThis.repo.save( d, { expectedRevision: null } ); await globalThis.edit( d.projectId, `${d.name} outage edit` ); } await globalThis.service.start(); }, inactive );
 for ( const d of inactive ) assert.equal( ( await page.evaluate( id => globalThis.repo.backupState( id ), d.projectId ) ).serverRevision ?? null, null );
 await page.evaluate( async () => { globalThis.service.stop(); globalThis.repo.close(); await globalThis.narration.close(); } );
 await setup(); mode = ''; await page.evaluate( async () => globalThis.service.start() );
 for ( const d of inactive ) {
  await page.waitForFunction( async id => ( await globalThis.repo.backupState( id ) ).serverRevision === 0, { timeout: 10000 }, d.projectId );
  assert.deepEqual( ( await page.evaluate( id => globalThis.client.read( { projectId: id } ), d.projectId ) ).document, { ...d, name: `${d.name} outage edit`, revision: 1 } );
 }
 console.log( 'PASS several inactive projects retain exact outage edits across page restart and all sync' );
 // Exhausted retry periodically probes even without an online event.
 const retryId = randomUUID(), retryDoc = structuredClone( document ); retryDoc.projectId = retryId; retryDoc.narration = { assets: {}, clips: [] };
 mode = 'unavailable-create';
 await page.evaluate( async d => { globalThis.service.probeMs = 150; await globalThis.repo.save( d, { expectedRevision: null } ); await globalThis.service.notifyLocalCommit( d.projectId ); }, retryDoc );
 assert.equal( ( await page.evaluate( id => globalThis.repo.backupState( id ), retryId ) ).serverRevision ?? null, null );
 mode = '';
 await page.waitForFunction( async id => ( await globalThis.repo.backupState( id ) ).serverRevision === 0, { timeout: 8000 }, retryId );
 console.log( 'PASS exhausted retry probes and recovers without an online event' );
 // Abort the native acknowledgement after the real server committed; retry
 // replays the exact request instead of appending another cloud revision.
 await page.evaluate( async id => {
  globalThis.service.stop(); await globalThis.edit( id, 'Abort acknowledgement' );
  const nativeDelete = IDBObjectStore.prototype.delete; let aborted = false;
  IDBObjectStore.prototype.delete = function ( key ) { const result = nativeDelete.call( this, key ); if ( ! aborted && this.name === 'outbox' && key[ 0 ] === id && key[ 1 ] === 1 ) { aborted = true; this.transaction.abort(); } return result; };
  try { await globalThis.service.start(); } finally { IDBObjectStore.prototype.delete = nativeDelete; }
 }, retryId );
 state = await page.evaluate( id => globalThis.repo.backupState( id ), retryId );
 assert.equal( state.serverRevision, 0 ); assert.equal( state.inFlight.revision, 1 );
 assert.equal( ( await db.prepare( 'SELECT count(*) AS n FROM draft_revisions WHERE project_id=?' ).bind( retryId ).first() ).n, 2 );
 await page.evaluate( id => globalThis.service.retry( id ), retryId );
 assert.equal( ( await page.evaluate( id => globalThis.repo.backupState( id ), retryId ) ).serverRevision, 1 );
 assert.equal( ( await db.prepare( 'SELECT count(*) AS n FROM draft_revisions WHERE project_id=?' ).bind( retryId ).first() ).n, 2 );
 console.log( 'PASS native acknowledgement abort retains pending request and replay makes no duplicate revision' );

 // A rotated credential immediately denies queued work without erasing it.
 await page.evaluate( async id => { globalThis.service.stop(); await globalThis.edit( id, 'Retain after rotation' ); }, retryId );
 const rotated = randomUUID(); await db.prepare( 'UPDATE student_users SET credential_hash=?,access_generation=access_generation+1 WHERE user_id=?' ).bind( sha( rotated ), userId ).run();
 await page.evaluate( async () => globalThis.service.start() );
 assert.ok( await page.evaluate( () => globalThis.service.denied ) );
 assert.equal( ( await page.evaluate( id => globalThis.repo.get( id ), retryId ) ).name, 'Retain after rotation' );
 await page.evaluate( async replacement => { globalThis.service.stop(); globalThis.client.credential = replacement; await globalThis.service.start(); }, rotated );
 await page.waitForFunction( async id => ( await globalThis.repo.backupState( id ) ).acknowledgedRevision === 2, { timeout: 10000 }, retryId );
 console.log( 'PASS credential rotation denies old queue and replacement resumes retained work' );
 // Revocation after a queued local edit terminates uploads and retains the edit.
 await page.evaluate( async id => { globalThis.service.stop(); await globalThis.edit( id, 'Retain after revoke' ); }, retryId );
 await db.prepare( "UPDATE student_users SET access_state='revoked',access_generation=access_generation+1 WHERE user_id=?" ).bind( userId ).run();
 await page.evaluate( async () => globalThis.service.start() );
 assert.equal( ( await page.evaluate( id => globalThis.repo.get( id ), retryId ) ).name, 'Retain after revoke' );
 assert.ok( await page.evaluate( () => globalThis.service.denied ) );
 const requestCount = requests.length; await page.evaluate( async id => globalThis.service.retry( id ), retryId ); assert.equal( requests.length, requestCount );
 console.log( 'PASS revoked access stops queue and retains committed local work' );
 await page.evaluate( async () => { globalThis.service.stop(); globalThis.repo.close(); await globalThis.narration.close(); } );
 // Switch identities during a real upload. Old callbacks must not acknowledge
 // the old outbox or mutate the new account's data or status.
 const tokenA = randomUUID(), tokenB = randomUUID(), userA = randomUUID(), userB = randomUUID();
 for ( const [ id, credential ] of [ [ userA, tokenA ], [ userB, tokenB ] ] ) await db.prepare( 'INSERT INTO student_users (user_id,first_name,last_name,graduation_year,credential_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)' ).bind( id, 'Switch', 'Test', 2030, sha( credential ), Date.now(), Date.now() ).run();
 const switchDocA = structuredClone( retryDoc ), switchDocB = structuredClone( retryDoc ); switchDocA.projectId = randomUUID(); switchDocA.name = 'Account A'; switchDocB.projectId = randomUUID(); switchDocB.name = 'Account B';
 await page.goto( origin );
 await page.evaluate( async ( { userA, userB, tokenA, tokenB, a, b } ) => {
  const { AccountWorkspace } = await import( '/app/src/student/accounts/AccountWorkspace.js' );
  const { AccountProjectClient } = await import( '/app/src/previs/api/AccountProjectClient.js' );
  const { AccountSyncService } = await import( '/app/src/previs/sync/AccountSyncService.js' );
  globalThis.manager = new AccountWorkspace(); globalThis.classes = { AccountProjectClient, AccountSyncService }; globalThis.ids = { userA, userB, tokenA, tokenB, a, b };
  let service; const workspace = await globalThis.manager.switchAccount( userA, { stop: async () => service?.stop() } ); globalThis.a = workspace;
  service = new AccountSyncService( { repository: workspace.repository, narration: workspace.narration, client: new AccountProjectClient( { baseURL: location.origin, credential: tokenA } ) } ); globalThis.serviceA = service;
  await workspace.repository.save( a, { expectedRevision: null } ); await service.start();
 }, { userA, userB, tokenA, tokenB, a: switchDocA, b: switchDocB } );
 mode = 'hold-document'; const switching = new Promise( resolve => { entered = resolve; } );
 await page.evaluate( async () => { const d = await globalThis.a.repository.get( globalThis.ids.a.projectId ); await globalThis.a.repository.save( { ...d, revision: 1, name: 'A pending during switch' }, { expectedRevision: 0 } ); }, null );
 await switching;
 await page.evaluate( async () => {
  const { AccountProjectClient, AccountSyncService } = globalThis.classes, { userB, tokenB, b } = globalThis.ids; let service;
  const workspace = await globalThis.manager.switchAccount( userB, { stop: async () => service?.stop() } ); globalThis.b = workspace;
  service = new AccountSyncService( { repository: workspace.repository, narration: workspace.narration, client: new AccountProjectClient( { baseURL: location.origin, credential: tokenB } ) } ); globalThis.serviceB = service;
  await workspace.repository.save( b, { expectedRevision: null } ); await service.start();
 } );
 held(); await new Promise( resolve => setTimeout( resolve, 200 ) );
 assert.equal( await page.evaluate( async () => ( await globalThis.b.repository.list() ).map( x => x.name ).join() ), 'Account B' );
 assert.equal( ( await page.evaluate( async () => globalThis.b.repository.backupState( globalThis.ids.b.projectId ) ) ).serverRevision, 0 );
 await page.evaluate( async () => { await globalThis.manager.close(); globalThis.restoredA = await globalThis.manager.switchAccount( globalThis.ids.userA ); } );
 const aState = await page.evaluate( async () => globalThis.restoredA.repository.backupState( globalThis.ids.a.projectId ) );
 assert.equal( aState.acknowledgedRevision, 0 ); assert.equal( aState.inFlight.revision, 1 );
 assert.equal( ( await page.evaluate( async () => globalThis.restoredA.repository.get( globalThis.ids.a.projectId ) ) ).name, 'A pending during switch' );
 await page.evaluate( async () => globalThis.manager.close() );
 console.log( 'PASS switching accounts during a real upload keeps project, acknowledgement and credentials isolated' );
 console.log( JSON.stringify( { browser: await browser.version(), backend: 'actual Worker / Miniflare D1 + R2', checks: 13 }, null, 2 ) );
} finally {
 held?.(); await browser?.close(); server.closeAllConnections(); await new Promise( resolve => server.close( resolve ) ); await mf.dispose();
}
