import { useState } from 'react';
import { Copy, Download, FolderOpen, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { projectSession } from '@/services/projects/ProjectSession';
import { useProjectStore } from '@/services/projects/projectStore';
import { useToast } from '@/hooks/use-toast';

const ProjectManagerDialog = () => {

	const { toast } = useToast();
	const [ busy, setBusy ] = useState( false );
	const open = useProjectStore( state => state.managerOpen );
	const setOpen = useProjectStore( state => state.setManagerOpen );
	const projects = useProjectStore( state => state.projects );
	const activeId = useProjectStore( state => state.activeProject?.projectId );
	const defaultProjectId = useProjectStore( state => state.defaultProjectId );
	const missingMedia = useProjectStore( state => state.missingMedia );
	const warnings = useProjectStore( state => state.warnings );

	const run = async action => {

		setBusy( true );
		try {

			await action();

		} catch ( error ) {

			if ( error?.name !== 'AbortError' ) toast( { title: 'Project operation failed', description: error.message, variant: 'destructive' } );

		} finally {

			setBusy( false );

		}

	};

	const createProject = () => {

		const name = window.prompt( 'Project name', 'Untitled Project' );
		if ( name ) run( async () => {

			await projectSession.create( name ); setOpen( false );

		} );

	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Projects</DialogTitle>
					<DialogDescription>Projects autosave in this browser. Export a manifest for backup or transfer.</DialogDescription>
				</DialogHeader>
				<div className="flex gap-2">
					<Button size="sm" disabled={busy} onClick={createProject}><Plus size={14} className="mr-1" />New</Button>
					<Button size="sm" variant="outline" disabled={busy} onClick={() => run( () => projectSession.importProject() )}><Upload size={14} className="mr-1" />Import</Button>
				</div>
				<div className="max-h-[55vh] space-y-2 overflow-y-auto">
					{projects.map( project => (
						<div key={project.projectId} className={`flex items-center gap-2 rounded-md border p-3 ${project.projectId === activeId ? 'border-primary bg-primary/5' : ''}`}>
							<button className="min-w-0 flex-1 text-left" disabled={busy || project.projectId === activeId} onClick={() => run( async () => {

								await projectSession.switchTo( project.projectId ); setOpen( false );

							} )}>
								<p className="truncate text-sm font-medium">{project.name}{project.projectId === defaultProjectId ? ' · Default' : ''}</p>
								<p className="text-[10px] text-muted-foreground">Revision {project.revision} · {new Date( project.updatedAt ).toLocaleString()}</p>
							</button>
							<Button size="icon" variant="ghost" title="Open" disabled={busy || project.projectId === activeId} onClick={() => run( async () => {

								await projectSession.switchTo( project.projectId ); setOpen( false );

							} )}><FolderOpen size={14} /></Button>
							<Button size="icon" variant="ghost" title="Rename" disabled={busy || project.projectId === defaultProjectId} onClick={() => {

								const name = window.prompt( 'Project name', project.name ); if ( name ) run( () => projectSession.rename( project.projectId, name ) );

							}}><Pencil size={14} /></Button>
							<Button size="icon" variant="ghost" title="Duplicate" disabled={busy} onClick={() => run( () => projectSession.duplicate( project.projectId ) )}><Copy size={14} /></Button>
							<Button size="icon" variant="ghost" title="Export" disabled={busy} onClick={() => run( () => projectSession.exportProject( project.projectId ) )}><Download size={14} /></Button>
							<Button size="icon" variant="ghost" title="Delete" disabled={busy || project.projectId === defaultProjectId} onClick={() => {

								if ( window.confirm( `Delete “${project.name}” from this browser?` ) ) run( () => projectSession.delete( project.projectId ) );

							}}><Trash2 size={14} /></Button>
						</div>
					) )}
				</div>
				{( missingMedia.length > 0 || warnings.length > 0 ) && (
					<div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
						<p className="font-medium">Project needs attention</p>
						{missingMedia.map( item => <p key={item.wallInstanceId} className="mt-1 text-muted-foreground">Video: {item.video.name} — select its LED wall and choose Reconnect video.</p> )}
						{warnings.map( warning => <p key={warning} className="mt-1 text-muted-foreground">{warning}</p> )}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);

};

export default ProjectManagerDialog;
