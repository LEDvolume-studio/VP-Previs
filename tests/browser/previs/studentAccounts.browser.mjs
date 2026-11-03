// Actual production editor + Worker, native D1/R2/IndexedDB and isolated profiles.
// Build first; this is a local-only fixture and creates no hosted accounts.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, extname, sep } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

const require = createRequire( new URL( '../../../backend/package.json', import.meta.url ) );
const { Miniflare } = require( 'miniflare' );
const { build } = require( 'esbuild' );
const { unstable_splitSqlQuery: splitSql } = require( 'wrangler' );
const root = resolve( process.env.STUDENT_BUILD_DIR || 'app/dist' );
const digest = value => createHash( 'sha256' ).update( value ).digest( 'hex' );
const userId = randomUUID(), credential = randomUUID();
const bundled = await build( { entryPoints: [ 'backend/src/worker.js' ], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' } );
const mf = new Miniflare( { modules: true, script: bundled.outputFiles[ 0 ].text, compatibilityDate: '2026-07-30', d1Databases: [ 'DB', 'ADMIN_AUTH_DB' ], r2Buckets: [ 'DOCUMENTS', 'NARRATION', 'LIBRARY' ], bindings: {
 ENVIRONMENT: 'test', ENABLE_DRAFT_API: 'true', ENABLE_CATALOGUE_API: 'true', ALLOW_LOCAL_GEO_EXEMPTION: 'true', MAX_JSON_BYTES: '2097152', MAX_LIBRARY_ASSET_BYTES: '67108864', MAX_NARRATION_BYTES: '16777216', MAX_DRAFT_REVISIONS: '10000', MAX_DRAFT_MEDIA: '100', MAX_DRAFT_CREATIONS_PER_MINUTE: '100'
} } );
const db = await mf.getD1Database( 'DB' ), documents = await mf.getR2Bucket( 'DOCUMENTS' ), library = await mf.getR2Bucket( 'LIBRARY' );
for ( const file of ( await readdir( 'backend/migrations' ) ).filter( name => /^\d+_.*\.sql$/.test( name ) ).sort() ) {
 const sql = await readFile( `backend/migrations/${file}`, 'utf8' ); await db.batch( splitSql( sql ).map( query => db.prepare( query ) ) );
}
await db.prepare( 'INSERT INTO student_users (user_id,first_name,last_name,graduation_year,credential_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)' ).bind( userId, 'Test', 'Student', 2030, digest( credential ), Date.now(), Date.now() ).run();
const starter = createStudentProjectDocument( { projectId: randomUUID(), name: 'Test starting timeline' } );
const text = JSON.stringify( starter ), hash = digest( text ), objectKey = `default/${randomUUID()}.json`, versionId = randomUUID();
await db.prepare( "INSERT INTO object_reservations VALUES (?,'pending',?)" ).bind( objectKey, Date.now() ).run();
await documents.put( objectKey, text, { sha256: hash, httpMetadata: { contentType: 'application/json' } } );
await library.put( 'student/shared-starting-project.json', text, { httpMetadata: { contentType: 'application/json' } } );
await db.prepare( 'INSERT INTO student_default_versions VALUES (?,?,?,?,?,?)' ).bind( versionId, objectKey, hash, Buffer.byteLength( text ), JSON.stringify( { assets: [], scenes: [], narration: [] } ), Date.now() ).run();
await db.prepare( 'INSERT INTO student_default_head VALUES (1,?,0,?)' ).bind( versionId, Date.now() ).run();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.png': 'image/png' };
let failApi = false, holdWrites = false, releaseWrites;
const calls = [], errors = [];
const server = createServer( async ( request, response ) => {
 try {
  const url = new URL( request.url, 'http://localhost' );
  if ( url.pathname.startsWith( '/v1/' ) ) {
   const chunks = []; for await ( const chunk of request ) chunks.push( chunk ); const body = Buffer.concat( chunks );
   const headers = { ...request.headers }; delete headers.host; delete headers.connection; delete headers[ 'content-length' ];
   calls.push( { path: url.pathname, method: request.method } );
   if ( failApi ) { response.writeHead( 503 ); response.end(); return; }
   if ( holdWrites && [ 'POST', 'PUT', 'PATCH' ].includes( request.method ) && url.pathname.startsWith( '/v1/student/projects' ) ) await new Promise( done => { releaseWrites = done; } );
   const result = await mf.dispatchFetch( `http://localhost${url.pathname}${url.search}`, { method: request.method, headers, ...( body.length ? { body } : {} ) } );
   const output = Buffer.from( await result.arrayBuffer() ), outgoing = Object.fromEntries( result.headers ); delete outgoing[ 'content-length' ]; delete outgoing[ 'content-encoding' ]; response.writeHead( result.status, outgoing ); response.end( output ); return;
  }
  if ( url.pathname === '/favicon.ico' ) { response.writeHead( 204 ); response.end(); return; }
  const path = resolve( root, `.${decodeURIComponent( url.pathname )}${url.pathname.endsWith( '/' ) ? 'index.html' : ''}` ); if ( ! path.startsWith( `${root}${sep}` ) ) throw new Error( 'Invalid path' );
  const bytes = await readFile( path ); response.writeHead( 200, { 'Content-Type': mime[ extname( path ) ] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } ); response.end( bytes );
 } catch ( error ) { errors.push( `${request.url}: ${error.message}` ); response.writeHead( 500 ); response.end(); }
} );
await new Promise( done => server.listen( 0, '127.0.0.1', done ) );
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];
try {
 browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: [ '--enable-unsafe-webgpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream' ] } );
 const isolated = async () => { const context = await browser.createBrowserContext(); const page = await context.newPage(); page.setDefaultTimeout( 30000 ); page.on( 'pageerror', error => errors.push( error.message ) ); return { context, page }; };
 const authState = ( page, expected ) => page.waitForFunction( state => document.querySelector( '#student-auth-state' )?.dataset.state === state, { timeout: 30000 }, expected );
 const dbNames = page => page.evaluate( async () => ( await indexedDB.databases() ).map( entry => entry.name ) );
 const missing = await isolated(); await missing.page.goto( `${origin}/student/`, { waitUntil: 'domcontentloaded' } ); await authState( missing.page, 'missing' );
 assert.match( await missing.page.$eval( '#student-auth-state', element => element.textContent ), /Please request a login link from your VP supervisor/ );
 assert.ok( ! ( await dbNames( missing.page ) ).some( name => name.startsWith( 'RayzeeStudentDB:account:' ) ) );
 await missing.page.evaluate( () => navigator.serviceWorker.ready ); await missing.page.reload( { waitUntil: 'domcontentloaded' } ); await authState( missing.page, 'missing' );
 await missing.page.setOfflineMode( true ); await missing.page.goto( `${origin}/student/#login=${credential}`, { waitUntil: 'domcontentloaded' } ); await authState( missing.page, 'offline' );
 assert.ok( ! ( await dbNames( missing.page ) ).some( name => name.startsWith( 'RayzeeStudentDB:account:' ) ) );
 await missing.context.close(); checks.push( 'Missing identity and a never-validated offline link cannot create a project' );
 const invalid = await isolated(); await invalid.page.goto( `${origin}/student/#login=${randomUUID()}`, { waitUntil: 'domcontentloaded' } ); await authState( invalid.page, 'invalid' );
 assert.ok( ! ( await dbNames( invalid.page ) ).some( name => name.startsWith( 'RayzeeStudentDB:account:' ) ) ); await invalid.context.close(); checks.push( 'Unknown link is rejected without an anonymous project' );
 const first = await isolated(), simultaneous = await isolated();
 await Promise.all( [ first.page.goto( `${origin}/student/#login=${credential}`, { waitUntil: 'domcontentloaded' } ), simultaneous.page.goto( `${origin}/student/#login=${credential}`, { waitUntil: 'domcontentloaded' } ) ] );
 await first.page.waitForFunction( () => !!document.querySelector( '.sim-project-button' ) && document.querySelector( '.sim-project-button' ).innerText.includes( 'Test starting timeline' ), { timeout: 60000 } );
 await simultaneous.page.waitForFunction( () => document.querySelector( '.sim-project-button' )?.innerText.includes( 'Test starting timeline' ), { timeout: 60000 } );
 assert.equal( await first.page.evaluate( () => location.hash ), '' );
 await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved to cloud'),{timeout:60000});
 const initial = await db.prepare( "SELECT project_id FROM student_projects WHERE user_id=? AND state='live'" ).bind( userId ).all(); assert.equal( initial.results.length, 1 ); const projectId = initial.results[ 0 ].project_id;
 assert.equal( ( await db.prepare( 'SELECT count(*) AS n FROM student_bootstraps WHERE user_id=?' ).bind( userId ).first() ).n, 1 );
 const simultaneousProjectId = await simultaneous.page.evaluate( id => new Promise( ( done, reject ) => { const r = indexedDB.open( `RayzeeStudentDB:account:v1:${id}` ); r.onerror = () => reject( r.error ); r.onsuccess = () => { const d = r.result, tx = d.transaction( 'projects' ), q = tx.objectStore( 'projects' ).getAll(); tx.oncomplete = () => { d.close(); done( q.result.map( row => row.projectId ) ); }; tx.onabort = () => reject( tx.error ); }; } ), userId );
 assert.deepEqual( simultaneousProjectId, [ projectId ] ); await simultaneous.context.close();
 checks.push( 'Simultaneous clean-profile logins share exactly one durable starter identity' );
 checks.push( 'Valid link removes credential from address and creates one durable starter' );
 // Inject a native local transaction failure and confirm both the unsaved
 // warning and recovery path preserve the last committed revision.
 await first.page.evaluate(()=>{window.originalAccountPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='projects')throw new DOMException('Quota exceeded','QuotaExceededError');return window.originalAccountPut.apply(this,args)}});
 await first.page.click('button[aria-label="Workspace settings"]');let editName=await first.page.$('.sim-dialog-label input');await editName.focus();await editName.evaluate(e=>e.select());await editName.type('Quota retry');await first.page.click('.sim-dialog h2');
 await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Not saved on this device'),{timeout:30000});
 assert.ok(await first.page.$('button::-p-text(Download attempted project)'));await first.page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalAccountPut});await first.page.click('button[aria-label="Close dialog"]');await first.page.locator('button::-p-text(Retry save)').click();
 await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved to cloud'),{timeout:60000});
 checks.push('Native quota denial reports unsaved work and retry commits it');
 // A queued edit must not inherit the previous cloud acknowledgement.
 await first.page.evaluate(()=>{window.statusHistory=[];const node=document.querySelector('#editor-save-status');new MutationObserver(()=>window.statusHistory.push(node.innerText)).observe(node,{subtree:true,childList:true,characterData:true})});
 holdWrites=true;await first.page.click('button[aria-label="Workspace settings"]');editName=await first.page.$('.sim-dialog-label input');await editName.focus();await editName.evaluate(e=>e.select());await editName.type('Delayed sync');await first.page.click('.sim-dialog h2');await first.page.click('button[aria-label="Close dialog"]');
 await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Syncing'),{timeout:30000});
 assert.ok(releaseWrites);holdWrites=false;releaseWrites();releaseWrites=null;await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved to cloud'),{timeout:60000});
 const statusHistory=await first.page.evaluate(()=>window.statusHistory);assert.ok(statusHistory.some(s=>s.includes('Saving on this device')),'Local saving state must be visible');assert.ok(statusHistory.some(s=>s.includes('Waiting to sync')),'Pending upload state must be visible');
 checks.push('Delayed upload displays syncing until the exact revision is acknowledged');
 // Exhaust transient failures while remaining online, then verify manual retry.
 failApi=true;await first.page.click('button[aria-label="Workspace settings"]');editName=await first.page.$('.sim-dialog-label input');await editName.focus();await editName.evaluate(e=>e.select());await editName.type('Server unavailable');await first.page.click('.sim-dialog h2');await first.page.click('button[aria-label="Close dialog"]');
 await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Cloud unavailable'),{timeout:90000});
 assert.ok(await first.page.$('#editor-save-status button::-p-text(Retry)'));failApi=false;await first.page.locator('#editor-save-status button::-p-text(Retry)').click();
 await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved to cloud'),{timeout:60000});checks.push('Exhausted server retries show cloud unavailable and manual retry recovers');


 const returning = await isolated(); await returning.page.goto( `${origin}/student/#login=${credential}`, { waitUntil: 'domcontentloaded' } );
 await returning.page.waitForSelector( '.sim-project-button', { timeout: 60000 } );
 const returningIds = await returning.page.evaluate( id => new Promise( ( done, reject ) => { const r = indexedDB.open( `RayzeeStudentDB:account:v1:${id}` ); r.onerror = () => reject( r.error ); r.onsuccess = () => { const d = r.result, tx = d.transaction( 'projects' ), q = tx.objectStore( 'projects' ).getAll(); tx.oncomplete = () => { d.close(); done( q.result.map( row => row.projectId ) ); }; tx.onabort = () => reject( tx.error ); }; } ), userId );
 assert.deepEqual( returningIds, [ projectId ] );
 assert.equal( ( await db.prepare( "SELECT count(*) AS n FROM student_projects WHERE user_id=? AND state='live'" ).bind( userId ).first() ).n, 1 );
 // Both profiles hold the same head; delay the second upload until the first
 // has committed so the conditional request must preserve a recovery copy.
 await returning.page.setOfflineMode(true);
 await returning.page.click('button[aria-label="Workspace settings"]');let secondName=await returning.page.$('.sim-dialog-label input');await secondName.focus();await secondName.evaluate(e=>e.select());await secondName.type('Other device edit');await returning.page.click('.sim-dialog h2');await returning.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('Other device edit'));await returning.page.click('button[aria-label="Close dialog"]');
 await first.page.click('button[aria-label="Workspace settings"]');editName=await first.page.$('.sim-dialog-label input');await editName.focus();await editName.evaluate(e=>e.select());await editName.type('Cloud winner');await first.page.click('.sim-dialog h2');await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('Cloud winner'));await first.page.click('button[aria-label="Close dialog"]');await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved to cloud'),{timeout:60000});
 await returning.page.setOfflineMode(false);await returning.page.evaluate(()=>window.dispatchEvent(new Event('online')));await returning.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Changes preserved'),{timeout:60000});
 await returning.page.locator('button::-p-text(Save local as copy)').click();await returning.page.waitForFunction(id=>new Promise((done,reject)=>{const r=indexedDB.open(`RayzeeStudentDB:account:v1:${id}`);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,tx=d.transaction('projects'),q=tx.objectStore('projects').getAll();tx.oncomplete=()=>{d.close();done(q.result.length>1)};tx.onabort=()=>reject(tx.error)}}),{timeout:60000},userId);
 const copies=await returning.page.evaluate(id=>new Promise((done,reject)=>{const r=indexedDB.open(`RayzeeStudentDB:account:v1:${id}`);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,tx=d.transaction('projects'),q=tx.objectStore('projects').getAll();tx.oncomplete=()=>{d.close();done(q.result.map(x=>({id:x.projectId,name:x.document.name})))};tx.onabort=()=>reject(tx.error)}}),userId);
 assert.ok(copies.some(row=>row.id!==projectId && row.name==='Other device edit'));checks.push('Cross-device conflict retains the local edit as an independent copy');
 await returning.context.close(); checks.push( 'Another clean profile sees the same starter identity' );
 await first.page.evaluate( () => navigator.serviceWorker.ready ); await first.page.reload( { waitUntil: 'domcontentloaded' } ); await first.page.waitForSelector( '.sim-project-button', { timeout: 60000 } );
 await first.page.waitForFunction(id=>new Promise((done,reject)=>{const r=indexedDB.open(`RayzeeStudentDB:account:v1:${id}`);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('sync'),q=tx.objectStore('sync').get('__account_default__');tx.oncomplete=()=>{db.close();done(!!q.result?.defaultVersion)};tx.onabort=()=>reject(tx.error)}}),{timeout:60000},userId);
 await first.page.setOfflineMode( true ); await first.page.reload( { waitUntil: 'domcontentloaded' } ); await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('Cloud winner'), { timeout: 15000 } ).catch(async e=>{console.log('OFFLINE DEBUG',await first.page.evaluate(()=>({text:document.body.innerText, keys:{...localStorage}})));throw e});
 assert.match( await first.page.$eval( '.sim-project-button', element => element.textContent ), /Cloud winner/ );
 await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved on this device · Offline'),{timeout:60000});
 const stored = await first.page.evaluate( id => new Promise( ( done, reject ) => { const r = indexedDB.open( `RayzeeStudentDB:account:v1:${id}` ); r.onerror = () => reject( r.error ); r.onsuccess = () => { const d = r.result, tx = d.transaction( 'projects' ), q = tx.objectStore( 'projects' ).getAll(); tx.oncomplete = () => { d.close(); done( q.result.map( row => row.projectId ) ); }; tx.onabort = () => reject( tx.error ); }; } ), userId );
 assert.ok( stored.includes(projectId) ); checks.push( 'Remembered validated account opens the identical local project offline' );
 await first.page.click('button[aria-label="Workspace settings"]');
 const name = await first.page.$('.sim-dialog-label input'); await name.focus(); await name.evaluate(element=>element.select()); await name.type('Offline renamed'); await first.page.click('.sim-dialog h2');
 await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('Offline renamed'));
 await first.page.click('button[aria-label="Close dialog"]'); await first.page.reload({waitUntil:'domcontentloaded'});
 await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('Offline renamed'),{timeout:60000});
 await first.page.click('.sim-project-button'); await first.page.locator('button::-p-text(Duplicate project)').click();
 await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('copy'),{timeout:60000});
 checks.push('Offline rename survives restart and duplicate opens');
 // The acknowledged original must not lend its cloud indicator to an offline copy.
 await first.page.setOfflineMode(false);await first.page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved to cloud'),{timeout:60000});
 // Hold a write on the original, switch to the independently acknowledged copy,
 // and release the original's acknowledgement while the copy stays selected.
 await first.page.click('.sim-project-button');await first.page.evaluate(()=>[...document.querySelectorAll('.sim-menu button[role=menuitem]')].find(b=>b.textContent.includes('Offline renamed')&&!b.textContent.includes('copy')).click());
 await first.page.waitForFunction(()=>!document.querySelector('.sim-project-button')?.innerText.includes('copy'));
 const revisionBeforeSelection=await first.page.evaluate(id=>new Promise((done,reject)=>{const r=indexedDB.open(`RayzeeStudentDB:account:v1:${id}`);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('projects'),q=tx.objectStore('projects').getAll();tx.oncomplete=()=>{db.close();done(q.result.map(x=>[x.projectId,x.document.revision]))};tx.onabort=()=>reject(tx.error)}}),userId);
 await first.page.click('.sim-project-button');await first.page.locator('button[role="menuitem"]::-p-text(Offline renamed copy)').click();await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('copy'));
 const revisionAfterSelection=await first.page.evaluate(id=>new Promise((done,reject)=>{const r=indexedDB.open(`RayzeeStudentDB:account:v1:${id}`);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('projects'),q=tx.objectStore('projects').getAll();tx.oncomplete=()=>{db.close();done(q.result.map(x=>[x.projectId,x.document.revision]))};tx.onabort=()=>reject(tx.error)}}),userId);assert.deepEqual(revisionAfterSelection,revisionBeforeSelection);
 await first.page.click('.sim-project-button');await first.page.evaluate(()=>[...document.querySelectorAll('.sim-menu button[role=menuitem]')].find(b=>b.textContent.includes('Offline renamed')&&!b.textContent.includes('copy')).click());await first.page.waitForFunction(()=>!document.querySelector('.sim-project-button')?.innerText.includes('copy'));
 holdWrites=true;await first.page.click('button[aria-label="Workspace settings"]');editName=await first.page.$('.sim-dialog-label input');await editName.focus();await editName.evaluate(e=>e.select());await editName.type('Offline renamed updated');await first.page.click('.sim-dialog h2');await first.page.click('button[aria-label="Close dialog"]');await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Syncing'));
 await first.page.click('.sim-project-button');await first.page.locator('button[role="menuitem"]::-p-text(Offline renamed copy)').click();await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('copy'));
 await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved to cloud'));assert.ok(releaseWrites);holdWrites=false;releaseWrites();releaseWrites=null;
 await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved to cloud'));assert.match(await first.page.$eval('.sim-project-button',e=>e.innerText),/copy/);checks.push('Selection creates no edit; another project’s in-flight acknowledgement cannot replace selected project status');
 await first.page.setOfflineMode(true);await first.page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Offline'));
 await first.page.click('.sim-project-button');await first.page.evaluate(()=>[...document.querySelectorAll('.sim-menu button[role=menuitem]')].find(b=>b.textContent.includes('Offline renamed')&&!b.textContent.includes('copy')).click());
 await first.page.waitForFunction(()=>!document.querySelector('.sim-project-button')?.innerText.includes('copy'));
 assert.match(await first.page.$eval('#editor-save-status',e=>e.innerText),/Offline/);
 await first.page.click('.sim-project-button');await first.page.locator('button[role="menuitem"]::-p-text(Offline renamed copy)').click();
 await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('copy'));
 assert.match(await first.page.$eval('#editor-save-status',e=>e.innerText),/Offline/);checks.push('Switching projects keeps save status tied to the selected project');

 await first.page.click('.sim-project-button');
 await first.page.evaluate(()=>[...document.querySelectorAll('.sim-menu > div')].find(d=>d.textContent.includes('Offline renamed copy')).querySelector('button:nth-child(2)').click());
 await first.page.waitForFunction(()=>!document.querySelector('.sim-project-button')?.innerText.includes('copy'),{timeout:60000});
 await first.page.click('.sim-project-button');await first.page.waitForFunction(()=>document.querySelector('.sim-menu')?.innerText.includes('Restore'));
 await first.page.locator('button::-p-text(Restore)').click();await first.page.click('.sim-project-button');
 await first.page.waitForFunction(()=>document.querySelector('.sim-menu')?.innerText.includes('Offline renamed copy') && !document.querySelector('.sim-menu')?.innerText.includes('Archived'),{timeout:60000});
 checks.push('Offline archive and restore update the project picker');
 await first.page.locator('button::-p-text(New project)').click();await first.page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('Test starting timeline'),{timeout:60000});
 const newIds=await first.page.evaluate(id=>new Promise((done,reject)=>{const r=indexedDB.open(`RayzeeStudentDB:account:v1:${id}`);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('projects'),q=tx.objectStore('projects').getAll();tx.oncomplete=()=>{db.close();done(q.result.map(row=>({id:row.projectId,name:row.document.name})))};tx.onabort=()=>reject(tx.error)}}),userId);assert.ok(newIds.some(row=>row.id!==projectId&&row.name==='Test starting timeline'));assert.ok(newIds.some(row=>row.id===projectId&&row.name==='Offline renamed updated'));checks.push('Offline New copies the pinned default independently of edited projects');
 await db.prepare("UPDATE student_users SET access_state='revoked',access_generation=access_generation+1 WHERE user_id=?").bind(userId).run();
 await first.page.setOfflineMode(false);await first.page.evaluate(()=>window.dispatchEvent(new Event('online')));await authState(first.page,'revoked');
 assert.match(await first.page.$eval('#student-auth-state',e=>e.innerText),/Local changes retained for download/);assert.ok(await first.page.$('button::-p-text(Download project JSON)'));checks.push('Revocation stops access and keeps local export available');



 await first.context.close();
 assert.deepEqual( errors, [] ); console.log( JSON.stringify( { browser: await browser.version(), checks, calls: calls.length }, null, 2 ) );
} finally { releaseWrites?.(); await browser?.close(); await new Promise( done => server.close( done ) ); await mf.dispose(); }
