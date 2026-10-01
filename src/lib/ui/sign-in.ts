/**
 * The sign-in panel's state machine (`SignIn.svelte`), kept free of the
 * component so every path through it can be tested. A sign-in is one of a
 * few explicit actions, each started by a tap:
 *
 * - `connect`: open a connection to the server in the form (as a guest where
 *   the server has guests). A passkey ceremony needs one, and the browser
 *   only shows its sheet for a tap, so connecting is its own step.
 * - `passkey-login` / `passkey-register`: once connected, sign in with a
 *   passkey the browser offers, or create an account with a new one. Never
 *   guessed: where a server lets passkeys do both, both are offered.
 * - `email-send` / `email-code`, `token`: the other schemes' steps.
 * - `done`, `sign-out`: leave the panel, or leave the registered session.
 */

export type Scheme = 'guest' | 'webauthn' | 'email' | 'token';

export type SignInAction =
	| 'connect'
	| 'done'
	| 'sign-out'
	| 'passkey-login'
	| 'passkey-register'
	| 'email-send'
	| 'email-code'
	| 'token';

/**
 * - `idle`: nothing under way; the form is editable.
 * - `connecting`: the connection this panel opened isn't settled yet.
 * - `ready`: connected to the server in the form, signed in as no one or a
 *   guest: a passkey tap can start a ceremony right away.
 * - `busy`: a ceremony, an emailed code, or a token sign-in is under way.
 */
export type SignInPhase = 'idle' | 'connecting' | 'ready' | 'busy';

export interface SignInInput {
	scheme: Scheme;
	/** What the scheme does on this server (`schemeUse`). */
	use: { signIn: boolean; signUp: boolean };
	/** The form names the server this client is connected (or connecting) to. */
	sameServer: boolean;
	status: string;
	/** That server's `server` frame has arrived. */
	serverKnown: boolean;
	authenticated: boolean;
	/** Signed in to a registered account there (`passkeySession`). */
	registered: boolean;
	/** The connection has an error (no guests, a hold for sign-in, a refused auth). */
	connectionError: boolean;
	/** This panel opened a connection and is waiting for it. */
	pending: boolean;
	/** A ceremony, a code, or a token is under way. */
	busy: boolean;
	/** An emailed code was asked for and the code field shows. */
	codeSent: boolean;
}

export interface SignInStep {
	action: SignInAction;
	label: string;
}

export interface SignInView {
	phase: SignInPhase;
	/** The form's submit button. */
	primary: SignInStep;
	/** The other passkey action, where the server lets passkeys both sign in and sign up. */
	secondary?: SignInStep;
}

/**
 * Connected to the server in the form, and its own sign-in has settled:
 * signed in (a guest, an account), or refused or held for a sign-in, which
 * a passkey can still do on that connection.
 */
export function connectionSettled(input: Pick<SignInInput, 'sameServer' | 'status' | 'serverKnown' | 'authenticated' | 'connectionError'>): boolean {
	return input.sameServer && input.status === 'connected' && input.serverKnown && (input.authenticated || input.connectionError);
}

export function signInView(input: SignInInput): SignInView {
	const settled = connectionSettled(input);
	if (input.busy) return { phase: 'busy', primary: { action: primaryAction(input, settled), label: 'Signing in…' } };
	// A connection that failed (unreachable, a refused token) leaves the form to edit and try again.
	if (input.pending && !settled && !input.connectionError) {
		const label = input.status === 'connected' ? 'Signing in…' : 'Connecting…';
		return { phase: 'connecting', primary: { action: 'connect', label } };
	}
	if (input.scheme === 'webauthn' && settled && !input.registered) {
		const login: SignInStep = { action: 'passkey-login', label: 'Sign in with passkey' };
		const register: SignInStep = { action: 'passkey-register', label: input.use.signIn ? 'New here? Create an account with a passkey' : 'Create account with passkey' };
		if (!input.use.signIn) return { phase: 'ready', primary: register };
		return { phase: 'ready', primary: login, ...(input.use.signUp ? { secondary: register } : {}) };
	}
	const action = primaryAction(input, settled);
	return { phase: 'idle', primary: { action, label: LABELS[action] } };
}

const LABELS: Record<SignInAction, string> = {
	connect: 'Connect',
	done: 'Done',
	'sign-out': 'Sign out',
	'passkey-login': 'Sign in with passkey',
	'passkey-register': 'Create account with passkey',
	'email-send': 'Email me a code',
	'email-code': 'Sign in',
	token: 'Sign in'
};

function primaryAction(input: SignInInput, settled: boolean): SignInAction {
	const here = input.sameServer && input.status === 'connected' && input.authenticated;
	switch (input.scheme) {
		case 'token':
			return 'token';
		case 'email':
			return input.codeSent ? 'email-code' : 'email-send';
		case 'webauthn':
			if (settled && !input.registered) return input.use.signIn ? 'passkey-login' : 'passkey-register';
			return here ? 'done' : 'connect';
		case 'guest':
			if (here && input.registered) return 'sign-out';
			return here ? 'done' : 'connect';
	}
}

/** What the panel says about the chosen scheme. */
export function signInHint(input: Pick<SignInInput, 'scheme' | 'use' | 'registered'> & { phase: SignInPhase; here: boolean; guest: boolean; guestReadOnly: boolean }): string {
	if (input.scheme === 'webauthn') {
		if (input.here && input.registered) return 'Signed in. Choose Guest to sign out.';
		if (input.use.signIn && !input.use.signUp) return 'Signs in with a passkey already on your account. New here? Create an account another way first.';
		if (input.use.signUp && !input.use.signIn) return 'Creates an account with a new passkey on this device. Your display name names it.';
		if (input.phase === 'ready' && input.guest) return 'Connected as a guest. Sign in with a passkey, create an account with a new one, or stay a guest.';
		if (input.phase === 'ready') return 'Sign in with a passkey you already have, or create an account with a new one.';
		return 'Connects first; then sign in with a passkey you already have, or create an account with a new one.';
	}
	if (input.scheme === 'email') {
		if (input.use.signIn && !input.use.signUp) return 'Signs in with a code sent to an address already on your account.';
		if (input.use.signUp && !input.use.signIn) return 'Creates an account with a code sent to your email address.';
		return 'We email you a code to sign in with; the link in the email signs you in too.';
	}
	if (input.scheme === 'token') return 'Signs in with a token the server gave you, such as a bot token from /invite-bot.';
	return input.guestReadOnly ? 'No token needed, but guests only read here: sign in with a passkey to post.' : 'No token needed; the server picks a guest identity.';
}
