import { AccountApiError, AccountProjectClient } from '../../previs/api/AccountProjectClient.js';
import { validateStudentProjectDocument } from '../../previs/domain/StudentProjectSchema.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Capture the fragment before any network requests; never send the URL itself. */
export function loginFragment( hash = location.hash ) {

	const params = new URLSearchParams( hash.startsWith( '#' ) ? hash.slice( 1 ) : hash );
	const values = params.getAll( 'login' );
	if ( ! values.length ) return null;
	if ( values.length !== 1 || ! UUID.test( values[ 0 ] ) ) throw new AccountApiError( 'INVALID_LINK', { status: 401 } );
	return values[ 0 ];

}

export function removeLoginFragment() {

	const url = new URL( location.href );
	const params = new URLSearchParams( url.hash.slice( 1 ) ); params.delete( 'login' );
	url.hash = params.toString();
	history.replaceState( history.state, '', `${url.pathname}${url.search}${url.hash}` );

}

/** Only an online validation response can add a credential to the registry. */
export async function resolveStudentIdentity( registry, { hash = location.hash, baseURL = location.origin, signal, clientFactory = options => new AccountProjectClient( options ) } = {} ) {

	const credential = loginFragment( hash );
	if ( ! credential ) return { identity: await registry.active(), incoming: false };
	const client = clientFactory( { baseURL, credential } );
	const result = await client.request( 'GET', '/v1/student/me', { signal } );
	const userId = result?.user?.userId, accessGeneration = result?.accessGeneration;
	if ( ! UUID.test( userId || '' ) || ! Number.isSafeInteger( accessGeneration ) || accessGeneration < 1 ) throw new AccountApiError( 'INVALID_RESPONSE', { retryable: true } );
	const identity = { userId, credential, accessGeneration };
	return { identity, incoming: true };

}

/** Install the first cloud project without producing a synthetic local edit. */
export async function bootstrapStudentProject( { client, workspace, signal } ) {

	const result = await client.request( 'POST', '/v1/student/bootstrap', { key: crypto.randomUUID(), body: {}, signal } );
	const projectId = result?.project?.projectId, document = result?.document, serverRevision = result?.project?.serverRevision;
	if ( ! UUID.test( projectId || '' ) || document?.projectId !== projectId || ! Number.isSafeInteger( serverRevision ) || serverRevision < 0 ) throw new AccountApiError( 'INVALID_RESPONSE', { retryable: true } );
	for ( const [ mediaId, asset ] of Object.entries( document.narration.assets ) ) {

		const blob = await client.downloadNarration( { projectId, mediaId, signal } );
		const digest = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await blob.arrayBuffer() ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
		if ( blob.size !== asset.byteLength || blob.type.replaceAll( ' ', '' ) !== asset.mimeType.toLowerCase().replaceAll( ' ', '' ) || digest !== asset.sha256 ) throw new AccountApiError( 'DEPENDENCIES_PENDING', { retryable: true } );
		if ( signal?.aborted ) throw new AccountApiError( 'CANCELLED' );
		const old = await workspace.narration.get( asset.assetId );
		if ( old ) {

			const oldDigest = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await old.blob.arrayBuffer() ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			if ( oldDigest !== asset.sha256 ) throw new AccountApiError( 'CONFLICT' );

		} else await workspace.narration.put( { assetId: asset.assetId, projectId, asset, blob } );

	}

	if ( signal?.aborted ) throw new AccountApiError( 'CANCELLED' );
	const adopted = await workspace.repository.adoptRemoteHead( document, { serverRevision } );
	if ( ! adopted.adopted && adopted.reason !== 'STALE_REMOTE' ) throw new AccountApiError( 'CONFLICT' );
	if ( workspace.repository.rememberAccountSummary ) await workspace.repository.rememberAccountSummary( result.project );
	return result;

}

/** Cache a complete verified immutable default only after its narration is durable. */
export async function refreshAccountDefault( { client, workspace, signal } ) {

	const result = await client.request( 'GET', '/v1/student/default', { signal } );
	const version = result?.version;
	if ( ! version || ! UUID.test( version.versionId || '' ) || version.versionId !== result.versionId || ! Number.isSafeInteger( result.revision ) || result.revision < 0 ) throw new AccountApiError( 'INVALID_RESPONSE', { retryable: true } );
	try {

		validateStudentProjectDocument( version.document );

	} catch {

		throw new AccountApiError( 'INVALID_RESPONSE', { retryable: true } );

	}

	for ( const asset of Object.values( version.document.narration.assets ) ) {

		const blob = await client.request( 'GET', `/v1/student/default/versions/${version.versionId}/narration/${asset.sha256}`, { signal, binary: true } );
		const digest = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await blob.arrayBuffer() ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
		if ( blob.size !== asset.byteLength || blob.type.replaceAll( ' ', '' ) !== asset.mimeType.toLowerCase().replaceAll( ' ', '' ) || digest !== asset.sha256 ) throw new AccountApiError( 'DEPENDENCIES_PENDING', { retryable: true } );
		if ( signal?.aborted ) throw new AccountApiError( 'CANCELLED' );
		const old = await workspace.narration.get( asset.assetId );
		if ( old ) {

			const oldDigest = Array.from( new Uint8Array( await crypto.subtle.digest( 'SHA-256', await old.blob.arrayBuffer() ) ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			if ( oldDigest !== digest ) throw new AccountApiError( 'CONFLICT' );

		} else await workspace.narration.put( { assetId: asset.assetId, asset, blob } );

	}

	if ( signal?.aborted ) throw new AccountApiError( 'CANCELLED' );
	await workspace.repository.cacheAccountDefault( { ...version, pointerRevision: result.revision } );
	return version.versionId;

}
