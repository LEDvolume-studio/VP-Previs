// Production build + real editor + native Chromium storage and Service Worker.
// Uses the preserved, explicitly selected revision-113 project and audio.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import puppeteer from 'puppeteer-core';

// Keep a coherent built graph even when another task rebuilds app/dist.
const snapshot = await mkdtemp( resolve( tmpdir(), 'rayzee-offline-build-' ) );
await cp( resolve( process.env.STUDENT_BUILD_DIR || 'app/dist' ), snapshot, { recursive: true } );
const root = snapshot;
const publicManifest = JSON.parse( await readFile( resolve( root, 'student/edge-public-assets.json' ), 'utf8' ) );
for ( const entry of publicManifest.files ) {
 const bytes = await readFile( resolve( root, `.${entry.path}${entry.path.endsWith( '/' ) ? 'index.html' : ''}` ) );
 assert.equal( createHash( 'sha256' ).update( bytes ).digest( 'hex' ), entry.sha256, 'Build changed during test snapshot; rebuild and rerun.' );
}
const source = JSON.parse( await readFile( process.env.STUDENT_OFFLINE_PROJECT || '.local-runtime/browser-student-default-export-20261102.json', 'utf8' ) );
const audio = await readFile( process.env.STUDENT_OFFLINE_AUDIO || '.local-runtime/browser-student-default-audio-20261102.webm' );
const asset = Object.values( source.narration.assets )[ 0 ];
assert.equal( createHash( 'sha256' ).update( audio ).digest( 'hex' ), asset.sha256 );
assert.equal( audio.length, asset.byteLength );
const worker = await readFile( resolve( root, 'student/sw.js' ), 'utf8' );
const manifest = JSON.parse( worker.match( /const PRECACHE = (\[[^\n]+\]);/ )[ 1 ] );
const cacheName = JSON.parse( worker.match( /const CACHE_NAME = ("[^\n]+");/ )[ 1 ] );
let servedWorker = worker;
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.wasm':'application/wasm', '.png':'image/png' };
const serverErrors = [], requests = [];
const server = createServer( async ( req, res ) => {
 try {
  const url = new URL( req.url, 'http://localhost' );
  if ( url.pathname === '/student/sw.js' ) { res.writeHead( 200, { 'Content-Type':'text/javascript', 'Cache-Control':'no-store' } ); res.end( servedWorker ); return; }
  if ( url.pathname === '/v1/student/starting-project' ) { res.writeHead( 200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' } ); res.end( JSON.stringify( source ) ); return; }
  if ( url.pathname.startsWith( '/v1/catalogue' ) || url.pathname.startsWith( '/v1/plates' ) ) {
   const remote = await fetch( `https://vp-previs.pages.dev${url.pathname}${url.search}`, { method:req.method, headers:{ Origin:'https://vp-previs.pages.dev', ...( req.headers.cookie ? { Cookie:req.headers.cookie } : {} ), ...( req.headers.range ? { Range:req.headers.range } : {} ) } } );
   requests.push( { path:url.pathname, status:remote.status } ); const headers = Object.fromEntries( remote.headers ); delete headers['content-encoding']; delete headers['content-length'];
   res.writeHead( remote.status, headers ); res.end( Buffer.from( await remote.arrayBuffer() ) ); return;
  }
  if ( url.pathname.startsWith( '/v1/' ) ) { res.writeHead( 404 ); res.end(); return; }
  const path = resolve( root, `.${decodeURIComponent( url.pathname )}${url.pathname.endsWith('/')?'index.html':''}` );
  if ( ! path.startsWith( `${root}${sep}` ) ) throw new Error('Invalid path');
  const bytes = await readFile( path ); res.writeHead( 200, { 'Content-Type':mime[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-store', 'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'credentialless' } ); res.end(bytes);
 } catch ( error ) { if ( req.url !== '/favicon.ico' ) serverErrors.push( `${req.url}: ${error.message}` ); res.writeHead(404); res.end(); }
} );
await new Promise( done => server.listen( 0, '127.0.0.1', done ) );
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser = await puppeteer.launch( { executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, protocolTimeout:240000, args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] } );
 let page = await browser.newPage(); page.setDefaultTimeout( 180000 ); await page.setViewport( { width:1586, height:992 } );
 const errors=[]; page.on( 'pageerror', e => {errors.push(e.message);console.log('PAGEERROR',e.message)} );page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()?.errorText));page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
 await page.goto( `${origin}/student/`, { waitUntil:'domcontentloaded' } );
 // Seed a previously validated identity only; the actual account login UI arrives in Step 8.
 const userId = randomUUID(), credential = randomUUID(), versionId = randomUUID();
 await page.evaluate( async ( { userId, credential, audio, asset, source, versionId } ) => {
  const open = ( name, version, upgrade ) => new Promise( ( resolve, reject ) => { const request=indexedDB.open(name,version); request.onupgradeneeded=()=>upgrade(request.result); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); } );
  const identity = await open('RayzeeStudentIdentityDB',1,db=>db.createObjectStore('identities',{keyPath:'userId'}));
  await new Promise((resolve,reject)=>{const tx=identity.transaction('identities','readwrite');tx.objectStore('identities').put({userId,credential,accessGeneration:1});tx.objectStore('identities').put({userId:'__active__',activeUserId:userId});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)}); identity.close();
  const projectDbName=`RayzeeStudentDB:account:v1:${userId}`;
  const projects=await open(projectDbName,1,db=>{for(const name of ['projects','revisions','outbox','sync','recoveries']){const store=db.createObjectStore(name,{keyPath:['revisions','outbox'].includes(name)?['projectId','revision']:name==='recoveries'?'recoveryId':'projectId'});if(['revisions','outbox','recoveries'].includes(name))store.createIndex('projectId','projectId')}});
  await new Promise((resolve,reject)=>{const tx=projects.transaction(['projects','revisions','sync'],'readwrite');const savedAt=new Date().toISOString();tx.objectStore('projects').put({projectId:source.projectId,document:source,savedAt});tx.objectStore('revisions').put({projectId:source.projectId,revision:source.revision,document:source,savedAt});tx.objectStore('sync').put({projectId:source.projectId,serverRevision:0,acknowledgedRevision:source.revision});tx.objectStore('sync').put({projectId:'__account_default__',defaultVersion:{versionId,pointerRevision:0,document:source}});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});projects.close();
  const narration = await open(`${projectDbName}:narration`,1,db=>db.createObjectStore('recordings',{keyPath:'assetId'}));
  await new Promise((resolve,reject)=>{const tx=narration.transaction('recordings','readwrite');tx.objectStore('recordings').put({assetId:asset.assetId,projectId:null,asset,blob:new Blob([new Uint8Array(audio)],{type:asset.mimeType})});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)}); narration.close();
 }, { userId, credential, audio:[...audio], asset, source, versionId } );
 const projectDbName=`RayzeeStudentDB:account:v1:${userId}`;
 await page.evaluate( () => navigator.serviceWorker.ready );
 await page.reload( { waitUntil:'domcontentloaded' } );
 const ready = async () => {try{await page.waitForFunction( () => ! document.querySelector('[aria-label="Viewer mode"]')?.disabled && !!document.querySelector('#sim-viewport-host canvas'), { timeout:180000 } )}catch(e){console.log('NOT READY',await page.evaluate(()=>document.body.innerText));await page.screenshot({path:'/tmp/rayzee-offline-failure.png'});throw e}};
 await ready(); await page.waitForFunction( () => document.querySelectorAll('.st-timeline-clip-select').length===4 );
 const read = () => page.evaluate( dbName => new Promise((resolve,reject)=>{const r=indexedDB.open(dbName);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('projects'),q=tx.objectStore('projects').getAll();tx.oncomplete=()=>{db.close();resolve(q.result[0].document)};tx.onabort=()=>reject(tx.error)}}), projectDbName );
 const initial=await read(); assert.equal(initial.clips.length,4);
 console.log('ONLINE EDITOR READY',initial.projectId,initial.revision);
 // Full asset inventory must be durable before claiming readiness.
 await page.waitForFunction(() => document.body.innerText.includes('Ready offline'), {timeout:240000});
 const cached=await page.evaluate(async name=>(await (await caches.open(name)).keys()).map(r=>new URL(r.url).pathname).sort(),cacheName);
 assert.deepEqual(cached,[...manifest].sort());
 console.log('READY OFFLINE');await page.setOfflineMode(true);
 await page.reload({waitUntil:'domcontentloaded'}); await ready();
 assert.equal(await page.evaluate(()=>isSecureContext&&crossOriginIsolated),true);
 // Inspection, selection and playback are navigation, not authoring edits.
 const navigationBaseline=await read();
 await page.click('[aria-label="Viewer mode"]');await ready();await page.waitForFunction(()=>!document.querySelector('[aria-label="Viewer mode"]')?.disabled);await page.click('[aria-label="Viewer mode"]');await ready();
 await page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Play sequence"]');return b&&!b.disabled});await page.locator('button[aria-label="Play sequence"]').click();await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Timeline playhead"]')?.getAttribute('aria-valuenow'))>=5,{timeout:60000});await page.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Pause sequence"]');return b&&!b.disabled});await page.locator('button[aria-label="Pause sequence"]').click();await ready();
 assert.deepEqual(await read(),navigationBaseline);console.log('OFFLINE NAVIGATION AND PLAYBACK UNCHANGED');
 // Record into the account namespace with networking blocked, then verify the
 // blob and timeline placement in their native durable stores.
 await page.locator('button::-p-text(Record voiceover)').click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Stop recording & save'));
 await new Promise(resolve=>setTimeout(resolve,1200));await page.locator('button::-p-text(Stop recording & save)').click();await page.waitForSelector('.st-timeline-audio-clip',{timeout:60000});await ready();
 const recorded=await read();const recording=recorded.narration.clips[0];assert.ok(recording?.lengthSamples>0);
 const recordedBlob=await page.evaluate(({dbName,id})=>new Promise((resolve,reject)=>{const r=indexedDB.open(`${dbName}:narration`);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('recordings'),q=tx.objectStore('recordings').get(id);tx.oncomplete=()=>{db.close();resolve({size:q.result?.blob?.size,asset:q.result?.asset})};tx.onabort=()=>reject(tx.error)}}),{dbName:projectDbName,id:recording.media.assetId});assert.ok(recordedBlob.size>0);assert.equal(recordedBlob.asset.durationSamples,recording.lengthSamples);
 console.log('OFFLINE RECORDING SAVED');
 await page.click('[aria-label="Delete voiceover 1"]');await page.waitForFunction(()=>!document.querySelector('.st-timeline-audio-clip'),{timeout:60000});
 await page.waitForFunction(()=>{const b=document.querySelector('[aria-label="Undo"]');return b&&!b.disabled},{timeout:60000});await page.click('[aria-label="Undo"]');await page.waitForSelector('.st-timeline-audio-clip',{timeout:60000});
 assert.equal((await read()).narration.clips.length,1);
 await page.waitForFunction(()=>{const b=document.querySelector('[aria-label="Redo"]');return b&&!b.disabled},{timeout:60000});await page.click('[aria-label="Redo"]');await page.waitForFunction(()=>!document.querySelector('.st-timeline-audio-clip'),{timeout:60000});
 await page.waitForFunction(()=>{const b=document.querySelector('[aria-label="Undo"]');return b&&!b.disabled},{timeout:60000});await page.click('[aria-label="Undo"]');await page.waitForSelector('.st-timeline-audio-clip',{timeout:60000});
 assert.equal((await read()).narration.clips.length,1);
 await page.evaluate(()=>{window.originalNarrationPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(value?.blob instanceof Blob)throw new DOMException('Storage full','QuotaExceededError');return window.originalNarrationPut.call(this,value,...args)}});
 await page.locator('button::-p-text(Record voiceover)').click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Stop recording & save'));
 await new Promise(resolve=>setTimeout(resolve,700));await page.locator('button::-p-text(Stop recording & save)').click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Retry voiceover save'));
 assert.equal((await read()).narration.clips.length,1);await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalNarrationPut});await page.locator('button::-p-text(Retry voiceover save)').click();await page.waitForFunction(()=>document.querySelectorAll('.st-timeline-audio-clip').length===2,{timeout:60000});
 const beforePreset=(await read()).revision;
 await page.waitForFunction(()=>[...document.querySelectorAll('.sim-preset')].some(b=>!b.disabled),{timeout:60000});
 const presets=await page.$$('.sim-preset');await presets[1].click();
 await page.waitForFunction(async(dbName,id,revision)=>new Promise((resolve,reject)=>{const r=indexedDB.open(dbName);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('projects'),q=tx.objectStore('projects').get(id);tx.oncomplete=()=>{db.close();resolve((q.result?.document.revision??-1)>revision)};tx.onabort=()=>reject(tx.error)}}),{timeout:60000},projectDbName,initial.projectId,beforePreset);
 const baseRevision=(await read()).revision;console.log('OFFLINE RECORDING RETRY, UNDO, REDO AND PRESET SAVED');
 for(let index=0;index<4;index++){console.log('SHOT',index+1);
  await page.waitForFunction(i=>{const b=document.querySelectorAll('.st-timeline-clip-select')[i];return b&&!b.disabled},{timeout:180000},index);const clips=await page.$$('.st-timeline-clip-select');await clips[index].click();console.log('CLICKED',index+1);await page.waitForFunction(i=>document.querySelectorAll('.st-timeline-clip-select')[i]?.getAttribute('aria-pressed')==='true' && !document.querySelector('input[aria-label="Exposure"]')?.disabled,{timeout:180000},index);await ready();console.log('SHOT READY',index+1);
  const exposure=await page.$('input[aria-label="Exposure"]');await exposure.focus();await exposure.evaluate(element=>element.select());await exposure.type((0.51+index*0.1).toFixed(2));await exposure.press('Tab');console.log('SHOT INPUT',index+1);
  await page.waitForFunction(async(dbName,id,minimum)=>new Promise((resolve,reject)=>{const r=indexedDB.open(dbName);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('projects'),q=tx.objectStore('projects').get(id);tx.oncomplete=()=>{db.close();resolve((q.result?.document.revision??-1)>=minimum)};tx.onabort=()=>reject(tx.error)}}),{timeout:60000},projectDbName,initial.projectId,baseRevision+index+1);console.log('SHOT SAVED',index+1);
 }
 await ready();await page.waitForFunction(()=>!document.querySelector('button[aria-label="Workspace settings"]')?.disabled);
 await page.click('button[aria-label="Workspace settings"]');
 const input=await page.$('.sim-dialog-label input');await input.focus();await input.evaluate(element=>element.select());await input.type('Offline committed revision');await page.click('.sim-dialog h2');
 await page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('Offline committed revision'));
 await page.waitForFunction(()=>document.querySelector('#editor-save-status')?.innerText.includes('Saved on this device'));
 console.log('SHOTS EDITED');const edited=await read();assert.equal(edited.name,'Offline committed revision');assert.ok(edited.revision>=baseRevision+5);for(let i=0;i<4;i++)assert.ok(Math.abs(edited.shots[initial.clips[i].shotId].snapshot.camera.exposure-(0.51+i*0.1))<0.001);
 console.log('RENAMED');await page.click('button[aria-label="Close dialog"]');await page.close();page=await browser.newPage();page.setDefaultTimeout(180000);await page.setViewport({width:1586,height:992});await page.setOfflineMode(true);page.on('pageerror',e=>errors.push(e.message));await page.goto(`${origin}/student/`,{waitUntil:'domcontentloaded'});await ready();assert.deepEqual(await read(),edited);
 console.log('REOPENED');await page.click('.sim-project-button');await page.locator('button::-p-text(New project)').click();
 await page.waitForFunction(()=>document.querySelectorAll('.st-timeline-clip-select').length===4);await ready();
 const documents=await page.evaluate(dbName=>new Promise((resolve,reject)=>{const r=indexedDB.open(dbName);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('projects'),q=tx.objectStore('projects').getAll();tx.oncomplete=()=>{db.close();resolve(q.result.map(v=>v.document))};tx.onabort=()=>reject(tx.error)}}),projectDbName);
 assert.equal(documents.length,2);assert.ok(documents.some(d=>d.projectId===edited.projectId&&d.name===edited.name));
 for(const path of ['/v1/student/projects','/api/private','/student/diagnostic/','/'])assert.equal(await page.evaluate(async p=>{try{await fetch(p);return false}catch{return true}},path),true,path);
 // Eviction cannot leave a stale readiness claim or damage committed edits.
 const evicted=Object.values(source.assets)[0];
 await page.evaluate(sha=>new Promise((resolve,reject)=>{const r=indexedDB.open('RayzeePublicCatalogueCache-v1');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('records','readwrite');tx.objectStore('records').delete(`asset:${sha}`);tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}}),evicted.sha256);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>document.body.innerText.includes('Offline preparation incomplete'));
 const savedAfterEviction=await page.evaluate(({id,dbName})=>new Promise((resolve,reject)=>{const r=indexedDB.open(dbName);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('projects'),q=tx.objectStore('projects').get(id);tx.oncomplete=()=>{db.close();resolve(q.result.document)};tx.onabort=()=>reject(tx.error)}}),{id:edited.projectId,dbName:projectDbName});assert.deepEqual(savedAfterEviction,edited);
 // Re-preparing with that asset missing and networking blocked must fail truthfully.
 await page.click('button[aria-label="Workspace settings"]');const secondName=await page.$('.sim-dialog-label input');await secondName.focus();await secondName.evaluate(element=>element.select());await secondName.type('Missing media remains editable');await page.click('.sim-dialog h2');
 await page.waitForFunction(()=>document.querySelector('.sim-project-button')?.innerText.includes('Missing media remains editable'));
 await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(n=>n.textContent.includes('Offline preparation incomplete')&&n.title==='DOWNLOAD_FAILED'),{timeout:60000});
 await page.click('button[aria-label="Close dialog"]');
 await page.setOfflineMode(false);
 const failedCache='rayzee-student-shell-failed-proof'; servedWorker=worker.replace(/const CACHE_NAME = "[^\n]+";/,`const CACHE_NAME = ${JSON.stringify(failedCache)};`).replace(/const PRECACHE = \[[^\n]+\];/,`const PRECACHE = ${JSON.stringify([...manifest,'/missing-install-asset.js'])};`);
 const failed=await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker update timed out')),20000);registration.addEventListener('updatefound',()=>{const w=registration.installing;const check=()=>{if(w.state==='redundant'){clearTimeout(timer);resolve(true)}};w.addEventListener('statechange',check);check()},{once:true});registration.update().catch(reject)})});
 assert.equal(failed,true);assert.equal(await page.evaluate(n=>caches.has(n),cacheName),true);assert.equal(await page.evaluate(n=>caches.has(n),failedCache),false);
 console.log(JSON.stringify({browser:await browser.version(),manifest:manifest.length,cacheName,requests,serverErrors,errors,offline:{shots:4,editedRevision:edited.revision,projects:documents.length,eviction:true,failedShellUpdate:true}},null,2));
} finally { await browser?.close(); await new Promise(done=>server.close(done)); await rm( snapshot, { recursive: true, force: true } ); }
