import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// Uses a caller-provided FFmpeg binary; never downloads or modifies production footage.
const executable = process.env.PLATE_TEST_FFMPEG;
if ( ! executable ) throw new Error( 'Set PLATE_TEST_FFMPEG to an FFmpeg binary with libx264 and libx265.' );
const target = resolve( process.env.PLATE_FIXTURE_DIR || '.local-runtime/plate-fixtures' );
await mkdir( target, { recursive: true } );
for ( const [ index, view ] of [ 'front', 'right', 'rear', 'left' ].entries() ) {

	for ( const encoding of [ 'h264', 'hevc' ] ) {

		const args = [ '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=2', '-vf', `hue=h=${index * 70},format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`, '-an', '-threads', '2' ];
		if ( encoding === 'h264' ) args.push( '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'main', '-g', '25', '-keyint_min', '25', '-sc_threshold', '0', '-bf', '2' );
		else args.push( '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-x265-params', 'pools=1:frame-threads=1:keyint=25:min-keyint=25:scenecut=0:log-level=error' );
		args.push( '-movflags', '+faststart', resolve( target, `${view}-${encoding}.mp4` ) );
		execFileSync( executable, args, { stdio: 'inherit' } );

	}

}
console.log( `Generated eight synthetic plate fixtures in ${target}` );
