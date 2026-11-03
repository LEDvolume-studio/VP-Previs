import { createCameraShotEdit, createNodeShotEdit, createLightShotEdit, createLEDShotEdit } from '../previs/domain/StudentShotEdits.js';

const escape = value => String( value ).replace( /[&<>"']/g, character => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } )[ character ] );
const options = ( values, selected ) => values.map( ( { value, label } ) => `<option value="${escape( value )}"${value === selected ? ' selected' : ''}>${escape( label )}</option>` ).join( '' );
const number = ( name, label, value, extra = '' ) => `<label class="field">${escape( label )}<input name="${name}" type="number" ${extra.includes( 'step=' ) ? '' : 'step="any"'} value="${escape( value )}" required ${extra}></label>`;
const vector = ( prefix, label, values ) => `<fieldset><legend>${label} · metres</legend><div class="shot-fields">${values.map( ( value, index ) => number( `${prefix}${index}`, [ 'X', 'Y', 'Z' ][ index ], value ) ).join( '' )}</div></fieldset>`;
const selected = ( items, id, key ) => items.find( item => item[ key ] === id ) || items[ 0 ];

/** Small forms edit complete snapshots through the workspace's durable command path. */
export function renderShotEditor( { shot, capabilities, selection, locked } ) {

	if ( ! shot || ! capabilities ) return '';
	const { camera } = shot.snapshot;
	const node = selected( capabilities.nodes, selection.nodeId, 'instanceId' );
	const light = selected( capabilities.lights, selection.lightId, 'lightId' );
	const wall = selected( capabilities.walls, selection.wallId, 'wallId' );
	selection.nodeId = node?.instanceId; selection.lightId = light?.lightId; selection.wallId = wall?.wallId;
	const nodeState = node && shot.snapshot.nodes[ node.instanceId ];
	const lightState = light && shot.snapshot.lights.find( item => item.lightId === light.lightId );
	const wallState = wall && shot.snapshot.ledWalls.find( item => item.wallId === wall.wallId );
	return `<section class="shot-editor" aria-label="Shot settings"><h3>Shot settings · ${escape( shot.name )}</h3><p class="muted">Apply each completed edit to save it on this device. Undo and redo also update the picture. Every placement of this shot uses these settings.</p><fieldset${locked ? ' disabled' : ''}>
	<details open><summary>Camera and framing</summary><form id="shot-camera-form">${vector( 'position', 'Camera position', camera.transform.position )}${vector( 'target', 'Look-at target', camera.target )}<div class="shot-fields">${number( 'fov', 'Vertical field of view · degrees', camera.projection.fov, 'min="1" max="179"' )}${number( 'exposure', 'Exposure', camera.exposure, 'min="0"' )}<label class="field">Framing<select name="frameOverlayRatio">${options( [ '16:9', '4:3', '2.40:1' ].map( value => ( { value, label: value } ) ), camera.frameOverlayRatio )}</select></label></div><small>Moving the camera or target aims it with Y up. Saved focus and depth-of-field settings are retained.</small><button>Apply camera</button></form></details>
	${node ? `<details><summary>Car, people and objects</summary><label class="field">Object<select id="shot-node-select">${options( capabilities.nodes.map( item => ( { value: item.instanceId, label: `${item.label} · ${item.instanceId}` } ) ), node.instanceId )}</select></label><form id="shot-node-form">${vector( 'position', 'Object position', nodeState.transform.position )}${node.humanPose ? `<label class="field">Human pose<select name="humanPose">${options( [ 'standing', 'sitting' ].map( value => ( { value, label: value } ) ), nodeState.humanPose )}</select></label>` : ''}<button>Apply object</button></form></details>` : ''}
	${lightState ? `<details><summary>Lights</summary><label class="field">Light<select id="shot-light-select">${options( capabilities.lights.map( item => ( { value: item.lightId, label: `${item.type} · ${item.lightId}` } ) ), light.lightId )}</select></label><form id="shot-light-form">${number( 'intensity', 'Light intensity', lightState.intensity, 'min="0"' )}<button>Apply light</button></form></details>` : ''}
	${wallState ? `<details><summary>LED video</summary><label class="field">Wall<select id="shot-wall-select">${options( capabilities.walls.map( item => ( { value: item.wallId, label: item.wallId } ) ), wall.wallId )}</select></label><form id="shot-led-form"><div class="shot-fields"><label class="field">Video mode<select name="mode">${options( [ { value: 'freeze', label: 'Freeze at in-point' }, { value: 'play', label: 'Play from in-point' } ], wallState.mode )}</select></label>${number( 'inPointFrames', 'Source in-point · frame at 25 fps', Math.floor( wallState.inPointUs / 40000 ), `step="1" min="0"${wall.sourceDurationUs === null ? ' max="0"' : ` max="${Math.max( 0, Math.ceil( wall.sourceDurationUs / 40000 ) - 1 )}"`}` )}${number( 'brightnessNits', 'Brightness · nits', wallState.brightnessNits, 'min="0"' )}</div><label><input name="loop" type="checkbox"${wallState.loop ? ' checked' : ''}> Loop video</label><p><small>Scrub or play the timeline to advance play-mode video from this source position. MP4 export is still being built. Source video is the version copied from the preset.</small></p><button>Apply LED</button></form></details>` : ''}
	</fieldset></section>`;

}

export function bindShotEditor( root, { shot, getShot = () => shot, selection, onEdit, onSelectionChange } ) {

	for ( const [ selector, key ] of [[ '#shot-node-select', 'nodeId' ], [ '#shot-light-select', 'lightId' ], [ '#shot-wall-select', 'wallId' ]] ) root.querySelector( selector )?.addEventListener( 'change', event => {

		selection[ key ] = event.target.value;
		// Change just this editor, preserving which disclosure was open.
		onSelectionChange();

	} );
	const vectorValue = ( data, name ) => [ 0, 1, 2 ].map( index => Number( data.get( `${name}${index}` ) ) );
	const cameraVector = ( data, name, saved, current ) => vectorValue( data, name ).map( ( value, index ) => value === saved[ index ] ? current[ index ] : value );
	const forms = [
		[ '#shot-camera-form', data => createCameraShotEdit( getShot(), { position: cameraVector( data, 'position', shot.snapshot.camera.transform.position, getShot().snapshot.camera.transform.position ), target: cameraVector( data, 'target', shot.snapshot.camera.target, getShot().snapshot.camera.target ), fov: Number( data.get( 'fov' ) ), exposure: Number( data.get( 'exposure' ) ), frameOverlayRatio: data.get( 'frameOverlayRatio' ) } ) ],
		[ '#shot-node-form', data => createNodeShotEdit( getShot(), { instanceId: selection.nodeId, position: vectorValue( data, 'position' ), ...( data.has( 'humanPose' ) ? { humanPose: data.get( 'humanPose' ) } : {} ) } ) ],
		[ '#shot-light-form', data => createLightShotEdit( getShot(), { lightId: selection.lightId, intensity: Number( data.get( 'intensity' ) ) } ) ],
		[ '#shot-led-form', data => {

			const wall = getShot().snapshot.ledWalls.find( item => item.wallId === selection.wallId );
			const frame = Number( data.get( 'inPointFrames' ) );
			return createLEDShotEdit( getShot(), { wallId: selection.wallId, mode: data.get( 'mode' ), loop: data.has( 'loop' ), brightnessNits: Number( data.get( 'brightnessNits' ) ), ...( frame === Math.floor( wall.inPointUs / 40000 ) ? {} : { inPointFrames: frame } ) } );

		} ],
	];
	for ( const [ selector, build ] of forms ) root.querySelector( selector )?.addEventListener( 'submit', event => {

		event.preventDefault();
		const data = new FormData( event.target );
		// Build inside the workspace error boundary; invalid fields never change history.
		onEdit( () => build( data ) );

	} );

}
