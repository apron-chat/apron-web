import { describe, expect, it, vi } from 'vitest';
import { passkeyChoice, passkeyMode, signInHint, signInView, signOutThen, type SignInInput } from './sign-in';

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

	it('asks Sign in or Create account only where passkeys do both, and does only what they do here, whatever was chosen', () => {
		expect(passkeyChoice({ signIn: true, signUp: true })).toBe(true);
		expect(passkeyChoice({ signIn: true, signUp: false })).toBe(false);
		expect(passkeyChoice({ signIn: false, signUp: true })).toBe(false);
		expect(passkeyMode({ signIn: true, signUp: false }, 'register')).toBe('login');
		expect(passkeyMode({ signIn: false, signUp: true }, 'login')).toBe('register');
		expect(signInView({ ...guestHere, use: { signIn: true, signUp: false }, passkey: 'register' })).toEqual({
			phase: 'ready', primary: { action: 'passkey-login', label: 'Sign in with passkey' }
		});
		expect(signInView({ ...guestHere, use: { signIn: false, signUp: true } })).toEqual({
			phase: 'ready', primary: { action: 'passkey-register', label: 'Create account with passkey' }
		});
	});

	it('offers the chosen action before connecting, signed in here or not: a tap connects, then runs it', () => {
		const elsewhere = { ...guestHere, sameServer: false, serverKnown: false };
		expect(signInView(elsewhere)).toEqual({ phase: 'idle', primary: { action: 'passkey-login', label: 'Sign in with passkey' } });
		expect(signInView({ ...elsewhere, passkey: 'register' }).primary.action).toBe('passkey-register');
		// Also while signed in to an account here.
		expect(signInView({ ...guestHere, sameServer: false, registered: true }).primary.action).toBe('passkey-login');
	});

	it('is ready on a connection held for a sign-in, or on a server without guests', () => {
		const held = { ...guestHere, authenticated: false, connectionError: true };
		expect(signInView(held).phase).toBe('ready');
		expect(signInView(held).primary.action).toBe('passkey-login');
	});

	it('waits while the connection it opened settles, and lets the form be edited again when it fails', () => {
		const opening = { ...guestHere, pending: true, authenticated: false, status: 'connecting', serverKnown: false };
		expect(signInView(opening)).toEqual({ phase: 'connecting', primary: { action: 'connect', label: 'Connecting…' } });
		expect(signInView({ ...opening, status: 'connected', serverKnown: true }).primary.label).toBe('Signing in…');
		// It fails: the form can be edited again.
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

	it('opens the server’s sign-in page, and takes a code where the page shows one', () => {
		expect(signInView({ ...guestHere, scheme: 'external', sameServer: false }).primary).toEqual({ action: 'external-start', label: 'Continue to sign-in page' });
		expect(signInView({ ...guestHere, scheme: 'external', codeSent: true }).primary).toEqual({ action: 'external-code', label: 'Sign in' });
		const hint = (use: SignInInput['use']) => signInHint({ scheme: 'external', use, passkey: 'login', registered: false, phase: 'idle', here: false, guest: false, guestReadOnly: false });
		expect(hint({ signIn: true, signUp: true })).toMatch(/^Signs in on the server’s own sign-in page/);
		expect(hint({ signIn: false, signUp: true })).toMatch(/^Creates an account/);
	});

	it('signs in with a pasted token', () => {
		expect(signInView({ ...guestHere, scheme: 'token', sameServer: false }).primary).toEqual({ action: 'token', label: 'Sign in' });
	});
});

describe('hints', () => {
	const hint = (overrides: Partial<Parameters<typeof signInHint>[0]>) => signInHint({
		scheme: 'webauthn', use: { signIn: true, signUp: true }, passkey: 'login', registered: false, phase: 'ready', here: true, guest: true, guestReadOnly: false, ...overrides
	});

	it('says what the chosen passkey action does, and where passkeys only sign in or only sign up', () => {
		const away = { phase: 'idle' as const, here: false, guest: false };
		expect(hint(away)).toBe('Your device lists the passkeys saved for this server: pick one to sign in to its account.');
		expect(hint({ ...away, passkey: 'register' })).toBe('Creates an account and saves a new passkey for it on this device. Your display name names both.');
		// Each server has its own accounts: a passkey saved for another is no account here.
		expect(hint({})).toBe('Each server has its own accounts: sign in with a passkey you saved for this server.');
		expect(hint({ host: 'server.apron.chat' })).toBe('Each server has its own accounts: sign in with a passkey you saved for `server.apron.chat`.');
		expect(hint({ passkey: 'register' })).toMatch(/^Connected as a guest. Creating an account keeps this identity/);
		expect(hint({ registered: true })).toBe('Signed in. Choose Guest to sign out.');
		// Where passkeys only sign in, or only sign up, it says so.
		expect(hint({ phase: 'idle', here: false, guest: false, use: { signIn: true, signUp: false }, passkey: 'register' })).toMatch(/pick one to sign in to its account. New here\? Create an account another way first.$/);
		expect(hint({ phase: 'idle', here: false, guest: false, use: { signIn: false, signUp: true } })).toMatch(/^Creates an account and saves a new passkey/);
	});

	it('says a token is the server\'s, and that a name goes with an invite', () => {
		expect(hint({ scheme: 'token' })).toBe('Signs in with a token the server gave you. If it’s an invite, add your name for the account it creates.');
	});

	it('warns that guests only read where they do', () => {
		expect(hint({ scheme: 'guest', guestReadOnly: true })).toMatch(/guests only read here/);
	});
});

describe('signOutThen', () => {
	it('drops the session, push with it, only after signing out worked, and leaves push on when it throws', async () => {
		const steps: string[] = [];
		const signedOut = { signOut: async () => { steps.push('signOut'); } };
		await signOutThen(signedOut, () => { steps.push('noted'); return () => steps.push('push off'); });
		expect(steps).toEqual(['noted', 'signOut', 'push off']);
		const off = vi.fn();
		const client = { signOut: async () => { throw new Error('Wait for pending requests to finish, then try again'); } };
		await expect(signOutThen(client, () => off)).rejects.toThrow(/pending requests/);
		expect(off).not.toHaveBeenCalled();
	});
});
