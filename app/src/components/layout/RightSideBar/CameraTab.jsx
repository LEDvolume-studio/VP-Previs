import { Ruler, Telescope, Aperture, Camera, Target, Crosshair, RotateCcw, Ellipsis, Plus, Trash2, Globe } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Row } from "@/components/ui/row";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Trackpad } from "@/components/ui/trackpad";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CAMERA_RANGES, CAMERA_PRESETS, isPanorama } from '@/Constants';
import { useCameraStore, usePathTracerStore } from '@/store';
import { useEffect } from 'react';
import { getApp } from '@/lib/appProxy';
import { useBackendEvent } from '@/hooks/useBackendEvent';
import { useActiveApp } from '@/hooks/useActiveApp';
import { FieldOfView } from "@/assets/icons";
import { Separator } from "@/components/ui/separator";
import { NumberInput } from '@/components/ui/number-input';
import { FRAME_OVERLAY_PRESETS, SENSOR_PRESETS } from '@/utils/cameraSensor';

/** Min/Max pair for a symmetric ±limit range — the Slider is single-thumb, so it takes two rows. */
const RangeRows = ( { label, limit, value, onChange } ) => [ 0, 1 ].map( i => (
	<Row key={i}>
		<Slider
			label={`${label} ${i ? 'Max' : 'Min'}`}
			min={- limit}
			max={limit}
			step={1}
			value={[ value[ i ] ]}
			onValueChange={( [ v ] ) => onChange( i ? [ value[ 0 ], v ] : [ v, value[ 1 ] ] )}
		/>
	</Row>
) );

const CameraTab = () => {

	const {
		// State
		fov,
		focusDistance,
		aperture,
		focalLength,
		enableDOF,
		zoomToCursor,
		dollyZoom,
		activePreset,
		focusMode,
		apertureScale,
		anamorphicRatio,
		dofMode,
		dofBlur,
		unitsPerMetre,
		cameraNames,
		selectedCameraIndex,
		sensorPreset,
		sensorWidth,
		sensorHeight,
		frameOverlayRatio,

		// Auto-focus state
		autoFocusMode,
		afScreenPoint,
		afPlacingPoint,

		// Basic setters
		setCameraNames,
		setSelectedCameraIndex,
		setLensState,
		applySensorSettings,

		// Handlers
		handleToggleFocusMode,
		handleFocusDistanceChange,
		handlePresetChange,
		handleFovChange,
		handleApertureChange,
		handleFocalLengthChange,
		handleEnableDOFChange,
		handleZoomToCursorChange,
		handleDollyZoomChange,
		handleCameraMove,
		handleCameraChange,
		handleAddCamera,
		handleRemoveCamera,
		handleApertureScaleChange,
		handleAnamorphicRatioChange,
		handleDofModeChange,
		handleDofBlurChange,
		handleUnitsPerMetreChange,
		handleFocusChangeEvent,
		handleSensorPresetChange,
		handleSensorDimensionChange,
		setFrameOverlayRatio,

		// Auto-focus handlers
		handleAutoFocusModeChange,
		handleToggleAFPointPlacement,
		handleAFResetToCenter,
	} = useCameraStore();

	// Projection lives in usePathTracerStore — switching it re-derives the output dimensions.
	// Narrow selectors: that store takes a per-frame auto-exposure write, so a bare
	// usePathTracerStore() here would re-render this whole panel every frame.
	const cameraProjection = usePathTracerStore( s => s.cameraProjection );
	const panoramaLonRange = usePathTracerStore( s => s.panoramaLonRange );
	const panoramaLatRange = usePathTracerStore( s => s.panoramaLatRange );
	const panoramaLevelHorizon = usePathTracerStore( s => s.panoramaLevelHorizon );
	const handleCameraProjectionChange = usePathTracerStore( s => s.handleCameraProjectionChange );
	const handlePanoramaLonRangeChange = usePathTracerStore( s => s.handlePanoramaLonRangeChange );
	const handlePanoramaLatRangeChange = usePathTracerStore( s => s.handlePanoramaLatRangeChange );
	const handlePanoramaLevelHorizonChange = usePathTracerStore( s => s.handlePanoramaLevelHorizonChange );

	const panorama = isPanorama( cameraProjection );

	const activeApp = useActiveApp();

	useBackendEvent( 'focusChanged', handleFocusChangeEvent );

	// Camera names/selection are kept in sync centrally by EngineAdapter
	// (CameraSwitched / CamerasUpdated). This only seeds the initial values on mount
	// and when the app instance swaps.
	useEffect( () => {

		const app = getApp();
		if ( app ) {

			setCameraNames( app.cameraManager.getNames() );
			setSelectedCameraIndex( app.currentCameraIndex ?? 0 );
			const camera = app.cameraManager.active;
			const currentFocalLength = camera.getFocalLength();
			applySensorSettings( currentFocalLength );
			setLensState( camera.fov, currentFocalLength );
			app.settings.set( 'focalLength', currentFocalLength, { reset: false } );

		}

	}, [ activeApp, applySensorSettings, setCameraNames, setLensState, setSelectedCameraIndex ] );

	const cameraPoints = [
		{ x: 0, y: 50 }, // left view
		{ x: 50, y: 50 }, // front view
		{ x: 100, y: 50 }, // right view
		{ x: 50, y: 0 }, // top view
		{ x: 50, y: 100 }, // bottom view
		{ x: 25, y: 50 }, // front-left view
		{ x: 75, y: 50 }, // front-right view
		{ x: 25, y: 25 }, // top left view
		{ x: 75, y: 25 }, // top right view
		{ x: 25, y: 75 }, // bottom left view
		{ x: 75, y: 75 }, // bottom right view
	];

	const isAutoFocus = autoFocusMode === 'auto';
	const isAFPointCustom = afScreenPoint.x !== 0.5 || afScreenPoint.y !== 0.5;

	// Only user-added cameras (not the default or model-embedded ones) can be removed.
	const canRemoveCamera = selectedCameraIndex > 0
		&& !! getApp()?.cameraManager?.cameras?.[ selectedCameraIndex ]?.userData?.__rayzeeUserCamera;

	return (
		<>
			<Separator className="bg-primary" />
			<div className="space-y-4 p-4">
				<Row>
					<span className="opacity-50 text-xs truncate">Select Camera</span>
					<div className="flex items-center gap-1">
						<Select value={selectedCameraIndex.toString()} onValueChange={handleCameraChange}>
							<SelectTrigger className="w-28 h-5 rounded-full">
								<div className="h-full pr-1 inline-flex justify-start items-center">
									<Camera size={12} className="z-10" />
								</div>
								<SelectValue placeholder="Select camera" />
							</SelectTrigger>
							<SelectContent>
								{cameraNames.map( ( name, index ) => (
									<SelectItem key={index} value={index.toString()}>{name}</SelectItem>
								) )}
							</SelectContent>
						</Select>
						<Button
							variant="outline"
							size="icon"
							onClick={handleAddCamera}
							className="h-5 w-5 rounded-full shrink-0"
							title="Add camera from current view"
						>
							<Plus size={12} />
						</Button>
						<Button
							variant="outline"
							size="icon"
							onClick={() => handleRemoveCamera( selectedCameraIndex )}
							disabled={! canRemoveCamera}
							className="h-5 w-5 rounded-full shrink-0"
							title={canRemoveCamera ? "Remove this camera" : "Only user-added cameras can be removed"}
						>
							<Trash2 size={12} />
						</Button>
					</div>
				</Row>

				<Row>
					<span className="opacity-50 text-xs truncate">Projection</span>
					<Select value={cameraProjection} onValueChange={handleCameraProjectionChange}>
						<SelectTrigger className="max-w-32 h-5 rounded-full">
							<div className="h-full pr-1 inline-flex justify-start items-center">
								<Globe size={12} className="z-10" />
							</div>
							<SelectValue placeholder="Select projection" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="perspective">Perspective</SelectItem>
							<SelectItem value="equirectangular">360° Panorama</SelectItem>
						</SelectContent>
					</Select>
				</Row>

				<Row>
					<span className="opacity-50 text-xs truncate">Sensor</span>
					<Select value={sensorPreset} onValueChange={handleSensorPresetChange} disabled={panorama}>
						<SelectTrigger className="max-w-32 h-5 rounded-full">
							<SelectValue placeholder="Sensor size" />
						</SelectTrigger>
						<SelectContent>
							{Object.entries( SENSOR_PRESETS ).map( ( [ key, preset ] ) => (
								<SelectItem key={key} value={key}>{preset.label}</SelectItem>
							) )}
							<SelectItem value="custom">Custom</SelectItem>
						</SelectContent>
					</Select>
				</Row>

				<Row title="Sensor dimensions are locked to 16:9">
					<span className="opacity-50 text-xs truncate">Sensor (mm)</span>
					<div className="flex items-center gap-1 text-xs text-muted-foreground">
						<NumberInput
							aria-label="Sensor width in millimetres"
							value={sensorWidth}
							min={1}
							max={100}
							step={0.1}
							precision={2}
							disabled={panorama}
							onValueChange={value => handleSensorDimensionChange( 'width', value )}
						/>
						<span>&times;</span>
						<NumberInput
							aria-label="Sensor height in millimetres"
							value={sensorHeight}
							min={1}
							max={100}
							step={0.1}
							precision={2}
							disabled={panorama}
							onValueChange={value => handleSensorDimensionChange( 'height', value )}
						/>
					</div>
				</Row>

				<Row>
					<span className="opacity-50 text-xs truncate">Ratio Overlay</span>
					<Select value={frameOverlayRatio} onValueChange={setFrameOverlayRatio}>
						<SelectTrigger className="max-w-32 h-5 rounded-full">
							<SelectValue placeholder="Overlay ratio" />
						</SelectTrigger>
						<SelectContent>
							{Object.entries( FRAME_OVERLAY_PRESETS ).map( ( [ key, preset ] ) => (
								<SelectItem key={key} value={key}>{preset.label}</SelectItem>
							) )}
						</SelectContent>
					</Select>
				</Row>

				{panorama && (
					<>
						<Row>
							<Switch
								checked={panoramaLevelHorizon}
								label="Level Horizon"
								onCheckedChange={handlePanoramaLevelHorizonChange}
							/>
						</Row>

						<RangeRows label="Longitude" limit={180} value={panoramaLonRange} onChange={handlePanoramaLonRangeChange} />
						<RangeRows label="Latitude" limit={90} value={panoramaLatRange} onChange={handlePanoramaLatRangeChange} />
					</>
				)}

				<Row>
					<Slider
						label={"FOV"}
						icon={FieldOfView}
						min={CAMERA_RANGES.fov.min}
						max={CAMERA_RANGES.fov.max}
						step={1}
						value={[ fov ]}
						onValueChange={handleFovChange}
						disabled={panorama}
					/>
				</Row>

				<Row>
					<Slider
						label={"Focal Length (mm)"}
						icon={Ruler}
						min={CAMERA_RANGES.focalLength.min}
						max={CAMERA_RANGES.focalLength.max}
						step={1}
						value={[ focalLength ]}
						onValueChange={handleFocalLengthChange}
						disabled={panorama}
					/>
				</Row>

				<Row>
					<Switch
						checked={dollyZoom}
						label="Dolly Zoom"
						onCheckedChange={handleDollyZoomChange}
						disabled={panorama}
						title="Move the camera to preserve subject size when changing FOV or focal length"
					/>
				</Row>

				<Row>
					<Switch
						checked={zoomToCursor}
						label="Zoom to Cursor"
						onCheckedChange={handleZoomToCursorChange}
					/>
				</Row>

				<Separator />

				<Row>
					<Switch
						checked={enableDOF}
						label="Depth of Field"
						onCheckedChange={handleEnableDOFChange}
					/>
				</Row>

				{enableDOF && (
					<>
						<Row>
							<span className="opacity-50 text-xs truncate">Lens Model</span>
							<Select value={dofMode} onValueChange={handleDofModeChange}>
								<SelectTrigger className="max-w-32 h-5 rounded-full"><SelectValue /></SelectTrigger>
								<SelectContent>
									<SelectItem value="legacy">Legacy</SelectItem>
									<SelectItem value="physical">Physical</SelectItem>
									<SelectItem value="look">Look</SelectItem>
								</SelectContent>
							</Select>
						</Row>
						{dofMode === 'look' && (
							<Row>
								<Slider label="Background Blur" min={0} max={0.25} step={0.001}
									value={[ dofBlur ]} onValueChange={handleDofBlurChange}
									title="Far-background blur as a fraction of image height, independent of scene scale" />
							</Row>
						)}
						{dofMode === 'physical' && (
							<Row>
								<span className="opacity-50 text-xs truncate" title="1 for metre scenes, 100 for centimetres, 1000 for millimetres">Scene Units / Metre</span>
								<NumberInput className="w-28 shrink-0" aria-label="Scene units per metre" value={unitsPerMetre}
									min={0.000001} max={1000000} step={1} precision={6}
									onValueChange={handleUnitsPerMetreChange} />
							</Row>
						)}
						<Row>
							<Select value={activePreset} onValueChange={handlePresetChange}>
								<span className="opacity-50 text-xs truncate">DOF Preset</span>
								<SelectTrigger className="max-w-32 h-5 rounded-full">
									<div className="h-full pr-1 inline-flex justify-start items-center">
										<Camera size={12} className="z-10" />
									</div>
									<SelectValue placeholder="Select preset" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="custom">Custom</SelectItem>
									{Object.entries( CAMERA_PRESETS ).map( ( [ key, preset ] ) => (
										<SelectItem key={key} value={key}>
											<div>
												<div className="font-medium">{preset.name}</div>
												<div className="text-xs opacity-50">{preset.description}</div>
											</div>
										</SelectItem>
									) )}
								</SelectContent>
							</Select>
						</Row>

						<Row>
							<span className="opacity-50 text-xs truncate">Focus</span>
							<ToggleGroup
								type="single"
								value={autoFocusMode}
								onValueChange={( val ) => val && handleAutoFocusModeChange( val )}
								className="max-w-36"
							>
								<ToggleGroupItem value="manual" className="text-xs px-3 h-5">
									Manual
								</ToggleGroupItem>
								<ToggleGroupItem
									value="auto"
									className="text-xs px-3 h-5"
									disabled={panorama}
									title={panorama ? "Auto-focus needs a perspective frustum" : undefined}
								>
									Auto
								</ToggleGroupItem>
							</ToggleGroup>
						</Row>

						{/* Manual mode: slider + click-to-focus target */}
						{! isAutoFocus && (
							<Row>
								<Slider
									label={dofMode === 'legacy' ? 'Focus Distance (m)' : 'Focus (scene units)'}
									icon={Telescope}
									min={CAMERA_RANGES.focusDistance.min}
									max={dofMode === 'legacy' ? CAMERA_RANGES.focusDistance.max : Math.max( CAMERA_RANGES.focusDistance.max, focusDistance * 2, unitsPerMetre * 100 )}
									step={0.1}
									value={[ focusDistance.toFixed( 1 ) ]}
									onValueChange={( values ) => handleFocusDistanceChange( values[ 0 ] )}
								/>
								<Button
									variant={focusMode ? "default" : "outline"}
									size="icon"
									onClick={handleToggleFocusMode}
									className="ml-2 h-5 rounded-full"
									title="Click in scene to set focus point (F)"
								>
									<Target size={12} />
								</Button>
							</Row>
						)}

						{/* Auto mode: read-only slider + AF point controls + smoothing */}
						{isAutoFocus && (
							<>
								<Row>
									<Slider
										label={dofMode === 'legacy' ? 'Focus Distance (m)' : 'Focus (scene units)'}
										icon={Telescope}
										min={CAMERA_RANGES.focusDistance.min}
										max={dofMode === 'legacy' ? CAMERA_RANGES.focusDistance.max : Math.max( CAMERA_RANGES.focusDistance.max, focusDistance * 2, unitsPerMetre * 100 )}
										step={0.1}
										value={[ focusDistance.toFixed( 1 ) ]}
										disabled={true}
									/>
									<span className="ml-2 text-[10px] opacity-40 whitespace-nowrap">(auto)</span>
								</Row>
								<Row>
									<span className="opacity-50 text-xs truncate">AF Point</span>
									<div className="flex items-center gap-1.5">
										<Button
											variant={afPlacingPoint ? "default" : "outline"}
											size="sm"
											onClick={handleToggleAFPointPlacement}
											className="h-5 rounded-full text-xs px-2"
										>
											<Crosshair size={12} className="mr-1" />
											{afPlacingPoint ? "Click viewport..." : "Set Point"}
										</Button>
										{isAFPointCustom && (
											<Button
												variant="outline"
												size="icon"
												onClick={handleAFResetToCenter}
												className="h-5 w-5 rounded-full"
												title="Reset to center"
											>
												<RotateCcw size={10} />
											</Button>
										)}
									</div>
								</Row>
							</>
						)}

						{dofMode !== 'look' && <>
							<Row>
								<Select value={aperture.toString()} onValueChange={handleApertureChange}>
									<span className="opacity-50 text-xs truncate">Aperture (f)</span>
									<SelectTrigger className="max-w-32 h-5 rounded-full">
										<div className="h-full pr-1 inline-flex justify-start items-center">
											<Aperture size={12} className="z-10" />
										</div>
										<SelectValue placeholder="Select aperture" />
									</SelectTrigger>
									<SelectContent>
										{CAMERA_RANGES.aperture.options.map( f => (
											<SelectItem key={f} value={f.toString()}>{f}</SelectItem>
										) )}
									</SelectContent>
								</Select>
							</Row>

							<Row>
								<Slider
									label={"DOF Intensity"}
									icon={Aperture}
									min={0.1}
									max={2.0}
									step={0.1}
									value={[ apertureScale ?? 1.0 ]}
									onValueChange={( values ) => handleApertureScaleChange( values[ 0 ] )}
								/>
							</Row>

						</>}
						<Row>
							<Slider
								label={"Bokeh Stretch"}
								icon={Ellipsis}
								min={1.0}
								max={2.0}
								step={0.05}
								value={[ anamorphicRatio ?? 1.0 ]}
								onValueChange={( values ) => handleAnamorphicRatioChange( values[ 0 ] )}
							/>
						</Row>
					</>
				)}

				<Separator />

				{selectedCameraIndex == 0 && (
					<div className="flex items-center">
						<Trackpad
							label={"Camera Position"}
							points={cameraPoints}
							onMove={handleCameraMove}
							className="w-[110px] h-[110px]"
						/>
					</div>
				)}
			</div>
		</>
	);

};

export default CameraTab;
