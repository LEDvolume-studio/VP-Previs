import { describe, expect, it, vi } from 'vitest';
import { UndoManager } from '@/services/UndoManager';

describe( 'UndoManager', () => {

	it( 'undoes and redoes commands', async () => {

		let value = 2;
		const history = new UndoManager();
		history.record( {
			label: 'Value',
			undo: () => {

				value = 1;

			},
			redo: () => {

				value = 2;

			},
		} );

		expect( await history.undo() ).toBe( true );
		expect( value ).toBe( 1 );
		expect( await history.redo() ).toBe( true );
		expect( value ).toBe( 2 );

	} );

	it( 'coalesces repeated edits while preserving the first undo', async () => {

		let value = 3;
		const history = new UndoManager();
		history.record( { undo: () => {

			value = 0;

		}, redo: () => {

			value = 1;

		}, coalesceKey: 'slider' } );
		history.record( { undo: () => {

			value = 1;

		}, redo: () => {

			value = 3;

		}, coalesceKey: 'slider' } );

		expect( history.undoStack ).toHaveLength( 1 );
		await history.undo();
		expect( value ).toBe( 0 );
		await history.redo();
		expect( value ).toBe( 3 );

	} );

	it( 'bounds history and clears redo after a new edit', async () => {

		const history = new UndoManager( { limit: 2 } );
		for ( let i = 0; i < 3; i ++ ) history.record( { undo: vi.fn(), redo: vi.fn() } );
		expect( history.undoStack ).toHaveLength( 2 );

		await history.undo();
		expect( history.canRedo ).toBe( true );
		history.record( { undo: vi.fn(), redo: vi.fn() } );
		expect( history.canRedo ).toBe( false );

	} );

	it( 'restores a failed command to its original stack', async () => {

		const history = new UndoManager();
		history.record( { undo: () => {

			throw new Error( 'failed' );

		}, redo: vi.fn() } );

		await expect( history.undo() ).rejects.toThrow( 'failed' );
		expect( history.canUndo ).toBe( true );
		expect( history.canRedo ).toBe( false );

	} );

	it( 'does not merge a new edit into a command that was redone', async () => {

		const history = new UndoManager();
		history.record( { undo: vi.fn(), redo: vi.fn(), coalesceKey: 'slider' } );
		await history.undo();
		await history.redo();
		history.record( { undo: vi.fn(), redo: vi.fn(), coalesceKey: 'slider' } );

		expect( history.undoStack ).toHaveLength( 2 );

	} );

	it( 'does not resurrect history cleared during an async operation', async () => {

		let finishUndo;
		const history = new UndoManager();
		history.record( {
			undo: () => new Promise( resolve => {

				finishUndo = resolve;

			} ),
			redo: vi.fn(),
		} );

		const operation = history.undo();
		history.clear();
		finishUndo();
		await operation;

		expect( history.canUndo ).toBe( false );
		expect( history.canRedo ).toBe( false );

	} );

} );
