import {
	Scene, PerspectiveCamera, Mesh, MeshStandardMaterial, MeshBasicMaterial,
	BoxGeometry, CylinderGeometry, PlaneGeometry, Color, CanvasTexture, SRGBColorSpace,
	DirectionalLight, AmbientLight,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { RealtimeRenderer } from '../../../../rayzee/src/managers/RealtimeRenderer.js';
import { SequenceRasterAdapter } from '../../previs/engine/SequenceRasterAdapter.js';
import { drawFramingBars } from '../../previs/engine/FrameFraming.js';
import { createDiagnosticProject } from './createDiagnosticProject.js';
import { DecodedLEDSource } from '../../previs/media/DecodedLEDSource.js';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';

const canvas = ( width, height ) => Object.assign( document.createElement( 'canvas' ), { width, height } );

/** Bounded generated fixture: three seconds of LED video with exact frame labels. */
export async function createTimecodeFixture() {

	const surface = canvas( 320, 180 );
	const context = surface.getContext( '2d' );
	const target = new BufferTarget();
	const output = new Output( { target, format: new Mp4OutputFormat() } );
	const source = new CanvasSource( surface, { codec: 'avc', quality: new Quality( { bitrate: 1e6 } ), keyFrameInterval: 0.2 } );
	output.addVideoTrack( source, { frameRate: 25 } );
	try {

		await output.start();
		for ( let frame = 0; frame < 75; frame ++ ) {

			context.fillStyle = `hsl(${frame * 4.8},70%,35%)`;
			context.fillRect( 0, 0, 320, 180 );
			context.fillStyle = '#ffffff';
			context.font = 'bold 34px monospace';
			context.fillText( `LED ${String( frame ).padStart( 3, '0' )}`, 25, 85 );
			context.font = '24px monospace';
			context.fillText( `${( frame / 25 ).toFixed( 2 )} sec`, 75, 125 );
			await source.add( frame / 25, 1 / 25 );

		}

		source.close();
		await output.finalize();
		return new Blob( [ target.buffer ], { type: 'video/mp4' } );

	} catch ( error ) {

		await output.cancel();
		throw error;

	}

}

export async function createDiagnosticScene( viewport, { postProcessing = true } = {} ) {

	// The production post stack uses SMAA; GTAO samples a single-sample depth texture.
	const renderer = new WebGPURenderer( { canvas: viewport, antialias: false } );
	let scene;
	let realtime;
	let decoded;
	let texture;
	let disposed = false;
	const dispose = () => {

		if ( disposed ) return;
		disposed = true;
		decoded?.dispose();
		realtime?.dispose();
		texture?.dispose();
		scene?.traverse( object => {

			object.geometry?.dispose();
			for ( const material of [].concat( object.material || [] ) ) material.dispose();

		} );
		renderer.dispose();

	};

	try {

		await renderer.init();
		if ( ! renderer.backend.isWebGPUBackend ) {

			throw new Error( 'Diagnostic requires a real WebGPU backend' );

		}

		scene = new Scene();
		scene.background = new Color( '#15202c' );
		const camera = new PerspectiveCamera( 48, 16 / 9, 0.05, 100 );
		camera.position.set( 6, 3.5, 8 );
		camera.lookAt( 0, 1.8, - 0.5 );
		const lights = new Scene();
		const key = new DirectionalLight( '#ffe2c0', 3 );
		key.position.set( 3, 6, 4 );
		lights.add( key );
		scene.add( new AmbientLight( '#d5e5ff', 1.3 ) );
		const settings = new Map( [[ 'enableEnvironment', false ], [ 'showBackground', false ], [ 'backgroundColor', '#15202c' ]] );
		realtime = new RealtimeRenderer( { renderer, scene, lightScene: lights, camera, settings, postProcessing } );
		const addBox = ( width, height, depth, position, color ) => {

			const mesh = new Mesh( new BoxGeometry( width, height, depth ), new MeshStandardMaterial( { color, roughness: 0.55 } ) );
			mesh.position.set( ...position );
			scene.add( mesh );
			return mesh;

		};

		addBox( 16, 0.1, 14, [ 0, - 0.05, 0 ], '#64717c' );
		addBox( 1.8, 0.7, 4.2, [ 0, 0.8, 0 ], '#dc6c39' );
		addBox( 1.55, 0.65, 2.3, [ 0, 1.4, 0 ], '#243e50' );
		const door = addBox( 0.1, 0.65, 1.2, [ 0.95, 1.2, 0.7 ], '#ffa466' );
		for ( const x of [ - 0.95, 0.95 ] ) for ( const z of [ - 1.35, 1.35 ] ) {

			const wheel = new Mesh( new CylinderGeometry( 0.4, 0.4, 0.25, 20 ), new MeshStandardMaterial( { color: '#101419' } ) );
			wheel.rotation.z = Math.PI / 2;
			wheel.position.set( x, 0.4, z );
			scene.add( wheel );

		}

		// Distinguishable standing/sitting proxies; production rig/asset acceptance is separate.
		addBox( 0.4, 1.5, 0.3, [ - 2, 0.75, 0 ], '#55bdd4' );
		addBox( 0.4, 0.7, 0.5, [ 2, 0.65, 0 ], '#c49ce3' );
		const ledCanvas = canvas( 320, 180 );
		const ledContext = ledCanvas.getContext( '2d' );
		texture = new CanvasTexture( ledCanvas );
		texture.colorSpace = SRGBColorSpace;
		const wall = new Mesh( new PlaneGeometry( 10, 5.625 ), new MeshBasicMaterial( { map: texture } ) );
		wall.position.set( 0, 3, - 4 );
		scene.add( wall );
		const videoBlob = await createTimecodeFixture();
		decoded = await DecodedLEDSource.open( videoBlob );
		const document = await createDiagnosticProject( camera, wall, videoBlob );
		const capture = canvas( 1920, 1080 );
		capture.className = 'raster-capture';
		viewport.after( capture );
		const context = capture.getContext( '2d' );
		let currentShot = null;
		let saved = null;
		let lastLED = null;
		let framingRatio = '4:3';
		let restoredFraming = framingRatio;
		let shotApplications = 0;
		const framingEvidence = new Map();
		let rawPixels = null;
		// Fixture-owned scene port. Real catalogue/rig integration uses the
		// separate transactional ShotSceneAdapter/ThreeShotPorts contracts.
		const sceneAdapter = {
			async captureState() {

				saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), aspect: camera.aspect, doorAngle: door.rotation.y, ledTime: lastLED?.timestamp ?? 1, framingRatio, size: { width: viewport.width, height: viewport.height } };
				return saved;

			},
			async applyShot( frozen, shotId ) {

				const authored = frozen.shots[ shotId ].snapshot.camera;
				camera.position.fromArray( authored.transform.position );
				camera.quaternion.fromArray( authored.transform.quaternion );
				camera.aspect = authored.projection.aspect;
				camera.updateProjectionMatrix();
				door.rotation.y = shotId === 'freeze' ? 0 : Math.PI / 3;
				framingRatio = authored.frameOverlayRatio;
				currentShot = shotId;
				shotApplications ++;

			},
			async restoreState( state ) {

				camera.position.copy( state.position );
				camera.quaternion.copy( state.quaternion );
				camera.aspect = state.aspect;
				camera.updateProjectionMatrix();
				door.rotation.y = state.doorAngle;
				await decoded.drawAt( state.ledTime + 0.001, ledContext );
				texture.needsUpdate = true;
				renderer.setSize( state.size.width, state.size.height, false );
				framingRatio = restoredFraming = state.framingRatio;

			},
		};
		const sequence = new SequenceRasterAdapter( {
			document, sceneAdapter, canvas: capture,
			prepare: () => {

				framingEvidence.clear();
				return realtime.precompile();

			},
			async renderMedia( evaluation, { signal } ) {

				const sourceTime = evaluation.led[ 0 ].sourceTimeSeconds;
				lastLED = await decoded.drawAt( sourceTime + 0.01, ledContext, { signal } );
				texture.needsUpdate = true;

			},
			render( evaluation ) {

				realtime.render( { width: 1920, height: 1080 } );
				// Copy before presentation; shared bridge composites framing next.
				context.drawImage( viewport, 0, 0, 1920, 1080 );
				context.fillStyle = '#07101ddd';
				context.fillRect( 0, 0, 1920, 65 );
				context.fillStyle = '#ffffff';
				context.font = '28px monospace';
				const sourceFrame = Math.round( evaluation.led[ 0 ].sourceTimeSeconds * 25 );
				context.fillText( `FRAME ${String( evaluation.frame ).padStart( 5, '0' )} | ${currentShot.toUpperCase()} | LED ${sourceFrame} | 1920x1080 / 25 fps`, 30, 43 );
				rawPixels = null;
				if ( [ 0, 24, 124, 125, 126, 249 ].includes( evaluation.frame ) ) {

					const barPoint = framingRatio === '4:3' ? [ 60, 540 ] : [ 960, 100 ];
					rawPixels = [ barPoint, [ 960, 540 ]].map( ( [ x, y ], index ) => ( { x, y, bar: index === 0, before: Array.from( context.getImageData( x, y, 1, 1 ).data ) } ) );

				}

			},
			async restore() {

				realtime.render();
				context.drawImage( viewport, 0, 0, 1920, 1080 );
				drawFramingBars( context, restoredFraming );
				saved = null;
				currentShot = null;

			},
		} );
		const adapter = {
			canvas: capture,
			prepare: options => sequence.prepare( options ),
			async renderFrame( frame, options ) {

				const evaluation = await sequence.renderFrame( frame, options );
				if ( rawPixels ) framingEvidence.set( frame, { frame, ratio: framingRatio, samples: rawPixels.map( sample => ( { ...sample, after: Array.from( context.getImageData( sample.x, sample.y, 1, 1 ).data ) } ) ) } );
				return { shot: evaluation.shot.shotId, framing: framingEvidence.get( frame ), sourceFrame: Math.round( evaluation.led[ 0 ].sourceTimeSeconds * 25 ), decodedTimestamp: lastLED.timestamp, framingRatio, shotApplications };

			},
			restore: () => sequence.restore(),
			dispose,
			get state() {

				return { restored: saved === null, currentShot, lastLED, postProcessing, backend: renderer.backend.constructor.name, shotApplications, framingRatio, sequenceFrames: sequence.evaluator.totalFrames, framingEvidence: [ ...framingEvidence.values() ] };

			},
		};
		await adapter.prepare();
		await adapter.renderFrame( 0 );
		await adapter.restore();
		return adapter;

	} catch ( error ) {

		dispose();
		throw error;

	}

}
