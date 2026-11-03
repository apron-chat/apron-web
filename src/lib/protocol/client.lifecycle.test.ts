import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatClient, ClientSnapshot } from './client';
import type { JsonObject } from './types';
import { connect, FakeSocket, settle, startClient } from '$lib/test/client';
import { bounds } from '$lib/test/client-history';
import { requestPasskey } from './webauthn';

vi.mock('./webauthn', () => ({
	requestPasskey: vi.fn(),
	signalPasskeyLabel: vi.fn()
}));

/**
 * How a connection ends, and what outlives it. Every way out (a drop, `stop`, `disconnect`, `retryNow`,
 * `restart`) keeps the rooms to resume from or forgets them, never leaves them shown with no connection under
 * them; a recovery is under way only while its pages can go; and a sign-in ceremony holds other requests back
 * rather than failing them.
 */
const storage = new Map<string, string>();
const SESSION_KEY = 'apron.session:ws://fake.test/';

beforeEach(() => {
	vi.useFakeTimers();
	storage.clear();
	vi.mocked(requestPasskey).mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const ada = { user_id: 'ada', name: 'Ada' };
const general = { room_id: 'general', log_id: '10', title: 'General', history_log_id: '10' };

function message(id: string, from: Record<string, unknown> = ada): Record<string, unknown> {
	return { message_id: id, log_id: id, room_id: 'general', from, body: { text: `m${id}` } };
}

function histories(socket: FakeSocket): Array<Record<string, unknown>> {
	return socket.sent.filter((frame) => frame.method === 'history').map((frame) => bounds(frame.params as Record<string, unknown>));
}

/** Answers a passkey `begin`, lets the (mocked) browser respond, then answers the `finish`. */
async function passkey(socket: FakeSocket, you: Record<string, unknown>): Promise<void> {
	await settle();
	await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x' } });
	await socket.reply('auth', { you });
}

/**
 * Ada, signed in with a saved token on a server that resumes with one and offers passkeys, with `general`
 * recovered up to 12.
 */
async function signedIn(): Promise<{ client: ChatClient; socket: FakeSocket; snap: () => ClientSnapshot }> {
	storage.set(SESSION_KEY, 'session-1');
	const harness = startClient({ storage });
	const { socket } = harness;
	socket.open();
	socket.receive({ method: 'server', params: { apron: 10, auth: ['webauthn', 'token', 'guest'], capabilities: ['history', 'rooms'] } });
	await socket.reply('auth', { you: ada });
	await socket.reply('room_list', { joined: [{ ...general, latest_log_id: '12' }], users: [] });
	await socket.reply('history', { messages: [message('11'), message('12')], first_log_id: '11', last_log_id: '12', more: false, latest_log_id: '12', history_log_id: '10' });
	expect(harness.snap().rooms.find((room) => room.id === 'general')).toMatchObject({ loaded: true, recovering: false });
	return { client: harness.client, socket, snap: harness.snap };
}

describe('a recovery runs only while its pages can go', () => {
	it('stops where it got to when the sign-in it ran behind fails, and the passkey sign-in goes on from there', async () => {
		const { client, snap } = await signedIn();
		FakeSocket.latest().drop();
		await vi.advanceTimersByTimeAsync(5_000);
		const next = FakeSocket.latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 10, auth: ['webauthn', 'token', 'guest'], capabilities: ['history', 'rooms'] } });
		// The resume, its listing, and the room's recovery from its checkpoint go together (§3.2).
		expect(next.sent.map((frame) => frame.method)).toEqual(['auth', 'room_list', 'history']);
		expect(histories(next)).toEqual([{ room_id: 'general', after: '13' }]);
		// The token is refused: the connection stays open for a passkey tap.
		next.receive({ id: next.request('auth').id, error: { code: -32001, message: 'Session expired; sign in with your passkey' } });
		await settle();
		expect(snap().signInNeeded).toBe('webauthn');
		// The page sent behind it comes back with more to go, which can't be asked for as no one.
		await next.reply('history', { messages: [message('13'), message('14')], first_log_id: '13', last_log_id: '14', more: true, latest_log_id: '20', history_log_id: '10' });
		next.receive({ id: next.request('room_list').id, error: { code: -32001, message: 'Not signed in' } });
		await settle();
		expect(histories(next)).toHaveLength(1);

		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
		const login = client.usePasskey('login');
		await passkey(next, ada);
		await login;
		await next.reply('room_list', { joined: [{ ...general, latest_log_id: '20' }], users: [] });
		// It goes on from the page it got, not from scratch, and not never.
		expect(histories(next).at(-1)).toEqual({ room_id: 'general', after: '15', before: '20' });
		await next.reply('history', { messages: [message('15'), message('20')], first_log_id: '15', last_log_id: '20', more: false, latest_log_id: '20', history_log_id: '10' });
		expect(snap().rooms.find((room) => room.id === 'general')).toMatchObject({ recovering: false });
		expect(snap().rooms.find((room) => room.id === 'general')!.timeline.order).toEqual(['11', '12', '13', '14', '15', '20']);
	});

	it('refuses a load that nothing could carry out, rather than leaving it waiting', async () => {
		const { client, socket } = await signedIn();
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '30', log_id: '30', parent_room_id: 'general', title: 'Side', latest_log_id: '31', history_log_id: '30' }] } });
		client.disconnect();
		// Disconnected, no room is shown to load.
		await expect(client.loadRoom('30')).rejects.toThrow();
	});
});

describe('every way a connection ends deals with its rooms', () => {
	it('keeps the rooms through a disconnect, hidden, and connecting again resumes them from their checkpoints', async () => {
		const { client, snap } = await signedIn();
		client.disconnect();
		await settle();
		expect(snap().status).toBe('offline');
		// Nothing is shown with no connection under it: a recovery can't run there, nor anything load.
		expect(snap().rooms).toEqual([]);
		// What the server offered stays, for the connect screen.
		expect(snap().server?.auth).toEqual(['webauthn', 'token', 'guest']);
		client.retryNow();
		const next = FakeSocket.latest();
		next.open();
		next.receive({ method: 'server', params: { apron: 10, auth: ['webauthn', 'token', 'guest'], capabilities: ['history', 'rooms'] } });
		expect(histories(next)).toEqual([{ room_id: 'general', after: '13' }]);
		await next.reply('auth', { you: ada });
		await next.reply('room_list', { joined: [{ ...general, latest_log_id: '12' }], users: [] });
		await next.reply('history', { messages: [], more: false, latest_log_id: '12', history_log_id: '10' });
		expect(snap().rooms.find((room) => room.id === 'general')!.timeline.order).toEqual(['11', '12']);
	});

	it('forgets one account’s records when another signs in with a token after a disconnect', async () => {
		const { client } = await signedIn();
		expect(client.storedRecords().messages.map((record) => record.message_id)).toEqual(['11', '12']);
		client.disconnect();
		client.useToken('bob-token');
		const next = FakeSocket.latest();
		await next.greet(['history'], { auth: ['token', 'guest'], you: { user_id: 'bob', name: 'Bob' }, room: { room_id: 'lobby', log_id: '1', title: 'Lobby', latest_log_id: '1', history_log_id: '1' } });
		expect(client.snapshot().you?.user_id).toBe('bob');
		expect(client.storedRecords().messages).toEqual([]);
	});

	it('drops the old typing indicators when connecting anew', async () => {
		const { client, socket } = await connect(['activity', 'rooms', 'history'], { room: { ...general, latest_log_id: '10' } });
		socket.receive({ method: 'activity', params: { room_id: 'general', from: { user_id: 'bob', name: 'Bob' }, typing: 10 } });
		expect(client.snapshot().typing.map((entry) => entry.from.user_id)).toEqual(['bob']);
		client.restart();
		expect(client.snapshot().typing).toEqual([]);
	});
});

describe('a sign-in ceremony holds other requests back', () => {
	it('sends what was asked during a passkey ceremony once it ends, instead of failing it', async () => {
		const { client, socket } = await connect([], { auth: ['webauthn', 'guest'], storage });
		let answer!: (credential: JsonObject) => void;
		vi.mocked(requestPasskey).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
		const login = client.usePasskey('login');
		await settle();
		await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x' } });
		// The browser's sheet is up: a rename now waits for the ceremony rather than going as the guest.
		const rename = client.setDisplayName('Renamed');
		expect(rename).toBeDefined();
		let failed = false;
		rename!.promise.catch(() => (failed = true));
		await settle();
		expect(failed).toBe(false);
		expect(socket.sent.some((frame) => frame.method === 'me')).toBe(false);
		answer({ id: 'credential' });
		await settle();
		await socket.reply('auth', { you: ada });
		await login;
		expect(socket.request('me').params).toEqual({ name: 'Renamed' });
		expect(failed).toBe(false);
	});

	it('sends what waited once a cancelled ceremony ends', async () => {
		const { client, socket } = await connect([], { auth: ['webauthn', 'guest'], storage });
		vi.mocked(requestPasskey).mockImplementation((_action, _options, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))));
		const login = client.usePasskey('login');
		await settle();
		await socket.reply('auth', { challenge_id: 'challenge-1', public_key: { challenge: 'x' } });
		client.setDisplayName('Renamed');
		await settle();
		expect(socket.sent.some((frame) => frame.method === 'me')).toBe(false);
		client.cancelPasskeyPrompt();
		await expect(login).rejects.toThrow();
		expect(socket.request('me').params).toEqual({ name: 'Renamed' });
	});
});
