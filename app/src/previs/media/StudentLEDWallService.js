import { CanvasTexture, ClampToEdgeWrapping, FrontSide, LinearFilter, Matrix3, SRGBColorSpace, Vector3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { createLEDBlurNode, DEFAULT_LED_BLUR, validateLEDBlur } from './LEDBlur.js';
import { assetVersionKey } from '../domain/StudentProjectSchema.js';
import { serializeStudentCatalogueContent } from '../domain/StudentCatalogueSchema.js';

const clone = value => structuredClone( value );
const fail = message => {

	throw new Error( `Student LED: ${message}` );

};

const fields = ( value, expected ) => value && Object.getPrototypeOf( value ) === Object.prototype && Object.keys( value ).length === expected.length && expected.every( key => Object.hasOwn( value, key ) );
const vector = ( value, count ) => Array.isArray( value ) && value.length === count && value.every( Number.isFinite );
const defaultCanvas = ( width, height ) => {

	const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas( width, height ) : globalThis.document.createElement( 'canvas' );
	canvas.width = width;
	canvas.height = height;
	return canvas;

};

/** Same composite sampling matrix as admin LEDVideoManager, without importing
 * its store/app globals. Placement is already baked into the composite pixels.
 * Authored top-left UV channel/bounds/mirroring are the remaining transform.
 */
export function createStudentLEDTextureMatrix( surface ) {

	const [ minU, maxU, minV, maxV ] = surface.uvBounds;
	const du = maxU - minU;
	const dv = maxV - minV;
	return new Matrix3().set( surface.flipU ? - 1 / du : 1 / du, 0, surface.flipU ? maxU / du : - minU / du, 0, 1 / dv, - minV / dv, 0, 0, 1 );

}

/** A viewport-owned deterministic LED media port. Caller owns verified source
 * decoders and must dispose them after awaiting this service's dispose().
 */
export function createStudentLEDWallService( {
	nodeObjects, mediaSources, canvasFactory = defaultCanvas,
	materialFactory = parameters => new MeshStandardNodeMaterial( parameters ),
} ) {

	if ( ! ( nodeObjects instanceof Map ) || ! ( mediaSources instanceof Map ) || typeof canvasFactory !== 'function' || typeof materialFactory !== 'function' ) fail( 'stable node/source Maps and resource factories are required' );
	const nodes = new Map( nodeObjects );
	const sources = new Map( mediaSources );
	const dimensions = new WeakMap();
	const tokens = new WeakMap();
	const originals = new Map();
	const blurPreviews = new Map();
	let records = [];
	let tail = Promise.resolve();
	let closing = false;
	let disposed = false;
	const enqueue = operation => {

		if ( closing || disposed ) return Promise.reject( new Error( 'Student LED: service is disposed' ) );
		const next = tail.catch( () => {} ).then( operation );
		tail = next;
		return next;

	};

	function validate( walls ) {

		if ( closing || disposed ) fail( 'service is disposed' );
		if ( ! Array.isArray( walls ) ) fail( 'complete wall configuration must be an array' );
		const wallIds = new Set();
		const meshes = new Set();
		for ( const wall of walls ) {

			if ( ! fields( wall, [ 'wallId', 'presentationVersion', 'nodeInstanceId', 'media', 'mode', 'inPointUs', 'loop', 'playbackRate', 'brightnessNits', 'placement', 'surface', ...( Object.hasOwn( wall, 'blur' ) ? [ 'blur' ] : [] ) ] ) || wall.presentationVersion !== 1 ) fail( 'only complete presentationVersion 1 walls are supported; legacy units cannot be reinterpreted' );
			if ( Object.hasOwn( wall, 'blur' ) ) validateLEDBlur( wall.blur );
			if ( typeof wall.wallId !== 'string' || ! wall.wallId || wallIds.has( wall.wallId ) ) fail( 'wall IDs must be unique' );
			wallIds.add( wall.wallId );
			const mesh = nodes.get( wall.nodeInstanceId );
			if ( ! mesh?.isMesh || ! mesh.geometry || meshes.has( mesh ) ) fail( 'every wall must resolve to a unique ready display mesh' );
			meshes.add( mesh );
			const { surface, placement } = wall;
			if ( ! fields( surface, [ 'nativeCanvas', 'uvChannel', 'uvBounds', 'flipU' ] ) || ! vector( surface.nativeCanvas, 2 ) || ! surface.nativeCanvas.every( value => Number.isSafeInteger( value ) && value > 0 ) || ! Number.isInteger( surface.uvChannel ) || surface.uvChannel < 0 || surface.uvChannel > 3 || ! vector( surface.uvBounds, 4 ) || surface.uvBounds[ 1 ] <= surface.uvBounds[ 0 ] || surface.uvBounds[ 3 ] <= surface.uvBounds[ 2 ] || typeof surface.flipU !== 'boolean' ) fail( 'complete positive native canvas and UV presentation are required' );
			if ( ! mesh.geometry.getAttribute( surface.uvChannel ? `uv${surface.uvChannel}` : 'uv' ) ) fail( 'the authored display UV channel is unavailable' );
			if ( ! fields( placement, [ 'position', 'scale', 'rotationDegrees', 'aspectRatioLocked', 'fitMode' ] ) || ! vector( placement.position, 2 ) || ! vector( placement.scale, 2 ) || placement.scale.some( value => value < 1e-4 ) || ! Number.isFinite( placement.rotationDegrees ) || typeof placement.aspectRatioLocked !== 'boolean' || ! [ 'contain', 'cover', 'stretch' ].includes( placement.fitMode ) ) fail( 'complete finite baked placement is required' );
			if ( ! Number.isFinite( wall.brightnessNits ) || wall.brightnessNits < 0 || ! [ 'freeze', 'play' ].includes( wall.mode ) || ! Number.isSafeInteger( wall.inPointUs ) || wall.inPointUs < 0 || typeof wall.loop !== 'boolean' || ! Number.isFinite( wall.playbackRate ) || wall.playbackRate <= 0 || wall.playbackRate > 16 ) fail( 'invalid brightness or playback state' );
			if ( wall.media === null ) {

				if ( wall.mode !== 'freeze' || wall.inPointUs !== 0 ) fail( 'blank walls must freeze at zero' );

			} else {

				if ( ! fields( wall.media, [ 'assetId', 'version' ] ) || typeof wall.media.assetId !== 'string' || typeof wall.media.version !== 'string' ) fail( 'an exact immutable media reference is required' );
				const source = sources.get( assetVersionKey( wall.media ) );
				if ( typeof source?.drawAt !== 'function' || typeof source.input?.getPrimaryVideoTrack !== 'function' || ! Number.isFinite( source.duration ) || wall.inPointUs / 1000000 >= source.duration ) fail( 'an already verified and opened decoder is required for each media version' );

			}

		}

		return true;

	}

	async function sourceDimensions( source ) {

		if ( ! dimensions.has( source ) ) dimensions.set( source, Promise.resolve( source.input.getPrimaryVideoTrack() ).then( track => {

			if ( ! track || ! Number.isFinite( track.displayWidth ) || ! Number.isFinite( track.displayHeight ) || track.displayWidth <= 0 || track.displayHeight <= 0 ) fail( 'decoded video display dimensions are unavailable' );
			return { width: track.displayWidth, height: track.displayHeight };

		} ) );
		return dimensions.get( source );

	}

	function canvas( width, height ) {

		const result = canvasFactory( width, height );
		result.width = width;
		result.height = height;
		const context = result.getContext( '2d', { alpha: false } );
		if ( ! context ) fail( 'a Canvas2D surface is required' );
		return { canvas: result, context };

	}

	function release( record ) {

		record.texture?.dispose();
		record.material?.dispose();
		for ( const item of [ record.sourceCanvas, record.stagingCanvas, record.displayCanvas ] ) if ( item ) {

			item.canvas.width = 0; item.canvas.height = 0;

		}

	}

	async function prepare( wall ) {

		const record = { wall: clone( wall ), mesh: nodes.get( wall.nodeInstanceId ), lastTime: null, sourceFrame: { key: null, time: null } };
		try {

			const source = wall.media ? sources.get( assetVersionKey( wall.media ) ) : null;
			const size = source ? await sourceDimensions( source ) : { width: 1024, height: 1024 };
			const longest = Math.min( 2048, Math.max( size.width, size.height, 1024 ) );
			const aspect = wall.surface.nativeCanvas[ 0 ] / wall.surface.nativeCanvas[ 1 ];
			const width = aspect >= 1 ? Math.round( longest ) : Math.max( 1, Math.round( longest * aspect ) );
			const height = aspect >= 1 ? Math.max( 1, Math.round( longest / aspect ) ) : Math.round( longest );
			record.displayCanvas = canvas( width, height );
			record.stagingCanvas = canvas( width, height );
			const scale = Math.min( 1, 2048 / Math.max( size.width, size.height ) );
			record.sourceCanvas = canvas( Math.max( 1, Math.round( size.width * scale ) ), Math.max( 1, Math.round( size.height * scale ) ) );
			record.texture = new CanvasTexture( record.displayCanvas.canvas );
			Object.assign( record.texture, { colorSpace: SRGBColorSpace, flipY: false, channel: wall.surface.uvChannel, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false, wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping, matrixAutoUpdate: false } );
			record.texture.matrix.copy( createStudentLEDTextureMatrix( wall.surface ) );
			record.material = materialFactory( { name: 'Student LED Display Surface', color: 0x000000, emissive: wall.media ? 0xffffff : 0x000000, emissiveIntensity: wall.media ? wall.brightnessNits / 100 : 0, metalness: 0, roughness: 0.72, side: FrontSide } );
			if ( ! record.material?.isMaterial ) fail( 'material factory must create an owned Three.js material' );
			record.blur = createLEDBlurNode( record.texture );
			record.material.emissiveNode = record.blur.node;
			record.material.toneMapped = true;
			record.material.emissiveMap = record.texture;
			return record;

		} catch ( error ) {

			release( record );
			throw error;

		}

	}

	async function stage( record, time, signal ) {

		signal?.throwIfAborted();
		if ( record.wall.media ) {

			const source = sources.get( assetVersionKey( record.wall.media ) );
			if ( ! Number.isFinite( time ) || time < 0 || time >= source.duration ) fail( 'evaluation requests a time outside its verified video' );
			const key = assetVersionKey( record.wall.media );
			let decoded = true;
			if ( record.sourceFrame.key !== key || record.sourceFrame.time !== time ) {

				record.sourceFrame.key = null; record.sourceFrame.time = null;
				decoded = await source.drawAt( time, record.sourceCanvas.context, { signal } );
				signal?.throwIfAborted();
				if ( decoded !== false ) {

					record.sourceFrame.key = key; record.sourceFrame.time = time;

				}

			}

			if ( decoded === false ) fail( 'decoded frame was superseded' );
			signal?.throwIfAborted();

		}

		const { canvas: target, context } = record.stagingCanvas;
		context.fillStyle = '#000000';
		context.fillRect( 0, 0, target.width, target.height );
		if ( record.wall.media ) {

			const { position, scale, rotationDegrees } = record.wall.placement;
			context.save();
			try {

				context.translate( position[ 0 ] * target.width, position[ 1 ] * target.height );
				context.rotate( rotationDegrees * Math.PI / 180 );
				context.drawImage( record.sourceCanvas.canvas, - scale[ 0 ] * target.width / 2, - scale[ 1 ] * target.height / 2, scale[ 0 ] * target.width, scale[ 1 ] * target.height );

			} finally {

				context.restore();

			}

		}

		return time;

	}

	function commit( record, time ) {

		record.blur.set( blurPreviews.get( record.wall.wallId ) || record.wall.blur || DEFAULT_LED_BLUR );
		record.material.emissive.set( record.wall.media ? 0xffffff : 0x000000 );
		record.material.emissiveIntensity = record.wall.media ? record.wall.brightnessNits / 100 : 0;
		record.texture.matrix.copy( createStudentLEDTextureMatrix( record.wall.surface ) );
		record.displayCanvas.context.drawImage( record.stagingCanvas.canvas, 0, 0 );
		record.texture.needsUpdate = true;
		record.lastTime = time;

	}

	async function replace( walls, times = null ) {

		validate( walls );
		if ( walls.length === records.length && walls.every( ( wall, index ) => wall.wallId === records[ index ].wall.wallId && wall.nodeInstanceId === records[ index ].wall.nodeInstanceId && wall.surface.uvChannel === records[ index ].wall.surface.uvChannel && serializeStudentCatalogueContent( wall.surface.nativeCanvas ) === serializeStudentCatalogueContent( records[ index ].wall.surface.nativeCanvas ) ) ) {

			// Video, brightness, placement and timing are state on one display.
			// Stage every wall first; retain the live material, texture and canvases.
			const next = records.map( ( record, index ) => ( { ...record, wall: clone( walls[ index ] ) } ) );
			const timesToCommit = [];
			for ( const record of next ) {

				const time = record.wall.media ? times?.get( record.wall.wallId ) ?? record.wall.inPointUs / 1000000 : null;
				timesToCommit.push( await stage( record, time ) );

			}

			next.forEach( ( record, index ) => commit( record, timesToCommit[ index ] ) );
			records = next;
			return;

		}

		const next = [];
		try {

			for ( const wall of walls ) {

				const record = await prepare( wall );
				next.push( record );
				const time = wall.media ? times?.get( wall.wallId ) ?? wall.inPointUs / 1000000 : null;
				await stage( record, time );
				commit( record, time );

			}

		} catch ( error ) {

			next.forEach( release );
			throw error;

		}

		for ( const record of records ) record.mesh.material = originals.get( record.mesh );
		for ( const record of next ) {

			if ( ! originals.has( record.mesh ) ) originals.set( record.mesh, record.mesh.material );
			record.mesh.material = record.material;

		}

		records.forEach( release );
		records = next;

	}

	return {
		validate,
		previewBlur( wallId, value ) {

			if ( closing || disposed ) fail( 'service is disposed' );
			if ( value !== null ) validateLEDBlur( value );
			if ( value === null ) blurPreviews.delete( wallId );
			else blurPreviews.set( wallId, clone( value ) );
			for ( const record of records ) if ( record.wall.wallId === wallId ) record.blur.set( value || record.wall.blur || DEFAULT_LED_BLUR );

		},
		registerSource: ( key, source ) => enqueue( () => {

			if ( sources.has( key ) && sources.get( key ) !== source ) fail( 'an immutable decoder cannot be replaced' );
			sources.set( key, source );

		} ),
		inspect: () => enqueue( () => records.map( record => {

			const pixel = item => Array.from( item.context.getImageData( Math.floor( item.canvas.width / 2 ), Math.floor( item.canvas.height / 2 ), 1, 1 ).data );
			const attribute = record.mesh.geometry.getAttribute( record.wall.surface.uvChannel ? `uv${record.wall.surface.uvChannel}` : 'uv' );
			const bounds = [ Infinity, - Infinity, Infinity, - Infinity ];
			for ( let index = 0; index < attribute.count; index ++ ) {

				const u = attribute.getX( index ), v = attribute.getY( index );
				bounds[ 0 ] = Math.min( bounds[ 0 ], u ); bounds[ 1 ] = Math.max( bounds[ 1 ], u ); bounds[ 2 ] = Math.min( bounds[ 2 ], v ); bounds[ 3 ] = Math.max( bounds[ 3 ], v );

			}

			record.mesh.updateWorldMatrix( true, false );
			return {
				wallId: record.wall.wallId, sourceTimeSeconds: record.lastTime,
				source: { width: record.sourceCanvas.canvas.width, height: record.sourceCanvas.canvas.height, centerRGBA: pixel( record.sourceCanvas ) },
				display: { width: record.displayCanvas.canvas.width, height: record.displayCanvas.canvas.height, centerRGBA: pixel( record.displayCanvas ) },
				texture: { channel: record.texture.channel, flipY: record.texture.flipY, matrix: record.texture.matrix.toArray(), version: record.texture.version },
				mesh: { name: record.mesh.name, visible: record.mesh.visible, position: record.mesh.getWorldPosition( new Vector3() ).toArray(), uvBounds: bounds, firstWorldNormal: record.mesh.geometry.getAttribute( 'normal' ) ? new Vector3().fromBufferAttribute( record.mesh.geometry.getAttribute( 'normal' ), 0 ).transformDirection( record.mesh.matrixWorld ).toArray() : null },
				material: { emissive: record.material.emissive.toArray(), emissiveIntensity: record.material.emissiveIntensity, side: record.material.side, toneMapped: record.material.toneMapped, attached: record.mesh.material === record.material },
			};

		} ) ),
		read: () => enqueue( () => clone( records.map( record => record.wall ) ) ),
		capture: () => enqueue( () => {

			const token = Object.freeze( {} );
			tokens.set( token, { walls: clone( records.map( record => record.wall ) ), times: new Map( records.map( record => [ record.wall.wallId, record.lastTime ] ) ) } );
			return token;

		} ),
		apply: ( walls, _binding, { times } = {} ) => {

			const snapshot = clone( walls ), requestedTimes = times ? new Map( times ) : null;
			return enqueue( () => replace( snapshot, requestedTimes ) );

		},
		restore: token => enqueue( () => {

			const saved = tokens.get( token );
			if ( ! saved ) fail( 'restore requires a capture token from this viewport' );
			return replace( saved.walls, saved.times );

		} ),
		renderEvaluation: ( evaluation, { signal } = {} ) => enqueue( async () => {

			signal?.throwIfAborted();
			if ( evaluation?.ended || ! Array.isArray( evaluation?.led ) ) fail( 'a renderable sequence evaluation is required' );
			const active = new Map();
			for ( const entry of evaluation.led ) {

				if ( active.has( entry.wallId ) ) fail( 'duplicate evaluated wall' );
				active.set( entry.wallId, entry );

			}

			const times = [];
			for ( const record of records ) {

				const entry = active.get( record.wall.wallId );
				if ( record.wall.media && ( ! entry || assetVersionKey( entry.media ) !== assetVersionKey( record.wall.media ) ) ) fail( 'evaluation and current shot media inventories differ' );
				if ( ! record.wall.media && entry ) fail( 'blank wall cannot have evaluated media' );
				if ( entry ) active.delete( record.wall.wallId );
				times.push( await stage( record, entry?.sourceTimeSeconds ?? null, signal ) );

			}

			if ( active.size ) fail( 'evaluation contains an unmapped wall' );
			signal?.throwIfAborted();
			records.forEach( ( record, index ) => commit( record, times[ index ] ) );

		} ),
		dispose: async () => {

			if ( disposed ) return;
			closing = true;
			await tail.catch( () => {} );
			for ( const [ mesh, material ] of originals ) mesh.material = material;
			records.forEach( release );
			records = [];
			originals.clear();
			disposed = true;

		},
	};

}
