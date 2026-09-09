import { useMemo, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import { useStore, usePathTracerStore } from '@/store';
import AuthProvider from './AuthProvider';
import MenuBar from './MenuBar';
import ViewportTabs from './ViewportTabs';
import ActionBar from './ActionBar';
import { useImportUrl } from '@/hooks/use-import-url';
import { useProjectStore } from '@/services/projects/projectStore';
import ProjectManagerDialog from './ProjectManagerDialog';
import { Button } from '@/components/ui/button';

// Lazy load the ImportUrlModal since it's only used when opening import dialog
const ImportUrlModal = lazy( () => import( './ImportUrlModal' ) );

// Loading fallback for modal
const ModalLoadingFallback = () => (
	<div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
		<div className="bg-background rounded-lg p-6 shadow-lg">
			<div className="flex items-center space-x-3">
				<div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full"></div>
				<span className="text-sm">Loading...</span>
			</div>
		</div>
	</div>
);

const TopBar = () => {

	// Store subscriptions
	const appMode = useStore( state => state.appMode );
	const setAppMode = useStore( state => state.setAppMode );
	const handleModeChange = usePathTracerStore( state => state.handleModeChange );
	const project = useProjectStore( state => state.activeProject );
	const projectStatus = useProjectStore( state => state.status );
	const missingMedia = useProjectStore( state => state.missingMedia );
	const warnings = useProjectStore( state => state.warnings );
	const setManagerOpen = useProjectStore( state => state.setManagerOpen );
	const statusLabel = projectStatus === 'saving' ? 'Saving…' : projectStatus === 'dirty' ? 'Unsaved' : projectStatus === 'error' ? 'Save failed' : projectStatus === 'scratch' ? 'Scratch · not saved' : missingMedia.length ? `${missingMedia.length} video${missingMedia.length === 1 ? '' : 's'} missing` : warnings.length ? `${warnings.length} asset warning${warnings.length === 1 ? '' : 's'}` : 'Saved';

	// Ref for appMode to keep handleTabChange stable
	const appModeRef = useRef( appMode );
	useEffect( () => {

		appModeRef.current = appMode;

	}, [ appMode ] );

	// Use custom hooks
	const {
		modalState,
		openImportModal,
		closeImportModal,
		setImportUrl,
		handleImportFromUrl
	} = useImportUrl();

	// Handle tab change — stable callback (no appMode in deps)
	const handleTabChange = useCallback( ( value ) => {

		if ( value !== appModeRef.current ) {

			handleModeChange( value );
			setAppMode( value );

		}

	}, [ setAppMode, handleModeChange ] );

	// Handle GitHub redirect
	const handleGithubRedirection = useCallback( () => {

		window.open( 'https://github.com/atul-mourya/RayTracing', '_blank' );

	}, [] );

	// Memoize the logo
	const logo = useMemo( () => (
		<div className="flex items-center space-x-2 mr-4 px-2">
			<span className="font-semibold">Rayzee</span>
		</div>
	), [] );

	return (
		<AuthProvider>
			{ ( { user, handleLoginClick, handleSignOut } ) => (
				<div className="flex items-center h-10 border-b">
					{logo}
					<MenuBar onOpenImportModal={openImportModal} />
					<Button variant="ghost" size="sm" className="h-8 max-w-[260px] flex-col items-start gap-0 px-2" onClick={() => setManagerOpen( true )}>
						<span className="max-w-[230px] truncate text-xs">{project?.name || 'Loading project…'}</span>
						<span className={`text-[9px] font-normal ${projectStatus === 'error' || missingMedia.length ? 'text-amber-500' : 'text-muted-foreground'}`}>{statusLabel}</span>
					</Button>

					<div className="grow" />
					<ViewportTabs currentMode={appMode} onModeChange={handleTabChange} />
					<div className="grow" />

					<ActionBar
						user={user}
						onLoginClick={handleLoginClick}
						onSignOut={handleSignOut}
						onGithubClick={handleGithubRedirection}
					/>

					<Suspense fallback={<ModalLoadingFallback />}>
						<ImportUrlModal
							isOpen={modalState.isImportModalOpen}
							onClose={closeImportModal}
							importUrl={modalState.importUrl}
							setImportUrl={setImportUrl}
							onImport={handleImportFromUrl}
							isImporting={modalState.isImporting}
						/>
					</Suspense>
					<ProjectManagerDialog />
				</div>
			) }
		</AuthProvider>
	);

};

export default TopBar;
