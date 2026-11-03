import { useRef, useState } from "react";
import StudentDefaultDialog from './StudentDefaultDialog';
import { useToast } from "@/hooks/use-toast";
import { getApp } from '@/lib/appProxy';
import { projectSession } from '@/services/projects/ProjectSession';
import { useProjectStore } from '@/services/projects/projectStore';
import { undoManager } from '@/services/UndoManager';
import { useUndoState } from '@/hooks/useUndoState';
import { useStore } from '@/store';
import {
	Menubar,
	MenubarContent,
	MenubarItem,
	MenubarMenu,
	MenubarSeparator,
	MenubarTrigger,
} from "@/components/ui/menubar";

const MenuBar = ( { onOpenImportModal } ) => {

	const fileInputRef = useRef( null );
	const [ studentDefaultOpen, setStudentDefaultOpen ] = useState( false );
	const { toast } = useToast();
	const setManagerOpen = useProjectStore( state => state.setManagerOpen );
	const defaultProjectId = useProjectStore( state => state.defaultProjectId );
	const { canUndo, canRedo, undoLabel, redoLabel } = useUndoState();
	const runHistoryOperation = operation => {

		operation().catch( error => toast( {
			title: 'History operation failed',
			description: error.message,
			variant: 'destructive',
		} ) );

	};

	const handleOpenFile = () => {

		fileInputRef.current?.click();

	};

	const handleNewProject = async () => {

		try {

			await projectSession.create();

		} catch ( error ) {

			toast( { title: 'Could not create project', description: error.message, variant: 'destructive' } );

		}

	};

	const handleOpenDefaultProject = async () => {

		try {

			const { getAdminPresetService } = await import( '@/services/presets/AdminPresetService.js' );
			await getAdminPresetService().openDefaultProject();

		} catch ( error ) {

			toast( { title: 'Could not open default project', description: error.message, variant: 'destructive' } );

		}

	};

	const handleSaveAsDefault = async () => {

		if ( ! window.confirm( 'Replace the default project with the current scene? Existing working projects will not be changed.' ) ) return;
		try {

			await projectSession.saveCurrentAsDefault();
			toast( { title: 'Default project updated', description: 'Your next change will be saved as a new working project.' } );

		} catch ( error ) {

			toast( { title: 'Could not update default project', description: error.message, variant: 'destructive' } );

		}

	};

	const handleFileSelect = async ( event ) => {

		const file = event.target.files?.[ 0 ];
		if ( ! file ) return;

		// Validate file type
		const supportedFormats = [ '.glb', '.gltf', '.fbx', '.obj', '.stl', '.ply', '.dae', '.3mf', '.usd', '.usda', '.usdc', '.usdz', '.zip', '.tar', '.tgz', '.tar.gz', '.gz' ];
		const fileName = file.name.toLowerCase();
		const isSupported = supportedFormats.some( format => fileName.endsWith( format ) );

		if ( ! isSupported ) {

			toast( {
				title: "Invalid File Type",
				description: "Please select a supported 3D model file (.glb, .gltf, .fbx, .obj, .stl, .ply, .dae, .3mf, .usd, .usda, .usdc, .usdz) or an archive: .zip, .tar, .tar.gz, .tgz (incl. pbrt scenes)",
				variant: "destructive",
			} );
			return;

		}

		try {

			// loadFile dispatches by format (model / archive / environment), so the UI
			// doesn't branch on extension — .zip (OBJ/MTL, pbrt) and direct models all
			// route from one entry point, guarded against a concurrent load.
			const app = getApp();
			if ( app ) {

				await projectSession.enterScratch();
				await app.loadFile( file );

				toast( {
					title: "Model Loaded",
					description: `Successfully loaded ${file.name}`,
				} );

			} else {

				throw new Error( "PathTracer app not initialized" );

			}

		} catch ( error ) {

			if ( error?.code === 'ARCHIVE_NEEDS_ELEMENT' ) {

				useStore.getState().setArchivePrompt( {
					file, elements: error.elements, totalBytes: error.totalBytes
				} );

			} else toast( error?.code === 'LOAD_IN_PROGRESS'
				? {
					title: "Still Loading",
					description: "Wait for the current load to finish, then open the file again.",
				}
				: {
					title: "Error Loading Model",
					description: error.message || "Failed to load model",
					variant: "destructive",
				} );

		} finally {

			// Reset the input so the same file can be selected again
			event.target.value = '';

		}

	};

	return (
		<>
			<StudentDefaultDialog open={studentDefaultOpen} onOpenChange={setStudentDefaultOpen} />
			<input
				ref={fileInputRef}
				type="file"
				accept=".glb,.gltf,.fbx,.obj,.stl,.ply,.dae,.3mf,.usd,.usda,.usdc,.usdz,.zip,.tar,.tgz,.gz"
				onChange={handleFileSelect}
				style={{ display: 'none' }}
			/>
			<Menubar className="h-full border-none bg-none p-0 shadow-none">
				<MenubarMenu>
					<MenubarTrigger className="text-muted-foreground text-sm font-medium hover:text-foreground">File</MenubarTrigger>
					<MenubarContent>
						<MenubarItem onSelect={() => setManagerOpen( true )}>Projects…</MenubarItem>
						<MenubarItem onSelect={handleNewProject}>New Project</MenubarItem>
						<MenubarItem disabled={! defaultProjectId} onSelect={handleOpenDefaultProject}>Open Default Project</MenubarItem>
						<MenubarItem onSelect={() => projectSession.flush()}>Save Project</MenubarItem>
						<MenubarItem onSelect={handleSaveAsDefault}>Save Current Scene as Default Project</MenubarItem>
						<MenubarItem onSelect={() => setStudentDefaultOpen( true )}>Student Default Timeline…</MenubarItem>
						<MenubarItem onSelect={() => {

							window.location.href = '/admin/users/';

						}}>Students and Projects…</MenubarItem>
						<MenubarItem onSelect={() => projectSession.importProject()}>Import Project…</MenubarItem>
						<MenubarItem onSelect={() => projectSession.exportProject()}>Export Project…</MenubarItem>
						<MenubarSeparator />
						{import.meta.env.DEV && <MenubarItem onSelect={handleOpenFile} className="flex items-center">Developer: Open Model…</MenubarItem>}
						{import.meta.env.DEV && <MenubarItem onSelect={onOpenImportModal} className="flex items-center">Developer: Import URL…</MenubarItem>}
					</MenubarContent>
				</MenubarMenu>

				<MenubarMenu>
					<MenubarTrigger className="text-muted-foreground text-sm font-medium hover:text-foreground">Edit</MenubarTrigger>
					<MenubarContent>
						<MenubarItem disabled={! canUndo} onSelect={() => runHistoryOperation( () => undoManager.undo() )} className="flex items-center justify-between gap-6">
							<span>{undoLabel ? `Undo ${undoLabel}` : 'Undo'}</span>
							<span className="text-xs text-muted-foreground">⌘Z</span>
						</MenubarItem>
						<MenubarItem disabled={! canRedo} onSelect={() => runHistoryOperation( () => undoManager.redo() )} className="flex items-center justify-between gap-6">
							<span>{redoLabel ? `Redo ${redoLabel}` : 'Redo'}</span>
							<span className="text-xs text-muted-foreground">⇧⌘Z</span>
						</MenubarItem>
						<MenubarSeparator />
						<MenubarItem disabled className="flex items-center">Copy</MenubarItem>
						<MenubarItem disabled className="flex items-center">Paste</MenubarItem>
					</MenubarContent>
				</MenubarMenu>

				<MenubarMenu>
					<MenubarTrigger className="text-muted-foreground text-sm font-medium hover:text-foreground">View</MenubarTrigger>
					<MenubarContent>
						<MenubarItem disabled className="flex items-center">Zoom In</MenubarItem>
						<MenubarItem disabled className="flex items-center">Zoom Out</MenubarItem>
						<MenubarItem disabled className="flex items-center">Reset View</MenubarItem>
					</MenubarContent>
				</MenubarMenu>
			</Menubar>
		</>
	);

};

export default MenuBar;
