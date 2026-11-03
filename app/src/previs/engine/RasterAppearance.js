/**
 * The portable portion of the existing admin raster renderer's appearance.
 * Exposure belongs to camera; HDRI identity, strength and rotation belong to
 * environment. This contract never introduces a second colour grade/post stack.
 */
export const RASTER_APPEARANCE_VERSION = 1;
export const RASTER_POST_PROCESSING = 'rayzee-realtime-v1';

const SETTINGS = Object.freeze( [ 'enableEnvironment', 'showBackground', 'transparentBackground', 'backgroundIntensity', 'backgroundBlurriness', 'backgroundColor' ] );
const FIELDS = [ 'version', 'postProcessing', 'toneMapping', 'outputColorSpace', ...SETTINGS ];
const TONE_MAPPING = new Set( [ 0, 1, 2, 3, 4, 6, 7 ] ); // Three.js built-ins; custom = 5 is not portable.
const PATH_ONLY = new Set( [
	'saturation', 'backgroundBlurSamples', 'globalIlluminationIntensity', 'GIIntensity',
	'bounces', 'maxBounces', 'transmissiveBounces', 'maxSubsurfaceSteps', 'maxTransparentBounces',
	'enableAccumulation', 'maxSamples', 'useAdaptiveSampling', 'noiseThreshold', 'adaptiveMinSamples', 'adaptiveStopFraction',
	'usePixelFreeze', 'pixelFreezeThreshold', 'pixelFreezeStability', 'convergenceOverlay', 'samplingTechnique',
	'enableEmissiveTriangleSampling', 'emissiveBoost', 'fireflyThreshold', 'wavefrontSortMaterials',
	'renderLimitMode', 'renderTimeLimit', 'renderMode', 'enableAlphaShadows', 'visMode', 'debugMode', 'debugThreshold', 'debugModel', 'debugVisScale',
	'filterStrength', 'edgeAtrousIterations', 'edgePhiLuminance', 'edgePhiNormal', 'edgePhiDepth',
	'enableOIDN', 'oidnQuality', 'continuousDenoise', 'continuousDenoiseInterval',
	'enableUpscaler', 'upscalerScale', 'upscalerQuality', 'upscalerHdr', 'upscalerBackend',
	'neuralRendering', 'nrIntensity', 'nrLocalTone', 'nrLocalStructure', 'nrColorStrength',
	'enableBloom', 'bloomStrength', 'bloomRadius', 'bloomThreshold', 'denoiserStrategy',
	'enableASVGF', 'asvgfTemporalAlpha', 'asvgfAtrousIterations', 'asvgfPhiColor', 'asvgfPhiNormal', 'asvgfPhiDepth',
	'asvgfVarianceBoost', 'asvgfMaxAccumFrames', 'asvgfGradientStrength', 'asvgfGradientSigmaScale', 'asvgfGradientNoiseFloor',
	'asvgfDebugMode', 'asvgfQualityPreset', 'showAsvgfHeatmap', 'nrdQualityPreset', 'nrdDebugMode',
	'autoExposureKeyValue', 'autoExposureMinExposure', 'autoExposureMaxExposure', 'autoExposureAdaptSpeedBright', 'autoExposureAdaptSpeedDark',
] );
const RUNTIME_ONLY = new Set( [
	'resolution', 'canvasWidth', 'canvasHeight', 'pauseRendering', 'interactionModeEnabled',
	'tilesHelper', 'showLightHelper', 'debugGbufferMaps', 'aspectRatioPreset', 'orientation', 'finalRenderResolution',
	'originalPixelRatio', 'zoomToCursor', 'dollyZoom', 'model', 'environment',
] );
const INACTIVE_ENVIRONMENT = new Set( [
	'gradientZenithColor', 'gradientHorizonColor', 'gradientGroundColor', 'solidSkyColor',
	'skySunAzimuth', 'skySunElevation', 'skySunIntensity', 'skyRayleighDensity', 'skyTurbidity', 'skyMieAnisotropy', 'skyPreset',
] );
const INACTIVE_GROUND = new Set( [ 'groundProjectionRadius', 'groundProjectionHeight', 'groundProjectionLevel', 'groundCatcherHeight' ] );

const fail = message => {

	throw new Error( `Raster appearance: ${message}` );

};

const copy = value => structuredClone( value );

/** Explicit conversion classification. Conditional fields require the caller to
 * verify HDRI mode / disabled ground features. null always means unsupported.
 * maxTextureSize is deliberately absent: it changes raster texture fidelity.
 * autoExposure is absent: its live stage can alter the renderer's exposure.
 */
export function classifyRasterRenderSetting( key ) {

	if ( PATH_ONLY.has( key ) ) return 'path-only';
	if ( RUNTIME_ONLY.has( key ) ) return 'runtime-only';
	if ( INACTIVE_ENVIRONMENT.has( key ) ) return 'inactive-hdri-input';
	if ( INACTIVE_GROUND.has( key ) ) return 'inactive-ground-input';
	if ( SETTINGS.includes( key ) || key === 'toneMapping' ) return 'appearance';
	return null;

}

export function validateRasterAppearance( value ) {

	if ( ! value || Object.getPrototypeOf( value ) !== Object.prototype || Object.keys( value ).length !== FIELDS.length || FIELDS.some( key => ! Object.hasOwn( value, key ) ) ) fail( 'a complete plain appearance record with no unknown fields is required' );
	if ( value.version !== RASTER_APPEARANCE_VERSION || value.postProcessing !== RASTER_POST_PROCESSING ) fail( 'unsupported appearance/post-processing version' );
	if ( ! TONE_MAPPING.has( value.toneMapping ) || value.outputColorSpace !== 'srgb' ) fail( 'unsupported tone mapping or output colour space' );
	for ( const key of [ 'enableEnvironment', 'showBackground', 'transparentBackground' ] ) if ( typeof value[ key ] !== 'boolean' ) fail( `${key} must be boolean` );
	if ( ! Number.isFinite( value.backgroundIntensity ) || value.backgroundIntensity < 0 ) fail( 'backgroundIntensity must be finite and non-negative' );
	if ( ! Number.isFinite( value.backgroundBlurriness ) || value.backgroundBlurriness < 0 || value.backgroundBlurriness > 1 ) fail( 'backgroundBlurriness must be between zero and one' );
	if ( typeof value.backgroundColor !== 'string' || ! /^#[a-f\d]{6}$/i.test( value.backgroundColor ) ) fail( 'backgroundColor must be an sRGB hex colour' );
	return true;

}

function validateHost( { settings, renderer, realtimeRenderer } ) {

	if ( typeof settings?.get !== 'function' || typeof settings.setMany !== 'function' ) fail( 'RenderSettings get/setMany are required' );
	if ( ! renderer || realtimeRenderer?.renderer !== renderer || realtimeRenderer.settings !== settings || typeof realtimeRenderer.syncEnvironment !== 'function' ) fail( 'the matching existing RealtimeRenderer and renderer are required' );
	if ( ! [ 'pipeline', 'scenePass', 'aoPass', 'aoDenoise', 'ssrPass', 'bloomPass', 'aaPass' ].every( key => realtimeRenderer[ key ] ) ) fail( 'the complete admin GTAO/SSR/bloom/SMAA stack is required' );
	const fixedStack = [
		[ realtimeRenderer.aoPass.resolutionScale, 1 ], [ realtimeRenderer.aoPass.samples?.value, 16 ], [ realtimeRenderer.aoPass.scale?.value, 1.15 ],
		[ realtimeRenderer.aoDenoise.radius?.value, 3 ], [ realtimeRenderer.aoDenoise.depthPhi?.value, 0.1 ],
		[ realtimeRenderer.ssrPass.resolutionScale, 1 ], [ realtimeRenderer.ssrPass.quality?.value, 0.35 ], [ realtimeRenderer.ssrPass.blurQuality, 1 ],
		[ realtimeRenderer.ssrPass.intensity?.value, 0.65 ], [ realtimeRenderer.ssrPass.screenEdgeFadeBlack, true ],
		[ realtimeRenderer.bloomPass.strength?.value, 0.3 ], [ realtimeRenderer.bloomPass.radius?.value, 0.35 ], [ realtimeRenderer.bloomPass.threshold?.value, 0.8 ],
	];
	if ( fixedStack.some( ( [ actual, expected ] ) => actual !== expected ) || realtimeRenderer.pipeline.outputNode !== realtimeRenderer.aaPass ) fail( 'a modified post stack requires a new supported appearance version' );
	if ( settings.get( 'autoExposure' ) === true ) fail( 'live automatic exposure cannot be captured as a fixed shot' );
	if ( settings.get( 'groundProjectionEnabled' ) === true || settings.get( 'enableGroundCatcher' ) === true ) fail( 'ground projection/catcher needs a separate supported scene conversion' );

}

export function captureRasterAppearance( host ) {

	validateHost( host );
	const value = {
		version: RASTER_APPEARANCE_VERSION, postProcessing: RASTER_POST_PROCESSING,
		toneMapping: host.renderer.toneMapping, outputColorSpace: host.renderer.outputColorSpace,
		...Object.fromEntries( SETTINGS.map( key => [ key, host.settings.get( key ) ] ) ),
	};
	validateRasterAppearance( value );
	return copy( value );

}

function write( value, host ) {

	host.settings.setMany( Object.fromEntries( SETTINGS.map( key => [ key, value[ key ] ] ) ), { silent: true, reset: false } );
	host.renderer.toneMapping = value.toneMapping;
	host.renderer.outputColorSpace = value.outputColorSpace;
	host.realtimeRenderer.syncEnvironment();

}

/** Apply atomically with respect to this helper's owned settings. A shot host
 * still owns the larger camera/environment/media transaction and edit lock.
 */
export function applyRasterAppearance( value, host ) {

	validateRasterAppearance( value );
	const previous = captureRasterAppearance( host );
	try {

		write( value, host );

	} catch ( error ) {

		try {

			write( previous, host );

		} catch ( restoreError ) {

			throw new AggregateError( [ error, restoreError ], 'Raster appearance apply and restoration failed.' );

		}

		throw error;

	}

}

/** Read/capture/apply/restore shape shared by the existing shot port adapter. */
export function createRasterAppearancePort( host ) {

	validateHost( host );
	return {
		read: () => captureRasterAppearance( host ),
		capture: () => captureRasterAppearance( host ),
		validate: value => {

			validateHost( host ); return validateRasterAppearance( value );

		},
		apply: value => applyRasterAppearance( value, host ),
		restore: value => applyRasterAppearance( value, host ),
	};

}
