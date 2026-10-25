import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { capabilitiesOf, canEdit, canManageRooms, canReact, defaultWebSocketUrl, hasHistory, normalizeWebSocketUrl, reconnectDelay, recoveryBufferFits, ChatClient, type ClientSnapshot } from './client';
import type { MessageRecord } from './types';
import { FakeSocket, quiet, settle, startClient } from '$lib/test/client';

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

		vi.advanceTimersByTime(5_000);
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
		vi.advanceTimersByTime(5_000);
		const next = latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: [] } });
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
		vi.advanceTimersByTime(5_000);
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
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms'] } });
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
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms'] } });
		socket.receive({ id: socket.request('auth').id, error: { code: -32001, message: 'Guests are not admitted' } });
		await settle();
		expect(socket.readyState).toBe(FakeSocket.OPEN);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(FakeSocket.instances).toHaveLength(1);
		expect(snapshot.error).toBe('Guests are not admitted');
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
		await vi.advanceTimersByTimeAsync(5000);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it('falls back to reconnecting when diagnostics are unsupported', async () => {
		fetchStatus.mockResolvedValue(new Response('Not found', { status: 404 }));
		latest().drop();
		await vi.advanceTimersByTimeAsync(5000);
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
		await vi.advanceTimersByTimeAsync(5000);
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
		first.receive({ method: 'server', params: { apron: 9, auth: ['token'], capabilities: [], ping: 30 } });
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
		first.receive({ method: 'server', params: { apron: 9, auth: ['token'], capabilities: [], ping: 30 } });
		client.restart();
		vi.advanceTimersByTime(0);
		const second = latest();
		expect(second).not.toBe(first);
		second.open();
		second.receive({ method: 'server', params: { apron: 9, auth: ['token'], capabilities: [], ping: 30 } });
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
		vi.advanceTimersByTime(5_000);
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

	it('follows a replacing server frame to its new interval, or to none where it does not ask', async () => {
		const { client } = startClient();
		await latest().greet([], { ping: 30 });
		latest().receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms'], ping: 10 } });
		vi.advanceTimersByTime(10_000);
		expect(pings(latest())).toBe(1);
		latest().receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms'] } });
		vi.advanceTimersByTime(300_000);
		expect(pings(latest())).toBe(1);
	});
});

describe('reconnect damping', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it('keeps backing off when connections close right after auth', async () => {
		// No jitter: the delays are exactly 0.5 s, 1 s, 2 s.
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const { client } = startClient();
		await latest().greet();
		// Each connection authenticates, then drops at once: the delay keeps growing.
		for (const delay of [500, 1_000, 2_000]) {
			latest().drop();
			const before = FakeSocket.instances.length;
			vi.advanceTimersByTime(delay - 1);
			expect(FakeSocket.instances).toHaveLength(before);
			vi.advanceTimersByTime(1);
			expect(FakeSocket.instances).toHaveLength(before + 1);
			await latest().greet();
		}
		// A connection that stays up resets it.
		vi.advanceTimersByTime(30_000);
		latest().drop();
		const before = FakeSocket.instances.length;
		vi.advanceTimersByTime(500);
		expect(FakeSocket.instances).toHaveLength(before + 1);
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
		expect(reconnectDelay(1, 0, 700)).toBe(700);
		expect(reconnectDelay(2, 0, 0)).toBe(800);
		expect(reconnectDelay(2, 1, 0)).toBe(1200);
		// Prolonged failures back off to roughly one attempt per minute.
		expect(reconnectDelay(1)).toBe(500);
		expect(reconnectDelay(6)).toBe(16000);
		expect(reconnectDelay(8)).toBe(60000);
		expect(reconnectDelay(100, 0)).toBe(48000);
		expect(reconnectDelay(100, 1)).toBe(72000);
		expect(reconnectDelay(100, 0, 3600000)).toBe(3600000);
	});
});

describe('capability gating', () => {
	it('derives feature flags from the latest server frame', () => {
		// Unknown capabilities are ignored.
		const server = { apron: 9, auth: ['guest'], capabilities: ['history', 'reactions', 'activity', 'command', 'frobnicate', 'ext:irc'] };
		expect(capabilitiesOf(server)).toEqual({ history: true, edit: false, rooms: false, reactions: true, activity: true, 'embed:upload': false, 'embed:stream': false, command: true, status: false, ext: false, 'ext:settings': false, 'ext:limits': false, 'ext:media': false, 'ext:permissions': false });
		expect(capabilitiesOf(undefined)).toEqual({ history: false, edit: false, rooms: false, reactions: false, activity: false, 'embed:upload': false, 'embed:stream': false, command: false, status: false, ext: false, 'ext:settings': false, 'ext:limits': false, 'ext:media': false, 'ext:permissions': false });
		expect([canEdit(server), canManageRooms(server), canReact(server), hasHistory(server)]).toEqual([false, false, true, true]);
	});
});
