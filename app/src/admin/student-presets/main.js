import '../../student/student.css';
import { AdminCatalogueClient } from '../../previs/api/AdminCatalogueClient.js';
import { validateStudentPresetVersion } from '../../previs/domain/StudentCatalogueSchema.js';
import { validatePresetModelBytes } from '../../previs/engine/SupportedGLB.js';
import { DecodedLEDSource } from '../../previs/media/DecodedLEDSource.js';

const root = document.querySelector( '#publisher-app' );
const client = new AdminCatalogueClient( { baseURL: location.origin } );
const state = { preset: null, files: new Map(), operation: null, head: null, busy: false, phase: 'idle', status: 'Choose a prepared supported preset JSON file.', error: '', availability: null };
const escape = value => String( value ).replace( /[&<>"']/g, character => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } )[ character ] );
const disabled = value => value ? ' disabled' : '';
const timeout = () => AbortSignal.timeout( 60000 );
const errorMessage = error => error.code === 'AUTHORIZATION' ? 'Sign in with the admin password, then retry this operation.' : error.code === 'CONFLICT' ? 'The catalogue changed or this version already exists. Discard this preparation, review the latest head and choose a new version. Nothing is overwritten.' : error.code ? `Request failed (${error.code}). Retry keeps the same prepared version and original catalogue precondition.` : error.message;
async function run( task ) {

	if ( state.busy ) return;
	state.busy = true; state.error = ''; render();
	try {

		await task();

	} catch ( error ) {

		state.error = errorMessage( error );

	} finally {

		state.busy = false; render();

	}

}

async function importPreset( file ) {

	if ( file.size > 1024 * 1024 ) throw new Error( 'Choose a prepared preset JSON file no larger than 1 MiB.' );
	const preset = JSON.parse( await file.text() );
	validateStudentPresetVersion( preset );
	if ( preset.schemaVersion !== 2 ) throw new Error( 'Publishing here requires a supported v2 preset with complete scene mappings. Older presets remain readable by students.' );
	state.preset = structuredClone( preset ); state.files = new Map(); state.operation = null; state.head = null;
	state.phase = 'imported'; state.status = 'Preset metadata validated. Choose the exact model/video/image files listed below.';

}

async function assignFiles( files ) {

	const assets = Object.values( state.preset.assets );
	for ( const file of files ) {

		if ( file.size > 64 * 1024 * 1024 ) throw new Error( 'Each source file must fit the current 64 MiB publishing limit.' );
		const candidates = assets.filter( asset => asset.byteLength === file.size );
		if ( ! candidates.length ) throw new Error( `No required asset matches the size of ${file.name}.` );
		const bytes = await file.arrayBuffer();
		const hash = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
		const matching = candidates.filter( asset => asset.sha256 === hash );
		if ( ! matching.length ) throw new Error( `The bytes of ${file.name} do not match any required immutable asset.` );
		for ( const asset of matching ) state.files.set( `${asset.assetId}@${asset.version}`, file );

	}

	state.status = `${state.files.size} of ${assets.length} required asset versions selected. Review and prepare before publishing.`;

}

async function prepare() {

	const preset = state.preset;
	for ( const asset of Object.values( preset.assets ) ) {

		const file = state.files.get( `${asset.assetId}@${asset.version}` );
		if ( ! file ) throw new Error( `Choose the exact file for ${asset.assetId}@${asset.version}.` );
		const bytes = new Uint8Array( await file.arrayBuffer() );
		const model = preset.sceneDefinition.models.find( model => model.asset.assetId === asset.assetId && model.asset.version === asset.version );
		if ( model ) validatePresetModelBytes( preset, model, bytes );
		if ( asset.kind === 'video' ) {

			const source = await DecodedLEDSource.open( new Blob( [ bytes ], { type: asset.mimeType } ) );
			try {

				if ( Math.abs( source.duration * 1000000 - asset.durationUs ) > 1000 ) throw new Error( `Video duration disagrees with ${asset.assetId}@${asset.version}.` );

			} finally {

				source.dispose();

			}

		}

	}

	state.head = await client.getHead( preset.presetId, { signal: timeout() } );
	state.operation = client.preparePublication( { preset, headRevision: state.head?.headRevision ?? null, requestId: crypto.randomUUID() } );
	state.phase = 'prepared'; state.status = 'Ready to publish this exact version. Publishing uploads the selected bytes and makes this preset available to students.';

}

async function publish() {

	for ( const asset of Object.values( state.preset.assets ) ) {

		state.status = `Uploading verified asset ${asset.assetId}@${asset.version}…`; render();
		await client.uploadAsset( asset, new Uint8Array( await state.files.get( `${asset.assetId}@${asset.version}` ).arrayBuffer() ), { signal: timeout() } );

	}

	const ack = await client.publish( state.operation, { signal: timeout() } );
	state.operation = null; state.phase = 'published';
	state.status = `Version ${ack.version} was published${ack.replayed ? ' (confirmed from its original receipt)' : ''}. Refresh its catalogue status before making further changes.`;
	state.head = null;

}

async function refreshHead() {

	state.head = await client.getHead( state.preset.presetId, { signal: timeout() } );
	state.status = state.head ? `Current published version ${state.head.version} is ${state.head.available ? 'available' : 'hidden'} (catalogue revision ${state.head.headRevision}).` : 'This preset has no published version yet.';

}

async function toggleAvailability() {

	if ( ! state.availability ) state.availability = client.prepareAvailability( { presetId: state.head.presetId, version: state.head.version, available: ! state.head.available, headRevision: state.head.headRevision, requestId: crypto.randomUUID() } );
	const ack = await client.setAvailability( state.availability, { signal: timeout() } );
	state.availability = null; state.head = null;
	state.status = `Version ${ack.version} availability change confirmed. Refresh to see the current catalogue head. Existing student copies are preserved.`;

}

function render() {

	const preset = state.preset, locked = state.busy || Boolean( state.operation ) || Boolean( state.availability );
	root.innerHTML = `<header><div><span class="eyebrow">Rayzee / admin</span><h1>Student preset publishing</h1></div><div class="toolbar"><a href="/">Admin editor</a><a href="/student/">Student workspace</a><a href="/admin/sign-in">Admin sign in</a></div></header><main>
	<div class="notice">Publish a prepared supported preset and its exact source files. Live capture controls in the editor are still being connected. Raw admin project files cannot be published here. The catalogue service currently operates in local/test environments.</div>
	<p id="publisher-status" role="status" data-phase="${state.phase}">${escape( state.status )}</p><p id="publisher-error" class="error" role="alert">${escape( state.error )}</p>
	<section class="panel"><h2>1. Prepared preset</h2><label class="field">Supported preset JSON<input id="prepared-preset" type="file" accept="application/json,.json"${disabled( locked )}></label>${preset ? `<h3>${escape( preset.name )}</h3><p>${escape( preset.description )}</p><p>${escape( preset.presetId )} · version ${escape( preset.version )} · ${escape( preset.category )} · ${preset.defaultDurationFrames} frames</p><small>${Object.keys( preset.snapshot.nodes ).length} mapped nodes · ${preset.snapshot.lights.length} lights · ${preset.snapshot.ledWalls.length} LED walls</small>` : ''}</section>
	${preset ? `<section class="panel"><h2>2. Exact source files</h2><label class="field">Choose required files<input id="preset-assets" type="file" multiple${disabled( locked )}></label><ul>${Object.values( preset.assets ).map( asset => `<li>${escape( asset.assetId )}@${escape( asset.version )} · ${asset.byteLength.toLocaleString()} bytes · ${state.files.has( `${asset.assetId}@${asset.version}` ) ? 'Selected and hash matched' : 'File required'}</li>` ).join( '' )}</ul><div class="toolbar"><button id="prepare-publication"${disabled( locked || state.files.size !== Object.keys( preset.assets ).length )}>Review files and prepare publication</button><button id="publish-preset"${disabled( state.busy || ! state.operation )}>${state.error && state.operation ? 'Retry exact publication' : 'Publish version'}</button><button id="discard-preparation"${disabled( state.busy || ( ! state.operation && ! state.availability ) )}>Discard pending preparation</button></div><small>Published versions are immutable. A new edit needs a new version. Failed or lost responses can be retried with the same prepared request; no newer catalogue head is silently replaced.</small></section>
	<section class="panel"><h2>3. Catalogue availability</h2><button id="refresh-preset-head"${disabled( locked )}>Refresh current status</button>${state.head ? `<p>Version ${escape( state.head.version )} · ${state.head.available ? 'Available' : 'Hidden'} · head revision ${state.head.headRevision}</p>` : ''}<button id="toggle-preset-availability"${disabled( state.busy || Boolean( state.operation ) || ( ! state.head && ! state.availability ) )}>${state.availability ? 'Retry exact availability change' : state.head?.available ? 'Hide current version' : 'Make current version available'}</button></section>` : ''}
	</main><footer>Publishing does not rewrite existing student shots. These files contain no student editing credentials. Source files remain on this device.</footer>`;
	document.querySelector( '#prepared-preset' ).addEventListener( 'change', event => {

		const file = event.target.files[ 0 ]; if ( file ) run( () => importPreset( file ) );

	} );
	document.querySelector( '#preset-assets' )?.addEventListener( 'change', event => {

		const files = [ ...event.target.files ]; if ( files.length ) run( () => assignFiles( files ) );

	} );
	for ( const [ id, action ] of [[ 'prepare-publication', prepare ], [ 'publish-preset', publish ], [ 'refresh-preset-head', refreshHead ], [ 'toggle-preset-availability', toggleAvailability ], [ 'discard-preparation', async () => {

		state.operation = null; state.availability = null; state.head = null; state.phase = 'imported'; state.status = 'Pending preparation discarded. Review the latest catalogue state before preparing again.';

	} ]] ) document.querySelector( `#${id}` )?.addEventListener( 'click', () => run( action ) );

}

render();
