import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { ChatClient, type ClientSnapshot } from './client';
import { EARLY_CONNECTION_MS, openEarlyConnection, resetEarlyConnection, takeEarlyConnection } from './early-connection';
import { FakeSocket, settle } from '$lib/test/client';

/**
 * The connection opened as the app starts (`early-connection.ts`, `hooks.client.ts`), before the client exists: the
 * client's first connection takes it, open or still opening, with the frames that came meanwhile; one to another
 * server, or one closed or not taken in time, is closed, and the client connects as it would have.
 */
const URL = 'ws://fake.test/';
const factory = (url: string) => new FakeSocket(url) as unknown as WebSocket;

let snapshot: ClientSnapshot;

beforeEach(() => {
	vi.useFakeTimers();
	FakeSocket.instances = [];
	vi.stubGlobal('WebSocket', FakeSocket);
	resetEarlyConnection();
});

afterEach(() => {
	resetEarlyConnection();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function startClient(url = URL): ChatClient {
	const client = new ChatClient(url, undefined, undefined, undefined, { earlyConnection: takeEarlyConnection });
	client.subscribe((next) => (snapshot = next));
	client.start();
	onTestFinished(() => client.stop());
	return client;
}

const server = { method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } };

describe('the connection opened as the app starts', () => {
	it('is the client’s first connection, open, with the server frame and a welcome that came meanwhile: it signs in at once', async () => {
		openEarlyConnection(URL, factory);
		const early = FakeSocket.latest();
		early.open();
		early.receive(server);
		early.receive({ method: 'message', params: { message_id: '1', log_id: '1', from: { user_id: '~private' }, body: { text: 'Welcome' } } });
		expect(early.sent).toEqual([]);

		startClient();
		expect(FakeSocket.instances).toEqual([early]);
		expect(snapshot.status).toBe('connected');
		expect(early.sent.map((frame) => frame.method)).toEqual(['auth', 'room_list']);
		await early.reply('auth', { you: { user_id: 'guest_1' } });
		expect(snapshot.authenticated).toBe(true);
		await early.reply('room_list', { joined: [{ room_id: 'lobby', log_id: '1', title: 'Lobby' }] });
		expect(snapshot.rooms.map((room) => room.id)).toEqual(['lobby']);
		// The welcome came before the sign-in, in order, as it would have on the client's own connection.
		expect(snapshot.rooms[0].notices.map((notice) => [notice.body?.text, notice.welcome])).toEqual([['Welcome', true]]);
	});

	it('is taken still opening, and the client goes on when it opens', async () => {
		openEarlyConnection(URL, factory);
		const early = FakeSocket.latest();
		startClient();
		expect(FakeSocket.instances).toEqual([early]);
		expect(snapshot.status).toBe('connecting');
		early.open();
		expect(snapshot.status).toBe('connected');
		early.receive(server);
		expect(early.sent.map((frame) => frame.method)).toEqual(['auth', 'room_list']);
		await early.reply('auth', { you: { user_id: 'guest_1' } });
		expect(snapshot.authenticated).toBe(true);
	});

	it('to another server is closed, and the client opens its own', () => {
		openEarlyConnection('ws://elsewhere.test/', factory);
		const early = FakeSocket.latest();
		early.open();
		startClient();
		expect(early.readyState).toBe(FakeSocket.CLOSED);
		expect(early.sent).toEqual([]);
		expect(FakeSocket.instances).toHaveLength(2);
		expect(FakeSocket.latest().url).toBe(URL);
	});

	it('closed before the client takes it, or not taken in time, leaves the client to open its own', () => {
		openEarlyConnection(URL, factory);
		FakeSocket.latest().drop();
		startClient();
		expect(FakeSocket.instances).toHaveLength(2);

		resetEarlyConnection();
		FakeSocket.instances = [];
		openEarlyConnection(URL, factory);
		const late = FakeSocket.latest();
		late.open();
		vi.advanceTimersByTime(EARLY_CONNECTION_MS);
		expect(late.readyState).toBe(FakeSocket.CLOSED);
		expect(takeEarlyConnection(URL)).toBeUndefined();
	});

	it('is only for the first connection: a reconnect opens its own, and none opens once a client has started', async () => {
		openEarlyConnection(URL, factory);
		const early = FakeSocket.latest();
		early.open();
		early.receive(server);
		startClient();
		await early.reply('auth', { you: { user_id: 'guest_1' } });
		openEarlyConnection(URL, factory);
		expect(FakeSocket.instances).toEqual([early]);
		early.drop();
		vi.advanceTimersByTime(5_000);
		expect(FakeSocket.instances).toHaveLength(2);
		const next = FakeSocket.latest();
		next.open();
		next.receive(server);
		await settle();
		expect(next.sent.map((frame) => frame.method)).toEqual(['auth', 'room_list']);
	});
});

describe('waiting on `beforeConnect` (the check for a newer deploy) before connecting', () => {
	function gatedClient(gate: () => Promise<void> | undefined): ChatClient {
		const client = new ChatClient(URL, undefined, undefined, undefined, { beforeConnect: gate });
		client.subscribe((next) => (snapshot = next));
		client.start();
		onTestFinished(() => client.stop());
		return client;
	}

	it('opens the first connection only once the wait is over, connecting meanwhile', async () => {
		let release!: () => void;
		const gate = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
		gatedClient(gate);
		expect(FakeSocket.instances).toEqual([]);
		expect(snapshot.status).toBe('connecting');
		release();
		await settle();
		expect(FakeSocket.instances).toHaveLength(1);
		// Asked once for this connection: let through, it doesn't ask again.
		expect(gate).toHaveBeenCalledTimes(1);
	});

	it('waits on a reconnect too, and never connects while the page is reloading instead', async () => {
		let waiting: Promise<void> | undefined;
		gatedClient(() => waiting);
		const first = FakeSocket.latest();
		first.open();
		first.receive(server);
		await first.reply('auth', { you: { user_id: 'guest_1' } });
		// A wait that never ends, as for a reload into a newer deploy.
		waiting = new Promise<void>(() => undefined);
		first.drop();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(FakeSocket.instances).toEqual([first]);
		expect(snapshot.status).toBe('reconnecting');
	});

	it('connects all the same when the wait fails', async () => {
		gatedClient(() => Promise.reject(new Error('check failed')));
		await settle();
		expect(FakeSocket.instances).toHaveLength(1);
	});

	it('opens nothing once stopped while waiting', async () => {
		let release!: () => void;
		const client = gatedClient(() => new Promise<void>((resolve) => (release = resolve)));
		client.stop();
		release();
		await settle();
		expect(FakeSocket.instances).toEqual([]);
	});
});
