import { describe, expect, it, vi } from 'vitest';
import { ReadOnlyStudentReview } from '../../../app/src/admin/users/ReadOnlyStudentReview.js';
import { createStudentProjectDocument } from '../../../app/src/previs/domain/StudentProjectSchema.js';

const userId = '66c45b30-4185-4096-89a9-13f0235e2157';
const projectId = 'ed517464-ce73-4f44-a3cb-cf14e7b8d3a2';
describe( 'admin read-only review boundary', () => {

	it( 'loads an owned cloud document using GET and exposes no write methods', async () => {

		const document = createStudentProjectDocument( { projectId } );
		const fetch = vi.fn( async () => new Response( JSON.stringify( { project: { projectId, ownerId: userId, serverRevision: 0 }, document } ) ) );
		const review = new ReadOnlyStudentReview( { projectId, userId, fetch, catalogue: {} } );
		const result = await review.load();
		expect( result.document ).toEqual( document );
		expect( fetch ).toHaveBeenCalledOnce();
		expect( fetch.mock.calls[ 0 ][ 1 ] ).toMatchObject( { credentials: 'same-origin', cache: 'no-store' } );
		expect( fetch.mock.calls[ 0 ][ 1 ].method ).toBeUndefined();
		for ( const name of [ 'save', 'commit', 'update', 'upload', 'delete', 'edit', 'sync' ] ) expect( review[ name ] ).toBeUndefined();
		result.document.name = 'changed'; expect( review.document.name ).toBe( document.name );

	} );
	it( 'refuses a guessed owner before exposing document content', async () => {

		const document = createStudentProjectDocument( { projectId } );
		const fetch = vi.fn( async () => new Response( JSON.stringify( { project: { projectId, ownerId: 'other' }, document } ) ) );
		const review = new ReadOnlyStudentReview( { projectId, userId, fetch, catalogue: {} } );
		await expect( review.load() ).rejects.toThrow( 'owner' ); expect( review.document ).toBeUndefined();

	} );

} );
