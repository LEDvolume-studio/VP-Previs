import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const require = createRequire( import.meta.url );
const commands = {
	dev: [ 'dev', '--env', 'local', '--local' ],
	migrate: [ 'd1', 'migrations', 'apply', 'DB', '--env', 'local', '--local' ],
	check: [ 'deploy', '--env', 'local', '--dry-run', '--outdir', 'dist' ],
	pages: [ 'pages', 'functions', 'build', '../functions', '--project-directory', '..', '--outdir', 'dist-pages', '--output-routes-path', 'dist-pages/_routes.json', '--compatibility-date', '2026-07-30' ]
};
const arguments_ = commands[ process.argv[ 2 ] ];
if ( ! arguments_ || process.argv.length !== 3 ) throw new Error( 'Choose dev, migrate, check or pages; no remote command or environment override is supported.' );
if ( process.argv[ 2 ] === 'pages' ) mkdirSync( new URL( '../dist-pages/', import.meta.url ), { recursive: true } );
const wranglerCli = resolve( dirname( require.resolve( 'wrangler' ) ), '../bin/wrangler.js' );
const result = spawnSync( process.execPath, [ wranglerCli, ...arguments_ ], {
	cwd: new URL( '../', import.meta.url ),
	env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
	stdio: 'inherit'
} );
if ( result.error ) throw result.error;
process.exitCode = result.status ?? 1;
