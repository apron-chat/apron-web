import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENING_MS, STABLE_CONNECTION_MS } from './client-internals';
import { Transport, type TransportHooks } from './transport';
import { FakeSocket } from '$lib/test/fake-socket';

/**
 * The transport on its own (`ChatClient`'s connection tests cover it through the client): what it tells its
 * hooks as sockets open, greet, go quiet and close, and how it reconnects.
 */
const URL = 'ws://fake.test/';
const SERVER_FRAME = { method: 'server', params: { apron: 10, auth: ['guest'], capabilities: [] } };

interface Harness {
	transport: Transport;
	/** Each hook call, in order, by name. */
	calls: string[];
	/** The hooks' answers, changed by a test: whether reconnecting is held, the server's wait, its ping interval. */
	state: { held: boolean; retryAfter?: number; ping?: number };
	frames: unknown[];
}

function harness(): Harness {
	const calls: string[] = [];
	const frames: unknown[] = [];
	const state: Harness['state'] = { held: false };
	const hooks: TransportHooks = {
		url: () => URL,
		held: () => state.held,
		retryAfter: () => state.retryAfter,
		ping: () => state.ping,
		connecting: (reconnecting) => calls.push(reconnecting ? 'reconnecting' : 'connecting'),
		opened: () => calls.push('opened'),
		frame: (data) => {
			calls.push('frame');
			frames.push(JSON.parse(data as string));
		},
		errored: (current) => calls.push(current ? 'errored' : 'errored elsewhere'),
		closed: () => {
			calls.push('closed');
			// As the client's does: the connection ends.
			transport.drop();
		},
		failed: (message) => calls.push(`failed: ${message}`),
		refused: (message) => calls.push(`refused: ${message}`),
		visibilityChanged: () => calls.push('visibility'),
		emit: () => calls.push('emit')
	};
	const transport = new Transport(hooks, (url) => new FakeSocket(url) as unknown as WebSocket, () => Date.now());
	return { transport, calls, state, frames };
}

function latest(): FakeSocket {
	return FakeSocket.latest();
}

beforeEach(() => {
	FakeSocket.instances = [];
	vi.stubGlobal('WebSocket', FakeSocket);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('Transport', () => {
	it('opens a socket, passes its frames on, and reconnects after the backoff once it closes', () => {
		const { transport, calls, frames } = harness();
		transport.run();
		transport.connect();
		expect(FakeSocket.instances).toHaveLength(1);
		expect(transport.socket).toBe(latest());
		latest().open();
		latest().receive(SERVER_FRAME);
		expect(frames).toEqual([SERVER_FRAME]);
		expect(calls).toEqual(['connecting', 'opened', 'frame']);

		const first = transport.id;
		latest().drop();
		expect(calls.slice(-2)).toEqual(['closed', 'emit']);
		expect(transport.socket).toBeUndefined();
		expect(transport.retrying).toBe(true);
		vi.advanceTimersByTime(5_000);
		expect(FakeSocket.instances).toHaveLength(2);
		expect(transport.id).toBe(first + 1);
		expect(calls.at(-1)).toBe('reconnecting');
		transport.stop();
	});

	it('reconnects on its own only while reconnecting is not held', () => {
		const { transport, state } = harness();
		transport.run();
		transport.connect();
		latest().open();
		state.held = true;
		latest().drop();
		vi.advanceTimersByTime(60_000);
		expect(FakeSocket.instances).toHaveLength(1);
		// Asked for, it connects at once whatever the hold.
		transport.retryNow();
		expect(FakeSocket.instances).toHaveLength(2);
		expect(transport.retrying).toBe(false);
		transport.stop();
	});

	it('replaces a socket that brings no `server` frame within OPENING_MS', () => {
		const { transport, calls } = harness();
		transport.run();
		transport.connect();
		latest().open();
		vi.advanceTimersByTime(OPENING_MS - 1);
		expect(calls).not.toContain('closed');
		vi.advanceTimersByTime(1);
		expect(calls).toContain('closed');
		transport.stop();
	});

	it('pings once greeted, and drops the socket when a ping goes a whole interval unanswered', () => {
		const { transport, calls, state } = harness();
		state.ping = 10;
		transport.run();
		transport.connect();
		latest().open();
		transport.greeted(true);
		vi.advanceTimersByTime(10_000);
		expect(latest().sent).toEqual([{ method: 'ping' }]);
		transport.pong();
		vi.advanceTimersByTime(10_000);
		expect(latest().sent).toHaveLength(2);
		expect(calls).not.toContain('closed');
		vi.advanceTimersByTime(10_000);
		expect(calls).toContain('closed');
		transport.stop();
	});

	it('lets go of a dropped socket: nothing it does reaches the hooks', () => {
		const { transport, calls } = harness();
		transport.run();
		transport.connect();
		const socket = latest();
		expect(transport.drop()).toBe(socket);
		const before = calls.length;
		socket.open();
		socket.receive(SERVER_FRAME);
		socket.drop();
		expect(calls.slice(before)).toEqual([]);
		transport.stop();
	});

	it('starts the backoff over once a signed-in connection stays up', () => {
		const { transport } = harness();
		transport.run();
		transport.connect();
		latest().open();
		latest().drop();
		vi.advanceTimersByTime(5_000);
		expect(transport.retrying).toBe(true);
		latest().open();
		transport.greeted(false);
		transport.stayUp(() => true);
		vi.advanceTimersByTime(STABLE_CONNECTION_MS);
		expect(transport.retrying).toBe(false);
		transport.stop();
	});

	it('adopts a socket signed in elsewhere as the next connection, with no reconnect due', () => {
		const { transport, calls } = harness();
		transport.run();
		transport.connect();
		latest().open();
		latest().drop();
		const elsewhere = new FakeSocket(URL);
		elsewhere.readyState = FakeSocket.OPEN;
		const id = transport.adopt(elsewhere as unknown as WebSocket);
		// Its `server` frame came on the other connection, and the client takes it in.
		transport.greeted(false);
		expect(transport.id).toBe(id);
		expect(transport.socket).toBe(elsewhere);
		expect(transport.retrying).toBe(false);
		vi.advanceTimersByTime(60_000);
		expect(FakeSocket.instances).toHaveLength(2);
		elsewhere.receive(SERVER_FRAME);
		expect(calls.at(-1)).toBe('frame');
		transport.stop();
	});

	it('waits for a hidden page to be shown before connecting', () => {
		const listeners = new Set<() => void>();
		const page = { visibilityState: 'hidden', addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
		vi.stubGlobal('document', page);
		const { transport, calls } = harness();
		transport.run();
		transport.connect();
		expect(FakeSocket.instances).toHaveLength(0);
		page.visibilityState = 'visible';
		for (const fn of [...listeners]) fn();
		expect(FakeSocket.instances).toHaveLength(1);
		expect(calls).toEqual(['visibility', 'connecting']);
		transport.stop();
	});
});
