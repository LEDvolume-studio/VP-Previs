import { useCallback, useEffect, useState } from 'react';
import { Car, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { MODEL_FILES } from '@/Constants';
import { getApp } from '@/lib/appProxy';
import { useAnimationStore, useStore } from '@/store';
import { AssetLoaderService } from '@/services/AssetLoaderService';
import { restoreVehicleDoorState, setVehicleDoorOpen, vehicleDoorState } from '@/services/VehicleDoorPoseService';
import { restoreVehicleWindowState, setVehicleWindowTransparency, vehicleWindowState, vehicleWindowTransparency } from '@/services/VehicleWindowService';
import { undoManager } from '@/services/UndoManager';
import { projectSession } from '@/services/projects/ProjectSession';
import { MID_SUV_CATALOG_ID, vehicleDoorOpenStates, vehicleDoorPose } from '@/utils/vehicleDoorPoses';

export default function VehiclePosesTab() {

	const [ vehicles, setVehicles ] = useState( [] );
	const [ selectedId, setSelectedId ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( '' );
	const selectedObject = useStore( state => state.selectedObject );
	const loading = useStore( state => state.loading.isLoading );
	const videoRendering = useAnimationStore( state => state.isVideoRendering );
	const refresh = useCallback( () => {

		const roots = ( getApp()?.meshScene?.children || [] ).filter( root => vehicleDoorPose( root ) );
		setVehicles( roots.map( root => ( { id: root.uuid, name: root.userData.__rayzeeName || root.name || 'Vehicle', doors: vehicleDoorOpenStates( root ), transparency: vehicleWindowTransparency( root ) } ) ) );
		setSelectedId( current => roots.some( root => root.uuid === current ) ? current : roots[ 0 ]?.uuid || '' );

	}, [] );
	useEffect( () => {

		refresh();
		const app = getApp();
		window.addEventListener( 'SceneRebuild', refresh );
		app?.addEventListener( 'VehiclePoseChanged', refresh );
		app?.addEventListener( 'VehicleWindowChanged', refresh );
		window.addEventListener( 'MaterialUpdate', refresh );
		app?.addEventListener( 'engine:objectTransformEnd', refresh );
		return () => {

			window.removeEventListener( 'SceneRebuild', refresh );
			app?.removeEventListener( 'VehiclePoseChanged', refresh );
			app?.removeEventListener( 'VehicleWindowChanged', refresh );
			window.removeEventListener( 'MaterialUpdate', refresh );
			app?.removeEventListener( 'engine:objectTransformEnd', refresh );

		};

	}, [ refresh ] );
	useEffect( () => {

		const roots = ( getApp()?.meshScene?.children || [] ).filter( root => vehicleDoorPose( root ) );
		let node = selectedObject;
		while ( node && ! roots.includes( node ) ) node = node.parent;
		if ( node ) setSelectedId( node.uuid );

	}, [ selectedObject ] );
	const disabled = busy || loading || videoRendering;
	const selected = vehicles.find( vehicle => vehicle.id === selectedId );
	const addVehicle = async () => {

		setBusy( true );
		setError( '' );
		try {

			const model = MODEL_FILES.find( item => item.id === MID_SUV_CATALOG_ID );
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

	const toggleDoor = ( side, open ) => {

		const root = getApp()?.getSceneObject( selectedId );
		if ( ! root ) return;
		setError( '' );
		try {

			// Save full hinge transforms so undo also restores a manually adjusted
			// opening angle, rather than guessing a named preset for custom poses.
			const before = vehicleDoorState( root );
			const instanceId = root.userData.__rayzeeProjectInstanceId;
			setVehicleDoorOpen( root, side, open );
			const after = vehicleDoorState( root );
			const restore = values => {

				const app = getApp();
				const target = app?.meshScene?.children.find( item => instanceId ? item.userData.__rayzeeProjectInstanceId === instanceId : item.uuid === root.uuid );
				if ( ! target ) throw new Error( 'The vehicle is no longer in this scene.' );
				restoreVehicleDoorState( target, values );
				projectSession.markDirty();

			};

			undoManager.record( {
				label: 'Change vehicle door pose',
				undo: () => restore( before ),
				redo: () => restore( after ),
			} );
			projectSession.markDirty();
			refresh();

		} catch ( cause ) {

			setError( cause.message );

		}

	};

	const changeTransparency = value => {

		const root = getApp()?.getSceneObject( selectedId );
		if ( ! root ) return;
		setError( '' );
		try {

			const before = vehicleWindowState( root );
			const instanceId = root.userData.__rayzeeProjectInstanceId;
			setVehicleWindowTransparency( root, value );
			const after = vehicleWindowState( root );
			const restore = states => {

				const target = getApp()?.meshScene?.children.find( item => instanceId ? item.userData.__rayzeeProjectInstanceId === instanceId : item.uuid === root.uuid );
				if ( ! target ) throw new Error( 'The vehicle is no longer in this scene.' );
				restoreVehicleWindowState( target, states );
				projectSession.markDirty();

			};

			undoManager.record( {
				label: 'Change window transparency',
				coalesceKey: `vehicle-windows:${instanceId || root.uuid}`,
				undo: () => restore( before ),
				redo: () => restore( after ),
			} );
			projectSession.markDirty();
			refresh();

		} catch ( cause ) {

			setError( cause.message );

		}

	};

	return (
		<div className="p-4 space-y-4">
			<div className="flex items-center gap-2 text-sm font-medium"><Car size={16} />Vehicle door poses</div>
			<Button className="w-full" size="sm" disabled={disabled} onClick={addVehicle}><Plus size={14} className="mr-2" />Add Mid SUV</Button>
			{vehicles.length ? <>
				<label className="block space-y-2 text-xs"><span>Vehicle</span>
					<select aria-label="Vehicle" className="w-full rounded border bg-background p-2" value={selectedId} onChange={event => setSelectedId( event.target.value )} disabled={disabled}>
						{vehicles.map( ( vehicle, index ) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} {index + 1}</option> )}
					</select>
				</label>
				<div className="space-y-2">{[ 'left', 'right' ].map( side => <label key={side} className="flex items-center justify-between gap-3 rounded border p-3 cursor-pointer">
					<span className="text-xs">{side === 'left' ? 'Left door' : 'Right door'}<span className="block text-muted-foreground mt-1">{selected?.doors?.[ side ] ? 'Open' : 'Closed'}</span></span>
					<Switch aria-label={side === 'left' ? 'Left door' : 'Right door'} checked={Boolean( selected?.doors?.[ side ] )} disabled={disabled} onCheckedChange={open => toggleDoor( side, open )} />
				</label> )}</div>
				<p className="text-xs text-muted-foreground">Toggle each front door open or closed. Open doors use 65°. Door poses are saved with the project.</p>
				{selected?.transparency != null ? <div className="space-y-2 border-t pt-4">
					<label htmlFor="vehicle-window-transparency" className="flex items-center justify-between text-xs"><span>Window transparency</span><span>{selected.transparency}%</span></label>
					<input id="vehicle-window-transparency" aria-label="Window transparency" type="range" min="0" max="100" step="1" value={selected.transparency} aria-valuetext={`${selected.transparency}% transparency`} disabled={disabled} onChange={event => changeTransparency( Number( event.target.value ) )} className="w-full accent-primary disabled:opacity-50" />
					<p className="text-xs text-muted-foreground">0% keeps the original glass; 100% hides it. Lights and mirrors stay unchanged.</p>
				</div> : <p className="text-xs text-muted-foreground">Re-add the SUV to adjust its window transparency.</p>}
			</> : <p className="text-xs text-muted-foreground">Add the SUV to open or close each front door independently.</p>}
			{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
		</div>
	);

}
