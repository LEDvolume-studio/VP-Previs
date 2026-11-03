import { expect, it } from 'vitest';
import { createShotLightPool } from '../../../app/src/student/ShotLightPool.js';
import { studentFixture } from './studentFixtures.js';

it( 'prepares all lights once and hides absent lights without changing saved shots', () => {

	const document = studentFixture(), first = document.shots.shotA, second = document.shots.shotB;
	second.snapshot.lights = [ { ...structuredClone( first.snapshot.lights[ 0 ] ), lightId: 'other-light' } ];
	const original = structuredClone( document );
	const pool = createShotLightPool( document, 'shotA' );
	expect( pool.inventory.map( light => light.lightId ) ).toEqual( [ first.snapshot.lights[ 0 ].lightId, 'other-light' ] );
	const preview = pool.documentFor( document, 'shotB' );
	expect( preview.shots.shotB.snapshot.lights[ 0 ] ).toMatchObject( { transform: { visible: false }, intensity: 0 } );
	expect( preview.shots.shotB.snapshot.lights[ 1 ] ).toEqual( second.snapshot.lights[ 0 ] );
	expect( pool.documentFor( document, 'shotA' ).shots.shotA.snapshot.lights[ 0 ] ).toEqual( first.snapshot.lights[ 0 ] );
	expect( document ).toEqual( original );

} );

it( 'supports a shot with no lights and rejects unknown lights instead of silently dropping them', () => {

	const document = studentFixture(), pool = createShotLightPool( document, 'shotA' );
	const empty = { ...document.shots.shotA.snapshot, lights: [] };
	expect( pool.lightsFor( empty ).every( light => ! light.transform.visible && light.intensity === 0 ) ).toBe( true );
	const unknown = structuredClone( document.shots.shotA.snapshot ); unknown.lights[ 0 ].lightId = 'unprepared';
	expect( () => pool.lightsFor( unknown ) ).toThrow( 'unprepared light' );

} );

it( 'does not pool lights from another scene', () => {

	const document = studentFixture();
	document.shots.shotB.baseScene = { sceneId: 'other-scene', version: '1' };
	document.shots.shotB.snapshot.lights[ 0 ].lightId = 'other-light';
	expect( createShotLightPool( document, 'shotA' ).inventory ).toEqual( document.shots.shotA.snapshot.lights );

} );
