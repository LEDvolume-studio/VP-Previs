import { constants, openAsBlob } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { inspectPlateVideo } from '../app/src/services/plates/InspectPlateVideo.js';
import { PLATE_SLOTS, validatePlateManifest } from '../app/src/services/plates/PlateSet.js';

const source = resolve( process.argv[ 2 ] || '../Video_files/Advanced_3mbps' );
const output = resolve( process.env.PLATE_CATALOGUE_DIR || '.local-runtime/plate-catalogue' );
const ffmpeg = process.env.PLATE_TEST_FFMPEG;
if ( ! ffmpeg ) throw new Error( 'Set PLATE_TEST_FFMPEG to a local FFmpeg executable.' );
const files = {};
for ( const slot of PLATE_SLOTS ) {

	const file = await openAsBlob( resolve( source, `${slot}.mp4` ) );
	Object.defineProperty( file, 'name', { value: `${slot}.mp4` } );
	const metadata = await inspectPlateVideo( file, slot.split( '-' )[ 1 ] );
	delete metadata.decodable;
	metadata.chunks = [];
	const fullHash = createHash( 'sha256' );
	for ( let offset = 0; offset < file.size; offset += 4 * 1024 * 1024 ) {
		const bytes = new Uint8Array( await file.slice( offset, offset + 4 * 1024 * 1024 ).arrayBuffer() );
		fullHash.update( bytes ); metadata.chunks.push( createHash( 'sha256' ).update( bytes ).digest( 'hex' ) );
	}
	metadata.sha256 = fullHash.digest( 'hex' );
	files[ slot ] = metadata;
	console.log( `Checked ${slot}: ${metadata.frameCount} frames, ${metadata.width}×${metadata.height}` );

}
const revision = createHash( 'sha256' ).update( JSON.stringify( files ) ).digest( 'hex' ).slice( 0, 20 );
const slug = basename( source ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).slice( 0, 48 );
const manifest = validatePlateManifest( { format: 'rayzee-driving-plates', schemaVersion: 1, id: `${slug}-${revision}`, name: basename( source ).replace( /_\d+mbps$/i, '' ).replaceAll( '_', ' ' ), frameCount: files[ 'front-hevc' ].frameCount, headingOffset: 0, files, media: { thumbnail: 'thumbnail.jpg', preview: 'preview.mp4' } } );
const directory = resolve( output, manifest.id );
await mkdir( directory, { recursive: true } );
for ( const slot of PLATE_SLOTS ) await copyFile( resolve( source, `${slot}.mp4` ), resolve( directory, `${slot}.mp4` ), constants.COPYFILE_FICLONE );
const front = resolve( source, 'front-h264.mp4' );
const start = Math.min( 3, Math.max( 0, manifest.frameCount / 25 - 1 ) ).toString();
execFileSync( ffmpeg, [ '-hide_banner', '-loglevel', 'error', '-y', '-ss', start, '-i', front, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', resolve( directory, 'thumbnail.jpg' ) ] );
execFileSync( ffmpeg, [ '-hide_banner', '-loglevel', 'error', '-y', '-ss', start, '-i', front, '-t', '8', '-an', '-sn', '-vf', 'scale=480:-2,fps=12,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-profile:v', 'baseline', '-crf', '28', '-g', '24', '-movflags', '+faststart', resolve( directory, 'preview.mp4' ) ] );
await writeFile( resolve( directory, 'manifest.json' ), JSON.stringify( manifest, null, 2 ) );
let sets = [];
try { sets = JSON.parse( await readFile( resolve( output, 'catalogue.json' ), 'utf8' ) ).sets; } catch ( error ) { if ( error.code !== 'ENOENT' ) throw error; }
sets = sets.filter( item => item.id !== manifest.id && item.name !== manifest.name ); sets.push( manifest );
await writeFile( resolve( output, 'catalogue.json' ), JSON.stringify( { schemaVersion: 1, sets }, null, 2 ) );
console.log( `Prepared ${manifest.name} in ${directory}. Originals unchanged; no upload or deployment performed.` );
