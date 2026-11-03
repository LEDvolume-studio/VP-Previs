import { describe, it, expect, vi } from 'vitest';
import { DraftApiClient, DraftApiError, createDraftIdentity } from '../../../app/src/previs/api/DraftApiClient.js';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

const identity = { draftId: '342341af-1478-4ffc-862e-93510340b44d', capability: 'A'.repeat( 43 ) };
const document = createStudentProjectDocument( { projectId: 'project', now: '2026-10-22T00:00:00.000Z' } );
const response = ( patch = {} ) => new Response( JSON.stringify( { draftId: identity.draftId, serverRevision: 0, documentRevision: 0, dependenciesVerified: true, ...patch } ), { status: 200 } );
const clientFor = fetch => new DraftApiClient( { baseURL: 'https://backup.example', fetch } );

describe( 'private draft HTTP contract', () => {

	it( 'creates random client-held capabilities with no credential in the request URL or portable body', async () => {

		const generated = createDraftIdentity();
		expect( generated.capability ).toMatch( /^[A-Za-z0-9_-]{43}$/ );
		expect( generated.capability ).not.toBe( createDraftIdentity().capability );
		const fetch = vi.fn( async () => response() );
		await clientFor( fetch ).create( { ...identity, requestId: 'project:0', document } );
		const [ url, options ] = fetch.mock.calls[ 0 ];
		expect( url ).toBe( 'https://backup.example/v1/drafts' );
		expect( options.headers ).toMatchObject( { Authorization: `Bearer ${identity.capability}`, 'Idempotency-Key': 'project:0' } );
		expect( JSON.parse( options.body ) ).toEqual( { draftId: identity.draftId, document } );
		expect( options.body ).not.toContain( identity.capability );
		expect( options ).toMatchObject( { credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' } );

	} );

	it( 'uses server revision preconditions separately from portable edit revisions', async () => {

		const fetch = vi.fn( async () => response( { serverRevision: 3, documentRevision: 45 } ) );
		const ack = await clientFor( fetch ).update( { ...identity, requestId: 'project:45', document: { ...document, revision: 45 }, serverRevision: 2 } );
		expect( fetch.mock.calls[ 0 ][ 1 ].headers[ 'If-Match' ] ).toBe( '"2"' );
		expect( ack.documentRevision ).toBe( 45 );

	} );

	it( 'rejects an acknowledgement for a different frozen document revision', async () => {

		await expect( clientFor( async () => response( { documentRevision: 8 } ) ).create( { ...identity, requestId: 'project:0', document } ) ).rejects.toMatchObject( { code: 'INVALID_RESPONSE' } );

	} );

	it( 'reads validated private documents through the authenticated route', async () => {

		const fetch = vi.fn( async () => response( { document } ) );
		expect( ( await clientFor( fetch ).read( identity ) ).document ).toEqual( document );
		expect( fetch.mock.calls[ 0 ][ 1 ].method ).toBe( 'GET' );
		expect( fetch.mock.calls[ 0 ][ 1 ].body ).toBeUndefined();

	} );

	it.each( [[ 401, 'AUTHORIZATION', false ], [ 412, 'CONFLICT', false ], [ 429, 'RATE_LIMITED', true ], [ 503, 'SERVER', true ]] )( 'normalizes HTTP %s without leaking response text', async ( status, code, retryable ) => {

		const api = clientFor( async () => new Response( JSON.stringify( { error: { message: identity.capability } } ), { status } ) );
		try {

			await api.read( identity );
			throw new Error( 'Expected rejection' );

		} catch ( error ) {

			expect( error ).toBeInstanceOf( DraftApiError );
			expect( error ).toMatchObject( { code, retryable } );
			expect( String( error ) + JSON.stringify( error ) ).not.toContain( identity.capability );
			expect( error.cause ).toBeUndefined();

		}

	} );

	it( 'distinguishes missing media from a revision conflict', async () => {

		await expect( clientFor( async () => new Response( JSON.stringify( { error: { code: 'MEDIA_NOT_READY' } } ), { status: 409 } ) ).read( identity ) ).rejects.toMatchObject( { code: 'DEPENDENCIES_PENDING', retryable: false } );

	} );

	it( 'redacts raw network failures and aborts on an injected timeout', async () => {

		await expect( clientFor( async () => {

			throw new Error( identity.capability );

		} ).read( identity ) ).rejects.toMatchObject( { code: 'NETWORK', retryable: true } );
		let timeout;
		const cancel = vi.fn();
		const api = new DraftApiClient( { baseURL: 'http://127.0.0.1:8080', schedule: callback => {

			timeout = callback; return 1;

		}, cancel,
		fetch: ( url, { signal } ) => new Promise( ( resolve, reject ) => signal.addEventListener( 'abort', () => reject( new DOMException( 'Abort', 'AbortError' ) ) ) ) } );
		const request = api.read( identity );
		timeout();
		await expect( request ).rejects.toMatchObject( { code: 'TIMEOUT', retryable: true } );
		expect( cancel ).toHaveBeenCalledWith( 1 );

	} );

	it( 'rejects insecure endpoints and invalid identities before fetch', async () => {

		for ( const baseURL of [ 'http://backup.example', 'https://secret@backup.example', 'https://backup.example?token=secret' ] ) expect( () => new DraftApiClient( { baseURL } ) ).toThrow( DraftApiError );
		const fetch = vi.fn();
		await expect( clientFor( fetch ).read( { ...identity, draftId: '../other' } ) ).rejects.toMatchObject( { code: 'INVALID_REQUEST' } );
		await expect( clientFor( fetch ).read( { ...identity, capability: 'bad' } ) ).rejects.toMatchObject( { code: 'INVALID_REQUEST' } );
		expect( fetch ).not.toHaveBeenCalled();

	} );

} );
