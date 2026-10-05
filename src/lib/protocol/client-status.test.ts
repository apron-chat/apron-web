import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatClient, type ClientSnapshot } from './client';
import { FakeSocket } from './fake-socket';
import { STATUS_KEEP_MS } from './client-internals';

/** Kept statuses across reconnects (§4.11): kept after a short one, dropped after one over 60 seconds. */
describe('kept statuses across reconnects', () => {
	let client: ChatClient;
	let snapshot: ClientSnapshot;
	let socket: FakeSocket;
	/** The client's clock, apart from the timers that pace its reconnects. */
	let clock: number;

	beforeEach(() => {
		vi.useFakeTimers();
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		clock = 1_000_000;
		client = ChatClient.fromOptions({ serverUrl: 'ws://fake.test/', now: () => clock, onChange: (next) => (snapshot = next) });
		client.start();
		socket = FakeSocket.latest();
	});

	afterEach(() => {
		client.stop();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	async function greet(you: Record<string, unknown>, members: Record<string, unknown>[]): Promise<void> {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 7, auth: ['guest'], capabilities: ['rooms', 'status'] } });
		await socket.reply('auth', { you });
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General', members }] });
	}

	/** The connection drops; `offlineMs` later (by the client's clock) the next one is authenticated. */
	async function reconnectAfter(offlineMs: number, you: Record<string, unknown>, members: Record<string, unknown>[]): Promise<void> {
		socket.drop();
		clock += offlineMs;
		vi.advanceTimersByTime(5_000);
		socket = FakeSocket.latest();
		await greet(you, members);
	}

	const statusOf = (userId: string) => snapshot.users[userId]?.status;
	const members = [{ user_id: 'ada', name: 'Ada' }, { user_id: 'bo', name: 'Bo' }, { user_id: 'cy', name: 'Cy' }];

	it('keeps other users\' statuses after a reconnect of 60 seconds or less', async () => {
		await greet({ user_id: 'ada', status: 'online' }, [{ user_id: 'ada', status: 'online' }, { user_id: 'bo', status: 'idle' }, { user_id: 'cy', status: 'dnd' }]);
		await reconnectAfter(STATUS_KEEP_MS, { user_id: 'ada' }, members);
		expect([statusOf('ada'), statusOf('bo'), statusOf('cy')]).toEqual(['online', 'idle', 'dnd']);
	});

	it('drops them after a longer one, so those users have no status (not offline) until the server sends it again', async () => {
		await greet({ user_id: 'ada', status: 'online' }, [{ user_id: 'ada', status: 'online' }, { user_id: 'bo', status: 'idle' }, { user_id: 'cy', status: 'dnd' }]);
		await reconnectAfter(STATUS_KEEP_MS + 1, { user_id: 'ada', status: 'idle' }, members);
		// Your own comes from the auth's `you`.
		expect(statusOf('ada')).toBe('idle');
		expect(snapshot.users.bo).toEqual({ user_id: 'bo', name: 'Bo' });
		expect(Object.hasOwn(snapshot.users.cy, 'status')).toBe(false);
		// After `auth` the server sends connected users' statuses again (§4.11); a user who isn't connected stays unknown.
		socket.receive({ method: 'user', params: { new: { user_id: 'bo', status: 'online' } } });
		expect(statusOf('bo')).toBe('online');
		expect(statusOf('cy')).toBeUndefined();
	});

	it('times the disconnection from the drop to the next authentication, not the reconnect attempt', async () => {
		await greet({ user_id: 'ada' }, [{ user_id: 'bo', status: 'idle' }]);
		socket.drop();
		clock += 30_000;
		vi.advanceTimersByTime(5_000);
		socket = FakeSocket.latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 7, auth: ['guest'], capabilities: ['rooms', 'status'] } });
		// Authentication takes another 31 seconds: over 60 in all.
		clock += 31_000;
		await socket.reply('auth', { you: { user_id: 'ada' } });
		expect(statusOf('bo')).toBeUndefined();
	});
});

/** `server.status` (§3.1, §4.11): the optional statuses the server accepts. */
describe('server.status', () => {
	let client: ChatClient;
	let snapshot: ClientSnapshot;

	beforeEach(() => {
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		client = ChatClient.fromOptions({ serverUrl: 'ws://fake.test/', onChange: (next) => (snapshot = next) });
		client.start();
	});

	afterEach(() => {
		client.stop();
		vi.unstubAllGlobals();
	});

	it('takes the strings listed, and a replacing frame without it leaves none', () => {
		const socket = FakeSocket.latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 7, auth: ['guest'], capabilities: ['status'], status: ['dnd', 'invisible', 7] } });
		expect(snapshot.server?.status).toEqual(['dnd', 'invisible']);
		socket.receive({ method: 'server', params: { apron: 7, auth: ['guest'], capabilities: ['status'] } });
		expect(snapshot.server && Object.hasOwn(snapshot.server, 'status')).toBe(false);
		socket.receive({ method: 'server', params: { apron: 7, auth: ['guest'], capabilities: ['status'], status: 'dnd' } });
		expect(snapshot.server && Object.hasOwn(snapshot.server, 'status')).toBe(false);
	});
});
