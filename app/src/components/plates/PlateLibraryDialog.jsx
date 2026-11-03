import { useEffect, useRef } from 'react';
import PlateLibraryPanel from './PlateLibraryPanel.jsx';

export default function PlateLibraryDialog( { onClose, onSelect } ) {

	const dialog = useRef( null );
	useEffect( () => {

		dialog.current.showModal();

	}, [] );
	return <dialog ref={dialog} className="plate-modal" aria-label="Select Driving Plates" onClose={onClose}>
		<button className="plate-modal-close" onClick={() => dialog.current.close()} aria-label="Close driving plates">✕</button>
		<PlateLibraryPanel onSelect={onSelect}/>
	</dialog>;

}
