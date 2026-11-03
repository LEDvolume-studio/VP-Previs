import { useEffect, useCallback, useRef, useState, lazy, Suspense } from 'react';
import PlateDownloadStatus from './components/plates/PlateDownloadStatus.jsx';
import { initDatabase } from '@/utils/database';
import TopBar from './components/layout/TopBar/TopBar';
import LeftSidebar from '@/components/layout/LeftSideBar/LeftSidebar';
import ViewportTabs from './components/layout/Viewports/ViewportTabs';
import RightSidebar from './components/layout/RightSideBar/RightSidebar';
import { ThemeProvider } from "@/components/theme-provider";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useCameraStore, useStore } from '@/store';
import { getApp } from '@/lib/appProxy';
import { createLogger } from 'rayzee';
import { projectSession } from '@/services/projects/ProjectSession';
import { useProjectStore } from '@/services/projects/projectStore';
import { undoManager } from '@/services/UndoManager';

const PlateLibraryDialog = lazy( () => import( './components/plates/PlateLibraryDialog.jsx' ) );

const log = createLogger( 'app' );

const App = () => {

	const [ showPlateLibrary, setShowPlateLibrary ] = useState( false );

	// Memoized debounced resize handler to prevent recreation on every render
	const timeoutRef = useRef( null );
	const panelGroupRef = useRef( null );
	const panelLayout = useProjectStore( state => state.activeProject?.workspace?.panelLayout );
	const handleResize = useCallback( () => {

		if ( timeoutRef.current ) {

			clearTimeout( timeoutRef.current );

		}

		timeoutRef.current = setTimeout( () => {

			window.dispatchEvent( new Event( 'resize' ) );

		}, 500 );

	}, [] );

	useEffect( () => {

		if ( Array.isArray( panelLayout ) && panelLayout.length === 3 ) panelGroupRef.current?.setLayout?.( panelLayout );

	}, [ panelLayout ] );

	useEffect( () => {

		const init = async () => {

		  try {

				await initDatabase();
				log.debug( 'database initialized' );

			} catch ( error ) {

				log.error( 'database initialization failed:', error );

			}

		};

		init();

	}, [] );

	// Global keyboard shortcuts
	useEffect( () => {

		const handleKeyDown = ( event ) => {

			// Ignore shortcuts when typing in input fields
			if ( event.target.tagName === 'INPUT' ||
				 event.target.tagName === 'TEXTAREA' ||
				 event.target.contentEditable === 'true' ) {

				return;

			}

			const noModifiers = ! event.ctrlKey && ! event.altKey && ! event.shiftKey && ! event.metaKey;
			const hasSelection = !! useStore.getState().selectedObject;
			if ( ( event.ctrlKey || event.metaKey ) && event.key.toLowerCase() === 'z' ) {

				event.preventDefault();
				const operation = event.shiftKey ? undoManager.redo() : undoManager.undo();
				operation.catch( error => log.error( 'history operation failed:', error ) );
				return;

			}

			if ( event.ctrlKey && event.key.toLowerCase() === 'y' ) {

				event.preventDefault();
				undoManager.redo().catch( error => log.error( 'redo failed:', error ) );
				return;

			}

			if ( ( event.ctrlKey || event.metaKey ) && event.key.toLowerCase() === 's' ) {

				event.preventDefault();
				projectSession.flush().catch( error => log.error( 'project save failed:', error ) );
				return;

			}

			// Prevent default behavior only for our specific shortcuts
			switch ( event.key ) {

				case 'Escape':
					event.preventDefault();
					handleDeselect();
					break;

				case 'w':
				case 'W':
					if ( noModifiers && hasSelection ) {

						event.preventDefault();
						getApp()?.transformManager.setMode( 'translate' );

					}

					break;

				case 'e':
				case 'E':
					if ( noModifiers && hasSelection ) {

						event.preventDefault();
						getApp()?.transformManager.setMode( 'rotate' );

					}

					break;

				case 'r':
				case 'R':
					if ( noModifiers ) {

						event.preventDefault();
						if ( hasSelection ) {

							getApp()?.transformManager.setMode( 'scale' );

						} else {

							handleResetCamera();

						}

					}

					break;

				case 'f':
				case 'F':
					if ( noModifiers ) {

						event.preventDefault();
						useCameraStore.getState().handleToggleFocusMode();

					}

					break;

				case ' ':
					event.preventDefault();
					handleTogglePlayPause();
					break;

				default:
					break;

			}

		};

		// Keyboard shortcut handlers
		const handleDeselect = () => {

			const app = getApp();
			if ( app ) {

				// Deselect any selected object
				app.interactionManager.deselect();
				app.refreshFrame?.();

				// Update the store to reflect deselection
				const { setSelectedObject } = useStore.getState();
				setSelectedObject( null );

			}

		};

		const handleResetCamera = () => {

			const app = getApp();
			if ( app?.cameraManager?.controls ) {

				// Reset the orbit controls to their default state
				app.cameraManager.controls.reset();

			}

		};

		const handleTogglePlayPause = () => {

			const app = getApp();
			if ( ! app || ! app.pathTracerEnabled ) return;

			const { setIsRendering } = useStore.getState();
			const renderComplete = app.isComplete();

			if ( renderComplete ) {

				// If rendering is complete, always restart
				app.pauseRendering = false;
				setIsRendering( true );
				app.reset();

			} else {

				// If rendering is in progress, toggle pause/resume
				const isCurrentlyPaused = app.pauseRendering;

				if ( isCurrentlyPaused ) {

					// Resume rendering from where it left off
					app.pauseRendering = false;
					setIsRendering( true );

				} else {

					// Pause rendering
					app.pauseRendering = true;
					setIsRendering( false );

				}

			}

		};

		// Add event listener
		window.addEventListener( 'keydown', handleKeyDown );

		// Cleanup
		return () => {

			window.removeEventListener( 'keydown', handleKeyDown );

		};

	}, [] );

	return (
		<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
			<div className="flex flex-col w-screen h-screen">
				<TopBar />
				<div className="admin-plate-download-status"><PlateDownloadStatus onOpen={() => setShowPlateLibrary( true )}/></div>
				{showPlateLibrary && <Suspense fallback={null}><PlateLibraryDialog onClose={() => setShowPlateLibrary( false )}/></Suspense>}
				<ResizablePanelGroup
					ref={panelGroupRef}
					direction="horizontal"
					className="flex flex-1 overflow-hidden h-full"
					onLayout={layout => projectSession.setWorkspace( { panelLayout: layout } )}
				>
					<ResizablePanel onResize={handleResize} className="min-w-[200px]" defaultSize={20}>
						<LeftSidebar />
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel className="min-w-[200px]" defaultSize={60}>
						<ViewportTabs />
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel onResize={handleResize} className="min-w-[200px] h-full" defaultSize={20}>
						<RightSidebar />
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
		</ThemeProvider>
	);

};

export default App;
