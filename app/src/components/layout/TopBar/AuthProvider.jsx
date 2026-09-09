
import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createLogger } from 'rayzee';

const log = createLogger( 'auth' );

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey
	? createClient( supabaseUrl, supabaseAnonKey )
	: null;

const AuthProvider = ( { children } ) => {

	const [ isAuthModalOpen, setIsAuthModalOpen ] = useState( false );
	const [ user, setUser ] = useState( null );

	useEffect( () => {

		if ( ! supabase ) return undefined;

		const { data: authListener } = supabase.auth.onAuthStateChange( ( event, session ) => {

			setUser( session?.user ?? null );
			// Never log the session itself — it carries access/refresh tokens.
			log.debug( `auth ${event} · ${session?.user ? 'signed in' : 'no session'}` );

		} );

		return () => {

			authListener?.subscription.unsubscribe();

		};

	}, [] );

	const handleLoginClick = () => {

		if ( supabase ) setIsAuthModalOpen( true );

	};

	const handleSignOut = async () => {

		if ( supabase ) await supabase.auth.signOut();
		setUser( null );

	};

	return (
		<>
			{children( { user, handleLoginClick, handleSignOut } )}
			{supabase && <Dialog open={isAuthModalOpen} onOpenChange={setIsAuthModalOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Login</DialogTitle>
					</DialogHeader>
					<Auth
						supabaseClient={supabase}
						appearance={{ theme: ThemeSupa }}
						providers={[ 'google' ]}
						redirectTo={`${window.location.href}`}
					/>
				</DialogContent>
			</Dialog>}
		</>
	);

};

export default AuthProvider;
