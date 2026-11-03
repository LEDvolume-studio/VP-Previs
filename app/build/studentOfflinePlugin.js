import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import path from 'node:path';

/** Cache only the built student workspace and its static dependency graph. */
export function studentOfflinePlugin() {

	return {
		name: 'student-workspace-offline-shell',
		apply: 'build',
		enforce: 'post',
		// Vite finalizes lazy preload dependencies in its own generateBundle hook.
		// Hash only the final bytes, after normal-order build transforms.
		generateBundle: {
			order: 'post',
			handler( _, bundle ) {

				const entry = Object.values( bundle ).find( item => item.type === 'chunk' && item.isEntry && item.name === 'student' );
				if ( ! entry ) throw new Error( 'Student offline shell requires a named student build entry' );
				const included = new Set( [ 'student/index.html' ] );
				const visit = ( name, target = included, dynamic = false ) => {

					if ( target.has( name ) ) return;
					const item = bundle[ name ];
					if ( ! item ) throw new Error( `Student offline dependency is absent from bundle: ${name}` );
					target.add( name );
					if ( item.type !== 'chunk' ) return;
					for ( const dependency of item.imports ) visit( dependency, target, dynamic );
					if ( dynamic ) for ( const dependency of item.dynamicImports || [] ) visit( dependency, target, dynamic );
					// Rolldown may emit a dynamic-import facade referenced by final code
					// without listing that facade in dynamicImports. Include final local
					// module/preload references as well as its graph metadata.
					if ( dynamic ) for ( const match of item.code.matchAll( /["'`]((?:\.\.?\/)[^"'`\s]+\.(?:js|css|wasm))["'`]/g ) ) {

						const dependency = path.posix.normalize( path.posix.join( path.posix.dirname( name ), match[ 1 ] ) );
						if ( bundle[ dependency ] ) visit( dependency, target, dynamic );

					}

					for ( const asset of item.viteMetadata?.importedCss || [] ) visit( asset, target, dynamic );
					for ( const asset of item.viteMetadata?.importedAssets || [] ) visit( asset, target, dynamic );
					for ( const asset of item.referencedFiles || [] ) visit( asset, target, dynamic );

				};

				// Follow the complete editor graph, including lazy renderer and decoder
				// chunks. The separate workbench entry is not reachable from this graph.
				visit( entry.fileName, included, true );

				const files = [ ...included ].sort();
				const hash = createHash( 'sha256' );
				hash.update( 'student-shell-policy-v2' );
				for ( const file of files ) {

					const item = bundle[ file ];
					if ( ! item ) throw new Error( `Student offline HTML is absent from bundle: ${file}` );
					hash.update( file );
					hash.update( item.type === 'chunk' ? item.code : item.source );

				}

				const version = hash.digest( 'hex' ).slice( 0, 20 );
				const urls = [ '/student/', ...files.map( file => `/${file}` ) ];
				const workerSource = `// Generated student workspace shell. Models, videos, diagnostics and API responses are excluded.
const CACHE_PREFIX = 'rayzee-student-shell-';
const CACHE_NAME = ${JSON.stringify( `rayzee-student-shell-${version}` )};
const PRECACHE = ${JSON.stringify( urls )};
const NAVIGATIONS = new Set(['/student/', '/student/index.html']);
const ASSETS = new Set(PRECACHE.filter(path => !NAVIGATIONS.has(path)));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const existed = await caches.has(CACHE_NAME);
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE.map(path => new Request(path, {cache: 'reload'})));
    } catch (error) {
      if (!existed) await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});
// No skipWaiting or clients.claim: an update cannot replace a running editor.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Only the historical editor query receives a navigation fallback. Other
  // query-bearing requests and all private APIs remain network-only.
  const legacy = url.search === '?ui=editor';
  const workspaceNavigation = request.mode === 'navigate' && NAVIGATIONS.has(url.pathname) && (!url.search || legacy);
  if (!workspaceNavigation && (url.search || !ASSETS.has(url.pathname))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(workspaceNavigation ? '/student/' : request) || fetch(request);
  })());
});
`;
				// The edge gate uses exact built bytes, never a suffix/prefix rule that
				// could expose the admin entry through an HTML SPA fallback or alias.
				const entryFor = ( file, path = `/${file}` ) => {

					const item = file === 'student/sw.js' ? { source: workerSource } : bundle[ file ];
					const bytes = Buffer.from( item.type === 'chunk' ? item.code : item.source );
					return { path, sha256: createHash( 'sha256' ).update( bytes ).digest( 'hex' ), byteLength: bytes.byteLength };

				};

				// Publish only the editor dependency graph, never other entry points.
				const publicGraph = new Set( [ 'student/index.html' ] );
				visit( entry.fileName, publicGraph, true );
				const publicFiles = [ entryFor( 'student/index.html', '/student/' ), ...[ ...publicGraph ].sort().map( file => entryFor( file ) ), entryFor( 'student/sw.js' ) ];
				this.emitFile( { type: 'asset', fileName: 'student/edge-public-assets.json', source: JSON.stringify( { version: 1, files: publicFiles } ) } );
				// Keep the worker last for consumers which inspect this emitted asset.
				this.emitFile( { type: 'asset', fileName: 'student/sw.js', source: workerSource } );

			},
		},

	};

}
