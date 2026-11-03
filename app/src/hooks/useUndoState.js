import { useEffect, useState } from 'react';
import { undoManager } from '@/services/UndoManager';

export function useUndoState() {

	const [ state, setState ] = useState( () => undoManager.getState() );
	useEffect( () => undoManager.subscribe( setState ), [] );
	return state;

}
