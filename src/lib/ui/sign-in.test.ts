import { describe, expect, it } from 'vitest';
import { passkeyChoice, passkeyMode, signInHint, signInView, type SignInInput } from './sign-in';

/** Connected to the server in the form as a guest, with passkeys that both sign in and sign up. */
const guestHere: SignInInput = {
	scheme: 'webauthn',
	use: { signIn: true, signUp: true },
	passkey: 'login',
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
	it('runs the one action chosen, never a guess between them', () => {
		expect(signInView(guestHere)).toEqual({ phase: 'ready', primary: { action: 'passkey-login', label: 'Sign in with passkey' } });
		expect(signInView({ ...guestHere, passkey: 'register' })).toEqual({
			phase: 'ready', primary: { action: 'passkey-register', label: 'Create account with passkey' }
		});
	});

	it('asks Sign in or Create account only where passkeys do both', () => {
		expect(passkeyChoice({ signIn: true, signUp: true })).toBe(true);
		expect(passkeyChoice({ signIn: true, signUp: false })).toBe(false);
		expect(passkeyChoice({ signIn: false, signUp: true })).toBe(false);
	});

	it('does only what passkeys do on this server, whatever was chosen', () => {
		expect(passkeyMode({ signIn: true, signUp: false }, 'register')).toBe('login');
		expect(passkeyMode({ signIn: false, signUp: true }, 'login')).toBe('register');
		expect(signInView({ ...guestHere, use: { signIn: true, signUp: false }, passkey: 'register' })).toEqual({
			phase: 'ready', primary: { action: 'passkey-login', label: 'Sign in with passkey' }
		});
		expect(signInView({ ...guestHere, use: { signIn: false, signUp: true } })).toEqual({
			phase: 'ready', primary: { action: 'passkey-register', label: 'Create account with passkey' }
		});
	});

	it('offers the chosen action before connecting: a tap connects, then runs it', () => {
		const elsewhere = { ...guestHere, sameServer: false, serverKnown: false };
		expect(signInView(elsewhere)).toEqual({ phase: 'idle', primary: { action: 'passkey-login', label: 'Sign in with passkey' } });
		expect(signInView({ ...elsewhere, passkey: 'register' }).primary.action).toBe('passkey-register');
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
		expect(signInView({ ...guestHere, busy: true, passkey: 'register' }).primary.action).toBe('passkey-register');
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
		scheme: 'webauthn', use: { signIn: true, signUp: true }, passkey: 'login', registered: false, phase: 'ready', here: true, guest: true, guestReadOnly: false, ...overrides
	});

	it('says what the chosen passkey action does', () => {
		const away = { phase: 'idle' as const, here: false, guest: false };
		expect(hint(away)).toBe('Your device lists the passkeys saved for this server: pick one to sign in to its account.');
		expect(hint({ ...away, passkey: 'register' })).toBe('Creates an account and saves a new passkey for it on this device. Your display name names both.');
		expect(hint({})).toBe('Connected as a guest. Sign in with a passkey you saved, or stay a guest.');
		expect(hint({ passkey: 'register' })).toMatch(/^Connected as a guest. Creating an account keeps this identity/);
		expect(hint({ registered: true })).toBe('Signed in. Choose Guest to sign out.');
	});

	it('says so where passkeys only sign in, or only sign up', () => {
		expect(hint({ phase: 'idle', here: false, guest: false, use: { signIn: true, signUp: false }, passkey: 'register' })).toMatch(/pick one to sign in to its account. New here\? Create an account another way first.$/);
		expect(hint({ phase: 'idle', here: false, guest: false, use: { signIn: false, signUp: true } })).toMatch(/^Creates an account and saves a new passkey/);
	});

	it('says a sign-up invite names the account it creates', () => {
		expect(hint({ scheme: 'token' })).toMatch(/^Signs in with a token/);
		expect(hint({ scheme: 'token', invite: true })).toMatch(/user ID is picked from your display name/);
	});

	it('warns that guests only read where they do', () => {
		expect(hint({ scheme: 'guest', guestReadOnly: true })).toMatch(/guests only read here/);
	});
});
