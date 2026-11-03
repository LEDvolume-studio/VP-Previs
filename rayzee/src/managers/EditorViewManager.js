import {
	AxesHelper, Box3, Color, DoubleSide, GridHelper, MeshBasicMaterial,
	OrthographicCamera, Scene, Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EDITOR_VIEW_MODES = new Set( [ 'perspective', 'top', 'front', 'side' ] );
const EDITOR_VIEW_STYLES = new Set( [ 'solid', 'wireframe' ] );
const DEFAULT_SPAN = 10;
const GRID_CELLS = 200;
const GRID_MAJOR_EVERY = 10;
export const EDITOR_COORDINATE_SYSTEM = 'gltf-y-up-rh-v1';

// Match the engine and glTF's right-handed axes: +Y up, +Z forward.
// Front faces the asset from +Z; Side is specifically its left side (+X).
const VIEW_DEFINITIONS = {
	top: {
		positionAxis: new Vector3( 0, 1, 0 ),
		up: new Vector3( 0, 0, - 1 ),
		gridRotation: new Vector3( 0, 0, 0 ),
		planeAxes: [ 'x', 'z' ],
	},
	front: {
		positionAxis: new Vector3( 0, 0, 1 ),
		up: new Vector3( 0, 1, 0 ),
		gridRotation: new Vector3( Math.PI / 2, 0, 0 ),
		planeAxes: [ 'x', 'y' ],
	},
	side: {
		positionAxis: new Vector3( 1, 0, 0 ),
		up: new Vector3( 0, 1, 0 ),
		gridRotation: new Vector3( 0, 0, Math.PI / 2 ),
		planeAxes: [ 'z', 'y' ],
	},
};

const finiteVector = value => Array.isArray( value )
	&& value.length === 3
	&& value.every( Number.isFinite );

/**
 * Owns the raster-only orthographic editor cameras. These cameras deliberately
 * stay outside CameraManager: photographic cameras remain perspective cameras
 * with their own focus, sensor, and path-tracing state.
 */
export class EditorViewManager {

	constructor( { canvas, realtimeRenderer, scene, getBounds, onChange, onInvalidate } ) {

		this.canvas = canvas;
		this.realtimeRenderer = realtimeRenderer;
		this.scene = scene;
		this.getBounds = getBounds;
		this.onChange = onChange;
		this.onInvalidate = onInvalidate;
		this.mode = 'perspective';
		this.style = 'solid';
		this.gridVisible = true;
		this.gridSpacing = 1;
		this._gridKey = '';
		this._states = new Map();
		this._gridScene = new Scene();
		this._gridScene.background = new Color( 0x17191d );
		this._gridHelpers = [];

		this._solidMaterial = new MeshBasicMaterial( {
			color: 0xaeb5c0,
			side: DoubleSide,
			toneMapped: false,
		} );
		this._wireframeMaterial = new MeshBasicMaterial( {
			color: 0xd9e2ef,
			side: DoubleSide,
			wireframe: true,
			toneMapped: false,
		} );

		this.cameras = {};
		this.controls = {};
		for ( const mode of Object.keys( VIEW_DEFINITIONS ) ) this._createView( mode );

	}

	get active() {

		return this.mode !== 'perspective';

	}

	get camera() {

		return this.cameras[ this.mode ] || null;

	}

	get activeControls() {

		return this.controls[ this.mode ] || null;

	}

	_createView( mode ) {

		const camera = new OrthographicCamera( - 5, 5, 5, - 5, 0.01, 1000 );
		camera.name = `Rayzee ${mode[ 0 ].toUpperCase() + mode.slice( 1 )} View`;
		camera.up.copy( VIEW_DEFINITIONS[ mode ].up );
		const controls = new OrbitControls( camera, this.canvas );
		controls.enabled = false;
		controls.enableRotate = false;
		controls.enablePan = true;
		controls.enableZoom = true;
		controls.screenSpacePanning = true;
		controls.zoomToCursor = true;
		controls.minZoom = 1e-4;
		controls.maxZoom = 1e6;
		controls.addEventListener( 'change', () => {

			if ( this.mode !== mode ) return;
			this._saveState( mode );
			this._updateGrid();
			this._emitChange();
			this.onInvalidate?.();

		} );
		this.cameras[ mode ] = camera;
		this.controls[ mode ] = controls;

	}

	setMode( mode ) {

		if ( ! EDITOR_VIEW_MODES.has( mode ) ) throw new Error( `Unknown editor view: ${mode}` );
		if ( mode === this.mode ) return;
		if ( this.active ) this._saveState( this.mode );
		for ( const controls of Object.values( this.controls ) ) controls.enabled = false;
		this.mode = mode;

		if ( this.active ) {

			const hasState = this._states.has( mode );
			this.activeControls.enabled = true;
			if ( hasState ) this._restoreState( mode );
			else this.frameBounds();
			this._updateGrid( true );

		}

		this._emitChange();
		this.onInvalidate?.();

	}

	setStyle( style ) {

		if ( ! EDITOR_VIEW_STYLES.has( style ) ) throw new Error( `Unknown editor view style: ${style}` );
		if ( style === this.style ) return;
		this.style = style;
		this._emitChange();
		this.onInvalidate?.();

	}

	setGridVisible( visible ) {

		this.gridVisible = Boolean( visible );
		for ( const helper of this._gridHelpers ) helper.visible = this.gridVisible;
		this._emitChange();
		this.onInvalidate?.();

	}

	frameBounds( bounds = this.getBounds?.() ) {

		if ( ! this.active ) return;
		const safeBounds = bounds instanceof Box3 && ! bounds.isEmpty()
			? bounds
			: new Box3( new Vector3( - 0.5, - 0.5, - 0.5 ), new Vector3( 0.5, 0.5, 0.5 ) );
		const center = safeBounds.getCenter( new Vector3() );
		const size = safeBounds.getSize( new Vector3() );
		const def = VIEW_DEFINITIONS[ this.mode ];
		const rect = this.canvas.getBoundingClientRect?.();
		const aspect = Math.max( 1e-6, ( rect?.width || this.canvas.clientWidth || 1 ) / ( rect?.height || this.canvas.clientHeight || 1 ) );
		const width = Math.max( size[ def.planeAxes[ 0 ] ], 1e-3 );
		const height = Math.max( size[ def.planeAxes[ 1 ] ], 1e-3 );
		const halfHeight = Math.max( height, width / aspect, 1 ) * 0.6;
		const depth = Math.max( size.x, size.y, size.z, DEFAULT_SPAN );
		const camera = this.camera;

		camera.left = - halfHeight * aspect;
		camera.right = halfHeight * aspect;
		camera.top = halfHeight;
		camera.bottom = - halfHeight;
		camera.near = Math.max( depth * 0.001, 0.001 );
		camera.far = Math.max( depth * 20, 100 );
		camera.zoom = 1;
		camera.position.copy( center ).addScaledVector( def.positionAxis, depth * 2 );
		camera.up.copy( def.up );
		this.activeControls.target.copy( center );
		camera.lookAt( center );
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld( true );
		this.activeControls.update();
		this._saveState( this.mode );
		this._updateGrid( true );
		this._emitChange();

	}

	update() {

		if ( ! this.active ) return;
		this._fitAspect();
		this.activeControls.update();
		this.camera.updateMatrixWorld( true );
		this._updateGrid();

	}

	render() {

		if ( ! this.active ) return;
		this.update();
		this.realtimeRenderer?.renderEditor( {
			camera: this.camera,
			gridScene: this._gridScene,
			overrideMaterial: this.style === 'wireframe' ? this._wireframeMaterial : this._solidMaterial,
		} );

	}

	_fitAspect() {

		const camera = this.camera;
		const rect = this.canvas.getBoundingClientRect?.();
		const aspect = Math.max( 1e-6, ( rect?.width || this.canvas.clientWidth || 1 ) / ( rect?.height || this.canvas.clientHeight || 1 ) );
		const halfHeight = Math.max( Math.abs( camera.top ), Math.abs( camera.bottom ), 1e-6 );
		const halfWidth = halfHeight * aspect;
		if ( camera.left === - halfWidth && camera.right === halfWidth ) return;
		camera.left = - halfWidth;
		camera.right = halfWidth;
		camera.updateProjectionMatrix();

	}

	_updateGrid( force = false ) {

		if ( ! this.active ) return;
		const camera = this.camera;
		const rect = this.canvas.getBoundingClientRect?.();
		const pixels = Math.max( rect?.height || this.canvas.clientHeight || 1, 1 );
		const visibleHeight = Math.abs( camera.top - camera.bottom ) / Math.max( camera.zoom, 1e-9 );
		const desired = visibleHeight / Math.max( pixels / 48, 1 );
		const exponent = Math.floor( Math.log10( Math.max( desired, 1e-9 ) ) );
		const magnitude = 10 ** exponent;
		const normalized = desired / magnitude;
		this.gridSpacing = ( normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10 ) * magnitude;

		const majorSpacing = this.gridSpacing * GRID_MAJOR_EVERY;
		const target = this.activeControls.target;
		const def = VIEW_DEFINITIONS[ this.mode ];
		const snappedA = Math.round( target[ def.planeAxes[ 0 ] ] / majorSpacing ) * majorSpacing;
		const snappedB = Math.round( target[ def.planeAxes[ 1 ] ] / majorSpacing ) * majorSpacing;
		const key = `${this.mode}:${this.gridSpacing}:${snappedA}:${snappedB}`;
		if ( ! force && key === this._gridKey ) return;
		this._gridKey = key;
		this._clearGrid();

		const size = this.gridSpacing * GRID_CELLS;
		const minor = new GridHelper( size, GRID_CELLS, 0x3b414a, 0x3b414a );
		const major = new GridHelper( size, GRID_CELLS / GRID_MAJOR_EVERY, 0x59616d, 0x59616d );
		for ( const helper of [ minor, major ] ) {

			helper.rotation.set( def.gridRotation.x, def.gridRotation.y, def.gridRotation.z );
			helper.material.transparent = true;
			helper.material.opacity = helper === minor ? 0.32 : 0.62;
			helper.material.depthWrite = false;
			helper.renderOrder = - 10;

		}

		this._positionGrid( minor, snappedA, snappedB );
		this._positionGrid( major, snappedA, snappedB );

		const axes = new AxesHelper( size * 0.5 );
		axes.material.depthWrite = false;
		axes.renderOrder = - 9;
		this._gridHelpers.push( minor, major, axes );
		for ( const helper of this._gridHelpers ) helper.visible = this.gridVisible;
		this._gridScene.add( minor, major, axes );

	}

	_positionGrid( helper, a, b ) {

		if ( this.mode === 'top' ) helper.position.set( a, 0, b );
		else if ( this.mode === 'front' ) helper.position.set( a, b, 0 );
		else helper.position.set( 0, b, a );

	}

	_clearGrid() {

		for ( const helper of this._gridHelpers ) {

			this._gridScene.remove( helper );
			helper.geometry?.dispose();
			if ( Array.isArray( helper.material ) ) helper.material.forEach( material => material.dispose() );
			else helper.material?.dispose();

		}

		this._gridHelpers.length = 0;

	}

	_saveState( mode ) {

		const camera = this.cameras[ mode ];
		const controls = this.controls[ mode ];
		if ( ! camera || ! controls ) return;
		this._states.set( mode, {
			target: controls.target.toArray(),
			position: camera.position.toArray(),
			zoom: camera.zoom,
			halfHeight: Math.abs( camera.top ),
			near: camera.near,
			far: camera.far,
		} );

	}

	_restoreState( mode ) {

		const state = this._states.get( mode );
		const camera = this.cameras[ mode ];
		const controls = this.controls[ mode ];
		if ( ! state || ! camera || ! controls ) return;
		if ( finiteVector( state.target ) ) controls.target.fromArray( state.target );
		if ( finiteVector( state.position ) ) camera.position.fromArray( state.position );
		if ( Number.isFinite( state.zoom ) && state.zoom > 0 ) camera.zoom = state.zoom;
		if ( Number.isFinite( state.halfHeight ) && state.halfHeight > 0 ) {

			camera.top = state.halfHeight;
			camera.bottom = - state.halfHeight;

		}

		if ( Number.isFinite( state.near ) && state.near > 0 ) camera.near = state.near;
		if ( Number.isFinite( state.far ) && state.far > camera.near ) camera.far = state.far;
		camera.up.copy( VIEW_DEFINITIONS[ mode ].up );
		camera.lookAt( controls.target );
		this._fitAspect();
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld( true );
		controls.update();

	}

	getProjectState() {

		if ( this.active ) this._saveState( this.mode );
		return {
			mode: this.mode,
			style: this.style,
			gridVisible: this.gridVisible,
			coordinateSystem: EDITOR_COORDINATE_SYSTEM,
			views: Object.fromEntries( this._states ),
		};

	}

	restoreProjectState( state ) {

		// A manager survives project switches. Drop every view from the previous
		// project before applying the next project's optional workspace state.
		for ( const controls of Object.values( this.controls ) ) controls.enabled = false;
		this.mode = 'perspective';
		this.style = 'solid';
		this.gridVisible = true;
		this._states.clear();
		this._gridKey = '';
		this._clearGrid();
		const restored = state && typeof state === 'object' ? state : {};
		this.gridVisible = restored.gridVisible !== false;
		if ( EDITOR_VIEW_STYLES.has( restored.style ) ) this.style = restored.style;
		for ( const mode of Object.keys( VIEW_DEFINITIONS ) ) {

			const view = restored.views?.[ mode ];
			if ( restored.coordinateSystem === EDITOR_COORDINATE_SYSTEM && view && typeof view === 'object' ) this._states.set( mode, { ...view } );

		}

		const mode = EDITOR_VIEW_MODES.has( restored.mode ) ? restored.mode : 'perspective';
		if ( mode === 'perspective' ) this._emitChange();
		else this.setMode( mode );

	}

	_emitChange() {

		this.onChange?.( {
			type: 'editorViewChanged',
			...this.getProjectState(),
			gridSpacing: this.gridSpacing,
			units: 'm',
		} );

	}

	dispose() {

		for ( const controls of Object.values( this.controls ) ) controls.dispose();
		this._clearGrid();
		this._solidMaterial.dispose();
		this._wireframeMaterial.dispose();
		this.cameras = {};
		this.controls = {};
		this.canvas = null;
		this.realtimeRenderer = null;
		this.scene = null;
		this.getBounds = null;
		this.onChange = null;
		this.onInvalidate = null;

	}

}

export { EDITOR_VIEW_MODES, EDITOR_VIEW_STYLES };
