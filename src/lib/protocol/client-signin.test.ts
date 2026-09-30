import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatClient, type ClientSnapshot } from './client';
import { FakeSocket, settle } from './fake-socket';

function latest(): FakeSocket {
	return FakeSocket.latest();
}

/** Email sign-in (§4.10), token rotation (§3.2), `server.welcome`, and roles (§3.3). */
describe('sign-in', () => {
	const storage = new Map<string, string>();
	const fakeLocalStorage = {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => void storage.set(key, value),
		removeItem: (key: string) => void storage.delete(key)
	};
	const TOKEN_KEY = 'apron.session:ws://fake.test/';
	let client: ChatClient;
	let snapshot: ClientSnapshot;

	beforeEach(() => {
		vi.useFakeTimers();
		storage.clear();
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		vi.stubGlobal('localStorage', fakeLocalStorage);
		client = new ChatClient('ws://fake.test/');
		client.subscribe((next) => (snapshot = next));
		client.start();
	});

	afterEach(() => {
		client.stop();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	const auths = () => latest().sent.filter((frame) => frame.method === 'auth');

	/** The fresh connection an email sign-in reconnects on, greeted by `auth`. */
	function freshConnection(auth: string[], extra: Record<string, unknown> = {}): FakeSocket {
		vi.advanceTimersByTime(0);
		const socket = latest();
		socket.open();
		socket.receive({ method: 'server', params: { protocol: 7, auth, caps: ['rooms'], ...extra } });
		return socket;
	}

	it('asks for an email code, then presents it as a fresh connection’s first auth and keeps the bearer token', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		expect(snapshot.you?.user_id).toBe('guest_1');

		const requested = client.requestEmailCode(' ada@example.com ');
		const ask = latest().request('auth');
		expect(ask.params).toEqual({ scheme: 'email', email: 'ada@example.com' });
		// Nothing is authenticated yet: the result is `{}`, and the connection stays the guest.
		latest().receive({ id: ask.id, result: {} });
		await requested;
		expect(snapshot.you?.user_id).toBe('guest_1');
		expect(snapshot.passkeySession).toBe(false);

		const guestSocket = latest();
		const signedIn = client.signInWithEmail('ada@example.com', ' 418092 ');
		expect(snapshot.authBusy).toBe(true);
		const socket = freshConnection(['email', 'token', 'guest']);
		expect(socket).not.toBe(guestSocket);
		// Never on the connection that was already someone: the code is this connection's first auth, rooms right behind.
		expect(guestSocket.sent.filter((frame) => (frame.params as { token?: string } | undefined)?.token === '418092')).toEqual([]);
		expect(socket.sent.map((frame) => frame.method)).toEqual(['auth', 'room_list']);
		const exchange = socket.request('auth');
		expect(exchange.params).toMatchObject({ scheme: 'email', email: 'ada@example.com', token: '418092' });
		socket.receive({ id: exchange.id, result: { you: { user_id: 'ada', name: 'Ada' }, token: 'st_Hk41' } });
		await signedIn;
		expect(snapshot.you).toEqual({ user_id: 'ada', name: 'Ada' });
		expect(snapshot.passkeySession).toBe(true);
		expect(snapshot.signedInWith).toBe('email');
		expect(snapshot.authBusy).toBe(false);
		expect(storage.get(TOKEN_KEY)).toBe('st_Hk41');

		// The next connection resumes with the bearer token.
		latest().drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'ada', name: 'Ada' } });
		expect(auths()[0].params).toMatchObject({ scheme: 'token', token: 'st_Hk41' });
	});

	it('presents the code instead of resuming a kept session', async () => {
		storage.set(TOKEN_KEY, 'bob-session');
		client.stop();
		client = new ChatClient('ws://fake.test/');
		client.subscribe((next) => (snapshot = next));
		client.start();
		await latest().greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'bob' } });
		expect(auths()[0].params).toMatchObject({ scheme: 'token', token: 'bob-session' });
		const signedIn = client.signInWithEmail('ada@example.com', '418092');
		const socket = freshConnection(['email', 'token', 'guest']);
		expect(auths()).toHaveLength(1);
		expect(auths()[0].params).toMatchObject({ scheme: 'email', token: '418092' });
		socket.receive({ id: socket.request('auth').id, result: { you: { user_id: 'ada' }, token: 'st_ada' } });
		await signedIn;
		expect(storage.get(TOKEN_KEY)).toBe('st_ada');
	});

	it('reports a refused code, and the fresh connection signs in as it otherwise would', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		const signedIn = client.signInWithEmail('ada@example.com', '000000');
		const socket = freshConnection(['email', 'token', 'guest']);
		socket.receive({ id: socket.request('auth').id, error: { code: -32001, message: 'Invalid or expired code' } });
		await expect(signedIn).rejects.toThrow('Invalid or expired code');
		await settle();
		expect(auths().map((frame) => (frame.params as { scheme: string }).scheme)).toEqual(['email', 'guest']);
		await socket.reply('auth', { you: { user_id: 'guest_2' } });
		expect(snapshot.you?.user_id).toBe('guest_2');
		expect(storage.has(TOKEN_KEY)).toBe(false);
	});

	it('refuses email sign-in on a server that does not advertise it', async () => {
		await latest().greet([], { auth: ['token', 'guest'] });
		await expect(client.requestEmailCode('ada@example.com')).rejects.toThrow('does not support email');
		await expect(client.signInWithEmail('ada@example.com', '1')).rejects.toThrow('does not support email');
		expect(auths()).toHaveLength(1);
	});

	it('signs in by email on a server without guests, before any other auth', async () => {
		latest().open();
		latest().receive({ method: 'server', params: { protocol: 7, auth: ['email', 'token'], caps: ['rooms'], welcome: 'Create an account with **email**.' } });
		expect(auths()).toHaveLength(0);
		expect(snapshot.error).toMatch(/email/);
		expect(snapshot.server?.welcome).toBe('Create an account with **email**.');
		const signedIn = client.signInWithEmail('ada@example.com', '418092');
		const socket = freshConnection(['email', 'token']);
		socket.receive({ id: socket.request('auth').id, result: { you: { user_id: 'ada' }, token: 'st_1' } });
		await signedIn;
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.error).toBeUndefined();
		expect(socket.request('room_list').params).toEqual({ filter: 'joined', members: true });
	});

	it('reports an email session it cannot resume as signed out, never a guest', async () => {
		await latest().greet([], { auth: ['email', 'guest', 'webauthn'] });
		const signedIn = client.signInWithEmail('ada@example.com', '418092');
		const socket = freshConnection(['email', 'guest', 'webauthn']);
		// No `token` in `auth`: nothing to resume with.
		socket.receive({ id: socket.request('auth').id, result: { you: { user_id: 'ada' } } });
		await signedIn;
		expect(snapshot.passkeySession).toBe(true);
		socket.drop();
		vi.advanceTimersByTime(5_000);
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { protocol: 7, auth: ['email', 'guest', 'webauthn'], caps: [] } });
		await settle();
		expect(next.sent.filter((frame) => frame.method === 'auth')).toEqual([]);
		expect(snapshot.authenticated).toBe(false);
		expect(snapshot.held).toBe(true);
		expect(snapshot.error).toMatch(/email/);
	});

	it('adds an email to the signed-in account on the same connection, without changing how it signed in', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'], token: 'st_guest' });
		expect(snapshot.signedInWith).toBe('token');
		const socket = latest();
		const added = client.addEmail('ada@example.com', '418092');
		await vi.advanceTimersByTimeAsync(0);
		expect(latest()).toBe(socket);
		expect(snapshot.passkeyBusy).toBe(false);
		const exchange = socket.request('auth');
		expect(exchange.params).toEqual({ scheme: 'email', email: 'ada@example.com', token: '418092' });
		socket.receive({ id: exchange.id, result: { you: { user_id: 'guest_1', name: 'Guest' } } });
		expect((await added).user_id).toBe('guest_1');
		// Added, not signed in with: the session still resumes with its token, and the token is kept.
		expect(snapshot.signedInWith).toBe('token');
		expect(snapshot.signInMethods).toEqual(['token', 'email']);
		expect(storage.get(TOKEN_KEY)).toBe('st_guest');
		expect(storage.get('apron.signin-added:ws://fake.test/')).toBe('email');
	});

	it('keeps a passkey session a passkey session after an email is added', async () => {
		storage.set(TOKEN_KEY, 'st_ada');
		storage.set('apron.signin:ws://fake.test/', 'webauthn');
		client.stop();
		client = new ChatClient('ws://fake.test/');
		client.subscribe((next) => (snapshot = next));
		client.start();
		await latest().greet([], { auth: ['webauthn', 'email', 'token', 'guest'], you: { user_id: 'ada' } });
		expect(snapshot.signedInWith).toBe('webauthn');
		const added = client.addEmail('ada@example.com', '1');
		await vi.advanceTimersByTimeAsync(0);
		latest().receive({ id: latest().request('auth').id, result: { you: { user_id: 'ada' } } });
		await added;
		expect(snapshot.signedInWith).toBe('webauthn');
		expect(storage.get('apron.signin:ws://fake.test/')).toBe('webauthn');
		expect(storage.get(TOKEN_KEY)).toBe('st_ada');
	});

	it('forgets the previous account’s token when an email sign-in gives none', async () => {
		storage.set(TOKEN_KEY, 'bob-session');
		client.stop();
		client = new ChatClient('ws://fake.test/');
		client.subscribe((next) => (snapshot = next));
		client.start();
		await latest().greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'bob' } });
		const signedIn = client.signInWithEmail('ada@example.com', '418092');
		const socket = freshConnection(['email', 'token', 'guest']);
		socket.receive({ id: socket.request('auth').id, result: { you: { user_id: 'ada' } } });
		await signedIn;
		expect(storage.has(TOKEN_KEY)).toBe(false);
		// The next connection is never Bob again behind Ada's back.
		socket.drop();
		vi.advanceTimersByTime(5_000);
		const next = freshConnection(['email', 'token', 'guest']);
		expect(next.sent.filter((frame) => (frame.params as { token?: string } | undefined)?.token === 'bob-session')).toEqual([]);
	});

	it('signs up with a scheme listed only in signup', async () => {
		const server = { auth: ['webauthn'], signup: ['email'] };
		latest().open();
		latest().receive({ method: 'server', params: { protocol: 7, caps: ['rooms'], ...server } });
		expect(snapshot.server?.signup).toEqual(['email']);
		expect(snapshot.error).toMatch(/email/);
		const requested = client.requestEmailCode('new@example.com');
		const ask = latest().request('auth');
		expect(ask.params).toEqual({ scheme: 'email', email: 'new@example.com' });
		latest().receive({ id: ask.id, result: {} });
		await requested;
		const signedIn = client.signInWithEmail('new@example.com', '111111');
		vi.advanceTimersByTime(0);
		const socket = latest();
		socket.open();
		socket.receive({ method: 'server', params: { protocol: 7, caps: ['rooms'], ...server } });
		socket.receive({ id: socket.request('auth').id, result: { you: { user_id: 'newbie' } } });
		await signedIn;
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.signedInWith).toBe('email');
		// Email only signs up here: adding it as a way back in is refused, and a passkey is what signs in.
		await expect(client.addEmail('new@example.com', '1')).rejects.toThrow('does not sign in with email');
	});

	it('saves a token rotated in reply to a token resume, and presents the latest next time', async () => {
		storage.set(TOKEN_KEY, 'old');
		client.stop();
		client = new ChatClient('ws://fake.test/');
		client.subscribe((next) => (snapshot = next));
		client.start();
		await latest().greet([], { auth: ['token', 'guest'], token: 'rotated', you: { user_id: 'ada' } });
		expect(auths()[0].params).toMatchObject({ scheme: 'token', token: 'old' });
		expect(storage.get(TOKEN_KEY)).toBe('rotated');
		latest().drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet([], { auth: ['token', 'guest'], you: { user_id: 'ada' } });
		expect(auths()[0].params).toMatchObject({ scheme: 'token', token: 'rotated' });
		// A result without a token keeps the saved one.
		expect(storage.get(TOKEN_KEY)).toBe('rotated');
	});

	it('keeps server.welcome from each server frame, which replaces the last', async () => {
		latest().open();
		latest().receive({ method: 'server', params: { protocol: 7, auth: ['guest'], caps: [], welcome: 'Hello *there*' } });
		expect(snapshot.server?.welcome).toBe('Hello *there*');
		latest().receive({ method: 'server', params: { protocol: 7, auth: ['guest'], caps: [] } });
		expect(snapshot.server?.welcome).toBeUndefined();
		// Not a string: ignored.
		latest().receive({ method: 'server', params: { protocol: 7, auth: ['guest'], caps: [], welcome: { text: 'x' } } });
		expect(snapshot.server).not.toHaveProperty('welcome');
	});

	it('merges roles like any profile field, and an empty list removes them', async () => {
		await latest().greet(['rooms'], { you: { user_id: 'guest_1', roles: ['admin'] } });
		expect(snapshot.you?.roles).toEqual(['admin']);
		latest().receive({ method: 'user', params: { new: { user_id: 'bot_1', name: 'Deploy', roles: ['bot'] } } });
		expect(snapshot.users.bot_1.roles).toEqual(['bot']);
		latest().receive({ method: 'user', params: { new: { user_id: 'bot_1', roles: [] } } });
		expect(snapshot.users.bot_1).toEqual({ user_id: 'bot_1', name: 'Deploy' });
		latest().receive({ method: 'user', params: { you: { user_id: 'guest_1' } } });
		await settle();
		expect(snapshot.you?.roles).toEqual(['admin']);
	});
});
