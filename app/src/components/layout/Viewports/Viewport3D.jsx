import React, { useRef, useEffect, useState, useCallback, forwardRef, useMemo } from 'react';
import DimensionDisplay from './DimensionDisplay';
import AutoFocusOverlay from './AutoFocusOverlay';
import FrameRatioOverlay from './FrameRatioOverlay';
import StatsMeter from './StatsMeter';
import StatsPanel from './StatsPanel';
import HeatmapOverlay from './HeatmapOverlay';
import SaveControls from './SaveControls';
import ViewportToolbar from './ViewportToolbar';
import EditorViewControls from './EditorViewControls';
import EditorRulerOverlay from './EditorRulerOverlay';
import CameraSpeedControl from './CameraSpeedControl';
import InteractionContextMenu from '@/components/ui/InteractionContextMenu';
import { useToast } from '@/hooks/use-toast';
import { useStore, usePathTracerStore, useCameraStore, useAnimationStore, useLightStore } from '@/store';
import { saveRender } from '@/utils/database';
import { installViewportResumeRecovery } from '@/utils/viewportResume';
import { useAutoFitScale } from '@/hooks/useAutoFitScale';
import { generateViewportStyles } from '@/utils/viewport';
import { PathTracerApp } from 'rayzee';
import { getApp, setApp } from '@/lib/appProxy';
import { connectEngineToStore } from '@/lib/EngineAdapter';
import { LEDVideoManager } from '@/services/LEDVideoManager';
import { projectSession } from '@/services/projects/ProjectSession';
import { useProjectStore } from '@/services/projects/projectStore';


const Viewport3D = forwardRef( ( { viewportMode = "preview" }, ref ) => {

	const { toast } = useToast();

	// Refs
	const viewportRef = useRef( null );
	const viewportWrapperRef = useRef( null );
	const containerRef = useRef( null );
	const canvasRef = useRef( null );
	const appRef = useRef( null );
	const engineCleanupRef = useRef( null );
	const isInitialized = useRef( false );

	// Viewport state
	const canvasWidth = usePathTracerStore( state => state.canvasWidth );
	const canvasHeight = usePathTracerStore( state => state.canvasHeight );
	const [ canvasReady, setCanvasReady ] = useState( false );
	const [ renderResolution, setRenderResolution ] = useState( { width: 512, height: 512 } );
	const [ isAppInitialized, setIsAppInitialized ] = useState( false );

	// Store subscriptions
	const isDenoising = useStore( state => state.isDenoising );
	const isUpscaling = useStore( state => state.isUpscaling );
	const isRenderComplete = useStore( state => state.isRenderComplete );
	const setIsRenderComplete = useStore( state => state.setIsRenderComplete );
	const stats = useStore( state => state.stats );
	const statsRef = useRef( stats );
	const setLoading = useStore( state => state.setLoading );
	const appMode = useStore( state => state.appMode );
	const showAsvgfHeatmap = usePathTracerStore( state => state.showAsvgfHeatmap );
	const savedViewport = useProjectStore( state => state.activeProject?.workspace?.viewport );
	const savedEditorView = useProjectStore( state => state.activeProject?.workspace?.editorView );
	const activeProjectId = useProjectStore( state => state.activeProject?.projectId );
	const [ editorViewMode, setEditorViewMode ] = useState( savedEditorView?.mode || 'perspective' );
	const [ rulerEnabled, setRulerEnabled ] = useState( false );
	const [ rulerTemporary, setRulerTemporary ] = useState( false );
	const [ rulerClearSignal, setRulerClearSignal ] = useState( 0 );

	// Auto-fit scaling logic - only initialize after canvases are ready
	const {
		viewportScale,
		autoFitScale,
		isManualScale,
		handleViewportResize,
		handleResetToAutoFit
	} = useAutoFitScale( {
		viewportRef,
		canvasWidth,
		canvasHeight,
		padding: 40,
		minScale: 1,
		maxScale: 200,
		enabled: canvasReady, // Only enable auto-fit after canvases are ready
		persistedViewport: savedViewport,
		onViewportChange: viewport => projectSession.setWorkspace( { viewport } ),
	} );


	// Effect to mark canvases as ready
	useEffect( () => {

		if ( canvasRef.current ) {

			// Small delay to ensure DOM is fully rendered
			const timer = setTimeout( () => {

				setCanvasReady( true );

			}, 100 );

			return () => clearTimeout( timer );

		}

	}, [ canvasWidth, canvasHeight ] );

	// Effect to listen for resolution changes and update render resolution
	useEffect( () => {

		const handleResolutionChange = ( event ) => {

			const { width, height } = event.detail;
			setRenderResolution( { width, height } );

		};

		// Listen for resolution change events
		window.addEventListener( 'resolution_changed', handleResolutionChange );

		// Set initial resolution when app is initialized
		if ( isAppInitialized && appRef.current ) {

			// Get the actual canvas dimensions from the app
			const app = appRef.current;
			if ( app && app.width && app.height ) {

				setRenderResolution( { width: app.width, height: app.height } );

			}

		}

		return () => {

			window.removeEventListener( 'resolution_changed', handleResolutionChange );

		};

	}, [ isAppInitialized ] );


	// Keep stats ref current so handleSave doesn't depend on stats (which changes every frame)
	useEffect( () => {

		statsRef.current = stats;

	}, [ stats ] );

	// Save/Discard Handlers
	const handleSave = useCallback( async () => {

		const app = getApp();
		if ( ! app ) return;

		try {

			const canvas = app.getCanvas();
			if ( ! canvas ) return;

			const imageData = canvas.toDataURL( 'image/png' );
			const saveData = {
				image: imageData,
				colorCorrection: {
					brightness: 0,
					contrast: 0,
					saturation: 0,
					hue: 0,
					exposure: 0,
				},
				timestamp: new Date(),
				renderTime: statsRef.current.timeElapsed || 0,
				isEdited: true
			};

			const id = await saveRender( saveData );
			window.dispatchEvent( new CustomEvent( 'render-saved', { detail: { id } } ) );
			setIsRenderComplete( false );

		} catch ( error ) {

			console.error( 'Failed to save render:', error );
			toast( {
				title: "Failed to save render",
				description: "See console for details.",
				variant: "destructive",
			} );

		}

	}, [ setIsRenderComplete, toast ] );

	const handleDiscard = useCallback( () => {

		setIsRenderComplete( false );

	}, [ setIsRenderComplete ] );


	// Effect for app initialization
	useEffect( () => {

		if ( ! appRef.current && containerRef.current ) {

			setLoading( { isLoading: true, title: "Starting", status: "Setting up Scene...", progress: 0 } );

			const initApp = async () => {

				const app = new PathTracerApp( canvasRef.current, {
					container: containerRef.current,
					// The store owns output resolution; window layout only changes display size.
					autoResize: false,
				} );
				appRef.current = app;
				setLoading( { isLoading: true, title: "Starting", status: "Initializing WebGPU...", progress: 30 } );
				await app.init();
				// The app intentionally opens in raster mode. Set the engine before the
				// LED coordinator snapshots the preferred renderer and before animation starts.
				app.pathTracerEnabled = usePathTracerStore.getState().enablePathTracer;

				// Pre-load the bundled spot-light gobo + IES profile libraries so
				// they're ready by the time the user opens the Lights tab.
				try {

					const [ { GOBO_LIBRARY }, { IES_LIBRARY } ] = await Promise.all( [
						import( '@/services/GoboLibrary' ),
						import( '@/services/IESLibrary' ),
					] );
					await Promise.all( [
						app.goboManager?.loadLibrary?.( GOBO_LIBRARY ),
						app.iesManager?.loadLibrary?.( IES_LIBRARY ),
					] );

				} catch ( e ) {

					console.warn( 'Light mask / IES library load failed', e );

				}

				// Register with appProxy so getApp() works globally
				setApp( app );
				LEDVideoManager.attachApp( app );

				// Bridge engine events → Zustand stores
				engineCleanupRef.current = connectEngineToStore( app, { useStore, useCameraStore, usePathTracerStore, useAnimationStore, useLightStore } );
				usePathTracerStore.getState().setPathTracerActive( app.pathTracerEnabled );

				// Match the app's initial final-denoise default before project hydration.
				// Project restoration may subsequently override this setting.
				app.denoisingManager?.setOIDNEnabled( usePathTracerStore.getState().enableOIDN );

				setLoading( { isLoading: true, title: "Starting", status: "Restoring project...", progress: 60 } );
				await projectSession.initialize();

				setLoading( { isLoading: true, title: "Starting", status: "Setup Complete!", progress: 100 } );

				app.animate();
				app.reset();

			};

			let startupFailed = false;
			initApp()
				.catch( ( err ) => {

					startupFailed = true;
					console.error( "Error initializing PathTracerApp:", err );
					if ( ! useStore.getState().loading.failed ) setLoading( {
						isLoading: true,
						failed: true,
						failedTitle: 'Failed to load application',
						status: err.message || 'Application startup failed.',
						progress: 0,
						canCancel: false,
					} );
					toast( {
						title: "Failed to load application",
						description: err.message || "Uh oh!! Something went wrong. Please try again.",
						variant: "destructive",
					} );

				} )
				.finally( () => {

					const resetLoadingFn = useStore.getState().resetLoading;
					if ( ! startupFailed ) resetLoadingFn();

					isInitialized.current = true;
					setIsAppInitialized( true );

					window.dispatchEvent( new CustomEvent( 'SceneRebuild' ) );

				} );

		}

	}, [ setLoading, toast ] );

	useEffect( () => {

		if ( ! isAppInitialized || ! appRef.current ) return;
		return installViewportResumeRecovery( appRef.current );

	}, [ isAppInitialized ] );

	// Disable select mode when leaving preview mode
	useEffect( () => {

		const app = getApp();
		if ( app && appMode !== 'preview' && appMode !== 'results' ) {

			app.interactionManager?.disableMode();

		}

	}, [ appMode ] );

	useEffect( () => {

		if ( viewportMode !== 'preview' && appRef.current?.editorViewManager?.active ) {

			appRef.current.setEditorView( 'perspective' );

		}

	}, [ viewportMode ] );

	// Compute whether to show save controls
	const shouldShowSaveControls = useMemo( () => {

		const app = getApp();
		if ( ! app ) return false;
		if ( viewportMode !== "final-render" ) return false;
		if ( ! isRenderComplete ) return false;
		if ( isDenoising ) return false;
		if ( isUpscaling ) return false;
		return app.isComplete();

	}, [ isRenderComplete, isDenoising, isUpscaling, viewportMode, isAppInitialized ] );

	// Memoize style objects
	const isEditorView = viewportMode === 'preview' && editorViewMode !== 'perspective';
	const { wrapperStyle, containerStyle, canvasStyle } = useMemo( () => {

		const styles = generateViewportStyles( canvasWidth, canvasHeight, viewportScale );
		if ( isEditorView ) styles.canvasStyle.cursor = rulerEnabled || rulerTemporary ? 'crosshair' : 'auto';
		return styles;

	}, [ canvasWidth, canvasHeight, viewportScale, isEditorView, rulerEnabled, rulerTemporary ] );

	return (
		<div ref={viewportRef} className="relative flex justify-center items-center h-full overflow-scroll" >

			<div ref={viewportWrapperRef} className="relative shadow-2xl transition-none" style={wrapperStyle} >
				<div ref={containerRef} className={`relative`} style={containerStyle} >
					<canvas
						ref={canvasRef}
						width={canvasWidth}
						height={canvasHeight}
						style={canvasStyle}
					/>
					{isAppInitialized && viewportMode === 'preview' && (
						<EditorRulerOverlay
							key={activeProjectId || 'scratch'}
							app={appRef.current}
							canvas={canvasRef.current}
							mode={editorViewMode}
							enabled={rulerEnabled}
							onTemporaryChange={setRulerTemporary}
							clearSignal={rulerClearSignal}
						/>
					)}
					{! isEditorView && <FrameRatioOverlay />}
					{! isEditorView && <AutoFocusOverlay containerRef={containerRef} />}
				</div>
			</div>

			{! isEditorView && <DimensionDisplay dimension={renderResolution} />}
			{isAppInitialized && ! isEditorView && <CameraSpeedControl />}
			<StatsMeter viewportMode={viewportMode} />
			{isAppInitialized && (
				<>
					<StatsPanel app={appRef.current} container={viewportRef.current} />
					<HeatmapOverlay
						app={appRef.current}
						renderTarget={appRef.current?.stages?.asvgf?.heatmapTarget}
						visible={showAsvgfHeatmap}
						title="ASVGF Debug"
						position="bottom-right"
					/>
				</>
			)}

			{shouldShowSaveControls && (
				<SaveControls onSave={handleSave} onDiscard={handleDiscard} />
			)}

			{canvasReady && ! isEditorView && (
				<ViewportToolbar
					onResize={handleViewportResize}
					viewportWrapperRef={viewportRef}
					autoFitScale={autoFitScale}
					isManualScale={isManualScale}
					onResetToAutoFit={handleResetToAutoFit}
				/>
			)}

			{isAppInitialized && viewportMode === 'preview' && (
				<EditorViewControls
					app={appRef.current}
					projectId={activeProjectId}
					savedState={savedEditorView}
					onModeChange={setEditorViewMode}
					rulerEnabled={rulerEnabled}
					rulerTemporary={rulerTemporary}
					onRulerEnabledChange={setRulerEnabled}
					onClearRulers={() => setRulerClearSignal( signal => signal + 1 )}
				/>
			)}

			<InteractionContextMenu />

		</div>
	);

} );

Viewport3D.displayName = 'Viewport3D';

// Export a memoized version of the component
export default React.memo( Viewport3D );
