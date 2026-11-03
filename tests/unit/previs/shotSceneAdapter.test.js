import { describe, expect, it, vi } from 'vitest';
import { ShotSceneAdapter } from '../../../app/src/previs/engine/ShotSceneAdapter.js';
import { studentFixture } from './studentFixtures.js';

function viewport( document = studentFixture() ) {

	const shot = document.shots.shotA;
	const state = {
		scene: Object.fromEntries( Object.entries( shot.snapshot.nodes ).map( ( [ id, node ] ) => [ id, structuredClone( node.transform ) ] ) ),
		pose: Object.fromEntries( Object.entries( shot.snapshot.nodes ).map( ( [ id, node ] ) => [ id, structuredClone( { humanPose: node.humanPose, doorAngles: node.doorAngles } ) ] ) ),
		camera: structuredClone( shot.snapshot.camera ), lights: structuredClone( shot.snapshot.lights ),
		environment: structuredClone( shot.snapshot.environment ), media: structuredClone( shot.snapshot.ledWalls ),
		runtime: { renderMode: 'raster', playing: false, helpers: true },
	};
	let binding = {
		ready: true, baseScene: { ...shot.baseScene }, assets: Object.values( document.assets ),
		nodes: Object.entries( shot.snapshot.nodes ).map( ( [ instanceId, node ] ) => ( { instanceId, asset: { ...node.asset }, nodeId: node.nodeId } ) ),
		lights: shot.snapshot.lights.map( ( { lightId, type } ) => ( { lightId, type } ) ), ledWalls: shot.snapshot.ledWalls.map( ( { wallId } ) => ( { wallId } ) ),
	};
	const ports = {};
	for ( const name of Object.keys( state ) ) {

		ports[ name ] = {
			read: vi.fn( async () => structuredClone( state[ name ] ) ),
			capture: vi.fn( async () => structuredClone( state[ name ] ) ),
			apply: vi.fn( async value => {

				if ( name === 'scene' ) state.scene = Object.fromEntries( Object.entries( value ).map( ( [ id, node ] ) => [ id, structuredClone( node.transform ) ] ) );
				else if ( name === 'pose' ) state.pose = Object.fromEntries( Object.entries( value ).map( ( [ id, node ] ) => [ id, structuredClone( { humanPose: node.humanPose, doorAngles: node.doorAngles } ) ] ) );
				else state[ name ] = structuredClone( value );

			} ),
			restore: vi.fn( async value => state[ name ] = structuredClone( value ) ),
		};

	}

	ports.scene.getBindings = () => binding;
	return { document, state, binding, ports, adapter: new ShotSceneAdapter( ports ), reload: () => binding = { ...binding } };

}

describe( 'ShotSceneAdapter transaction and identity boundary', () => {

	it( 'applies and captures a mapped blank LED without a missing video dependency', async () => {

		const document = studentFixture();
		delete document.shots.shotB;
		delete document.assets[ 'video@1' ];
		document.clips = [ document.clips[ 0 ] ];
		document.shots.shotA.snapshot.ledWalls = [ { wallId: 'wall', presentationVersion: 1, nodeInstanceId: 'carInstance', media: null, mode: 'freeze', inPointUs: 0, loop: true, playbackRate: 1, brightnessNits: 10000, placement: { position: [ 0.5, 0.5 ], scale: [ 1, 1 ], rotationDegrees: 0, aspectRatioLocked: true, fitMode: 'stretch' }, surface: { nativeCanvas: [ 1, 1 ], uvChannel: 1, uvBounds: [ 0, 1, 0, 1 ], flipU: false } } ];
		const view = viewport( document );
		await view.adapter.applyShot( document, 'shotA' );
		expect( ( await view.adapter.captureShot( document, 'shotA' ) ).snapshot.ledWalls ).toEqual( document.shots.shotA.snapshot.ledWalls );

	} );

	it( 'round trips A → B → A through every independent injected subsystem', async () => {

		const view = viewport();
		const b = view.document.shots.shotB.snapshot;
		b.camera.transform.position = [ 2, 3, 4 ];
		b.camera.projection = { type: 'orthographic', near: 0.2, far: 200, zoom: 2, clipStart: 0.3, left: - 2, right: 2, top: 1, bottom: - 1 };
		b.camera.lens = { ...b.camera.lens, sensorWidth: 24, sensorHeight: 18, dofMode: 'look', autoFocusMode: 'auto', focusDistance: 8, aperture: 8, focalLength: 35, afSmoothingFactor: 0.8, unitsPerMetre: 2, enableDOF: false, apertureScale: 2, anamorphicRatio: 1.5, dofBlur: 0.2, afScreenPoint: [ 0.3, 0.7 ] };
		b.camera.exposure = 1.5;
		b.camera.frameOverlayRatio = '2.40:1';
		b.camera.renderProjection = { type: 'equirectangular', panoramaLonRange: [ - 90, 90 ], panoramaLatRange: [ - 45, 45 ], panoramaLevelHorizon: false };
		b.nodes.carInstance.transform = { position: [ 4, 5, 6 ], quaternion: [ 0, 0, 1, 0 ], scale: [ 2, 3, 4 ], visible: false };
		b.nodes.carInstance.humanPose = 'sitting';
		b.nodes.carInstance.doorAngles.leftFront = 1;
		b.lights[ 0 ] = { ...b.lights[ 0 ], intensity: 9, color: [ 0.3, 0.4, 0.5 ], target: [ 2, 1, 3 ], transform: structuredClone( b.nodes.carInstance.transform ), emission: { temperature: 3200, useTemperature: true, exposure: 1.5 }, parameters: { distance: 20, decay: 1.5, radius: 0.3, angle: 0.3, penumbra: 0.8 } };
		b.environment = { asset: null, intensity: 2, rotation: [ 0, 1, 0 ], background: false };
		b.ledWalls[ 0 ] = { ...b.ledWalls[ 0 ], inPointUs: 1000, brightness: 2, loop: false, playbackRate: 2, transform: structuredClone( b.nodes.carInstance.transform ) };
		const original = structuredClone( view.document );
		const a = await view.adapter.captureShot( view.document, 'shotA' );
		await view.adapter.applyShot( view.document, 'shotB' );
		expect( ( await view.adapter.captureShot( view.document, 'shotB' ) ).snapshot ).toEqual( b );
		await view.adapter.applyShot( view.document, 'shotA' );
		expect( await view.adapter.captureShot( view.document, 'shotA' ) ).toEqual( a );
		expect( view.document ).toEqual( original );

	} );
	it( 'restores renderer/transport state with the captured shot after export', async () => {

		const view = viewport();
		const before = structuredClone( view.state );
		const token = await view.adapter.captureState( view.document, 'shotA' );
		await view.adapter.applyShot( view.document, 'shotB' );
		view.state.runtime = { renderMode: 'export', playing: true, helpers: false };
		await view.adapter.restoreState( token );
		expect( view.state ).toEqual( before );
		expect( Object.keys( token ) ).toEqual( [] );
		await expect( view.adapter.restoreState( {} ) ).rejects.toThrow( /unknown/ );

	} );
	it.each( [
		[ 'base version', view => view.binding.baseScene.version = '2', /base scene/ ],
		[ 'not ready', view => view.binding.ready = false, /not ready/ ],
		[ 'asset version', view => view.binding.nodes[ 0 ].asset.version = '2', /versioned mapping/ ],
		[ 'node identity', view => view.binding.nodes[ 0 ].nodeId = 'unrelated-child', /versioned mapping/ ],
		[ 'missing node', view => view.binding.nodes = [], /node inventory/ ],
		[ 'extra node', view => view.binding.nodes.push( { ...view.binding.nodes[ 0 ], instanceId: 'unexpected' } ), /node inventory/ ],
		[ 'duplicate node', view => view.binding.nodes.push( view.binding.nodes[ 0 ] ), /duplicate/ ],
		[ 'light type', view => view.binding.lights[ 0 ].type = 'point', /different type/ ],
		[ 'missing wall', view => view.binding.ledWalls = [], /LED wall inventory/ ],
		[ 'missing media bytes', view => view.binding.assets.pop(), /video@1 is not ready/ ],
		[ 'unsupported raster appearance capability', view => view.document.shots.shotA.snapshot.rasterAppearance = { version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb', enableEnvironment: true, showBackground: true, transparentBackground: false, backgroundIntensity: 1, backgroundBlurriness: 0, backgroundColor: '#000000' }, /appearance and viewport capability do not match/ ],
	] )( 'rejects %s before capture or mutation', async ( _, edit, message ) => {

		const view = viewport();
		edit( view );
		await expect( view.adapter.applyShot( view.document, 'shotA' ) ).rejects.toThrow( message );
		for ( const port of Object.values( view.ports ) ) {

			expect( port.capture ).not.toHaveBeenCalled();
			expect( port.apply ).not.toHaveBeenCalled();

		}

	} );
	it( 'rolls back all subsystems after a port mutates then throws', async () => {

		const view = viewport();
		const before = structuredClone( view.state );
		view.ports.media.apply.mockImplementationOnce( async () => {

			view.state.media = [];
			throw new Error( 'media decode failed' );

		} );
		await expect( view.adapter.applyShot( view.document, 'shotB' ) ).rejects.toThrow( /media decode failed/ );
		expect( view.state ).toEqual( before );
		for ( const port of Object.values( view.ports ) ) expect( port.restore ).toHaveBeenCalledOnce();
		await view.adapter.applyShot( view.document, 'shotA' );

	} );
	it( 'attempts remaining restores and reports both errors when rollback fails', async () => {

		const view = viewport();
		view.ports.media.apply.mockRejectedValueOnce( new Error( 'apply failed' ) );
		view.ports.media.restore.mockRejectedValueOnce( new Error( 'restore failed' ) );
		await expect( view.adapter.applyShot( view.document, 'shotB' ) ).rejects.toThrow( /application and rollback failed/ );
		expect( view.ports.scene.restore ).toHaveBeenCalledOnce();
		expect( view.ports.camera.restore ).toHaveBeenCalledOnce();

	} );
	it( 'does not mutate when capturing a subsystem fails', async () => {

		const view = viewport();
		view.ports.camera.capture.mockRejectedValueOnce( new Error( 'capture failed' ) );
		await expect( view.adapter.applyShot( view.document, 'shotB' ) ).rejects.toThrow( /capture failed/ );
		for ( const port of Object.values( view.ports ) ) expect( port.apply ).not.toHaveBeenCalled();

	} );
	it( 'rejects missing or nonportable fields from a capture port', async () => {

		const view = viewport();
		view.ports.scene.read.mockResolvedValueOnce( {} );
		await expect( view.adapter.captureShot( view.document, 'shotA' ) ).rejects.toThrow( /captured node inventory/ );
		view.ports.camera.read.mockResolvedValueOnce( { ...view.state.camera, privateToken: 'private' } );
		await expect( view.adapter.captureShot( view.document, 'shotA' ) ).rejects.toThrow( /unsupported field/ );

	} );
	it( 'refuses stale handles after scene reload', async () => {

		const view = viewport();
		const token = await view.adapter.captureState( view.document, 'shotA' );
		view.reload();
		await expect( view.adapter.restoreState( token ) ).rejects.toThrow( /stale handles/ );
		expect( view.ports.scene.restore ).not.toHaveBeenCalled();

	} );
	it( 'aborts before applying when a scene reload occurs during asynchronous capture', async () => {

		const view = viewport();
		view.ports.camera.capture.mockImplementationOnce( async () => {

			view.reload();
			return structuredClone( view.state.camera );

		} );
		await expect( view.adapter.applyShot( view.document, 'shotA' ) ).rejects.toThrow( /stale handles/ );
		for ( const port of Object.values( view.ports ) ) expect( port.apply ).not.toHaveBeenCalled();

	} );
	it( 'rejects overlapping writes and releases the guard after completion', async () => {

		const view = viewport();
		let release;
		view.ports.scene.capture.mockImplementationOnce( () => new Promise( resolve => release = () => resolve( structuredClone( view.state.scene ) ) ) );
		const pending = view.adapter.applyShot( view.document, 'shotA' );
		await expect( view.adapter.applyShot( view.document, 'shotB' ) ).rejects.toThrow( /in progress/ );
		release();
		await pending;
		await view.adapter.applyShot( view.document, 'shotB' );

	} );

} );

it( 'retains unchanged resource state at cuts and still applies positional state transactionally', async () => {

	const view = viewport();
	await view.adapter.applyShot( view.document, 'shotA', { changedResourcesOnly: true } );
	expect( view.ports.environment.apply ).not.toHaveBeenCalled();
	expect( view.ports.camera.apply ).toHaveBeenCalledOnce();
	expect( view.ports.media.apply ).toHaveBeenCalledOnce();
	view.document.shots.shotB.snapshot.environment.intensity = 2;
	view.ports.media.apply.mockRejectedValueOnce( new Error( 'cut decode failed' ) );
	await expect( view.adapter.applyShot( view.document, 'shotB', { changedResourcesOnly: true } ) ).rejects.toThrow( 'cut decode failed' );
	expect( view.state.environment.intensity ).toBe( 1 );
	await view.adapter.applyShot( view.document, 'shotB', { changedResourcesOnly: true } );
	expect( view.state.environment.intensity ).toBe( 2 );

} );
