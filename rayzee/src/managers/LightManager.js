import {
	EventDispatcher, DirectionalLight, PointLight, SpotLight, RectAreaLight,
	Object3D, MathUtils
} from 'three';

/**
 * Manages scene lights: add, remove, transfer from mesh scene to WebGPU
 * scene, sync helpers, and update GPU uniform buffers.
 *
 * Extracted from PathTracerApp to keep the facade slim.
 */
export class LightManager extends EventDispatcher {

	/**
	 * @param {import('three').Scene}      scene          - WebGPU light scene
	 * @param {import('../SceneHelpers.js').SceneHelpers} sceneHelpers
	 * @param {import('../Stages/PathTracer.js').PathTracer} pathTracer
	 * @param {Object} [options]
	 * @param {Function} [options.onReset] - Callback to reset accumulation after light changes
	 * @param {Function} [options.onChange] - Callback to synchronize secondary renderers
	 */
	constructor( scene, sceneHelpers, pathTracer, options = {} ) {

		super();

		this.scene = scene;
		this.sceneHelpers = sceneHelpers;
		this.pathTracer = pathTracer;
		this._onReset = options.onReset || null;
		this._onChange = options.onChange || null;

	}

	/**
	 * Adds a light to the scene and updates the path tracer.
	 *
	 * @param {string} type - 'DirectionalLight' | 'PointLight' | 'SpotLight' | 'RectAreaLight'
	 * @returns {Object|null} Light descriptor or null if type is invalid
	 */
	addLight( type, { deferUpdate = false } = {} ) {

		const defaults = {
			// Power in Watts (Blender-style) for point/spot/area; Sun is W/m² strength.
			DirectionalLight: { position: [ 1, 1, 1 ], intensity: 1.0, color: '#ffffff' },
			PointLight: { position: [ 0, 2, 0 ], intensity: 1000, color: '#ffffff' },
			SpotLight: { position: [ 0, 1, 0 ], intensity: 1000, color: '#ffffff', angle: 15 },
			RectAreaLight: { position: [ 0, 2, 0 ], intensity: 100, color: '#ffffff', width: 2, height: 2 }
		};

		const props = defaults[ type ];
		if ( ! props ) return null;

		let light;

		if ( type === 'DirectionalLight' ) {

			light = new DirectionalLight( props.color, props.intensity );
			light.position.fromArray( props.position );

		} else if ( type === 'PointLight' ) {

			light = new PointLight( props.color, props.intensity );
			light.position.fromArray( props.position );

		} else if ( type === 'SpotLight' ) {

			light = new SpotLight( props.color, props.intensity );
			light.position.fromArray( props.position );
			light.angle = MathUtils.degToRad( props.angle );
			const target = new Object3D();
			this.scene.add( target );
			light.target = target;

		} else if ( type === 'RectAreaLight' ) {

			light = new RectAreaLight( props.color, props.intensity, props.width, props.height );
			light.position.fromArray( props.position );
			light.lookAt( 0, 0, 0 );
			// Blender-style emission defaults: power-normalized, full Lambertian
			// hemisphere (spread = π), rectangular shape.
			light.userData.normalize = true;
			light.userData.spread = Math.PI;
			light.userData.shape = 'rectangle';

		}

		// Blender-style emission controls common to every light type.
		light.userData.temperature = 6500;
		light.userData.useTemperature = false;
		light.userData.exposure = 0;

		const count = this.scene.getObjectsByProperty( 'isLight', true ).length;
		light.name = `${type.replace( 'Light', '' )} ${count + 1}`;
		this.scene.add( light );
		if ( ! deferUpdate ) {

			this.updateLights();
			this._syncHelpers();
			this._onReset?.();

		}

		return this._buildDescriptor( light );

	}

	/**
	 * Removes a light by UUID.
	 * @param {string} uuid
	 * @returns {boolean}
	 */
	removeLight( uuid ) {

		const light = this.scene.getObjectByProperty( 'uuid', uuid );
		if ( ! light || ! light.isLight ) return false;

		this.sceneHelpers.remove( light );
		if ( light.target ) light.target.removeFromParent();
		light.removeFromParent();
		this.updateLights();
		this._onReset?.();
		return true;

	}

	/**
	 * Removes all lights from the scene.
	 */
	clearLights() {

		this.sceneHelpers.clear();
		this._removeAllLights();
		this.updateLights();
		this._onReset?.();

	}

	/**
	 * Returns descriptors for all lights in the scene.
	 * @returns {Object[]}
	 */
	getLights() {

		return this.scene.getObjectsByProperty( 'isLight', true ).map( light => this._buildDescriptor( light ) );

	}

	getProjectState() {

		return this.getLights();

	}

	/** Replace editor lights from JSON-safe descriptors in one reset. */
	replaceProjectState( descriptors = [] ) {

		this.sceneHelpers.clear();
		this._removeAllLights();
		for ( const descriptor of descriptors ) {

			const created = this.addLight( descriptor.type, { deferUpdate: true } );
			const light = created ? this.scene.getObjectByProperty( 'uuid', created.uuid ) : null;
			if ( ! light ) continue;
			light.name = descriptor.name || light.name;
			light.visible = descriptor.visible !== false;
			if ( Number.isFinite( descriptor.intensity ) ) light.intensity = descriptor.intensity;
			if ( descriptor.color ) light.color.set( descriptor.color );
			if ( descriptor.position ) light.position.fromArray( descriptor.position );
			for ( const key of [ 'temperature', 'useTemperature', 'exposure' ] ) {

				if ( descriptor[ key ] !== undefined ) light.userData[ key ] = descriptor[ key ];

			}

			if ( light.isPointLight || light.isSpotLight ) light.userData.radius = Number.isFinite( descriptor.radius ) ? Math.max( 0, descriptor.radius ) : 0;

			if ( light.isRectAreaLight ) {

				if ( Number.isFinite( descriptor.width ) ) light.width = descriptor.width;
				if ( Number.isFinite( descriptor.height ) ) light.height = descriptor.height;
				light.userData.normalize = descriptor.normalize ?? true;
				if ( Number.isFinite( descriptor.spread ) ) light.userData.spread = MathUtils.degToRad( descriptor.spread );
				if ( descriptor.shape ) light.userData.shape = descriptor.shape;
				if ( descriptor.target ) light.lookAt( ...descriptor.target );

			} else if ( light.isSpotLight ) {

				if ( Number.isFinite( descriptor.angle ) ) light.angle = MathUtils.degToRad( descriptor.angle );
				if ( Number.isFinite( descriptor.distance ) ) light.distance = descriptor.distance;
				if ( Number.isFinite( descriptor.penumbra ) ) light.penumbra = descriptor.penumbra;
				if ( Number.isFinite( descriptor.decay ) ) light.decay = descriptor.decay;
				if ( descriptor.target ) light.target.position.fromArray( descriptor.target );

			} else if ( light.isPointLight ) {

				if ( Number.isFinite( descriptor.distance ) ) light.distance = descriptor.distance;
				if ( Number.isFinite( descriptor.decay ) ) light.decay = descriptor.decay;

			} else if ( light.isDirectionalLight ) {

				if ( Number.isFinite( descriptor.angle ) ) light.userData.angle = MathUtils.degToRad( descriptor.angle );
				if ( descriptor.target ) light.target.position.fromArray( descriptor.target );

			}

		}

		this.updateLights();
		this._syncHelpers();
		this._onReset?.();
		return this.getLights();

	}

	/**
	 * Reprocesses all scene lights and updates the path tracer uniform buffers,
	 * and refreshes any visible helper gizmos so they reflect parameter changes
	 * (intensity, cone angle, position, target, distance) without rebuilding.
	 */
	updateLights() {

		this.pathTracer?.updateLights();
		this._onChange?.();
		if ( this.sceneHelpers?.visible ) this.sceneHelpers.update();

	}

	/**
	 * Clones lights from the mesh scene into the WebGPU light scene,
	 * then updates GPU uniform buffers.
	 * @param {import('three').Scene} meshScene
	 */
	transferSceneLights( meshScene ) {

		this._removeAllLights();

		const sourceLights = meshScene.getObjectsByProperty( 'isLight', true )
			.filter( light => ! light.userData?.__rayzeeRasterLightProxy );

		if ( ! sourceLights || sourceLights.length === 0 ) {

			this.updateLights();
			return;

		}

		for ( const light of sourceLights ) {

			const cloned = light.clone();

			light.updateWorldMatrix( true, false );
			light.getWorldPosition( cloned.position );
			light.getWorldQuaternion( cloned.quaternion );
			light.getWorldScale( cloned.scale );

			if ( cloned.isRectAreaLight ) {

				cloned.width *= cloned.scale.x;
				cloned.height *= cloned.scale.y;
				cloned.scale.set( 1, 1, 1 );

			}

			if ( ( light.isSpotLight || light.isDirectionalLight ) && light.target ) {

				const clonedTarget = new Object3D();
				light.target.updateWorldMatrix( true, false );
				light.target.getWorldPosition( clonedTarget.position );
				this.scene.add( clonedTarget );
				cloned.target = clonedTarget;

			}

			this.scene.add( cloned );

		}

		this.updateLights();
		this._syncHelpers();

	}

	/**
	 * Shows/hides light helpers.
	 * @param {boolean} show
	 */
	setShowLightHelper( show ) {

		this.sceneHelpers.visible = show;

		if ( show ) {

			this._syncHelpers();

		} else {

			this.sceneHelpers.clear();

		}

	}

	// ── Aliases (match Sub-API surface for zero-churn migration) ──

	/** @see addLight */
	add( type ) {

		return this.addLight( type );

	}

	/** @see removeLight */
	remove( uuid ) {

		return this.removeLight( uuid );

	}

	/** @see clearLights */
	clear() {

		this.clearLights();

	}

	/** @see getLights */
	getAll() {

		return this.getLights();

	}

	/** @see updateLights */
	sync() {

		this.updateLights();

	}

	/** @see setShowLightHelper */
	showHelpers( show ) {

		this.setShowLightHelper( show );

	}

	/**
	 * Releases all scene lights, helper nodes, and callback refs.
	 * Safe to call multiple times.
	 */
	dispose() {

		if ( this._disposed ) return;
		this._disposed = true;

		this.sceneHelpers?.clear();
		this._removeAllLights();

		// Drop external refs so GC can collect scene/pathTracer
		this._onReset = null;
		this._onChange = null;
		this.pathTracer = null;
		this.sceneHelpers = null;
		this.scene = null;

	}

	// ── Private ───────────────────────────────────────────────────

	/** Syncs helpers in sceneHelpers with current scene lights. */
	_removeAllLights() {

		this.scene.getObjectsByProperty( 'isLight', true ).forEach( light => {

			if ( light.target ) this.scene.remove( light.target );
			this.scene.remove( light );

		} );

	}

	_syncHelpers() {

		if ( ! this.sceneHelpers.visible ) return;
		const lights = this.scene.getObjectsByProperty( 'isLight', true );
		this.sceneHelpers.sync( lights );

	}

	/**
	 * Builds a serialisable descriptor object from a Three.js light.
	 * @param {import('three').Light} light
	 * @returns {Object}
	 */
	_buildDescriptor( light ) {

		let angle = 0;

		if ( light.type === 'SpotLight' && light.angle !== undefined ) {

			angle = MathUtils.radToDeg( light.angle );

		} else if ( light.type === 'DirectionalLight' ) {

			// Sun angular diameter. Lives on userData because three.js gives DirectionalLight no
			// angle property, and an ad-hoc one would not survive the light.clone() in
			// transferSceneLights. Reported here or the panel reads back 0 and the slider snaps home.
			angle = MathUtils.radToDeg( light.userData?.angle ?? 0 );

		}

		const descriptor = {
			uuid: light.uuid,
			name: light.name,
			type: light.type,
			visible: light.visible,
			intensity: light.intensity,
			color: `#${light.color.getHexString()}`,
			position: [ light.position.x, light.position.y, light.position.z ],
			angle,
			// Emission controls common to all light types.
			temperature: light.userData?.temperature ?? 6500,
			useTemperature: light.userData?.useTemperature ?? false,
			exposure: light.userData?.exposure ?? 0
		};

		if ( light.isPointLight || light.isSpotLight ) descriptor.radius = Math.max( 0, Number( light.userData?.radius ) || 0 );

		if ( light.type === 'RectAreaLight' ) {

			descriptor.width = light.width;
			descriptor.height = light.height;
			descriptor.normalize = light.userData?.normalize ?? true;
			descriptor.spread = MathUtils.radToDeg( light.userData?.spread ?? Math.PI ); // degrees for UI
			const rawShape = light.userData?.shape;
			descriptor.shape = ( rawShape === 'square' || rawShape === 'rectangle' || rawShape === 'disk' || rawShape === 'ellipse' )
				? rawShape
				: rawShape === 1 ? 'ellipse'
					: 'rectangle'; // 'rect', undefined, 0 → rectangle
			const dir = light.getWorldDirection( light.position.clone() );
			descriptor.target = [ light.position.x + dir.x, light.position.y + dir.y, light.position.z + dir.z ];

		} else if ( light.type === 'SpotLight' && light.target ) {

			descriptor.target = [ light.target.position.x, light.target.position.y, light.target.position.z ];
			descriptor.distance = light.distance ?? 0;
			descriptor.penumbra = light.penumbra ?? 0;
			descriptor.decay = light.decay ?? 2;

		} else if ( light.type === 'PointLight' ) {

			descriptor.distance = light.distance ?? 0;
			descriptor.decay = light.decay ?? 2;

		}

		if ( ( light.type === 'SpotLight' || light.type === 'DirectionalLight' ) && light.userData?.gobo ) {

			descriptor.gobo = light.userData.gobo.name;
			descriptor.goboIntensity = light.userData.gobo.intensity;
			descriptor.goboInverted = !! light.userData.gobo.inverted;
			if ( light.type === 'DirectionalLight' ) {

				descriptor.goboScale = light.userData.gobo.scale ?? 5.0;

			}

		}

		if ( light.type === 'SpotLight' && light.userData?.ies ) {

			descriptor.ies = light.userData.ies.name;
			descriptor.iesIntensity = light.userData.ies.intensity ?? 1.0;
			descriptor.fixtureLumens = light.userData.ies.fixtureLumens ?? null;

		}

		return descriptor;

	}

}
