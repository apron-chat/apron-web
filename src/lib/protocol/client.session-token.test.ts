import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { ChatClient, type ClientSnapshot } from './client';
import { FakeSocket, quiet, SERVER_URL, settle, startClient } from '$lib/test/client';

/**
 * The session a client keeps (§3.2): its token per server, which it resumes
 * with and replaces when the server rotates it, and the display name it asks
 * for on connect.
 */
const storage = new Map<string, string>();
const TOKEN_KEY = 'apron.session:ws://fake.test/';
let snapshot: ClientSnapshot;

beforeEach(() => {
	vi.useFakeTimers();
	storage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function latest(): FakeSocket {
	return FakeSocket.latest();
}

const auths = () => latest().sent.filter((frame) => frame.method === 'auth');

describe('persisted session tokens', () => {
	function authParams(): Record<string, unknown> {
		const auth = latest().sent.find((frame) => frame.method === 'auth');
		if (!auth) throw new Error('client did not authenticate');
		return auth.params as Record<string, unknown>;
	}

	it('stores a token the server can resume with, keyed by server URL, and presents it on the next start', async () => {
		const { client: first } = startClient({ storage, onSnapshot: (next) => (snapshot = next) });
		await latest().greet([], { auth: ['webauthn', 'token', 'guest'], token: 'session-1' });
		expect(authParams()).toEqual(expect.objectContaining({ scheme: 'guest' }));
		expect(storage.get('apron.session:ws://fake.test/')).toBe('session-1');
		first.stop();

		const { client: second } = startClient({ storage, onSnapshot: (next) => (snapshot = next) });
		await latest().greet([], { auth: ['webauthn', 'token', 'guest'], token: 'session-1' });
		expect(authParams()).toEqual(expect.objectContaining({ scheme: 'token', token: 'session-1' }));
		expect(snapshot.passkeySession).toBe(true);
		second.stop();

		// Another server URL has its own entry.
		const { client: elsewhere } = startClient({ url: 'ws://other.test/', storage });
		latest().open();
		latest().receive({ method: 'server', params: { apron: 9, auth: ['webauthn', 'token', 'guest'], capabilities: [] } });
		expect(authParams()).toEqual(expect.objectContaining({ scheme: 'guest' }));
		elsewhere.stop();
	});

	it('names the account a sign-up invite creates, with that token only', async () => {
		const { client } = startClient({ storage, onSnapshot: (next) => (snapshot = next) });
		await latest().greet([], { auth: ['token', 'guest'] });

		client.useToken('apron_join_secret', ' Ada ');
		vi.advanceTimersByTime(0);
		await latest().greet([], { auth: ['token', 'guest'], token: 'apron_invite_own', you: { user_id: 'ada_1234', name: 'Ada' } });
		expect(authParams()).toEqual(expect.objectContaining({ scheme: 'token', token: 'apron_join_secret', name: 'Ada' }));
		expect(snapshot.you).toEqual({ user_id: 'ada_1234', name: 'Ada' });

		// Resuming with the account's own token asks for no name.
		latest().drop();
		client.retryNow();
		await latest().greet([], { auth: ['token', 'guest'], you: { user_id: 'ada_1234', name: 'Ada' } });
		expect(authParams()).toEqual(expect.objectContaining({ scheme: 'token', token: 'apron_invite_own' }));
		expect(authParams()).not.toHaveProperty('name');
	});

	it('signs in with a pasted token, such as a bot token, and keeps it to resume with', async () => {
		const { client } = startClient({ storage, onSnapshot: (next) => (snapshot = next) });
		await latest().greet([], { auth: ['token', 'guest'] });
		expect(() => client.useToken('  ')).toThrow('Paste a token');

		client.useToken(' apron_bot_secret ');
		vi.advanceTimersByTime(0);
		expect(FakeSocket.instances).toHaveLength(2);
		await latest().greet([], { auth: ['token', 'guest'], you: { user_id: 'bot_foo_1234', name: 'Bot of Foo' } });
		expect(authParams()).toEqual(expect.objectContaining({ scheme: 'token', token: 'apron_bot_secret' }));
		expect(snapshot.you).toEqual({ user_id: 'bot_foo_1234', name: 'Bot of Foo' });
		expect(snapshot.readOnly).toBe(false);
		expect(storage.get('apron.session:ws://fake.test/')).toBe('apron_bot_secret');

		// A refused token is dropped, with the server's error to show.
		client.useToken('apron_bot_revoked');
		vi.advanceTimersByTime(0);
		const socket = latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['token', 'guest'], capabilities: [] } });
		expect(authParams()).toEqual(expect.objectContaining({ scheme: 'token', token: 'apron_bot_revoked' }));
		const auth = socket.sent.find((frame) => frame.method === 'auth')!;
		socket.receive({ id: auth.id, error: { code: -32001, message: 'Invalid bot token' } });
		await settle();
		expect(snapshot.error).toBe('Invalid bot token');
		expect(snapshot.authenticated).toBe(false);
		expect(storage.has('apron.session:ws://fake.test/')).toBe(false);
	});

	it('reads only as a guest where the server says guests only read (ext:settings), until a sign-in', async () => {
		const readOnly = { settings: { guest_posting: false } };
		const { client: guest } = startClient({ storage, onSnapshot: (next) => (snapshot = next) });
		await latest().greet(['ext:settings'], { auth: ['webauthn', 'token', 'guest'], ext: readOnly });
		expect(snapshot.readOnly).toBe(true);
		guest.stop();

		// A signed-in session writes; so does a guest where guests may post, where nothing is said,
		// or where the server sends settings without advertising `ext:settings`.
		const { client: signedIn } = startClient({ storage, onSnapshot: (next) => (snapshot = next) });
		await latest().greet(['ext:settings'], { auth: ['webauthn', 'token', 'guest'], ext: readOnly, token: 'session-3' });
		expect(snapshot.readOnly).toBe(false);
		signedIn.stop();
		for (const [caps, ext] of [[['ext:settings'], { settings: { guest_posting: true } }], [['ext:settings'], { settings: {} }], [['ext:settings'], undefined], [[], readOnly]] as const) {
			storage.clear();
			const { client: open } = startClient({ storage, onSnapshot: (next) => (snapshot = next) });
			await latest().greet([...caps], { ...(ext ? { ext } : {}) });
			expect(snapshot.readOnly).toBe(false);
			open.stop();
		}
	});

	it('drops a welcome sent before auth once a stored session signs in', async () => {
		storage.set('apron.session:ws://fake.test/', 'session-4');
		const { client } = startClient({ storage, onSnapshot: (next) => (snapshot = next) });
		latest().open();
		latest().receive({ method: 'server', params: { apron: 9, auth: ['webauthn', 'token', 'guest'], capabilities: ['rooms'] } });
		latest().receive({ method: 'message', params: { from: { user_id: '~private' }, body: { text: 'Guests can read along.' } } });
		const auth = latest().sent.find((frame) => frame.method === 'auth')!;
		latest().receive({ id: auth.id, result: { you: { user_id: 'u_1', name: 'Ada' }, token: 'session-4' } });
		await Promise.resolve();
		await Promise.resolve();
		const listing = latest().sent.find((frame) => frame.method === 'room_list')!;
		latest().receive({ id: listing.id, result: { joined: [{ room_id: 'general', title: 'General' }] } });
		await Promise.resolve();
		expect(snapshot.rooms.find((room) => room.id === 'general')?.notices).toEqual([]);
	});

	it('does not persist a token when the server cannot resume with it', async () => {
		startClient({ storage });
		await latest().greet([], { auth: ['webauthn', 'guest'], token: 'session-2' });
		expect(storage.has('apron.session:ws://fake.test/')).toBe(false);
	});

	it('forgets a stored token the server rejects and on sign-out', async () => {
		storage.set('apron.session:ws://fake.test/', 'stale');
		const { client } = startClient({ storage, onSnapshot: (next) => (snapshot = next) });
		latest().open();
		latest().receive({ method: 'server', params: { apron: 9, auth: ['webauthn', 'token', 'guest'], capabilities: [] } });
		const auth = latest().sent.find((frame) => frame.method === 'auth')!;
		expect(auth.params).toEqual(expect.objectContaining({ scheme: 'token', token: 'stale' }));
		latest().receive({ id: auth.id, error: { code: -32001, message: 'Session expired; sign in with your passkey' } });
		await Promise.resolve();
		await Promise.resolve();
		expect(storage.has('apron.session:ws://fake.test/')).toBe(false);
		expect(snapshot.error).toBe('Session expired; sign in with your passkey');
		expect(snapshot.authenticated).toBe(false);

		storage.set('apron.session:ws://fake.test/', 'fresh');
		const { client: again } = startClient({ storage });
		await latest().greet([], { auth: ['webauthn', 'token', 'guest'], token: 'fresh' });
		await again.signOut();
		expect(storage.has('apron.session:ws://fake.test/')).toBe(false);
		again.stop();
	});

	it('saves a token rotated in reply to a token resume, and presents the latest next time', async () => {
		storage.set(TOKEN_KEY, 'old');
		startClient({ storage, onSnapshot: (next) => (snapshot = next) });
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
});

describe('display name on connect', () => {
	/** A client that asks for `name` on connect, as the page starts one. `startClient` starts one without. */
	function startNamed(name: string): ChatClient {
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		const client = new ChatClient(SERVER_URL, name);
		client.start();
		onTestFinished(() => client.stop());
		return client;
	}

	const renames = (socket: FakeSocket) => socket.sent.filter((frame) => frame.method === 'me').length;

	it('skips a name the server already has', async () => {
		const client = startNamed('Guest');
		// greet() authenticates as { user_id: 'guest_1', name: 'Guest' }.
		await latest().greet();
		expect(renames(latest())).toBe(0);
	});

	it('does not resend a name the server denied after a reconnect', async () => {
		const client = startNamed('Dana');
		await latest().greet();
		const first = latest();
		expect(renames(first)).toBe(1);
		first.receive({ id: first.request('me').id, error: { code: -32001, message: 'Only registered users may change their name' } });
		await Promise.resolve();
		first.drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet();
		expect(latest()).not.toBe(first);
		expect(renames(latest())).toBe(0);
		// Choosing a new name sends it again; a rejected value (§1.1) isn't resent either.
		client.setDisplayName('Dee');
		expect(renames(latest())).toBe(1);
		const second = latest();
		second.receive({ id: second.request('me').id, error: { code: -32602, message: 'Names are at most 32 characters' } });
		await Promise.resolve();
		second.drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet();
		expect(latest()).not.toBe(second);
		expect(renames(latest())).toBe(0);
	});

	it('asks for the name the server kept, so a normalized one is not sent again at each reconnect', async () => {
		const client = startNamed('Dana ');
		await latest().greet();
		const first = latest();
		expect(first.request('me').params).toEqual({ name: 'Dana' });
		// The server normalizes the name it keeps (§1.1).
		await first.reply('me', { you: { user_id: 'guest_1', name: 'dana' } });
		first.drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet(undefined, { you: { user_id: 'guest_1', name: 'dana' } });
		expect(latest()).not.toBe(first);
		expect(renames(latest())).toBe(0);
		// So does a rename through the profile.
		const profile = client.updateProfile({ name: 'Dee Dee' });
		await latest().reply('me', { you: { user_id: 'guest_1', name: 'Dee' } });
		await profile;
		const second = latest();
		second.drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet(undefined, { you: { user_id: 'guest_1', name: 'Dee' } });
		expect(latest()).not.toBe(second);
		expect(renames(latest())).toBe(0);
	});

	it('renames with the me method and adopts the answered identity', async () => {
		const { client, socket } = startClient({ onSnapshot: (next) => (snapshot = next) });
		await socket.greet(['edit', 'rooms', 'reactions'], { room: { room_id: 'general', log_id: '10', title: 'General' } });
		quiet(client.setDisplayName('Ada'));
		expect(socket.request('me').params).toEqual({ name: 'Ada' });
		await socket.reply('me', { you: { user_id: 'guest_1', name: 'Ada!' } });
		expect(snapshot.you).toEqual({ user_id: 'guest_1', name: 'Ada!' });
	});
});
