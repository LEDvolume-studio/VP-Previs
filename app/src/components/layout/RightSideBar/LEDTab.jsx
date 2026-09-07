import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Trash2, Upload, Video } from 'lucide-react';
import { useStore } from '@/store';
import { getApp } from '@/lib/appProxy';
import { LEDVideoManager, resolveLEDAssetRoot } from '@/services/LEDVideoManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

const formatTime = seconds => {

	if ( ! Number.isFinite( seconds ) ) return '00:00.000';
	const minutes = Math.floor( seconds / 60 );
	const remainder = seconds - minutes * 60;
	return `${String( minutes ).padStart( 2, '0' )}:${remainder.toFixed( 3 ).padStart( 6, '0' )}`;

};

const NumericField = ( { label, value, step = 0.01, onChange } ) => (
	<label className="space-y-1 text-[10px] text-muted-foreground">
		<span>{label}</span>
		<Input
			type="number"
			value={Number.isFinite( value ) ? Number( value.toFixed( 4 ) ) : 0}
			step={step}
			onChange={event => onChange( Number( event.target.value ) )}
			className="h-7 px-2 text-xs text-foreground"
		/>
	</label>
);

const PlacementEditor = ( { snapshot } ) => {

	const rootId = snapshot.rootId;
	const metadata = snapshot.metadata;
	const placement = metadata.videoPlacementTransform;
	const canvasRef = useRef( null );
	const interactionRef = useRef( null );

	const beginInteraction = useCallback( ( event, mode ) => {

		event.preventDefault();
		event.stopPropagation();
		const bounds = canvasRef.current?.getBoundingClientRect();
		if ( ! bounds ) return;
		interactionRef.current = {
			mode,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			bounds,
			position: { ...placement.position },
			scale: { ...placement.scale },
			rotation: placement.rotationDegrees,
		};
		event.currentTarget.setPointerCapture( event.pointerId );

	}, [ placement ] );

	const moveInteraction = useCallback( event => {

		const state = interactionRef.current;
		if ( ! state || state.pointerId !== event.pointerId ) return;
		const dx = event.clientX - state.startX;
		const dy = event.clientY - state.startY;

		if ( state.mode === 'drag' ) {

			LEDVideoManager.setPlacement( rootId, {
				position: {
					x: state.position.x + dx / state.bounds.width,
					y: state.position.y + dy / state.bounds.height,
				},
			}, { commit: false } );

		} else if ( state.mode === 'resize' ) {

			const angle = state.rotation * Math.PI / 180;
			const cosine = Math.cos( angle );
			const sine = Math.sin( angle );
			const localDx = cosine * dx + sine * dy;
			const localDy = - sine * dx + cosine * dy;
			if ( placement.aspectRatioLocked ) {

				const handleX = state.scale.x * state.bounds.width / 2;
				const handleY = state.scale.y * state.bounds.height / 2;
				const factor = Math.max( 0.02, 1 + ( localDx * handleX + localDy * handleY ) / Math.max( 1, handleX ** 2 + handleY ** 2 ) );
				LEDVideoManager.setPlacement( rootId, {
					scale: { x: state.scale.x * factor, y: state.scale.y * factor },
					fitMode: 'custom',
				}, { commit: false } );

			} else {

				LEDVideoManager.setPlacement( rootId, {
					scale: {
						x: Math.max( 0.02, state.scale.x + 2 * localDx / state.bounds.width ),
						y: Math.max( 0.02, state.scale.y + 2 * localDy / state.bounds.height ),
					},
					fitMode: 'custom',
				}, { commit: false } );

			}

		} else if ( state.mode === 'rotate' ) {

			const centreX = state.bounds.left + placement.position.x * state.bounds.width;
			const centreY = state.bounds.top + placement.position.y * state.bounds.height;
			const rotation = Math.atan2( event.clientY - centreY, event.clientX - centreX ) * 180 / Math.PI + 90;
			LEDVideoManager.setPlacement( rootId, { rotationDegrees: rotation, fitMode: 'custom' }, { commit: false } );

		}

	}, [ placement.aspectRatioLocked, placement.position.x, placement.position.y, rootId ] );

	const endInteraction = useCallback( event => {

		if ( interactionRef.current?.pointerId !== event.pointerId ) return;
		interactionRef.current = null;
		event.currentTarget.releasePointerCapture?.( event.pointerId );
		LEDVideoManager.setPlacement( rootId, {}, { commit: true } );

	}, [ rootId ] );

	const setScaleAxis = useCallback( ( axis, value ) => {

		const next = Math.max( 0.0001, value );
		if ( placement.aspectRatioLocked ) {

			const factor = next / Math.max( 0.0001, placement.scale[ axis ] );
			LEDVideoManager.setPlacement( rootId, {
				scale: { x: placement.scale.x * factor, y: placement.scale.y * factor },
				fitMode: 'custom',
			} );

		} else {

			LEDVideoManager.setPlacement( rootId, { scale: { [ axis ]: next }, fitMode: 'custom' } );

		}

	}, [ placement, rootId ] );

	return (
		<section className="space-y-3">
			<div className="flex items-end justify-between">
				<div>
					<h3 className="text-sm font-medium">2D placement</h3>
					<p className="text-[10px] text-muted-foreground">
						{metadata.nativeCanvas.width} × {metadata.nativeCanvas.height} logical canvas
					</p>
				</div>
				<span className="text-[10px] uppercase text-muted-foreground">{placement.fitMode}</span>
			</div>

			<div
				ref={canvasRef}
				className="relative w-full overflow-hidden rounded-md border bg-black touch-none"
				style={{ aspectRatio: `${metadata.nativeCanvas.width} / ${metadata.nativeCanvas.height}` }}
			>
				<div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:25%_25%]" />
				<div
					className="absolute flex cursor-move select-none items-center justify-center border border-cyan-300 bg-gradient-to-br from-cyan-500/60 via-violet-500/60 to-fuchsia-500/60 text-center text-[9px] text-white shadow-lg"
					style={{
						left: `${placement.position.x * 100}%`,
						top: `${placement.position.y * 100}%`,
						width: `${placement.scale.x * 100}%`,
						height: `${placement.scale.y * 100}%`,
						transform: `translate(-50%, -50%) rotate(${placement.rotationDegrees}deg)`,
					}}
					onPointerDown={event => beginInteraction( event, 'drag' )}
					onPointerMove={moveInteraction}
					onPointerUp={endInteraction}
					onPointerCancel={endInteraction}
				>
					<span className="pointer-events-none max-w-full truncate px-2">{snapshot.filename || 'Video bounds'}</span>
					<button
						type="button"
						aria-label="Resize video"
						className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-white bg-cyan-500"
						onPointerDown={event => beginInteraction( event, 'resize' )}
						onPointerMove={moveInteraction}
						onPointerUp={endInteraction}
						onPointerCancel={endInteraction}
					/>
					<button
						type="button"
						aria-label="Rotate video"
						className="absolute left-1/2 -top-6 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-white bg-fuchsia-500"
						onPointerDown={event => beginInteraction( event, 'rotate' )}
						onPointerMove={moveInteraction}
						onPointerUp={endInteraction}
						onPointerCancel={endInteraction}
					/>
				</div>
			</div>

			<div className="grid grid-cols-4 gap-1">
				{[ 'contain', 'cover', 'stretch' ].map( mode => (
					<Button key={mode} variant="outline" size="sm" className="h-7 px-1 capitalize" onClick={() => LEDVideoManager.applyFit( rootId, mode )}>
						{mode}
					</Button>
				) )}
				<Button variant="outline" size="sm" className="h-7 px-1" onClick={() => LEDVideoManager.applyFit( rootId, 'contain' )}>Reset</Button>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<NumericField label="Centre X" value={placement.position.x} onChange={x => LEDVideoManager.setPlacement( rootId, { position: { x }, fitMode: 'custom' } )} />
				<NumericField label="Centre Y" value={placement.position.y} onChange={y => LEDVideoManager.setPlacement( rootId, { position: { y }, fitMode: 'custom' } )} />
				<NumericField label="Width" value={placement.scale.x} onChange={value => setScaleAxis( 'x', value )} />
				<NumericField label="Height" value={placement.scale.y} onChange={value => setScaleAxis( 'y', value )} />
				<NumericField label="Rotation (°)" value={placement.rotationDegrees} step={1} onChange={rotationDegrees => LEDVideoManager.setPlacement( rootId, { rotationDegrees, fitMode: 'custom' } )} />
				<div className="flex items-end justify-between pb-1">
					<Switch
						label="Lock ratio"
						checked={placement.aspectRatioLocked}
						onCheckedChange={aspectRatioLocked => LEDVideoManager.setPlacement( rootId, { aspectRatioLocked } )}
					/>
				</div>
			</div>
			<p className="text-[10px] leading-relaxed text-muted-foreground">
				Centre and size are normalized to the LED canvas; values may extend outside 0–1 and are cropped at the display edge.
			</p>
		</section>
	);

};

const LEDTab = () => {

	const selectedObject = useStore( state => state.selectedObject );
	const [ , setRevision ] = useState( 0 );
	const [ choosing, setChoosing ] = useState( false );
	const fileInputRef = useRef( null );
	const ledRoot = useMemo( () => resolveLEDAssetRoot( selectedObject ), [ selectedObject ] );

	useEffect( () => LEDVideoManager.subscribe( () => setRevision( value => value + 1 ) ), [] );
	useEffect( () => {

		LEDVideoManager.attachApp( getApp() );
		if ( ledRoot ) LEDVideoManager.register( ledRoot );

	}, [ ledRoot ] );

	const snapshot = LEDVideoManager.getSnapshot( ledRoot );

	const chooseFile = useCallback( async event => {

		const file = event.target.files?.[ 0 ];
		event.target.value = '';
		if ( ! file || ! ledRoot ) return;
		setChoosing( true );
		try {

			await LEDVideoManager.chooseVideo( ledRoot, file );

		} catch {

			// The manager exposes the actionable decode/container error in its snapshot.

		} finally {

			setChoosing( false );

		}

	}, [ ledRoot ] );

	if ( ! snapshot ) {

		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
				<Video size={28} className="opacity-60" />
				<p className="text-sm">Select an LED wall—or any child of one—in the viewport or outliner.</p>
			</div>
		);

	}

	const metadata = snapshot.metadata;
	return (
		<div className="space-y-4 overflow-y-auto p-3">
			<header>
				<h2 className="text-sm font-semibold">{snapshot.name}</h2>
				<p className="text-[10px] text-muted-foreground">
					{metadata.assetType} · {metadata.physicalDimensions.width} m × {metadata.physicalDimensions.height} m
				</p>
			</header>

			<section className="space-y-3">
				<input ref={fileInputRef} type="file" accept=".mp4,video/mp4" className="hidden" onChange={chooseFile} />
				<div className="grid grid-cols-2 gap-2">
					<Button size="sm" disabled={choosing} onClick={() => fileInputRef.current?.click()}>
						<Upload size={13} className="mr-1" />{snapshot.filename ? 'Replace video' : 'Choose video'}
					</Button>
					<Button size="sm" variant="outline" disabled={! snapshot.filename} onClick={() => LEDVideoManager.clearVideo( snapshot.rootId )}>
						<Trash2 size={13} className="mr-1" />Clear
					</Button>
				</div>

				{snapshot.error && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">{snapshot.error}</p>}
				{snapshot.filename && (
					<div className="rounded-md border bg-muted/30 p-2 text-[11px]">
						<p className="truncate font-medium" title={snapshot.filename}>{snapshot.filename}</p>
						<p className="text-muted-foreground">
							{snapshot.videoWidth} × {snapshot.videoHeight} · {formatTime( snapshot.duration )} · {snapshot.status}
						</p>
					</div>
				)}

				<div className="grid grid-cols-3 gap-2">
					<Button size="sm" variant="outline" disabled={! snapshot.filename || snapshot.isPlaying} onClick={() => LEDVideoManager.play( snapshot.rootId ).catch( () => {} )}>
						<Play size={13} className="mr-1" />Play
					</Button>
					<Button size="sm" variant="outline" disabled={! snapshot.isPlaying} onClick={() => LEDVideoManager.pause( snapshot.rootId )}>
						<Pause size={13} className="mr-1" />Pause
					</Button>
					<Button size="sm" variant="outline" disabled={! snapshot.filename} onClick={() => LEDVideoManager.restart( snapshot.rootId )}>
						<RotateCcw size={13} className="mr-1" />Restart
					</Button>
				</div>
				<Slider
					label="Timeline"
					value={snapshot.currentTime}
					min={0}
					max={Math.max( snapshot.duration, 0.001 )}
					step={0.01}
					precision={2}
					disabled={! snapshot.duration}
					onChange={time => LEDVideoManager.seek( snapshot.rootId, time )}
				/>
				<div className="flex justify-between font-mono text-[10px] text-muted-foreground">
					<span>{formatTime( snapshot.currentTime )}</span>
					<span>{formatTime( snapshot.duration )}</span>
				</div>
				<div className="flex items-center justify-between">
					<Switch label="Loop" checked={metadata.loop} onCheckedChange={loop => LEDVideoManager.setLoop( snapshot.rootId, loop )} />
				</div>
			</section>

			<Separator />
			<section className="space-y-2">
				<div className="flex items-end justify-between">
					<div>
						<h3 className="text-sm font-medium">Brightness</h3>
						<p className="text-[10px] text-muted-foreground">Emission calibrated at 100 nits = 1 renderer unit</p>
					</div>
					<span className="text-xs font-medium">{Math.round( metadata.currentBrightnessNits ).toLocaleString()} nits</span>
				</div>
				<Slider
					value={metadata.currentBrightnessNits}
					min={0}
					max={metadata.maxBrightnessNits}
					step={metadata.maxBrightnessNits > 1000 ? 10 : 1}
					precision={0}
					onChange={nits => LEDVideoManager.setBrightness( snapshot.rootId, nits )}
				/>
				<p className="text-[10px] text-muted-foreground">Maximum: {metadata.maxBrightnessNits.toLocaleString()} nits</p>
			</section>

			<Separator />
			<PlacementEditor snapshot={snapshot} />
		</div>
	);

};

export default LEDTab;
