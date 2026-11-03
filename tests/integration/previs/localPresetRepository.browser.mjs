// Native Chromium IndexedDB and BroadcastChannel, with no GPU dependency.
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
		if ( pathname === '/' ) {

			response.writeHead( 200, { 'content-type': 'text/html' } );
			response.end( '<!doctype html><title>Local preset persistence regression</title>' );
			return;

		}
		const path = resolve( root, `.${decodeURIComponent( pathname )}` );
		if ( ! path.startsWith( `${root}${sep}` ) ) throw new Error( 'Invalid path' );
		const source = await readFile( path );
		response.writeHead( 200, { 'content-type': 'text/javascript' } );
		response.end( source );

	} catch {

		response.writeHead( 404 );
		response.end();

	}

} );
await new Promise( resolve => server.listen( 0, '127.0.0.1', resolve ) );
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const reports = [];
try {

	browser = await puppeteer.launch( { executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true } );
	const databaseName = `LocalPreset-test-${Date.now()}`;
	async function setup( page ) {

		await page.goto( origin );
		await page.evaluate( async databaseName => {

			const { LocalPresetRepository } = await import( '/app/src/services/presets/LocalPresetRepository.js' );
			const { createProjectDocument } = await import( '/app/src/services/projects/ProjectSchema.js' );
			const { studentFixture } = await import( '/tests/unit/previs/studentFixtures.js' );
			const document = studentFixture();
			globalThis.repo = new LocalPresetRepository( { databaseName } );
			globalThis.value = {
				presetId: 'wide', name: 'Wide', adminDocument: createProjectDocument(),
				thumbnail: new Blob( [ 'fixture image bytes' ], { type: 'image/png' } ),
				studentPreset: {
					format: 'rayzee-student-preset', schemaVersion: 1, presetId: 'wide', version: '1', name: 'Wide',
					description: '', category: 'Studio', defaultDurationFrames: 125, thumbnail: null,
					assets: document.assets, baseScene: document.baseScenes[ 'studio@1' ], snapshot: document.shots.shotA.snapshot,
				},
			};
			globalThis.changes = [];
			globalThis.repo.subscribe( event => globalThis.changes.push( event ) );

		}, databaseName );

	}
	const page = await browser.newPage();
	await setup( page );
	assert.equal( await page.evaluate( async () => {

		const saved = await globalThis.repo.save( globalThis.value, { expectedRevision: null } );
		const asset = await globalThis.repo.getAssetRecord( saved.studentPreset.thumbnail );
		return saved.revision === 0 && saved.studentPreset.version === '1' && asset.blob.size === 19 && asset.asset.sha256.length === 64 && globalThis.changes.length === 1;

	} ), true );
	reports.push( 'Initial scene, portable preset, immutable revision and thumbnail bytes commit together' );
	await page.reload();
	await setup( page );
	assert.equal( await page.evaluate( async () => {

		const saved = await globalThis.repo.get( 'wide' );
		saved.studentPreset.snapshot.camera.exposure = 99;
		return ( await globalThis.repo.list() ).length === 1 && ( await globalThis.repo.get( 'wide' ) ).studentPreset.snapshot.camera.exposure === 1;

	} ), true );
	reports.push( 'Reload preserves committed presets; reads are detached from the durable revision' );
	const second = await browser.newPage();
	await setup( second );
	assert.equal( await page.evaluate( async () => {

		const renamed = await globalThis.repo.rename( 'wide', 'Cabin close-up', { expectedRevision: 0 } );
		return renamed.revision === 1 && renamed.studentPreset.name === 'Cabin close-up' && renamed.studentPreset.version === '2' && ( await globalThis.repo.get( 'wide', { revision: 0 } ) ).name === 'Wide';

	} ), true );
	await second.waitForFunction( () => globalThis.changes.length === 1 );
	assert.equal( await second.evaluate( async () => ( await globalThis.repo.get( globalThis.changes[ 0 ].presetId ) ).name ), 'Cabin close-up' );
	reports.push( 'Rename creates an immutable successor and notifies another tab to read its new name' );
	const race = target => target.evaluate( async () => {

		const current = await globalThis.repo.get( 'wide' );
		try { await globalThis.repo.save( { ...current, name: crypto.randomUUID() }, { expectedRevision: 1 } ); return 'saved'; } catch ( error ) { return error.code; }

	} );
	assert.deepEqual( ( await Promise.all( [ race( page ), race( second ) ] ) ).sort(), [ 'REVISION_CONFLICT', 'saved' ] );
	reports.push( 'Concurrent tabs accept exactly one successor and reject stale writers' );
	assert.equal( await page.evaluate( async () => {

		const current = await globalThis.repo.get( 'wide' );
		const nativeAdd = IDBObjectStore.prototype.add;
		IDBObjectStore.prototype.add = function ( ...args ) {

			if ( this.name === 'revisions' ) throw new DOMException( 'Injected quota failure', 'QuotaExceededError' );
			return nativeAdd.apply( this, args );

		};
		let rejected = false;
		try { await globalThis.repo.save( { ...current, name: 'Must roll back' }, { expectedRevision: 2 } ); } catch { rejected = true; } finally { IDBObjectStore.prototype.add = nativeAdd; }
		return rejected && ( await globalThis.repo.get( 'wide' ) ).revision === 2 && await globalThis.repo.get( 'wide', { revision: 3 } ) === null;

	} ), true );
	reports.push( 'Quota exceptions abort latest record, immutable revision and asset writes atomically' );
	assert.equal( await page.evaluate( async () => {

		const current = await globalThis.repo.get( 'wide' );
		const thumbnailKey = `${current.studentPreset.thumbnail.assetId}@${current.studentPreset.thumbnail.version}`;
		current.studentPreset.assets[ thumbnailKey ].sha256 = 'f'.repeat( 64 );
		current.thumbnail = null;
		let rejected = false;
		try { await globalThis.repo.save( current, { expectedRevision: 2 } ); } catch ( error ) { rejected = error.message.includes( 'immutable preset asset' ); }
		return rejected && ( await globalThis.repo.get( 'wide' ) ).revision === 2;

	} ), true );
	reports.push( 'Pinned asset identity cannot be reused with different metadata, even without new bytes' );
	assert.equal( await page.evaluate( async () => {

		const source = structuredClone( globalThis.value );
		source.presetId = 'history';
		source.studentPreset.schemaVersion = 2;
		source.studentPreset.baseScene = { ...source.studentPreset.baseScene, sceneId: 'history-scene' };
		source.studentPreset.snapshot.nodes.carInstance.doorAngles = {};
		source.studentPreset.snapshot.ledWalls = [];
		source.studentPreset.snapshot.rasterAppearance = {
			version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb', enableEnvironment: true, showBackground: true,
			transparentBackground: false, backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#000000',
		};
		source.studentPreset.sceneDefinition = {
			format: 'rayzee-student-scene', schemaVersion: 1, baseScene: structuredClone( source.studentPreset.baseScene ), humanPoseRoots: [],
			models: [ { asset: { assetId: 'car', version: '1' }, nodes: [ { instanceId: 'carInstance', nodeId: 'root', gltfNodeIndex: null, expectedName: null } ] } ],
		};
		const original = await globalThis.repo.save( source, { expectedRevision: null } );
		const replacement = structuredClone( original );
		replacement.studentPreset.baseScene.version = '2';
		replacement.studentPreset.sceneDefinition.baseScene.version = '2';
		await globalThis.repo.save( replacement, { expectedRevision: 0 } );
		const retained = await globalThis.repo.getScene( { sceneId: 'history-scene', version: '1' } );
		if ( ! retained || Object.keys( retained.assets ).join() !== 'car@1' || retained.sceneDefinition.baseScene.version !== '1' ) return false;
		const conflicting = structuredClone( original );
		conflicting.presetId = 'conflicting-scene';
		conflicting.studentPreset.sceneDefinition.models[ 0 ].nodes.push( { instanceId: 'carMesh', nodeId: 'mesh', gltfNodeIndex: 0, expectedName: 'Car' } );
		conflicting.studentPreset.snapshot.nodes.carMesh = { ...structuredClone( conflicting.studentPreset.snapshot.nodes.carInstance ), nodeId: 'mesh' };
		await globalThis.repo.save( conflicting, { expectedRevision: null } );
		try { await globalThis.repo.getScene( { sceneId: 'history-scene', version: '1' } ); return false; } catch ( error ) { return error.message.includes( 'conflicting definitions' ); }

	} ), true );
	reports.push( 'Superseded immutable scene inventories remain readable; conflicting reuse is rejected' );
	assert.equal( await page.evaluate( async () => {

		const original = await globalThis.repo.get( 'wide' );
		let conflict = false;
		try { await globalThis.repo.remove( 'wide', { expectedRevision: 0 } ); } catch ( error ) { conflict = error.code === 'REVISION_CONFLICT'; }
		if ( ! conflict || ! await globalThis.repo.get( 'wide' ) ) return false;
		await globalThis.repo.remove( 'wide', { expectedRevision: original.revision } );
		return await globalThis.repo.get( 'wide' ) === null && await globalThis.repo.isDeleted( 'wide' ) &&
			! ( await globalThis.repo.list() ).some( row => row.presetId === 'wide' ) &&
			( await globalThis.repo.get( 'wide', { revision: original.revision } ) ).name === original.name &&
			!! await globalThis.repo.getAssetRecord( original.studentPreset.thumbnail );

	} ), true );
	await second.waitForFunction( () => globalThis.changes.some( event => event.presetId === 'wide' && event.revision === 3 ) );
	await page.reload(); await setup( page );
	assert.equal( await page.evaluate( async () => await globalThis.repo.isDeleted( 'wide' ) && await globalThis.repo.get( 'wide' ) === null ), true );
	reports.push( 'Revision-guarded removal broadcasts across tabs, survives reload and retains old student shot assets' );
	await second.close();
	console.log( JSON.stringify( { ok: true, checks: reports }, null, 2 ) );

} finally {

	await browser?.close();
	await new Promise( resolve => server.close( resolve ) );

}
