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

	it('asks for an email code, then signs in with it and keeps the bearer token it returns', async () => {
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

		const signedIn = client.signInWithEmail('ada@example.com', ' 418092 ');
		await vi.advanceTimersByTimeAsync(0);
		const exchange = latest().request('auth');
		expect(exchange.params).toEqual({ scheme: 'email', email: 'ada@example.com', token: '418092' });
		// Other requests wait for the sign-in.
		await expect(client.send('lobby', 'x').promise).rejects.toThrow('Finish signing in');
		expect(snapshot.authBusy).toBe(true);
		latest().receive({ id: exchange.id, result: { you: { user_id: 'ada', name: 'Ada' }, token: 'st_Hk41' } });
		await signedIn;
		expect(snapshot.you).toEqual({ user_id: 'ada', name: 'Ada' });
		expect(snapshot.passkeySession).toBe(true);
		expect(snapshot.authBusy).toBe(false);
		expect(storage.get(TOKEN_KEY)).toBe('st_Hk41');
		// A new identity lists its own rooms.
		expect(latest().sent.filter((frame) => frame.method === 'room_list')).toHaveLength(2);

		// The next connection resumes with the bearer token.
		latest().drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'ada', name: 'Ada' } });
		expect(auths()[0].params).toMatchObject({ scheme: 'token', token: 'st_Hk41' });
	});

	it('reports a refused code and stays signed in as before', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		const signedIn = client.signInWithEmail('ada@example.com', '000000');
		await vi.advanceTimersByTimeAsync(0);
		latest().receive({ id: latest().request('auth').id, error: { code: -32001, message: 'Invalid or expired code' } });
		await expect(signedIn).rejects.toThrow('Invalid or expired code');
		expect(snapshot.you?.user_id).toBe('guest_1');
		expect(snapshot.authenticated).toBe(true);
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
		await vi.advanceTimersByTimeAsync(0);
		latest().receive({ id: latest().request('auth').id, result: { you: { user_id: 'ada' }, token: 'st_1' } });
		await signedIn;
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.error).toBeUndefined();
		expect(latest().request('room_list').params).toEqual({ filter: 'joined', members: true });
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
