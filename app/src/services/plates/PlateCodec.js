import { PLATE_VIEWS } from './PlateSet.js';

export const plateCodecName = encoding => encoding === 'hevc' ? 'HEVC' : 'H.264';

/** Match the WebCodecs decoder used by timeline playback, for all four views. */
export async function choosePlateEncoding( manifest, decoder = globalThis.VideoDecoder ) {

	try {

		for ( const view of PLATE_VIEWS ) {

			const file = manifest.files[ `${view}-hevc` ];
			if ( ! ( await decoder.isConfigSupported( { codec: file.codec, codedWidth: file.width, codedHeight: file.height } ) ).supported ) return 'h264';

		}

		return 'hevc';

	} catch {

		return 'h264';

	}

}
