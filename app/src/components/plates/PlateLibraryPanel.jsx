import { useEffect, useRef, useState } from 'react';
import { LocalPlateLibrary } from '../../services/plates/LocalPlateLibrary.js';
import { PlateSetSource } from '../../services/plates/PlateSetSource.js';
import { PLATE_FPS, PLATE_SLOTS, plateSlotFromName } from '../../services/plates/PlateSet.js';
import './plates.css';
import PlateGallery from './PlateGallery.jsx';
import { getPlateLibraryService } from '../../services/plates/PlateLibraryService.js';

const size = bytes => `${( bytes / 1024 / 1024 ).toFixed( 1 )} MiB`;

/** Local intake pilot; publishing and scene binding are separate milestones. */
export default function PlateLibraryPanel( { admin = false, onSelect } ) {

	const [ library ] = useState( () => new LocalPlateLibrary() );
	const [ items, setItems ] = useState( [] ), [ name, setName ] = useState( '' ), [ files, setFiles ] = useState( {} );
	const [ busy, setBusy ] = useState( false ), [ status, setStatus ] = useState( '' ), [ error, setError ] = useState( '' );
	const encoding = 'auto';
	const [ selected, setSelected ] = useState( null ), [ openedEncoding, setOpenedEncoding ] = useState( '' );
	const [ frame, setFrame ] = useState( 0 ), [ heading, setHeading ] = useState( 0 ), [ offset, setOffset ] = useState( 0 );
	const [ playing, setPlaying ] = useState( false ), [ lastView, setLastView ] = useState( 'front' ), [ persistence, setPersistence ] = useState( null );
	const canvas = useRef( null ), player = useRef( null ), operation = useRef( null ), mounted = useRef( true ), currentFrame = useRef( 0 );

	useEffect( () => {

		mounted.current = true;
		library.list().then( value => mounted.current && setItems( value ) ).catch( failure => mounted.current && setError( failure.message ) );
		navigator.storage?.persisted?.().then( value => mounted.current && setPersistence( value ) ).catch( () => {} );
		return () => {

			mounted.current = false; operation.current?.abort(); player.current?.dispose();

		};

	}, [ library ] );

	const progress = value => {

		if ( mounted.current ) setStatus( `${value.phase === 'checking' ? 'Checking parameters' : value.phase === 'saving' ? 'Saving on this device' : 'Verifying saved file'} · ${value.slot} · ${Math.round( value.completed / value.total * 100 )}%` );

	};

	const run = async task => {

		if ( operation.current ) return;
		const controller = new AbortController(); operation.current = controller;
		setBusy( true ); setPlaying( false ); setError( '' );
		try {

			await task( controller.signal );

		} catch ( failure ) {

			if ( mounted.current ) {

				setError( failure.name === 'AbortError' ? '' : failure.message );
				setStatus( failure.name === 'AbortError' ? 'Operation cancelled.' : 'Operation failed. Review the error and retry.' );

			}

		} finally {

			operation.current = null;
			if ( mounted.current ) setBusy( false );

		}

	};

	const close = async () => {

		const previous = player.current; player.current = null;
		await previous?.dispose();
		if ( mounted.current ) {

			setSelected( null ); setOpenedEncoding( '' );

		}

	};

	const open = manifest => run( async signal => {

		await close();
		if ( onSelect ) {

			setStatus( 'Applying driving plates…' );
			const local = await getPlateLibraryService().ensure( manifest, { signal } );
			await onSelect( local.manifest ); return;

		}

		let source;
		try {

			source = await PlateSetSource.open( library, manifest, { signal, encoding, onProgress: progress } );

		} catch ( failure ) {

			if ( mounted.current ) setItems( await library.list() ); throw failure;

		}

		if ( ! mounted.current || signal.aborted ) {

			await source.dispose(); signal.throwIfAborted(); return;

		}

		player.current = source; currentFrame.current = 0; setSelected( manifest ); setFrame( 0 ); setHeading( manifest.headingOffset );
		setOpenedEncoding( source.encoding ); setStatus( 'Playing verified local files. No video network requests are needed.' );

	} );

	useEffect( () => {

		if ( ! selected || playing || ! player.current ) return;
		let current = true; currentFrame.current = frame;
		player.current.drawAt( frame / PLATE_FPS, canvas.current.getContext( '2d', { alpha: false } ), { heading } ).then( result => {

			if ( result && current ) setLastView( result.view );

		} ).catch( failure => current && setError( failure.message ) );
		return () => {

			current = false;

		};

	}, [ selected, frame, heading, playing ] );

	useEffect( () => {

		if ( ! playing || ! selected || ! player.current ) return;
		let current = true, handle;
		const source = player.current, start = performance.now() - currentFrame.current / PLATE_FPS * 1000;
		const tick = async now => {

			if ( ! current ) return;
			try {

				const next = Math.min( selected.frameCount - 1, Math.floor( ( now - start ) / 1000 * PLATE_FPS ) );
				const result = await source.drawAt( next / PLATE_FPS, canvas.current.getContext( '2d', { alpha: false } ), { heading } );
				if ( ! current ) return;
				if ( result ) {

					currentFrame.current = next; setFrame( next ); setLastView( result.view );

				}

				if ( next >= selected.frameCount - 1 ) {

					setPlaying( false ); return;

				}

				handle = requestAnimationFrame( tick );

			} catch ( failure ) {

				if ( current ) {

					setError( failure.message ); setPlaying( false );

				}

			}

		};

		handle = requestAnimationFrame( tick );
		return () => {

			current = false; cancelAnimationFrame( handle );

		};

	}, [ playing, selected, heading ] );

	const assignFiles = list => {

		const next = { ...files }, unknown = [];
		for ( const file of list ) {

			const slot = plateSlotFromName( file.name );
			if ( ! slot ) unknown.push( file.name );
			else next[ slot ] = file;

		}

		setFiles( next ); setError( unknown.length ? `Unrecognised filename: ${unknown.join( ', ' )}. Use the eight names listed below.` : '' );

	};

	return <div className="plate-library">
		<header><h2>Select Driving Plates</h2><p>Choose a driving location for your scene.</p></header>
		<p className="plate-notice">Select a location to download its four synchronised views. Your device chooses the video format automatically.</p>
		{error && <p className="plate-error" role="alert">{error}</p>}
		{status && <p className="plate-status" role="status" aria-live="polite">{status}</p>}
		{busy && ! onSelect && <button onClick={() => operation.current?.abort()}>Cancel operation</button>}
		<PlateGallery onBeforeDownload={async manifest => {

			setError( '' ); setStatus( '' );

			if ( player.current?.manifest.id === manifest.id ) {

				setPlaying( false ); await close();

			}

		}} library={library} items={items} encoding={encoding} disabled={busy} onOpen={open} onRefresh={async () => {

			if ( mounted.current ) setItems( await library.list() );

		}} onRemove={manifest => run( async () => {

			if ( player.current?.manifest.id === manifest.id ) await close();
			await library.remove( manifest.id ); setItems( await library.list() ); setStatus( 'Local copy removed.' );

		} )}/>
		<div className={`plate-columns ${selected ? '' : 'plate-storage-only'}`}>
			<section aria-label="Sets on this device"><details className="plate-storage-options"><summary>Device storage</summary>

				<button disabled={busy} onClick={() => run( async () => {

					setItems( await library.list() ); setStatus( 'Local library refreshed.' );

				} )}>Refresh library</button>
				<p className="plate-hint">{persistence === true ? 'Persistent browser storage granted.' : 'Browser storage may be cleared automatically.'} Site-data clearing and managed-device cleanup can remove local copies.</p>
				<button disabled={busy || persistence === true} onClick={() => run( async () => {

					const granted = await navigator.storage?.persist?.(); setPersistence( !! granted ); setStatus( granted ? 'Persistent browser storage granted.' : 'The browser did not grant persistent storage. Local playback still works.' );

				} )}>Keep downloads on this device</button>
			</details></section>
			<section aria-label="Synchronised plate preview" hidden={! selected}><h3>{selected?.name || 'Plate preview'}</h3>
				<canvas ref={canvas} width={selected?.files[ 'front-hevc' ].width || 1280} height={selected?.files[ 'front-hevc' ].height || 720} style={{ aspectRatio: `1280 / ${selected?.files[ 'front-hevc' ].height || 720}` }} aria-label="Selected driving plate view"/>
				<p className="plate-readout">{selected ? `${openedEncoding.toUpperCase()} · ${lastView} · frame ${frame + 1} / ${selected.frameCount} · ${( frame / PLATE_FPS ).toFixed( 2 )} s` : 'Open a verified set to preview it.'}</p>
				<label>Frame<input aria-label="Plate frame" type="range" min="0" max={Math.max( 0, ( selected?.frameCount || 1 ) - 1 )} step="1" value={frame} disabled={! selected || busy || playing} onChange={event => setFrame( Number( event.target.value ) )}/></label>
				<div className="plate-actions"><button disabled={! selected || busy} onClick={() => {

					if ( ! playing && frame === selected.frameCount - 1 ) {

						currentFrame.current = 0; setFrame( 0 );

					}

					setPlaying( ! playing );

				}}>{playing ? 'Pause plates' : 'Play plates'}</button><button disabled={! selected || busy || playing || frame === 0} onClick={() => setFrame( frame - 1 )}>Previous frame</button><button disabled={! selected || busy || playing || frame === selected.frameCount - 1} onClick={() => setFrame( frame + 1 )}>Next frame</button></div>
				<label>Car heading relative to wall: {heading}°<input aria-label="Relative car heading" type="range" min="-180" max="360" step="1" value={heading} disabled={! selected || busy} onChange={event => setHeading( Number( event.target.value ) )}/></label>
				<p className="plate-hint">Front at the set’s zero heading, right at +90°, rear at +180°, left at +270°. Rotate the preview heading to inspect the views at the same source frame.</p>
			</section>
		</div>
		{admin && <section className="plate-import" aria-label="Import a plate set"><h3>Test a new set on this device</h3><p>Select eight prepared MP4 files: 1280 × 720 or 1280 × 890, constant 25 fps, SDR BT.709 limited range, 8-bit 4:2:0, no audio, at most 300 seconds and 512 MiB each. Use fast-start MP4 with keyframes at least once per second. All eight files must contain matching frames.</p>
			<button disabled={busy} onClick={() => run( async () => {

				const count = await library.discardInterruptedImports(); setStatus( `${count} interrupted local imports removed.` );

			} )}>Discard interrupted imports</button>
			<label>Location name<input aria-label="Plate location name" value={name} maxLength="120" disabled={busy} onChange={event => setName( event.target.value )}/></label>
			<label>Front-view heading offset (degrees)<input aria-label="Plate heading offset" type="number" min="-360" max="360" value={offset} disabled={busy} onChange={event => setOffset( Number( event.target.value ) )}/></label>
			<label>Select prepared videos<input aria-label="Prepared plate videos" type="file" accept=".mp4,video/mp4" multiple disabled={busy} onChange={event => {

				assignFiles( Array.from( event.target.files ) ); event.target.value = '';

			}}/></label>
			<ul>{PLATE_SLOTS.map( slot => <li key={slot}><code>{slot}.mp4</code><span>{files[ slot ] ? size( files[ slot ].size ) : 'Not selected'}</span></li> )}</ul>
			<button disabled={busy || ! name.trim() || PLATE_SLOTS.some( slot => ! files[ slot ] )} onClick={() => run( async signal => {

				const manifest = await library.importSet( { name, files, headingOffset: offset }, { signal, onProgress: progress } );
				if ( ! mounted.current ) return;
				setItems( await library.list() ); setFiles( {} ); setStatus( `${manifest.name} saved and ready on this device. Open its preview to test decoding.` );

			} )}>Validate and save local set</button>
		</section>}
	</div>;

}
