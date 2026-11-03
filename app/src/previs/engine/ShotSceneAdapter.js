import { serializeStudentCatalogueContent } from '../domain/StudentCatalogueSchema.js';
import { assetVersionKey, baseSceneVersionKey, cloneStudentContent, validateStudentProjectDocument } from '../domain/StudentProjectSchema.js';

const PARTS = [ 'scene', 'pose', 'camera', 'lights', 'environment', 'media' ];
const fail = message => {

	throw new Error( `Shot scene: ${message}` );

};

const sameReference = ( a, b, key ) => a && b && key( a ) === key( b );

function inventory( entries, key, label ) {

	if ( ! Array.isArray( entries ) ) fail( `missing ${label} inventory` );
	const result = new Map();
	for ( const entry of entries ) {

		if ( ! entry || typeof entry[ key ] !== 'string' || result.has( entry[ key ] ) ) fail( `invalid or duplicate ${label} ID` );
		result.set( entry[ key ], entry );

	}

	return result;

}

function exactInventory( actual, expected, label ) {

	if ( actual.size !== expected.length || expected.some( key => ! actual.has( key ) ) ) fail( `${label} inventory does not match the complete shot; load its supported base scene first` );

}

/**
 * App-owned transaction boundary, independent of Three.js and the admin format.
 * Ports are owned by one viewport and must not be mutated concurrently outside
 * this adapter. See docs/STUDENT_PREVIS_DOMAIN.md for the deliberately narrow
 * port contract. No model loading or per-display-frame rebuilding happens here.
 */
export class ShotSceneAdapter {

	constructor( ports ) {

		const parts = [ ...PARTS.slice( 0, - 1 ), ...( ports?.materials ? [ 'materials' ] : [] ), ...( ports?.rasterAppearance ? [ 'rasterAppearance' ] : [] ), 'media' ];
		for ( const name of parts ) {

			for ( const method of [ 'read', 'capture', 'apply', 'restore' ] ) {

				if ( typeof ports?.[ name ]?.[ method ] !== 'function' ) throw new TypeError( `Missing ${name}.${method} port.` );

			}

		}

		if ( typeof ports.scene.getBindings !== 'function' ) throw new TypeError( 'Missing scene.getBindings port.' );
		if ( ports.runtime && [ 'capture', 'restore' ].some( method => typeof ports.runtime[ method ] !== 'function' ) ) throw new TypeError( 'Runtime port requires capture and restore.' );
		this._ports = ports;
		this._contentParts = parts;
		this._parts = ports.runtime ? [ 'runtime', ...parts ] : parts;
		this._busy = false;
		this._states = new WeakMap();

	}

	async _run( operation ) {

		if ( this._busy ) fail( 'another operation is in progress' );
		this._busy = true;
		try {

			return await operation();

		} finally {

			this._busy = false;

		}

	}

	_preflight( document, shotId ) {

		validateStudentProjectDocument( document );
		const shot = document.shots[ shotId ];
		if ( ! shot ) fail( `unknown shot ${shotId}` );
		if ( Object.hasOwn( shot.snapshot, 'rasterAppearance' ) !== Boolean( this._ports.rasterAppearance ) ) fail( 'shot raster appearance and viewport capability do not match; an explicit supported appearance is required' );
		if ( Object.hasOwn( shot.snapshot, 'materials' ) !== Boolean( this._ports.materials ) ) fail( 'shot material state and viewport capability do not match' );
		const binding = this._ports.scene.getBindings();
		if ( ! binding?.ready || ! sameReference( binding.baseScene, shot.baseScene, baseSceneVersionKey ) ) fail( `base scene ${baseSceneVersionKey( shot.baseScene )} is not ready` );
		const nodes = inventory( binding.nodes, 'instanceId', 'node' );
		exactInventory( nodes, Object.keys( shot.snapshot.nodes ), 'node' );
		for ( const [ instanceId, node ] of Object.entries( shot.snapshot.nodes ) ) {

			const mapped = nodes.get( instanceId );
			if ( ! sameReference( mapped.asset, node.asset, assetVersionKey ) || mapped.nodeId !== node.nodeId ) fail( `unresolved node ${instanceId} in asset ${assetVersionKey( node.asset )}; a versioned mapping is required` );

		}

		const lights = inventory( binding.lights, 'lightId', 'light' );
		exactInventory( lights, shot.snapshot.lights.map( light => light.lightId ), 'light' );
		for ( const light of shot.snapshot.lights ) if ( lights.get( light.lightId ).type !== light.type ) fail( `light ${light.lightId} has a different type` );
		exactInventory( inventory( binding.ledWalls, 'wallId', 'LED wall' ), shot.snapshot.ledWalls.map( wall => wall.wallId ), 'LED wall' );
		const assets = inventory( binding.assets?.map( asset => ( { ...asset, key: assetVersionKey( asset ) } ) ), 'key', 'asset version' );
		const references = [ ...document.baseScenes[ baseSceneVersionKey( shot.baseScene ) ].assets, ...shot.snapshot.ledWalls.map( wall => wall.media ).filter( Boolean ) ];
		if ( shot.snapshot.environment.asset ) references.push( shot.snapshot.environment.asset );
		for ( const reference of references ) if ( ! assets.has( assetVersionKey( reference ) ) ) fail( `asset ${assetVersionKey( reference )} is not ready` );
		// Concrete bridges can reject unsupported state before any capture/write.
		// Validation is synchronous and must have no side effects.
		for ( const name of this._contentParts ) this._ports[ name ].validate?.( shot.snapshot[ name === 'scene' || name === 'pose' ? 'nodes' : name === 'media' ? 'ledWalls' : name ], binding );
		return { shot, binding };

	}

	async _capture( binding ) {

		const values = {};
		for ( const name of this._parts ) values[ name ] = await this._ports[ name ].capture( binding );
		this._assertBinding( binding );
		return { binding, values };

	}

	_assertBinding( binding ) {

		// A new readiness object denotes a reload, even of the same asset version.
		if ( this._ports.scene.getBindings() !== binding ) fail( 'scene binding changed since capture; cannot restore stale handles' );

	}

	async _restore( state ) {

		this._assertBinding( state.binding );
		const errors = [];
		// Every subsystem gets a restore attempt, even after a previous one fails.
		for ( const name of [ ...this._parts ].reverse() ) {

			try {

				await this._ports[ name ].restore( state.values[ name ], state.binding );

			} catch ( error ) {

				errors.push( error );

			}

		}

		if ( errors.length ) throw new AggregateError( errors, 'Shot scene restore failed; viewport must be reloaded.' );

	}

	/** Capture a complete editable shot without leaking runtime/private state. */
	async captureShot( input, shotId ) {

		return this._run( async () => {

			const document = cloneStudentContent( input );
			const { shot, binding } = this._preflight( document, shotId );
			const transforms = await this._ports.scene.read( binding );
			const poses = await this._ports.pose.read( binding );
			exactInventory( new Map( Object.entries( transforms ) ), Object.keys( shot.snapshot.nodes ), 'captured node' );
			exactInventory( new Map( Object.entries( poses ) ), Object.keys( shot.snapshot.nodes ), 'captured pose' );
			for ( const [ instanceId, node ] of Object.entries( shot.snapshot.nodes ) ) {

				if ( ! poses[ instanceId ] || Object.keys( poses[ instanceId ] ).length !== 2 || ! Object.hasOwn( poses[ instanceId ], 'humanPose' ) || ! Object.hasOwn( poses[ instanceId ], 'doorAngles' ) ) fail( `unsupported or incomplete pose fields for ${instanceId}` );
				node.transform = cloneStudentContent( transforms[ instanceId ] );
				node.humanPose = poses[ instanceId ].humanPose;
				node.doorAngles = cloneStudentContent( poses[ instanceId ].doorAngles );

			}

			for ( const name of this._contentParts.filter( part => ! [ 'scene', 'pose' ].includes( part ) ) ) shot.snapshot[ name === 'media' ? 'ledWalls' : name ] = cloneStudentContent( await this._ports[ name ].read( binding ) );
			// Reject incomplete, nonfinite or implementation-only port output.
			this._assertBinding( binding );
			this._preflight( document, shotId );
			return shot;

		} );

	}

	/** Apply once per shot change. Failed writes roll back every port. */
	async applyShot( input, shotId, { changedResourcesOnly = false, mediaTimes } = {} ) {

		return this._run( async () => {

			const document = cloneStudentContent( input );
			const { shot, binding } = this._preflight( document, shotId );
			const before = await this._capture( binding );
			try {

				for ( const name of this._contentParts ) {

					const value = shot.snapshot[ name === 'scene' || name === 'pose' ? 'nodes' : name === 'media' ? 'ledWalls' : name ];
					if ( changedResourcesOnly && [ 'materials', 'environment', 'rasterAppearance' ].includes( name ) && serializeStudentCatalogueContent( await this._ports[ name ].read( binding ) ) === serializeStudentCatalogueContent( value ) ) continue;
					if ( name === 'media' && mediaTimes ) await this._ports.media.apply( value, binding, { times: mediaTimes } );
					else await this._ports[ name ].apply( value, binding );

				}

			} catch ( error ) {

				try {

					await this._restore( before );

				} catch ( restoreError ) {

					throw new AggregateError( [ error, restoreError ], 'Shot application and rollback failed; viewport must be reloaded.' );

				}

				throw error;

			}

			return shot;

		} );

	}

	/** Opaque viewport state for preview/export finally blocks; never portable. */
	async captureState( input, shotId ) {

		return this._run( async () => {

			const { binding } = this._preflight( input, shotId );
			const token = Object.freeze( {} );
			this._states.set( token, await this._capture( binding ) );
			return token;

		} );

	}

	async restoreState( token ) {

		return this._run( async () => {

			const state = this._states.get( token );
			if ( ! state ) fail( 'unknown viewport state token' );
			// Bindings carry live handles. Do not restore them after a scene reload.
			await this._restore( state );

		} );

	}

}
