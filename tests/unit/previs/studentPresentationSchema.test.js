import { describe, expect, it } from 'vitest';
import { migrateStudentProjectDocument, prepareStudentProjectExport, validateStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';
import { evaluateSequence } from '../../../app/src/previs/sequence/evaluateSequence.js';
import { studentFixture } from './studentFixtures.js';

function presentationFixture() {

	const document = studentFixture();
	const snapshot = document.shots.shotA.snapshot;
	snapshot.ledWalls = [ {
		wallId: 'wall', presentationVersion: 1, nodeInstanceId: 'carInstance',
		media: { assetId: 'video', version: '1' }, mode: 'play', inPointUs: 800000, loop: true, playbackRate: 1,
		brightnessNits: 558, placement: { position: [ 0.446, 0.544 ], scale: [ 0.75, 1 ], rotationDegrees: - 37, aspectRatioLocked: true, fitMode: 'contain' },
		surface: { nativeCanvas: [ 6144, 2592 ], uvChannel: 1, uvBounds: [ - 0.0007, 1, 0.2888, 0.7109 ], flipU: true },
	} ];
	snapshot.rasterAppearance = { version: 1, postProcessing: 'rayzee-realtime-v1', toneMapping: 4, outputColorSpace: 'srgb', enableEnvironment: true, showBackground: true, transparentBackground: false, backgroundIntensity: 0.8, backgroundBlurriness: 0.3, backgroundColor: '#778899' };
	return document;

}

describe( 'explicit versioned LED and raster presentation', () => {

	it( 'keeps existing stored v1 LED brightness/transform content byte-for-byte through migration', () => {

		const legacy = studentFixture();
		const before = JSON.stringify( legacy );
		expect( JSON.stringify( migrateStudentProjectDocument( legacy ) ) ).toBe( before );
		expect( migrateStudentProjectDocument( legacy ).shots.shotA.snapshot.ledWalls[ 0 ] ).toMatchObject( { brightness: 1 } );
		expect( migrateStudentProjectDocument( legacy ).shots.shotA.snapshot.ledWalls[ 0 ] ).not.toHaveProperty( 'brightnessNits' );

	} );

	it( 'round trips versioned presentation without dropping UV mapping, placement, nits or raster background settings', () => {

		const document = presentationFixture();
		expect( validateStudentProjectDocument( document ) ).toBe( true );
		expect( prepareStudentProjectExport( document ) ).toEqual( document );
		expect( evaluateSequence( document, 6 ).led[ 0 ] ).toMatchObject( { wallId: 'wall', sourceTimeUs: 40000 } );
		const migrated = migrateStudentProjectDocument( document );
		migrated.shots.shotA.snapshot.ledWalls[ 0 ].placement.position[ 0 ] = 100;
		expect( document.shots.shotA.snapshot.ledWalls[ 0 ].placement.position[ 0 ] ).toBe( 0.446 );

	} );

	it( 'retains blank display brightness/placement without requesting a decoder for missing media', () => {

		const document = presentationFixture();
		Object.assign( document.shots.shotA.snapshot.ledWalls[ 0 ], { media: null, mode: 'freeze', inPointUs: 0 } );
		expect( validateStudentProjectDocument( document ) ).toBe( true );
		expect( evaluateSequence( document, 0 ).led ).toEqual( [] );
		expect( evaluateSequence( document, 24 ).led ).toEqual( [] );
		expect( evaluateSequence( document, 25 ).led ).toHaveLength( 1 );

	} );

	it.each( [
		[ 'unknown presentation version', snapshot => snapshot.ledWalls[ 0 ].presentationVersion = 2 ],
		[ 'ambiguous old brightness', snapshot => snapshot.ledWalls[ 0 ].brightness = 5 ],
		[ 'unmapped display node', snapshot => snapshot.ledWalls[ 0 ].nodeInstanceId = 'absent' ],
		[ 'duplicate transform ownership', snapshot => snapshot.ledWalls[ 0 ].transform = snapshot.nodes.carInstance.transform ],
		[ 'negative nits', snapshot => snapshot.ledWalls[ 0 ].brightnessNits = - 1 ],
		[ 'zero scale', snapshot => snapshot.ledWalls[ 0 ].placement.scale[ 0 ] = 0 ],
		[ 'invalid fit policy', snapshot => snapshot.ledWalls[ 0 ].placement.fitMode = 'guess' ],
		[ 'invalid aspect metadata', snapshot => snapshot.ledWalls[ 0 ].placement.aspectRatioLocked = 1 ],
		[ 'invalid native canvas', snapshot => snapshot.ledWalls[ 0 ].surface.nativeCanvas[ 0 ] = 0 ],
		[ 'invalid UV channel', snapshot => snapshot.ledWalls[ 0 ].surface.uvChannel = 1.5 ],
		[ 'degenerate UV bounds', snapshot => snapshot.ledWalls[ 0 ].surface.uvBounds[ 1 ] = - 0.0007 ],
		[ 'reverse UV bounds', snapshot => snapshot.ledWalls[ 0 ].surface.uvBounds[ 3 ] = - 1 ],
		[ 'unknown UV metadata', snapshot => snapshot.ledWalls[ 0 ].surface.guessedOrigin = true ],
		[ 'blank playback', snapshot => Object.assign( snapshot.ledWalls[ 0 ], { media: null, mode: 'play', inPointUs: 0 } ) ],
		[ 'blank nonzero time', snapshot => Object.assign( snapshot.ledWalls[ 0 ], { media: null, mode: 'freeze', inPointUs: 1 } ) ],
		[ 'contradictory background visibility', snapshot => snapshot.rasterAppearance.showBackground = false ],
		[ 'unsupported custom tone mapping', snapshot => snapshot.rasterAppearance.toneMapping = 5 ],
		[ 'unknown post stack', snapshot => snapshot.rasterAppearance.postProcessing = 'custom' ],
		[ 'unknown grade', snapshot => snapshot.rasterAppearance.saturation = 1.2 ],
	] )( 'rejects %s before import/export', ( _, mutate ) => {

		const document = presentationFixture();
		mutate( document.shots.shotA.snapshot );
		expect( () => validateStudentProjectDocument( document ) ).toThrow();
		expect( () => prepareStudentProjectExport( document ) ).toThrow();

	} );

} );
