import { useCallback, useEffect, useState } from 'react';
import { Plus, PersonStanding } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import VehiclePosesTab from './VehiclePosesTab';
import { getApp } from '@/lib/appProxy';
import { useAnimationStore, useStore } from '@/store';
import { MODEL_FILES } from '@/Constants';
import { AssetLoaderService } from '@/services/AssetLoaderService';
import { setMannequinPose } from '@/services/MannequinPoseService';
import { projectSession } from '@/services/projects/ProjectSession';
import { undoManager } from '@/services/UndoManager';
import { MANNEQUIN_CATALOG_ID, MANNEQUIN_POSES, mannequinPose } from '@/utils/mannequinPoses';

function MannequinPosesTab() {

	const [ characters, setCharacters ] = useState( [] );
	const [ selectedId, setSelectedId ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( '' );
	const loading = useStore( state => state.loading.isLoading );
	const selectedObject = useStore( state => state.selectedObject );
	const videoRendering = useAnimationStore( state => state.isVideoRendering );
	const refresh = useCallback( () => {

		const roots = ( getApp()?.meshScene?.children || [] ).filter( root => mannequinPose( root ) );
		setCharacters( roots.map( root => ( { id: root.uuid, name: root.userData.__rayzeeName || root.name || 'Mannequin', pose: mannequinPose( root ) } ) ) );
		setSelectedId( current => roots.some( root => root.uuid === current ) ? current : roots[ 0 ]?.uuid || '' );

	}, [] );
	useEffect( () => {

		const roots = ( getApp()?.meshScene?.children || [] ).filter( root => mannequinPose( root ) );
		let selected = selectedObject;
		while ( selected && ! roots.includes( selected ) ) selected = selected.parent;
		if ( selected ) setSelectedId( selected.uuid );

	}, [ selectedObject ] );
	useEffect( () => {

		refresh();
		window.addEventListener( 'SceneRebuild', refresh );
		const app = getApp();
		app?.addEventListener( 'MannequinPoseChanged', refresh );
		return () => {

			window.removeEventListener( 'SceneRebuild', refresh );
			app?.removeEventListener( 'MannequinPoseChanged', refresh );

		};

	}, [ refresh ] );
	const selected = characters.find( item => item.id === selectedId );
	const disabled = busy || loading || videoRendering;

	const addCharacter = async () => {

		setBusy( true );
		setError( '' );
		try {

			const model = MODEL_FILES.find( item => item.id === MANNEQUIN_CATALOG_ID );
			const result = await AssetLoaderService.addModel( model.url, model.name, model.id, model.assetVersion );
			setSelectedId( result.id );
			projectSession.markDirty();
			refresh();

		} catch ( cause ) {

			setError( cause.message );

		} finally {

			setBusy( false );

		}

	};

	const choosePose = async pose => {

		const app = getApp();
		const root = app?.getSceneObject( selectedId );
		if ( ! root || ! selected || selected.pose === pose ) return;
		setBusy( true );
		setError( '' );
		try {

			const previous = mannequinPose( root );
			const instanceId = root.userData.__rayzeeProjectInstanceId;
			await projectSession.withPreservedUndoHistory( () => setMannequinPose( root, pose ) );
			const restore = async value => {

				const target = getApp()?.meshScene?.children.find( item => instanceId
					? item.userData.__rayzeeProjectInstanceId === instanceId
					: item.uuid === root.uuid );
				if ( ! target ) throw new Error( 'The mannequin is no longer in this scene.' );
				await projectSession.withPreservedUndoHistory( () => setMannequinPose( target, value ) );
				projectSession.markDirty();

			};

			undoManager.record( { label: 'Change mannequin pose', undo: () => restore( previous ), redo: () => restore( pose ) } );
			projectSession.markDirty();
			refresh();

		} catch ( cause ) {

			setError( cause.message );

		} finally {

			setBusy( false );

		}

	};

	return (
		<>
			<Separator className="bg-primary" />
			<div className="p-4 space-y-4">
				<div className="flex items-center gap-2 text-sm font-medium"><PersonStanding size={16} />Mannequin poses</div>
				<Button className="w-full" size="sm" onClick={addCharacter} disabled={disabled}><Plus size={14} className="mr-2" />Add mannequin</Button>
				{characters.length > 0 ? (
					<>
						<label className="block space-y-2 text-xs">
							<span>Mannequin</span>
							<select aria-label="Mannequin" className="w-full rounded border bg-background p-2" value={selectedId} onChange={event => setSelectedId( event.target.value )} disabled={disabled}>
								{characters.map( ( item, index ) => <option key={item.id} value={item.id}>{item.name} {index + 1}</option> )}
							</select>
						</label>
						<div className="grid grid-cols-2 gap-2">
							{MANNEQUIN_POSES.map( pose => (
								<Button key={pose.id} variant={selected?.pose === pose.id ? 'default' : 'outline'} aria-pressed={selected?.pose === pose.id} disabled={disabled} className="h-auto flex-col gap-2 p-2" onClick={() => choosePose( pose.id )}>
									<img src={`${import.meta.env.BASE_URL}characters/mannequin/${pose.id}.png`} alt="" className="aspect-square w-full rounded object-cover" />
									<span className="text-xs">{pose.label}</span>
								</Button>
							) )}
						</div>
						<p className="text-xs text-muted-foreground">Poses keep the feet on the floor. Move the seated mannequin beside your chair using the transform controls.</p>
					</>
				) : <p className="text-xs text-muted-foreground">Add a mannequin to the current scene, then choose its pose.</p>}
				{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
			</div>
		</>
	);

}

export default function PosesTab() {

	return (
		<Tabs defaultValue="people" className="flex flex-col">
			<TabsList className="grid grid-cols-2 m-2">
				<TabsTrigger value="people">People</TabsTrigger>
				<TabsTrigger value="vehicles">Vehicles</TabsTrigger>
			</TabsList>
			<TabsContent value="people" className="mt-0"><MannequinPosesTab /></TabsContent>
			<TabsContent value="vehicles" className="mt-0"><VehiclePosesTab /></TabsContent>
		</Tabs>
	);

}
