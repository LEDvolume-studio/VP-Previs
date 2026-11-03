import { useEffect, useRef, useState } from 'react';
import { Focus, Grid3X3, Ruler, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { projectSession } from '@/services/projects/ProjectSession';

const MODES = [
	[ 'perspective', 'Perspective' ],
	[ 'top', 'Top (+Y)', 'Looking down along −Y' ],
	[ 'front', 'Front (+Z)', 'Facing the front along −Z' ],
	[ 'side', 'Side (+X)', 'Left side, looking along −X' ],
];

const formatMetres = value => {

	if ( ! Number.isFinite( value ) ) return '—';
	if ( Math.abs( value ) >= 1000 || ( Math.abs( value ) > 0 && Math.abs( value ) < 0.001 ) ) return `${value.toExponential( 2 )} m`;
	return `${Number( value.toPrecision( 4 ) )} m`;

};

export default function EditorViewControls( { app, projectId, savedState, onModeChange, rulerEnabled, rulerTemporary, onRulerEnabledChange, onClearRulers } ) {

	const [ state, setState ] = useState( () => ( {
		mode: savedState?.mode || 'perspective',
		style: savedState?.style || 'solid',
		gridSpacing: 1,
		gridVisible: savedState?.gridVisible !== false,
		measurement: null,
	} ) );
	const restoredProjectRef = useRef( null );
	const restoringRef = useRef( false );

	useEffect( () => {

		if ( ! app?.editorViewManager ) return;
		const restoreKey = projectId || 'scratch';
		if ( restoredProjectRef.current === restoreKey ) return;
		restoredProjectRef.current = restoreKey;
		restoringRef.current = true;
		const manager = app.editorViewManager;
		try {

			manager.restoreProjectState( savedState );
			app.setEditorView( manager.mode );
			app.setEditorViewStyle( manager.style );

		} finally {

			restoringRef.current = false;

		}

		setState( {
			...manager.getProjectState(),
			gridSpacing: manager.gridSpacing,
			measurement: app.getEditorMeasurement?.(),
		} );
		onModeChange?.( manager.mode );

	}, [ app, projectId, savedState, onModeChange ] );

	useEffect( () => {

		if ( ! app ) return;
		const handleChange = event => {

			if ( restoringRef.current ) return;
			const next = {
				mode: event.mode,
				style: event.style,
				gridVisible: event.gridVisible,
				views: event.views,
				gridSpacing: event.gridSpacing,
				measurement: event.measurement,
			};
			setState( next );
			onModeChange?.( event.mode );
			projectSession.setWorkspace( {
				editorView: { mode: event.mode, style: event.style, coordinateSystem: event.coordinateSystem, gridVisible: event.gridVisible, views: event.views },
			} );

		};

		const handleSelection = () => setState( current => ( {
			...current,
			measurement: app.getEditorMeasurement?.(),
		} ) );

		app.addEventListener( 'editorViewChanged', handleChange );
		app.addEventListener( 'engine:objectSelected', handleSelection );
		app.addEventListener( 'engine:objectDeselected', handleSelection );
		return () => {

			app.removeEventListener( 'editorViewChanged', handleChange );
			app.removeEventListener( 'engine:objectSelected', handleSelection );
			app.removeEventListener( 'engine:objectDeselected', handleSelection );

		};

	}, [ app, onModeChange ] );

	const changeMode = mode => app?.setEditorView( mode );
	const changeStyle = style => app?.setEditorViewStyle( style );
	const active = state.mode !== 'perspective';

	return (
		<>
			<div className="absolute top-2 left-2 z-30 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 rounded-md border border-border bg-background/90 p-1 shadow-md backdrop-blur">
				{MODES.map( ( [ value, label, title ] ) => (
					<Button
						key={value}
						type="button"
						variant="ghost"
						size="sm"
						className={cn( 'h-7 px-2 text-xs', state.mode === value && 'bg-primary/20 text-primary' )}
						aria-pressed={state.mode === value}
						title={title}
						onClick={() => changeMode( value )}
					>
						{label}
					</Button>
				) )}

				{active && (
					<>
						<div className="mx-1 h-5 w-px bg-border" />
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={cn( 'h-7 px-2 text-xs', state.gridVisible && 'bg-primary/20 text-primary' )}
							aria-pressed={state.gridVisible}
							title="Toggle measurement grid"
							onClick={() => app?.editorViewManager?.setGridVisible( ! state.gridVisible )}
						>
							<Grid3X3 className="mr-1 h-3.5 w-3.5" />Grid
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-xs"
							onClick={() => changeStyle( state.style === 'solid' ? 'wireframe' : 'solid' )}
						>
							<Grid3X3 className="mr-1 h-3.5 w-3.5" />
							{state.style === 'solid' ? 'Solid' : 'Wireframe'}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={cn( 'h-7 px-2 text-xs', ( rulerEnabled || rulerTemporary ) && 'bg-primary/20 text-primary' )}
							aria-pressed={rulerEnabled || rulerTemporary}
							title="Draw ruler · Ctrl or middle mouse while held · Shift for straight line"
							onClick={() => onRulerEnabledChange?.( ! rulerEnabled )}
						>
							<Ruler className="mr-1 h-3.5 w-3.5" />Ruler
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-xs"
							title="Clear all rulers"
							onClick={onClearRulers}
						>
							<Trash2 className="mr-1 h-3.5 w-3.5" />Clear
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-7 w-7"
							title="Frame world"
							onClick={() => app?.frameEditorView()}
						>
							<Focus className="h-3.5 w-3.5" />
						</Button>
					</>
				)}
			</div>

			{active && (
				<div className="pointer-events-none absolute bottom-2 left-2 z-30 rounded-md border border-border bg-background/85 px-3 py-2 text-[11px] leading-5 text-muted-foreground shadow-sm backdrop-blur">
					<div className="text-foreground">Grid {state.gridVisible ? formatMetres( state.gridSpacing ) : 'off'} · 1 unit = 1 metre · Y up</div>
					{state.measurement && (
						<div>
							{state.measurement.label}: X {formatMetres( state.measurement.x )} · Y {formatMetres( state.measurement.y )} · Z {formatMetres( state.measurement.z )}
						</div>
					)}
				</div>
			)}
		</>
	);

}
