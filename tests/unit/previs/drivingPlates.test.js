import { describe, expect, it } from 'vitest';
import { inspectPlateCodec, inspectPlateContainer, inspectPlatePackets } from '../../../app/src/services/plates/InspectPlateVideo.js';
import { PLATE_SLOTS, plateFrameAtTime, plateSlotFromName, plateViewAtHeading, validatePlateManifest } from '../../../app/src/services/plates/PlateSet.js';

const packets = count => Array.from( { length: count }, ( _, i ) => ( { timestamp: i / 25, duration: 0.04, type: i % 25 === 0 ? 'key' : 'delta' } ) );
const box = ( type, payload = 0 ) => {

	const bytes = new Uint8Array( 8 + payload );
	new DataView( bytes.buffer ).setUint32( 0, bytes.length );
	bytes.set( [ ...type ].map( character => character.charCodeAt( 0 ) ), 4 );
	return bytes;

};

export const manifestFixture = () => ( {
	format: 'rayzee-driving-plates', schemaVersion: 1, id: 'test-set', name: 'Test drive', frameCount: 50, headingOffset: 0,
	files: Object.fromEntries( PLATE_SLOTS.map( slot => [ slot, { encoding: slot.split( '-' )[ 1 ], frameCount: 50, size: 32, width: 1280, height: 720, fps: 25, chunks: [ '0'.repeat( 64 ) ] } ] ) ),
} );

describe( 'driving plate publication rules', () => {

	it( 'checks every presentation timestamp and handles B-frame decode order', () => {

		expect( inspectPlatePackets( packets( 7500 ).reverse() ) ).toBe( 7500 );
		const invalid = packets( 100 ); invalid[ 61 ].timestamp += 0.02;
		expect( () => inspectPlatePackets( invalid ) ).toThrow( /frame 61/ );

	} );

	it( 'rejects duration overflow, missing frames, VFR and missing random access', () => {

		for ( const count of [ 0, 7501 ] ) expect( () => inspectPlatePackets( packets( count ) ) ).toThrow();
		const vfr = packets( 50 ); vfr[ 17 ].duration = 0.08;
		expect( () => inspectPlatePackets( vfr ) ).toThrow( /25 fps/ );
		const noInitialKey = packets( 50 ); noInitialKey[ 0 ].type = 'delta';
		expect( () => inspectPlatePackets( noInitialKey ) ).toThrow( /keyframe/ );
		const longGop = packets( 50 ); longGop[ 25 ].type = 'delta';
		expect( () => inspectPlatePackets( longGop ) ).toThrow( /keyframe/ );

	} );

	it( 'accepts complete fast-start MP4 layouts and rejects truncated/fragmented layouts', async () => {

		await expect( inspectPlateContainer( new Blob( [ box( 'ftyp' ), box( 'moov' ), box( 'mdat', 16 ) ] ) ) ).resolves.toBeUndefined();
		for ( const data of [[ box( 'ftyp' ), box( 'mdat' ), box( 'moov' ) ], [ box( 'ftyp' ), box( 'moof' ) ], [ box( 'ftyp' ), new Uint8Array( 2 ) ], [ box( 'moov' ), box( 'mdat' ) ]] ) await expect( inspectPlateContainer( new Blob( data ) ) ).rejects.toThrow();

	} );

	it( 'checks HEVC profile, chroma and bit depth independently of browser decode support', () => {

		const description = new Uint8Array( 23 ); description[ 0 ] = 1; description[ 1 ] = 1; description[ 16 ] = 1;
		expect( () => inspectPlateCodec( { codec: 'hvc1.1.6.L93.B0', description }, 'hevc' ) ).not.toThrow();
		for ( const [ byte, value ] of [[ 1, 2 ], [ 16, 2 ], [ 17, 2 ], [ 18, 2 ]] ) {

			const bad = description.slice(); bad[ byte ] = value;
			expect( () => inspectPlateCodec( { codec: 'hvc1.1.6.L93.B0', description: bad }, 'hevc' ) ).toThrow( /8-bit 4:2:0/ );

		}

		expect( () => inspectPlateCodec( { codec: 'vp09.00.10.08', description }, 'hevc' ) ).toThrow();

	} );

	it( 'requires eight matching frame counts and bounded chunk integrity metadata', () => {

		expect( validatePlateManifest( manifestFixture() ).frameCount ).toBe( 50 );
		for ( const mutate of [ value => delete value.files[ 'rear-hevc' ], value => value.files[ 'rear-hevc' ].frameCount ++, value => value.id = '../outside', value => value.files[ 'rear-hevc' ].chunks = [], value => value.headingOffset = NaN ] ) {

			const value = manifestFixture(); mutate( value );
			expect( () => validatePlateManifest( value ) ).toThrow();

		}

	} );

	 it( 'assigns only recognised filenames and never guesses a camera angle', () => {

		expect( plateSlotFromName( 'FRONT_HEVC.mp4' ) ).toBe( 'front-hevc' );
		expect( plateSlotFromName( 'recording1.mp4' ) ).toBeNull();

	} );

} );

describe( 'shared plate clock and relative heading', () => {

	it( 'uses half-open angular sectors with deterministic wraparound and calibration', () => {

		for ( const [ heading, view ] of [[ 0, 'front' ], [ 44.99, 'front' ], [ 45, 'right' ], [ 135, 'rear' ], [ 225, 'left' ], [ 315, 'front' ], [ - 90, 'left' ], [ 720, 'front' ]] ) expect( plateViewAtHeading( heading ) ).toBe( view );
		expect( plateViewAtHeading( 135, 45 ) ).toBe( 'right' );
		expect( () => plateViewAtHeading( NaN ) ).toThrow();

	} );

	it( 'selects integer frames at boundaries, clamps the endpoint and loops consistently', () => {

		expect( plateFrameAtTime( 0.04, 50 ) ).toBe( 1 );
		expect( plateFrameAtTime( 2, 50 ) ).toBe( 49 );
		expect( plateFrameAtTime( 2, 50, { loop: true } ) ).toBe( 0 );
		expect( plateFrameAtTime( 1.16, 50 ) ).toBe( 29 );
		for ( const time of [ - 1, NaN, Infinity ] ) expect( () => plateFrameAtTime( time, 50 ) ).toThrow();

	} );

} );
