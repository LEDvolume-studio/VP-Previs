// Keep generated dependency caches and streamed public files out of cloud
// storage. Originals stay in the checkout; reading a source file never edits it.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repo = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const key = createHash( 'sha256' ).update( repo ).digest( 'hex' ).slice( 0, 12 );
const runtime = path.join( homedir(), '.local', 'share', 'rayzee', `runtime-${key}` );
const publicDir = path.join( runtime, 'public' );

async function stage( source, destination ) {

	await mkdir( destination, { recursive: true } );
	for ( const entry of await readdir( source, { withFileTypes: true } ) ) {

		if ( entry.name === '.DS_Store' ) continue;
		const from = path.join( source, entry.name );
		const to = path.join( destination, entry.name );
		if ( entry.isDirectory() ) await stage( from, to );
		else if ( entry.isFile() ) {

			// Read fully before writing; fs.copyFile's OS clone and streamed file
			// handles can time out on File Provider placeholders on macOS.
			await writeFile( to, await readFile( from ) );

		}

	}

}

await stage( path.join( repo, 'app', 'public' ), publicDir );
process.chdir( path.join( repo, 'app' ) );
const server = await createServer( {
	root: process.cwd(),
	publicDir,
	// React's Babel plugin excludes /node_modules/. Keep optimized dependencies
	// under that segment so it cannot compile them a second time as app source.
	cacheDir: path.join( runtime, 'node_modules', '.vite' ),
	server: { port: 5173, strictPort: true },
} );
await server.listen();
server.printUrls();
console.log( `Public files are served from ${publicDir}` );
