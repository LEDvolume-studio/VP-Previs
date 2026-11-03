import path from 'node:path';
import { startDevServer } from './devServer.js';
import { openHarness } from './browser.js';

const server = await startDevServer();
let harness;
try {

	harness = await openHarness( server.url );
	const modulePath = `/@fs${path.resolve( 'bench/harness/upstreamImprovements.js' )}`;
	const results = await harness.page.evaluate( async url => {

		const { checkUpstreamImprovements, checkCameraClipRender, checkLightRadiusRender } = await import( url );
		const { checkDepthOfField } = await import( url.replace( 'upstreamImprovements.js', 'depthOfField.js' ) );
		const app = globalThis.__bench.__app();
		const numerical = await checkUpstreamImprovements( app.renderer );
		const render = await checkCameraClipRender( app );
		const lightRender = await checkLightRadiusRender( app );
		const depthOfField = await checkDepthOfField( app );
		return { numerical, render, lightRender, depthOfField };

	}, modulePath );
	const diagnostics = await harness.bench.shaderDiagnostics();
	if ( diagnostics.entries.length ) throw new Error( JSON.stringify( diagnostics.entries ) );
	console.log( JSON.stringify( { passed: true, results }, null, 2 ) );

} finally {

	await harness?.close();
	await server.stop();

}
