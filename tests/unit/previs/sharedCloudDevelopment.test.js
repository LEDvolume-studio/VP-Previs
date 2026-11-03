import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { readCloudflareCredentials, readSharedRequest, isLoopbackPeer, SHARED_REQUEST_LIMIT } from '../../../app/build/localStudentBackend.js';

const request = ( chunks, headers = {} ) => ( { headers, async *[ Symbol.asyncIterator ]() {

	for ( const chunk of chunks ) yield Buffer.from( chunk );

} } );

describe( 'shared Cloudflare development boundary', () => {

	it( 'requires explicit credential labels rather than interpreting the first file line', () => {

		expect( readCloudflareCredentials( 'Account ID\naccount\nYour API Token\ntoken\n' ) ).toEqual( { accountId: 'account', apiToken: 'token' } );
		for ( const input of [ 'token\nAccount ID\naccount', 'Your API Token\ntoken', 'Account ID\n\nYour API Token\ntoken' ] ) expect( () => readCloudflareCredentials( input ) ).toThrow( 'credentials are unavailable' );

	} );
	it( 'bounds both declared and streamed request sizes before retaining all bytes', async () => {

		expect( SHARED_REQUEST_LIMIT ).toBe( 128 * 1024 * 1024 );
		expect( await readSharedRequest( request( [ 'ab', 'cd' ] ), 4 ) ).toEqual( Buffer.from( 'abcd' ) );
		await expect( readSharedRequest( request( [ 'abc', 'de' ] ), 4 ) ).rejects.toMatchObject( { status: 413 } );
		await expect( readSharedRequest( request( [], { 'content-length': '5' } ), 4 ) ).rejects.toMatchObject( { status: 413 } );
		await expect( readSharedRequest( request( [], { 'content-length': 'invalid' } ), 4 ) ).rejects.toMatchObject( { status: 413 } );

	} );
	it( 'accepts local peers and rejects LAN or unspecified peers regardless of Host', () => {

		for ( const address of [ '127.0.0.1', '::1', '::ffff:127.0.0.1' ] ) expect( isLoopbackPeer( address ) ).toBe( true );
		for ( const address of [ '10.4.220.150', '192.168.1.2', undefined, '127.0.0.1.attacker.test' ] ) expect( isLoopbackPeer( address ) ).toBe( false );

	} );

} );
