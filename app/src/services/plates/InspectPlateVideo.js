import { BlobSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { MAX_PLATE_FILE_BYTES, MAX_PLATE_FRAMES, PLATE_FPS, PLATE_HEIGHTS, PLATE_WIDTH, plateError } from './PlateSet.js';

const tolerance = 0.00005;
const bytesOf = value => value instanceof ArrayBuffer ? new Uint8Array( value ) : new Uint8Array( value.buffer, value.byteOffset, value.byteLength );

/** Read root box headers only. The video payload is never materialised in memory. */
export async function inspectPlateContainer( blob, { signal } = {} ) {

	let offset = 0, moov = false, mdat = false, ftyp = false, boxes = 0;
	while ( offset < blob.size ) {

		signal?.throwIfAborted();
		if ( ++ boxes > 256 || blob.size - offset < 8 ) plateError( 'Malformed MP4 box layout.' );
		const bytes = new Uint8Array( await blob.slice( offset, offset + 16 ).arrayBuffer() );
		const header = new DataView( bytes.buffer );
		let size = header.getUint32( 0 );
		const type = String.fromCharCode( ...bytes.subarray( 4, 8 ) );
		let headerSize = 8;
		if ( size === 1 ) {

			if ( bytes.length < 16 ) plateError( 'Truncated MP4 box.' );
			size = Number( header.getBigUint64( 8 ) ); headerSize = 16;

		} else if ( size === 0 ) size = blob.size - offset;
		if ( ! Number.isSafeInteger( size ) || size < headerSize || offset + size > blob.size ) plateError( 'Malformed MP4 box size.' );
		if ( offset === 0 && type !== 'ftyp' ) plateError( 'Use an MP4 file with a valid ftyp header.' );
		if ( type === 'ftyp' ) ftyp = true;
		if ( type === 'moof' ) plateError( 'Use a complete, non-fragmented MP4 file.' );
		if ( type === 'moov' ) {

			if ( mdat || moov ) plateError( 'Export a fast-start MP4 with metadata before video data.' );
			moov = true;

		}

		if ( type === 'mdat' ) mdat = true;
		offset += size;

	}

	if ( ! ftyp || ! moov || ! mdat ) plateError( 'MP4 metadata or video data is missing.' );

}

function inspectAVC( bytes ) {

	if ( bytes.length < 9 || bytes[ 0 ] !== 1 || ! [ 66, 77, 100 ].includes( bytes[ 1 ] ) || ! ( bytes[ 5 ] & 31 ) ) plateError( 'Use 8-bit H.264 Baseline, Main or High profile.' );
	if ( bytes[ 1 ] !== 100 ) return;
	const size = ( bytes[ 6 ] << 8 ) | bytes[ 7 ];
	if ( size < 4 || 8 + size > bytes.length ) plateError( 'Invalid H.264 sequence header.' );
	const sps = [];
	for ( let i = 9; i < 8 + size; i ++ ) {

		if ( i >= 11 && bytes[ i ] === 3 && bytes[ i - 1 ] === 0 && bytes[ i - 2 ] === 0 ) continue;
		sps.push( bytes[ i ] );

	}

	let bit = 24;
	const read = () => {

		if ( bit >= sps.length * 8 ) plateError( 'Truncated H.264 sequence header.' );
		return ( sps[ bit >> 3 ] >> ( 7 - ( bit ++ & 7 ) ) ) & 1;

	};

	const ue = () => {

		let zeros = 0;
		while ( ! read() ) if ( ++ zeros > 24 ) plateError( 'Invalid H.264 sequence header.' );
		let result = 1;
		for ( let i = 0; i < zeros; i ++ ) result = result * 2 + read();
		return result - 1;

	};

	ue(); // seq_parameter_set_id
	if ( ue() !== 1 || ue() !== 0 || ue() !== 0 ) plateError( 'Use 8-bit 4:2:0 H.264 video.' );

}

export function inspectPlateCodec( configuration, encoding ) {

	if ( ! configuration?.description ) plateError( 'MP4 decoder configuration is missing.' );
	const bytes = bytesOf( configuration.description );
	if ( encoding === 'h264' ) {

		if ( ! /^avc1\./i.test( configuration.codec ) ) plateError( 'The H.264 slot requires an avc1 MP4.' );
		inspectAVC( bytes );

	} else if ( encoding === 'hevc' ) {

		if ( ! /^(hvc1|hev1)\./i.test( configuration.codec ) || bytes.length < 23 || bytes[ 0 ] !== 1 || ( bytes[ 1 ] & 31 ) !== 1 || ( bytes[ 16 ] & 3 ) !== 1 || ( bytes[ 17 ] & 7 ) !== 0 || ( bytes[ 18 ] & 7 ) !== 0 ) plateError( 'Use hvc1 HEVC Main profile, 8-bit 4:2:0.' );

	} else plateError( 'Unknown video encoding.' );

}

export function inspectPlatePackets( packets ) {

	if ( ! packets.length || packets.length > MAX_PLATE_FRAMES ) plateError( 'Clips must contain 1–7,500 frames (at most five minutes).' );
	packets.sort( ( a, b ) => a.timestamp - b.timestamp );
	let lastKey = - 1;
	for ( let frame = 0; frame < packets.length; frame ++ ) {

		const packet = packets[ frame ];
		if ( ! Number.isFinite( packet.timestamp ) || ! Number.isFinite( packet.duration ) || Math.abs( packet.timestamp - frame / PLATE_FPS ) > tolerance || Math.abs( packet.duration - 1 / PLATE_FPS ) > tolerance ) plateError( `Use constant 25 fps beginning at zero; timing differs at frame ${frame}.` );
		if ( packet.type === 'key' ) lastKey = frame;
		if ( lastKey < 0 || frame - lastKey >= PLATE_FPS ) plateError( 'Use an initial keyframe and keyframes at least once per second.' );

	}

	return packets.length;

}

/** Checks every encoded presentation timestamp without decoding all video frames. */
export async function inspectPlateVideo( file, encoding, { signal } = {} ) {

	if ( ! file || file.size < 16 || file.size > MAX_PLATE_FILE_BYTES || ! /\.mp4$/i.test( file.name || '' ) ) plateError( 'Choose an MP4 file no larger than 512 MiB.' );
	await inspectPlateContainer( file, { signal } );
	const input = new Input( { formats: [ MP4 ], source: new BlobSource( file ) } );
	try {

		const tracks = await input.getTracks();
		if ( tracks.length !== 1 || ! tracks[ 0 ].isVideoTrack() ) plateError( 'Use one video track without audio or other media tracks.' );
		const track = tracks[ 0 ];
		const [ width, height, rotation, flip, aspect, color, hdr, config, entry ] = await Promise.all( [ track.getCodedWidth(), track.getCodedHeight(), track.getRotation(), track.getFlip(), track.getPixelAspectRatio(), track.getColorSpace(), track.hasHighDynamicRange(), track.getDecoderConfig(), track.getInternalCodecId() ] );
		signal?.throwIfAborted();
		if ( width !== PLATE_WIDTH || ! PLATE_HEIGHTS.includes( height ) || rotation !== 0 || flip || aspect.num !== 1 || aspect.den !== 1 ) plateError( 'Use 1280 × 720 or 1280 × 890 square pixels, with no rotation or flip metadata.' );
		if ( hdr || color.primaries !== 'bt709' || color.transfer !== 'bt709' || color.matrix !== 'bt709' || color.fullRange === true ) plateError( 'Use SDR BT.709 colour tags and limited/video range.' );
		if ( entry !== ( encoding === 'hevc' ? 'hvc1' : 'avc1' ) ) plateError( `The ${encoding} file has the wrong MP4 sample entry.` );
		inspectPlateCodec( config, encoding );
		const sink = new EncodedPacketSink( track ), packets = [];
		for await ( const packet of sink.packets( undefined, undefined, { metadataOnly: true } ) ) {

			signal?.throwIfAborted();
			if ( packets.length >= MAX_PLATE_FRAMES ) plateError( 'Clips must not exceed five minutes.' );
			packets.push( { timestamp: packet.timestamp, duration: packet.duration, type: packet.type } );

		}

		const frameCount = inspectPlatePackets( packets );
		return { encoding, width, height, fps: PLATE_FPS, frameCount, size: file.size, codec: config.codec, decodable: await track.canDecode() };

	} finally {

		input.dispose();

	}

}
