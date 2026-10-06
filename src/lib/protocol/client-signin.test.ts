import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatClient, userIn, type ClientSnapshot } from './client';
import { FakeSocket, settle } from './fake-socket';

function latest(): FakeSocket {
	return FakeSocket.latest();
}

/** Email sign-in (§4.11), token rotation (§3.2), `server.welcome`, and roles (§3.3). */
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

	/**
	 * Proposes an email sign-in (§4.11) and answers it: the connection of its
	 * own it opens, greeted by `auth`, left open for the code.
	 */
	async function propose(email: string, auth: string[], extra: Record<string, unknown> = {}): Promise<FakeSocket> {
		const requested = client.requestEmailCode(email);
		const side = latest();
		side.open();
		side.receive({ method: 'server', params: { apron: 7, auth, capabilities: ['rooms'], ...extra } });
		await settle();
		side.receive({ id: side.request('auth').id, result: {} });
		await requested;
		return side;
	}

	/** Approves with `code` on `side` and answers with `result`. */
	async function approve(side: FakeSocket, code: string, result: Record<string, unknown>): Promise<void> {
		const signedIn = client.signInWithEmail(code);
		await settle();
		side.receive({ id: side.request('auth').id, result });
		await signedIn;
	}

	it('proposes on a connection of its own, approves the code there, and carries on with that connection', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		expect(snapshot.you?.user_id).toBe('guest_1');

		// Proposed on a signed-in connection (a guest's too), it would add the address (§4.11): the proposal
		// goes on a connection of its own that is not signed in, and this one is left alone.
		const main = latest();
		const sending = client.send('lobby', 'hello');
		const side = await propose(' ada@example.com ', ['email', 'token', 'guest']);
		expect(side).not.toBe(main);
		expect(side.sent).toEqual([{ method: 'auth', id: expect.any(String), params: { scheme: 'email', email: 'ada@example.com', agent: 'apron-web/0.4' } }]);
		// It stays open for the code, which works only there.
		expect(side.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.emailCode).toEqual({ email: 'ada@example.com', url: 'ws://fake.test/' });
		expect(main.readyState).toBe(FakeSocket.OPEN);
		await main.reply('message', { message_id: '1' });
		await expect(sending.promise).resolves.toEqual({ message_id: '1' });
		expect(snapshot.you?.user_id).toBe('guest_1');
		expect(snapshot.passkeySession).toBe(false);

		// The approval carries the code alone, on the proposing connection.
		const signedIn = client.signInWithEmail(' 418092 ', 'Ada L', () => expect(snapshot.you?.user_id).toBe('guest_1'));
		expect(snapshot.authBusy).toBe(true);
		await settle();
		const approval = side.request('auth');
		expect(approval.params).toEqual({ scheme: 'email', token: '418092', agent: 'apron-web/0.4' });
		expect(main.sent.filter((frame) => (frame.params as { token?: string } | undefined)?.token === '418092')).toEqual([]);
		side.receive({ id: approval.id, result: { you: { user_id: 'ada', name: 'Ada' }, token: 'st_Hk41' } });
		// Whatever the server sends right after the sign-in is taken in, in order.
		side.receive({ method: 'user', params: { you: { user_id: 'ada', avatar: 'https://example.com/ada.png' } } });
		const named = await signedIn;
		expect(named).toBeDefined();
		// That connection is now this client's: the old one closed, the rooms and the name asked for there.
		expect(main.readyState).toBe(FakeSocket.CLOSED);
		expect(latest()).toBe(side);
		expect(side.sent.map((frame) => frame.method)).toEqual(['auth', 'auth', 'me', 'room_list']);
		expect(side.request('me').params).toEqual({ name: 'Ada L' });
		expect(snapshot.you).toEqual({ user_id: 'ada', name: 'Ada', avatar: 'https://example.com/ada.png' });
		expect(snapshot.status).toBe('connected');
		expect(snapshot.passkeySession).toBe(true);
		expect(snapshot.signedInWith).toBe('email');
		expect(snapshot.authBusy).toBe(false);
		expect(snapshot.emailCode).toBeUndefined();
		expect(storage.get(TOKEN_KEY)).toBe('st_Hk41');

		// The next connection resumes with the bearer token.
		side.drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'ada', name: 'Ada' } });
		expect(auths()[0].params).toMatchObject({ scheme: 'token', token: 'st_Hk41' });
	});

	it('replaces a kept session with the one the code signs in', async () => {
		storage.set(TOKEN_KEY, 'bob-session');
		client.stop();
		client = new ChatClient('ws://fake.test/');
		client.subscribe((next) => (snapshot = next));
		client.start();
		await latest().greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'bob' } });
		expect(auths()[0].params).toMatchObject({ scheme: 'token', token: 'bob-session' });
		const side = await propose('ada@example.com', ['email', 'token', 'guest']);
		await approve(side, '418092', { you: { user_id: 'ada' }, token: 'st_ada' });
		expect(snapshot.you?.user_id).toBe('ada');
		expect(storage.get(TOKEN_KEY)).toBe('st_ada');
	});

	it('leaves the proposal open after a wrong code, to type it again', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		const main = latest();
		const side = await propose('ada@example.com', ['email', 'token', 'guest']);
		const wrong = client.signInWithEmail('000000');
		await settle();
		side.receive({ id: side.request('auth').id, error: { code: -32001, message: 'Invalid or expired code' } });
		await expect(wrong).rejects.toThrow('Invalid or expired code');
		// Nothing changed here, and the proposal is still there.
		expect(main.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.you?.user_id).toBe('guest_1');
		expect(side.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.emailCode?.email).toBe('ada@example.com');
		await approve(side, '418092', { you: { user_id: 'ada' }, token: 'st_ada' });
		expect(snapshot.you?.user_id).toBe('ada');
	});

	it('says when the proposal is gone, and a new one replaces the last', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		await expect(client.signInWithEmail('1')).rejects.toThrow('no longer open');
		const first = await propose('ada@example.com', ['email', 'token', 'guest']);
		const second = await propose('ada@example.com', ['email', 'token', 'guest']);
		expect(first.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.emailCode).toBeDefined();
		// The server closes it (an expired proposal, a restart): the code has nowhere to go.
		second.drop();
		expect(snapshot.emailCode).toBeUndefined();
		await expect(client.signInWithEmail('418092')).rejects.toThrow('no longer open');
		expect(snapshot.you?.user_id).toBe('guest_1');
	});

	it('refuses email sign-in on a server that does not advertise it', async () => {
		await latest().greet([], { auth: ['token', 'guest'] });
		await expect(client.requestEmailCode('ada@example.com')).rejects.toThrow('does not support email');
		expect(FakeSocket.instances).toHaveLength(1);
		expect(auths()).toHaveLength(1);
	});

	it('signs in by email on a server without guests', async () => {
		latest().open();
		latest().receive({ method: 'server', params: { apron: 7, auth: ['email', 'token'], capabilities: ['rooms'], welcome: 'Create an account with **email**.' } });
		expect(auths()).toHaveLength(0);
		expect(snapshot.error).toMatch(/email/);
		expect(snapshot.server?.welcome).toBe('Create an account with **email**.');
		const side = await propose('ada@example.com', ['email', 'token'], { welcome: 'Create an account with **email**.' });
		await approve(side, '418092', { you: { user_id: 'ada' }, token: 'st_1' });
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.error).toBeUndefined();
		expect(side.request('room_list').params).toEqual({ filter: 'joined', members: true });
	});

	it('reports an email session it cannot resume as signed out, never a guest', async () => {
		await latest().greet([], { auth: ['email', 'guest', 'webauthn'] });
		const side = await propose('ada@example.com', ['email', 'guest', 'webauthn']);
		// No `token` in `auth`: nothing to resume with.
		await approve(side, '418092', { you: { user_id: 'ada' } });
		expect(snapshot.passkeySession).toBe(true);
		side.drop();
		vi.advanceTimersByTime(5_000);
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 7, auth: ['email', 'guest', 'webauthn'], capabilities: [] } });
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
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		expect(socket.request('auth').params).toEqual({ scheme: 'email', email: 'ada@example.com' });
		await socket.reply('auth', {});
		await asked;
		const added = client.addEmail(' 418092 ');
		await vi.advanceTimersByTimeAsync(0);
		expect(latest()).toBe(socket);
		expect(snapshot.passkeyBusy).toBe(false);
		const approval = socket.request('auth');
		// The approval carries the code alone; an addition's result is `{}`.
		expect(approval.params).toEqual({ scheme: 'email', token: '418092' });
		socket.receive({ id: approval.id, result: {} });
		await added;
		expect(snapshot.you?.user_id).toBe('guest_1');
		// Added, not signed in with: the session still resumes with its token, and the token is kept.
		expect(snapshot.signedInWith).toBe('token');
		expect(snapshot.signInMethods).toEqual(['token', 'email']);
		expect(storage.get(TOKEN_KEY)).toBe('st_guest');
		expect(storage.get('apron.signin-added:ws://fake.test/')).toBe('email');
	});

	it('makes a guest without a token an email account once an address is added', async () => {
		await latest().greet([], { auth: ['email', 'guest'] });
		expect(snapshot.passkeySession).toBe(false);
		const socket = latest();
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		await socket.reply('auth', {});
		await asked;
		const added = client.addEmail('418092');
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('auth', {});
		await added;
		expect(snapshot.passkeySession).toBe(true);
		expect(snapshot.signedInWith).toBe('email');
		// Nothing to resume with: the next connection asks for the email again rather than a new guest.
		socket.drop();
		vi.advanceTimersByTime(5_000);
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 7, auth: ['email', 'guest'], capabilities: [] } });
		await settle();
		expect(next.sent.filter((frame) => frame.method === 'auth')).toEqual([]);
		expect(snapshot.error).toMatch(/email/);
	});

	it('won’t approve an addition on another connection than the one that proposed it', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'], token: 'st_guest' });
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		await latest().reply('auth', {});
		await asked;
		latest().drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		await expect(client.addEmail('418092')).rejects.toThrow('Send a new code');
		expect(auths()).toHaveLength(1);
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
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		await latest().reply('auth', {});
		await asked;
		const added = client.addEmail('1');
		await vi.advanceTimersByTimeAsync(0);
		latest().receive({ id: latest().request('auth').id, result: {} });
		await added;
		expect(snapshot.signedInWith).toBe('webauthn');
		expect(snapshot.signInMethods).toEqual(['webauthn', 'email']);
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
		const side = await propose('ada@example.com', ['email', 'token', 'guest']);
		await approve(side, '418092', { you: { user_id: 'ada' } });
		expect(storage.has(TOKEN_KEY)).toBe(false);
		// The next connection is never Bob again behind Ada's back.
		side.drop();
		vi.advanceTimersByTime(5_000);
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 7, auth: ['email', 'token', 'guest'], capabilities: ['rooms'] } });
		expect(next.sent.filter((frame) => (frame.params as { token?: string } | undefined)?.token === 'bob-session')).toEqual([]);
	});

	it('signs up with a scheme listed only in signup', async () => {
		const server = { auth: ['webauthn'], signup: ['email'] };
		latest().open();
		latest().receive({ method: 'server', params: { apron: 7, capabilities: ['rooms'], ...server } });
		expect(snapshot.server?.signup).toEqual(['email']);
		expect(snapshot.error).toMatch(/email/);
		const side = await propose('new@example.com', [], server);
		expect(side.request('auth').params).toMatchObject({ scheme: 'email', email: 'new@example.com' });
		await approve(side, '111111', { you: { user_id: 'newbie' } });
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.signedInWith).toBe('email');
		// Email only signs up here: adding it as a way back in is refused, and a passkey is what signs in.
		await expect(client.requestEmailCodeToAdd('new@example.com')).rejects.toThrow('does not sign in with email');
		await expect(client.addEmail('1')).rejects.toThrow('does not sign in with email');
	});

	it('signs in with a confirmed link on a fresh connection to its server, and switches only once it worked', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		const main = latest();
		// A refused link changes nothing here.
		const refused = client.signInWithEmailLink('Hk41x9', 'ws://other.test/');
		const bad = latest();
		expect(bad.url).toBe('ws://other.test/');
		bad.open();
		bad.receive({ method: 'server', params: { apron: 7, auth: ['email', 'token'], capabilities: ['rooms'] } });
		await settle();
		expect(bad.request('auth').params).toEqual({ scheme: 'email', token: 'Hk41x9', agent: 'apron-web/0.4' });
		bad.receive({ id: bad.request('auth').id, error: { code: -32001, message: 'Invalid or expired token' } });
		await expect(refused).rejects.toThrow('Invalid or expired token');
		expect(bad.readyState).toBe(FakeSocket.CLOSED);
		expect(client.url).toBe('ws://fake.test/');
		expect(main.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.you?.user_id).toBe('guest_1');

		let switched = false;
		const signedIn = client.signInWithEmailLink('Hk41x9', 'ws://other.test/', () => (switched = true));
		const good = latest();
		good.open();
		good.receive({ method: 'server', params: { apron: 7, auth: ['email', 'token'], capabilities: ['rooms'] } });
		await settle();
		good.receive({ id: good.request('auth').id, result: { you: { user_id: 'ada' }, token: 'st_other' } });
		await signedIn;
		expect(switched).toBe(true);
		expect(client.url).toBe('ws://other.test/');
		expect(main.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.you?.user_id).toBe('ada');
		expect(storage.get('apron.session:ws://other.test/')).toBe('st_other');
		expect(storage.has(TOKEN_KEY)).toBe(false);
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

	it('reads the server frame’s apron, capabilities and agent, and sends its own agent with auth', async () => {
		latest().open();
		latest().receive({ method: 'server', params: { apron: 7, agent: 'aprond/0.9', auth: ['guest'], capabilities: ['rooms', 'history'] } });
		expect(snapshot.server).toMatchObject({ apron: 7, agent: 'aprond/0.9', capabilities: ['rooms', 'history'] });
		expect(snapshot.capabilities.rooms).toBe(true);
		expect(auths()[0].params).toEqual({ scheme: 'guest', agent: 'apron-web/0.4' });
		// A v6 server still says `protocol` and `caps`; what differs for it is gated on the version.
		latest().receive({ method: 'server', params: { protocol: 6, auth: ['guest'], caps: ['history'] } });
		expect(snapshot.server).toMatchObject({ apron: 6, capabilities: ['history'] });
		expect(snapshot.memberChangesUnsupported).toBe(true);
		// Without a version at all it isn't an Apron server frame.
		latest().receive({ method: 'server', params: { auth: ['guest'], capabilities: [] } });
		expect(snapshot.server?.apron).toBe(6);
	});

	it('keeps server.welcome from each server frame, which replaces the last', async () => {
		latest().open();
		latest().receive({ method: 'server', params: { apron: 7, auth: ['guest'], capabilities: [], welcome: 'Hello *there*' } });
		expect(snapshot.server?.welcome).toBe('Hello *there*');
		latest().receive({ method: 'server', params: { apron: 7, auth: ['guest'], capabilities: [] } });
		expect(snapshot.server?.welcome).toBeUndefined();
		// Not a string: ignored.
		latest().receive({ method: 'server', params: { apron: 7, auth: ['guest'], capabilities: [], welcome: { text: 'x' } } });
		expect(snapshot.server).not.toHaveProperty('welcome');
	});

	it('merges roles like any profile field, and an empty list clears them', async () => {
		await latest().greet(['rooms'], { you: { user_id: 'guest_1', roles: ['admin'] } });
		expect(snapshot.you?.roles).toEqual(['admin']);
		latest().receive({ method: 'user', params: { new: { user_id: 'bot_1', name: 'Deploy', roles: ['bot'] } } });
		expect(snapshot.users.bot_1.roles).toEqual(['bot']);
		latest().receive({ method: 'user', params: { new: { user_id: 'bot_1', roles: [] } } });
		expect(snapshot.users.bot_1).toEqual({ user_id: 'bot_1', name: 'Deploy', roles: [] });
		// Cleared stays cleared: a message's recorded `from` with the old roles doesn't bring them back.
		expect(userIn(snapshot, { user_id: 'bot_1', roles: ['bot'] }).roles).toEqual([]);
		latest().receive({ method: 'user', params: { you: { user_id: 'guest_1' } } });
		await settle();
		expect(snapshot.you?.roles).toEqual(['admin']);
	});
});
