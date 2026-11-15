import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatClient, ClientSnapshot } from './client';
import { REQUEST_TIMEOUT_MS } from './client-internals';
import { PROPOSAL_MS } from './signin-connection';
import { findProposal } from './proposals';
import { requestPasskey } from './webauthn';
import { FakeSocket, nextSocket, settle, startClient, afterBackoff } from '$lib/test/client';

vi.mock('./webauthn', () => ({ requestPasskey: vi.fn(), signalPasskeyLabel: vi.fn() }));

/**
 * Signing in (§3.2, §4.10, §4.11, §4.12): email proposals on their own
 * connection, links, external sign-in's begin and redemption, adding a way back in versus signing in, what a server
 * frame says about signing in, and how a session's ways back in survive adds,
 * reconnects and codes asked for while signed in.
 */
const storage = new Map<string, string>();
const TOKEN_KEY = 'apron.session:ws://fake.test/';
let client: ChatClient;
let snapshot: ClientSnapshot;

beforeEach(() => {
	vi.useFakeTimers();
	storage.clear();
	vi.mocked(requestPasskey).mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function latest(): FakeSocket {
	return FakeSocket.latest();
}

/** Starts the client afresh on what `storage` holds. */
function start(): void {
	({ client } = startClient({ storage, onSnapshot: (next) => (snapshot = next) }));
}

/** Email sign-in (§4.11), external sign-in (§4.12), and `server.welcome`. */
describe('sign-in', () => {
	beforeEach(() => {
		start();
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
		side.receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'], ...extra } });
		await settle();
		side.receive({ id: side.request('auth').id, result: {} });
		await requested;
		return side;
	}

	/** Approves with `code` on `side` and answers with `result`. */
	async function approve(side: FakeSocket, code: string, result: Record<string, unknown>): Promise<void> {
		const signedIn = client.signInWithCode(code);
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
		expect(side.sent).toEqual([{ method: 'auth', id: expect.any(String), params: { scheme: 'email', email: 'ada@example.com', state: expect.any(String), agent: 'apron-web/0.4' } }]);
		// It stays open for the code, which works only there.
		expect(side.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.signInCode).toEqual({ scheme: 'email', email: 'ada@example.com', url: 'ws://fake.test/' });
		expect(main.readyState).toBe(FakeSocket.OPEN);
		await main.reply('message', { message_id: '1' });
		await expect(sending.promise).resolves.toEqual({ message_id: '1' });
		expect(snapshot.you?.user_id).toBe('guest_1');
		expect(snapshot.passkeySession).toBe(false);

		// The approval carries the code and the proposal's state (§4.11.3), on the proposing connection.
		const state = side.request('auth').params.state;
		const signedIn = client.signInWithCode(' 418092 ', 'Ada L', () => expect(snapshot.you?.user_id).toBe('guest_1'));
		expect(snapshot.authBusy).toBe(true);
		await settle();
		const approval = side.request('auth');
		expect(approval.params).toEqual({ scheme: 'email', token: '418092', state, agent: 'apron-web/0.4' });
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
		expect(snapshot.signInCode).toBeUndefined();
		expect(storage.get(TOKEN_KEY)).toBe('st_Hk41');

		// The next connection resumes with the bearer token.
		side.drop();
		afterBackoff();
		await latest().greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'ada', name: 'Ada' } });
		expect(auths()[0].params).toMatchObject({ scheme: 'token', token: 'st_Hk41' });
	});

	it('replaces a kept session with the one the code signs in', async () => {
		storage.set(TOKEN_KEY, 'bob-session');
		client.stop();
		start();
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
		const wrong = client.signInWithCode('000000');
		await settle();
		side.receive({ id: side.request('auth').id, error: { code: -32001, message: 'Invalid or expired code' } });
		await expect(wrong).rejects.toThrow('Invalid or expired code');
		// Nothing changed here, and the proposal is still there.
		expect(main.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.you?.user_id).toBe('guest_1');
		expect(side.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.signInCode?.email).toBe('ada@example.com');
		await approve(side, '418092', { you: { user_id: 'ada' }, token: 'st_ada' });
		expect(snapshot.you?.user_id).toBe('ada');
	});

	it('says when there is no proposal, and a new one replaces the last', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		await expect(client.signInWithCode('1')).rejects.toThrow('no longer open');
		const first = await propose('ada@example.com', ['email', 'token', 'guest']);
		const second = await propose('ada@example.com', ['email', 'token', 'guest']);
		expect(first.readyState).toBe(FakeSocket.CLOSED);
		expect(second.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.signInCode).toBeDefined();
		client.cancelSignInCode();
		expect(snapshot.signInCode).toBeUndefined();
		await expect(client.signInWithCode('418092')).rejects.toThrow('no longer open');
		expect(snapshot.you?.user_id).toBe('guest_1');
	});

	it('types the code on a fresh connection with the proposal’s state once the proposing one dropped', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		const main = latest();
		const side = await propose('ada@example.com', ['email', 'token', 'guest']);
		const state = side.request('auth').params.state;
		// The phone put the page to sleep while the email was read: the proposal stays, and so does its code field.
		side.drop();
		expect(snapshot.signInCode).toEqual({ scheme: 'email', email: 'ada@example.com', url: 'ws://fake.test/' });
		const sockets = FakeSocket.instances.length;
		const wrong = client.signInWithCode('000000');
		// Typed again while that connection opens: it waits for the same one.
		const again = client.signInWithCode('000001');
		const fresh = await linkConnection(['email', 'token', 'guest']);
		expect(FakeSocket.instances).toHaveLength(sockets + 1);
		expect(fresh).not.toBe(side);
		await expect(again).rejects.toThrow('Already signing in');
		// A short code works elsewhere only with its proposal's state (§4.11.2), so it goes along.
		expect(fresh.request('auth').params).toEqual({ scheme: 'email', token: '000000', state, agent: 'apron-web/0.4' });
		fresh.receive({ id: fresh.request('auth').id, error: { code: -32001, message: 'Invalid or expired code' } });
		await expect(wrong).rejects.toThrow('Invalid or expired code');
		// A wrong code is typed again on that same connection.
		expect(fresh.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.signInCode).toBeDefined();
		const signedIn = client.signInWithCode('418092');
		await settle();
		expect(FakeSocket.instances).toHaveLength(sockets + 1);
		const approval = fresh.request('auth');
		expect(approval.params).toEqual({ scheme: 'email', token: '418092', state, agent: 'apron-web/0.4' });
		fresh.receive({ id: approval.id, result: { you: { user_id: 'ada' }, token: 'st_ada' } });
		await signedIn;
		expect(snapshot.you?.user_id).toBe('ada');
		expect(latest()).toBe(fresh);
		expect(main.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.signInCode).toBeUndefined();
		expect(findProposal(state as string)).toBeUndefined();
		expect(storage.get(TOKEN_KEY)).toBe('st_ada');
	});

	it('gives up a dropped proposal’s code once it has expired, and one its server no longer offers', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		let side = await propose('ada@example.com', ['email', 'token', 'guest']);
		side.drop();
		expect(snapshot.signInCode).toBeDefined();
		const sockets = FakeSocket.instances.length;
		await vi.advanceTimersByTimeAsync(PROPOSAL_MS);
		expect(snapshot.signInCode).toBeUndefined();
		await expect(client.signInWithCode('418092')).rejects.toThrow('no longer open');
		expect(FakeSocket.instances).toHaveLength(sockets);

		// The server came back without email: the code can't go there, and the proposal stays for when it does.
		side = await propose('ada@example.com', ['email', 'token', 'guest']);
		side.drop();
		const signIn = client.signInWithCode('418092');
		const fresh = await linkConnection(['token', 'guest']);
		await expect(signIn).rejects.toThrow('does not support email');
		expect(fresh.sent).toEqual([]);
		expect(fresh.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.signInCode).toBeDefined();
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
		latest().receive({ method: 'server', params: { apron: 10, auth: ['email', 'token'], capabilities: ['rooms'], welcome: 'Create an account with **email**.' } });
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
		afterBackoff();
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 10, auth: ['email', 'guest', 'webauthn'], capabilities: [] } });
		await settle();
		expect(next.sent.filter((frame) => frame.method === 'auth')).toEqual([]);
		expect(snapshot.authenticated).toBe(false);
		expect(snapshot.held).toBe(true);
		expect(snapshot.error).toMatch(/email/);
	});

	it('signs in with an email code after a disconnect, carrying on with the code’s connection', async () => {
		await latest().greet([], { auth: ['email', 'guest'] });
		const main = latest();
		client.disconnect();
		await settle();
		expect(snapshot.status).toBe('offline');
		const side = await propose('ada@example.com', ['email', 'guest']);
		await approve(side, '418092', { you: { user_id: 'ada', name: 'Ada' }, token: 'st_Hk41' });
		expect(main.readyState).toBe(FakeSocket.CLOSED);
		expect(latest()).toBe(side);
		expect(snapshot.status).toBe('connected');
		expect(snapshot.you?.user_id).toBe('ada');
		// Running again: a dropped connection reconnects.
		side.drop();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(latest()).not.toBe(side);
	});

	it('forgets a session held for a sign-in on a disconnect, and connecting again connects afresh', async () => {
		await latest().greet([], { auth: ['email', 'guest', 'webauthn'] });
		const side = await propose('ada@example.com', ['email', 'guest', 'webauthn']);
		await approve(side, '418092', { you: { user_id: 'ada' } });
		side.drop();
		afterBackoff();
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 9, auth: ['email', 'guest', 'webauthn'], capabilities: [] } });
		await settle();
		expect(snapshot.held).toBe(true);
		client.disconnect();
		await settle();
		expect(snapshot.held).toBeFalsy();
		// What the connect screen does for a held session, retrying it, starts a disconnected client.
		client.retryNow();
		await settle();
		expect(latest()).not.toBe(next);
		expect(snapshot.status).not.toBe('offline');
	});

	it('adds an email to the signed-in account on the same connection, without changing how it signed in', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'], token: 'st_guest' });
		expect(snapshot.signedInWith).toBe('token');
		const socket = latest();
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		expect(socket.request('auth').params).toEqual({ scheme: 'email', email: 'ada@example.com', state: expect.any(String) });
		const state = socket.request('auth').params.state;
		await socket.reply('auth', {});
		await asked;
		const added = client.addWithCode(' 418092 ');
		await vi.advanceTimersByTimeAsync(0);
		expect(latest()).toBe(socket);
		expect(snapshot.passkeyBusy).toBe(false);
		const approval = socket.request('auth');
		// The approval carries the code and the proposal's state; an addition's result is `{}`.
		expect(approval.params).toEqual({ scheme: 'email', token: '418092', state });
		socket.receive({ id: approval.id, result: {} });
		await added;
		expect(snapshot.you?.user_id).toBe('guest_1');
		// Added, not signed in with: the session still resumes with its token, and the token is kept.
		expect(snapshot.signedInWith).toBe('token');
		expect(snapshot.signInMethods).toEqual(['token', 'email']);
		expect(storage.get(TOKEN_KEY)).toBe('st_guest');
		expect(storage.get('apron.signin-added:ws://fake.test/')).toBe('email');
	});

	it('adds with the code after a reconnect to the same account, sending the proposal’s state', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'], token: 'st_guest' });
		const socket = latest();
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		const state = socket.request('auth').params.state;
		await socket.reply('auth', {});
		await asked;
		// The connection drops while the email is read, and the session resumes as the same account.
		socket.drop();
		afterBackoff();
		const next = latest();
		await next.greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'guest_1' } });
		expect(next.request('auth').params).toMatchObject({ scheme: 'token', token: 'st_guest' });
		const added = client.addWithCode('418092');
		await vi.advanceTimersByTimeAsync(0);
		const approval = next.sent.filter((frame) => frame.method === 'auth').at(-1)!;
		// On another connection than the one that proposed it, the state lets the code work (§4.11.2).
		expect(approval.params).toEqual({ scheme: 'email', token: '418092', state });
		next.receive({ id: approval.id, result: {} });
		await added;
		expect(snapshot.signInMethods).toEqual(['token', 'email']);
		expect(findProposal(state as string)).toBeUndefined();
	});

	it('makes a guest without a token an email account once an address is added', async () => {
		await latest().greet([], { auth: ['email', 'guest'] });
		expect(snapshot.passkeySession).toBe(false);
		const socket = latest();
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		await socket.reply('auth', {});
		await asked;
		const added = client.addWithCode('418092');
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('auth', {});
		await added;
		expect(snapshot.passkeySession).toBe(true);
		expect(snapshot.signedInWith).toBe('email');
		// Nothing to resume with: the next connection asks for the email again rather than a new guest.
		socket.drop();
		afterBackoff();
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 10, auth: ['email', 'guest'], capabilities: [] } });
		await settle();
		expect(next.sent.filter((frame) => frame.method === 'auth')).toEqual([]);
		expect(snapshot.error).toMatch(/email/);
	});

	it('won’t approve an addition after a reconnect as another account than the one that proposed it', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'], token: 'st_guest' });
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		await latest().reply('auth', {});
		await asked;
		latest().drop();
		afterBackoff();
		// The kept token no longer resumes: the server made a new guest.
		await latest().greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'guest_2' } });
		await expect(client.addWithCode('418092')).rejects.toThrow('Send a new code');
		expect(auths()).toHaveLength(1);
	});

	it('keeps a passkey session a passkey session after an email is added', async () => {
		storage.set(TOKEN_KEY, 'st_ada');
		storage.set('apron.signin:ws://fake.test/', 'webauthn');
		client.stop();
		start();
		await latest().greet([], { auth: ['webauthn', 'email', 'token', 'guest'], you: { user_id: 'ada' } });
		expect(snapshot.signedInWith).toBe('webauthn');
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		await latest().reply('auth', {});
		await asked;
		const added = client.addWithCode('1');
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
		start();
		await latest().greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'bob' } });
		const side = await propose('ada@example.com', ['email', 'token', 'guest']);
		await approve(side, '418092', { you: { user_id: 'ada' } });
		expect(storage.has(TOKEN_KEY)).toBe(false);
		// The next connection is never Bob again behind Ada's back.
		side.drop();
		afterBackoff();
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 10, auth: ['email', 'token', 'guest'], capabilities: ['rooms'] } });
		expect(next.sent.filter((frame) => (frame.params as { token?: string } | undefined)?.token === 'bob-session')).toEqual([]);
	});

	it('signs up with a scheme listed only in signup', async () => {
		const server = { auth: ['webauthn'], signup: ['email'] };
		latest().open();
		latest().receive({ method: 'server', params: { apron: 10, capabilities: ['rooms'], ...server } });
		expect(snapshot.server?.signup).toEqual(['email']);
		expect(snapshot.error).toMatch(/email/);
		const side = await propose('new@example.com', [], server);
		expect(side.request('auth').params).toMatchObject({ scheme: 'email', email: 'new@example.com' });
		await approve(side, '111111', { you: { user_id: 'newbie' } });
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.signedInWith).toBe('email');
		// Email only signs up here: adding it as a way back in is refused, and a passkey is what signs in.
		await expect(client.requestEmailCodeToAdd('new@example.com')).rejects.toThrow('does not sign in with email');
		await expect(client.addWithCode('1')).rejects.toThrow('does not sign in with email');
	});

	it('signs in with a confirmed link on a fresh connection to its server, and switches only once it worked', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		const main = latest();
		// A refused link changes nothing here.
		const refused = client.signInWithLink('Hk41x9', 'ws://other.test/');
		const bad = latest();
		expect(bad.url).toBe('ws://other.test/');
		bad.open();
		bad.receive({ method: 'server', params: { apron: 10, auth: ['email', 'token'], capabilities: ['rooms'] } });
		await settle();
		expect(bad.request('auth').params).toEqual({ scheme: 'email', token: 'Hk41x9', agent: 'apron-web/0.4' });
		bad.receive({ id: bad.request('auth').id, error: { code: -32001, message: 'Invalid or expired token' } });
		await expect(refused).rejects.toThrow('Invalid or expired token');
		expect(bad.readyState).toBe(FakeSocket.CLOSED);
		expect(client.url).toBe('ws://fake.test/');
		expect(main.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.you?.user_id).toBe('guest_1');

		let switched = false;
		const signedIn = client.signInWithLink('Hk41x9', 'ws://other.test/', { beforeSwitch: () => (switched = true) });
		const good = latest();
		good.open();
		good.receive({ method: 'server', params: { apron: 10, auth: ['email', 'token'], capabilities: ['rooms'] } });
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

	/** Opens a link's connection to `url` and greets it with these schemes; returns it once ready. */
	async function linkConnection(auth: string[], url = 'ws://fake.test/'): Promise<FakeSocket> {
		const socket = latest();
		expect(socket.url).toBe(url);
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'] } });
		await settle();
		return socket;
	}

	it('remembers each proposal’s state with its server, and a disconnect leaves its link working', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		const side = await propose('ada@example.com', ['email', 'token', 'guest']);
		const state = side.request('auth').params.state as string;
		// Unguessable, and at most 256 bytes (§4.11.1).
		expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(findProposal(state)).toMatchObject({ scheme: 'email', kind: 'sign-in', url: 'ws://fake.test/', email: 'ada@example.com' });
		// Another proposal has a state of its own; the first is still remembered, and the server keeps it too.
		const second = await propose('ada@example.com', ['email', 'token', 'guest']);
		const secondState = second.request('auth').params.state as string;
		expect(secondState).not.toBe(state);
		// Its connection closes: the code would go on a fresh connection, and the proposal's link still signs in.
		second.drop();
		expect(snapshot.signInCode).toBeDefined();
		expect(findProposal(secondState)).toBeDefined();
		const signedIn = client.signInWithLink('Hk41x9', 'ws://fake.test/', { scheme: 'email', state: secondState });
		const link = await linkConnection(['email', 'token', 'guest']);
		expect(link.request('auth').params).toEqual({ scheme: 'email', token: 'Hk41x9', agent: 'apron-web/0.4' });
		link.receive({ id: link.request('auth').id, result: { you: { user_id: 'ada' }, token: 'st_ada' } });
		await signedIn;
		expect(snapshot.you?.user_id).toBe('ada');
		// Approval used it up, its code too.
		expect(findProposal(secondState)).toBeUndefined();
		expect(snapshot.signInCode).toBeUndefined();
		expect(findProposal(state)).toBeDefined();
	});

	it('approves a link of no known proposal with a scheme its server offers', async () => {
		await latest().greet([], { auth: ['token', 'guest'] });
		const signedIn = client.signInWithLink('Hk41x9', 'ws://other.test/');
		const link = await linkConnection(['external', 'token'], 'ws://other.test/');
		// External sign-in takes no link (§4.12): without email, the token goes as a bearer token (§4.11.3).
		expect(link.request('auth').params).toEqual({ scheme: 'token', token: 'Hk41x9', agent: 'apron-web/0.4' });
		link.receive({ id: link.request('auth').id, result: { you: { user_id: 'ada' }, token: 'st_ada' } });
		await signedIn;
		expect(snapshot.signedInWith).toBe('token');

		const refused = client.signInWithLink('Hk41x9', 'ws://third.test/');
		const none = await linkConnection(['guest'], 'ws://third.test/');
		await expect(refused).rejects.toThrow('does not support sign-in links');
		expect(none.sent).toEqual([]);
		expect(none.readyState).toBe(FakeSocket.CLOSED);
	});

	it('presents a link token as a bearer token to a server with neither email nor external sign-in, and keeps it to resume with', async () => {
		await latest().greet([], { auth: ['token', 'guest'] });
		// An invite link (Appendix A.4), opened through link.apron.chat.
		const signedIn = client.signInWithLink('apron_invite_x', 'ws://other.test/');
		const link = await linkConnection(['token', 'guest'], 'ws://other.test/');
		expect(link.request('auth').params).toEqual({ scheme: 'token', token: 'apron_invite_x', agent: 'apron-web/0.4' });
		link.receive({ id: link.request('auth').id, result: { you: { user_id: 'dana' } } });
		await signedIn;
		expect(client.url).toBe('ws://other.test/');
		expect(snapshot.you?.user_id).toBe('dana');
		expect(snapshot.signedInWith).toBe('token');
		expect(storage.get('apron.session:ws://other.test/')).toBe('apron_invite_x');

		// A token the server sends replaces it (§3.2.1); a proposal's own link never falls back to `token`.
		const rotated = client.signInWithLink('apron_invite_y', 'ws://third.test/');
		const next = await linkConnection(['token'], 'ws://third.test/');
		next.receive({ id: next.request('auth').id, result: { you: { user_id: 'erin' }, token: 'st_erin' } });
		await rotated;
		expect(storage.get('apron.session:ws://third.test/')).toBe('st_erin');
		const own = client.signInWithLink('Hk41x9', 'ws://fourth.test/', { scheme: 'email', state: 's' });
		const fourth = await linkConnection(['token'], 'ws://fourth.test/');
		await expect(own).rejects.toThrow('does not support sign-in links');
		expect(fourth.sent).toEqual([]);
	});

	const redeem = { code: 'Hk41x9', code_verifier: 'dBjftJ', redirect_uri: 'https://web.example/signed-in/', client_id: 'https://web.example/client-metadata.json' };

	it('begins an external sign-in on a connection of its own, and opens only a page a client may open', async () => {
		await latest().greet([], { auth: ['external', 'token', 'guest'] });
		const main = latest();
		const begun = client.beginExternal();
		const side = await linkConnection(['external', 'token', 'guest']);
		// A begin is an `external` request with neither `code` nor `token` (§4.12.1).
		expect(side.request('auth').params).toEqual({ scheme: 'external', agent: 'apron-web/0.4' });
		side.receive({ id: side.request('auth').id, result: { external: { url: 'https://chat.example/oauth/authorize?scope=chat' } } });
		await expect(begun).resolves.toEqual({ url: 'https://chat.example/oauth/authorize?scope=chat' });
		// It authenticates nothing and binds nothing: its connection closes, and this one is left as it was.
		expect(side.readyState).toBe(FakeSocket.CLOSED);
		expect(main.readyState).toBe(FakeSocket.OPEN);
		expect(main.sent.filter((frame) => frame.method === 'auth')).toHaveLength(1);

		for (const url of ['javascript:alert(1)', 'http://chat.example/oauth/authorize', '/oauth/authorize', 42]) {
			const bad = client.beginExternal();
			const other = await linkConnection(['external', 'token']);
			other.receive({ id: other.request('auth').id, result: { external: { url } } });
			await expect(bad).rejects.toThrow('wasn’t opened');
			expect(other.readyState).toBe(FakeSocket.CLOSED);
		}
		const none = client.beginExternal();
		const empty = await linkConnection(['external', 'token']);
		empty.receive({ id: empty.request('auth').id, result: {} });
		await expect(none).rejects.toThrow('no sign-in page');
		const loopback = client.beginExternal('ws://127.0.0.1:8080/ws');
		const local = await linkConnection(['external', 'token'], 'ws://127.0.0.1:8080/ws');
		local.receive({ id: local.request('auth').id, result: { external: { url: 'http://127.0.0.1:8080/oauth/authorize' } } });
		await expect(loopback).resolves.toEqual({ url: 'http://127.0.0.1:8080/oauth/authorize' });
		const unsupported = client.beginExternal('ws://other.test/');
		const other = await linkConnection(['email', 'token'], 'ws://other.test/');
		await expect(unsupported).rejects.toThrow('does not support external sign-in');
		expect(other.sent).toEqual([]);
	});

	it('signs in with an external code on a fresh connection, and carries on with it', async () => {
		await latest().greet([], { auth: ['external', 'token', 'guest'] });
		expect(snapshot.you?.user_id).toBe('guest_1');
		const main = latest();
		const switched = vi.fn();
		const signedIn = client.signInWithExternalCode(redeem, 'ws://fake.test/', { name: 'Ada', beforeSwitch: switched });
		// A fresh connection, not this guest one: there, the code would add to the guest's account (§4.12.4).
		const side = await linkConnection(['external', 'token', 'guest']);
		expect(side).not.toBe(main);
		expect(side.request('auth').params).toEqual({ scheme: 'external', ...redeem, agent: 'apron-web/0.4' });
		side.receive({ id: side.request('auth').id, result: { you: { user_id: 'ada', name: 'Ada' }, token: 'st_ada' } });
		await signedIn;
		expect(switched).toHaveBeenCalledOnce();
		expect(main.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.you?.user_id).toBe('ada');
		expect(snapshot.signedInWith).toBe('external');
		expect(snapshot.passkeySession).toBe(true);
		expect(storage.get(TOKEN_KEY)).toBe('st_ada');

		// A refused code changes nothing, and its connection closes.
		const refused = client.signInWithExternalCode(redeem, 'ws://fake.test/');
		const next = await linkConnection(['external', 'token']);
		next.receive({ id: next.request('auth').id, error: { code: -32001, message: 'Invalid code' } });
		await expect(refused).rejects.toThrow('Invalid code');
		expect(next.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.you?.user_id).toBe('ada');
	});

	it('adds an external identity with its code on the signed-in connection, for the account that began it', async () => {
		await latest().greet([], { auth: ['external', 'token', 'guest'], token: 'st_ada', you: { user_id: 'ada' } });
		const socket = latest();
		const sockets = FakeSocket.instances.length;
		await expect(client.addExternalWithCode(redeem, 'bob')).rejects.toThrow('@bob');
		const added = client.addExternalWithCode(redeem, 'ada');
		await vi.advanceTimersByTimeAsync(0);
		// On this connection, signed in: the code adds, never signs in to another account (§4.12.4).
		expect(FakeSocket.instances).toHaveLength(sockets);
		expect(socket.request('auth').params).toEqual({ scheme: 'external', ...redeem });
		await socket.reply('auth', { you: { user_id: 'ada' } });
		await added;
		expect(snapshot.you?.user_id).toBe('ada');
		expect(snapshot.signInMethods).toEqual(['token', 'external']);
	});

	it('shows a denied proposal as it is, without asking again, and forgets a refused proposal’s state', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'] });
		const proposed = client.requestEmailCode('ada@example.com');
		const side = await linkConnection(['email', 'token', 'guest']);
		const first = side.request('auth');
		side.receive({ id: first.id, error: { code: -32001, message: 'Too many sign-ins from this account' } });
		await expect(proposed).rejects.toThrow('Too many sign-ins');
		expect(side.sent.filter((frame) => frame.method === 'auth')).toHaveLength(1);
		expect(findProposal(first.params.state as string)).toBeUndefined();
		// Failures, a limit's say, never crowd out a proposal still waiting for its link.
		const live = await propose('ada@example.com', ['email', 'token', 'guest']);
		const liveState = live.request('auth').params.state as string;
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const requested = client.requestEmailCode('ada@example.com');
			const again = latest();
			again.open();
			again.receive({ method: 'server', params: { apron: 10, auth: ['email', 'token', 'guest'], capabilities: ['rooms'] } });
			await settle();
			again.receive({ id: again.request('auth').id, error: { code: -32002, message: 'Slow down', data: { retry_after: 30 } } });
			await expect(requested).rejects.toThrow('Slow down');
		}
		expect(findProposal(liveState)).toBeDefined();
	});

	it('records a link of no known proposal as email, the one scheme a link approves', async () => {
		await latest().greet([], { auth: ['token', 'guest'] });
		const signedIn = client.signInWithLink('Hk41x9', 'ws://other.test/');
		const link = await linkConnection(['email', 'external', 'token'], 'ws://other.test/');
		expect(link.request('auth').params).toMatchObject({ scheme: 'email', token: 'Hk41x9' });
		link.receive({ id: link.request('auth').id, result: { you: { user_id: 'ada' }, token: 'st_ada' } });
		await signedIn;
		expect(snapshot.signedInWith).toBe('email');
		expect(snapshot.signInMethods).toEqual(['email']);
		expect(storage.get('apron.signin:ws://other.test/')).toBe('email');
	});

	it('reports a `link` session it cannot resume as signed out, naming neither scheme', async () => {
		storage.set(TOKEN_KEY, 'st_ada');
		storage.set('apron.signin:ws://fake.test/', 'link');
		client.stop();
		start();
		const first = latest();
		first.open();
		first.receive({ method: 'server', params: { apron: 10, auth: ['email', 'external', 'token'], capabilities: [] } });
		first.receive({ id: first.request('auth').id, error: { code: -32001, message: 'Session expired' } });
		await settle();
		expect(snapshot.held).toBe(true);
		expect(snapshot.signInNeeded).toBe('email');
		expect(snapshot.authenticated).toBe(false);
		// Nothing to resume by: signed out, never a guest, and told to sign in again without naming a scheme.
		client.retryNow();
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 10, auth: ['external', 'email', 'guest'], capabilities: [] } });
		await settle();
		expect(next.sent.filter((frame) => frame.method === 'auth')).toEqual([]);
		expect(snapshot.held).toBe(true);
		expect(snapshot.signInNeeded).toBe('email');
		expect(snapshot.error).toBe('Sign in again from the connect screen.');
	});

	it('adds a confirmed link of no known addition on the signed-in connection, which the server alone can approve', async () => {
		await latest().greet([], { auth: ['email', 'external', 'token', 'guest'], token: 'st_ada', you: { user_id: 'ada' } });
		const socket = latest();
		const sockets = FakeSocket.instances.length;
		const refused = client.addWithConfirmedLink(' Hk41x9 ');
		await vi.advanceTimersByTimeAsync(0);
		// On this connection, not a fresh one: an addition approves only for the account that proposed it (§4.11.3).
		expect(FakeSocket.instances).toHaveLength(sockets);
		expect(socket.request('auth').params).toEqual({ scheme: 'email', token: 'Hk41x9' });
		socket.receive({ id: socket.request('auth').id, error: { code: -32001, message: 'Invalid token' } });
		await expect(refused).rejects.toThrow('Invalid token');
		expect(snapshot.you?.user_id).toBe('ada');
		expect(snapshot.signInMethods).toEqual(['token']);
		const added = client.addWithConfirmedLink('Hk41x9');
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('auth', {});
		await expect(added).resolves.toBe('email');
		expect(snapshot.signInMethods).toEqual(['token', 'email']);
	});

	it('adds with a link of its own addition on any connection of the proposing account, and only there', async () => {
		await latest().greet([], { auth: ['email', 'external', 'token', 'guest'], token: 'st_ada', you: { user_id: 'ada' } });
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		expect(latest().request('auth').params).toEqual({ scheme: 'email', email: 'ada@example.com', state: expect.any(String) });
		const state = latest().request('auth').params.state as string;
		await latest().reply('auth', {});
		await asked;
		expect(findProposal(state)).toMatchObject({ scheme: 'email', kind: 'addition', account: 'ada', url: 'ws://fake.test/' });

		// The link opens a new page load: another connection, the same account.
		latest().drop();
		afterBackoff();
		await latest().greet([], { auth: ['email', 'external', 'token', 'guest'], you: { user_id: 'ada' } });
		const socket = latest();
		const added = client.addWithLink(' Hk41x9 ', state);
		await vi.advanceTimersByTimeAsync(0);
		const approval = socket.request('auth');
		expect(approval.params).toEqual({ scheme: 'email', token: 'Hk41x9' });
		// Refused (another account's identity, say): nothing added, and the link may be tried again.
		socket.receive({ id: approval.id, error: { code: -32001, message: 'Identity belongs to another account' } });
		await expect(added).rejects.toThrow('another account');
		expect(snapshot.signInMethods).toEqual(['token']);
		expect(findProposal(state)).toBeDefined();
		const again = client.addWithLink('Hk41x9', state);
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('auth', {});
		await expect(again).resolves.toBe('email');
		expect(snapshot.you?.user_id).toBe('ada');
		expect(snapshot.signInMethods).toEqual(['token', 'email']);
		expect(findProposal(state)).toBeUndefined();
	});

	it('won’t add with an addition’s link on a connection of another account', async () => {
		await latest().greet([], { auth: ['email', 'token', 'guest'], token: 'st_guest' });
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		const state = latest().request('auth').params.state as string;
		await latest().reply('auth', {});
		await asked;
		expect(findProposal(state)).toMatchObject({ kind: 'addition', account: 'guest_1', email: 'ada@example.com' });
		latest().drop();
		afterBackoff();
		await latest().greet([], { auth: ['email', 'token', 'guest'], you: { user_id: 'bob' } });
		const sent = latest().sent.length;
		await expect(client.addWithLink('Hk41x9', state)).rejects.toThrow('@guest_1');
		await expect(client.addWithLink('Hk41x9', 'not-ours')).rejects.toThrow('no such addition');
		expect(latest().sent).toHaveLength(sent);
	});


	it('reads the server frame’s apron, capabilities and agent, and sends its own agent with auth', async () => {
		latest().open();
		latest().receive({ method: 'server', params: { apron: 10, agent: 'aprond/0.9', auth: ['guest'], capabilities: ['rooms', 'history'] } });
		expect(snapshot.server).toMatchObject({ apron: 10, agent: 'aprond/0.9', capabilities: ['rooms', 'history'] });
		expect(snapshot.capabilities.rooms).toBe(true);
		expect(auths()[0].params).toEqual({ scheme: 'guest', agent: 'apron-web/0.4' });
		// Without a version it isn't an Apron server frame.
		latest().receive({ method: 'server', params: { auth: ['guest'], capabilities: [] } });
		expect(snapshot.server?.apron).toBe(10);
	});

	it('keeps server.welcome from each server frame, which replaces the last', async () => {
		latest().open();
		latest().receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: [], welcome: 'Hello *there*' } });
		expect(snapshot.server?.welcome).toBe('Hello *there*');
		latest().receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: [] } });
		expect(snapshot.server?.welcome).toBeUndefined();
		// Not a string: ignored.
		latest().receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: [], welcome: { text: 'x' } } });
		expect(snapshot.server).not.toHaveProperty('welcome');
	});
});

/**
 * How a session's ways back in (§3.2, §4.10, §4.11) survive adds, reconnects,
 * and sign-in codes asked for while signed in.
 */
describe('accounts and their ways back in', () => {
	const frames = (socket: FakeSocket) => socket.sent.map((frame) => {
		const params = (frame.params ?? {}) as { scheme?: string; action?: string; step?: string };
		return [frame.method, params.scheme, params.action ?? params.step].filter((part) => part !== undefined).join(' ');
	});

	/** The next connection, greeted by a server with these schemes. */
	async function reconnect(auth: string[], extra: Record<string, unknown> = {}): Promise<FakeSocket> {
		const previous = latest();
		previous.drop();
		// The socket it opens after its backoff, not after a fixed wait: one opened at once (a backoff of 0) would run
		// out its own opening time (OPENING_MS) within that wait and be replaced, unseen.
		const socket = await nextSocket(previous);
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'], ...extra } });
		await vi.advanceTimersByTimeAsync(0);
		return socket;
	}

	/**
	 * Signs in by email (§4.11): proposes on a connection of its own, greeted
	 * by a server with these schemes, and approves there; the client carries
	 * on with that connection.
	 */
	async function signInByEmail(auth: string[], you: string, extra: Record<string, unknown> = {}): Promise<FakeSocket> {
		const requested = client.requestEmailCode(`${you}@example.com`);
		const side = latest();
		side.open();
		side.receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'], ...extra } });
		await vi.advanceTimersByTimeAsync(0);
		await side.reply('auth', {});
		await requested;
		const signedIn = client.signInWithCode('1');
		await vi.advanceTimersByTimeAsync(0);
		side.receive({ id: side.request('auth').id, result: { you: { user_id: you } } });
		await signedIn;
		return side;
	}

	/** Registers a passkey on the current connection; the finish result carries no token. */
	async function registerPasskey(socket: FakeSocket, you: string): Promise<void> {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const registered = client.usePasskey('register');
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('auth', { challenge_id: 'c1', public_key: { challenge: 'x' } });
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('auth', { you: { user_id: you } });
		await registered;
	}

	it('offers the passkey login on reconnect to an email session that added a passkey', async () => {
		const auth = ['email', 'webauthn'];
		start();
		latest().open();
		latest().receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'] } });
		const socket = await signInByEmail(auth, 'ada');
		await socket.reply('room_list', { joined: [] });
		expect(snapshot.signedInWith).toBe('email');
		await registerPasskey(socket, 'ada');
		expect(snapshot.signedInWith).toBe('email');
		expect(snapshot.signInMethods).toEqual(['email', 'webauthn']);
		const prompts = vi.mocked(requestPasskey).mock.calls.length;
		const next = await reconnect(auth);
		// No token to resume with: the passkey it added is the way back, not "signed out" by email.
		// Its prompt waits for a tap on the sign-in screen.
		expect(frames(next)).toEqual([]);
		expect(snapshot.held).toBe(true);
		expect(snapshot.signInNeeded).toBe('webauthn');
		expect(vi.mocked(requestPasskey).mock.calls).toHaveLength(prompts);
	});

	it('doesn’t send someone who joined by email back to email where email only signs up', async () => {
		const auth = ['webauthn'];
		const extra = { signup: ['email'] };
		start();
		latest().open();
		latest().receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'], ...extra } });
		expect(snapshot.error).toBe('Sign in with a passkey, or join with your email, from the connect screen.');
		await signInByEmail(auth, 'newbie', extra);
		const next = await reconnect(auth, extra);
		expect(frames(next)).toEqual([]);
		expect(snapshot.held).toBe(true);
		expect(snapshot.signInNeeded).toBe('webauthn');
		expect(snapshot.error).toMatch(/doesn’t sign back in with email/);
	});

	it('never signs in as a guest listed only in signup', async () => {
		start();
		latest().open();
		latest().receive({ method: 'server', params: { apron: 10, auth: ['email'], signup: ['guest'], capabilities: ['rooms'] } });
		expect(frames(latest())).toEqual([]);
		expect(snapshot.error).toMatch(/email/);
	});

	it('asks for a code on its own connection while a passkey session is up, without a passkey prompt or reconnect', async () => {
		const auth = ['webauthn', 'email'];
		start();
		latest().open();
		latest().receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'] } });
		const main = latest();
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const login = client.usePasskey('login');
		await vi.advanceTimersByTimeAsync(0);
		await main.reply('auth', { challenge_id: 'c1', public_key: { challenge: 'x' } });
		await vi.advanceTimersByTimeAsync(0);
		await main.reply('auth', { you: { user_id: 'ada' } });
		await login;
		await main.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }] });
		client.selectRoom('general');
		vi.mocked(requestPasskey).mockClear();
		const requested = client.requestEmailCode('bob@example.com');
		const side = latest();
		side.open();
		side.receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'] } });
		await vi.advanceTimersByTimeAsync(0);
		side.receive({ id: side.request('auth').id, result: {} });
		await requested;
		await vi.advanceTimersByTimeAsync(1_000);
		expect(frames(side)).toEqual(['auth email']);
		expect(requestPasskey).not.toHaveBeenCalled();
		// The signed-in view stays: same connection, same identity, same room.
		expect(main.readyState).toBe(FakeSocket.OPEN);
		expect(snapshot.you?.user_id).toBe('ada');
		expect(snapshot.activeRoom).toBe('general');
	});

	it('asks a server that isn’t this client’s own, and says when it doesn’t offer email', async () => {
		start();
		await latest().greet([], { auth: ['guest'] });
		const requested = client.requestEmailCode('ada@example.com', 'ws://other.test/');
		const side = latest();
		expect(side.url).toBe('ws://other.test/');
		side.open();
		side.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: [] } });
		await expect(requested).rejects.toThrow('does not support email');
		expect(side.sent).toEqual([]);
		expect(side.readyState).toBe(FakeSocket.CLOSED);
	});

	it('gives up on a code request that isn’t answered, and on stop', async () => {
		start();
		await latest().greet([], { auth: ['email', 'guest'] });
		const unanswered = client.requestEmailCode('ada@example.com');
		const side = latest();
		side.open();
		const failed = expect(unanswered).rejects.toThrow('didn’t answer');
		await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
		await failed;
		expect(side.readyState).toBe(FakeSocket.CLOSED);

		const stopped = client.requestEmailCode('ada@example.com');
		const link = client.signInWithLink('Hk41x9');
		client.stop();
		await expect(stopped).rejects.toThrow('stopped');
		await expect(link).rejects.toThrow('stopped');
		await settle();
		expect(snapshot.authBusy).toBe(false);
		expect(FakeSocket.instances.slice(-2).map((socket) => socket.readyState)).toEqual([FakeSocket.CLOSED, FakeSocket.CLOSED]);
	});

	/** Opens a sign-in proposal on a connection of its own, answered; returns that connection. */
	async function proposeSignIn(auth: string[]): Promise<FakeSocket> {
		const requested = client.requestEmailCode('ada@example.com');
		const side = latest();
		side.open();
		side.receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'] } });
		await vi.advanceTimersByTimeAsync(0);
		await side.reply('auth', {});
		await requested;
		return side;
	}

	/** A passkey login on the main connection, as `ada`. */
	async function passkeyLogin(main: FakeSocket): Promise<void> {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const login = client.usePasskey('login');
		await vi.advanceTimersByTimeAsync(0);
		await main.reply('auth', { challenge_id: 'c1', public_key: { challenge: 'x' } });
		await vi.advanceTimersByTimeAsync(0);
		await main.reply('auth', { you: { user_id: 'ada' } });
		await login;
	}

	it('opens no link connection it can’t use, and closes one it can’t use by the time it is ready', async () => {
		const auth = ['email', 'guest'];
		start();
		await latest().greet([], { auth });
		const side = await proposeSignIn(auth);
		const inFlight = client.signInWithCode('1');
		await vi.advanceTimersByTimeAsync(0);
		const sockets = FakeSocket.instances.length;
		await expect(client.signInWithLink('Hk41x9')).rejects.toThrow('Already signing in');
		expect(FakeSocket.instances).toHaveLength(sockets);
		side.receive({ id: side.request('auth').id, error: { code: -32001, message: 'Invalid or expired code' } });
		await expect(inFlight).rejects.toThrow('Invalid or expired code');

		// The link's connection opens first, and an approval starts while it waits for its server frame.
		const link = client.signInWithLink('Hk41x9');
		const linkSocket = latest();
		const again = client.signInWithCode('2');
		await vi.advanceTimersByTimeAsync(0);
		linkSocket.open();
		linkSocket.receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'] } });
		await expect(link).rejects.toThrow('Already signing in');
		expect(linkSocket.sent).toEqual([]);
		expect(linkSocket.readyState).toBe(FakeSocket.CLOSED);
		// The proposal itself stays for its code.
		expect(side.readyState).toBe(FakeSocket.OPEN);
		side.receive({ id: side.request('auth').id, error: { code: -32001, message: 'Invalid or expired code' } });
		await expect(again).rejects.toThrow('Invalid or expired code');
		expect(snapshot.signInCode).toBeDefined();
	});

	it('gives up a sign-in code once the main connection signs in another way', async () => {
		const auth = ['webauthn', 'email', 'token', 'guest'];
		start();
		await latest().greet([], { auth });
		const main = latest();
		// A passkey.
		let side = await proposeSignIn(auth);
		await passkeyLogin(main);
		expect(side.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.signInCode).toBeUndefined();
		// A pasted token.
		side = await proposeSignIn(auth);
		client.useToken('st_pasted');
		expect(side.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.signInCode).toBeUndefined();
		await vi.advanceTimersByTimeAsync(0);
		await latest().greet([], { auth, you: { user_id: 'bot' } });
		// An emailed link.
		side = await proposeSignIn(auth);
		const link = client.signInWithLink('Hk41x9');
		const linkSocket = latest();
		linkSocket.open();
		linkSocket.receive({ method: 'server', params: { apron: 10, auth, capabilities: ['rooms'] } });
		await vi.advanceTimersByTimeAsync(0);
		linkSocket.receive({ id: linkSocket.request('auth').id, result: { you: { user_id: 'linky' }, token: 'st_link' } });
		await link;
		expect(snapshot.you?.user_id).toBe('linky');
		expect(side.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.signInCode).toBeUndefined();
	});

	it('drops an address proposed for one account once the connection signs in as another', async () => {
		const auth = ['webauthn', 'email', 'guest'];
		start();
		await latest().greet([], { auth });
		const main = latest();
		expect(snapshot.you?.user_id).toBe('guest_1');
		const asked = client.requestEmailCodeToAdd('guest@example.com');
		await main.reply('auth', {});
		await asked;
		// The guest's connection logs in with a passkey: the proposal was the guest's, not Ada's.
		await passkeyLogin(main);
		expect(snapshot.you?.user_id).toBe('ada');
		// Another identity lists its own rooms.
		await main.reply('room_list', { joined: [] });
		const approvals = () => main.sent.filter((frame) => frame.method === 'auth' && (frame.params as { token?: string }).token !== undefined);
		await expect(client.addWithCode('418092')).rejects.toThrow('Send a new code');
		expect(approvals()).toEqual([]);
		expect(snapshot.signInMethods ?? []).not.toContain('email');
		// Proposed again as Ada, it adds to Ada.
		const again = client.requestEmailCodeToAdd('ada@example.com');
		await main.reply('auth', {});
		await again;
		const added = client.addWithCode('418092');
		await vi.advanceTimersByTimeAsync(0);
		await main.reply('auth', {});
		await added;
		expect(approvals()).toHaveLength(1);
		expect(snapshot.signInMethods).toContain('email');
	});

	it('closes a proposal left open past its expiry, and gives up on an approval that isn’t answered', async () => {
		start();
		await latest().greet([], { auth: ['email', 'guest'] });
		const requested = client.requestEmailCode('ada@example.com');
		const side = latest();
		side.open();
		side.receive({ method: 'server', params: { apron: 10, auth: ['email', 'guest'], capabilities: [], ping: 30 } });
		await vi.advanceTimersByTimeAsync(0);
		await side.reply('auth', {});
		await requested;
		// While it waits for the code it keeps the server's liveness rule (§1).
		await vi.advanceTimersByTimeAsync(30_000);
		expect(side.sent.filter((frame) => frame.method === 'ping')).toHaveLength(1);
		const signIn = client.signInWithCode('1');
		const failed = expect(signIn).rejects.toThrow('didn’t answer');
		await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
		await failed;
		expect(snapshot.authBusy).toBe(false);
		// No answer ends the proposal: a timeout isn't a wrong code.
		expect(snapshot.signInCode).toBeUndefined();
		expect(side.readyState).toBe(FakeSocket.CLOSED);

		const again = client.requestEmailCode('ada@example.com');
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 10, auth: ['email', 'guest'], capabilities: [] } });
		await vi.advanceTimersByTimeAsync(0);
		await next.reply('auth', {});
		await again;
		await vi.advanceTimersByTimeAsync(PROPOSAL_MS);
		expect(next.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot.signInCode).toBeUndefined();
	});
});

/** Reading another server's greeting before signing in there (`greet`), for the connect screen. */
describe('greet', () => {
	beforeEach(() => {
		start();
	});

	it('reads the greeting on a connection of its own that sends nothing, closes it, and leaves this connection as it was', async () => {
		const main = latest();
		const greeted = client.greet('wss://other.test/piper');
		const side = latest();
		expect(side).not.toBe(main);
		expect(side.url).toBe('wss://other.test/piper');
		side.open();
		side.receive({ method: 'server', params: { apron: 10, auth: ['guest'], title: 'Pied Piper', unknown: true } });
		await expect(greeted).resolves.toEqual({ apron: 10, auth: ['guest'], capabilities: [], title: 'Pied Piper' });
		expect(side.sent).toEqual([]);
		expect(side.readyState).toBe(FakeSocket.CLOSED);
		expect(client.url).toBe('ws://fake.test/');
	});

	it('says an address that answers without a usable greeting isn’t an Apron server', async () => {
		const greeted = client.greet('wss://other.test/');
		const side = latest();
		side.open();
		side.receive({ hello: 'world' });
		const failed = expect(greeted).rejects.toThrow('not as an Apron server');
		await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
		await failed;
		// A greeting with no scheme to sign in with is no more use.
		const empty = client.greet('wss://other.test/');
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 10, auth: [] } });
		await expect(empty).rejects.toThrow('not as an Apron server');
	});

	it('says an address that can’t be reached, or never answers, so', async () => {
		const unreachable = client.greet('wss://down.test/');
		latest().onerror?.();
		await expect(unreachable).rejects.toThrow('Can’t reach the server');
		const silent = client.greet('wss://silent.test/');
		latest().open();
		const failed = expect(silent).rejects.toThrow('The server didn’t answer');
		await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
		await failed;
	});

	it('closes its connection when cancelled', async () => {
		const abort = new AbortController();
		const greeted = client.greet('wss://other.test/', abort.signal);
		const side = latest();
		side.open();
		abort.abort();
		await expect(greeted).rejects.toThrow('Cancelled');
		expect(side.readyState).toBe(FakeSocket.CLOSED);
	});
});
