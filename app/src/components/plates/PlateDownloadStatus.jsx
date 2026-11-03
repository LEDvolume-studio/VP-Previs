import { useSyncExternalStore } from 'react';
import { getPlateLibraryService } from '../../services/plates/PlateLibraryService.js';
import './plates.css';

export default function PlateDownloadStatus( { onOpen } ) {

	const { downloader } = getPlateLibraryService();
	const states = useSyncExternalStore( downloader.subscribe, downloader.getSnapshot );
	const active = Object.values( states ).filter( item => ! [ 'downloaded', 'paused' ].includes( item.phase ) );
	if ( ! active.length ) return null;
	return <div className="plate-scene-downloads" aria-live="polite">{active.map( item => {

		const percentage = Math.min( 100, Math.round( item.completed / ( item.total || 1 ) * 100 ) );
		return <div key={item.manifest.id} className="plate-scene-download"><span>{item.phase === 'error' ? item.error : item.phase === 'waiting' ? `Waiting for connection · ${item.manifest.name}` : `Downloading ${item.manifest.name} · ${percentage}%`}</span>{item.phase !== 'error' && <progress aria-label={`Download ${item.manifest.name}`} max="100" value={percentage}/>}<button type="button" onClick={onOpen}>View downloads</button></div>;

	} )}</div>;

}
