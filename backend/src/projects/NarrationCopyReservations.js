/** Reserve prior to R2 upload. Pending reservations are never swept. */
export async function reserveNarrationCopy( env, objectKey ) {

	await env.DB.prepare( "INSERT INTO narration_copy_reservations (object_key,state,created_at) VALUES (?,'pending',?)" ).bind( objectKey, Date.now() ).run();

}

/** Only call after a copy attempt has settled and cannot commit. */
export async function abandonNarrationCopy( env, objectKey ) {

	await env.DB.prepare( "UPDATE narration_copy_reservations SET state='abandoned' WHERE object_key=? AND state='pending'" ).bind( objectKey ).run();

}

/**
 * Explicit bounded maintenance. Tombstones persist and are revisited because a
 * failed R2 request might have written bytes after returning an error. Pending
 * and live copies are never deleted, even after a worker crash.
 */
export async function cleanupAbandonedNarrationCopies( env, { maximum = 100 } = {} ) {

	if ( ! Number.isSafeInteger( maximum ) || maximum < 1 || maximum > 1000 ) throw new TypeError( 'A bounded cleanup limit is required.' );
	const rows = await env.DB.prepare( "SELECT object_key FROM narration_copy_reservations WHERE state='abandoned' ORDER BY COALESCE(last_swept_at,0),created_at LIMIT ?" ).bind( maximum ).all();
	for ( const { object_key: objectKey } of rows.results ) {

		await env.NARRATION.delete( objectKey );
		await env.DB.prepare( "UPDATE narration_copy_reservations SET last_swept_at=? WHERE object_key=? AND state='abandoned'" ).bind( Date.now(), objectKey ).run();

	}

	return rows.results.length;

}
