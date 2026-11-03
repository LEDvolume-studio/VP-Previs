import { useEffect, useRef, useState } from 'react';
import { Aperture, ChevronLeft, ChevronRight, Lightbulb, LockKeyhole, SlidersHorizontal, UserRound } from 'lucide-react';
import { createLightShotEdit, createNodeShotEdit } from '../../previs/domain/StudentShotEdits.js';
import { createInspectorCameraEdit, createInspectorLEDBlurEdit } from './ShotInspectorEdits.js';
import { DEFAULT_LED_BLUR, LED_BLUR_LABELS, LED_BLUR_METHODS } from '../../previs/media/LEDBlur.js';

/** Local slider drafts commit once on release; input drafts commit on blur/Enter. */
function ScalarControl( { label, value, min, max, step = 0.1, unit, disabled, onCommit, onPreview } ) {

	const precision = String( step ).split( '.' )[ 1 ]?.length || 0;
	const displayValue = String( Number( value.toFixed( precision ) ) );
	const [ draft, setDraft ] = useState( displayValue );
	const dirty = useRef( false );
	useEffect( () => {

		setDraft( displayValue ); dirty.current = false;

	}, [ value, displayValue ] );
	const change = event => {

		setDraft( event.target.value ); dirty.current = true;

	};

	const commit = event => {

		if ( ! dirty.current || disabled ) return;
		const input = event.currentTarget;
		if ( ! input.checkValidity() || input.value.trim() === '' ) {

			input.reportValidity(); return;

		}

		dirty.current = false;
		onCommit( Number( input.value ) );

	};

	return <label className="sim-inspector-control">
		<span className="sim-inspector-label">{label}<span className="sim-inspector-value"><input aria-label={label} type="number" value={draft} min={min} max={max} step={step} disabled={disabled} onChange={change} onBlur={commit} onKeyDown={event => {

			if ( event.key === 'Enter' ) {

				event.preventDefault(); event.currentTarget.blur();

			}

			if ( event.key === 'Escape' ) {

				setDraft( displayValue ); dirty.current = false; event.currentTarget.blur();

			}

		}} />{unit && <small>{unit}</small>}</span></span>
		<input aria-label={`${label} slider`} type="range" value={draft === '' ? value : draft} min={min} max={max} step={step} disabled={disabled} onChange={event => {

			change( event ); onPreview?.( Number( event.target.value ) );

		}} onPointerUp={commit} onPointerCancel={() => {

			setDraft( displayValue ); dirty.current = false; onPreview?.( value );

		}} onBlur={commit} onKeyUp={event => {

			if ( [ 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown' ].includes( event.key ) ) commit( event );

		}} />
	</label>;

}

const pendingPoseTitle = 'This pose needs a supported pose asset.';
const pendingDOFTitle = 'Depth-of-field editing is awaiting the student raster effect integration. Saved settings are preserved.';

/** Compact inspector; the host evaluates builders after flushing live navigation. */
export default function ShotInspector( { shot, capabilities, onEdit, onFocalLengthPreview, onLEDBlurPreview, onCompareLEDBlur, blurComparison, disabled = false, onPrevious, onNext } ) {

	const [ selectedHuman, setSelectedHuman ] = useState( '' );
	const [ selectedLight, setSelectedLight ] = useState( '' );
	const [ selectedWall, setSelectedWall ] = useState( '' );
	const [ error, setError ] = useState( '' );
	const humans = ( capabilities?.nodes || [] ).filter( node => node.humanPose && [ 'standing', 'sitting' ].includes( shot?.snapshot.nodes[ node.instanceId ]?.humanPose ) );
	const human = humans.find( node => node.instanceId === selectedHuman ) || humans[ 0 ];
	const lights = ( capabilities?.lights || [] ).filter( light => shot?.snapshot.lights.some( item => item.lightId === light.lightId ) );
	const light = lights.find( item => item.lightId === selectedLight ) || lights[ 0 ];
	const lightState = shot?.snapshot.lights.find( item => item.lightId === light?.lightId );
	const walls = ( shot?.snapshot.ledWalls || [] ).filter( item => item.presentationVersion === 1 );
	const wall = walls.find( item => item.wallId === selectedWall ) || walls[ 0 ];
	const blur = wall?.blur || DEFAULT_LED_BLUR;
	const comparison = blurComparison?.shotId === shot?.shotId && blurComparison.wallId === wall?.wallId ? blurComparison : null;
	const camera = shot?.snapshot.camera;
	const locked = disabled || ! shot || ! capabilities;
	const apply = async build => {

		if ( locked ) return;
		try {

			setError( '' );
			await onEdit( build );

		} catch ( cause ) {

			setError( cause.message || 'The setting could not be applied.' );

		}

	};

	const cameraEdit = ( field, value ) => apply( saved => createInspectorCameraEdit( saved, field, value ) );
	const blurEdit = async value => {

		await apply( saved => createInspectorLEDBlurEdit( saved, wall.wallId, value ) );
		onLEDBlurPreview?.( wall.wallId, null );

	};

	return <aside className="sim-inspector" aria-label="Shot settings">
		<div className="sim-inspector-heading"><SlidersHorizontal size={15} /><h2>Shot settings</h2></div>
		<div className="sim-inspector-shot"><button type="button" aria-label="Previous shot" title="Previous shot" disabled={disabled || ! onPrevious} onClick={onPrevious}><ChevronLeft size={16} /></button><strong>{shot?.name || 'Select a shot'}</strong><button type="button" aria-label="Next shot" title="Next shot" disabled={disabled || ! onNext} onClick={onNext}><ChevronRight size={16} /></button></div>
		{! shot ? <p className="sim-inspector-empty">Choose a timeline shot to edit its settings.</p> : <>
			<section key={`camera-${shot.shotId}`} className="sim-inspector-section"><h3><Aperture size={15} />Camera</h3>
				<ScalarControl label="Focal length" value={camera.lens.focalLength} min={8} max={200} step={0.1} unit="mm" disabled={locked} onPreview={value => {

					try {

						onFocalLengthPreview?.( createInspectorCameraEdit( shot, 'focalLength', value ).snapshot.camera ); setError( '' );

					} catch ( cause ) {

						setError( cause.message );

					}

				}} onCommit={value => cameraEdit( 'focalLength', value )} />
				<ScalarControl label="Exposure" value={camera.exposure} min={0} max={2} step={0.01} disabled={locked} onCommit={value => cameraEdit( 'exposure', value )} />
			</section>
			<section key={`led-blur-${shot.shotId}-${wall?.wallId || 'none'}`} className="sim-inspector-section"><h3>LED screen blur</h3>
				{wall ? <>
					{walls.length > 1 && <select className="sim-inspector-select" aria-label="LED screen" value={wall.wallId} disabled={locked} onChange={event => setSelectedWall( event.target.value )}>{walls.map( item => <option key={item.wallId} value={item.wallId}>{item.wallId}</option> )}</select>}
					<select className="sim-inspector-select" aria-label="LED blur algorithm" value={blur.method} disabled={locked} onChange={event => blurEdit( { method: event.target.value, amount: blur.amount || 12 } )}>{LED_BLUR_METHODS.map( method => <option key={method} value={method}>{LED_BLUR_LABELS[ method ]}</option> )}</select>
					<ScalarControl label="Blur amount" value={blur.amount} min={0} max={40} step={0.5} disabled={locked || blur.method === 'off'} onPreview={amount => onLEDBlurPreview?.( wall.wallId, { ...blur, amount } )} onCommit={amount => blurEdit( { ...blur, amount } )} />
					<p className="sim-inspector-note">Lens uses a circular defocus blur on this screen. Amount is the radius in pixels at 1920-wide resolution.</p>
					<button type="button" className="sim-blur-compare" disabled={locked || ! wall.media} onClick={() => onCompareLEDBlur?.( wall.wallId, blur.amount || 12 )}>Compare playback speed</button>
					<p className="sim-inspector-note">Tests all four options on the same 2-second video sample at 25 fps. Includes video decoding and rendering at 1920 × 1080.</p>
					{comparison && <div className="sim-blur-results"><p>Amount: {comparison.amount} · this device</p><table aria-label="LED blur playback comparison"><thead><tr><th>Algorithm</th><th>FPS</th><th>ms/frame</th><th>95th %</th></tr></thead><tbody>{comparison.results.map( result => <tr key={result.method}><th>{LED_BLUR_LABELS[ result.method ]}</th><td>{result.fps.toFixed( 1 )}</td><td>{result.meanMs.toFixed( 1 )}</td><td>{result.p95Ms.toFixed( 1 )}</td></tr> )}</tbody></table><p className="sim-inspector-note">25 fps is full speed. Lower frame times leave more playback headroom. Results vary by scene and device.</p></div>}
				</> : <p className="sim-inspector-note">No supported LED screens in this shot.</p>}
			</section>
			<section key={`dof-${shot.shotId}`} className="sim-inspector-section"><h3><Aperture size={15} />Depth of field<LockKeyhole size={12} /></h3>
				<label className="sim-inspector-toggle" title={pendingDOFTitle}><span>Enable depth of field</span><input type="checkbox" checked={camera.lens.enableDOF} disabled readOnly aria-label="Enable depth of field" /></label>
				<div title={pendingDOFTitle}><ScalarControl label="Aperture" value={camera.lens.aperture} min={1} max={22} step={0.1} unit="f" disabled /><ScalarControl label="Focus distance" value={camera.lens.focusDistance} min={0.1} max={30} step={0.1} unit="m" disabled /></div>
				<p className="sim-inspector-note">Saved lens settings are retained. DOF editing is not available yet.</p>
			</section>
			<section className="sim-inspector-section"><h3><UserRound size={15} />Character pose</h3>
				{humans.length > 0 && <select className="sim-inspector-select" aria-label="Character" value={human.instanceId} disabled={locked} onChange={event => setSelectedHuman( event.target.value )}>{humans.map( node => <option key={node.instanceId} value={node.instanceId}>{node.label} · {node.instanceId}</option> )}</select>}
				<div className="sim-inspector-pose-grid">{[ 'standing', 'sitting' ].map( pose => <button type="button" key={pose} disabled={locked || ! human} aria-pressed={human ? shot.snapshot.nodes[ human.instanceId ].humanPose === pose : false} onClick={() => apply( saved => createNodeShotEdit( saved, { instanceId: human.instanceId, position: saved.snapshot.nodes[ human.instanceId ].transform.position, humanPose: pose } ) )}>{pose === 'standing' ? 'Standing' : 'Sitting'}</button> )}{[ 'Driving', 'Relaxed', 'Reaching' ].map( pose => <span title={pendingPoseTitle} key={pose}><button type="button" disabled>{pose}</button></span> )}</div>
				{! humans.length && <p className="sim-inspector-note">No supported character is mapped in this scene.</p>}
			</section>
			<section key={`light-${shot.shotId}-${light?.lightId || 'none'}`} className="sim-inspector-section"><h3><Lightbulb size={15} />Lighting</h3>
				{lightState ? <><select className="sim-inspector-select" aria-label="Light" value={light.lightId} disabled={locked} onChange={event => setSelectedLight( event.target.value )}>{lights.map( item => <option key={item.lightId} value={item.lightId}>{item.lightId} · {item.type}</option> )}</select><ScalarControl label="Light intensity" value={lightState.intensity} min={0} max={Math.max( 20000, lightState.intensity )} step={1} disabled={locked} onCommit={intensity => apply( saved => createLightShotEdit( saved, { lightId: light.lightId, intensity } ) )} /></> : <p className="sim-inspector-note">No lights are mapped in this scene.</p>}
			</section>
			<section className="sim-inspector-section"><h3>Vehicle doors<LockKeyhole size={12} /></h3><div className="sim-inspector-pose-grid" title="Door controls need verified hinge capabilities; saved door state is preserved."><button type="button" disabled>Closed</button><button type="button" disabled>Open</button></div></section>
		</>}
		{error && <p className="sim-inspector-error" role="alert">{error}</p>}
	</aside>;

}
