import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_RETRY_MS, type ChatClient, type ClientSnapshot } from './client';
import { REQUEST_TIMEOUT_MS } from './client-internals';
import { requestPasskey } from './webauthn';
import { FakeSocket, settle, startClient, type ClientHarness } from '$lib/test/client';

vi.mock('./webauthn', () => ({ requestPasskey: vi.fn(), signalPasskeyLabel: vi.fn() }));

/**
 * Status (§4.5): idle reports, mutes, your own status, and the statuses and
 * mutes kept across sign-ins. The shared fixtures `status.json` and
 * `sign-in.json` (wire-session.test.ts) cover the wire exchanges; these cover
 * timing, retries and what the snapshot shows meanwhile.
 */
let harness: ClientHarness;
let client: ChatClient;
let socket: FakeSocket;
let snapshot: ClientSnapshot;

beforeEach(() => {
	vi.useFakeTimers();
	harness = startClient({ storage: new Map(), onSnapshot: (next) => (snapshot = next) });
	({ client, socket } = harness);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const statuses = () => socket.sent.filter((frame) => frame.method === 'status').map((frame) => frame.params as Record<string, unknown>);

async function greet(caps: string[] = ['rooms', 'status'], you: Record<string, unknown> = { user_id: 'guest_1', name: 'Guest' }, auth = ['guest']): Promise<void> {
	socket.open();
	socket.receive({ method: 'server', params: { apron: 9, auth, capabilities: caps } });
	await socket.reply('auth', { you });
	if (caps.includes('rooms')) await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }] });
}

/** The connection drops, and the next one opens a moment later. */
function reconnect(): void {
	socket = harness.reconnect();
}

/** Answers the latest `status` request: `{}` (§4.5), or an error. */
async function answer(error?: Record<string, unknown>): Promise<void> {
	const { id } = socket.request('status');
	socket.receive(error ? { id, error } : { id, result: {} });
	await settle();
}
const tooMany = (seconds: number) => ({ code: -32002, message: 'Too Many Requests', data: { retry_after: seconds } });

describe('idle reports', () => {
	it('sends status as a request with an id, and nothing before the auth result', async () => {
		client.setIdle(true);
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['status'] } });
		// Not signed in yet (§3.2): no status, even for a page already idle.
		expect(socket.sent.map((frame) => frame.method)).toEqual(['auth']);
		await socket.reply('auth', { you: { user_id: 'guest_1' } });
		// After the result, an idle page reports it at once.
		const request = socket.request('status');
		expect(request).toEqual({ method: 'status', id: expect.any(String), params: { idle: 0 } });
		expect(socket.sent.map((frame) => frame.method)).toEqual(['auth', 'status']);
	});

	it('sends nothing for a connection that starts attended', async () => {
		await greet();
		client.setIdle(false);
		vi.advanceTimersByTime(60_000);
		expect(statuses()).toEqual([]);
		// A replacing server frame says nothing either.
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms', 'status'] } });
		expect(statuses()).toEqual([]);
	});

	it('reports idle and attended as the page says, at once, and only changes', async () => {
		await greet();
		client.setIdle(true);
		expect(statuses()).toEqual([{ idle: 0 }]);
		await answer();
		client.setIdle(true);
		expect(statuses()).toEqual([{ idle: 0 }]);
		client.setIdle(false);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }]);
		await answer();
		client.setIdle(false);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }]);
	});

	it('reports how long the page has gone unused as whole seconds', async () => {
		await greet();
		client.setIdle(true, Date.now() - 300_500);
		expect(statuses()).toEqual([{ idle: 300 }]);
		await answer();
		client.setIdle(false);
		await answer();
		// Worked out when it goes: a refused request's retry says the time since then.
		client.setIdle(true, Date.now() - 1_000);
		await answer(tooMany(2));
		vi.advanceTimersByTime(2_000);
		expect(statuses()).toEqual([{ idle: 300 }, { idle: false }, { idle: 1 }, { idle: 3 }]);
	});

	it('stays idle after a message: only idle: false ends it', async () => {
		await greet();
		client.setIdle(true);
		await answer();
		client.sendTyping('general', true);
		client.markRead('general', '1724803200001');
		client.send('general', 'hi').promise.catch(() => undefined);
		expect(statuses()).toEqual([{ idle: 0 }]);
		client.setIdle(false);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }]);
		// `activity` never carries attendance.
		expect(socket.sent.filter((frame) => frame.method === 'activity' && 'idle' in (frame.params as object))).toEqual([]);
	});

	it('reports idle at once on a reconnect while idle, and nothing while attended', async () => {
		await greet();
		client.setIdle(true);
		await answer();
		reconnect();
		await greet();
		// Idle since the page said so, before the reconnect.
		expect(statuses()).toEqual([{ idle: 5 }]);
		await answer();
		// Back, then a reconnect: the new connection starts attended, so it says nothing.
		client.setIdle(false);
		expect(statuses()).toEqual([{ idle: 5 }, { idle: false }]);
		reconnect();
		await greet();
		expect(statuses()).toEqual([]);
	});

	it('sends one idle at a time, and the latest state after the reply', async () => {
		await greet();
		client.setIdle(true);
		// Back and idle again while the first is unanswered: nothing more goes yet.
		client.setIdle(false);
		expect(statuses()).toEqual([{ idle: 0 }]);
		await answer();
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }]);
		client.setIdle(true);
		client.setIdle(false);
		await answer();
		// What the server has is what the page says: nothing more goes.
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }]);
	});

	it('resends the current idle state, not the refused one, after retry_after', async () => {
		await greet();
		client.setIdle(true);
		// Back meanwhile: the refused idle is not what goes again.
		client.setIdle(false);
		await answer(tooMany(5));
		expect(statuses()).toEqual([{ idle: 0 }]);
		vi.advanceTimersByTime(4_999);
		expect(statuses()).toEqual([{ idle: 0 }]);
		// Nothing changed on the server (§4.5), and the page is attended, as the connection started: nothing to send.
		vi.advanceTimersByTime(1);
		expect(statuses()).toEqual([{ idle: 0 }]);
		// Refused again while still idle: after the delay, the same state goes with a new id, idle for longer.
		client.setIdle(true);
		const first = socket.request('status').id;
		await answer(tooMany(2));
		vi.advanceTimersByTime(2_000);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: 0 }, { idle: 2 }]);
		expect(socket.request('status').id).not.toBe(first);
		await answer();
		// Attended after a refused idle: false goes again once the delay is over.
		client.setIdle(false);
		await answer(tooMany(1));
		expect(statuses()).toEqual([{ idle: 0 }, { idle: 0 }, { idle: 2 }, { idle: false }]);
		vi.advanceTimersByTime(1_000);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: 0 }, { idle: 2 }, { idle: false }, { idle: false }]);
		await answer();
	});

	it('tries again after another error, backing off, so a page in use is not left idle', async () => {
		await greet();
		client.setIdle(true);
		await answer();
		client.setIdle(false);
		await answer({ code: -32603, message: 'Internal error' });
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }]);
		vi.advanceTimersByTime(IDLE_RETRY_MS - 1);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }]);
		vi.advanceTimersByTime(1);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }, { idle: false }]);
		// Failing again doubles the wait.
		await answer({ code: -32603, message: 'Internal error' });
		vi.advanceTimersByTime(IDLE_RETRY_MS * 2 - 1);
		expect(statuses()).toHaveLength(3);
		vi.advanceTimersByTime(1);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }, { idle: false }, { idle: false }]);
		await answer();
		// Applied: nothing more goes, and the next failure starts from the first wait.
		vi.advanceTimersByTime(60_000);
		expect(statuses()).toHaveLength(4);
		client.setIdle(true);
		await answer({ code: -32603, message: 'Internal error' });
		vi.advanceTimersByTime(IDLE_RETRY_MS);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }, { idle: false }, { idle: false }, { idle: 0 }, { idle: IDLE_RETRY_MS / 1000 }]);
		// Back meanwhile: the current state is what goes.
		client.setIdle(false);
		await answer({ code: -32603, message: 'Internal error' });
		vi.advanceTimersByTime(IDLE_RETRY_MS * 2);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }, { idle: false }, { idle: false }, { idle: 0 }, { idle: IDLE_RETRY_MS / 1000 }]);
	});

	it('sends the current idle state after a request that timed out, which the server may have applied', async () => {
		await greet();
		client.setIdle(true);
		expect(statuses()).toEqual([{ idle: 0 }]);
		// No answer: the server may take the connection as idle, or not. Back meanwhile.
		client.setIdle(false);
		await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
		expect(statuses()).toEqual([{ idle: 0 }]);
		// After the backoff, attended goes, though the connection started attended.
		vi.advanceTimersByTime(IDLE_RETRY_MS);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }]);
		await answer();
		// Answered: the server has it, and nothing more goes.
		client.setIdle(false);
		expect(statuses()).toEqual([{ idle: 0 }, { idle: false }]);
	});

	it('sends no status to a server without the capability, push or not', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['activity'], push: { webpush: { key: 'BNcR' } } } });
		await socket.reply('auth', { you: { user_id: 'guest_1' } });
		client.setIdle(true);
		client.setMute(true);
		expect(statuses()).toEqual([]);
		// A replacing server frame with the capability hears the current state.
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['status'] } });
		expect(statuses()).toEqual([{ idle: 0 }]);
	});
});

describe('mutes', () => {
	it('keeps a room\'s mute from the server\'s status for it (§4.5), joined or not', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms', 'status'] } });
		await socket.reply('auth', { you: { user_id: 'guest_1' } });
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }, { room_id: 'random', title: 'Random' }, { room_id: 'ops', title: 'Ops' }] });
		const muted = () => Object.fromEntries(snapshot.rooms.map((room) => [room.id, room.mutedUntil]));
		socket.receive({ method: 'status', params: { room_id: 'general', mute: true } });
		socket.receive({ method: 'status', params: { room_id: 'random', mute: 60 } });
		// A room not listed here yet keeps its mute for when it is.
		socket.receive({ method: 'status', params: { room_id: 'elsewhere', mute: true } });
		expect(muted()).toEqual({ general: true, random: Date.now() + 60_000, ops: undefined });
		expect(snapshot.roomMutes).toEqual({ general: true, random: Date.now() + 60_000, elsewhere: true });
		// Room records don't carry it: a record without `mute`, or with one, changes nothing.
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '20', title: 'General!' }, { room_id: 'ops', log_id: '21', title: 'Ops', mute: true }] } });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'general', log_id: '24', title: 'General!' }] } });
		expect(muted()).toEqual({ general: true, random: Date.now() + 60_000, ops: undefined });
		// `false` ends it, and so does `0`.
		socket.receive({ method: 'status', params: { room_id: 'random', mute: false } });
		socket.receive({ method: 'status', params: { room_id: 'general', mute: 0 } });
		expect(muted()).toEqual({ general: undefined, random: undefined, ops: undefined });
		expect(snapshot.roomMutes).toEqual({ elsewhere: true });
		// A room's mute leaves the unscoped one alone.
		expect(snapshot.mutedUntil).toBeUndefined();
		// An invalid one is ignored.
		socket.receive({ method: 'status', params: { room_id: 'ops', mute: -1 } });
		socket.receive({ method: 'status', params: { room_id: 'ops', mute: 'soon' } });
		socket.receive({ method: 'status', params: { room_id: 7, mute: true } });
		expect(muted().ops).toBeUndefined();
		expect(snapshot.mutedUntil).toBeUndefined();
		// A room's mute runs out here without a word from the server.
		socket.receive({ method: 'status', params: { room_id: 'ops', mute: 10 } });
		expect(muted().ops).toBe(Date.now() + 10_000);
		const emitted = snapshot;
		vi.advanceTimersByTime(10_000);
		expect(snapshot).not.toBe(emitted);
		expect(muted().ops).toBeUndefined();
	});

	it('pauses notifications with mute, and takes the server\'s status as the word on it (§4.5)', async () => {
		await greet(['rooms', 'status'], { user_id: 'guest_1' }, ['token', 'guest']);
		// A guest can't pause: this sign-in is a guest's.
		client.setMute(true);
		expect(statuses().filter((params) => 'mute' in params)).toEqual([]);
		client.useToken('apron_token');
		vi.advanceTimersByTime(0);
		socket = FakeSocket.latest();
		await greet(['rooms', 'status'], { user_id: 'ada', name: 'Ada' }, ['token', 'guest']);
		// Asking changes nothing until the server sends the change back as a `status`.
		client.setMute(3600);
		expect(statuses().filter((params) => 'mute' in params)).toEqual([{ mute: 3600 }]);
		expect(snapshot.mutedUntil).toBeUndefined();
		socket.receive({ method: 'status', params: { mute: 3600 } });
		expect(snapshot.mutedUntil).toBe(Date.now() + 3_600_000);
		// Resuming sends `false`.
		client.setMute(false);
		expect(statuses().filter((params) => 'mute' in params)).toEqual([{ mute: 3600 }, { mute: false }]);
		expect(snapshot.mutedUntil).toBe(Date.now() + 3_600_000);
		socket.receive({ method: 'status', params: { mute: false } });
		expect(snapshot.mutedUntil).toBeUndefined();
		// Another of your connections paused: the server sends it here too, and this one takes it as its own.
		socket.receive({ method: 'status', params: { mute: true } });
		expect(snapshot.mutedUntil).toBe(true);
		// `you` says nothing about mutes (§4.5): a `mute` in it is ignored.
		socket.receive({ method: 'user', params: { you: { user_id: 'ada', mute: 0 } } });
		socket.receive({ method: 'user', params: { you: { user_id: 'ada', status: 'online' } } });
		expect(snapshot.mutedUntil).toBe(true);
		// `0` ends it, as `false` does; an invalid `mute` leaves it.
		socket.receive({ method: 'status', params: { mute: 'soon' } });
		socket.receive({ method: 'status', params: { mute: -5 } });
		expect(snapshot.mutedUntil).toBe(true);
		socket.receive({ method: 'status', params: { mute: 0 } });
		expect(snapshot.mutedUntil).toBeUndefined();
		// A pause runs out here without a word from the server.
		socket.receive({ method: 'status', params: { mute: 60 } });
		expect(snapshot.mutedUntil).toBe(Date.now() + 60_000);
		vi.advanceTimersByTime(60_000);
		expect(snapshot.mutedUntil).toBeUndefined();
	});

	it('sends mute as a request: the echo sets it before the {} result, and an error changes nothing (§4.5)', async () => {
		await greet(['rooms', 'status'], { user_id: 'guest_1' }, ['token', 'guest']);
		// A guest can't pause: nothing is sent, and the ask is refused.
		await expect(client.setMute(true)).rejects.toThrow();
		client.useToken('apron_token');
		vi.advanceTimersByTime(0);
		socket = FakeSocket.latest();
		await greet(['rooms', 'status'], { user_id: 'ada', name: 'Ada' }, ['token', 'guest']);
		let settled: string | undefined;
		const paused = client.setMute(3600).then(() => (settled = 'ok'), (cause: Error) => (settled = cause.message));
		const request = socket.request('status');
		expect(request).toEqual({ method: 'status', id: expect.any(String), params: { mute: 3600 } });
		// The sender's own connection gets the echo too, before the result (§1, §4.5): that sets it.
		socket.receive({ method: 'status', params: { mute: 3600 } });
		const until = Date.now() + 3_600_000;
		expect(snapshot.mutedUntil).toBe(until);
		expect(settled).toBeUndefined();
		socket.receive({ id: request.id, result: {} });
		await paused;
		expect(settled).toBe('ok');
		expect(snapshot.mutedUntil).toBe(until);
		// Refused: the pause stands as it was, and the ask rejects with the server's word.
		const resumed = client.setMute(false);
		const refused = socket.request('status');
		expect(refused.params).toEqual({ mute: false });
		expect(refused.id).not.toBe(request.id);
		socket.receive({ id: refused.id, error: { code: -32002, message: 'Too Many Requests', data: { retry_after: 5 } } });
		await expect(resumed).rejects.toThrow(/5s/);
		expect(snapshot.mutedUntil).toBe(until);
		// A mute refused with retry_after isn't sent again on its own.
		vi.advanceTimersByTime(5_000);
		expect(statuses().filter((params) => 'mute' in params)).toEqual([{ mute: 3600 }, { mute: false }]);
		const invalid = client.setMute(60);
		socket.receive({ id: socket.request('status').id, error: { code: -32602, message: 'Mute must be at most a day' } });
		await expect(invalid).rejects.toThrow('Mute must be at most a day');
		expect(snapshot.mutedUntil).toBe(until);
	});

	it('takes a mute the server shortened or ignored from its status, never the one asked for', async () => {
		await greet(['rooms', 'status'], { user_id: 'guest_1' }, ['token', 'guest']);
		client.useToken('apron_token');
		vi.advanceTimersByTime(0);
		socket = FakeSocket.latest();
		await greet(['rooms', 'status'], { user_id: 'ada', name: 'Ada' }, ['token', 'guest']);
		// Shortened: the server sends the 600 seconds it kept of the 3600 asked for.
		client.setMute(3600);
		expect(snapshot.mutedUntil).toBeUndefined();
		socket.receive({ method: 'status', params: { mute: 600 } });
		expect(snapshot.mutedUntil).toBe(Date.now() + 600_000);
		vi.advanceTimersByTime(600_000);
		expect(snapshot.mutedUntil).toBeUndefined();
		// A server without timed mutes takes seconds as `true` (§4.5), and says so.
		client.setMute(60);
		socket.receive({ method: 'status', params: { mute: true } });
		expect(snapshot.mutedUntil).toBe(true);
		socket.receive({ method: 'status', params: { mute: false } });
		// No answer at all (the frame was lost, or the server applied nothing): still no pause.
		client.setMute(60);
		vi.advanceTimersByTime(1_000);
		expect(snapshot.mutedUntil).toBeUndefined();
	});
});

describe('your own status', () => {
	it('sets your status with me, and shows what the server kept (§4.5)', async () => {
		await greet(['rooms', 'status'], { user_id: 'ada', name: 'Ada', status: 'online' });
		const asked = client.setStatus('dnd');
		const request = socket.request('me');
		expect(request.params).toEqual({ status: 'dnd' });
		await socket.reply('me', { you: { user_id: 'ada', status: 'dnd' } });
		expect((await asked).status).toBe('dnd');
		expect(snapshot.you?.status).toBe('dnd');
		expect(snapshot.users.ada.status).toBe('dnd');
		// A server without invisible sets "" (none) instead: `you` shows the result.
		const invisible = client.setStatus('invisible');
		await socket.reply('me', { you: { user_id: 'ada', status: '' } });
		expect((await invisible).status).toBe('');
		expect(snapshot.you?.status).toBe('');
		// Setting none sends "".
		client.setStatus('').catch(() => undefined);
		expect(socket.sent.filter((frame) => frame.method === 'me').map((frame) => frame.params)).toEqual([{ status: 'dnd' }, { status: 'invisible' }, { status: '' }]);
	});

	it('keeps your chosen status when others\' view of you says otherwise', async () => {
		await greet(['rooms', 'status'], { user_id: 'ada', name: 'Ada', status: 'invisible' });
		// Others see you offline while you are invisible (§4.5); that view never replaces your choice.
		socket.receive({ method: 'user', params: { new: { user_id: 'ada', name: 'Ada', status: 'offline' } } });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', title: 'Ops', members: [{ user_id: 'ada', status: 'offline' }, { user_id: 'bo', status: 'idle' }] }] } });
		expect(snapshot.you?.status).toBe('invisible');
		expect(snapshot.users.ada.status).toBe('invisible');
		expect(snapshot.users.bo.status).toBe('idle');
		// A `you` changes it.
		socket.receive({ method: 'user', params: { you: { user_id: 'ada', status: 'online' } } });
		expect(snapshot.users.ada.status).toBe('online');
	});

	it('sets no status without the capability', async () => {
		await greet(['rooms'], { user_id: 'ada', name: 'Ada' });
		await expect(client.setStatus('dnd')).rejects.toThrow();
		expect(socket.sent.filter((frame) => frame.method === 'me')).toEqual([]);
	});
});

/** `server.status` (§3.1, §4.5): the optional statuses the server accepts. */
describe('server.status', () => {
	it('takes the server as it is: status, its sign-ins and member changes all apply', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms', 'status'], status: ['dnd'] } });
		expect(snapshot.server?.apron).toBe(9);
		expect(snapshot.server?.status).toEqual(['dnd']);
		await socket.reply('auth', { you: { user_id: 'ada', status: 'online' } });
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.memberChangesUnsupported).toBeUndefined();
		client.setStatus('dnd').catch(() => undefined);
		expect(socket.request('me').params).toEqual({ status: 'dnd' });
	});

	it('takes the strings listed, and a replacing frame without it leaves none', () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['status'], status: ['dnd', 'invisible', 7] } });
		expect(snapshot.server?.status).toEqual(['dnd', 'invisible']);
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['status'] } });
		expect(snapshot.server && Object.hasOwn(snapshot.server, 'status')).toBe(false);
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['status'], status: 'dnd' } });
		expect(snapshot.server && Object.hasOwn(snapshot.server, 'status')).toBe(false);
	});
});

/**
 * Kept statuses across sign-ins (§4.5): dropped at each one, however short
 * the reconnect, and taken again from what the server sends, `room_list` and
 * `room_update` included. Resuming as the same user, the dropped ones still
 * show until the joined listing arrives, so nothing greys out meanwhile.
 */
describe('kept statuses and sign-ins', () => {
	function hello(): void {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms', 'status'] } });
	}

	async function listed(you: Record<string, unknown>, members: Record<string, unknown>[]): Promise<void> {
		hello();
		await socket.reply('auth', { you });
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General', members }] });
	}

	const statusOf = (userId: string) => snapshot.users[userId]?.status;
	const seen = [{ user_id: 'ada', status: 'online' }, { user_id: 'bo', status: 'idle' }, { user_id: 'cy', status: 'dnd' }];

	it('keeps other users\' statuses through a lost connection, until the next sign-in', async () => {
		await listed({ user_id: 'ada', status: 'online' }, seen);
		socket.drop();
		expect([statusOf('ada'), statusOf('bo'), statusOf('cy')]).toEqual(['online', 'idle', 'dnd']);
	});

	it('drops them at each sign-in; resuming, they still show until the joined listing, then those not sent again have no status', async () => {
		await listed({ user_id: 'ada', status: 'online' }, seen);
		reconnect();
		hello();
		await socket.reply('auth', { you: { user_id: 'ada', status: 'dnd' } });
		// Your own comes from the auth's `you`; the others' from before still show, said to be only held.
		expect(statusOf('ada')).toBe('dnd');
		expect([statusOf('bo'), statusOf('cy')]).toEqual(['idle', 'dnd']);
		expect(snapshot.heldStatuses).toEqual(['bo', 'cy']);
		// After the result the server sends connected users' statuses again (§4.5), which show at once.
		socket.receive({ method: 'user', params: { new: { user_id: 'bo', status: 'online' } } });
		expect([statusOf('bo'), statusOf('cy')]).toEqual(['online', 'dnd']);
		expect(snapshot.heldStatuses).toEqual(['cy']);
		// Once the listing is in, a status the server didn't send again is no longer known: not offline.
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General', members: [{ user_id: 'ada' }, { user_id: 'bo' }, { user_id: 'cy' }] }] });
		expect(statusOf('bo')).toBe('online');
		expect(snapshot.users.cy).toEqual({ user_id: 'cy' });
		expect(snapshot.heldStatuses).toBeUndefined();
	});

	it('drops them at once at a sign-in as someone else after a lost connection', async () => {
		await listed({ user_id: 'ada', status: 'online' }, seen);
		reconnect();
		hello();
		await socket.reply('auth', { you: { user_id: 'eve' } });
		expect([statusOf('bo'), statusOf('cy')]).toEqual([undefined, undefined]);
	});

	it('keeps offline and no status through a resume that sends nothing of them, which is what that silence means', async () => {
		await listed({ user_id: 'ada', status: 'online' }, [{ user_id: 'bo', status: 'offline' }, { user_id: 'cy', status: '' }, { user_id: 'di', status: 'online' }]);
		reconnect();
		hello();
		await socket.reply('auth', { you: { user_id: 'ada' } });
		// A resume's listing may hold only rooms that changed (§4.2.1): here, none.
		await socket.reply('room_list', { joined: [] });
		expect([statusOf('bo'), statusOf('cy'), statusOf('di')]).toEqual(['offline', '', undefined]);
	});

	it('holds them again when the connection drops before the resume\'s listing', async () => {
		await listed({ user_id: 'ada', status: 'online' }, seen);
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
		await listed({ user_id: 'ada', status: 'online' }, [
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
 * Mutes across `auth` (§3.2, §4.5): a sign-in drops the kept mutes and
 * statuses and applies the ones the server sends after its result; an
 * `auth` that adds a passkey or an address to the signed-in connection is no
 * sign-in, and the mutes stand.
 */
describe('mutes, statuses and sign-ins', () => {
	const roomMute = (id: string) => snapshot.rooms.find((room) => room.id === id)?.mutedUntil;

	beforeEach(() => {
		vi.mocked(requestPasskey).mockReset();
		vi.mocked(requestPasskey).mockResolvedValue({ id: 'credential' });
	});

	/** Signed in as `you` (a registered session with `token`), with a global mute and one on `general`. */
	async function signedInMuted(auth: string[], you: Record<string, unknown>, token?: string): Promise<FakeSocket> {
		const socket = FakeSocket.latest();
		await socket.greet(['status'], { auth, you, room: { room_id: 'general', title: 'General' }, ...(token ? { token } : {}) });
		socket.receive({ method: 'status', params: { mute: true } });
		socket.receive({ method: 'status', params: { room_id: 'general', mute: true } });
		expect([snapshot.mutedUntil, roomMute('general')]).toEqual([true, true]);
		return socket;
	}

	async function passkey(socket: FakeSocket, action: 'register' | 'login', you: string): Promise<void> {
		const done = client.usePasskey(action);
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('auth', { challenge_id: 'c1', public_key: { challenge: 'x' } });
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('auth', { you: { user_id: you } });
		await done;
	}

	it('keeps them when a signed-in account adds a passkey', async () => {
		const socket = await signedInMuted(['webauthn', 'token', 'guest'], { user_id: 'ada' }, 'st_ada');
		await passkey(socket, 'register', 'ada');
		expect([snapshot.mutedUntil, roomMute('general')]).toEqual([true, true]);
	});

	it('keeps them when a guest adds a passkey to its signed-in connection', async () => {
		const socket = await signedInMuted(['webauthn', 'guest'], { user_id: 'guest_1' });
		await passkey(socket, 'register', 'guest_1');
		expect(snapshot.passkeySession).toBe(true);
		expect([snapshot.mutedUntil, roomMute('general')]).toEqual([true, true]);
	});

	it('keeps them when a signed-in account adds an address', async () => {
		const socket = await signedInMuted(['email', 'token', 'guest'], { user_id: 'ada' }, 'st_ada');
		const asked = client.requestEmailCodeToAdd('ada@example.com');
		await socket.reply('auth', {});
		await asked;
		const added = client.addWithCode('1');
		await vi.advanceTimersByTimeAsync(0);
		socket.receive({ id: socket.request('auth').id, result: {} });
		await added;
		expect([snapshot.mutedUntil, roomMute('general')]).toEqual([true, true]);
	});

	it('drops the kept mutes at a passkey sign-in on a signed-in connection, and applies the status frames after its result', async () => {
		const socket = await signedInMuted(['webauthn', 'guest'], { user_id: 'guest_1' });
		await passkey(socket, 'login', 'ada');
		// At the result: no mutes kept.
		expect([snapshot.mutedUntil, roomMute('general')]).toEqual([undefined, undefined]);
		// Each status after it applies as it arrives.
		socket.receive({ method: 'status', params: { room_id: 'general', mute: 600 } });
		expect([snapshot.mutedUntil, roomMute('general')]).toEqual([undefined, Date.now() + 600_000]);
		socket.receive({ method: 'status', params: { mute: 60 } });
		expect(snapshot.mutedUntil).toBe(Date.now() + 60_000);
	});

	it('drops other users\' kept statuses at a sign-in as another user on the connection', async () => {
		const socket = await signedInMuted(['webauthn', 'guest'], { user_id: 'guest_1' });
		socket.receive({ method: 'user', params: { new: { user_id: 'bo', status: 'idle' } } });
		await passkey(socket, 'login', 'ada');
		expect(snapshot.users.bo.status).toBeUndefined();
	});

	it('keeps the mutes and statuses on a repeat auth as the user the connection is signed in as: no sign-in', async () => {
		const socket = await signedInMuted(['webauthn', 'token', 'guest'], { user_id: 'ada' }, 'st_ada');
		socket.receive({ method: 'user', params: { new: { user_id: 'bo', status: 'idle' } } });
		await passkey(socket, 'login', 'ada');
		// The server sends no mutes after it (§4.5): nothing is reset.
		expect([snapshot.mutedUntil, roomMute('general')]).toEqual([true, true]);
		expect(snapshot.users.bo.status).toBe('idle');
	});
});
