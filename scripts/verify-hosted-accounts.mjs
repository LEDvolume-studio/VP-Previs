// Explicit release smoke test for an already-authorized Pages deployment.
// Creates retained test accounts/projects; never sends messages or deletes data.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const supplied = process.argv[ 2 ];
if ( ! supplied || process.env.RUN_HOSTED_ACCOUNT_CHECK !== 'true' ) throw new Error( 'Provide an authorized HTTPS origin and RUN_HOSTED_ACCOUNT_CHECK=true.' );
const target = new URL( supplied );
if ( target.protocol !== 'https:' || target.origin !== supplied || ! target.hostname.endsWith( '.vp-previs.pages.dev' ) && target.hostname !== 'vp-previs.pages.dev' ) throw new Error( 'Expected the authorized vp-previs Pages origin.' );
const origin = target.origin;
const runId = `ReleaseCheck${Date.now()}`;
const out = resolve( '.local-runtime', `hosted-check-${runId}` );
await mkdir( out, { recursive: true, mode: 0o700 } );
const password = ( await readFile( '.local-runtime/cloudflare-admin-password.txt', 'utf8' ) ).trim();
const report = { origin, runId, browser: null, users: [], checks: [], failures: [] };
const digest = bytes => createHash( 'sha256' ).update( bytes ).digest( 'hex' );
let browser;
const waitText = ( page, text, timeout = 120000 ) => page.waitForFunction( text => document.body.innerText.includes( text ), { timeout }, text );
const ready = page => page.waitForFunction( () => document.querySelector( '#sim-viewport-host canvas' ) && ! document.querySelector( '[aria-label="Viewer mode"]' )?.disabled, { timeout: 240000 } );
const localDocument = ( page, userId, projectId ) => page.evaluate( ( { userId, projectId } ) => new Promise( ( done, reject ) => {
 const r = indexedDB.open( `RayzeeStudentDB:account:v1:${userId}` ); r.onerror = () => reject( r.error ); r.onsuccess = () => { const db = r.result, tx = db.transaction( 'projects' ), q = tx.objectStore( 'projects' ).get( projectId ); tx.oncomplete = () => { db.close(); done( q.result?.document ); }; tx.onabort = () => reject( tx.error ); };
} ), { userId, projectId } );
try {
 browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 300000, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream' ] } );
 report.browser = await browser.version();
 const admin = await browser.newPage(); admin.setDefaultTimeout( 120000 ); await admin.setViewport( { width: 1586, height: 992 } );
 const pageErrors = []; admin.on( 'pageerror', e => pageErrors.push( e.message ) );
 await admin.goto( `${origin}/admin/sign-in`, { waitUntil: 'domcontentloaded' } );
 const input = await admin.$( 'input[type="password"]' ); assert.ok( input, 'Admin sign-in form missing' ); await input.type( password );
 await Promise.all( [ admin.waitForNavigation( { waitUntil: 'domcontentloaded' } ), admin.$eval( 'form', form => form.requestSubmit() ) ] );
 const adminCall = ( path, options = {} ) => admin.evaluate( async ( { path, options } ) => {
  const response = await fetch( path, { credentials: 'same-origin', cache: 'no-store', method: options.method || 'GET', headers: { ...( options.body === undefined ? {} : { 'Content-Type': 'application/json' } ), ...( options.key ? { 'Idempotency-Key': options.key } : {} ) }, ...( options.body === undefined ? {} : { body: JSON.stringify( options.body ) } ) } );
  const value = await response.json(); return { status: response.status, value };
 }, { path, options } );
 await admin.goto( `${origin}/admin/users/`, { waitUntil: 'domcontentloaded' } ); await waitText( admin, 'Create student' );
 const defaults = await adminCall( '/v1/admin/student-default' ); assert.equal( defaults.status, 200 ); assert.ok( defaults.value.versionId ); report.defaultVersionId = defaults.value.versionId; report.defaultDocumentRevision = defaults.value.version.document.revision;
 report.defaultDocumentSha256 = digest( JSON.stringify( defaults.value.version.document ) );
 for ( const suffix of [ 'A', 'B' ] ) {
  const fields = await admin.$$( 'form input' ); await fields[ 0 ].type( runId ); await fields[ 1 ].type( suffix ); await fields[ 2 ].type( '2030' ); await admin.$eval( 'form', f => f.requestSubmit() ); await waitText( admin, 'Student created.' );
  await admin.locator( 'button::-p-text(Issue login link)' ).click(); await admin.waitForSelector( 'input[aria-label="Student login link"]' );
  const loginUrl = await admin.$eval( 'input[aria-label="Student login link"]', e => e.value );
  const issuedUrl = new URL( loginUrl ); assert.ok( issuedUrl.hash.startsWith( '#login=' ) );
  if ( ! issuedUrl.hostname.endsWith( '.vp-previs.pages.dev' ) && issuedUrl.hostname !== 'vp-previs.pages.dev' ) throw new Error( 'Issued link has an unexpected destination.' );
  report.issuedLoginOrigin = issuedUrl.origin;
  // Preview can intentionally issue the final production URL. Exercise its
  // credential against the authorized preview until production is released.
  const testLoginUrl = new URL( `${issuedUrl.pathname}${issuedUrl.search}${issuedUrl.hash}`, origin ).href;
  const all = await adminCall( `/v1/admin/users?q=${encodeURIComponent( runId )}&limit=100` ); assert.equal( all.status, 200 );
  const user = all.value.items.find( u => u.firstName === runId && u.lastName === suffix ); assert.ok( user );
  const context = await browser.createBrowserContext(), page = await context.newPage(); page.setDefaultTimeout( 180000 ); await page.setViewport( { width: 1586, height: 992 } ); page.on( 'pageerror', e => pageErrors.push( e.message ) );
  await page.goto( testLoginUrl, { waitUntil: 'domcontentloaded' } ); await ready( page ); assert.equal( await page.evaluate( () => location.hash ), '' );
  const projects = await adminCall( `/v1/admin/users/${user.userId}/projects` ); assert.equal( projects.status, 200 ); assert.equal( projects.value.items.length, 1 );
  report.users.push( { userId: user.userId, projectId: projects.value.items[ 0 ].projectId } );
  if ( suffix === 'B' ) { await context.close(); continue; }
  const projectId = projects.value.items[ 0 ].projectId;
  await waitText( page, 'Ready offline', 300000 ); await page.evaluate( () => navigator.serviceWorker.ready );
  await page.setOfflineMode( true ); await page.reload( { waitUntil: 'domcontentloaded' } ); await ready( page );
  const clipCount = await page.$eval( '.st-timeline-clip-select', () => document.querySelectorAll( '.st-timeline-clip-select' ).length ); assert.equal( clipCount, 4 );
  for ( let i = 0; i < clipCount; i ++ ) {
   await page.waitForFunction( i => { const b = document.querySelectorAll( '.st-timeline-clip-select' )[ i ]; return b && ! b.disabled; }, {}, i );
   const clips = await page.$$( '.st-timeline-clip-select' ); await clips[ i ].click(); await page.waitForFunction( i => document.querySelectorAll( '.st-timeline-clip-select' )[ i ]?.getAttribute( 'aria-pressed' ) === 'true', {}, i ); await ready( page );
  }
  await page.click( '[aria-label="Go to sequence start"]' ).catch( () => {} ); await ready( page );
  await page.locator( 'button::-p-text(Record voiceover)' ).click(); await waitText( page, 'Stop recording & save' ); await new Promise( done => setTimeout( done, 1000 ) ); await page.locator( 'button::-p-text(Stop recording & save)' ).click(); await page.waitForSelector( '.st-timeline-audio-clip' ); await ready( page );
  await page.click( 'button[aria-label="Workspace settings"]' ); const name = await page.$( '.sim-dialog-label input' ); await name.focus(); await name.evaluate( e => e.select() ); await name.type( `${runId} offline edit` ); await page.click( '.sim-dialog h2' ); await waitText( page, `${runId} offline edit` ); await page.click( 'button[aria-label="Close dialog"]' );
  const committed = await localDocument( page, user.userId, projectId ); assert.ok( committed.narration.clips.length );
  await page.close(); const reopened = await context.newPage(); reopened.setDefaultTimeout( 180000 ); await reopened.setViewport( { width: 1586, height: 992 } ); await reopened.setOfflineMode( true ); await reopened.goto( `${origin}/student/`, { waitUntil: 'domcontentloaded' } ); await ready( reopened ); assert.deepEqual( await localDocument( reopened, user.userId, projectId ), committed );
  await reopened.setOfflineMode( false ); await reopened.evaluate( () => window.dispatchEvent( new Event( 'online' ) ) ); await waitText( reopened, 'Saved to cloud', 180000 );
  const remote = await adminCall( `/v1/admin/projects/${projectId}` ); assert.equal( remote.status, 200 ); assert.deepEqual( remote.value.document, committed );
  const recording = committed.narration.clips[ 0 ], audio = committed.narration.assets[ `${recording.media.assetId}@${recording.media.version}` ];
  const downloaded = await admin.evaluate( async path => { const r = await fetch( path, { credentials: 'same-origin', cache: 'no-store' } ); return { status: r.status, bytes: [ ...new Uint8Array( await r.arrayBuffer() ) ] }; }, `/v1/admin/projects/${projectId}/narration/${encodeURIComponent( `${audio.assetId}@${audio.version}` )}/content` );
  assert.equal( downloaded.status, 200 ); assert.equal( downloaded.bytes.length, audio.byteLength ); assert.equal( digest( Buffer.from( downloaded.bytes ) ), audio.sha256 );
  report.checks.push( 'Full prepared scene renders offline; recorded audio and exact edit survive close/reopen and sync to admin.' );
  await reopened.screenshot( { path: resolve( out, 'student-synced.png' ) } );
  const review = await browser.newPage(); await review.setCookie( ...( await admin.cookies() ) ); await review.evaluateOnNewDocument( () => { window.reviewAudioStarts = 0; const start = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function ( ...args ) { window.reviewAudioStarts ++; return start.apply( this, args ); }; } );
  const reviewWrites = []; review.on( 'request', req => { if ( new URL( req.url() ).pathname.startsWith( '/v1/admin/projects/' ) && req.method() !== 'GET' ) reviewWrites.push( req.method() ); } );
  await review.goto( `${origin}/admin/users/review/?user=${user.userId}&project=${projectId}`, { waitUntil: 'domcontentloaded' } ); await review.waitForFunction( () => document.querySelector( '#review-status' )?.innerText === 'Read-only review', { timeout: 240000 } );
  await review.click( '#review-play' ); await review.waitForFunction( () => window.reviewAudioStarts > 0, { timeout: 60000 } ); await review.keyboard.down( 'Meta' ); await review.keyboard.press( 's' ); await review.keyboard.press( 'z' ); await review.keyboard.up( 'Meta' ); assert.deepEqual( reviewWrites, [] );
  await review.screenshot( { path: resolve( out, 'admin-review.png' ) } ); await review.close();
  const revoke = await adminCall( `/v1/admin/users/${user.userId}`, { method: 'PATCH', body: { active: false }, key: randomUUID() } ); assert.equal( revoke.status, 200 );
  await reopened.evaluate( () => window.dispatchEvent( new Event( 'online' ) ) ); await reopened.waitForFunction( () => document.querySelector( '#student-auth-state' )?.dataset.state === 'revoked', { timeout: 180000 } ); assert.ok( await reopened.$( 'button::-p-text(Download project JSON)' ) );
  const retained = await adminCall( `/v1/admin/projects/${projectId}` ); assert.equal( retained.status, 200 ); assert.deepEqual( retained.value.document, committed );
  report.checks.push( 'Admin review plays narration without writes; revocation retains student export and admin cloud data.' ); await context.close();
 }
 assert.notEqual( report.users[ 0 ].projectId, report.users[ 1 ].projectId ); report.checks.push( 'Two clean student profiles get independent starter projects.' ); assert.deepEqual( pageErrors, [] );
 // Retain accounts/projects as evidence; mark both accounts revoked rather than delete.
 for ( const user of report.users ) { const r = await adminCall( `/v1/admin/users/${user.userId}`, { method: 'PATCH', body: { active: false }, key: randomUUID() } ); assert.equal( r.status, 200 ); }
 report.passed = true;
} catch ( error ) {
 report.failures.push( { name: error.name, message: error.message.split( '\n' )[ 0 ].replace( /#login=[^\s)]+/g, '#login=[redacted]' ) } ); throw new Error( 'Hosted account smoke failed; inspect the private report.' );
} finally {
 await writeFile( resolve( out, 'report.json' ), JSON.stringify( report, null, 2 ), { mode: 0o600 } ); await browser?.close(); console.log( JSON.stringify( { report: resolve( out, 'report.json' ), passed: !! report.passed, checks: report.checks, failures: report.failures } ) );
}
