import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatClient, type ClientSnapshot } from './client';
import { FakeSocket } from './fake-socket';

/**
 * Kept statuses across sign-ins (§4.5): dropped at each one, however short
 * the reconnect, and taken again from what the server sends, `room_list` and
 * `room_update` included. Resuming as the same user, the dropped ones still
 * show until the joined listing arrives, so nothing greys out meanwhile.
 */
describe('kept statuses and sign-ins', () => {
	let client: ChatClient;
	let snapshot: ClientSnapshot;
	let socket: FakeSocket;

	beforeEach(() => {
		vi.useFakeTimers();
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		client = ChatClient.fromOptions({ serverUrl: 'ws://fake.test/', onChange: (next) => (snapshot = next) });
		client.start();
		socket = FakeSocket.latest();
	});

	afterEach(() => {
		client.stop();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	function hello(): void {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms', 'status'] } });
	}

	async function greet(you: Record<string, unknown>, members: Record<string, unknown>[]): Promise<void> {
		hello();
		await socket.reply('auth', { you });
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General', members }] });
	}

	/** The connection drops, and the next one opens a moment later. */
	function reconnect(): void {
		socket.drop();
		vi.advanceTimersByTime(5_000);
		socket = FakeSocket.latest();
	}

	const statusOf = (userId: string) => snapshot.users[userId]?.status;
	const seen = [{ user_id: 'ada', status: 'online' }, { user_id: 'bo', status: 'idle' }, { user_id: 'cy', status: 'dnd' }];

	it('keeps other users\' statuses through a lost connection, until the next sign-in', async () => {
		await greet({ user_id: 'ada', status: 'online' }, seen);
		socket.drop();
		expect([statusOf('ada'), statusOf('bo'), statusOf('cy')]).toEqual(['online', 'idle', 'dnd']);
	});

	it('drops them at each sign-in; resuming, they still show until the joined listing, then those not sent again have no status', async () => {
		await greet({ user_id: 'ada', status: 'online' }, seen);
		reconnect();
		hello();
		await socket.reply('auth', { you: { user_id: 'ada', status: 'dnd' } });
		// Your own comes from the auth's `you`; the others' from before still show.
		expect(statusOf('ada')).toBe('dnd');
		expect([statusOf('bo'), statusOf('cy')]).toEqual(['idle', 'dnd']);
		// After the result the server sends connected users' statuses again (§4.5), which show at once.
		socket.receive({ method: 'user', params: { new: { user_id: 'bo', status: 'online' } } });
		expect([statusOf('bo'), statusOf('cy')]).toEqual(['online', 'dnd']);
		// Once the listing is in, a status the server didn't send again is no longer known: not offline.
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General', members: [{ user_id: 'ada' }, { user_id: 'bo' }, { user_id: 'cy' }] }] });
		expect(statusOf('bo')).toBe('online');
		expect(snapshot.users.cy).toEqual({ user_id: 'cy' });
	});

	it('drops them at once at a sign-in as someone else after a lost connection', async () => {
		await greet({ user_id: 'ada', status: 'online' }, seen);
		reconnect();
		hello();
		await socket.reply('auth', { you: { user_id: 'eve' } });
		expect([statusOf('bo'), statusOf('cy')]).toEqual([undefined, undefined]);
	});

	it('keeps offline and no status through a resume that sends nothing of them, which is what that silence means', async () => {
		await greet({ user_id: 'ada', status: 'online' }, [{ user_id: 'bo', status: 'offline' }, { user_id: 'cy', status: '' }, { user_id: 'di', status: 'online' }]);
		reconnect();
		hello();
		await socket.reply('auth', { you: { user_id: 'ada' } });
		// A resume's listing may hold only rooms that changed (§4.3.1): here, none.
		await socket.reply('room_list', { joined: [] });
		expect([statusOf('bo'), statusOf('cy'), statusOf('di')]).toEqual(['offline', '', undefined]);
	});

	it('holds them again when the connection drops before the resume\'s listing', async () => {
		await greet({ user_id: 'ada', status: 'online' }, seen);
		reconnect();
		hello();
		await socket.reply('auth', { you: { user_id: 'ada' } });
		reconnect();
		expect([statusOf('bo'), statusOf('cy')]).toEqual(['idle', 'dnd']);
		hello();
		await socket.reply('auth', { you: { user_id: 'ada' } });
		expect([statusOf('bo'), statusOf('cy')]).toEqual(['idle', 'dnd']);
	});

	it('applies the statuses room_list and room_update carry, offline and none included', async () => {
		await greet({ user_id: 'ada', status: 'online' }, [
			{ user_id: 'ada', status: 'online' }, { user_id: 'bo', status: 'offline' }, { user_id: 'cy', status: '' }, { user_id: 'di', status: 'idle' }
		]);
		expect([statusOf('bo'), statusOf('cy'), statusOf('di')]).toEqual(['offline', '', 'idle']);
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', title: 'Ops', members: [{ user_id: 'bo', status: 'online' }, { user_id: 'di', status: 'offline' }] }], users: [{ user_id: 'cy', status: 'dnd' }] } });
		expect([statusOf('bo'), statusOf('cy'), statusOf('di')]).toEqual(['online', 'dnd', 'offline']);
		// A reconnect's listing brings them back after the sign-in drops them; until it does, the ones from before show.
		reconnect();
		hello();
		await socket.reply('auth', { you: { user_id: 'ada' } });
		expect([statusOf('bo'), statusOf('cy'), statusOf('di')]).toEqual(['online', 'dnd', 'offline']);
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General', members: [{ user_id: 'bo', status: 'offline' }, { user_id: 'cy', status: '' }] }] });
		expect([statusOf('bo'), statusOf('cy'), statusOf('di')]).toEqual(['offline', '', 'offline']);
	});
});

/**
 * Signing in to an existing account (§3.3): servers announce the previous
 * identity's departure, never an `old` change, which means only the same
 * account under a new `user_id`.
 */
describe('a guest that signs in to an existing account, as others see it', () => {
	let client: ChatClient;
	let snapshot: ClientSnapshot;
	let socket: FakeSocket;

	beforeEach(() => {
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		client = ChatClient.fromOptions({ serverUrl: 'ws://fake.test/', onChange: (next) => (snapshot = next) });
		client.start();
		socket = FakeSocket.latest();
	});

	afterEach(() => {
		client.stop();
		vi.unstubAllGlobals();
	});

	it('shows the guest leaving and the account arriving as two people, without an alias', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms', 'status'] } });
		await socket.reply('auth', { you: { user_id: 'bo' } });
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General', latest_log_id: '10', members: [{ user_id: 'bo' }, { user_id: 'guest_7', name: 'Guest 7', status: 'online' }] }] });
		const members = () => snapshot.rooms.find((room) => room.id === 'general')?.members?.map((member) => member.user_id);
		expect(members()).toEqual(['bo', 'guest_7']);
		// The guest signs in to Ada's account on its connection: it leaves, and Ada, already an account, arrives.
		socket.receive({ method: 'user', params: { new: { user_id: 'guest_7', name: 'Guest 7', status: 'offline' } } });
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '11', room_id: 'general', members: [{ user: { user_id: 'guest_7', name: 'Guest 7' }, joined: false }] }] } });
		socket.receive({ method: 'user', params: { new: { user_id: 'ada', name: 'Ada', status: 'online' } } });
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '12', room_id: 'general', members: [{ user: { user_id: 'ada', name: 'Ada' }, joined: true }] }] } });
		expect(members()).toEqual(['bo', 'ada']);
		expect(snapshot.users.guest_7.status).toBe('offline');
		expect(snapshot.users.ada).toEqual({ user_id: 'ada', name: 'Ada', status: 'online' });
		// Two people: the guest's past messages stay the guest's.
		expect(snapshot.userAliases).toEqual({});
	});
});

/** `server.status` (§3.1, §4.5): the optional statuses the server accepts. */
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

	it('takes a v8 server as it is: status, its sign-ins and member changes all apply', async () => {
		const socket = FakeSocket.latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms', 'status'], status: ['dnd'] } });
		expect(snapshot.server?.apron).toBe(8);
		expect(snapshot.server?.status).toEqual(['dnd']);
		await socket.reply('auth', { you: { user_id: 'ada', status: 'online' } });
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.memberChangesUnsupported).toBeUndefined();
		client.setStatus('dnd').catch(() => undefined);
		expect(socket.request('me').params).toEqual({ status: 'dnd' });
	});

	it('takes the strings listed, and a replacing frame without it leaves none', () => {
		const socket = FakeSocket.latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['status'], status: ['dnd', 'invisible', 7] } });
		expect(snapshot.server?.status).toEqual(['dnd', 'invisible']);
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['status'] } });
		expect(snapshot.server && Object.hasOwn(snapshot.server, 'status')).toBe(false);
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['status'], status: 'dnd' } });
		expect(snapshot.server && Object.hasOwn(snapshot.server, 'status')).toBe(false);
	});
});
