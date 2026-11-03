import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './users.css';

async function request( path, { method = 'GET', body, key } = {} ) {

	const response = await fetch( path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', ...( body === undefined ? {} : { 'Content-Type': 'application/json' } ), ...( key ? { 'Idempotency-Key': key } : {} ) }, ...( body === undefined ? {} : { body: JSON.stringify( body ) } ) } );
	let result = {}; try {

		result = await response.json();

	} catch { /* static failure below */ }

	if ( response.status === 401 ) { const error = new Error( 'Admin sign-in is required. Open the admin sign-in page and return here.' ); error.code = 'ADMIN_SESSION_REQUIRED'; throw error; }
	if ( ! response.ok ) {

		const e = new Error( result.error?.message || 'The request could not be completed. Please retry.' ); e.code = result.error?.code; throw e;

	}

	return result;

}

async function pages( path ) {

	const items = []; let cursor;
	do {

		const result = await request( `${path}${path.includes( '?' ) ? '&' : '?'}limit=100${cursor ? `&cursor=${encodeURIComponent( cursor )}` : ''}` ); items.push( ...result.items ); cursor = result.nextCursor;

	} while ( cursor );

	return items;

}

const when = value => value == null ? 'No cloud activity yet' : new Date( value ).toLocaleString();
function App() {

	const [ users, setUsers ] = useState( [] ), [ query, setQuery ] = useState( '' ), [ form, setForm ] = useState( { firstName: '', lastName: '', graduationYear: '' } );
	const [ selected, setSelected ] = useState( null ), [ projects, setProjects ] = useState( [] ), [ issued, setIssued ] = useState( null );
	const [ busy, setBusy ] = useState( false ), [ error, setError ] = useState( '' ), [ notice, setNotice ] = useState( '' );
	const creation = useRef( null );
	const run = async action => {

		setBusy( true ); setError( '' ); setNotice( '' ); try {

			await action();

		} catch ( e ) {

			setError( e.message );

		} finally {

			setBusy( false );

		}

	};

	const refresh = async () => setUsers( await pages( '/v1/admin/users' ) );
	useEffect( () => {

		void run( refresh );

	}, [] );
	const create = event => {

		event.preventDefault(); void run( async () => {

			const body = { firstName: form.firstName.trim(), lastName: form.lastName.trim(), graduationYear: Number( form.graduationYear ) };
			const fingerprint = JSON.stringify( body );
			if ( creation.current?.fingerprint !== fingerprint ) creation.current = { fingerprint, key: crypto.randomUUID() };
			const result = await request( '/v1/admin/users', { method: 'POST', body, key: creation.current.key } );
			creation.current = null; setForm( { firstName: '', lastName: '', graduationYear: '' } ); setSelected( result.user ); setProjects( [] ); setIssued( null );
			await refresh(); setNotice( 'Student created. Issue a login link to copy and send manually.' );

		} );

	};

	const issue = user => run( async () => {

		setIssued( null ); const result = await request( `/v1/admin/users/${user.userId}/access-link`, { method: 'POST', body: {}, key: crypto.randomUUID() } ); setIssued( { userId: user.userId, url: result.loginUrl } ); setNotice( 'Link issued. Copy it and send it to the student. Any previous link no longer works.' );

	} );
	const toggle = user => run( async () => {

		await request( `/v1/admin/users/${user.userId}`, { method: 'PATCH', body: { active: ! user.active }, key: crypto.randomUUID() } ); setIssued( null ); await refresh(); setSelected( { ...user, active: ! user.active } ); setNotice( user.active ? 'Access revoked. Cloud projects remain available to admins.' : 'Access restored. Issue a new login link.' );

	} );
	const show = user => run( async () => {

		setSelected( user ); setIssued( null ); setProjects( await pages( `/v1/admin/users/${user.userId}/projects` ) );

	} );
	const edit = event => {

		event.preventDefault(); const data = new FormData( event.currentTarget ); void run( async () => {

			const result = await request( `/v1/admin/users/${selected.userId}`, { method: 'PATCH', key: crypto.randomUUID(), body: { firstName: String( data.get( 'firstName' ) ).trim(), lastName: String( data.get( 'lastName' ) ).trim(), graduationYear: Number( data.get( 'graduationYear' ) ) } } ); setSelected( result.user ); await refresh(); setNotice( 'Student details updated.' );

		} );

	};

	const matching = users.filter( user => `${user.firstName} ${user.lastName} ${user.graduationYear}`.toLowerCase().includes( query.toLowerCase().trim() ) );
	return <main className="admin-users"><nav><a href="/">← Admin editor</a><a href="/student/">Student editor</a></nav><header><h1>Students and projects</h1><p>Create accounts and copy personal links for manual delivery. Anyone with a link can access that student’s projects.</p></header>
		{error && <p role="alert" className="message error">{error} <a href="/admin/sign-in">Admin sign in</a></p>}{notice && <p role="status" className="message">{notice}</p>}
		<section><h2>Create student</h2><form className="fields" onSubmit={create}><label>First name<input required maxLength={100} value={form.firstName} onChange={e => setForm( { ...form, firstName: e.target.value } )}/></label><label>Last name<input required maxLength={100} value={form.lastName} onChange={e => setForm( { ...form, lastName: e.target.value } )}/></label><label>Graduation year<input required type="number" min="1900" max="9999" step="1" value={form.graduationYear} onChange={e => setForm( { ...form, graduationYear: e.target.value } )}/></label><button disabled={busy}>Create student</button></form></section>
		<section><div className="row"><h2>Students</h2><button disabled={busy} onClick={() => run( refresh )}>Refresh</button></div><label>Search students<input type="search" value={query} onChange={e => setQuery( e.target.value )}/></label><div className="table"><table><thead><tr><th>Name</th><th>Graduation</th><th>Access</th><th>Last cloud activity</th><th/></tr></thead><tbody>{matching.map( user => <tr key={user.userId}><td>{user.firstName} {user.lastName}</td><td>{user.graduationYear}</td><td>{user.active ? 'Active' : 'Revoked'}</td><td>{when( user.lastCloudActivityAt )}</td><td><button disabled={busy} onClick={() => show( user )}>Show projects</button></td></tr> )}</tbody></table></div>{! matching.length && <p>No students found.</p>}</section>
		{selected && <section><h2>{selected.firstName} {selected.lastName} · {selected.graduationYear}</h2><form key={selected.userId} className="fields" onSubmit={edit}><label>First name<input name="firstName" required maxLength={100} defaultValue={selected.firstName}/></label><label>Last name<input name="lastName" required maxLength={100} defaultValue={selected.lastName}/></label><label>Graduation year<input name="graduationYear" type="number" required min="1900" max="9999" defaultValue={selected.graduationYear}/></label><button disabled={busy}>Save details</button></form><div className="row"><button disabled={busy || ! selected.active} onClick={() => issue( selected )}>Issue login link</button><button disabled={busy} onClick={() => toggle( selected )}>{selected.active ? 'Revoke access' : 'Restore access'}</button></div>
			{issued?.userId === selected.userId && <div className="link-box"><label>Student login link<input aria-label="Student login link" readOnly value={issued.url}/></label><button disabled={busy} onClick={() => run( async () => {

				await navigator.clipboard.writeText( issued.url ); setNotice( 'Link copied. Send it privately to the student.' );

			} )}>Copy link</button><p>Reissuing invalidates the previous link. If copying fails, select the link above and copy it manually.</p></div>}
			<h3>Latest cloud-synced projects</h3><p>Edits still on an offline student device are not visible here.</p>{projects.length ? <ul>{projects.map( project => <li key={project.projectId}><strong>{project.name}</strong> · revision {project.serverRevision} · {when( project.updatedAt )} {project.archived && '· Archived'} <a href={`/admin/users/review/?user=${encodeURIComponent( selected.userId )}&project=${encodeURIComponent( project.projectId )}`}>Open project</a></li> )}</ul> : <p>No cloud projects yet.</p>}</section>}
	</main>;

}

createRoot( document.getElementById( 'admin-users-app' ) ).render( <App/> );
