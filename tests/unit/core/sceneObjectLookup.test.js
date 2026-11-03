/**
 * getSceneObject() resolves the id returned by addModel/addModelFromObject3D to the root the
 * engine renders for it — for an appended Object3D that is the engine's copy, not the caller's.
 * Called off the prototype so the test needs no GPU-backed instance.
 */
import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, Scene } from 'three';
import { PathTracerApp } from '@/core/PathTracerApp.js';

const getSceneObject = ( meshScene, id ) =>
	PathTracerApp.prototype.getSceneObject.call( { meshScene }, id );

describe( 'PathTracerApp.getSceneObject', () => {

	it( 'returns the tagged root for its id', () => {

		const meshScene = new Scene();
		const root = new Group();
		root.userData.__rayzeeSceneObject = true;
		meshScene.add( root );

		expect( getSceneObject( meshScene, root.uuid ) ).toBe( root );

	} );

	it( 'ignores untagged roots such as the built-in ground plane', () => {

		const meshScene = new Scene();
		const ground = new Group();
		meshScene.add( ground );

		expect( getSceneObject( meshScene, ground.uuid ) ).toBe( null );

	} );

	it( 'returns null for an unknown id, and with no scene', () => {

		expect( getSceneObject( new Scene(), 'nope' ) ).toBe( null );
		expect( getSceneObject( null, 'nope' ) ).toBe( null );

	} );

} );

describe( 'PathTracerApp.unloadScene', () => {

	it( 'removes appended project models as well as the primary model', () => {

		const app = Object.create( PathTracerApp.prototype );
		const meshScene = new Scene();
		const floor = new Group();
		const primary = new Group();
		const appended = new Group();
		appended.userData.__rayzeeSceneObject = true;
		meshScene.add( floor, primary, appended );
		app.isInitialized = true;
		app.meshScene = meshScene;
		app.stages = {};
		app.reset = vi.fn();
		app.assetLoader = {
			floorPlane: floor,
			targetModel: primary,
			removeModelRoot: root => root.removeFromParent(),
			releaseTargetModel() {

				this.targetModel?.removeFromParent();
				this.targetModel = null;

			},
		};

		app.unloadScene();

		expect( meshScene.children ).toEqual( [ floor ] );
		expect( app.assetLoader.targetModel ).toBeNull();

	} );

} );

describe( 'PathTracerApp.getEditorMeasurement', () => {

	it( 'reports selected object dimensions in the saved Y-up axes', () => {

		const selectedObject = new Mesh( new BoxGeometry( 2, 4, 6 ) );
		selectedObject.name = 'Test box';
		const measurement = PathTracerApp.prototype.getEditorMeasurement.call( {
			interactionManager: { selectedObject },
		} );

		expect( measurement ).toEqual( { label: 'Test box', x: 2, y: 4, z: 6 } );
		selectedObject.geometry.dispose();

	} );

} );
