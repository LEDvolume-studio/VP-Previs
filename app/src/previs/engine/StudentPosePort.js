import { isPoseMesh, mannequinPose, prepareMannequin } from '../../utils/mannequinPoses.js';

/** Raster pose bridge. Door hinge TRS is owned by the scene port, never applied
 * twice here. Only explicit verified model roots may own a human pose label.
 * The raster renderer consumes the real updated geometry; no path-tracer BVH
 * or admin store is present in this independent viewport.
 */
export function createStudentPosePort( { nodeObjects, humanRoots = new Set(), onGeometryChanged = () => {} } ) {

	const nodes = new Map( nodeObjects );
	const roots = new Set( humanRoots );
	for ( const id of roots ) if ( ! nodes.has( id ) || mannequinPose( nodes.get( id ) ) === null ) throw new Error( 'A human pose root requires a verified ready mannequin rig' );
	for ( const id of roots ) nodes.get( id ).traverse( object => {

		if ( ! isPoseMesh( object ) ) return;
		for ( const pose of [ 'standing', 'sitting' ] ) {

			const index = object.morphTargetDictionary?.[ pose ];
			for ( const name of [ 'position', 'normal' ] ) {

				const base = object.geometry?.getAttribute( name );
				const morph = object.geometry?.morphAttributes[ name ]?.[ index ];
				if ( ! base || ! morph || base.count !== morph.count || ! Array.isArray( object.morphTargetInfluences ) ) throw new Error( 'A ready mannequin requires complete standing/sitting pose geometry' );

			}

		}

	} );
	const read = () => Object.fromEntries( [ ...nodes ].map( ( [ id, object ] ) => [ id, { humanPose: roots.has( id ) ? mannequinPose( object ) : null, doorAngles: {} } ] ) );
	const validate = values => {

		if ( ! values || Object.keys( values ).length !== nodes.size ) throw new Error( 'Pose inventory does not match the ready scene' );
		for ( const [ id, value ] of Object.entries( values ) ) {

			if ( ! nodes.has( id ) || ! value || Object.keys( value.doorAngles || {} ).length ) throw new Error( 'Door angles require a rig-specific converter; mapped hinge transforms remain authoritative' );
			if ( roots.has( id ) ? ! [ 'standing', 'sitting' ].includes( value.humanPose ) : value.humanPose !== null ) throw new Error( 'Unsupported human pose or unmapped human root' );

		}

	};

	const apply = values => {

		validate( values );
		for ( const id of roots ) {

			const root = nodes.get( id );
			const pose = values[ id ].humanPose;
			if ( mannequinPose( root ) === pose ) continue;
			const previous = new Map();
			root.traverse( object => {

				if ( isPoseMesh( object ) ) previous.set( object, { geometry: object.geometry, position: object.geometry.getAttribute( 'position' ), normal: object.geometry.getAttribute( 'normal' ) } );

			} );
			if ( ! prepareMannequin( root, pose ) ) throw new Error( 'The prepared mannequin has no supported pose geometry' );
			// The shared admin helper bakes exact pose samples. Preserve native GPU
			// attribute identity once this instance owns its geometry, otherwise
			// repeated cuts retain superseded GPU buffers/render bindings.
			for ( const [ object, before ] of previous ) {

				if ( object.geometry !== before.geometry ) continue; // First owned clone.
				for ( const name of [ 'position', 'normal' ] ) {

					const next = object.geometry.getAttribute( name );
					const stable = before[ name ];
					if ( next.array.length !== stable.array.length ) throw new Error( 'A fixed mannequin pose must preserve vertex topology' );
					stable.array.set( next.array );
					stable.needsUpdate = true;
					object.geometry.setAttribute( name, stable );

				}

			}

			root.updateMatrixWorld( true );
			onGeometryChanged( root );

		}

	};

	return { read, capture: read, validate, apply, restore: apply };

}
