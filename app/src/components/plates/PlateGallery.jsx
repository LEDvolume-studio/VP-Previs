import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getPlateLibraryService } from '../../services/plates/PlateLibraryService.js';
import { choosePlateEncoding, plateCodecName } from '../../services/plates/PlateCodec.js';
import { PLATE_VIEWS } from '../../services/plates/PlateSet.js';

const mib = bytes => ( bytes / 1024 / 1024 ).toFixed( 1 );
const activePhases = [ 'checking', 'downloading', 'retrying', 'verifying', 'waiting' ];

function PlateCard( { manifest, ready: downloaded, local, media, state, client, onOpen, onDownload, onPause, onRemove, onDiscard, repair, disabled } ) {

	const [ supportedEncoding, setSupportedEncoding ] = useState( null );
	useEffect( () => {

		let current = true; choosePlateEncoding( manifest ).then( value => current && setSupportedEncoding( value ) ); return () => {

			current = false;

		};

	}, [ manifest ] );
	const ready = downloaded && supportedEncoding && ( local?.downloadedEncodings || [ 'hevc', 'h264' ] ).includes( supportedEncoding );
	const [ hover, setHover ] = useState( false ), [ previewFailed, setPreviewFailed ] = useState( false );
	const timer = useRef( null ), video = useRef( null );
	const active = activePhases.includes( state?.phase ), paused = state?.phase === 'paused' || state?.phase === 'error';
	const completed = state?.completed || 0, total = state?.total || 1;
	const percentage = Math.min( state?.phase === 'downloaded' ? 100 : 99, Math.floor( completed / total * 100 ) );
	const begin = () => {

		if ( matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) return;
		clearTimeout( timer.current ); timer.current = setTimeout( () => setHover( true ), 180 );

	};

	const end = () => {

		clearTimeout( timer.current ); setHover( false );

	};

	useEffect( () => () => clearTimeout( timer.current ), [] );
	useEffect( () => {

		const element = video.current;
		if ( ! hover || ! element ) return;
		element.play().catch( () => {} );
		const hidden = () => {

			if ( document.hidden ) setHover( false );

		};

		document.addEventListener( 'visibilitychange', hidden );
		return () => {

			document.removeEventListener( 'visibilitychange', hidden ); element.pause(); element.removeAttribute( 'src' ); element.load();

		};

	}, [ hover ] );
	const thumbnail = media?.thumbnail || ( manifest.media ? client.assetURL( manifest, 'thumbnail.jpg' ) : null );
	const preview = media?.preview || ( manifest.media ? client.assetURL( manifest, 'preview.mp4' ) : null );
	const downloadSize = PLATE_VIEWS.reduce( ( sum, view ) => sum + manifest.files[ `${view}-${state?.encoding || supportedEncoding || 'hevc'}` ].size, 0 );
	return <article className={`plate-card ${ready ? 'is-downloaded' : ''}`} data-set-id={manifest.id} onPointerEnter={begin} onPointerLeave={end} onFocusCapture={begin} onBlurCapture={event => {

		if ( ! event.currentTarget.contains( event.relatedTarget ) ) end();

	}}>
		<div className="plate-card-image">{thumbnail ? <img src={thumbnail} loading="lazy" alt={`Front view of ${manifest.name}`}/> : <span>Front view</span>}{hover && preview && ! previewFailed && <video ref={video} src={preview} muted loop playsInline preload="none" aria-label={`Preview ${manifest.name}`} onError={() => setPreviewFailed( true )}/>}
			<span className={`plate-badge ${ready ? 'downloaded' : ''}`}>{ready ? '✓ Downloaded' : active ? 'Downloading' : paused ? 'Partly downloaded' : 'Available'}</span>
		</div>
		<div className="plate-card-content"><h4>{manifest.name}</h4><p className="plate-codec">{supportedEncoding ? `Your device supports ${plateCodecName( supportedEncoding )}` : 'Checking device support…'}</p><p>{Math.floor( manifest.frameCount / 25 / 60 )}:{String( Math.floor( manifest.frameCount / 25 % 60 ) ).padStart( 2, '0' )} · Four synchronised views · {mib( downloadSize )} MiB</p>
			{state && state.phase !== 'downloaded' && <div className="plate-download-progress"><div><span>{state.phase === 'waiting' ? 'Waiting for connection' : state.phase === 'verifying' ? 'Checking saved files' : state.phase === 'retrying' ? 'Connection interrupted · retrying' : paused ? 'Ready to resume' : state.phase === 'checking' ? 'Preparing download' : 'Downloading'} </span><strong>{percentage}%</strong></div><progress aria-label={`Download ${manifest.name}`} max="100" value={percentage}/><small>{mib( Math.min( completed, total ) )} / {mib( total )} MiB</small></div>}
			{state?.error && <p className="plate-card-error" role="alert">{state.error}</p>}
			<div className="plate-actions">{ready ? <><button disabled={disabled || active || ! supportedEncoding} onClick={() => onOpen( manifest )}>Select plates</button><button disabled={disabled || active} onClick={() => onRemove( local )}>Remove local copy</button></> : active ? <button onClick={onPause}>Pause download</button> : <button className="plate-download-button" disabled={disabled || ! supportedEncoding} onClick={onDownload}>{repair ? 'Repair download' : paused ? 'Resume download' : 'Select plates'}</button>}{paused && ! ready && <button onClick={onDiscard}>Discard download</button>}</div>
		</div>
	</article>;

}

export default function PlateGallery( { library, items, onRefresh, onOpen, onRemove, onBeforeDownload, encoding, disabled } ) {

	const [ service ] = useState( () => getPlateLibraryService() );
	const { client, downloader } = service;
	const states = useSyncExternalStore( downloader.subscribe, downloader.getSnapshot );
	const [ catalogue, setCatalogue ] = useState( [] ), [ error, setError ] = useState( '' ), [ media, setMedia ] = useState( {} );
	const refreshRef = useRef( onRefresh ); refreshRef.current = onRefresh;
	useEffect( () => {

		let current = true;
		client.list().then( sets => {

			if ( current ) {

				setCatalogue( sets ); setError( '' );

			}

		} ).catch( failure => current && setError( failure.message ) );
		downloader.restore().catch( failure => current && setError( failure.message ) );
		const refresh = () => {

			Promise.resolve( refreshRef.current() ).catch( failure => current && setError( failure.message ) ); client.list().then( sets => {

				if ( current ) {

					setCatalogue( sets ); setError( '' );

				}

			} ).catch( () => {} );

		};

		const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel( 'rayzee-plate-library' ) : null;
		if ( channel ) channel.onmessage = refresh;
		window.addEventListener( 'focus', refresh ); window.addEventListener( 'online', refresh );
		return () => {

			current = false; channel?.close(); window.removeEventListener( 'focus', refresh ); window.removeEventListener( 'online', refresh );

		};

	}, [ client, downloader ] );
	useEffect( () => {

		let current = true; const urls = [];
		( async () => {

			const result = {}, root = await library.root();
			for ( const { manifest } of items ) {

				const directory = await root.getDirectoryHandle( manifest.id ); result[ manifest.id ] = {};
				for ( const [ key, filename ] of [[ 'thumbnail', 'thumbnail.jpg' ], [ 'preview', 'preview.mp4' ]] ) {

					try {

						const file = await ( await directory.getFileHandle( filename ) ).getFile();
						if ( file.size > 2 * 1024 * 1024 || ! current ) continue;
						const url = URL.createObjectURL( file ); urls.push( url ); result[ manifest.id ][ key ] = url;

					} catch { /* Online browsing assets remain the fallback. */ }

				}

			}

			if ( current ) setMedia( result );

		} )().catch( () => {} );
		return () => {

			current = false; urls.forEach( url => URL.revokeObjectURL( url ) );

		};

	}, [ items, library ] );
	const all = new Map( catalogue.map( manifest => [ manifest.id, manifest ] ) );
	for ( const state of Object.values( states ) ) if ( state.manifest && ! all.has( state.manifest.id ) ) all.set( state.manifest.id, state.manifest );
	for ( const { manifest } of items ) if ( ! all.has( manifest.id ) ) all.set( manifest.id, manifest );
	return <section className="plate-gallery" aria-label="Driving plate sets"><div className="plate-gallery-heading"><h3>Choose a location</h3><span>Download once · play locally</span></div>
		{error && <p className="plate-hint">{error}</p>}
		{! all.size && <p>No plate sets are available yet.</p>}
		<div className="plate-gallery-grid">{Array.from( all.values() ).map( manifest => {

			const record = items.find( item => item.manifest.id === manifest.id );
			return <PlateCard key={manifest.id} manifest={manifest} ready={record?.ready && ( encoding === 'auto' || ( record.manifest.downloadedEncodings || [ 'hevc', 'h264' ] ).includes( encoding ) )} repair={record && ! record.ready} encoding={encoding} local={record?.manifest} media={media[ manifest.id ]} state={states[ manifest.id ]} client={client} onOpen={onOpen} onRemove={onRemove} disabled={disabled} onDiscard={async () => {

				try {

					await downloader.discard( manifest.id ); await refreshRef.current();

				} catch ( failure ) {

					downloader.update( manifest.id, { phase: 'error', error: failure.message } );

				}

			}} onPause={() => downloader.pause( manifest.id )} onDownload={async () => {

				try {

					await onBeforeDownload( manifest );
					const { manifest: saved } = await service.ensure( manifest );
					if ( saved ) {

						await refreshRef.current(); await onOpen( saved );

					}

				} catch ( failure ) {

					downloader.update( manifest.id, { phase: 'error', error: failure.message } );

				}

			}}/>;

		} )}</div>
	</section>;

}
