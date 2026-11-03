import { Box3, MathUtils, Vector3 } from 'three';

// Size is derived in world axes; transforms remain local to each node's parent.
// Include hidden geometry so toggling visibility does not change asset dimensions.
export function readObjectAttributes( object ) {

	object.updateWorldMatrix( true, true );
	const bounds = new Box3().setFromObject( object, true );
	return {
		position: object.position.toArray(),
		rotation: [ object.rotation.x, object.rotation.y, object.rotation.z ].map( MathUtils.radToDeg ),
		scale: object.scale.toArray(),
		size: bounds.isEmpty() ? null : bounds.getSize( new Vector3() ).toArray(),
	};

}

export function editObjectAttribute( app, object, property, axis, value ) {

	if ( ! app?.transformManager?.applyObjectTransform || ! object || object.isLight ) return false;
	if ( ! [ 'position', 'rotation', 'scale' ].includes( property ) || ! [ 'x', 'y', 'z' ].includes( axis ) ) return false;
	if ( ! Number.isFinite( value ) || ( property === 'scale' && Math.abs( value ) < 1e-8 ) ) return false;
	const next = property === 'rotation' ? MathUtils.degToRad( value ) : value;
	if ( object[ property ][ axis ] === next ) return true;
	app.dispatchEvent( { type: 'engine:objectTransformStart', object } );
	object[ property ][ axis ] = next;
	// Imported matrix-authored nodes must also persist their edits through TRS.
	object.updateMatrix();
	object.updateWorldMatrix( true, true );
	app.transformManager.applyObjectTransform( object );
	app.dispatchEvent( { type: 'engine:objectTransformEnd', object } );
	return true;

}
