const poseKey = manager => JSON.stringify( [ manager.camera.position.toArray(), manager.camera.quaternion.toArray(), manager.camera.scale.toArray(), manager.controls.target.toArray() ] );

/**
 * Drives the existing Rayzee CameraManager rather than another control scheme.
 * The host serializes paint with its shot/media operations. No frames are
 * queued while an earlier paint is pending, and idle cameras never repaint.
 */
export function createShotCameraNavigation( {
	cameraManager, paint, capture, onStart = () => {}, onChange = () => {}, onError = () => {},
	requestFrame = callback => requestAnimationFrame( callback ), cancelFrame = handle => cancelAnimationFrame( handle ), settleMs = 120,
} ) {

	let enabled = false, disposed = false, raf = null, generation = 0;
	let activity = false, dirty = false, pendingPaint = false, needsPaint = false;
	let previous = poseKey( cameraManager ), lastChange = 0;
	const fail = error => {

		setEnabled( false );
		try {

			onError( error );

		} catch { /* A host error reporter must not create an unhandled RAF rejection. */ }

	};

	const changed = () => {

		if ( enabled ) activity = true;

	};

	const tick = time => {

		raf = null;
		if ( ! enabled || disposed ) return;
		try {

			if ( activity || cameraManager.navigationActive ) {

				activity = true;
				cameraManager.update();
				const next = poseKey( cameraManager );
				if ( next !== previous ) {

					if ( ! dirty ) onStart();
					previous = next; dirty = true; needsPaint = true; lastChange = time;

				}

				if ( needsPaint && ! pendingPaint ) {

					pendingPaint = true;
					const current = generation;
					Promise.resolve().then( () => {

						if ( enabled && ! disposed && current === generation ) {

							needsPaint = false;
							return paint();

						}

					} ).catch( error => {

						if ( ! disposed && current === generation ) fail( error );

					} ).finally( () => {

						pendingPaint = false;

					} );

				}

				if ( ! cameraManager.navigationActive && ! pendingPaint && ! needsPaint && time - lastChange >= settleMs ) {

					activity = false;
					if ( dirty ) {

						dirty = false;
						const snapshot = capture();
						const current = generation;
						Promise.resolve().then( () => {

							if ( enabled && ! disposed && current === generation ) return onChange( snapshot );

						} ).catch( error => {

							if ( ! disposed && current === generation ) fail( error );

						} );

					}

				}

			}

		} catch ( error ) {

			fail( error );

		}

		if ( enabled && ! disposed ) raf = requestFrame( tick );

	};

	function setEnabled( value ) {

		const next = Boolean( value ) && ! disposed;
		if ( next === enabled ) return;
		enabled = next; generation ++;
		cameraManager.controls.enabled = next;
		activity = false; dirty = false; needsPaint = false;
		previous = poseKey( cameraManager );
		if ( ! next ) {

			if ( raf !== null ) cancelFrame( raf );
			raf = null;
			// CameraManager has no public navigation cancellation API. Its own blur
			// handler clears held keys/buttons and eased velocity without moving
			// the camera. Keep this app integration at one explicit boundary.
			cameraManager._handleNavigationBlur();

		} else raf = requestFrame( tick );

	}

	cameraManager.controls.addEventListener( 'change', changed );
	return {
		setEnabled,
		dispose() {

			setEnabled( false ); disposed = true;
			cameraManager.controls.removeEventListener( 'change', changed );

		},
	};

}
