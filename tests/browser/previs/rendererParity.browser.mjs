// Controlled GPU comparison: admin AssetLoader/material restore vs student viewport.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const origin = process.env.STUDENT_TEST_ORIGIN || 'http://localhost:5173';
const directory = '/tmp/sim-trav-renderer-parity';
await mkdir( directory, { recursive: true } );
const browser = await puppeteer.launch( { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 180000, args: [ '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ] } );
const report = { checks: [], errors: [] };
try {
 const page = await browser.newPage(); await page.setViewport( { width: 1586, height: 992 } );
 page.on( 'console', message => { if ( [ 'error', 'warn' ].includes( message.type() ) ) console.log( message.text().slice( 0, 600 ) ); } );
 page.on( 'pageerror', error => report.errors.push( error.message ) );
 await page.goto( `${origin}/student/` );
 const result = await page.evaluate( async path => ( await import( path ) ).compareRenderers(), `/@fs${fileURLToPath( new URL( './RendererParityFixture.js', import.meta.url ) )}` );
 for ( const output of result.outputs ) await writeFile( `${directory}/${output.name}`, Buffer.from( output.data.split( ',' )[ 1 ], 'base64' ) );
 delete result.outputs; Object.assign( report, result );
 assert.ok( result.meanChannelError <= 0.1, 'Identical scene inputs must produce equivalent admin/student raster pixels' );
 assert.deepEqual( result.paintNormalScale, [ 1, - 1 ] ); assert.deepEqual( result.environmentDimensions, [ 1024, 512 ] );
 report.checks.push( 'Admin AssetLoader + authored material restoration and student verified viewport render the same SUV/camera/HDRI/lights with equivalent GPU pixels' );
 assert.deepEqual( report.errors, [] ); report.passed = true; console.log( JSON.stringify( report, null, 2 ) );
} catch ( error ) { report.failure = error.stack; console.log( error.stack ); throw error; }
finally { await writeFile( `${directory}/report.json`, JSON.stringify( report, null, 2 ) ); await browser.close(); }
