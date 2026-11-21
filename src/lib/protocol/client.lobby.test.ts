import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverSettings, type ChatClient, type ClientSnapshot } from './client';
import { connect, FakeSocket, settle } from '$lib/test/client';
import { requestPasskey } from './webauthn';

vi.mock('./webauthn', () => ({
	requestPasskey: vi.fn(),
	signalPasskeyLabel: vi.fn()
}));

/**
 * A server's lobby (`ext:settings` `lobby`, `ext:permissions` `lobby`): who is limited to it, being let out of it
 * (the rooms listed again, and a welcome), the server's setting changing mid-session, and a guest's session the
 * server ends as its lobby closes, which isn't tried again as a guest on its own.
 */
const CAPS = ['history', 'rooms', 'command', 'ext:settings', 'ext:permissions'];
const LOBBY = { settings: { lobby: { room_id: 'lobby', open: true } } };
const ROOM = { room_id: 'lobby', title: 'Public Lobby', log_id: '1', latest_log_id: '1', history_log_id: '1' };
const waitingGuest = { user_id: 'guest_1', name: 'Guest', ext: { permissions: { lobby: 'waiting' } } };

let client: ChatClient;
let socket: FakeSocket;
let snap: () => ClientSnapshot;

beforeEach(() => {
	vi.useFakeTimers();
	vi.mocked(requestPasskey).mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function connected(you: Record<string, unknown> = waitingGuest, options: { token?: string } = {}): Promise<void> {
	({ client, socket, snap } = await connect(CAPS, { auth: ['guest', 'webauthn', 'token'], ext: LOBBY, room: ROOM, you, ...options }));
	await socket.reply('history', { more: false, latest_log_id: '1', history_log_id: '1' });
}

const joinedListings = () => socket.sent.filter((frame) => frame.method === 'room_list' && (frame.params as Record<string, unknown>)?.filter === 'joined');

describe('a user limited to the lobby', () => {
	it('says so in the snapshot, as waiting or invited, and nothing for a member', async () => {
		await connected();
		expect(snap().lobby).toBe('waiting');
		expect(snap().admittedAt).toBeUndefined();
		socket.receive({ method: 'user', params: { you: { user_id: 'guest_1', roles: ['invited'], ext: { permissions: { lobby: 'invited' } } } } });
		expect(snap().lobby).toBe('invited');
		expect(snap().admittedAt).toBeUndefined();
	});

	it('is a member without the key, or on a server without ext:permissions', async () => {
		await connected({ user_id: 'ada', name: 'Ada', ext: { permissions: { invite: true } } }, { token: 'ada-token' });
		expect(snap().lobby).toBeUndefined();
	});
});

describe('being let out of the lobby', () => {
	it('lists the rooms again and welcomes you in, when a user notification takes the limit away', async () => {
		await connected({ user_id: 'wanda', name: 'Wanda', roles: ['waiting'], ext: { permissions: { lobby: 'waiting' } } }, { token: 'wanda-token' });
		// What a waiting account could list to join: nothing past the lobby.
		const listing = client.listRooms();
		await socket.reply('room_list', { joined: [], not_joined: [] });
		await listing;
		expect(snap().directory).toEqual([]);
		const before = joinedListings().length;

		socket.receive({ method: 'user', params: { you: { user_id: 'wanda', roles: [], ext: { permissions: {} } } } });
		expect(snap().lobby).toBeUndefined();
		expect(snap().admittedAt).toBe(Date.now());
		// The rooms are listed again, and what the lobby could list to join is forgotten.
		expect(joinedListings()).toHaveLength(before + 1);
		expect(snap().directory).toBeUndefined();
		socket.receive({ id: socket.request('room_list').id, result: { joined: [ROOM, { room_id: 'general', title: 'General', log_id: '2', latest_log_id: '2', history_log_id: null }] } });
		await settle();
		expect(snap().rooms.map((room) => room.id)).toEqual(['lobby', 'general']);
	});

	it('welcomes in an invited guest whose new account this connection made', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		await connected({ user_id: 'guest_1', name: 'Guest', roles: ['invited'], ext: { permissions: { lobby: 'invited' } } });
		const before = joinedListings().length;
		const pending = client.usePasskey('register', 'Grace');
		await settle();
		await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x' } });
		// A new user_id for the account, as Cloudflare gives one, with no limit.
		await socket.reply('auth', { you: { user_id: 'grace', name: 'Grace' }, token: 'grace-token' });
		await pending;
		expect(snap().lobby).toBeUndefined();
		expect(snap().passkeySession).toBe(true);
		expect(snap().admittedAt).toBeDefined();
		expect(joinedListings()).toHaveLength(before + 1);
	});

	it('only keeps a waiting guest waiting once it adds a passkey: no welcome', async () => {
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		await connected();
		const pending = client.usePasskey('register', 'Wanda');
		await settle();
		await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x' } });
		await socket.reply('auth', { you: { user_id: 'wanda', name: 'Wanda', roles: ['waiting'], ext: { permissions: { lobby: 'waiting' } } }, token: 'wanda-token' });
		await pending;
		expect(snap().lobby).toBe('waiting');
		expect(snap().passkeySession).toBe(true);
		expect(snap().admittedAt).toBeUndefined();
	});
});

describe('the server’s lobby setting', () => {
	it('follows a server frame that replaces it mid-session', async () => {
		await connected({ user_id: 'ada', name: 'Ada', ext: { permissions: { invite: true } } }, { token: 'ada-token' });
		expect(serverSettings(snap().server).lobby).toEqual({ room_id: 'lobby', open: true });
		socket.receive({ method: 'server', params: { apron: 10, agent: 'fake', auth: ['webauthn', 'token'], capabilities: CAPS, ext: { settings: { lobby: { room_id: 'lobby', open: false } } } } });
		expect(serverSettings(snap().server).lobby).toEqual({ room_id: 'lobby', open: false });
		// Still signed in: a replacing frame is no new session.
		expect(snap().authenticated).toBe(true);
		socket.receive({ method: 'server', params: { apron: 10, agent: 'fake', auth: ['webauthn', 'token'], capabilities: CAPS } });
		expect(serverSettings(snap().server).lobby).toBeUndefined();
	});
});

describe('a guest session the server ends (1008)', () => {
	/** The server closes the socket with a code and reason, as a browser's close event carries them. */
	function closeWith(code: number, reason: string): void {
		const latest = FakeSocket.latest();
		latest.readyState = FakeSocket.CLOSED;
		(latest.onclose as ((event: { code: number; reason: string }) => void) | null)?.({ code, reason });
	}

	it('isn’t tried again as a guest on its own: held, saying so, until the user acts', async () => {
		await connected();
		const sockets = FakeSocket.instances.length;
		closeWith(1008, 'The Public Lobby is closed');
		expect(snap().held).toBe(true);
		expect(snap().error).toBe('The server ended this guest session (The Public Lobby is closed).');
		await vi.advanceTimersByTimeAsync(120_000);
		expect(FakeSocket.instances).toHaveLength(sockets);
		// Asked to, it connects again, and the server's frame says what it offers now.
		client.retryNow();
		expect(FakeSocket.instances).toHaveLength(sockets + 1);
	});

	it('reconnects an account as usual, and a guest after any other close', async () => {
		await connected({ user_id: 'wanda', name: 'Wanda', ext: { permissions: { lobby: 'waiting' } } }, { token: 'wanda-token' });
		const sockets = FakeSocket.instances.length;
		closeWith(1008, 'policy');
		expect(snap().held).toBeFalsy();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(FakeSocket.instances.length).toBeGreaterThan(sockets);
	});

	it('reconnects a guest after a close for another reason', async () => {
		await connected();
		const sockets = FakeSocket.instances.length;
		closeWith(1001, 'going away');
		expect(snap().held).toBeFalsy();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(FakeSocket.instances.length).toBeGreaterThan(sockets);
	});
});
