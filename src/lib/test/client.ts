import { onTestFinished, vi } from 'vitest';
import { ChatClient, type ClientSnapshot, type HistoryStart } from '$lib/protocol/client';
import { FakeSocket, settle, type GreetOptions } from './fake-socket';
import { memoryStorage } from './storage';

export { FakeSocket, settle, type GreetOptions };

/**
 * Test support: a `ChatClient` on a `FakeSocket`, the way the client tests
 * start one. `startClient` installs the fake transport and starts the client;
 * `connect` also runs the greeting and `auth` (`FakeSocket.greet`). The client
 * stops by itself when the test finishes, after its `afterEach` hooks.
 *
 *     const { client, socket, snap } = await connect(['rooms', 'status']);
 *     socket.receive({ method: 'user', params: { new: { user_id: 'ada', status: 'dnd' } } });
 *     expect(snap().users.ada.status).toBe('dnd');
 */

/** The URL clients connect to unless a test names another. */
export const SERVER_URL = 'ws://fake.test/';

export interface ClientOptions {
	/** The server URL. Default `SERVER_URL`. */
	url?: string;
	/** What `localStorage` holds (see `memoryStorage`), stubbed before the client reads its stored session. */
	storage?: Map<string, string>;
	/** Called with each snapshot the client publishes, the first one included. */
	onSnapshot?: (snapshot: ClientSnapshot) => void;
	/** How a room with no checkpoint recovers. Default the client's, `newest`. */
	historyStart?: HistoryStart;
}

export interface ClientHarness {
	client: ChatClient;
	/** The socket the client opened when it started. */
	socket: FakeSocket;
	/** The snapshot the client published last. */
	snap(): ClientSnapshot;
	/** The socket the client opened last. */
	latest(): FakeSocket;
	/** The server goes away: the latest socket closes. */
	drop(): void;
	/**
	 * The connection drops and the next one opens once the backoff runs out
	 * (fake timers): returns the new socket, not yet greeted.
	 */
	reconnect(): FakeSocket;
}

/**
 * Starts a client on a fresh `FakeSocket`: earlier sockets are forgotten and
 * `WebSocket` (and `localStorage`, with `storage`) are stubbed until
 * `vi.unstubAllGlobals()`. The socket is opened but not greeted.
 */
export function startClient(options: ClientOptions = {}): ClientHarness {
	FakeSocket.instances = [];
	vi.stubGlobal('WebSocket', FakeSocket);
	if (options.storage) vi.stubGlobal('localStorage', memoryStorage(options.storage));
	const client = new ChatClient(options.url ?? SERVER_URL, undefined, undefined, undefined, options.historyStart);
	let latest: ClientSnapshot | undefined;
	client.subscribe((next) => {
		latest = next;
		options.onSnapshot?.(next);
	});
	client.start();
	onTestFinished(() => client.stop());
	return {
		client,
		socket: FakeSocket.latest(),
		snap: () => latest!,
		latest: () => FakeSocket.latest(),
		drop: () => FakeSocket.latest().drop(),
		reconnect() {
			FakeSocket.latest().drop();
			vi.advanceTimersByTime(5_000);
			return FakeSocket.latest();
		}
	};
}

/**
 * `startClient`, then the server's greeting and the `auth` result, and the
 * listing of one joined room unless `rooms: false` (see `FakeSocket.greet`).
 */
export async function connect(caps: string[] = [], options: ClientOptions & GreetOptions = {}): Promise<ClientHarness> {
	const harness = startClient(options);
	await harness.socket.greet(caps, options);
	return harness;
}

/** Lets an operation the test does not await fail quietly when the client stops. */
export function quiet(value: { promise: Promise<unknown> } | Promise<unknown> | undefined): void {
	(value && 'promise' in value ? value.promise : value)?.catch(() => undefined);
}
