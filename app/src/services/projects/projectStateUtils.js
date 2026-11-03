import { applyMeshPose, isPoseMesh } from '@/utils/mannequinPoses';

export function hasChangedKeys( next, previous, keys ) {

	for ( const key of keys ) if ( next[ key ] !== previous[ key ] ) return true;
	return false;

}

const WORKING_PROJECT_PATTERN = /^New Project (\d+)$/i;

export function nextWorkingProjectName( projects ) {

	let highest = 0;
	for ( const project of projects ) {

		const match = project.name?.match?.( WORKING_PROJECT_PATTERN );
		highest = Math.max(
			highest,
			Number( match?.[ 1 ] ) || 0,
			Number( project.extensions?.workingCopyNumber ) || 0
		);

	}

	return `New Project ${String( highest + 1 ).padStart( 2, '0' )}`;

}

export function createDefaultReplacement( captured, existingDefault, updatedAt = new Date().toISOString() ) {

	const { lastOpenedAt: _lastOpenedAt, importedFromProjectId: _importedFromProjectId, ...durable } = captured;
	const extensions = { ...durable.extensions };
	delete extensions.workingCopyNumber;
	return {
		...durable,
		projectId: existingDefault.projectId,
		name: existingDefault.name,
		createdAt: existingDefault.createdAt,
		updatedAt,
		revision: ( existingDefault.revision || 0 ) + 1,
		extensions,
	};

}

export function captureNodeTransform( node ) {

	return {
		name: node.name || '',
		position: node.position.toArray(),
		quaternion: node.quaternion.toArray(),
		scale: node.scale.toArray(),
		visible: node.visible,
		...( isPoseMesh( node ) ? { pose: node.userData.rayzeePose || 'standing' } : {} ),
	};

}

export function restoreNodeTransform( node, state ) {

	if ( state.position ) node.position.fromArray( state.position );
	if ( state.quaternion ) node.quaternion.fromArray( state.quaternion );
	if ( state.scale ) node.scale.fromArray( state.scale );
	// Keep matrix-authored imports consistent with restored local TRS.
	node.updateMatrix?.();
	node.visible = state.visible !== false;
	if ( state.name ) node.name = state.name;
	if ( isPoseMesh( node ) ) applyMeshPose( node, state.pose || 'standing' );

}
