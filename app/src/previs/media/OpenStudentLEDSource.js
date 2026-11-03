import { getPlateLibraryService } from '../../services/plates/PlateLibraryService.js';
import { DecodedLEDSource } from './DecodedLEDSource.js';
import { LocalPlateLibrary } from '../../services/plates/LocalPlateLibrary.js';

const digest = async blob => Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await blob.arrayBuffer() ) ), value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );

/** Resolve the exact saved video by content, never by filename or a mutable set name.
 * Downloaded OPFS Files stay file-backed for decoding. Other videos use the pinned
 * catalogue, including older presets saved before plate-specific metadata existed.
 */
export async function openStudentLEDSource( asset, catalogue, { signal, maximumResidentBytes = Infinity, library = new LocalPlateLibrary(), plateService = getPlateLibraryService(), openSource = blob => DecodedLEDSource.open( blob ) } = {} ) {

	signal?.throwIfAborted();
	let match;
	try {

		match = await plateService.findAsset( asset );

	} catch {

		signal?.throwIfAborted();

	}

	if ( match ) {

		const { manifest, encoding } = await plateService.ensure( match.manifest, { signal } );
		const localLibrary = plateService.library;
		const release = await localLibrary.lease( manifest.id );
		try {

			const files = await localLibrary.filesFor( manifest, encoding, { signal } );
			const source = await openSource( files[ match.view ] );
			const dispose = source.dispose.bind( source ); let disposal;
			source.dispose = () => disposal ||= Promise.resolve().then( dispose ).finally( release );
			source.downloadedPlate = { setId: manifest.id, view: match.view, encoding };
			source.residentBytes = 0;
			return source;

		} catch ( error ) {

			await release(); throw error;

		}

	}

	let records = [];
	try {

		records = await library.list();

	} catch {

		// OPFS may be disabled or empty; the immutable published media remains valid.
		signal?.throwIfAborted();

	}

	for ( const { manifest, ready } of records ) {

		if ( ! ready || asset.mimeType !== 'video/mp4' || Math.abs( manifest.frameCount * 40000 - asset.durationUs ) > 1000 ) continue;
		const candidates = Object.entries( manifest.files ).filter( ( [ slot, file ] ) => file.size === asset.byteLength && ( manifest.downloadedEncodings || [ 'hevc', 'h264' ] ).includes( slot.split( '-' )[ 1 ] ) );
		if ( ! candidates.length ) continue;
		let release;
		try {

			release = await library.lease( manifest.id );
			const directory = await ( await library.root() ).getDirectoryHandle( manifest.id );
			for ( const [ slot ] of candidates ) {

				signal?.throwIfAborted();
				const file = await ( await directory.getFileHandle( `${slot}.mp4` ) ).getFile();
				if ( file.size !== asset.byteLength || await digest( file ) !== asset.sha256 ) continue;
				signal?.throwIfAborted();
				const source = await openSource( file );
				const dispose = source.dispose.bind( source ), unlock = release;
				let disposal;
				source.dispose = () => disposal ||= Promise.resolve().then( dispose ).finally( unlock );
				source.downloadedPlate = { setId: manifest.id, view: slot.split( '-' )[ 0 ], encoding: slot.split( '-' )[ 1 ] };
				source.residentBytes = 0; // BlobSource reads this leased OPFS File lazily.
				release = null;
				return source;

			}

		} catch {

			// A removed/corrupt local copy cannot substitute bytes for the saved asset.
			signal?.throwIfAborted();

		} finally {

			await release?.();

		}

	}

	if ( asset.byteLength > maximumResidentBytes ) throw new Error( 'Download the plate set before playback: these video bytes exceed the preview memory budget.' );
	const bytes = await catalogue.getAssetBytes( asset, { signal } );
	signal?.throwIfAborted();
	const source = await openSource( new Blob( [ bytes ], { type: asset.mimeType } ) );
	source.residentBytes = asset.byteLength;
	return source;

}
