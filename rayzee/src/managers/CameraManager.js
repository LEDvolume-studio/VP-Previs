import { getCameraClipStart, setCameraRayClip, viewDepth } from './cameraClip.js';
import { Euler, EventDispatcher, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EngineEvents, } from '../EngineEvents.js';
import { AF_DEFAULTS } from '../EngineDefaults.js';

const NAVIGATION_KEYS = new Set( [ 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE' ] );
const CAMERA_SPEED_MULTIPLIERS = [ 0.125, 0.25, 0.5, 1, 2, 4, 8, 16 ];
const DEFAULT_CAMERA_SCALE = Object.freeze( new Vector3( 1, 1, 1 ) );

/**
 * Manages camera creation, switching, auto-focus, and AF point placement.
 *
 * Owns the PerspectiveCamera and OrbitControls instances.
 * Dispatches events that PathTracerApp relays to external consumers.
 */
export class CameraManager extends EventDispatcher {

	/**
	 * @param {HTMLCanvasElement} canvas - Canvas element for orbit controls
	 */
	constructor( canvas ) {

		super();

		const width = canvas.clientWidth;
		const height = canvas.clientHeight;

		this.camera = new PerspectiveCamera( 60, width / height || 1, 0.01, 1000 );
		this.camera.position.set( 0, 0, 5 );

		this.controls = new OrbitControls( this.camera, canvas );
		this.controls.screenSpacePanning = true;
		this.controls.zoomToCursor = true;
		this.controls.saveState();

		// Camera-editor navigation owns mouse gestures; OrbitControls still owns its
		// target, reset state, limits, and programmatic updates.
		this.controls.mouseButtons.LEFT = null;
		this.controls.mouseButtons.MIDDLE = null;
		this.controls.mouseButtons.RIGHT = null;
		this.controls.enableZoom = false;

		this.navigationActive = false;
		this.cameraSpeedLevel = 1;
		this.lookSensitivity = 0.002;
		this.movementAcceleration = 14;
		this.movementDeceleration = 18;
		this._speedBoostActive = false;
		this._navigationKeys = new Set();
		this._pointerButtons = new Set();
		this._navigationLastUpdate = null;
		this._lookDistance = 5;
		this._lookEuler = new Euler( 0, 0, 0, 'YXZ' );
		this._move = new Vector3();
		this._forward = new Vector3();
		this._right = new Vector3();
		this._up = new Vector3();
		this._velocity = new Vector3();
		this._targetVelocity = new Vector3();

		this._handleNavigationKeyDown = this._handleNavigationKeyDown.bind( this );
		this._handleNavigationKeyUp = this._handleNavigationKeyUp.bind( this );
		this._handlePointerDown = this._handlePointerDown.bind( this );
		this._handlePointerMove = this._handlePointerMove.bind( this );
		this._handlePointerUp = this._handlePointerUp.bind( this );
		this._handleNavigationWheel = this._handleNavigationWheel.bind( this );
		this._handleNavigationBlur = this._handleNavigationBlur.bind( this );
		this._preventContextMenu = event => event.preventDefault();
		this._addNavigationListeners();

		this.interactionManager = null;

		/** @type {import('three').PerspectiveCamera[]} */
		this.cameras = [ this.camera ];
		this.currentCameraIndex = 0;

		// Monotonic counter for naming user-added cameras (reset when the list is replaced).
		this._userCameraCounter = 0;

		// Auto-focus state
		this.autoFocusMode = AF_DEFAULTS.SMOOTHING_FACTOR ? 'auto' : 'manual';
		this.afScreenPoint = { x: 0.5, y: 0.5 };
		this.afSmoothingFactor = AF_DEFAULTS.SMOOTHING_FACTOR;
		this._lastValidFocusDistance = null;
		this._smoothedFocusDistance = null;
		this._afPointDirty = false;
		this._afSuspended = false;

		// Saved state for default camera when switching to model cameras
		this._defaultCameraState = null;

		// Callbacks injected by PathTracerApp
		this._onResize = null;
		this._onReset = null;
		this._getSettings = null;
		this._applySettings = null;

	}

	_addNavigationListeners() {

		if ( typeof window === 'undefined' || typeof document === 'undefined' ) return;
		window.addEventListener( 'keydown', this._handleNavigationKeyDown, true );
		window.addEventListener( 'keyup', this._handleNavigationKeyUp, true );
		window.addEventListener( 'pointermove', this._handlePointerMove );
		window.addEventListener( 'pointerup', this._handlePointerUp );
		window.addEventListener( 'blur', this._handleNavigationBlur );
		this.controls.domElement.addEventListener( 'pointerdown', this._handlePointerDown );
		this.controls.domElement.addEventListener( 'wheel', this._handleNavigationWheel, { passive: false } );
		this.controls.domElement.addEventListener( 'contextmenu', this._preventContextMenu );

	}

	_removeNavigationListeners() {

		if ( typeof window === 'undefined' || typeof document === 'undefined' ) return;
		window.removeEventListener( 'keydown', this._handleNavigationKeyDown, true );
		window.removeEventListener( 'keyup', this._handleNavigationKeyUp, true );
		window.removeEventListener( 'pointermove', this._handlePointerMove );
		window.removeEventListener( 'pointerup', this._handlePointerUp );
		window.removeEventListener( 'blur', this._handleNavigationBlur );
		this.controls.domElement.removeEventListener( 'pointerdown', this._handlePointerDown );
		this.controls.domElement.removeEventListener( 'wheel', this._handleNavigationWheel );
		this.controls.domElement.removeEventListener( 'contextmenu', this._preventContextMenu );

	}

	_isEditableTarget( target ) {

		const tagName = target?.tagName;
		return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
			|| target?.isContentEditable || target?.contentEditable === 'true';

	}

	_handleNavigationKeyDown( event ) {

		if ( event.code === 'ShiftLeft' || event.code === 'ShiftRight' ) {

			this._speedBoostActive = true;
			return;

		}

		if ( ! this._pointerButtons.has( 2 ) || ! this.controls.enabled
			|| event.ctrlKey || event.altKey || event.metaKey
			|| this._isEditableTarget( event.target ) ) return;

		if ( ! NAVIGATION_KEYS.has( event.code ) ) return;
		this._speedBoostActive = event.shiftKey;
		const isNewKey = ! this._navigationKeys.has( event.code );
		this._navigationKeys.add( event.code );
		event.preventDefault();
		event.stopPropagation();
		if ( isNewKey ) {

			this._navigationLastUpdate = typeof performance !== 'undefined' ? performance.now() : Date.now();
			this._notifyNavigationChange();

		}

	}

	_handleNavigationKeyUp( event ) {

		if ( event.code === 'ShiftLeft' || event.code === 'ShiftRight' ) {

			this._speedBoostActive = false;
			return;

		}

		if ( ! this._navigationKeys.delete( event.code ) ) return;
		event.preventDefault();
		event.stopPropagation();
		if ( this._velocity.lengthSq() > 0 ) this._notifyNavigationChange();

	}

	_handlePointerDown( event ) {

		if ( ! this.controls.enabled || ! [ 0, 1, 2 ].includes( event.button ) ) return;
		this._pointerButtons.add( event.button );
		this.navigationActive = true;
		this._navigationLastUpdate = typeof performance !== 'undefined' ? performance.now() : Date.now();
		this._updateLookDistance();
		this.controls.domElement.style.cursor = 'grabbing';
		if ( event.button !== 0 ) event.preventDefault();

	}

	_handlePointerMove( event ) {

		if ( ! this.navigationActive || ! this.controls.enabled ) return;
		const left = this._pointerButtons.has( 0 );
		const middle = this._pointerButtons.has( 1 );
		const right = this._pointerButtons.has( 2 );
		if ( ! left && ! middle && ! right ) return;

		event.preventDefault();
		if ( middle || ( left && right ) ) this._pan( event.movementX, event.movementY );
		else if ( right ) this._lookAround( event.movementX, event.movementY );
		else if ( left ) this._dolly( event.movementY );

	}

	_handlePointerUp( event ) {

		this._pointerButtons.delete( event.button );
		if ( event.button === 2 ) this._navigationKeys.clear();
		if ( this._pointerButtons.size > 0 ) return;
		this.navigationActive = false;
		this._navigationKeys.clear();
		this._speedBoostActive = false;
		if ( this._velocity.lengthSq() > 0 ) {

			this._navigationLastUpdate = typeof performance !== 'undefined' ? performance.now() : Date.now();
			this._notifyNavigationChange();

		} else {

			this._navigationLastUpdate = null;

		}

		if ( this.controls.domElement?.style ) this.controls.domElement.style.cursor = '';

	}

	_handleNavigationWheel( event ) {

		event.preventDefault();
		this.adjustCameraSpeed( event.deltaY < 0 ? 1 : - 1 );

	}

	_handleNavigationBlur() {

		this._pointerButtons.clear();
		this._navigationKeys.clear();
		this.navigationActive = false;
		this._speedBoostActive = false;
		this._navigationLastUpdate = null;
		this._velocity.set( 0, 0, 0 );
		this._targetVelocity.set( 0, 0, 0 );
		if ( this.controls.domElement?.style ) this.controls.domElement.style.cursor = '';

	}

	/** Set the displayed camera speed level (1-8). */
	setCameraSpeedLevel( level ) {

		if ( ! Number.isFinite( level ) ) return;
		const nextLevel = MathUtils.clamp( Math.round( level ), 1, CAMERA_SPEED_MULTIPLIERS.length );
		if ( nextLevel === this.cameraSpeedLevel ) return;
		this.cameraSpeedLevel = nextLevel;
		this.dispatchEvent( { type: 'CameraSpeedChanged', level: nextLevel } );

	}

	/** Increase or decrease the camera speed by a number of levels. */
	adjustCameraSpeed( delta ) {

		this.setCameraSpeedLevel( this.cameraSpeedLevel + delta );

	}

	_updateLookDistance() {

		const distance = this.camera.position.distanceTo?.( this.controls.target );
		this._lookDistance = Number.isFinite( distance ) && distance > 0 ? distance : 5;

	}

	_getMovementSpeed() {

		const baseSpeed = Math.max( this._lookDistance * 0.75, this.camera.near * 10, 0.1 );
		const levelMultiplier = CAMERA_SPEED_MULTIPLIERS[ this.cameraSpeedLevel - 1 ];
		return baseSpeed * levelMultiplier * ( this._speedBoostActive ? 2 : 1 );

	}

	_notifyNavigationChange() {

		this.controls.dispatchEvent( { type: 'change' } );

	}

	_translate( movement ) {

		this.camera.position.add( movement );
		this.controls.target.add( movement );
		this.controls.update();

	}

	_lookAround( movementX, movementY ) {

		this._lookEuler.setFromQuaternion( this.camera.quaternion );
		this._lookEuler.y -= movementX * this.lookSensitivity;
		this._lookEuler.x -= movementY * this.lookSensitivity;
		this._lookEuler.x = MathUtils.clamp( this._lookEuler.x, - Math.PI / 2, Math.PI / 2 );
		this.camera.quaternion.setFromEuler( this._lookEuler );
		this._forward.set( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );
		this.controls.target.copy( this.camera.position ).addScaledVector( this._forward, this._lookDistance );
		this.controls.update();

	}

	_dolly( movementY ) {

		this._forward.set( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );
		this._move.copy( this._forward ).multiplyScalar( - movementY * this._getMovementSpeed() * 0.01 );
		this._translate( this._move );

	}

	_pan( movementX, movementY ) {

		this._right.set( 1, 0, 0 ).applyQuaternion( this.camera.quaternion );
		this._up.set( 0, 1, 0 ).applyQuaternion( this.camera.quaternion );
		this._move.copy( this._right ).multiplyScalar( - movementX )
			.addScaledVector( this._up, movementY ).multiplyScalar( this._lookDistance * 0.002 );
		this._translate( this._move );

	}

	/** Update OrbitControls and eased, RMB-gated keyboard movement once per frame. */
	update() {

		this.controls.update();

		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		if ( this._navigationLastUpdate === null ) return;
		const deltaSeconds = Math.min( ( now - this._navigationLastUpdate ) / 1000, 0.1 );
		this._navigationLastUpdate = now;

		const acceptsInput = this.navigationActive && this._pointerButtons.has( 2 ) && this.controls.enabled;
		const forwardAmount = acceptsInput
			? Number( this._navigationKeys.has( 'KeyW' ) ) - Number( this._navigationKeys.has( 'KeyS' ) ) : 0;
		const rightAmount = acceptsInput
			? Number( this._navigationKeys.has( 'KeyD' ) ) - Number( this._navigationKeys.has( 'KeyA' ) ) : 0;
		const upAmount = acceptsInput
			? Number( this._navigationKeys.has( 'KeyE' ) ) - Number( this._navigationKeys.has( 'KeyQ' ) ) : 0;
		const hasInput = forwardAmount !== 0 || rightAmount !== 0 || upAmount !== 0;

		this._targetVelocity.set( 0, 0, 0 );
		if ( hasInput ) {

			this._forward.set( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );
			this._right.set( 1, 0, 0 ).applyQuaternion( this.camera.quaternion );
			this._targetVelocity.copy( this._forward ).multiplyScalar( forwardAmount )
				.addScaledVector( this._right, rightAmount )
				.addScaledVector( this._up.set( 0, 1, 0 ), upAmount )
				.normalize().multiplyScalar( this._getMovementSpeed() );

		}

		const response = hasInput ? this.movementAcceleration : this.movementDeceleration;
		this._velocity.lerp( this._targetVelocity, 1 - Math.exp( - response * deltaSeconds ) );
		if ( ! hasInput && this._velocity.lengthSq() < 1e-6 ) {

			this._velocity.set( 0, 0, 0 );
			this._navigationLastUpdate = null;
			return;

		}

		this._move.copy( this._velocity ).multiplyScalar( deltaSeconds );
		if ( this._move.lengthSq() > 0 ) this._translate( this._move );

	}

	/**
	 * Sets the list of available cameras (default + extracted from model).
	 * @param {import('three').PerspectiveCamera[]} cameras
	 */
	setCameras( cameras ) {

		this.cameras = cameras;
		this.camera.userData ||= {};
		this.camera.userData.clipStart = 0;
		this._userCameraCounter = 0;
		this.resetAutoFocus();

	}

	/**
	 * Adds a new user camera that snapshots the current render camera's pose,
	 * FOV, clip planes, and orbit target. The snapshot is a standalone template
	 * appended to the list; switching to it restores this exact framing.
	 *
	 * @param {string} [name] - Optional display name (auto-generated otherwise).
	 * @returns {number} The index of the newly added camera.
	 */
	addCameraFromView( name ) {

		const src = this.camera;
		const cam = new PerspectiveCamera( src.fov, src.aspect, src.near, src.far );
		cam.position.copy( src.position );
		cam.quaternion.copy( src.quaternion );
		cam.scale.copy( src.scale );
		cam.updateMatrixWorld( true );

		cam.userData.clipStart = getCameraClipStart( src );
		cam.userData.__rayzeeUserCamera = true;
		cam.userData.__rayzeeEffects = this._captureEffects();
		if ( this.controls ) cam.userData.__rayzeeOrbitTarget = this.controls.target.clone();

		this._userCameraCounter += 1;
		cam.name = name || `View Camera ${this._userCameraCounter}`;

		this.cameras.push( cam );
		return this.cameras.length - 1;

	}

	/**
	 * Removes a user-added camera by index. Built-in (index 0) and
	 * model-embedded cameras are protected and cannot be removed.
	 * If the active camera is removed, falls back to the default camera.
	 *
	 * @param {number} index
	 * @returns {boolean} true if a camera was removed.
	 */
	removeCamera( index ) {

		if ( ! Number.isInteger( index ) || index <= 0 || index >= this.cameras.length ) return false;
		if ( ! this.cameras[ index ]?.userData?.__rayzeeUserCamera ) return false;

		const wasActive = this.currentCameraIndex === index;
		this.cameras.splice( index, 1 );

		if ( wasActive ) {

			// The active camera is gone. Invalidate currentCameraIndex before falling
			// back so switchCamera(0) skips both the (deleted) outgoing-effects save and
			// the default-state save, and runs the restore path instead.
			this.currentCameraIndex = - 1;
			this.switchCamera( 0 );

		} else if ( this.currentCameraIndex > index ) {

			// Indices after the removed slot shift down by one.
			this.currentCameraIndex -= 1;

		}

		return true;

	}

	/**
	 * Returns display names for all available cameras.
	 * @returns {string[]}
	 */
	getCameraNames() {

		if ( ! this.cameras || this.cameras.length === 0 ) return [ 'Default Camera' ];

		return this.cameras.map( ( cam, index ) => {

			if ( index === 0 ) return 'Default Camera';
			return cam.name || `Camera ${index}`;

		} );

	}

	/**
	 * Stores callbacks for camera operations (resize, reset, settings access).
	 * Call once after all managers are ready.
	 *
	 * @param {Object} callbacks
	 * @param {Function} callbacks.onResize     - Trigger viewport resize
	 * @param {Function} callbacks.onReset      - Trigger accumulation reset
	 * @param {Function} callbacks.getSettings  - (key) => value
	 * @param {Function} callbacks.applySettings - (updates) => void, batch-writes render settings
	 */
	initCallbacks( { onResize, onReset, getSettings, applySettings } ) {

		this._onResize = onResize;
		this._onReset = onReset;
		this._getSettings = getSettings;
		this._applySettings = applySettings;

	}

	// ── Per-camera effects (DOF / focus) ──────────────────────────
	// Each camera keeps its own depth-of-field + focus configuration so effects
	// defined on one camera don't leak to another. State is stored on the camera
	// object's userData and swapped in/out on switchCamera().

	/**
	 * Snapshot the current global DOF/focus settings into a plain object.
	 * focusDistance is stored scaled (as held in RenderSettings).
	 * @returns {Object|null}
	 */
	_captureEffects() {

		const get = this._getSettings;
		if ( ! get ) return null;

		return {
			enableDOF: get( 'enableDOF' ),
			focusDistance: get( 'focusDistance' ),
			aperture: get( 'aperture' ),
			focalLength: get( 'focalLength' ),
			apertureScale: get( 'apertureScale' ),
			anamorphicRatio: get( 'anamorphicRatio' ),
			dofMode: get( 'dofMode' ) ?? 'legacy',
			dofBlur: get( 'dofBlur' ) ?? 0.05,
			unitsPerMetre: get( 'unitsPerMetre' ) ?? 1,
			autoFocusMode: this.autoFocusMode,
			afScreenPoint: { ...this.afScreenPoint },
		};

	}

	/**
	 * Apply a previously-captured effects object to the global settings + focus state.
	 * @param {Object} [eff]
	 */
	_applyEffects( eff ) {

		if ( ! eff ) return;

		this._applySettings?.( {
			enableDOF: eff.enableDOF,
			focusDistance: eff.focusDistance,
			aperture: eff.aperture,
			focalLength: eff.focalLength,
			apertureScale: eff.apertureScale,
			anamorphicRatio: eff.anamorphicRatio,
			dofMode: eff.dofMode ?? 'legacy',
			dofBlur: eff.dofBlur ?? 0.05,
			unitsPerMetre: eff.unitsPerMetre ?? 1,
		} );

		if ( eff.autoFocusMode !== undefined ) this.setAutoFocusMode( eff.autoFocusMode );
		if ( eff.afScreenPoint ) this.setAFScreenPoint( eff.afScreenPoint.x, eff.afScreenPoint.y );

	}

	/** Scene scale used to convert scaled focusDistance to UI-facing units. */
	_getSceneScale() {

		return this._afContext?.assetLoader?.getSceneScale?.() || 1;

	}

	/**
	 * Switches the active camera by index.
	 * Uses stored callbacks from initCallbacks() for resize/reset.
	 * @param {number} index
	 * @param {number} [focusDistance] - Override focus distance (falls back to settings)
	 * @param {Function} [onResize]   - Override resize callback
	 * @param {Function} [onReset]    - Override reset callback
	 */
	switchCamera( index, focusDistance, onResize, onReset ) {

		// Use stored callbacks if not provided (backward-compatible signature)
		focusDistance = focusDistance ?? this._getSettings?.( 'focusDistance' );
		onResize = onResize ?? this._onResize;
		onReset = onReset ?? this._onReset;

		if ( ! this.cameras || this.cameras.length === 0 ) return;

		if ( index < 0 || index >= this.cameras.length ) {

			console.warn( `CameraManager: Invalid camera index ${index}. Using default camera.` );
			index = 0;

		}

		// Save the outgoing camera's DOF/focus effects so they can be restored later.
		const outgoing = this.cameras[ this.currentCameraIndex ];
		if ( outgoing ) outgoing.userData.__rayzeeEffects = this._captureEffects();

		// Save default camera state before switching away from it
		if ( this.currentCameraIndex === 0 && index !== 0 ) {

			this._defaultCameraState = {
				position: this.camera.position.clone(),
				quaternion: this.camera.quaternion.clone(),
				scale: this.camera.scale.clone(),
				fov: this.camera.fov,
				near: this.camera.near,
				far: this.camera.far,
				target: this.controls ? this.controls.target.clone() : null,
			};

		}

		this.currentCameraIndex = index;

		if ( index === 0 && this._defaultCameraState ) {

			// Restore the default camera to its state before the switch
			const s = this._defaultCameraState;
			this.camera.position.copy( s.position );
			this.camera.quaternion.copy( s.quaternion );
			// Clears a mirror picked up from an imported camera; older saved states
			// predate the field and are unmirrored by definition.
			this.camera.scale.copy( s.scale ?? DEFAULT_CAMERA_SCALE );
			this.camera.fov = s.fov;
			this.camera.near = s.near;
			this.camera.far = s.far;
			this.camera.userData.clipStart = 0;
			this.camera.updateProjectionMatrix();
			this.camera.updateMatrixWorld( true );

			if ( this.controls && s.target ) {

				this.controls.target.copy( s.target );
				this.controls.update();

			}

		} else {

			const sourceCamera = this.cameras[ index ];

			this.camera.position.copy( sourceCamera.position );
			this.camera.quaternion.copy( sourceCamera.quaternion );
			// An imported camera can carry a mirror (a negative axis scale) that no
			// quaternion can express — a pbrt scene's `Scale -1 1 1`, for one. Copying
			// pose alone would silently un-mirror the view.
			this.camera.scale.copy( sourceCamera.scale );
			this.camera.fov = sourceCamera.fov;
			this.camera.near = sourceCamera.near;
			this.camera.far = sourceCamera.far;
			this.camera.userData ||= {};
			this.camera.userData.clipStart = getCameraClipStart( sourceCamera );
			this.camera.updateProjectionMatrix();
			this.camera.updateMatrixWorld( true );

			// Restore the saved orbit target for user cameras; otherwise place it
			// along the forward direction at the focus distance.
			if ( this.controls ) {

				const savedTarget = sourceCamera.userData?.__rayzeeOrbitTarget;
				if ( savedTarget ) {

					this.controls.target.copy( savedTarget );

				} else {

					const forward = new Vector3( 0, 0, - 1 ).applyQuaternion( sourceCamera.quaternion );
					const focusDist = focusDistance || 5.0;
					this.controls.target.copy( this.camera.position ).addScaledVector( forward, focusDist );

				}

				this.controls.update();

			}

		}

		this.resetAutoFocus();

		// Restore the incoming camera's own DOF/focus effects (if it has any saved;
		// otherwise it inherits the current global config).
		this._applyEffects( this.cameras[ index ]?.userData?.__rayzeeEffects );

		onResize?.();
		onReset?.();

		// Emit UI-facing effects: focusDistance unscaled (matching AUTO_FOCUS_UPDATED),
		// so the adapter is a plain passthrough with no scene-scale awareness.
		const effects = this._captureEffects();
		if ( effects && ( effects.dofMode ?? 'legacy' ) === 'legacy' ) effects.focusDistance /= this._getSceneScale();
		this.dispatchEvent( { type: 'CameraSwitched', cameraIndex: index, effects, fov: this.camera.fov } );

	}

	/**
	 * Focuses the orbit camera on a world-space point.
	 * @param {import('three').Vector3} center
	 */
	focusOn( center ) {

		if ( ! center || ! this.controls ) return;
		this.controls.target.copy( center );
		this.controls.update();
		this._onReset?.();

	}

	// ── Aliases (match Sub-API surface) ───────────────────────────

	/** The active Three.js PerspectiveCamera. */
	get active() {

		return this.camera;

	}

	/** @see getCameraNames */
	getNames() {

		return this.getCameraNames();

	}

	// ── Auto-Focus ────────────────────────────────────────────────

	setAutoFocusMode( mode ) {

		this.autoFocusMode = mode;

		if ( mode !== 'manual' ) {

			this._smoothedFocusDistance = null;
			this._afPointDirty = true;

		}

	}

	/** Reset focus history after a scene, camera, or lens-model change. */
	resetAutoFocus() {

		this._lastValidFocusDistance = null;
		this._smoothedFocusDistance = null;
		this._afPointDirty = true;

	}

	setAFScreenPoint( x, y ) {

		this.afScreenPoint = { x, y };
		this._afPointDirty = true;

	}

	enterAFPointPlacementMode() {

		if ( ! this.interactionManager ) return;
		this.interactionManager.enterAFPointPlacementMode();
		if ( this.controls ) this.controls.enabled = false;

	}

	exitAFPointPlacementMode() {

		if ( ! this.interactionManager ) return;
		this.interactionManager.exitAFPointPlacementMode();
		if ( this.controls ) this.controls.enabled = true;

	}

	/**
	 * Per-frame auto-focus update. Called in animate() before pipeline.render().
	 *
	 * @param {Object} params
	 * @param {import('three').Scene} params.meshScene
	 * @param {Object} params.assetLoader
	 * @param {import('three').Mesh} params.floorPlane
	 * @param {number} params.currentFocusDistance
	 * @param {import('../Stages/PathTracer.js').PathTracer} params.pathTracer
	 * @param {Function} params.setFocusDistance - Callback to update uniform + settings
	 * @param {Function} params.softReset       - Callback for soft accumulation reset
	 * @param {Function} params.hardReset       - Callback for hard accumulation reset
	 */
	updateAutoFocus( ctx ) {

		const { meshScene, assetLoader, floorPlane, currentFocusDistance, pathTracer, setFocusDistance, softReset, hardReset } = ctx || this._afContext || {};
		if ( ! meshScene ) return;

		if ( this.autoFocusMode === 'manual' ) return;

		// Depth-of-field is the only consumer of the auto-focus distance. With DOF
		// off (the default) the per-frame scene raycast is pure waste, so skip it.
		// Re-snap on the frame DOF turns back on so focus is correct immediately
		// rather than racking from a stale smoothed value.
		if ( ! pathTracer?.enableDOF?.value || pathTracer.cameraProjection?.value === 1 ) {

			this._afSuspended = true;
			return;

		}

		if ( this._afSuspended ) {

			this._afSuspended = false;
			this._smoothedFocusDistance = null;

		}

		// Lock focus during active tiled final rendering
		const stage = pathTracer;
		if ( stage?.isReady
			&& stage.renderMode?.value === 1
			&& stage.frameCount > 0
			&& ! stage.isComplete ) return;

		// Convert AF screen point (normalized 0-1) to NDC (-1 to 1)
		const ndcX = this.afScreenPoint.x * 2 - 1;
		const ndcY = - ( this.afScreenPoint.y * 2 - 1 );

		const raycaster = this.interactionManager?.raycaster;
		if ( ! raycaster ) return;

		raycaster.setFromCamera( { x: ndcX, y: ndcY }, this.camera );
		setCameraRayClip( raycaster, this.camera );
		const intersects = raycaster.intersectObjects( meshScene.children, true );

		const validHit = intersects.find( hit =>
			hit.object !== this.interactionManager?.focusPointIndicator &&
			hit.object !== floorPlane &&
			! hit.object.name.includes( 'Helper' ) &&
			hit.object.type === 'Mesh'
		);

		const legacy = pathTracer?.dofMode?.value === undefined || pathTracer.dofMode.value === 2;
		let rawDistance;
		if ( validHit ) {

			rawDistance = legacy ? validHit.distance : viewDepth( validHit.point, this.camera );
			this._lastValidFocusDistance = rawDistance;

		} else {

			if ( this._lastValidFocusDistance !== null ) {

				rawDistance = this._lastValidFocusDistance;

			} else {

				const scale = assetLoader?.getSceneScale() || 1.0;
				const targetDepth = ! legacy && this.controls ? viewDepth( this.controls.target, this.camera ) : 0;
				rawDistance = targetDepth > 0 ? targetDepth : AF_DEFAULTS.FALLBACK_DISTANCE * scale;
				this._lastValidFocusDistance = rawDistance;

			}

		}

		const forceReset = this._afPointDirty;
		this._afPointDirty = false;

		// Temporal smoothing
		if ( forceReset || this._smoothedFocusDistance === null || this._smoothedFocusDistance === 0 ) {

			this._smoothedFocusDistance = rawDistance;

		} else {

			const changeFraction = Math.abs( rawDistance - this._smoothedFocusDistance )
				/ this._smoothedFocusDistance;

			if ( changeFraction > AF_DEFAULTS.SNAP_THRESHOLD ) {

				this._smoothedFocusDistance = rawDistance;

			} else {

				this._smoothedFocusDistance += this.afSmoothingFactor
					* ( rawDistance - this._smoothedFocusDistance );

			}

		}

		const prevFocus = currentFocusDistance;
		const newFocus = this._smoothedFocusDistance;

		if ( forceReset || prevFocus === 0 || Math.abs( newFocus - prevFocus ) / Math.max( prevFocus, 0.001 ) > 0.001 ) {

			setFocusDistance( newFocus );

			// Update store for UI display (unscaled value)
			const scale = assetLoader?.getSceneScale() || 1.0;
			this.dispatchEvent( { type: EngineEvents.AUTO_FOCUS_UPDATED, distance: legacy ? newFocus / scale : newFocus, worldDistance: newFocus } );

			const changeRatio = Math.abs( newFocus - prevFocus ) / Math.max( prevFocus, 0.001 );
			if ( forceReset ) {

				hardReset?.();

			} else if ( changeRatio > AF_DEFAULTS.RESET_THRESHOLD ) {

				softReset?.();

			}

		}

	}

	/**
	 * Deferred dependency injection — InteractionManager needs the camera
	 * in its constructor, so it can't be passed during CameraManager creation.
	 * @param {import('./InteractionManager.js').InteractionManager} interactionManager
	 */
	setInteractionManager( interactionManager ) {

		this.interactionManager = interactionManager;

	}

	/**
	 * Initialises the stable auto-focus context. Call once after all
	 * managers and stages are ready. CameraManager stores the context
	 * and `updateAutoFocus()` reads from it each frame — no per-frame allocation.
	 *
	 * @param {Object} deps
	 * @param {import('three').Scene}           deps.meshScene
	 * @param {import('../Processor/AssetLoader.js').AssetLoader} deps.assetLoader
	 * @param {import('three').Mesh}            deps.floorPlane
	 * @param {import('../Stages/PathTracer.js').PathTracer} deps.pathTracer
	 * @param {import('../RenderSettings.js').RenderSettings} deps.settings
	 * @param {Function}                        deps.softReset
	 * @param {Function}                        deps.hardReset
	 */
	initAutoFocus( { meshScene, assetLoader, floorPlane, pathTracer, settings, softReset, hardReset } ) {

		this._afContext = {
			meshScene,
			assetLoader,
			floorPlane,
			pathTracer,
			setFocusDistance: ( d ) => settings.set( 'focusDistance', d, { silent: true } ),
			softReset,
			hardReset,
		};

		// Live getter — reads current value without allocation
		Object.defineProperty( this._afContext, 'currentFocusDistance', {
			get: () => settings.get( 'focusDistance' ),
		} );

	}

	/** Return a JSON-safe snapshot of every camera and the live render view. */
	getProjectState() {

		const vector = value => value?.toArray?.() || null;
		const effects = value => value ? {
			...value,
			afScreenPoint: value.afScreenPoint ? { ...value.afScreenPoint } : undefined,
		} : null;
		const describe = camera => ( {
			name: camera.name || '',
			position: vector( camera.position ),
			quaternion: vector( camera.quaternion ),
			fov: camera.fov,
			near: camera.near,
			far: camera.far,
			clipStart: getCameraClipStart( camera ),
			isUserCamera: !! camera.userData?.__rayzeeUserCamera,
			orbitTarget: vector( camera.userData?.__rayzeeOrbitTarget ),
			effects: effects( camera.userData?.__rayzeeEffects ),
		} );

		return {
			activeIndex: this.currentCameraIndex,
			active: {
				...describe( this.camera ),
				orbitTarget: vector( this.controls?.target ),
				effects: effects( this._captureEffects() ),
			},
			cameras: this.cameras.map( describe ),
			autoFocusMode: this.autoFocusMode,
			afScreenPoint: { ...this.afScreenPoint },
			afSmoothingFactor: this.afSmoothingFactor,
		};

	}

	/** Restore a snapshot produced by getProjectState after scene cameras are loaded. */
	restoreProjectState( state ) {

		if ( ! state?.active ) return false;
		const apply = ( camera, descriptor ) => {

			if ( ! camera || ! descriptor ) return;
			if ( descriptor.position ) camera.position.fromArray( descriptor.position );
			if ( descriptor.quaternion ) camera.quaternion.fromArray( descriptor.quaternion );
			if ( Number.isFinite( descriptor.fov ) ) camera.fov = descriptor.fov;
			if ( Number.isFinite( descriptor.near ) ) camera.near = descriptor.near;
			if ( Number.isFinite( descriptor.far ) ) camera.far = descriptor.far;
			if ( descriptor.name ) camera.name = descriptor.name;
			// Older projects have no clipStart; preserve the imported camera's metadata.
			if ( Number.isFinite( descriptor.clipStart ) ) camera.userData.clipStart = Math.max( 0, descriptor.clipStart );
			camera.userData.__rayzeeEffects = descriptor.effects ? { ...descriptor.effects } : null;
			if ( descriptor.orbitTarget ) camera.userData.__rayzeeOrbitTarget = new Vector3().fromArray( descriptor.orbitTarget );
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld( true );

		};

		const saved = Array.isArray( state.cameras ) ? state.cameras : [];
		const sourceCameraCount = this.cameras.filter( camera => ! camera.userData?.__rayzeeUserCamera ).length;
		this.cameras = this.cameras.slice( 0, sourceCameraCount );
		for ( let i = 0; i < Math.min( sourceCameraCount, saved.length ); i ++ ) apply( this.cameras[ i ], saved[ i ] );
		for ( const descriptor of saved.filter( camera => camera.isUserCamera ) ) {

			const camera = new PerspectiveCamera();
			camera.userData.__rayzeeUserCamera = true;
			apply( camera, descriptor );
			this.cameras.push( camera );

		}

		this.autoFocusMode = state.autoFocusMode || 'manual';
		if ( state.afScreenPoint ) this.afScreenPoint = { ...state.afScreenPoint };
		if ( Number.isFinite( state.afSmoothingFactor ) ) this.afSmoothingFactor = state.afSmoothingFactor;
		apply( this.camera, state.active );
		if ( state.active.orbitTarget && this.controls ) {

			this.controls.target.fromArray( state.active.orbitTarget );
			this.controls.update();

		}

		this._applyEffects( state.active.effects );
		this.currentCameraIndex = Math.min( Math.max( 0, state.activeIndex || 0 ), this.cameras.length - 1 );
		this._onReset?.();
		return true;

	}

	dispose() {

		this._removeNavigationListeners();
		this._handleNavigationBlur();
		this.controls?.dispose();

	}

}
