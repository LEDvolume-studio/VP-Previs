import { describe, expect, it, vi } from 'vitest';
import { AccountSyncService } from '../../../app/src/previs/sync/AccountSyncService.js';

describe( 'account discovery', () => {

	it( 'joins an in-flight discovery so a project selection waits for hydration', async () => {

		let release;
		const list = vi.fn( () => new Promise( resolve => {

			release = resolve;

		} ) );
		const repository = { subscribeCommits: () => () => {}, list: async () => [] };
		const service = new AccountSyncService( { repository, client: { list }, narration: {}, eventTarget: null } );
		await service.start();
		let finished = false;
		const joined = service.discover().then( () => {

			finished = true;

		} );
		await Promise.resolve();
		expect( list ).toHaveBeenCalledTimes( 1 );
		expect( finished ).toBe( false );
		release( { items: [], nextCursor: null } );
		await joined;
		expect( finished ).toBe( true );
		service.stop();

	} );

} );
