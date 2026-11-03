// Native Chromium account storage and lifecycle checks; no IndexedDB mock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = resolve( fileURLToPath( new URL( '../../../', import.meta.url ) ) );
const server = createServer( async ( request, response ) => {
 try {
  const pathname = new URL( request.url, 'http://localhost' ).pathname;
  if ( pathname === '/' ) { response.writeHead( 200, { 'content-type': 'text/html' } ); response.end( '<!doctype html><title>Account IndexedDB checks</title>' ); return; }
  const path = resolve( root, `.${decodeURIComponent( pathname )}` );
  if ( ! path.startsWith( `${root}${sep}` ) ) throw new Error( 'Invalid path' );
  const contents = await readFile( path ); response.writeHead( 200, { 'content-type': 'text/javascript' } ); response.end( contents );
 } catch { response.writeHead( 404 ); response.end(); }
} );
await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } );
 const page = await browser.newPage();
 await page.goto( origin );
 const checks = await page.evaluate( async () => {
  const { StudentProjectRepository } = await import( '/app/src/previs/persistence/StudentProjectRepository.js' );
  const { createStudentProjectDocument } = await import( '/app/src/previs/domain/StudentProjectSchema.js' );
  const { LocalNarrationStore } = await import( '/app/src/student/editor/LocalNarration.js' );
  const { AccountWorkspace, ValidatedIdentityRegistry } = await import( '/app/src/student/accounts/AccountWorkspace.js' );
  const assert = ( value, message ) => { if ( ! value ) throw new Error( message ); };
  const reports = [];
  const name = `account-tests-${crypto.randomUUID()}`;
  const repo = new StudentProjectRepository( { databaseName: name } );
  const original = createStudentProjectDocument( { projectId: crypto.randomUUID(), name: 'Downloaded' } );
  const remote = { ...original, revision: 7 };
  let result = await repo.adoptRemoteHead( remote, { serverRevision: 4 } );
  assert( result.adopted && ( await repo.get( remote.projectId ) ).revision === 7, 'remote identity/revision changed' );
  assert( ( await repo.pending( remote.projectId ) ).length === 0 && ( await repo.backupState( remote.projectId ) ).serverRevision === 4, 'hydration generated pending work or lost server head' );
  repo.close();
  const reopened = new StudentProjectRepository( { databaseName: name } );
  assert( ( await reopened.get( remote.projectId ) ).revision === 7 && ( await reopened.pending( remote.projectId ) ).length === 0, 'hydration did not survive restart' );
  const stale = await reopened.adoptRemoteHead( { ...remote, name: 'Stale' }, { serverRevision: 3 } );
  assert( stale.reason === 'STALE_REMOTE' && ( await reopened.get( remote.projectId ) ).name === 'Downloaded', 'stale cloud response changed local head' );
  const mismatch = await reopened.adoptRemoteHead( { ...remote, name: 'Impossible same head' }, { serverRevision: 4 } );
  assert( mismatch.reason === 'HEAD_MISMATCH' && ( await reopened.recoveries( remote.projectId ) ).some( x => x.recoveryId === mismatch.recoveryId ), 'same head mismatch not preserved' );
  await reopened.save( { ...remote, revision: 8, name: 'Dirty local' }, { expectedRevision: 7 } );
  const conflict = await reopened.adoptRemoteHead( { ...remote, revision: 9, name: 'Remote change' }, { serverRevision: 5 } );
  assert( conflict.reason === 'DIRTY_LOCAL' && ( await reopened.get( remote.projectId ) ).name === 'Dirty local' && ( await reopened.recoveries( remote.projectId ) ).some( x => x.document.name === 'Remote change' ), 'dirty hydration did not preserve both copies' );
  reports.push( 'Cloud identity and acknowledged baseline survive restart; stale and conflicting heads never overwrite local edits' );
  const untouched = createStudentProjectDocument( { projectId: crypto.randomUUID(), name: 'Abort remote' } );
  const nativePut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function ( ...args ) { const value = nativePut.apply( this, args ); if ( this.name === 'sync' ) this.transaction.abort(); return value; };
  let aborted = false;
  try { await reopened.adoptRemoteHead( untouched, { serverRevision: 0 } ); } catch { aborted = true; } finally { IDBObjectStore.prototype.put = nativePut; }
  assert( aborted && await reopened.get( untouched.projectId ) === null && await reopened.getRevision( untouched.projectId, 0 ) === null && await reopened.backupState( untouched.projectId ) === null, 'aborted adoption partially committed' );
  IDBObjectStore.prototype.put = function ( ...args ) { if ( this.name === 'sync' ) throw new DOMException( 'Quota full', 'QuotaExceededError' ); return nativePut.apply( this, args ); };
  let quota = false;
  try { await reopened.adoptRemoteHead( untouched, { serverRevision: 0 } ); } catch ( error ) { quota = error.code === 'QUOTA_EXCEEDED'; } finally { IDBObjectStore.prototype.put = nativePut; }
  assert( quota && await reopened.get( untouched.projectId ) === null && await reopened.getRevision( untouched.projectId, 0 ) === null, 'quota failure partially committed remote head' );
  reports.push( 'Native abort and quota denial leave no partial hydrated document or cloud baseline' );
  const firstMeta = { requestId: 'rename-1', expectedMetadataRevision: 0, patch: { name: 'Renamed' } };
  const secondMeta = { requestId: 'archive-2', expectedMetadataRevision: 1, patch: { archived: true } };
  await reopened.queueMetadata( remote.projectId, firstMeta ); await reopened.queueMetadata( remote.projectId, secondMeta );
  await reopened.queueMetadata( remote.projectId, firstMeta ); reopened.close();
  const metaRepo = new StudentProjectRepository( { databaseName: name } );
  assert( ( await metaRepo.backupState( remote.projectId ) ).metadataQueue.length === 2, 'metadata queue did not survive restart or replay duplicated it' );
  assert( ! await metaRepo.acknowledgeMetadata( remote.projectId, { requestId: 'archive-2', metadataRevision: 2 } ) && ! await metaRepo.acknowledgeMetadata( remote.projectId, { requestId: 'rename-1', metadataRevision: 2 } ), 'wrong acknowledgement removed metadata' );
  assert( await metaRepo.acknowledgeMetadata( remote.projectId, { requestId: 'rename-1', metadataRevision: 1 } ), 'exact metadata acknowledgement failed' );
  let state = await metaRepo.backupState( remote.projectId );
  assert( state.metadataRevision === 1 && state.metadataQueue.length === 1 && state.metadataQueue[ 0 ].requestId === 'archive-2', 'acknowledgement cleared newer operation' );
  assert( await metaRepo.acknowledgeMetadata( remote.projectId, { requestId: 'archive-2', metadataRevision: 2 } ), 'second metadata acknowledgement failed' );
  metaRepo.close(); reports.push( 'Frozen metadata operations survive restart and require ordered exact acknowledgements' );
  const userA = crypto.randomUUID(), userB = crypto.randomUUID(), credential = crypto.randomUUID();
  const registry = new ValidatedIdentityRegistry( { databaseName: `${name}-identities` } );
  let invalid = false; try { await registry.writeValidated( { userId: userA, credential: 'bad', accessGeneration: 1 } ); } catch { invalid = true; }
  assert( invalid && ( await registry.list() ).length === 0, 'invalid identity was saved' );
  await registry.writeValidated( { userId: userA, credential, accessGeneration: 1 } ); await registry.close();
  const registry2 = new ValidatedIdentityRegistry( { databaseName: `${name}-identities` } );
  assert( ( await registry2.get( userA ) ).credential === credential && ( await registry2.active() ).userId === userA, 'validated identity or active selection did not persist' );
  const life = new AccountWorkspace(), a = await life.switchAccount( userA );
  const aDoc = createStudentProjectDocument( { projectId: crypto.randomUUID(), name: 'A private' } ); await a.repository.save( aDoc, { expectedRevision: null } );
  const bytes = new Blob( [ 'voice-a' ], { type: 'audio/webm' } );
  await a.narration.put( { assetId: 'private-a', projectId: aDoc.projectId, blob: bytes } ); life.select( a, aDoc.projectId );
  let late = false; const callback = life.guard( a, async () => { late = true; life.select( a, 'leak' ); await a.repository.acknowledge( aDoc.projectId, { revision: 0, requestId: `${aDoc.projectId}:0`, dependenciesVerified: true } ); } );
  const b = await life.switchAccount( userB ); await callback();
  assert( a.controller.signal.aborted && ! late && ( await b.repository.list() ).length === 0 && await b.narration.get( 'private-a' ) === undefined && life.selected( b ) === null, 'A data or late callback leaked to B' );
  let staleProjectRejected = false, staleAudioRejected = false;
  try { await a.repository.acknowledge( aDoc.projectId, { revision: 0, requestId: `${aDoc.projectId}:0`, dependenciesVerified: true } ); } catch { staleProjectRejected = true; }
  try { await a.narration.put( { assetId: 'late', projectId: aDoc.projectId, blob: bytes } ); } catch { staleAudioRejected = true; }
  assert( staleProjectRejected && staleAudioRejected, 'direct writes using stale account handles succeeded' );
  const bDoc = createStudentProjectDocument( { projectId: crypto.randomUUID(), name: 'B private' } ); await b.repository.save( bDoc, { expectedRevision: null } ); life.select( b, bDoc.projectId );
  const againA = await life.switchAccount( userA );
  assert( ( await againA.repository.list() ).length === 1 && ( await againA.repository.list() )[ 0 ].projectId === aDoc.projectId && ( await againA.narration.get( 'private-a' ) ).blob.size === bytes.size && life.selected( againA ) === aDoc.projectId && ( await againA.repository.pending( aDoc.projectId ) ).length === 1, 'account selection/project/audio or pending acknowledgement did not remain isolated' );
  reports.push( 'Validated identity survives restart; account switching isolates projects, audio, selection and stale callbacks' );
  const legacy = new StudentProjectRepository( { databaseName: `${name}-legacy` } );
  const legacyAudio = new LocalNarrationStore( { databaseName: `${name}-legacy-audio` } );
  const source = createStudentProjectDocument( { projectId: crypto.randomUUID(), name: 'Legacy' } );
  const blob = new Blob( [ 'legacy voice bytes' ], { type: 'audio/webm' } );
  const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await blob.arrayBuffer() ) ), x => x.toString( 16 ).padStart( 2, '0' ) ).join( '' );
  const assetId = crypto.randomUUID();
  source.narration.assets[ `${assetId}@1` ] = { assetId, version: '1', sha256: hash, byteLength: blob.size, mimeType: 'audio/webm', codec: 'opus', sampleRate: 48000, channels: 1, durationSamples: 48000, segments: [ { index: 0, sha256: hash, byteLength: blob.size } ] };
  await legacy.save( source, { expectedRevision: null } ); await legacyAudio.put( { assetId, projectId: source.projectId, blob } );
  const newProjectId = crypto.randomUUID(); const imported = await life.importLegacy( againA, source.projectId, { legacyRepository: legacy, legacyNarration: legacyAudio, newProjectId } );
  assert( imported.projectId === newProjectId && imported.revision === 0 && ( await againA.narration.get( assetId ) ).blob.size === blob.size && ( await legacy.get( source.projectId ) ).projectId === source.projectId && ( await legacyAudio.get( assetId ) ).blob.size === blob.size, 'legacy import did not copy content or preserve source' );
  const importedB = await life.switchAccount( userB );
  assert( await importedB.repository.get( newProjectId ) === null && await importedB.narration.get( assetId ) === undefined, 'legacy import escaped chosen account' );
  reports.push( 'Explicit legacy import allocates new identity, verifies and copies audio, and preserves source' );
  await life.close(); await registry2.close(); await legacyAudio.close(); legacy.close(); reopened.close();
  return reports;
 } );
 assert.equal( checks.length, 5 );
 console.log( JSON.stringify( { browser: await browser.version(), passed: checks.length, checks }, null, 2 ) );
} finally { await browser?.close(); await new Promise( resolve => server.close( resolve ) ); }
