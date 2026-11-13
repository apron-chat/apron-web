import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { capabilitiesOf, defaultWebSocketUrl, normalizeWebSocketUrl, sameServer, serverAddress, reconnectDelay, recoveryBufferFits, ChatClient, type ClientSnapshot } from './client';
import type { MessageRecord } from './types';
import { FakeSocket, nextSocket, quiet, settle, startClient, afterBackoff } from '$lib/test/client';

/**
 * The connection (§1, §3.1): reconnects with backoff and jitter, `retry_after`
 * and `denied`, the handshake diagnostics, liveness pings, damping on a
 * hidden page, the default server URL and capability gating.
 */
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function latest(): FakeSocket {
	return FakeSocket.latest();
}

describe('reconnects', () => {
	let client: ChatClient;
	let snapshot: ClientSnapshot;

	beforeEach(async () => {
		vi.useFakeTimers();
		({ client } = startClient({ onSnapshot: (next) => (snapshot = next) }));
		await latest().greet();
		latest().receive({
			method: 'message',
			params: { message_id: '1724803200001', log_id: '1724803200001', room_id: 'lobby', from: { user_id: 'guest_1' }, body: { text: 'hi' } }
		});
		expect(snapshot.status).toBe('connected');
		expect(snapshot.authenticated).toBe(true);
	});

	it('clears the protocol view on a drop and records when it happened', async () => {
		const dropped = Date.now();
		latest().drop();

		expect(snapshot.status).toBe('reconnecting');
		expect(snapshot.authenticated).toBe(false);
		expect(snapshot.disconnectedAt).toBe(dropped);
		// Rooms and identity are rebuilt from the next connection's room_list
		// (PROTOCOL.md §4.2.1); the UI holds its own copy meanwhile.
		expect(snapshot.rooms).toEqual([]);
		expect(snapshot.you).toBeUndefined();
		expect(snapshot.server).toBeUndefined();

		vi.advanceTimersByTime(1_000);
		expect(FakeSocket.instances).toHaveLength(2);
		// The backoff timer keeps disconnectedAt anchored to the original drop.
		expect(snapshot.disconnectedAt).toBe(dropped);

		latest().open();
		expect(snapshot.status).toBe('connected');
		expect(snapshot.authenticated).toBe(false);
		expect(snapshot.disconnectedAt).toBe(dropped);

		await latest().greet();
		expect(snapshot.status).toBe('connected');
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.disconnectedAt).toBeUndefined();
		expect(snapshot.rooms.map((room) => room.id)).toEqual(['lobby']);
		expect(snapshot.activeRoom).toBe('lobby');
	});

	it('retryNow skips the backoff and reconnects immediately', async () => {
		// The longest first delay (a quarter second), still pending at 50 ms.
		vi.spyOn(Math, 'random').mockReturnValue(1);
		onTestFinished(() => { vi.restoreAllMocks(); });
		latest().drop();
		expect(FakeSocket.instances).toHaveLength(1);
		vi.advanceTimersByTime(50);
		client.retryNow();
		expect(FakeSocket.instances).toHaveLength(2);
		expect(snapshot.disconnectedAt).toBeDefined();

		// A retry while an attempt is stuck opening drops that attempt and opens another.
		client.retryNow();
		expect(FakeSocket.instances).toHaveLength(3);
		expect(FakeSocket.instances[1].readyState).toBe(FakeSocket.CLOSED);

		await latest().greet();
		expect(snapshot.status).toBe('connected');
		expect(snapshot.disconnectedAt).toBeUndefined();
	});

	it('does not reconnect or mark a disconnect after an explicit stop', () => {
		client.stop();
		expect(snapshot.status).toBe('offline');
		expect(snapshot.disconnectedAt).toBeUndefined();
		vi.advanceTimersByTime(60_000);
		expect(FakeSocket.instances).toHaveLength(1);
	});

	it('flushes requests queued before authentication once auth succeeds', async () => {
		latest().drop();
		afterBackoff();
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: [] } });
		quiet(client.send('general', 'queued'));
		expect(next.sent.some((frame) => frame.method === 'message')).toBe(false);
		next.receive({ id: next.request('auth').id, result: { you: { user_id: 'guest_2' } } });
		await settle();
		expect(next.request('message').params).toMatchObject({ room_id: 'general', body: { text: 'queued', format: 'plain' } });
	});
});

describe('connection errors', () => {
	let client: ChatClient;
	let snapshot: ClientSnapshot;

	beforeEach(async () => {
		vi.useFakeTimers();
		({ client } = startClient({ onSnapshot: (next) => (snapshot = next) }));
		await latest().greet();
	});

	it('waits out retry_after before reconnecting', async () => {
		const pending = client.send('lobby', 'hello');
		pending.promise.catch(() => undefined);
		latest().receive({ error: { code: -32002, message: 'Server at capacity', data: { retry_after: 30 } } });
		// An error without `id` answers no request.
		expect(snapshot.pending).toHaveLength(1);
		expect(snapshot.error).toBe('Server at capacity');
		expect(snapshot.retryAfterMs).toBe(30_000);
		latest().drop();
		expect(snapshot.error).toBe('Server at capacity');
		vi.advanceTimersByTime(29_999);
		expect(FakeSocket.instances).toHaveLength(1);
		// A manual retry cannot skip the window either.
		client.retryNow();
		expect(FakeSocket.instances).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(FakeSocket.instances).toHaveLength(2);
		await latest().greet();
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.retryAfterMs).toBeUndefined();
	});

	it('does not reconnect after denied until the user retries', async () => {
		latest().receive({ error: { code: -32001, message: 'Session expired; sign in again' } });
		latest().onerror?.();
		latest().drop();
		expect(snapshot.status).toBe('reconnecting');
		expect(snapshot.error).toBe('Session expired; sign in again');
		vi.advanceTimersByTime(10 * 60_000);
		expect(FakeSocket.instances).toHaveLength(1);
		client.retryNow();
		expect(FakeSocket.instances).toHaveLength(2);
		expect(snapshot.error).toBeUndefined();
		await latest().greet();
		expect(snapshot.authenticated).toBe(true);
		// Later drops reconnect automatically again.
		latest().drop();
		afterBackoff();
		expect(FakeSocket.instances).toHaveLength(3);
	});

	it('treats a frame with a method and no id as a notification', () => {
		latest().receive({ method: 'room_update', params: { joined: [{ room_id: 'other', title: 'Other' }] }, error: { code: -32001, message: 'ignored' } });
		expect(snapshot.rooms.map((room) => room.id)).toEqual(['lobby', 'other']);
		expect(snapshot.error).toBeUndefined();
	});
});

describe('a guest sign-in refused with retry_after', () => {
	let snapshot: ClientSnapshot;

	beforeEach(() => {
		vi.useFakeTimers();
		startClient({ onSnapshot: (next) => (snapshot = next) });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('is tried again on a new connection once the wait is over, rather than staying signed in as no one', async () => {
		const socket = FakeSocket.latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		const auth = socket.request('auth');
		expect(auth.params).toEqual(expect.objectContaining({ scheme: 'guest' }));
		socket.receive({ id: auth.id, error: { code: -32002, message: 'Authentication attempts limited', data: { retry_after: 5 } } });
		await settle();
		expect(snapshot.authenticated).toBe(false);
		expect(snapshot.error).toBe('Authentication attempts limited. Try again in 5s.');
		// The client gave the connection up; the browser reports the close.
		expect(socket.readyState).toBe(FakeSocket.CLOSED);
		socket.drop();
		expect(snapshot.status).toBe('reconnecting');
		await vi.advanceTimersByTimeAsync(4_999);
		expect(FakeSocket.instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		const next = FakeSocket.latest();
		expect(next).not.toBe(socket);
		await next.greet();
		expect(next.request('auth').params).toEqual(expect.objectContaining({ scheme: 'guest' }));
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.error).toBeUndefined();
	});

	it('leaves any other refusal as it was: no reconnect loop on a server that will not have guests', async () => {
		const socket = FakeSocket.latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		socket.receive({ id: socket.request('auth').id, error: { code: -32001, message: 'Guests are not admitted' } });
		await settle();
		expect(socket.readyState).toBe(FakeSocket.OPEN);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(FakeSocket.instances).toHaveLength(1);
		expect(snapshot.error).toBe('Guests are not admitted');
	});
});

describe('a sign-in result', () => {
	it('signs in as no one whose user_id is empty or has whitespace (§2.4)', async () => {
		let snapshot!: ClientSnapshot;
		vi.useFakeTimers();
		startClient({ onSnapshot: (next) => (snapshot = next) });
		const socket = latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: [] } });
		await socket.reply('auth', { you: { user_id: ' ' } });
		expect(snapshot.authenticated).toBe(false);
		expect(snapshot.you).toBeUndefined();
		expect(snapshot.error).toBe('Server authentication response did not include an identity');
	});
});

describe('a guest sign-in that fails for the moment', () => {
	let snapshot: ClientSnapshot;

	beforeEach(() => {
		vi.useFakeTimers();
		startClient({ onSnapshot: (next) => (snapshot = next) });
	});

	it('gives up a connection whose sign-in went unanswered, and signs in on the next', async () => {
		const socket = latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		const auth = socket.request('auth');
		await vi.advanceTimersByTimeAsync(20_000);
		expect(snapshot.authenticated).toBe(false);
		expect(snapshot.error).toBe('auth request timed out');
		// Rather than sit open signed in as no one, with nothing to reconnect it.
		expect(socket.readyState).toBe(FakeSocket.CLOSED);
		// A result too late for its request changes nothing.
		socket.receive({ id: auth.id, result: { you: { user_id: 'guest_9' } } });
		await settle();
		expect(snapshot.authenticated).toBe(false);
		socket.drop();
		const next = await nextSocket(socket);
		await next.greet();
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.you?.user_id).toBe('guest_1');
	});

	it('gives up a connection whose sign-in failed on the server’s side', async () => {
		const socket = latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		socket.receive({ id: socket.request('auth').id, error: { code: -32603, message: 'Internal error' } });
		await settle();
		expect(socket.readyState).toBe(FakeSocket.CLOSED);
		socket.drop();
		await (await nextSocket(socket)).greet();
		expect(snapshot.authenticated).toBe(true);
	});
});

describe('failed handshake diagnostics', () => {
	let client: ChatClient;
	let snapshot: ClientSnapshot;
	const fetchStatus = vi.fn<typeof fetch>();

	beforeEach(() => {
		vi.useFakeTimers();
		fetchStatus.mockReset();
		vi.stubGlobal('fetch', fetchStatus);
		({ client } = startClient({ url: 'wss://server.test/ws', onSnapshot: (next) => (snapshot = next) }));
	});

	it('surfaces capacity errors and honors Retry-After, including manual retry', async () => {
		fetchStatus.mockResolvedValue(Response.json({ error: 'Daily demo capacity reached' }, {
			status: 429, headers: { 'Retry-After': '3600', 'Apron-Connection-Status': '1' }
		}));
		latest().drop();
		await vi.advanceTimersByTimeAsync(0);
		expect(String(fetchStatus.mock.calls[0][0])).toBe('https://server.test/ws?apron_connection_status=1');
		expect(fetchStatus.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
		expect(snapshot.error).toBe('Daily demo capacity reached');
		expect(snapshot.retryAfterMs).toBe(3600000);
		client.retryNow();
		await vi.advanceTimersByTimeAsync(3599999);
		expect(FakeSocket.instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it('ignores a reply without the connection status marker', async () => {
		// Such as a proxy's or a host's own 429 page, which says nothing about this chat server.
		fetchStatus.mockResolvedValue(Response.json({ error: 'Slow down' }, { status: 429, headers: { 'Retry-After': '3600' } }));
		latest().drop();
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchStatus).toHaveBeenCalledOnce();
		expect(snapshot.error).toBeUndefined();
		expect(snapshot.retryAfterMs).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1000);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it('falls back to reconnecting when diagnostics are unsupported', async () => {
		fetchStatus.mockResolvedValue(new Response('Not found', { status: 404 }));
		latest().drop();
		await vi.advanceTimersByTimeAsync(1000);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it('ignores diagnostics from a server that was replaced', async () => {
		let resolve!: (response: Response) => void;
		fetchStatus.mockReturnValue(new Promise(done => { resolve = done; }));
		latest().drop();
		client.setUrl('wss://other.test/');
		resolve(Response.json({ error: 'Old capacity error' }, { status: 429, headers: { 'Retry-After': '86400', 'Apron-Connection-Status': '1' } }));
		await vi.advanceTimersByTimeAsync(0);
		expect(latest().url).toBe('wss://other.test/');
		expect(snapshot.error).toBeUndefined();
		expect(snapshot.retryAfterMs).toBeUndefined();
	});

	it('times out an unavailable diagnostic service and resumes retries', async () => {
		fetchStatus.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
			options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
		}));
		latest().drop();
		await vi.advanceTimersByTimeAsync(4000);
		expect(FakeSocket.instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(FakeSocket.instances).toHaveLength(2);
	});
});

describe('liveness pings', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	const pings = (socket: FakeSocket) => socket.sent.filter((frame) => frame.method === 'ping').length;

	it('pings with the exact bytes every server.ping seconds, before auth too, until the socket goes', async () => {
		const { client } = startClient();
		const raw: string[] = [];
		const first = latest();
		const send = first.send.bind(first);
		first.send = (data: string) => { raw.push(data); send(data); };
		first.open();
		first.receive({ method: 'server', params: { apron: 10, auth: ['token'], capabilities: [], ping: 30 } });
		// No guest scheme and no token: the client never authenticates, and still pings (§1).
		expect(pings(first)).toBe(0);
		vi.advanceTimersByTime(30_000);
		expect(raw).toContain('{"method":"ping"}');
		expect(pings(first)).toBe(1);
		first.receive({ method: 'pong' });
		vi.advanceTimersByTime(30_000);
		expect(pings(first)).toBe(2);

		first.drop();
		vi.advanceTimersByTime(90_000);
		expect(pings(first)).toBe(2);
		client.stop();
		vi.advanceTimersByTime(90_000);
		expect(FakeSocket.instances.every((socket) => socket === first || pings(socket) === 0)).toBe(true);
	});

	it('pings on the connection a restart opens, at the same interval', () => {
		const { client } = startClient();
		const first = latest();
		first.open();
		first.receive({ method: 'server', params: { apron: 10, auth: ['token'], capabilities: [], ping: 30 } });
		client.restart();
		vi.advanceTimersByTime(0);
		const second = latest();
		expect(second).not.toBe(first);
		second.open();
		second.receive({ method: 'server', params: { apron: 10, auth: ['token'], capabilities: [], ping: 30 } });
		vi.advanceTimersByTime(30_000);
		expect(pings(second)).toBe(1);
		expect(pings(first)).toBe(0);
	});

	it('pings on the socket Try Again opens, at the same interval', () => {
		const { client } = startClient();
		onTestFinished(() => client.stop());
		const first = latest();
		first.open();
		// Stuck before signing in (no scheme to use): Try Again replaces it.
		first.receive({ method: 'server', params: { apron: 10, auth: ['token'], capabilities: [], ping: 30 } });
		client.retryNow();
		const second = latest();
		expect(second).not.toBe(first);
		second.open();
		second.receive({ method: 'server', params: { apron: 10, auth: ['token'], capabilities: [], ping: 30 } });
		vi.advanceTimersByTime(30_000);
		expect(pings(second)).toBe(1);
		expect(pings(first)).toBe(0);
	});

	it('replaces a socket whose ping goes a whole interval without a pong, and keeps one that answers', async () => {
		let snapshot: ClientSnapshot | undefined;
		const { client } = startClient({ onSnapshot: (next) => (snapshot = next) });
		await latest().greet([], { ping: 30 });
		const first = latest();
		// Answered: the connection stays.
		for (let tick = 0; tick < 4; tick++) {
			vi.advanceTimersByTime(30_000);
			first.receive({ method: 'pong' });
		}
		expect(pings(first)).toBe(4);
		expect(snapshot?.status).toBe('connected');
		expect(FakeSocket.instances).toHaveLength(1);

		// The ping at 150s goes unanswered, and the tick at 180s drops the socket.
		vi.advanceTimersByTime(30_000);
		expect(snapshot?.status).toBe('connected');
		vi.advanceTimersByTime(30_000);
		expect(snapshot?.status).toBe('reconnecting');
		expect(first.readyState).toBe(FakeSocket.CLOSED);
		vi.advanceTimersByTime(1_000);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it('probes again after its timers were frozen instead of dropping the socket', async () => {
		let snapshot: ClientSnapshot | undefined;
		const { client } = startClient({ onSnapshot: (next) => (snapshot = next) });
		await latest().greet([], { ping: 30 });
		vi.advanceTimersByTime(30_000);
		latest().receive({ method: 'pong' });
		// A frozen tab's clock jumps without its interval firing in between.
		vi.setSystemTime(Date.now() + 10 * 60_000);
		vi.advanceTimersByTime(30_000);
		expect(snapshot?.status).toBe('connected');
		expect(pings(latest())).toBe(2);
	});

	it('checks at once that the socket still answers when the page is shown again, and replaces one that doesn\u2019t', async () => {
		const listeners = new Set<() => void>();
		const page = { visibilityState: 'visible', addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
		vi.stubGlobal('document', page);
		const show = (state: 'visible' | 'hidden') => { page.visibilityState = state; for (const fn of [...listeners]) fn(); };
		let snapshot: ClientSnapshot | undefined;
		const { client } = startClient({ onSnapshot: (next) => (snapshot = next) });
		onTestFinished(() => client.stop());
		await latest().greet([], { ping: 30 });
		const first = latest();
		// A glance at another tab checks nothing.
		show('hidden');
		vi.advanceTimersByTime(5_000);
		show('visible');
		expect(pings(first)).toBe(0);
		// Away for longer: one ping now, and anything heard back keeps the socket, a pong or any other frame.
		show('hidden');
		vi.advanceTimersByTime(10_000);
		show('visible');
		expect(pings(first)).toBe(1);
		first.receive({ method: 'message', params: { message_id: '1724803200001', log_id: '1724803200001', room_id: 'lobby', from: { user_id: 'bo' }, body: { text: 'hi' } } });
		vi.advanceTimersByTime(10_000);
		expect(snapshot?.status).toBe('connected');
		expect(FakeSocket.instances).toHaveLength(1);

		// The peer vanished while the tab was away: nothing within the probe's few seconds, and it goes.
		show('hidden');
		vi.advanceTimersByTime(10_000);
		const before = pings(first);
		show('visible');
		expect(pings(first)).toBe(before + 1);
		vi.advanceTimersByTime(4_999);
		expect(snapshot?.status).toBe('connected');
		vi.advanceTimersByTime(1);
		expect(snapshot?.status).toBe('reconnecting');
		expect(first.readyState).toBe(FakeSocket.CLOSED);
		vi.advanceTimersByTime(1_000);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it('waits longer on the next probe for a while after one went unanswered, so a slow network isn\u2019t met with socket after socket', async () => {
		const listeners = new Set<() => void>();
		const page = { visibilityState: 'visible', addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
		vi.stubGlobal('document', page);
		const show = (state: 'visible' | 'hidden') => { page.visibilityState = state; for (const fn of [...listeners]) fn(); };
		const away = () => { show('hidden'); vi.advanceTimersByTime(10_000); show('visible'); };
		let snapshot: ClientSnapshot | undefined;
		const { client, socket: first } = startClient({ onSnapshot: (next) => (snapshot = next) });
		onTestFinished(() => client.stop());
		await first.greet([], { ping: 30 });

		// The first probe without an answer waits 5 s, and its socket goes: the standby opened beside it carries on.
		away();
		vi.advanceTimersByTime(5_000);
		expect(first.readyState).toBe(FakeSocket.CLOSED);
		const second = latest();
		await second.greet([], { ping: 30 });
		expect(snapshot?.authenticated).toBe(true);
		const opened = FakeSocket.instances.length;

		// Soon after, the next waits 30 s, alone for its first 5: a slow answer that comes within those opens nothing.
		away();
		vi.advanceTimersByTime(4_999);
		second.receive({ method: 'pong' });
		// (The regular ping, at 30 s, is answered too.)
		vi.advanceTimersByTime(20_000);
		second.receive({ method: 'pong' });
		expect(snapshot?.status).toBe('connected');
		expect(FakeSocket.instances).toHaveLength(opened);
		// A slower one still keeps the socket, and the standby opened at 5 s closes unused.
		away();
		vi.advanceTimersByTime(29_000);
		expect(FakeSocket.instances).toHaveLength(opened + 1);
		second.receive({ method: 'pong' });
		expect(latest().readyState).toBe(FakeSocket.CLOSED);
		vi.advanceTimersByTime(5_000);
		expect(snapshot?.status).toBe('connected');
		expect(second.readyState).toBe(FakeSocket.OPEN);
		// Still within 180 s of that replacement: no answer at all goes after the 30 s.
		away();
		vi.advanceTimersByTime(29_999);
		expect(second.readyState).toBe(FakeSocket.OPEN);
		vi.advanceTimersByTime(1);
		expect(second.readyState).toBe(FakeSocket.CLOSED);
		const third = latest();
		await third.greet([], { ping: 30 });

		// 180 s on from the last replacement (a healthy connection meanwhile), a probe waits 5 s again.
		for (let elapsed = 0; elapsed < 180_000; elapsed += 30_000) {
			vi.advanceTimersByTime(30_000);
			third.receive({ method: 'pong' });
		}
		away();
		vi.advanceTimersByTime(4_999);
		expect(third.readyState).toBe(FakeSocket.OPEN);
		vi.advanceTimersByTime(1);
		expect(third.readyState).toBe(FakeSocket.CLOSED);
	});

	it('checks the socket when the network comes back, only where the server pings', async () => {
		const listeners = new Map<string, () => void>();
		vi.stubGlobal('addEventListener', (type: string, fn: () => void) => listeners.set(type, fn));
		vi.stubGlobal('removeEventListener', (type: string) => listeners.delete(type));
		const { client, socket } = startClient();
		onTestFinished(() => client.stop());
		await socket.greet([], { ping: 30 });
		listeners.get('online')?.();
		expect(pings(socket)).toBe(1);
		client.stop();

		// A server that doesn't ask for pings may not answer one: nothing is sent.
		const { client: quiet } = startClient();
		onTestFinished(() => quiet.stop());
		await latest().greet([]);
		listeners.get('online')?.();
		vi.advanceTimersByTime(2_000);
		expect(pings(latest())).toBe(0);
		// Nor, with no probe, a standby beside it.
		expect(FakeSocket.instances).toHaveLength(1);
	});

	it('follows a replacing server frame to its new interval, or to none where it does not ask', async () => {
		const { client } = startClient();
		await latest().greet([], { ping: 30 });
		latest().receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'], ping: 10 } });
		vi.advanceTimersByTime(10_000);
		expect(pings(latest())).toBe(1);
		latest().receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		vi.advanceTimersByTime(300_000);
		expect(pings(latest())).toBe(1);
	});
});

describe('a connection that doesn’t come up', () => {
	const pings = (socket: FakeSocket) => socket.sent.filter((frame) => frame.method === 'ping').length;
	const server = (ping?: number) => ({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: [], ...(ping ? { ping } : {}) } });

	beforeEach(() => {
		vi.useFakeTimers();
		// A failed handshake asks the server why over HTTP: here nobody answers, at once.
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
	});

	function page() {
		const listeners = new Map<string, Set<() => void>>();
		const doc = {
			visibilityState: 'visible',
			addEventListener: (type: string, fn: () => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); },
			removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn)
		};
		vi.stubGlobal('document', doc);
		vi.stubGlobal('addEventListener', doc.addEventListener);
		vi.stubGlobal('removeEventListener', doc.removeEventListener);
		const fire = (type: string) => { for (const fn of [...(listeners.get(type) ?? [])]) fn(); };
		return {
			show(state: 'visible' | 'hidden') { doc.visibilityState = state; fire('visibilitychange'); },
			/** Away for `ms`, as a phone's suspended app is: its clock moves on, but none of its timers run. */
			away(ms: number) { doc.visibilityState = 'hidden'; fire('visibilitychange'); vi.setSystemTime(Date.now() + ms); doc.visibilityState = 'visible'; fire('visibilitychange'); },
			online: () => fire('online')
		};
	}

	it('gives each new socket 10 s to open and bring the server’s greeting, else replaces it, and 30 s for 3 minutes after', async () => {
		let snapshot: ClientSnapshot | undefined;
		startClient({ onSnapshot: (next) => (snapshot = next) });
		// The first connection, never opening: dropped at 10 s, as if it had failed. The standby opened beside it at
		// 2 s, still opening, carries on in its place.
		const first = latest();
		vi.advanceTimersByTime(9_999);
		expect(first.readyState).toBe(FakeSocket.CONNECTING);
		const second = latest();
		expect(FakeSocket.instances).toEqual([first, second]);
		vi.advanceTimersByTime(1);
		expect(first.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot?.status).toBe('reconnecting');
		expect(FakeSocket.instances).toHaveLength(2);
		// Soon after a socket outlasted its wait, the next has 30 s: here it opens, and the server never greets it.
		// Its own standby opens only once its usual 10 s are over.
		second.open();
		vi.advanceTimersByTime(9_999);
		expect(FakeSocket.instances).toHaveLength(2);
		vi.advanceTimersByTime(1);
		const third = latest();
		expect(FakeSocket.instances).toEqual([first, second, third]);
		vi.advanceTimersByTime(19_999);
		expect(second.readyState).toBe(FakeSocket.OPEN);
		vi.advanceTimersByTime(1);
		expect(second.readyState).toBe(FakeSocket.CLOSED);
		// One greeted in time is kept, however long it took, and the standby beside it closes unused.
		vi.advanceTimersByTime(29_000);
		const unused = latest();
		expect(FakeSocket.instances).toEqual([first, second, third, unused]);
		await third.greet([]);
		expect(snapshot?.authenticated).toBe(true);
		expect(unused.readyState).toBe(FakeSocket.CLOSED);
		// 3 minutes on, a reconnect's socket has 10 s again, and a standby at 2 s.
		vi.advanceTimersByTime(180_000);
		expect(FakeSocket.instances).toHaveLength(4);
		third.drop();
		const fourth = afterBackoff(unused);
		vi.advanceTimersByTime(1_999);
		expect(latest()).toBe(fourth);
		vi.advanceTimersByTime(1);
		expect(latest()).not.toBe(fourth);
		vi.advanceTimersByTime(7_999);
		expect(fourth.readyState).toBe(FakeSocket.CONNECTING);
		vi.advanceTimersByTime(1);
		expect(fourth.readyState).toBe(FakeSocket.CLOSED);
	});

	it('takes over with the standby as soon as it is greeted while the socket opening has yet to be, and asks the server nothing about the one it leaves', async () => {
		let snapshot: ClientSnapshot | undefined;
		startClient({ onSnapshot: (next) => (snapshot = next) });
		const fetched = vi.mocked(fetch);
		// A handshake gone nowhere (a phone just woken): nothing for 2 s, and a second socket opens beside it.
		const hung = latest();
		vi.advanceTimersByTime(2_000);
		const standby = latest();
		expect(standby).not.toBe(hung);
		expect(snapshot?.status).toBe('connecting');
		// Open alone proves nothing; its greeting does: the handshake done, it is the connection, and signs in.
		standby.open();
		expect(hung.readyState).toBe(FakeSocket.CONNECTING);
		await standby.greet([]);
		expect(hung.readyState).toBe(FakeSocket.CLOSED);
		expect(snapshot?.authenticated).toBe(true);
		expect(standby.sent.map((frame) => frame.method)).toEqual(['auth', 'room_list']);
		// No failed handshake to ask the server about, no reconnect behind it, and what the one left does is unheard.
		expect(fetched).not.toHaveBeenCalled();
		hung.open();
		hung.receive(server());
		hung.onclose?.();
		vi.advanceTimersByTime(60_000);
		expect(FakeSocket.instances).toEqual([hung, standby]);
		expect(hung.sent).toEqual([]);
		expect(snapshot?.status).toBe('connected');
	});

	it('closes the standby unused when the socket opening is greeted first, or fails first', async () => {
		let snapshot: ClientSnapshot | undefined;
		startClient({ onSnapshot: (next) => (snapshot = next) });
		// A slow handshake, done at 3 s: the standby opened at 2 s closes, having sent nothing.
		const slow = latest();
		vi.advanceTimersByTime(3_000);
		const standby = latest();
		standby.open();
		await slow.greet([]);
		expect(snapshot?.authenticated).toBe(true);
		expect(standby.readyState).toBe(FakeSocket.CLOSED);
		expect(standby.sent).toEqual([]);
		expect([standby.onopen, standby.onmessage, standby.onclose, standby.onerror]).toEqual([null, null, null, null]);
		// One greeted within 2 s opens none.
		slow.drop();
		const quick = afterBackoff(standby);
		vi.advanceTimersByTime(1_999);
		await quick.greet([]);
		vi.advanceTimersByTime(30_000);
		expect(latest()).toBe(quick);
		// A handshake that fails with a standby beside it: both go, and the usual reconnect follows the question why.
		quick.drop();
		const failing = afterBackoff(quick);
		vi.advanceTimersByTime(2_000);
		const beside = latest();
		expect(beside).not.toBe(failing);
		failing.drop();
		expect(beside.readyState).toBe(FakeSocket.CLOSED);
		expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
		expect(await nextSocket(beside)).not.toBe(beside);
	});

	it('replaces one still opening, and connects again, at once when the page comes back after its wait ran out while hidden, or the network comes back', async () => {
		const { away, online } = page();
		startClient();
		const opened = () => FakeSocket.instances.length;
		// Handshakes failing one after another: the backoff grows to about a minute.
		for (let failed = 0; failed < 8; failed++) {
			latest().drop();
			await nextSocket(latest());
		}
		// A glance away: the socket opening goes on. Hidden past its 10 s, with timers held back: on return it goes,
		// and the next opens now, not after the backoff.
		const first = latest();
		const before = opened();
		away(5_000);
		expect(first.readyState).toBe(FakeSocket.CONNECTING);
		away(5_000);
		expect(first.readyState).toBe(FakeSocket.CLOSED);
		expect(opened()).toBe(before + 1);
		// The network back: one opening was opened on the network that went, however new, and the next opens now.
		const second = latest();
		online();
		expect(second.readyState).toBe(FakeSocket.CLOSED);
		expect(opened()).toBe(before + 2);
		// So it does between attempts, and the backoff starts over: a failure now waits a moment, not a minute.
		latest().drop();
		await settle();
		online();
		expect(opened()).toBe(before + 3);
		latest().drop();
		await settle();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(opened()).toBe(before + 4);
	});

	describe('a probe', () => {
		it('opens a standby when the probed socket hasn’t answered in 2 s, and closes it unused once it does', async () => {
			const { away, online } = page();
			const { socket } = startClient();
			await socket.greet([], { ping: 30 });
			const answer = () => socket.receive({ method: 'pong' });
			// Answered within 2 s: none, however long the page was away.
			away(5 * 60_000);
			expect(pings(socket)).toBe(1);
			vi.advanceTimersByTime(1_500);
			answer();
			vi.advanceTimersByTime(5_000);
			expect(FakeSocket.instances).toHaveLength(1);
			// Not answered within 2 s: one, sending nothing, closed once the probed socket answers, which stays.
			away(10_000);
			vi.advanceTimersByTime(1_999);
			expect(FakeSocket.instances).toHaveLength(1);
			vi.advanceTimersByTime(1);
			expect(FakeSocket.instances).toHaveLength(2);
			const standby = latest();
			standby.open();
			answer();
			expect(standby.readyState).toBe(FakeSocket.CLOSED);
			expect(standby.sent).toEqual([]);
			vi.advanceTimersByTime(5_000);
			expect(socket.readyState).toBe(FakeSocket.OPEN);
			// The network back does the same.
			online();
			vi.advanceTimersByTime(2_000);
			expect(FakeSocket.instances).toHaveLength(3);
			answer();
			expect(latest().readyState).toBe(FakeSocket.CLOSED);
			expect(socket.readyState).toBe(FakeSocket.OPEN);
		});

		it('opens its standby later for a while after a socket outlasted its wait: a flaky network gets one more socket a blink, not one after another', async () => {
			const { online } = page();
			let snapshot: ClientSnapshot | undefined;
			const { socket } = startClient({ onSnapshot: (next) => (snapshot = next) });
			await socket.greet([], { ping: 30 });
			// The network blinks: the probe goes unanswered, and its standby, still opening, takes over: no other opens.
			online();
			vi.advanceTimersByTime(2_000);
			const second = latest();
			vi.advanceTimersByTime(3_000);
			expect(socket.readyState).toBe(FakeSocket.CLOSED);
			expect(FakeSocket.instances).toHaveLength(2);
			await second.greet([], { ping: 30 });
			expect(snapshot?.authenticated).toBe(true);
			// It blinks again, and again, within 3 minutes: each probe waits on its own socket, patiently. One answered
			// within the usual 5 s opens nothing; a slower one gets a standby at 5 s, which closes unused at the answer.
			for (let blink = 0; blink < 4; blink++) {
				online();
				vi.advanceTimersByTime(4_000);
				second.receive({ method: 'pong' });
				vi.advanceTimersByTime(26_000);
				second.receive({ method: 'pong' });
			}
			expect(FakeSocket.instances).toHaveLength(2);
			online();
			vi.advanceTimersByTime(4_999);
			expect(FakeSocket.instances).toHaveLength(2);
			vi.advanceTimersByTime(1);
			expect(FakeSocket.instances).toHaveLength(3);
			vi.advanceTimersByTime(15_000);
			second.receive({ method: 'pong' });
			expect(latest().readyState).toBe(FakeSocket.CLOSED);
			expect(second.readyState).toBe(FakeSocket.OPEN);
			vi.advanceTimersByTime(30_000);
			expect(FakeSocket.instances).toHaveLength(3);
		});

		it('takes the standby over once its greeting comes before the probed socket answers, and keeps the two apart: the standby changes nothing before, the probed socket nothing after', async () => {
			const { away } = page();
			let snapshot: ClientSnapshot | undefined;
			const { socket } = startClient({ onSnapshot: (next) => (snapshot = next) });
			await socket.greet(['rooms'], { ping: 30 });
			const before = snapshot!;
			away(5 * 60_000);
			vi.advanceTimersByTime(2_000);
			const standby = latest();
			// What the standby hears before it takes over (anything but a first frame would be a server's mistake) is
			// only kept, not read.
			standby.open();
			expect(snapshot?.status).toBe('connected');
			expect(snapshot?.server).toEqual(before.server);
			expect(snapshot?.rooms.map((room) => room.id)).toEqual(['lobby']);

			// Anything but its greeting proves nothing: the probed socket stays.
			standby.receive({ error: { code: -32002, message: 'Busy' } });
			expect(socket.readyState).toBe(FakeSocket.OPEN);
			// Its greeting: it takes over. The probed socket, closed, answers late, and its close comes late: neither is heard.
			const sentBefore = socket.sent.length;
			standby.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'], ping: 30, title: 'Standby' } });
			socket.receive({ method: 'pong' });
			socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: [], title: 'Old' } });
			socket.onclose?.();
			expect(snapshot?.server?.title).toBe('Standby');
			expect(snapshot?.status).toBe('connected');
			expect(standby.sent.map((frame) => frame.method)).toEqual(['auth', 'room_list']);
			expect(socket.sent).toHaveLength(sentBefore);
			await standby.reply('auth', { you: { user_id: 'guest_1' } });
			await standby.reply('room_list', { joined: [{ room_id: 'lobby', title: 'Lobby' }] });
			expect(snapshot?.authenticated).toBe(true);
			expect(snapshot?.rooms.map((room) => room.id)).toEqual(['lobby']);
			// One connection: no reconnect waiting behind it, and the standby's opening watch over.
			vi.advanceTimersByTime(30_000);
			standby.receive({ method: 'pong' });
			vi.advanceTimersByTime(30_000);
			standby.receive({ method: 'pong' });
			expect(FakeSocket.instances).toHaveLength(2);
			expect(standby.readyState).toBe(FakeSocket.OPEN);
		});

		it('drops a standby waiting to open, or opening, when the probed connection ends another way, or the page is hidden again', async () => {
			const { away, show } = page();
			const { client, socket } = startClient();
			await socket.greet([], { ping: 30 });
			// Closed by the server before the 2 s are out: no standby, and the usual reconnect.
			away(5 * 60_000);
			socket.drop();
			const next = await nextSocket(socket);
			await next.greet([], { ping: 30 });
			vi.advanceTimersByTime(2_000);
			expect(FakeSocket.latest()).toBe(next);
			next.receive({ method: 'pong' });
			// Try Again with a standby opening: it closes, and the new connection is Try Again's.
			away(5 * 60_000);
			vi.advanceTimersByTime(2_000);
			const standby = latest();
			client.retryNow();
			expect(standby.readyState).toBe(FakeSocket.CLOSED);
			expect(latest()).not.toBe(standby);
			// Closed with its handlers gone: nothing it does after reaches the client.
			expect([standby.onopen, standby.onmessage, standby.onclose, standby.onerror]).toEqual([null, null, null, null]);
			const third = latest();
			await third.greet([], { ping: 30 });
			// Hidden again before the probe runs out: the standby isn't taken, and the reconnect waits to be shown.
			away(5 * 60_000);
			vi.advanceTimersByTime(2_000);
			const unseen = latest();
			show('hidden');
			vi.advanceTimersByTime(3_000);
			expect(third.readyState).toBe(FakeSocket.CLOSED);
			expect(unseen.readyState).toBe(FakeSocket.CLOSED);
			vi.advanceTimersByTime(60_000);
			expect(latest()).toBe(unseen);
		});

		it('opens none, and takes none, while the server holds reconnecting or asked for a wait', async () => {
			const { away } = page();
			let snapshot: ClientSnapshot | undefined;
			const { socket } = startClient({ onSnapshot: (next) => (snapshot = next) });
			await socket.greet([], { ping: 30 });
			// Denied, for 10 minutes, and the socket left open (§1.1).
			socket.receive({ error: { code: -32001, message: 'Denied', data: { retry_after: 600 } } });
			away(5 * 60_000);
			vi.advanceTimersByTime(5_000);
			expect(socket.readyState).toBe(FakeSocket.CLOSED);
			vi.advanceTimersByTime(60_000);
			expect(FakeSocket.instances).toHaveLength(1);
			expect(snapshot?.held).toBe(true);
		});

	});
});

describe('reconnect damping', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('keeps backing off when connections close right after auth', async () => {
		// Jitter at its middle: the first comes within a quarter second (125 ms here), then exactly 1 s, 2 s.
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const { client } = startClient();
		await latest().greet();
		// Each connection authenticates, then drops at once: the delay keeps growing.
		for (const delay of [125, 1_000, 2_000]) {
			latest().drop();
			const before = FakeSocket.instances.length;
			vi.advanceTimersByTime(delay - 1);
			expect(FakeSocket.instances).toHaveLength(before);
			vi.advanceTimersByTime(1);
			expect(FakeSocket.instances).toHaveLength(before + 1);
			await latest().greet();
		}
		// A connection that stays up resets it: the next drop comes back within a quarter second again.
		vi.advanceTimersByTime(30_000);
		latest().drop();
		const before = FakeSocket.instances.length;
		vi.advanceTimersByTime(125);
		expect(FakeSocket.instances).toHaveLength(before + 1);
		vi.restoreAllMocks();
	});

	it('starts the backoff over for a connection that stayed up by the clock, though its timers never ran', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		startClient();
		await latest().greet();
		// A phone's short visits: signed in, a glance, and the page frozen in the background before its half minute is
		// up. Its socket is gone by the time it is back, each time: no visit is a failure for the next to back off from.
		for (let visit = 0; visit < 4; visit++) {
			vi.advanceTimersByTime(10_000);
			// A frozen page's clock jumps without its timers firing in between.
			vi.setSystemTime(Date.now() + 10 * 60_000);
			latest().drop();
			const before = FakeSocket.instances.length;
			vi.advanceTimersByTime(125);
			expect(FakeSocket.instances).toHaveLength(before + 1);
			await latest().greet();
		}
		vi.restoreAllMocks();
	});

	it('waits for the page to be shown before connecting again', async () => {
		const listeners = new Map<string, () => void>();
		const page = { visibilityState: 'visible', addEventListener: (type: string, fn: () => void) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) };
		vi.stubGlobal('document', page);
		const { client } = startClient();
		await latest().greet();
		page.visibilityState = 'hidden';
		latest().drop();
		vi.advanceTimersByTime(120_000);
		expect(FakeSocket.instances).toHaveLength(1);
		page.visibilityState = 'visible';
		listeners.get('visibilitychange')?.();
		expect(FakeSocket.instances).toHaveLength(2);
		expect(listeners.has('visibilitychange')).toBe(false);
	});

	/** A page to show and hide, with every listener of each event called, as a document does. */
	function fakePage() {
		const listeners = new Map<string, Set<() => void>>();
		const page = {
			visibilityState: 'visible',
			addEventListener: (type: string, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
			removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
			set(state: 'visible' | 'hidden') {
				page.visibilityState = state;
				for (const fn of [...(listeners.get('visibilitychange') ?? [])]) fn();
			}
		};
		vi.stubGlobal('document', page);
		return page;
	}

	/** The browser's network, to take offline and back. */
	function fakeNetwork() {
		const listeners = new Map<string, Set<() => void>>();
		const network = { onLine: true };
		vi.stubGlobal('navigator', network);
		vi.stubGlobal('addEventListener', (type: string, fn: () => void) => (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn));
		vi.stubGlobal('removeEventListener', (type: string, fn: () => void) => listeners.get(type)?.delete(fn));
		return {
			set(onLine: boolean) {
				network.onLine = onLine;
				for (const fn of [...(listeners.get(onLine ? 'online' : 'offline') ?? [])]) fn();
			}
		};
	}

	it('counts a reconnect as trying only while the page is shown: from the drop, else from its return', async () => {
		const page = fakePage();
		let snapshot!: ClientSnapshot;
		const { client } = startClient({ onSnapshot: (next) => (snapshot = next) });
		onTestFinished(() => client.stop());
		await latest().greet();
		expect(snapshot.retryingSince).toBeUndefined();

		// A drop while the page is shown starts trying at once.
		const dropped = Date.now();
		latest().drop();
		expect(snapshot.retryingSince).toBe(dropped);
		vi.advanceTimersByTime(1_000);
		expect(snapshot.retryingSince).toBe(dropped);
		await latest().greet();
		expect(snapshot.retryingSince).toBeUndefined();

		// One while it's hidden waits, and that isn't trying: it starts when the page is shown again.
		page.set('hidden');
		latest().drop();
		expect(snapshot.disconnectedAt).toBeDefined();
		expect(snapshot.retryingSince).toBeUndefined();
		vi.advanceTimersByTime(120_000);
		expect(snapshot.retryingSince).toBeUndefined();
		page.set('visible');
		expect(snapshot.retryingSince).toBe(Date.now());
		expect(snapshot.disconnectedAt).toBeLessThan(snapshot.retryingSince!);

		// Hidden again mid-reconnect: it stops counting at once.
		latest().open();
		page.set('hidden');
		expect(snapshot.retryingSince).toBeUndefined();
		latest().drop();
		vi.advanceTimersByTime(5_000);
		expect(snapshot.retryingSince).toBeUndefined();

		// Try Again starts the count over.
		page.set('visible');
		vi.advanceTimersByTime(1_000);
		client.retryNow();
		expect(snapshot.retryingSince).toBe(Date.now());
	});

	it('starts counting when the page is shown during a backoff, even if the network then keeps it waiting', async () => {
		const page = fakePage();
		const network = fakeNetwork();
		let snapshot!: ClientSnapshot;
		const { client } = startClient({ onSnapshot: (next) => (snapshot = next) });
		onTestFinished(() => client.stop());
		await latest().greet();
		page.set('hidden');
		latest().drop();
		expect(snapshot.retryingSince).toBeUndefined();
		// Shown before the backoff fires, which then finds the browser offline and waits for it.
		network.set(false);
		page.set('visible');
		const shown = Date.now();
		expect(snapshot.retryingSince).toBe(shown);
		vi.advanceTimersByTime(600_000);
		expect(FakeSocket.instances).toHaveLength(1);
		expect(snapshot.retryingSince).toBe(shown);
		network.set(true);
		expect(FakeSocket.instances).toHaveLength(2);
		expect(snapshot.retryingSince).toBe(shown);
	});

	it('counts a reconnect that waits for the network while the page is shown, and stops while it is hidden', async () => {
		const page = fakePage();
		const network = fakeNetwork();
		let snapshot!: ClientSnapshot;
		const { client } = startClient({ onSnapshot: (next) => (snapshot = next) });
		onTestFinished(() => client.stop());
		await latest().greet();
		network.set(false);
		const dropped = Date.now();
		latest().drop();
		vi.advanceTimersByTime(60_000);
		expect(FakeSocket.instances).toHaveLength(1);
		expect(snapshot.retryingSince).toBe(dropped);
		page.set('hidden');
		expect(snapshot.retryingSince).toBeUndefined();
		vi.advanceTimersByTime(60_000);
		page.set('visible');
		expect(snapshot.retryingSince).toBe(Date.now());
		network.set(true);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it('does not open a first connection from a hidden page until it is shown', () => {
		const listeners = new Map<string, () => void>();
		vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: (type: string, fn: () => void) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) });
		// Not `startClient`, which takes the socket the client opens at once.
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		const client = new ChatClient('ws://fake.test/');
		client.start();
		onTestFinished(() => client.stop());
		expect(FakeSocket.instances).toHaveLength(0);
		(globalThis.document as unknown as { visibilityState: string }).visibilityState = 'visible';
		listeners.get('visibilitychange')?.();
		expect(FakeSocket.instances).toHaveLength(1);
	});
});

describe('default server URL', () => {
	afterEach(() => vi.unstubAllEnvs());
	const location = new URL('https://web.apron.chat/') as unknown as Location;

	it('uses the configured backend while preserving an explicit server choice, else same-origin and local defaults', () => {
		vi.stubEnv('VITE_DEFAULT_SERVER_URL', 'wss://server.apron.chat/');
		expect(defaultWebSocketUrl(location)).toBe('wss://server.apron.chat/');
		expect(normalizeWebSocketUrl('', location)).toBe('wss://server.apron.chat/');
		expect(normalizeWebSocketUrl('https://other.example', location)).toBe('wss://other.example/');
		// Without deployment configuration.
		vi.stubEnv('VITE_DEFAULT_SERVER_URL', '');
		expect(defaultWebSocketUrl(location)).toBe('wss://web.apron.chat/ws');
		expect(defaultWebSocketUrl(new URL('http://localhost:5173') as unknown as Location)).toBe('ws://localhost:5173/ws');
		expect(defaultWebSocketUrl()).toBe('ws://localhost:8080/ws');
	});

	it('preserves root URLs and explicit paths rather than appending a socket path', () => {
		for (const input of ['wss://server.apron.chat', 'wss://server.apron.chat/', 'https://server.apron.chat']) {
			expect(normalizeWebSocketUrl(input, location)).toBe('wss://server.apron.chat/');
		}
		expect(normalizeWebSocketUrl('localhost:8080')).toBe('ws://localhost:8080/');
		expect(normalizeWebSocketUrl('wss://other.example/ws?room=general')).toBe('wss://other.example/ws?room=general');
		expect(normalizeWebSocketUrl('/', location)).toBe('wss://web.apron.chat/');
	});
});

describe('server address (§1)', () => {
	it('normalizes by RFC 3986 §6.2.2 and §6.2.3: case, default port, empty path, percent-encoding, dot segments', () => {
		expect(serverAddress('WSS://Chat.Example:443')).toBe('wss://chat.example/');
		expect(serverAddress('ws://chat.example:80/ws')).toBe('ws://chat.example/ws');
		expect(serverAddress('wss://chat.example:8443/ws')).toBe('wss://chat.example:8443/ws');
		expect(serverAddress('wss://chat.example/%7eada/%2f/a%2Fb')).toBe('wss://chat.example/~ada/%2F/a%2Fb');
		expect(serverAddress('wss://chat.example/a/./b/../ws?x=%61%3d')).toBe('wss://chat.example/a/ws?x=a%3D');
		expect(normalizeWebSocketUrl('HTTPS://Chat.Example:443')).toBe('wss://chat.example/');
		expect(() => serverAddress('not a url')).toThrow();
	});

	it('drops a fragment, which a WebSocket URL can\'t carry: the address connects, and is the same server', () => {
		expect(serverAddress('wss://chat.example/ws?x=%41#frag')).toBe('wss://chat.example/ws?x=A');
		expect(serverAddress('wss://chat.example/ws#')).toBe('wss://chat.example/ws');
		expect(normalizeWebSocketUrl('wss://chat.example/ws#team')).toBe('wss://chat.example/ws');
		expect(normalizeWebSocketUrl('https://chat.example#team')).toBe('wss://chat.example/');
		expect(normalizeWebSocketUrl('chat.example/ws#team')).toBe('ws://chat.example/ws');
		expect(sameServer('wss://chat.example/ws#team', 'wss://chat.example/ws')).toBe(true);
		// What new WebSocket() takes: no fragment left to throw on.
		expect(new URL(normalizeWebSocketUrl('wss://x.example/ws#f')).hash).toBe('');
	});

	it('tells servers apart by address only: ws: and wss: are two', () => {
		expect(sameServer('wss://chat.example', 'WSS://CHAT.example:443/')).toBe(true);
		expect(sameServer('ws://chat.example/', 'wss://chat.example/')).toBe(false);
		expect(sameServer('wss://chat.example/ws', 'wss://chat.example/')).toBe(false);
		expect(sameServer(undefined, 'wss://chat.example/')).toBe(false);
	});
});

describe('recovery and reconnect policies', () => {
	const transition: MessageRecord = {
		message_id: '1724803200001', log_id: '1724803200001', room_id: 'general', from: { user_id: 'alice' }, body: { text: 'live' }
	};

	it('rejects a recovery buffer at either configured bound', () => {
		expect(recoveryBufferFits(999, 0, transition, 1000, 1_000_000)).toBe(true);
		expect(recoveryBufferFits(1000, 0, transition, 1000, 1_000_000)).toBe(false);
		expect(recoveryBufferFits(0, 999, transition, 1000, 1000)).toBe(false);
	});

	it('adds jitter while honoring a server retry delay, and backs off prolonged failures to roughly one attempt per minute', () => {
		// A server's retry delay is the least it waits, however early the attempt.
		expect(reconnectDelay(1, 0, 700)).toBeGreaterThanOrEqual(700);
		expect(reconnectDelay(100, 0, 3600000)).toBeGreaterThanOrEqual(3600000);
		// The first, after a connection that stayed up, goes within a quarter second, spread so a server's
		// clients don't all come back at once.
		expect(reconnectDelay(1, 0)).toBeLessThan(reconnectDelay(1, 1));
		expect(reconnectDelay(1, 1)).toBeLessThanOrEqual(250);
		// Each failure waits longer, up to roughly one attempt per minute, jittered either side.
		for (let attempt = 2; attempt < 8; attempt++) expect(reconnectDelay(attempt + 1), `attempt ${attempt + 1}`).toBeGreaterThan(reconnectDelay(attempt));
		expect(reconnectDelay(100, 0)).toBeGreaterThanOrEqual(45_000);
		expect(reconnectDelay(100, 1)).toBeLessThanOrEqual(75_000);
	});
});

describe('capability gating', () => {
	it('derives feature flags from the latest server frame', () => {
		// Unknown capabilities are ignored.
		const server = { apron: 10, auth: ['guest'], capabilities: ['history', 'reactions', 'activity', 'command', 'frobnicate', 'ext:irc'] };
		const flags = capabilitiesOf(server);
		expect(flags).toMatchObject({ history: true, reactions: true, activity: true, command: true, edit: false, rooms: false, ext: false });
		expect(flags).not.toHaveProperty('frobnicate');
		// No server yet: nothing is on.
		expect(Object.values(capabilitiesOf(undefined)).every((on) => on === false)).toBe(true);
	});
});
