/**
 * Post-stack nodes retain native camera matrices/uniform references. Keep that
 * camera identity stable while drawing another independently owned camera,
 * restoring the authoring camera before any asynchronous work/port access.
 */
export function createStudentViewModes( { shotCamera, inspectionCamera } ) {

	if ( ! shotCamera?.isPerspectiveCamera || ! inspectionCamera?.isPerspectiveCamera || shotCamera === inspectionCamera ) throw new TypeError( 'Independent perspective shot and inspection cameras are required.' );
	const backup = shotCamera.clone();
	let mode = 'shot', initialized = false;
	return {
		get mode() {

			return mode;

		},
		setMode( value ) {

			if ( ! [ 'shot', 'inspection' ].includes( value ) ) throw new TypeError( 'Unknown student view mode.' );
			if ( value === 'inspection' && ! initialized ) {

				inspectionCamera.copy( shotCamera, false );
				initialized = true;

			}

			mode = value;

		},
		restoreInspectionCamera( snapshot ) {

			const { transform, projection } = snapshot;
			inspectionCamera.position.fromArray( transform.position );
			inspectionCamera.quaternion.fromArray( transform.quaternion );
			inspectionCamera.scale.fromArray( transform.scale );
			inspectionCamera.visible = transform.visible;
			for ( const [ key, value ] of Object.entries( projection ) ) if ( ! [ 'type', 'clipStart' ].includes( key ) ) inspectionCamera[ key ] = value;
			inspectionCamera.userData.clipStart = projection.clipStart;
			inspectionCamera.updateProjectionMatrix();
			inspectionCamera.updateMatrixWorld( true );
			initialized = true;

		},
		get initialized() {

			return initialized;

		},
		render( paint ) {

			if ( mode === 'shot' ) return paint();
			backup.copy( shotCamera, false );
			try {

				shotCamera.copy( inspectionCamera, false );
				shotCamera.updateMatrixWorld( true );
				return paint();

			} finally {

				shotCamera.copy( backup, false );
				shotCamera.updateMatrixWorld( true );

			}

		},
	};

}
