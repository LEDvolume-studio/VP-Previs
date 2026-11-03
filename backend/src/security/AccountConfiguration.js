import { SecurityError } from './AdminSecurity.js';

/** Explicit account activation is independent of the legacy device-draft API. */
export function requireAccountService( request, env, bindings = [] ) {

	const development = [ 'local', 'test' ].includes( env.ENVIRONMENT );
	const hosted = [ 'preview', 'production' ].includes( env.ENVIRONMENT );
	const enabled = development
		? env.ENABLE_ACCOUNT_API !== 'false' && ( env.ENABLE_ACCOUNT_API === 'true' || env.ENABLE_DRAFT_API === 'true' )
		: hosted && env.ENABLE_ACCOUNT_API === 'true' && env.ENABLE_HOSTED_ADMIN_AUTH === 'true' && env.ENABLE_DRAFT_API === 'false';
	if ( ! enabled || ! env.DB || bindings.some( name => ! env[ name ] ) ) throw new SecurityError( 503, 'NOT_CONFIGURED', 'Student accounts are not enabled.' );
	const url = new URL( request.url );
	const loopback = [ 'localhost', '127.0.0.1', '[::1]' ].includes( url.hostname );
	if ( url.protocol !== 'https:' && ! ( development && loopback ) ) throw new SecurityError( 403, 'HTTPS_REQUIRED', 'HTTPS is required.' );
	const mutation = ! [ 'GET', 'HEAD', 'OPTIONS' ].includes( request.method );
	if ( mutation && ( env.ENABLE_ACCOUNT_WRITES === 'false' || ( hosted && env.ENABLE_ACCOUNT_WRITES !== 'true' ) ) ) throw new SecurityError( 503, 'ACCOUNT_WRITES_DISABLED', 'Student account changes are temporarily unavailable.' );

}
