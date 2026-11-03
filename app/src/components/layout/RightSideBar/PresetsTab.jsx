import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Camera, Check, Image, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAnimationStore, useStore } from '@/store';
import { getAdminPresetService } from '@/services/presets/AdminPresetService.js';
import AdminPlateControls from '@/components/plates/AdminPlateControls.jsx';

export default function PresetsTab() {

	const [ service ] = useState( getAdminPresetService );
	const subscribe = useCallback( listener => service.subscribe( listener ), [ service ] );
	const getSnapshot = useCallback( () => service.getState(), [ service ] );
	const state = useSyncExternalStore( subscribe, getSnapshot, getSnapshot );
	const [ name, setName ] = useState( '' );
	const [ actionError, setActionError ] = useState( '' );
	const [ removing, setRemoving ] = useState( false );
	const loading = useStore( value => value.loading.isLoading );
	const videoRendering = useAnimationStore( value => value.isVideoRendering );
	const plateState = useSyncExternalStore( service.plates.subscribe, service.plates.getSnapshot );
	const selected = state.presets.find( preset => preset.presetId === state.selectedPresetId );
	const disabled = Boolean( state.busy || plateState.busy || loading || videoRendering );
	const editingDisabled = disabled || state.retryPending;
	const trimmedName = name.trim();
	const run = useCallback( async action => {

		setActionError( '' );
		try {

			await action();

		} catch ( cause ) {

			setActionError( cause?.message || 'Unable to update the preset.' );

		}

	}, [] );

	useEffect( () => {

		run( () => service.refresh() );

	}, [ service, run ] );
	useEffect( () => {

		setName( selected?.name || '' );

	}, [ selected?.presetId, selected?.name ] );

	return (
		<div className="p-4 space-y-4" aria-busy={Boolean( state.busy )}>
			<div className="flex items-center justify-between gap-2">
				<h2 className="flex items-center gap-2 text-sm font-medium"><Camera size={16} />{state.sharedLibrary ? 'Student presets' : 'Project presets'}</h2>
				<Button variant="ghost" size="icon" title="Refresh presets" aria-label="Refresh presets" disabled={disabled} onClick={() => run( () => service.refresh() )}><RefreshCw size={14} /></Button>
			</div>
			<p className="text-xs text-muted-foreground">{state.sharedLibrary ? 'These are the presets shown in the student editor. Select a preset to edit its scene, camera framing and plate angle. Changes update the shared student library.' : 'Select a preset to apply object positions, visibility and camera framing. Open the student default project to manage the presets shown in the student editor.'}</p>
			{! state.sharedLibrary && <Button className="w-full" variant="outline" size="sm" disabled={editingDisabled} onClick={() => run( () => service.openDefaultProject() )}>Open student default project</Button>}
			{state.retryPending && <div className="space-y-2 rounded border border-primary/50 p-3">
				<p className="text-xs">The previous save needs confirmation. Retrying uses its original scene and thumbnail; your current scene stays as it is.</p>
				<Button className="w-full" size="sm" disabled={disabled} onClick={() => run( () => service.retryPendingSave() )}><RefreshCw size={14} className="mr-2" />Retry previous preset save</Button>
			</div>}
			{state.presets.length ? <div className="grid grid-cols-2 gap-2" role="group" aria-label="Student presets">
				{state.presets.map( preset => {

					const active = preset.presetId === state.selectedPresetId;
					return (
						<div key={preset.presetId} className="relative min-w-0">
							<button type="button" disabled={editingDisabled} aria-pressed={active} aria-label={`Apply ${preset.name}`} onClick={() => run( () => service.selectPreset( preset.presetId ) )} className={`relative w-full min-w-0 overflow-hidden rounded border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${active ? 'border-primary ring-1 ring-primary bg-primary/10' : 'border-border hover:bg-accent'}`}>
								{preset.thumbnailUrl ? <img src={preset.thumbnailUrl} alt="" className="aspect-video w-full object-cover bg-muted" /> : <span className="aspect-video flex w-full items-center justify-center bg-muted text-muted-foreground"><Image size={24} /></span>}
								{active && <span className="absolute right-1 top-1 rounded-full bg-primary p-1 text-primary-foreground"><Check size={12} /></span>}
								<span className="block truncate p-2 pr-9 text-xs" title={preset.name}>{preset.name}</span>
							</button>
							<Button type="button" variant="ghost" size="icon" className="absolute bottom-0 right-0 h-8 w-8 text-muted-foreground hover:text-destructive" title={`Delete preset ${preset.name}`} aria-label={`Delete preset ${preset.name}`} disabled={editingDisabled} onClick={() => setRemoving( preset )}><Trash2 size={13}/></Button>
						</div>
					);

				} )}
			</div> : <p className="rounded border p-3 text-xs text-muted-foreground">{state.sharedLibrary ? 'No student presets yet. Save the current scene as a new preset.' : 'No presets saved in this project. Open the student default project above to edit the student presets.'}</p>}
			{removing && <div role="alertdialog" aria-label="Delete preset confirmation" className="rounded border border-destructive/50 p-3 space-y-2">
				<p className="text-xs">Delete “{removing.name}” from the student preset library? Existing student shots will be kept.</p>
				<div className="flex gap-2">
					<Button variant="destructive" size="sm" disabled={editingDisabled} onClick={() => run( async () => {

						await service.removePreset( removing.presetId ); setRemoving( false );

					} )}>Confirm deletion</Button>
					<Button variant="outline" size="sm" disabled={editingDisabled} onClick={() => setRemoving( false )}>Cancel</Button>
				</div>
			</div>}
			<div className="space-y-3 border-t pt-4">
				<AdminPlateControls service={service} disabled={editingDisabled}/>
				{selected && <p className="text-xs text-muted-foreground">Editing <span className="font-medium text-foreground">{selected.name}</span>{selected.revision != null ? ` · revision ${selected.revision}` : ''}</p>}
				<label className="block space-y-2 text-xs" htmlFor="admin-preset-name">
					<span>Preset name</span>
					<Input id="admin-preset-name" value={name} maxLength={160} placeholder="Name this preset" disabled={editingDisabled} onChange={event => setName( event.target.value )} />
				</label>
				{selected && <Button className="w-full" variant="outline" size="sm" disabled={editingDisabled || ! trimmedName || trimmedName === selected.name} onClick={() => run( () => service.renamePreset( selected.presetId, trimmedName ) )}>Rename preset</Button>}
				<Button className="w-full" size="sm" disabled={editingDisabled || ! selected || ! trimmedName} onClick={() => run( () => service.saveCurrent( { name: trimmedName, asNew: false } ) )}><Save size={14} className="mr-2" />Update preset</Button>
				<Button className="w-full" variant="outline" size="sm" disabled={editingDisabled || ! trimmedName} onClick={() => run( () => service.saveCurrent( { name: trimmedName, asNew: true } ) )}><Plus size={14} className="mr-2" />Save new preset</Button>
				{selected && <Button className="w-full" variant="outline" size="sm" disabled={editingDisabled} onClick={() => setRemoving( selected )}><Trash2 size={14} className="mr-2" />Delete preset</Button>}
				<p className="text-xs text-muted-foreground">Saving records positions, visibility and camera framing, generates a thumbnail and updates the student preset library. Add or remove objects at the project level.</p>
			</div>
			{( actionError || state.error ) && <p role="alert" className="text-xs text-destructive">{actionError || state.error}</p>}
			{state.status && <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{state.status}</p>}
		</div>
	);

}
