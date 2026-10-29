/**
 * The sign-in panel's state machine (`SignIn.svelte`), kept free of the
 * component so every path through it can be tested. A sign-in is one of a
 * few explicit actions, each started by a tap:
 *
 * - `connect`: open a connection to the server in the form (as a guest where
 *   the server has guests).
 * - `passkey-login` / `passkey-register`: sign in with a passkey the browser
 *   offers, or create an account with a new one. Never guessed: where a
 *   server lets passkeys do both, or isn't known yet, the panel asks which
 *   (`PasskeyMode`, Sign in by default) and runs only that one. A
 *   ceremony needs a connection to the server in the form: where there is
 *   none yet, the tap opens one and the ceremony follows once it settles,
 *   and where the browser won't show its sheet that long after the tap, the
 *   panel is `ready` for a second one.
 * - `email-send` / `email-code`: ask for an emailed code, then sign in with it.
 * - `external-start` / `external-code`: open the server's sign-in page,
 *   which brings the viewer back signed in or, where the server won't
 *   return here, shows a code to sign in with.
 * - `token`: sign in with a pasted token.
 * - `done`, `sign-out`: leave the panel, or leave the registered session.
 */

export type Scheme = 'guest' | 'webauthn' | 'email' | 'external' | 'token';

/** On Passkey: sign in to an account with a saved passkey, or create one with a new passkey. */
export type PasskeyMode = 'login' | 'register';

export type SignInAction =
	| 'connect'
	| 'done'
	| 'sign-out'
	| 'passkey-login'
	| 'passkey-register'
	| 'email-send'
	| 'email-code'
	| 'external-start'
	| 'external-code'
	| 'token';

/**
 * - `idle`: nothing under way; the form is editable.
 * - `connecting`: the connection this panel opened isn't settled yet.
 * - `ready`: connected to the server in the form, signed in as no one or a
 *   guest: a passkey tap can start a ceremony right away.
 * - `busy`: a ceremony, a code, a sign-in page, or a token sign-in is under way.
 */
export type SignInPhase = 'idle' | 'connecting' | 'ready' | 'busy';

export interface SignInInput {
	scheme: Scheme;
	/** What the scheme does on this server (`schemeUse`). */
	use: { signIn: boolean; signUp: boolean };
	/** On Passkey, which of the two the viewer chose; what the server allows wins (`passkeyMode`). */
	passkey: PasskeyMode;
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
	/** A ceremony, a code, a sign-in page, or a token is under way. */
	busy: boolean;
	/** A code was asked for (emailed, or shown by the sign-in page) and the code field shows. */
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
}

/** The passkey action that runs: the one chosen, unless the server lets passkeys do only the other. */
export function passkeyMode(use: SignInInput['use'], chosen: PasskeyMode): PasskeyMode {
	if (!use.signIn) return 'register';
	if (!use.signUp) return 'login';
	return chosen;
}

/** Whether the panel asks Sign in or Create account: only where passkeys do both here. */
export function passkeyChoice(use: SignInInput['use']): boolean {
	return use.signIn && use.signUp;
}

/**
 * Connected to the server in the form, and its own sign-in has settled:
 * signed in (a guest, an account), or refused or held for a sign-in, which
 * a passkey can still do on that connection.
 */
function connectionSettled(input: Pick<SignInInput, 'sameServer' | 'status' | 'serverKnown' | 'authenticated' | 'connectionError'>): boolean {
	return input.sameServer && input.status === 'connected' && input.serverKnown && (input.authenticated || input.connectionError);
}

export function signInView(input: SignInInput): SignInView {
	const settled = connectionSettled(input);
	const here = input.sameServer && input.status === 'connected' && input.authenticated;
	if (input.busy) return { phase: 'busy', primary: { action: primaryAction(input), label: 'Signing in…' } };
	// A connection that failed (unreachable, a refused token) leaves the form to edit and try again.
	if (input.pending && !settled && !input.connectionError) {
		const label = input.status === 'connected' ? 'Signing in…' : 'Connecting…';
		return { phase: 'connecting', primary: { action: 'connect', label } };
	}
	// The passkey actions show whether or not the server in the form is connected yet: a tap connects first.
	if (input.scheme === 'webauthn' && !(here && input.registered)) {
		const action: SignInAction = passkeyMode(input.use, input.passkey) === 'login' ? 'passkey-login' : 'passkey-register';
		return { phase: settled ? 'ready' : 'idle', primary: { action, label: LABELS[action] } };
	}
	const action = primaryAction(input);
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
	'external-start': 'Continue to sign-in page',
	'external-code': 'Sign in',
	token: 'Sign in'
};

function primaryAction(input: SignInInput): SignInAction {
	const here = input.sameServer && input.status === 'connected' && input.authenticated;
	switch (input.scheme) {
		case 'token':
			return 'token';
		case 'email':
			return input.codeSent ? 'email-code' : 'email-send';
		case 'external':
			return input.codeSent ? 'external-code' : 'external-start';
		case 'webauthn':
			if (here && input.registered) return 'done';
			return passkeyMode(input.use, input.passkey) === 'login' ? 'passkey-login' : 'passkey-register';
		case 'guest':
			if (here && input.registered) return 'sign-out';
			return here ? 'done' : 'connect';
	}
}

/**
 * A passkey sign-in whose sheet was dismissed, where passkeys also create
 * accounts: on a device with no passkey for this server the sheet offers only
 * another device or a security key (on iOS, a QR code), which reads as a fault.
 */
export const CANCELLED_TRY_CREATE = 'Cancelled. No passkey for this server? Choose Create account.';

/** What the panel says about the chosen scheme. `host` names the server in the form, shown as code (`…`). */
export function signInHint(input: Pick<SignInInput, 'scheme' | 'use' | 'registered' | 'passkey'> & { phase: SignInPhase; here: boolean; guest: boolean; guestReadOnly: boolean; host?: string }): string {
	if (input.scheme === 'webauthn') {
		if (input.here && input.registered) return 'Signed in. Choose Guest to sign out.';
		const asGuest = input.phase === 'ready' && input.guest;
		if (passkeyMode(input.use, input.passkey) === 'register') {
			if (asGuest) return 'Connected as a guest. Creating an account keeps this identity and saves a new passkey for it on this device.';
			return 'Creates an account and saves a new passkey for it on this device. Your display name names both.';
		}
		const only = input.use.signUp ? '' : ' New here? Create an account another way first.';
		// A passkey is for the server it was made on: one saved for another server is no account here.
		if (asGuest) return `Each server has its own accounts: sign in with a passkey you saved for ${input.host ? `\`${input.host}\`` : 'this server'}.${only}`;
		return `Your device lists the passkeys saved for this server: pick one to sign in to its account.${only}`;
	}
	if (input.scheme === 'email') {
		if (input.use.signIn && !input.use.signUp) return 'Signs in with a code sent to an address already on your account.';
		if (input.use.signUp && !input.use.signIn) return 'Creates an account with a code sent to your email address.';
		return 'We email you a code to sign in with; the link in the email signs you in too.';
	}
	if (input.scheme === 'external') {
		const does = input.use.signIn && !input.use.signUp ? 'Signs in to an account you have' : input.use.signUp && !input.use.signIn ? 'Creates an account' : 'Signs in';
		return `${does} on the server’s own sign-in page (such as single sign-on), which then brings you back here.`;
	}
	if (input.scheme === 'token') return 'Signs in with a token the server gave you. If it’s an invite, add your name for the account it creates.';
	return input.guestReadOnly ? 'No token needed, but guests only read here: sign in with a passkey to post.' : 'No token needed; the server picks a guest identity.';
}

/**
 * What the page does when this session is left: `onsignout` notes what it
 * needs now (the account push is on for, before signing out clears `you`)
 * and returns what to do once the session is gone.
 */
export type SignOutHandler = () => () => void;

/**
 * Leaves the registered session, and only once that worked does the page
 * drop it (turning push off for the account): a sign-out that throws, such
 * as with requests pending, leaves push and the page as they were.
 */
export async function signOutThen(client: { signOut(): Promise<void> }, onsignout: SignOutHandler): Promise<void> {
	const signedOut = onsignout();
	await client.signOut();
	signedOut();
}
