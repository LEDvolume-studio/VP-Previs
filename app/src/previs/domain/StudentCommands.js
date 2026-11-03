import { assetVersionKey, baseSceneVersionKey, cloneStudentContent, createStudentId, validateStudentProjectDocument } from './StudentProjectSchema.js';
import { serializeStudentCatalogueContent, validateStudentPresetVersion } from './StudentCatalogueSchema.js';

const own = ( record, key ) => Object.hasOwn( record, key );
const requireNewId = ( record, key ) => {

	if ( typeof key !== 'string' || own( record, key ) ) throw new Error( 'A new stable ID is required.' );

};

const findClip = ( document, clipId ) => {

	const index = document.clips.findIndex( clip => clip.clipId === clipId );
	if ( index < 0 ) throw new Error( `Unknown timeline clip: ${clipId}` );
	return index;

};

const contentOf = document => cloneStudentContent( { name: document.name, assets: document.assets, baseScenes: document.baseScenes, shots: document.shots, clips: document.clips, narration: document.narration } );
const insertionIndex = ( index, length ) => {

	if ( ! Number.isSafeInteger( index ) || index < 0 || index > length ) throw new RangeError( 'Invalid timeline insertion index.' );
	return index;

};

const selectedIds = ( values, available, label ) => {

	if ( ! Array.isArray( values ) || new Set( values ).size !== values.length || values.some( value => ! available.has( value ) ) ) throw new Error( `Invalid ${label} selection.` );
	return new Set( values );

};

const clipStart = ( clips, clipId ) => {

	let frame = 0;
	for ( const clip of clips ) {

		if ( clip.clipId === clipId ) return frame;
		frame += clip.durationFrames;

	}

	throw new Error( 'Unknown timeline clip.' );

};

/** Move a contiguous shot block and explicitly selected independent audio together. */
const moveTimelineSelection = ( document, command ) => {

	const shots = selectedIds( command.clipIds, new Set( document.clips.map( clip => clip.clipId ) ), 'shot' );
	const narration = selectedIds( command.narrationClipIds, new Set( document.narration.clips.map( clip => clip.narrationClipId ) ), 'narration' );
	if ( ! shots.size && ! narration.size ) throw new Error( 'Select at least one timeline clip.' );
	let deltaFrames = command.deltaFrames;
	if ( shots.size ) {

		if ( deltaFrames !== undefined ) throw new Error( 'A shot block uses an insertion index, not a frame offset.' );
		const selected = document.clips.filter( clip => shots.has( clip.clipId ) );
		const first = document.clips.indexOf( selected[ 0 ] );
		if ( selected.some( ( clip, index ) => document.clips[ first + index ] !== clip ) ) throw new Error( 'Selected shots must form a contiguous block.' );
		const previousStart = clipStart( document.clips, selected[ 0 ].clipId );
		const remaining = document.clips.filter( clip => ! shots.has( clip.clipId ) );
		remaining.splice( insertionIndex( command.index, remaining.length ), 0, ...selected );
		document.clips = remaining;
		deltaFrames = clipStart( remaining, selected[ 0 ].clipId ) - previousStart;

	} else if ( command.index !== undefined || ! Number.isSafeInteger( deltaFrames ) ) {

		throw new Error( 'An audio-only move requires an integer frame offset.' );

	}

	for ( const clip of document.narration.clips ) {

		if ( ! narration.has( clip.narrationClipId ) ) continue;
		if ( clip.anchor.type !== 'sequence' ) throw new Error( 'Detach legacy shot-anchored narration before a group move.' );
		clip.offsetFrames += deltaFrames;

	}

};

/** Presets are copied, never edited in place or held by shared object identity. */
export function createShotFromPreset( preset, { shotId = createStudentId(), name = preset.name } = {} ) {

	return cloneStudentContent( { shotId, name, baseScene: preset.baseScene, sourcePreset: { presetId: preset.presetId, version: preset.version }, snapshot: preset.snapshot } );

}

/**
 * Pure completed-edit commands. Persistence commits document + outbox together.
 * Undo/redo applies the returned inverse as a NEW edit revision; revisions never
 * move backwards. Selection and transport deliberately are not edit commands.
 */
export function applyStudentCommand( input, command, { now = new Date().toISOString() } = {} ) {

	validateStudentProjectDocument( input );
	const document = cloneStudentContent( input );
	const inverse = { type: 'restoreContent', content: contentOf( input ) };
	switch ( command.type ) {

		case 'renameProject':
			document.name = command.name;
			break;
		case 'addAssetVersion': {

			const key = assetVersionKey( command.asset );
			requireNewId( document.assets, key );
			document.assets[ key ] = cloneStudentContent( command.asset );
			break;

		}

		case 'addBaseSceneVersion': {

			const key = baseSceneVersionKey( command.scene );
			requireNewId( document.baseScenes, key );
			document.baseScenes[ key ] = cloneStudentContent( command.scene );
			break;

		}

		case 'addShot':
			requireNewId( document.shots, command.shot?.shotId );
			document.shots[ command.shot.shotId ] = cloneStudentContent( command.shot );
			break;
		case 'addPresetShot': {

			const preset = validateStudentPresetVersion( command.preset );
			requireNewId( document.shots, command.shotId );
			const mergeVersion = ( target, key, value ) => {

				if ( own( target, key ) && serializeStudentCatalogueContent( target[ key ] ) !== serializeStudentCatalogueContent( value ) ) throw new Error( 'Immutable catalogue version conflicts with this project.' );
				target[ key ] = cloneStudentContent( value );

			};

			for ( const [ key, asset ] of Object.entries( preset.assets ) ) mergeVersion( document.assets, key, asset );
			mergeVersion( document.baseScenes, baseSceneVersionKey( preset.baseScene ), preset.baseScene );
			const baseScene = { sceneId: preset.baseScene.sceneId, version: preset.baseScene.version };
			document.shots[ command.shotId ] = createShotFromPreset( { ...preset, baseScene }, { shotId: command.shotId } );
			document.clips.push( { clipId: command.clipId, shotId: command.shotId, durationFrames: preset.defaultDurationFrames } );
			break;

		}

		case 'addCustomShot': {

			// A custom shot and its immutable base-scene manifest are one edit:
			// either both validate/commit, or neither is visible to persistence.
			const key = baseSceneVersionKey( command.scene );
			requireNewId( document.baseScenes, key );
			requireNewId( document.shots, command.shot?.shotId );
			if ( baseSceneVersionKey( command.shot.baseScene ) !== key || command.shot.sourcePreset !== null ) throw new Error( 'A custom shot must reference its new base scene without preset provenance.' );
			document.baseScenes[ key ] = cloneStudentContent( command.scene );
			document.shots[ command.shot.shotId ] = cloneStudentContent( command.shot );
			break;

		}

		case 'replaceShot':
			if ( ! own( document.shots, command.shot?.shotId ) ) throw new Error( 'Unknown shot.' );
			for ( const [ key, asset ] of Object.entries( command.assets || {} ) ) {

				if ( own( document.assets, key ) && serializeStudentCatalogueContent( document.assets[ key ] ) !== serializeStudentCatalogueContent( asset ) ) throw new Error( 'Immutable catalogue version conflicts with this project.' );
				document.assets[ key ] = cloneStudentContent( asset );

			}

			document.shots[ command.shot.shotId ] = cloneStudentContent( command.shot );
			break;
		case 'duplicateShot': {

			if ( ! own( document.shots, command.shotId ) ) throw new Error( 'Unknown shot.' );
			requireNewId( document.shots, command.newShotId );
			document.shots[ command.newShotId ] = { ...cloneStudentContent( document.shots[ command.shotId ] ), shotId: command.newShotId, name: command.name || `${document.shots[ command.shotId ].name} copy` };
			break;

		}

		case 'removeShot':
			if ( ! own( document.shots, command.shotId ) ) throw new Error( 'Unknown shot.' );
			if ( document.clips.some( clip => clip.shotId === command.shotId ) ) throw new Error( 'Remove this shot from the timeline before deleting it.' );
			delete document.shots[ command.shotId ];
			break;
		case 'insertClip':
			document.clips.splice( insertionIndex( command.index, document.clips.length ), 0, cloneStudentContent( command.clip ) );
			break;
		case 'duplicateClip': {

			const index = findClip( document, command.clipId );
			// A duplicate placement reuses its shot but has independent identity.
			// Recording references remain attached only to the original placement.
			document.clips.splice( index + 1, 0, { ...document.clips[ index ], clipId: command.newClipId } );
			break;

		}

		case 'removeClip':
			// Keep now-orphaned recordings and immutable media for restore/reattach.
			document.clips.splice( findClip( document, command.clipId ), 1 );
			break;
		case 'moveClip': {

			const index = findClip( document, command.clipId );
			const [ clip ] = document.clips.splice( index, 1 );
			document.clips.splice( insertionIndex( command.index, document.clips.length ), 0, clip );
			break;

		}

		case 'setClipDuration':
			document.clips[ findClip( document, command.clipId ) ].durationFrames = command.durationFrames;
			break;
		case 'addNarrationAsset': {

			const key = assetVersionKey( command.asset );
			requireNewId( document.narration.assets, key );
			document.narration.assets[ key ] = cloneStudentContent( command.asset );
			break;

		}

		case 'addNarrationClip': {

			const clip = cloneStudentContent( command.clip );
			// New recordings belong to their own track. Explicit legacy anchors
			// remain readable/importable but must not be created by this command.
			clip.anchor ??= { type: 'sequence' };
			if ( clip.anchor.type !== 'sequence' ) throw new Error( 'New narration must use the independent sequence track.' );
			document.narration.clips.push( clip );
			break;

		}

		case 'moveTimelineSelection':
			moveTimelineSelection( document, command );
			break;
		case 'detachNarrationFromShot': {

			const clip = document.narration.clips.find( item => item.narrationClipId === command.narrationClipId );
			if ( ! clip ) throw new Error( 'Unknown narration clip.' );
			if ( clip.anchor.type === 'clip' ) {

				// Explicit conversion preserves the absolute start. An orphan has
				// no resolvable start; the caller must choose its independent frame.
				const start = document.clips.some( item => item.clipId === clip.anchor.clipId ) ? clipStart( document.clips, clip.anchor.clipId ) + clip.offsetFrames : command.offsetFrames;
				if ( ! Number.isSafeInteger( start ) ) throw new Error( 'An orphaned recording needs an explicit frame position.' );
				clip.anchor = { type: 'sequence' };
				clip.offsetFrames = start;

			}

			break;

		}

		case 'replaceNarrationClip': {

			const index = document.narration.clips.findIndex( clip => clip.narrationClipId === command.clip?.narrationClipId );
			if ( index < 0 ) throw new Error( 'Unknown narration clip.' );
			document.narration.clips[ index ] = cloneStudentContent( command.clip );
			break;

		}

		case 'removeNarrationClip': {

			const index = document.narration.clips.findIndex( clip => clip.narrationClipId === command.narrationClipId );
			if ( index < 0 ) throw new Error( 'Unknown narration clip.' );
			document.narration.clips.splice( index, 1 );
			break;

		}

		case 'restoreContent': {

			const keys = [ 'name', 'assets', 'baseScenes', 'shots', 'clips', 'narration' ];
			if ( ! command.content || Object.keys( command.content ).length !== keys.length || keys.some( key => ! own( command.content, key ) ) ) throw new Error( 'Invalid undo content.' );
			Object.assign( document, cloneStudentContent( command.content ) );
			break;

		}

		default:
			throw new Error( `Unknown student edit command: ${command.type}` );

	}

	// No-op edits must not cause local writes or automatic private backups.
	if ( JSON.stringify( contentOf( document ) ) === JSON.stringify( inverse.content ) ) return { document: input, inverse: null, changed: false };
	document.revision = input.revision + 1;
	document.updatedAt = now;
	validateStudentProjectDocument( document );
	return { document, inverse, changed: true };

}
