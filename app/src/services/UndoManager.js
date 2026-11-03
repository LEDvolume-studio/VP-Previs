const DEFAULT_LIMIT = 20;
const DEFAULT_COALESCE_MS = 400;

/**
 * Small asynchronous command history. Commands may coalesce (for sliders and
 * camera drags), and recording is suspended while undo/redo is being applied.
 */
export class UndoManager {

	constructor( { limit = DEFAULT_LIMIT, coalesceMs = DEFAULT_COALESCE_MS } = {} ) {

		this.limit = limit;
		this.coalesceMs = coalesceMs;
		this.undoStack = [];
		this.redoStack = [];
		this.applying = false;
		this.listeners = new Set();
		this.revision = 0;

	}

	get canUndo() {

		return ! this.applying && this.undoStack.length > 0;

	}

	get canRedo() {

		return ! this.applying && this.redoStack.length > 0;

	}

	get undoLabel() {

		return this.undoStack.at( - 1 )?.label || null;

	}

	get redoLabel() {

		return this.redoStack.at( - 1 )?.label || null;

	}

	subscribe( listener ) {

		this.listeners.add( listener );
		listener( this.getState() );
		return () => this.listeners.delete( listener );

	}

	getState() {

		return {
			canUndo: this.canUndo,
			canRedo: this.canRedo,
			undoLabel: this.undoLabel,
			redoLabel: this.redoLabel,
			applying: this.applying,
		};

	}

	_notify() {

		const state = this.getState();
		for ( const listener of this.listeners ) listener( state );

	}

	record( { label = 'Change', undo, redo, coalesceKey = null } ) {

		if ( this.applying || typeof undo !== 'function' || typeof redo !== 'function' ) return false;
		const now = Date.now();
		const previous = this.undoStack.at( - 1 );
		if ( coalesceKey && previous?.coalesceKey === coalesceKey
			&& now - previous.timestamp <= this.coalesceMs ) {

			previous.redo = redo;
			previous.label = label;
			previous.timestamp = now;

		} else {

			this.undoStack.push( { label, undo, redo, coalesceKey, timestamp: now } );
			if ( this.undoStack.length > this.limit ) this.undoStack.shift();

		}

		this.redoStack.length = 0;
		this._notify();
		return true;

	}

	async undo() {

		if ( ! this.canUndo ) return false;
		const command = this.undoStack.pop();
		const revision = this.revision;
		this.applying = true;
		this._notify();
		try {

			await command.undo();
			if ( revision === this.revision ) {

				command.timestamp = 0;
				this.redoStack.push( command );

			}

			return true;

		} catch ( error ) {

			if ( revision === this.revision ) this.undoStack.push( command );
			throw error;

		} finally {

			this.applying = false;
			this._notify();

		}

	}

	async redo() {

		if ( ! this.canRedo ) return false;
		const command = this.redoStack.pop();
		const revision = this.revision;
		this.applying = true;
		this._notify();
		try {

			await command.redo();
			if ( revision === this.revision ) {

				command.timestamp = 0;
				this.undoStack.push( command );

			}

			return true;

		} catch ( error ) {

			if ( revision === this.revision ) this.redoStack.push( command );
			throw error;

		} finally {

			this.applying = false;
			this._notify();

		}

	}

	clear() {

		this.revision ++;
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this._notify();

	}

}

export const undoManager = new UndoManager();
