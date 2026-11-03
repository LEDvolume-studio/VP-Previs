import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from 'three';
import { createStudentLEDTextureMatrix, createStudentLEDWallService } from '../../../app/src/previs/media/StudentLEDWallService.js';

const wall = ( overrides = {} ) => ( {
	wallId: 'wall', presentationVersion: 1, nodeInstanceId: 'display', media: { assetId: 'video', version: '1' },
	mode: 'play', inPointUs: 200000, loop: false, playbackRate: 1, brightnessNits: 350,
	placement: { position: [ 0.25, 0.75 ], scale: [ 0.5, 0.25 ], rotationDegrees: 90, aspectRatioLocked: true, fitMode: 'contain' },
	surface: { nativeCanvas: [ 6000, 2000 ], uvChannel: 1, uvBounds: [ 0.2, 0.8, 0.1, 0.9 ], flipU: true },
	...overrides,
} );
const evaluation = time => ( { ended: false, led: [ { wallId: 'wall', media: { assetId: 'video', version: '1' }, sourceTimeSeconds: time } ] } );

it( 'stages the timeline cut frame directly and avoids decoding the saved calibration frame first', async () => {

	const { service, source } = fixture();
	await service.apply( [ wall() ], null, { times: new Map( [[ 'wall', 1.24 ]] ) } );
	await service.renderEvaluation( evaluation( 1.24 ) );
	expect( source.drawAt ).toHaveBeenCalledOnce();
	expect( source.drawAt.mock.calls[ 0 ][ 0 ] ).toBe( 1.24 );
	await service.dispose();

} );

function fixture( { displayCount = 1 } = {} ) {

	const canvases = [];
	const canvasFactory = ( width, height ) => {

		const canvas = { width, height, frame: null, operations: [] };
		const context = {
			canvas,
			getImageData: () => ( { data: new Uint8ClampedArray( canvas.frame === 'black' ? [ 0, 0, 0, 255 ] : [ 31, 151, 32, 255 ] ) } ),
			fillRect: ( ...args ) => {

				canvas.frame = 'black'; canvas.operations.push( [ 'fill', ...args ] );

			},
			save: () => canvas.operations.push( [ 'save' ] ), restore: () => canvas.operations.push( [ 'restore' ] ),
			translate: ( ...args ) => canvas.operations.push( [ 'translate', ...args ] ),
			rotate: ( ...args ) => canvas.operations.push( [ 'rotate', ...args ] ),
			drawImage: ( image, ...args ) => {

				canvas.frame = image.frame; canvas.operations.push( [ 'draw', ...args ] );

			},
		};
		canvas.getContext = () => context;
		canvases.push( canvas );
		return canvas;

	};

	const source = {
		duration: 3,
		input: { getPrimaryVideoTrack: vi.fn( async () => ( { displayWidth: 3840, displayHeight: 2160 } ) ) },
		drawAt: vi.fn( async ( time, context ) => {

			context.canvas.frame = time; return { timestamp: time, duration: 0.04 };

		} ),
		dispose: vi.fn(),
	};
	const geometry = new PlaneGeometry( 1, 1 );
	geometry.setAttribute( 'uv1', new BufferAttribute( new Float32Array( [ 0.2, 0.1, 0.8, 0.1, 0.2, 0.9, 0.8, 0.9 ] ), 2 ) );
	const original = new MeshBasicMaterial();
	const mesh = new Mesh( geometry, original );
	const meshes = Array.from( { length: displayCount }, ( _, index ) => index ? new Mesh( geometry, original ) : mesh );
	const service = createStudentLEDWallService( { nodeObjects: new Map( meshes.map( ( value, index ) => [ index ? `display-${index + 1}` : 'display', value ] ) ), mediaSources: new Map( [[ 'video@1', source ]] ), canvasFactory } );
	return { service, source, mesh, meshes, original, geometry, canvases };

}

describe( 'student deterministic LED wall presentation', () => {

	it( 'keeps blur previews transient and reuses GPU resources across saved blur edits', async () => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		const material = view.mesh.material, texture = material.emissiveMap, node = material.emissiveNode;
		view.service.previewBlur( 'wall', { method: 'lens', amount: 20 } );
		expect( ( await view.service.read() )[ 0 ].blur ).toBeUndefined();
		await view.service.apply( [ wall( { blur: { method: 'gaussian', amount: 12 } } ) ] );
		view.service.previewBlur( 'wall', null );
		expect( ( await view.service.read() )[ 0 ].blur ).toEqual( { method: 'gaussian', amount: 12 } );
		expect( view.mesh.material ).toBe( material );
		expect( material.emissiveMap ).toBe( texture );
		expect( material.emissiveNode ).toBe( node );
		await view.service.renderEvaluation( evaluation( 0.8 ) );
		expect( material.emissiveNode ).toBe( node );
		expect( () => view.service.validate( [ wall( { blur: { method: 'lens', amount: 41 } } ) ] ) ).toThrow( /blur/ );
		await view.service.dispose();

	} );

	it( 'uses real WebGPU node emissive material, nits units and authored UV mapping without changing geometry', async () => {

		const view = fixture();
		const originalUV = Array.from( view.geometry.getAttribute( 'uv1' ).array );
		await view.service.apply( [ wall() ] );
		expect( view.mesh.geometry ).toBe( view.geometry );
		expect( Array.from( view.geometry.getAttribute( 'uv1' ).array ) ).toEqual( originalUV );
		expect( view.mesh.material.isMeshStandardNodeMaterial ).toBe( true );
		expect( view.mesh.material.emissiveNode ).toBeTruthy();
		expect( view.mesh.material.emissiveIntensity ).toBe( 3.5 );
		expect( view.mesh.material.emissive.getHex() ).toBe( 0xffffff );
		expect( view.mesh.material.color.getHex() ).toBe( 0 );
		expect( view.mesh.material.toneMapped ).toBe( true );
		const texture = view.mesh.material.emissiveMap;
		expect( texture.flipY ).toBe( false );
		expect( texture.channel ).toBe( 1 );
		expect( texture.colorSpace ).toBe( 'srgb' );
		expect( texture.generateMipmaps ).toBe( false );
		expect( texture.matrixAutoUpdate ).toBe( false );
		expect( new Vector2( 0.2, 0.1 ).applyMatrix3( texture.matrix ).toArray() ).toEqual( [ 1, 0 ] );
		expect( new Vector2( 0.8, 0.9 ).applyMatrix3( texture.matrix ).x ).toBeCloseTo( 0 );
		expect( new Vector2( 0.8, 0.9 ).applyMatrix3( texture.matrix ).y ).toBeCloseTo( 1 );
		expect( texture.image.width ).toBe( 2048 );
		expect( texture.image.height ).toBe( 683 );
		expect( texture.image.frame ).toBe( 0.2 );
		await view.service.dispose();
		expect( view.mesh.material ).toBe( view.original );
		expect( view.source.dispose ).not.toHaveBeenCalled();

	} );

	it( 'composes exact stored contain-fit scale, position and clockwise rotation once', async () => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		const composite = view.canvases[ 1 ];
		expect( composite.operations ).toEqual( [
			[ 'fill', 0, 0, 2048, 683 ], [ 'save' ], [ 'translate', 512, 512.25 ],
			[ 'rotate', Math.PI / 2 ], [ 'draw', - 512, - 85.375, 1024, 170.75 ], [ 'restore' ],
		] );
		await view.service.dispose();

	} );

	it( 'awaits every decoded sample before committing and keeps material/texture stable across frame seeks', async () => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		const material = view.mesh.material;
		const texture = material.emissiveMap;
		let finish;
		view.source.drawAt.mockImplementationOnce( ( time, context ) => new Promise( resolve => {

			finish = () => {

				context.canvas.frame = time; resolve( { timestamp: time } );

			};

		} ) );
		const rendering = view.service.renderEvaluation( evaluation( 1.12 ) );
		await vi.waitFor( () => expect( finish ).toBeTypeOf( 'function' ) );
		expect( texture.image.frame ).toBe( 0.2 );
		finish();
		await rendering;
		expect( texture.image.frame ).toBe( 1.12 );
		expect( view.mesh.material ).toBe( material );
		expect( material.emissiveMap ).toBe( texture );
		expect( view.source.input.getPrimaryVideoTrack ).toHaveBeenCalledTimes( 1 );
		await view.service.dispose();

	} );

	it( 'restores the actual captured displayed frame instead of resetting its in point', async () => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		await view.service.renderEvaluation( evaluation( 1.4 ) );
		const saved = await view.service.capture();
		await view.service.apply( [ wall( { brightnessNits: 100 } ) ] );
		await view.service.renderEvaluation( evaluation( 2.4 ) );
		await view.service.restore( saved );
		expect( view.mesh.material.emissiveIntensity ).toBe( 3.5 );
		expect( view.mesh.material.emissiveMap.image.frame ).toBe( 1.4 );
		expect( view.source.drawAt.mock.calls.at( - 1 )[ 0 ] ).toBe( 1.4 );
		await expect( view.service.restore( {} ) ).rejects.toThrow( 'capture token' );
		await view.service.dispose();

	} );

	it( 'reuses identical wall resources while apply still decodes its configured in point', async () => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		const material = view.mesh.material, texture = material.emissiveMap;
		const materialDispose = vi.spyOn( material, 'dispose' );
		const textureDispose = vi.spyOn( texture, 'dispose' );
		await view.service.renderEvaluation( evaluation( 1.2 ) );
		// Object field insertion order is not a change to the saved configuration.
		const identical = Object.fromEntries( Object.entries( wall() ).reverse() );
		await view.service.apply( [ identical ] );
		expect( view.mesh.material ).toBe( material );
		expect( material.emissiveMap ).toBe( texture );
		expect( texture.image.frame ).toBe( 0.2 );
		expect( view.source.drawAt.mock.calls.map( call => call[ 0 ] ) ).toEqual( [ 0.2, 1.2, 0.2 ] );
		expect( view.canvases ).toHaveLength( 3 );
		expect( materialDispose ).not.toHaveBeenCalled();
		expect( textureDispose ).not.toHaveBeenCalled();
		await view.service.dispose();
		expect( materialDispose ).toHaveBeenCalledTimes( 1 );
		expect( textureDispose ).toHaveBeenCalledTimes( 1 );

	} );

	it( 'restores an identical wall at its captured decoded time with stable material and texture identities', async () => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		const material = view.mesh.material, texture = material.emissiveMap;
		await view.service.renderEvaluation( evaluation( 1.4 ) );
		const saved = await view.service.capture();
		await view.service.renderEvaluation( evaluation( 2.4 ) );
		await view.service.restore( saved );
		expect( view.mesh.material ).toBe( material );
		expect( material.emissiveMap ).toBe( texture );
		expect( texture.image.frame ).toBe( 1.4 );
		expect( view.source.drawAt.mock.calls.at( - 1 )[ 0 ] ).toBe( 1.4 );
		expect( view.canvases ).toHaveLength( 3 );
		await view.service.dispose();

	} );

	it.each( [ 'apply', 'restore' ] )( 'preserves the successful display and resources when identical %s decoding fails, then retries', async operation => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		const material = view.mesh.material, texture = material.emissiveMap;
		await view.service.renderEvaluation( evaluation( 1.4 ) );
		const saved = await view.service.capture();
		await view.service.renderEvaluation( evaluation( 2.4 ) );
		const attempt = () => operation === 'apply' ? view.service.apply( [ wall() ] ) : view.service.restore( saved );
		view.source.drawAt.mockRejectedValueOnce( new Error( 'same wall decode failed' ) );
		await expect( attempt() ).rejects.toThrow( 'same wall decode failed' );
		expect( view.mesh.material ).toBe( material );
		expect( texture.image.frame ).toBe( 2.4 );
		expect( ( await view.service.inspect() )[ 0 ].sourceTimeSeconds ).toBe( 2.4 );
		await attempt();
		expect( texture.image.frame ).toBe( operation === 'apply' ? 0.2 : 1.4 );
		expect( view.canvases ).toHaveLength( 3 );
		await view.service.dispose();

	} );

	it( 'stages all identical walls before committing any when a later display decode fails', async () => {

		const view = fixture( { displayCount: 2 } );
		const walls = [ wall(), wall( { wallId: 'second', nodeInstanceId: 'display-2' } ) ];
		await view.service.apply( walls );
		const materials = view.meshes.map( mesh => mesh.material );
		await view.service.renderEvaluation( { ended: false, led: [ ...evaluation( 1.4 ).led, { ...evaluation( 1.4 ).led[ 0 ], wallId: 'second' } ] } );
		view.source.drawAt.mockImplementationOnce( async ( time, context ) => {

			context.canvas.frame = time; return {};

		} );
		view.source.drawAt.mockRejectedValueOnce( new Error( 'second display unavailable' ) );
		await expect( view.service.apply( walls ) ).rejects.toThrow( 'second display unavailable' );
		expect( view.meshes.map( mesh => mesh.material ) ).toEqual( materials );
		expect( materials.map( material => material.emissiveMap.image.frame ) ).toEqual( [ 1.4, 1.4 ] );
		expect( ( await view.service.inspect() ).map( report => report.sourceTimeSeconds ) ).toEqual( [ 1.4, 1.4 ] );
		await view.service.apply( walls );
		expect( materials.map( material => material.emissiveMap.image.frame ) ).toEqual( [ 0.2, 0.2 ] );
		expect( view.canvases ).toHaveLength( 6 );
		await view.service.dispose();

	} );

	it( 'keeps blank walls black without requesting or including library audio', async () => {

		const view = fixture();
		const blank = wall( { media: null, mode: 'freeze', inPointUs: 0 } );
		await view.service.apply( [ blank ] );
		await view.service.renderEvaluation( { ended: false, led: [] } );
		expect( view.mesh.material.emissiveIntensity ).toBe( 0 );
		expect( view.mesh.material.emissiveMap.image.frame ).toBe( 'black' );
		expect( view.source.drawAt ).not.toHaveBeenCalled();
		expect( view.source.input.getPrimaryVideoTrack ).not.toHaveBeenCalled();
		await view.service.dispose();

	} );

	it.each( [
		[ 'legacy presentation', value => {

			delete value.presentationVersion;

		} ],
		[ 'unmapped node', value => {

			value.nodeInstanceId = 'missing';

		} ],
		[ 'unverified media', value => {

			value.media.version = '2';

		} ],
		[ 'missing UV channel', value => {

			value.surface.uvChannel = 3;

		} ],
		[ 'inverted UV bounds', value => {

			value.surface.uvBounds = [ 1, 0, 0, 1 ];

		} ],
		[ 'negative nits', value => {

			value.brightnessNits = - 1;

		} ],
		[ 'unknown placement', value => {

			value.placement.custom = true;

		} ],
		[ 'outside source', value => {

			value.inPointUs = 3000000;

		} ],
	] )( 'rejects %s before changing any scene resource', async ( _name, mutate ) => {

		const view = fixture();
		const value = wall();
		mutate( value );
		expect( () => view.service.validate( [ value ] ) ).toThrow( 'Student LED' );
		await expect( view.service.apply( [ value ] ) ).rejects.toThrow( 'Student LED' );
		expect( view.mesh.material ).toBe( view.original );
		expect( view.canvases ).toHaveLength( 0 );
		await view.service.dispose();

	} );

	it( 'retains displayed frame after decoder failure or cancelled sample and recovers on retry', async () => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		const texture = view.mesh.material.emissiveMap;
		view.source.drawAt.mockRejectedValueOnce( new Error( 'decode failed' ) );
		await expect( view.service.renderEvaluation( evaluation( 1 ) ) ).rejects.toThrow( 'decode failed' );
		expect( texture.image.frame ).toBe( 0.2 );
		const controller = new AbortController();
		view.source.drawAt.mockImplementationOnce( async ( time, context ) => {

			context.canvas.frame = time; controller.abort(); return {};

		} );
		await expect( view.service.renderEvaluation( evaluation( 1.5 ), { signal: controller.signal } ) ).rejects.toThrow();
		expect( texture.image.frame ).toBe( 0.2 );
		await view.service.renderEvaluation( evaluation( 2 ) );
		expect( texture.image.frame ).toBe( 2 );
		await view.service.dispose();

	} );

	it( 'cleans new resources on failed shot application while preserving the previous shot', async () => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		const previous = view.mesh.material;
		view.source.drawAt.mockRejectedValueOnce( new Error( 'unavailable frame' ) );
		await expect( view.service.apply( [ wall( { brightnessNits: 700, surface: { ...wall().surface, nativeCanvas: [ 3000, 2000 ] } } ) ] ) ).rejects.toThrow( 'unavailable frame' );
		expect( view.mesh.material ).toBe( previous );
		expect( view.canvases.slice( 3 ).every( canvas => canvas.width === 0 && canvas.height === 0 ) ).toBe( true );
		await view.service.dispose();

	} );

	it( 'waits for pending decode before disposing and restores original materials without disposing them', async () => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		const originalDispose = vi.spyOn( view.original, 'dispose' );
		const ownedDispose = vi.spyOn( view.mesh.material, 'dispose' );
		const textureDispose = vi.spyOn( view.mesh.material.emissiveMap, 'dispose' );
		let finish;
		view.source.drawAt.mockImplementationOnce( () => new Promise( resolve => {

			finish = () => resolve( {} );

		} ) );
		const render = view.service.renderEvaluation( evaluation( 2 ) );
		await vi.waitFor( () => expect( finish ).toBeTypeOf( 'function' ) );
		const disposing = view.service.dispose();
		expect( ownedDispose ).not.toHaveBeenCalled();
		finish();
		await render;
		await disposing;
		expect( view.mesh.material ).toBe( view.original );
		expect( ownedDispose ).toHaveBeenCalledTimes( 1 );
		expect( textureDispose ).toHaveBeenCalledTimes( 1 );
		expect( originalDispose ).not.toHaveBeenCalled();
		expect( view.source.dispose ).not.toHaveBeenCalled();
		expect( view.canvases.every( canvas => canvas.width === 0 && canvas.height === 0 ) ).toBe( true );
		await expect( view.service.read() ).rejects.toThrow( 'disposed' );
		await view.service.dispose();

	} );

	it( 'normalizes an unmirrored authored UV island by matrix without baking any geometry', () => {

		const matrix = createStudentLEDTextureMatrix( { uvBounds: [ - 2, 2, 5, 7 ], flipU: false } );
		expect( new Vector2( - 2, 5 ).applyMatrix3( matrix ).toArray() ).toEqual( [ 0, 0 ] );
		expect( new Vector2( 2, 7 ).applyMatrix3( matrix ).toArray() ).toEqual( [ 1, 1 ] );

	} );

	it( 'reports detached read-only presentation diagnostics without exposing scene or canvas handles', async () => {

		const view = fixture();
		await view.service.apply( [ wall() ] );
		const before = await view.service.read();
		const [ report ] = await view.service.inspect();
		expect( report.sourceTimeSeconds ).toBe( 0.2 );
		expect( report.source.centerRGBA ).toEqual( [ 31, 151, 32, 255 ] );
		expect( report.display.centerRGBA ).toEqual( [ 31, 151, 32, 255 ] );
		expect( report.material ).toMatchObject( { emissiveIntensity: 3.5, attached: true, side: 0, toneMapped: true } );
		expect( report.mesh.firstWorldNormal ).toEqual( [ 0, 0, 1 ] );
		expect( JSON.stringify( report ) ).not.toMatch( /uuid|canvas|isMaterial/ );
		report.texture.matrix[ 0 ] = 999;
		expect( ( await view.service.inspect() )[ 0 ].texture.matrix[ 0 ] ).not.toBe( 999 );
		expect( await view.service.read() ).toEqual( before );
		await view.service.dispose();

	} );

} );

it( 'switches videos, placement and brightness on the same GPU material/texture and reuses the decoded in point', async () => {

	const view = fixture(); await view.service.apply( [ wall() ] );
	const material = view.mesh.material, texture = material.emissiveMap;
	const second = { ...view.source, drawAt: vi.fn( async ( time, context ) => {

		context.canvas.frame = time; return { timestamp: time };

	} ) };
	await view.service.registerSource( 'second@1', second );
	const next = wall( { media: { assetId: 'second', version: '1' }, inPointUs: 400000, brightnessNits: 700 } );
	await view.service.apply( [ next ] );
	await view.service.renderEvaluation( { ended: false, led: [ { wallId: 'wall', media: next.media, sourceTimeSeconds: 0.4 } ] } );
	expect( view.mesh.material ).toBe( material ); expect( material.emissiveMap ).toBe( texture );
	expect( material.emissiveIntensity ).toBe( 7 ); expect( view.canvases ).toHaveLength( 3 );
	expect( second.drawAt ).toHaveBeenCalledOnce();
	await view.service.dispose();

} );
