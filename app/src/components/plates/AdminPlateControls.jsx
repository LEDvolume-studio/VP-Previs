import { useEffect, useState, useSyncExternalStore, lazy, Suspense } from 'react';
import { Button } from '../ui/button';
import PlateDownloadStatus from './PlateDownloadStatus.jsx';

const PlateLibraryDialog = lazy( () => import( './PlateLibraryDialog.jsx' ) );

export default function AdminPlateControls( { service, disabled } ) {

	const plates = service.plates;
	const state = useSyncExternalStore( plates.subscribe, plates.getSnapshot );
	const [ error, setError ] = useState( '' ), [ showLibrary, setShowLibrary ] = useState( false );
	const run = async action => {

		setError( '' ); try {

			await action();

		} catch ( failure ) {

			setError( failure.message );

		}

	};

	useEffect( () => {

		const refresh = () => plates.refresh().catch( failure => setError( failure.message ) );
		refresh(); window.addEventListener( 'focus', refresh ); window.addEventListener( 'project:hydrated', refresh );
		const channel = new BroadcastChannel( 'rayzee-plate-library' ); channel.onmessage = refresh;
		return () => {

			window.removeEventListener( 'focus', refresh ); window.removeEventListener( 'project:hydrated', refresh ); channel.close();

		};

	}, [ plates ] );
	const locked = disabled || state.busy;
	return <section className="space-y-3 border-t pt-4" aria-label="Preset driving plate">
		<h3 className="text-sm font-medium">Driving plate</h3>
		{state.walls.length > 1 && <label className="block space-y-1 text-xs">LED wall<select className="w-full rounded border bg-background p-2 text-foreground" aria-label="Driving plate LED wall" value={state.wallId} disabled={locked} onChange={event => run( () => plates.selectWall( event.target.value ) )}>{state.walls.map( wall => <option key={wall.id} value={wall.id}>{wall.name}</option> )}</select></label>}
		<Button className="w-full" size="sm" disabled={locked || ! state.walls.length} onClick={() => setShowLibrary( true )}>Select Driving Plates</Button>
		{state.setId && <p className="text-xs text-muted-foreground">{state.sets.find( item => item.id === state.setId )?.name || 'Selected plate set'}</p>}
		<PlateDownloadStatus onOpen={() => setShowLibrary( true )}/>
		{showLibrary && <Suspense fallback={null}><PlateLibraryDialog onClose={() => setShowLibrary( false )} onSelect={async manifest => {

			await plates.refresh(); await plates.selectSet( manifest.id ); setShowLibrary( false );

		}}/></Suspense>}
		<div className="grid grid-cols-2 gap-2" role="group" aria-label="Driving plate angle">{[ 'front', 'left', 'right', 'rear' ].map( view => <Button key={view} size="sm" variant={state.view === view ? 'default' : 'outline'} aria-pressed={state.view === view} aria-label={`Plate angle ${view}`} disabled={locked} onClick={() => run( () => plates.setView( view ) )}>{view[ 0 ].toUpperCase() + view.slice( 1 )}</Button> )}</div>
		{state.setId && <Button className="w-full" variant="outline" size="sm" disabled={locked} onClick={() => run( () => plates.togglePlayback() )}>{state.playing ? 'Pause plate' : 'Play plate'}</Button>}
		<p className="text-xs text-muted-foreground">Update or save the preset to remember this angle. Switching plate sets keeps the selected angle.</p>
		{! state.walls.length && <p className="text-xs text-muted-foreground">Add an LED wall to play a plate in the scene.</p>}
		{state.busy && <p role="status" className="text-xs text-muted-foreground">Preparing plate view…</p>}
		{( error || state.error ) && <p role="alert" className="text-xs text-destructive">{error || state.error}</p>}
	</section>;

}
