import { describe, expect, it } from 'vitest';
import { signInHint, signInView, type SignInInput } from './sign-in';

/** Connected to the server in the form as a guest, with passkeys that both sign in and sign up. */
const guestHere: SignInInput = {
	scheme: 'webauthn',
	use: { signIn: true, signUp: true },
	sameServer: true,
	status: 'connected',
	serverKnown: true,
	authenticated: true,
	registered: false,
	connectionError: false,
	pending: false,
	busy: false,
	codeSent: false
};

describe('the passkey step', () => {
	it('offers both explicit actions once connected, never a guess between them', () => {
		expect(signInView(guestHere)).toEqual({
			phase: 'ready',
			primary: { action: 'passkey-login', label: 'Sign in with passkey' },
			secondary: { action: 'passkey-register', label: 'New here? Create an account with a passkey' }
		});
	});

	it('offers only what passkeys do on this server', () => {
		expect(signInView({ ...guestHere, use: { signIn: true, signUp: false } })).toEqual({
			phase: 'ready', primary: { action: 'passkey-login', label: 'Sign in with passkey' }
		});
		expect(signInView({ ...guestHere, use: { signIn: false, signUp: true } })).toEqual({
			phase: 'ready', primary: { action: 'passkey-register', label: 'Create account with passkey' }
		});
	});

	it('offers the passkey actions before connecting: a tap connects, then runs the one it asked for', () => {
		expect(signInView({ ...guestHere, sameServer: false, serverKnown: false })).toEqual({
			phase: 'idle',
			primary: { action: 'passkey-login', label: 'Sign in with passkey' },
			secondary: { action: 'passkey-register', label: 'New here? Create an account with a passkey' }
		});
	});

	it('offers them on another server while signed in to an account here', () => {
		expect(signInView({ ...guestHere, sameServer: false, registered: true }).primary.action).toBe('passkey-login');
	});

	it('is ready on a connection held for a sign-in, or on a server without guests', () => {
		const held = { ...guestHere, authenticated: false, connectionError: true };
		expect(signInView(held).phase).toBe('ready');
		expect(signInView(held).primary.action).toBe('passkey-login');
	});

	it('waits while the connection it opened settles', () => {
		const opening = { ...guestHere, pending: true, authenticated: false, status: 'connecting', serverKnown: false };
		expect(signInView(opening)).toEqual({ phase: 'connecting', primary: { action: 'connect', label: 'Connecting…' } });
		expect(signInView({ ...opening, status: 'connected', serverKnown: true }).primary.label).toBe('Signing in…');
	});

	it('lets the form be edited again when that connection fails', () => {
		const failed = { ...guestHere, pending: true, authenticated: false, status: 'reconnecting', connectionError: true };
		expect(signInView(failed).phase).toBe('idle');
		expect(signInView(failed).primary.action).toBe('passkey-login');
		expect(signInView({ ...failed, scheme: 'guest' })).toEqual({ phase: 'idle', primary: { action: 'connect', label: 'Connect' } });
	});

	it('is busy from the tap until the ceremony ends', () => {
		expect(signInView({ ...guestHere, busy: true })).toEqual({ phase: 'busy', primary: { action: 'passkey-login', label: 'Signing in…' } });
	});

	it('is done where already signed in to an account', () => {
		expect(signInView({ ...guestHere, registered: true })).toEqual({ phase: 'idle', primary: { action: 'done', label: 'Done' } });
	});
});

describe('the other schemes', () => {
	it('signs out of an account by choosing Guest', () => {
		expect(signInView({ ...guestHere, scheme: 'guest', registered: true }).primary.action).toBe('sign-out');
		expect(signInView({ ...guestHere, scheme: 'guest' }).primary.action).toBe('done');
		expect(signInView({ ...guestHere, scheme: 'guest', sameServer: false }).primary.action).toBe('connect');
	});

	it('steps through an emailed code', () => {
		expect(signInView({ ...guestHere, scheme: 'email' }).primary).toEqual({ action: 'email-send', label: 'Email me a code' });
		expect(signInView({ ...guestHere, scheme: 'email', codeSent: true }).primary).toEqual({ action: 'email-code', label: 'Sign in' });
	});

	it('signs in with a pasted token', () => {
		expect(signInView({ ...guestHere, scheme: 'token', sameServer: false }).primary).toEqual({ action: 'token', label: 'Sign in' });
	});
});

describe('hints', () => {
	const hint = (overrides: Partial<Parameters<typeof signInHint>[0]>) => signInHint({
		scheme: 'webauthn', use: { signIn: true, signUp: true }, registered: false, phase: 'ready', here: true, guest: true, guestReadOnly: false, ...overrides
	});

	it('says what a passkey does on this server', () => {
		expect(hint({})).toMatch(/^Connected as a guest/);
		expect(hint({ phase: 'idle', here: false, guest: false })).toBe('Sign in with a passkey you already have, or create an account with a new one.');
		expect(hint({ use: { signIn: false, signUp: true } })).toMatch(/^Creates an account with a new passkey/);
		expect(hint({ use: { signIn: true, signUp: false } })).toMatch(/^Signs in with a passkey already on your account/);
		expect(hint({ registered: true })).toBe('Signed in. Choose Guest to sign out.');
	});

	it('warns that guests only read where they do', () => {
		expect(hint({ scheme: 'guest', guestReadOnly: true })).toMatch(/guests only read here/);
	});
});
