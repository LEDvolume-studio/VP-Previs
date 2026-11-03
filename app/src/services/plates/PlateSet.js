export const PLATE_FPS = 25;
export const PLATE_WIDTH = 1280;
export const PLATE_HEIGHT = 720;
export const PLATE_HEIGHTS = Object.freeze( [ 720, 890 ] );
export const MAX_PLATE_FRAMES = 7500;
export const MAX_PLATE_FILE_BYTES = 512 * 1024 * 1024;
export const PLATE_VIEWS = Object.freeze( [ 'front', 'right', 'rear', 'left' ] );
export const PLATE_ENCODINGS = Object.freeze( [ 'hevc', 'h264' ] );
export const PLATE_SLOTS = Object.freeze( PLATE_ENCODINGS.flatMap( encoding => PLATE_VIEWS.map( view => `${view}-${encoding}` ) ) );

export function plateError( message ) {

	throw new Error( `Driving plates: ${message}` );

}

export function plateSlotFromName( name ) {

	const match = /^(front|right|rear|left)[-_](hevc|h264)\.mp4$/i.exec( name );
	return match ? `${match[ 1 ].toLowerCase()}-${match[ 2 ].toLowerCase()}` : null;

}

/** Boundaries belong to the clockwise view; wraparound is deterministic on seek/export. */
export function plateViewAtHeading( relativeDegrees, offsetDegrees = 0 ) {

	if ( ! Number.isFinite( relativeDegrees ) || ! Number.isFinite( offsetDegrees ) ) plateError( 'Heading must be finite.' );
	const heading = ( ( relativeDegrees - offsetDegrees ) % 360 + 360 ) % 360;
	return PLATE_VIEWS[ Math.floor( ( heading + 45 ) / 90 ) % 4 ];

}

export function plateFrameAtTime( seconds, frameCount, { loop = false } = {} ) {

	if ( ! Number.isFinite( seconds ) || seconds < 0 || ! Number.isInteger( frameCount ) || frameCount < 1 || frameCount > MAX_PLATE_FRAMES ) plateError( 'Invalid plate time or frame count.' );
	const frame = Math.floor( seconds * PLATE_FPS + 1e-7 );
	return loop ? frame % frameCount : Math.min( frameCount - 1, frame );

}

/** Header validation is independent of the device's ability to decode HEVC. */
export function validatePlateManifest( manifest ) {

	if ( manifest?.format !== 'rayzee-driving-plates' || manifest.schemaVersion !== 1 || ! /^[a-zA-Z0-9-]{1,80}$/.test( manifest.id ) || typeof manifest.name !== 'string' || ! manifest.name.trim() || manifest.name.length > 120 || ! Number.isInteger( manifest.frameCount ) || manifest.frameCount < 1 || manifest.frameCount > MAX_PLATE_FRAMES ) plateError( 'Invalid plate-set manifest.' );
	if ( ! Number.isFinite( manifest.headingOffset ) || Math.abs( manifest.headingOffset ) > 360 ) plateError( 'Invalid calibrated heading.' );
	if ( ! manifest.files || Object.keys( manifest.files ).length !== 8 ) plateError( 'A set requires four HEVC and four H.264 files.' );
	for ( const slot of PLATE_SLOTS ) {

		const file = manifest.files[ slot ];
		if ( file?.sha256 !== undefined && ! /^[a-f0-9]{64}$/.test( file.sha256 ) ) plateError( `Invalid content hash for ${slot}.` );
		if ( ! file || file.frameCount !== manifest.frameCount || ! Number.isSafeInteger( file.size ) || file.size < 16 || file.size > MAX_PLATE_FILE_BYTES || file.width !== PLATE_WIDTH || ! PLATE_HEIGHTS.includes( file.height ) || file.fps !== PLATE_FPS || file.encoding !== slot.split( '-' )[ 1 ] || ! Array.isArray( file.chunks ) || file.chunks.length !== Math.ceil( file.size / ( 4 * 1024 * 1024 ) ) || ! file.chunks.every( hash => /^[a-f0-9]{64}$/.test( hash ) ) ) plateError( `Invalid metadata for ${slot}.` );

	}

	const first = manifest.files[ 'front-hevc' ];
	if ( PLATE_SLOTS.some( slot => manifest.files[ slot ].height !== first.height ) ) plateError( 'All views must have matching dimensions.' );
	if ( manifest.downloadedEncodings && ( ! Array.isArray( manifest.downloadedEncodings ) || ! manifest.downloadedEncodings.length || manifest.downloadedEncodings.some( encoding => ! PLATE_ENCODINGS.includes( encoding ) ) ) ) plateError( 'Invalid downloaded encoding.' );
	return manifest;

}
