import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { getApp } from '@/lib/appProxy';
import { readObjectAttributes, editObjectAttribute } from '@/utils/objectAttributes';
import MaterialTab from './MaterialTab';

const AXES = [ 'x', 'y', 'z' ];
const format = value => Number( value.toFixed( 6 ) ).toString();

function AttributeInput( { object, property, axis, value } ) {

	const [ draft, setDraft ] = useState( null );
	const [ invalid, setInvalid ] = useState( false );
	const commit = () => {

		if ( draft === null ) return;
		const number = draft.trim() === '' ? NaN : Number( draft );
		const success = editObjectAttribute( getApp(), object, property, axis, number );
		setInvalid( ! success );
		if ( success ) setDraft( null );

	};

	return (
		<label className="flex items-center gap-1 min-w-0 text-xs">
			<span className="text-muted-foreground uppercase">{axis}</span>
			<input
				type="text" inputMode="decimal" aria-label={`${property} ${axis.toUpperCase()}`}
				aria-invalid={invalid} value={draft ?? format( value )}
				className="w-full min-w-0 rounded border bg-background px-1 py-1 tabular-nums aria-[invalid=true]:border-destructive"
				onChange={event => {

					setDraft( event.target.value ); setInvalid( false );

				}}
				onBlur={commit}
				onKeyDown={event => {

					event.stopPropagation();
					if ( event.key === 'Enter' ) event.currentTarget.blur();
					if ( event.key === 'Escape' ) {

						setDraft( null ); setInvalid( false );

					}

				}}
			/>
		</label>
	);

}

function ObjectAttributes( { object } ) {

	const [ values, setValues ] = useState( () => readObjectAttributes( object ) );
	useEffect( () => {

		// Three.js objects mutate in place, including on gizmo drag and undo/redo.
		// Only measure geometry when the subtree's world matrices change.
		let previous = '';
		const refresh = () => {

			object.updateWorldMatrix( true, true );
			const matrices = [];
			object.traverse( node => matrices.push( node.uuid, ...node.matrixWorld.elements ) );
			const signature = matrices.join( ',' );
			if ( signature !== previous ) {

				previous = signature;
				setValues( readObjectAttributes( object ) );

			}

		};

		refresh();
		const timer = window.setInterval( refresh, 200 );
		return () => window.clearInterval( timer );

	}, [ object ] );

	return (
		<section className="p-3 space-y-3 border-b shrink-0" aria-label="Object attributes">
			<div className="text-sm font-medium truncate" title={object.name}>{object.name || object.type}</div>
			<p className="text-xs text-muted-foreground">Position, rotation and scale are relative to the parent folder. Folder edits affect all descendants.</p>
			{[[ 'position', 'Position (m)' ], [ 'rotation', `Rotation (° · ${object.rotation.order})` ], [ 'scale', 'Scale (multiplier)' ]].map( ( [ property, label ] ) => (
				<div key={property} className="space-y-1">
					<div className="text-xs font-medium">{label}</div>
					<div className="grid grid-cols-3 gap-2">
						{AXES.map( ( axis, index ) => <AttributeInput key={axis} object={object} property={property} axis={axis} value={values[ property ][ index ]} /> )}
					</div>
				</div>
			) )}
			<div className="space-y-1">
				<div className="text-xs font-medium">Size (m · world bounds)</div>
				<div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
					{AXES.map( ( axis, index ) => <div key={axis}><span className="uppercase text-muted-foreground">{axis}</span> {values.size ? format( values.size[ index ] ) : '—'}</div> )}
				</div>
				<p className="text-xs text-muted-foreground">Includes nested and hidden geometry. World-aligned size changes with rotation. Use scale to resize. 1 world unit = 1 metre.</p>
			</div>
		</section>
	);

}

export default function AttributesTab() {

	const object = useStore( state => state.selectedObject );
	if ( ! object ) return <p className="p-4 text-sm text-muted-foreground">Select a mesh or folder to view its attributes.</p>;
	if ( object.isLight ) return <p className="p-4 text-sm text-muted-foreground">Use the Light tab to edit this light.</p>;
	return (
		<div className="flex flex-col">
			<ObjectAttributes key={object.uuid} object={object} />
			{object.isMesh && <MaterialTab />}
		</div>
	);

}
