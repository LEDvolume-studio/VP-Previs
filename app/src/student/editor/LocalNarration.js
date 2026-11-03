import { assetVersionKey, createStudentId } from '../../previs/domain/StudentProjectSchema.js';
import { createSequenceEvaluator } from '../../previs/sequence/evaluateSequence.js';

const hash = async blob => Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await blob.arrayBuffer() ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );

export class LocalNarrationStore {

	constructor( { databaseName = 'RayzeeNarrationDB', databaseFactory = globalThis.indexedDB } = {} ) {

		this.databaseName = databaseName;
		this.databaseFactory = databaseFactory;

	}

	async database() {

		if ( this.deactivated ) throw new Error( 'This account session is closed.' );
		this.connection ||= new Promise( ( resolve, reject ) => {

			const request = this.databaseFactory.open( this.databaseName, 1 );
			request.onupgradeneeded = () => request.result.createObjectStore( 'recordings', { keyPath: 'assetId' } );
			request.onsuccess = () => {

				if ( this.deactivated ) {

					request.result.close(); reject( new Error( 'This account session is closed.' ) ); return;

				}

				resolve( request.result );

			};

			request.onerror = () => reject( request.error );
			request.onblocked = () => reject( new Error( 'Another tab is blocking local voiceover storage.' ) );

		} );
		return this.connection;

	}
	async close() {

		if ( this.connection ) ( await this.connection ).close();
		this.connection = null;

	}
	deactivate() {

		this.deactivated = true;
		this.close().catch( () => {} );

	}
	async put( row ) {

		const db = await this.database();
		if ( this.deactivated ) throw new Error( 'This account session is closed.' );
		await new Promise( ( resolve, reject ) => {

			const tx = db.transaction( 'recordings', 'readwrite' ); tx.objectStore( 'recordings' ).put( row );
			tx.oncomplete = resolve; tx.onabort = () => reject( tx.error ); tx.onerror = () => reject( tx.error );

		} );

	}
	async get( assetId ) {

		const db = await this.database();
		if ( this.deactivated ) throw new Error( 'This account session is closed.' );
		return new Promise( ( resolve, reject ) => {

			const request = db.transaction( 'recordings', 'readonly' ).objectStore( 'recordings' ).get( assetId );
			request.onsuccess = () => resolve( request.result ); request.onerror = () => reject( request.error );

		} );

	}

}

/** Local microphone files and Web Audio scheduling; nothing uploads narration. */
export class LocalNarration {

	constructor( { store = new LocalNarrationStore() } = {} ) {

		this.store = store; this.sources = []; this.buffers = new Map(); this.generation = 0; this.captureGeneration = 0;

	}
	async unlock() {

		this.context ||= new AudioContext(); await this.context.resume();

	}
	async start( projectId, onEnded ) {

		if ( ! navigator.mediaDevices?.getUserMedia || ! globalThis.MediaRecorder || ! globalThis.AudioContext ) throw new Error( 'Microphone recording needs a supported browser on HTTPS or localhost.' );
		await this.unlock();
		const generation = ++ this.captureGeneration;
		const stream = await navigator.mediaDevices.getUserMedia( { audio: true } );
		if ( this.disposed || generation !== this.captureGeneration ) {

			stream.getTracks().forEach( track => track.stop() ); return;

		}

		this.stream = stream; this.projectId = projectId;
		const chunks = this.chunks = [];
		try {

			const mimeType = [ 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm' ].find( type => MediaRecorder.isTypeSupported( type ) );
			const recorder = this.recorder = new MediaRecorder( stream, mimeType ? { mimeType } : undefined );
			this.completion = new Promise( ( resolve, reject ) => {

				recorder.ondataavailable = event => {

					if ( event.data.size ) chunks.push( event.data );

				};

				recorder.onerror = event => {

					reject( event.error || new Error( 'Microphone recording failed.' ) );
					stream.getTracks().forEach( track => track.stop() ); onEnded?.();

				};

				recorder.onstop = () => {

					stream.getTracks().forEach( track => track.stop() ); resolve( new Blob( chunks, { type: recorder.mimeType } ) );

				};

			} );
			// Avoid an unhandled rejection if the browser interrupts capture before Stop.
			this.completion.catch( () => {} );
			stream.getAudioTracks()[ 0 ].onended = () => onEnded?.();
			this.recorder.start( 1000 );

		} catch ( error ) {

			stream.getTracks().forEach( track => track.stop() ); throw error;

		}

	}
	async finish() {

		if ( ! this.recorder && ! this.pendingBlob ) throw new Error( 'There is no recording to save.' );
		if ( this.recorder && this.recorder.state !== 'inactive' ) this.recorder.stop();
		let blob = this.pendingBlob;
		try {

			blob ||= await this.completion; this.pendingBlob = blob;

		} finally {

			this.stream?.getTracks().forEach( track => track.stop() ); this.stream = null; this.recorder = null;

		}

		if ( ! blob.size ) throw new Error( 'No microphone audio was captured. Try recording again.' );
		const assetId = this.pendingAssetId ||= createStudentId();
		// Keep the original local file even if decoding or the project commit fails.
		await this.store.put( { assetId, projectId: this.projectId, blob } );
		const buffer = await this.context.decodeAudioData( await blob.arrayBuffer() );
		const sha256 = await hash( blob );
		const asset = { assetId, version: '1', sha256, byteLength: blob.size, mimeType: blob.type, codec: blob.type.includes( 'webm' ) ? 'opus' : 'aac', sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, durationSamples: buffer.length, segments: [ { index: 0, sha256, byteLength: blob.size } ] };
		await this.store.put( { assetId, projectId: this.projectId, blob, asset } );
		this.buffers.set( assetVersionKey( asset ), buffer ); this.pendingBlob = null; this.pendingAssetId = null; return asset;

	}
	stopPlayback() {

		++ this.generation; for ( const source of this.sources ) {

			try {

				source.stop();

			} catch { /* Already ended. */ }

			source.disconnect();

		}

		this.sources = [];

	}
	async play( document, frame ) {

		this.stopPlayback(); const generation = this.generation;
		if ( ! document.narration.clips.length ) return;
		await this.unlock();
		const evaluator = createSequenceEvaluator( document ), spans = evaluator.spans;
		const prepared = [];
		for ( const clip of document.narration.clips ) {

			if ( clip.muted || ! clip.gain ) continue;
			const anchor = clip.anchor.type === 'clip' ? spans.find( span => span.clipId === clip.anchor.clipId ) : null;
			if ( clip.anchor.type === 'clip' && ! anchor ) continue;
			const asset = document.narration.assets[ assetVersionKey( clip.media ) ];
			const start = ( anchor?.startFrame || 0 ) + clip.offsetFrames;
			const end = Math.min( start + clip.lengthSamples / asset.sampleRate * 25, anchor?.endFrame ?? evaluator.totalFrames, evaluator.totalFrames );
			if ( end <= frame ) continue;
			const key = assetVersionKey( asset );
			if ( ! this.buffers.has( key ) ) {

				const row = await this.store.get( asset.assetId );
				if ( ! row || row.blob.size !== asset.byteLength || await hash( row.blob ) !== asset.sha256 ) throw new Error( 'A voiceover file is missing from this browser. Record it again on this device.' );
				this.buffers.set( key, await this.context.decodeAudioData( await row.blob.arrayBuffer() ) );

			}

			prepared.push( { clip, asset, start, end, buffer: this.buffers.get( key ) } );

		}

		if ( generation !== this.generation ) return;
		const now = this.context.currentTime;
		for ( const { clip, asset, start, end, buffer } of prepared ) {

			const source = this.context.createBufferSource(), gain = this.context.createGain();
			source.buffer = buffer; gain.gain.value = clip.gain; source.connect( gain ); gain.connect( this.context.destination );
			source.start( now + Math.max( 0, start - frame ) / 25, clip.sourceStartSample / asset.sampleRate + Math.max( 0, frame - start ) / 25, ( end - Math.max( frame, start ) ) / 25 );
			this.sources.push( source ); source.onended = () => gain.disconnect();

		}

	}
	cancel() {

		++ this.captureGeneration;
		if ( this.recorder?.state === 'recording' ) this.recorder.stop();
		this.stream?.getTracks().forEach( track => track.stop() );
		this.stream = null; this.recorder = null; this.pendingBlob = null; this.pendingAssetId = null; this.chunks = [];

	}
	async dispose() {

		this.disposed = true; ++ this.captureGeneration; this.stopPlayback();
		if ( this.recorder?.state === 'recording' ) this.recorder.stop();
		this.stream?.getTracks().forEach( track => track.stop() ); this.buffers.clear(); await this.context?.close();

	}

}
