import { getApp } from '@/lib/appProxy';
import { useStore } from '@/store';
import { mannequinPose, prepareMannequin } from '@/utils/mannequinPoses';
import { mannequinPoseRefit } from '@/utils/mannequinPoseRefit';

let changingPose = false;

export async function setMannequinPose( root, pose ) {

	const app = getApp();
	if ( ! app || ! root || ! mannequinPose( root ) ) throw new Error( 'Select a mannequin first.' );
	if ( changingPose || app._loadingInProgress || useStore.getState().loading.isLoading ) throw new Error( 'Wait for the current scene update to finish.' );
	const previous = mannequinPose( root );
	if ( previous === pose ) return;
	const refit = mannequinPoseRefit( app, root );
	changingPose = true;
	const wasPaused = app.pauseRendering;
	// pauseRendering only gates path tracing; pause() also stops raster/editor
	// frames while pose buffers are updated. Preserve the engine's loop latch.
	const loopWasPaused = app._paused;
	app.pause();
	app.pauseRendering = true;
	try {

		prepareMannequin( root, pose );
		// Topology is unchanged: update only these BLASes, preserving smooth
		// normals, materials, selection, and all unrelated scene buffers.
		app.refitBLASes( refit.indices, refit.positions, refit.normals );
		app.dispatchEvent( { type: 'MannequinPoseChanged', id: root.uuid, pose } );

	} catch ( error ) {

		prepareMannequin( root, previous );
		app.refitBLASes( refit.indices, refit.positions, refit.normals );
		throw error;

	} finally {

		app.pauseRendering = wasPaused;
		changingPose = false;
		app.reset();
		if ( ! loopWasPaused ) app.resume();

	}

}
