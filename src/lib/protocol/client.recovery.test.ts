import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatClient, ClientSnapshot } from './client';
import { FakeSocket, settle, startClient } from '$lib/test/client';
import { bounds } from '$lib/test/client-history';

/**
 * History and recovery (§4.3): per room, a checkpoint and a fixed head, live
 * records buffered meanwhile; resumes behind `auth` after a reconnect; threads
 * loaded on demand, newest page first. The shared fixtures
 * `history-boundaries.json`, `history-live-boundary.json`,
 * `history-recovery-failure.json`, `reconnect-history.json`,
 * `room-list-delta.json` and `thread-recovery.json` (wire-session.test.ts)
 * cover the paging arithmetic; these cover what the snapshot shows meanwhile.
 */
let client: ChatClient;
let socket: FakeSocket;
let snapshot: ClientSnapshot;

beforeEach(() => {
	vi.useFakeTimers();
	({ client, socket } = startClient({ onSnapshot: (next) => (snapshot = next) }));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function latest(): FakeSocket {
	return FakeSocket.latest();
}

const alice = { user_id: 'alice', name: 'Alice' };

function message(id: string, fields: Record<string, unknown> = {}, log = id): Record<string, unknown> {
	return { message_id: id, log_id: log, room_id: 'general', from: alice, body: { text: `m${id}` }, ...fields };
}

const room = (id: string) => snapshot.rooms.find((entry) => entry.id === id)!;

describe('history per room', () => {
	beforeEach(async () => {
		await socket.greet(['history', 'rooms'], { room: { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '12', history_log_id: '10' } });
	});

	it('holds the published timeline until the recovery completes', async () => {
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'general', after: '10', before: '12' });
		socket.receive({ method: 'message', params: message('13') });
		expect(room('general')).toMatchObject({ recovering: true, loaded: false });
		expect(room('general').timeline.order).toEqual([]);
		// Operations already see the live record.
		expect(client.message('13')?.log_id).toBe('13');
		await socket.reply('history', { rooms: [{ room_id: 'general', log_id: '10', title: 'General' }], messages: [message('11'), message('12')], more: false, latest_log_id: '13', history_log_id: '10' });
		expect(room('general')).toMatchObject({ recovering: false, loaded: true });
		expect(room('general').timeline.order).toEqual(['11', '12', '13']);
	});

	it('loads a thread room only when asked, as its own room', async () => {
		await socket.reply('history', { messages: [], more: false, latest_log_id: '12', history_log_id: '10' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Side', latest_log_id: '22', history_log_id: '20' }] } });
		expect(socket.sent.filter((frame) => frame.method === 'history')).toHaveLength(1);
		expect(room('20')).toMatchObject({ parentRoomId: 'general', loaded: false, loading: false });
		const loaded = client.loadRoom('20');
		// The newest page first; older pages load on demand.
		expect(bounds(socket.request('history').params)).toEqual({ room_id: '20', before: '22' });
		expect(room('20').loading).toBe(true);
		await socket.reply('history', { messages: [message('21', { room_id: '20' }), message('22', { room_id: '20' })], more: false, latest_log_id: '22', history_log_id: '20' });
		await loaded;
		expect(room('20')).toMatchObject({ loaded: true, loading: false });
		expect(room('20').timeline.order).toEqual(['21', '22']);
		expect(room('general').timeline.order).toEqual([]);
	});

	it('opens a thread on its newest page and loads older pages backward to the floor', async () => {
		await socket.reply('history', { messages: [], more: false, latest_log_id: '12', history_log_id: '10' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Side', latest_log_id: '40', history_log_id: '20' }] } });
		const loaded = client.loadRoom('20');
		await socket.reply('history', { messages: [message('38', { room_id: '20' }), message('40', { room_id: '20' })], first_log_id: '38', last_log_id: '40', more: true, latest_log_id: '40', history_log_id: '20' });
		await loaded;
		expect(room('20')).toMatchObject({ loaded: true, olderAvailable: true });
		expect(room('20').timeline.order).toEqual(['38', '40']);

		const older = client.loadOlder('20');
		expect(room('20').loadingOlder).toBe(true);
		// A second call while one is in flight sends nothing more.
		void client.loadOlder('20');
		expect(socket.sent.filter((frame) => frame.method === 'history' && (frame.params as { room_id: string }).room_id === '20')).toHaveLength(2);
		expect(bounds(socket.request('history').params)).toEqual({ room_id: '20', before: '37' });
		await socket.reply('history', { messages: [message('25', { room_id: '20' }), message('30', { room_id: '20' })], first_log_id: '25', last_log_id: '30', more: true, latest_log_id: '40', history_log_id: '20' });
		await older;
		expect(room('20').timeline.order).toEqual(['25', '30', '38', '40']);
		expect(room('20')).toMatchObject({ olderAvailable: true });
		expect(room('20').loadingOlder).toBeUndefined();

		const oldest = client.loadOlder('20');
		expect(bounds(socket.request('history').params)).toEqual({ room_id: '20', before: '24' });
		await socket.reply('history', { rooms: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Side' }], messages: [message('21', { room_id: '20' })], first_log_id: '20', last_log_id: '21', more: false, latest_log_id: '40', history_log_id: '20' });
		await oldest;
		expect(room('20').timeline.order).toEqual(['21', '25', '30', '38', '40']);
		expect(room('20').olderAvailable).toBeUndefined();
	});

	it('has nothing older once retention passes the oldest loaded page, or when the newest page reaches the start', async () => {
		await socket.reply('history', { messages: [], more: false, latest_log_id: '12', history_log_id: '10' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Side', latest_log_id: '40', history_log_id: '20' }] } });
		const loaded = client.loadRoom('20');
		await socket.reply('history', { messages: [message('38', { room_id: '20' })], first_log_id: '38', last_log_id: '38', more: true, latest_log_id: '40', history_log_id: '20' });
		await loaded;
		expect(room('20').olderAvailable).toBe(true);
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Side', latest_log_id: '40', history_log_id: '39' }] } });
		expect(room('20').olderAvailable).toBeUndefined();
		// Nor where the newest page reaches the start.
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '50', log_id: '50', parent_room_id: 'general', title: 'Short', latest_log_id: '52', history_log_id: '50' }] } });
		const short = client.loadRoom('50');
		await socket.reply('history', { messages: [message('51', { room_id: '50' })], first_log_id: '50', last_log_id: '52', more: false, latest_log_id: '52', history_log_id: '50' });
		await short;
		expect(room('50').olderAvailable).toBeUndefined();
		await client.loadOlder('50');
		expect(socket.sent.filter((frame) => frame.method === 'history' && (frame.params as { room_id: string }).room_id === '50')).toHaveLength(1);
	});

	it('installs an embedded reply_to snapshot below its room bound', async () => {
		socket.receive({ method: 'message', params: message('20', { reply_to: { message_id: '5', log_id: '5', room_id: 'general', from: alice, body: { text: 'old' } } }) });
		expect(client.message('5')?.body).toEqual({ text: 'old' });
		await socket.reply('history', { messages: [message('11', { reply_to: { message_id: '6', log_id: '6', room_id: 'general', from: alice, body: { text: 'older' } } })], more: false, latest_log_id: '20', history_log_id: '10' });
		expect(client.message('5')?.body).toEqual({ text: 'old' });
		expect(client.message('6')?.body).toEqual({ text: 'older' });
	});

	it('starts at the lowest log_id when no bound is known', async () => {
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'nobound', log_id: '30', latest_log_id: '40' }] } });
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'nobound', after: '1', before: '40' });
	});

	it('retries a failed top-level recovery through loadRoom', async () => {
		socket.receive({ id: socket.request('history').id, error: { code: -32603, message: 'Busy' } });
		await settle();
		expect(room('general').recoveryError).toBe('Busy');
		const retried = client.loadRoom('general');
		expect(socket.request('history').params).toMatchObject({ after: '10', before: '12' });
		await socket.reply('history', { messages: [message('11')], more: false, latest_log_id: '12', history_log_id: '10' });
		await retried;
		expect(room('general').recoveryError).toBeUndefined();
		expect(room('general').timeline.order).toEqual(['11']);
	});

	it('waits out a refused page\'s retry_after, sending no history meanwhile, then recovers on its own', async () => {
		socket.receive({ id: socket.request('history').id, error: { code: -32002, message: 'History request limit reached', data: { retry_after: 20 } } });
		await settle();
		const now = Date.now();
		expect(room('general')).toMatchObject({ recovering: false, limited: true, recoveryError: 'History request limit reached. Try again in 20s.' });
		expect(snapshot.limits).toEqual({ history: { since: now, until: now + 20_000 } });
		// A request's limit is not the connection's: reconnecting is not held back.
		expect(snapshot.retryAfterMs).toBeUndefined();
		// The wait is shared: loading again, or another room's recovery, sends nothing until it is over.
		const retried = client.loadRoom('general');
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '30', title: 'Ops', latest_log_id: '31', history_log_id: '30' }] } });
		expect(room('ops')).toMatchObject({ recovering: true, limited: true });
		await vi.advanceTimersByTimeAsync(19_000);
		expect(socket.sent.filter((frame) => frame.method === 'history')).toHaveLength(1);
		expect(room('general')).toMatchObject({ recovering: true, limited: true });
		await vi.advanceTimersByTimeAsync(1_000);
		const sent = socket.sent.filter((frame) => frame.method === 'history');
		expect(sent.map((frame) => bounds(frame.params))).toEqual([
			{ room_id: 'general', after: '10', before: '12' },
			{ room_id: 'general', after: '10', before: '12' },
			{ room_id: 'ops', after: '30', before: '31' }
		]);
		expect(snapshot.limits).toBeUndefined();
		expect(room('general').limited).toBeUndefined();
		socket.receive({ id: sent[1].id as string, result: { messages: [message('11')], more: false, latest_log_id: '12', history_log_id: '10' } });
		await retried;
		expect(room('general')).toMatchObject({ recovering: false, loaded: true });
		expect(room('general').recoveryError).toBeUndefined();
		expect(room('general').timeline.order).toEqual(['11']);
	});

	it('loads a thread refused for the history wait once the wait is over, without failing', async () => {
		await socket.reply('history', { messages: [], more: false, latest_log_id: '12', history_log_id: '10' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Side', latest_log_id: '22', history_log_id: '20' }] } });
		let settled = false;
		const loaded = client.loadRoom('20').then(() => (settled = true));
		socket.receive({ id: socket.request('history').id, error: { code: -32002, message: 'History request limit reached', data: { retry_after: 5 } } });
		await settle();
		expect(room('20')).toMatchObject({ loading: true, limited: true, loaded: false });
		expect(room('20').recoveryError).toBeUndefined();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(bounds(socket.request('history').params)).toEqual({ room_id: '20', before: '22' });
		expect(settled).toBe(false);
		await socket.reply('history', { messages: [message('21', { room_id: '20' })], more: false, latest_log_id: '22', history_log_id: '20' });
		await loaded;
		expect(room('20')).toMatchObject({ loading: false, loaded: true });
		expect(room('20').limited).toBeUndefined();
	});

	it('leaves a recovery that failed for another reason to loadRoom', async () => {
		socket.receive({ id: socket.request('history').id, error: { code: -32603, message: 'Internal error' } });
		await settle();
		expect(room('general').recoveryError).toBe('Internal error');
		await vi.advanceTimersByTimeAsync(120_000);
		expect(socket.sent.filter((frame) => frame.method === 'history')).toHaveLength(1);
	});
});

describe('a room shown for its messages (no cap rooms)', () => {
	it('recovers a room shown for its messages up to the first one on each connection', async () => {
		await socket.greet(['history'], { rooms: false });
		socket.receive({ method: 'message', params: { message_id: '20', log_id: '20', room_id: 'lobby', from: { user_id: 'bob' }, body: { text: 'live' } } });
		expect(socket.request('history').params).toMatchObject({ room_id: 'lobby', after: '1', before: '20' });
		await socket.reply('history', { messages: [{ message_id: '15', log_id: '15', room_id: 'lobby', from: { user_id: 'bob' }, body: { text: 'old' } }], more: false, latest_log_id: '20', history_log_id: '1' });
		expect(snapshot.rooms[0].timeline.order).toEqual(['15', '20']);
		socket.receive({ method: 'message', params: { message_id: '21', log_id: '21', room_id: 'lobby', from: { user_id: 'bob' }, body: { text: 'next' } } });
		expect(socket.sent.filter((frame) => frame.method === 'history')).toHaveLength(1);
	});
});

describe('after a reconnect', () => {
	const general = { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '12', history_log_id: '10' };
	const entry = (id: string) => ({ message_id: id, log_id: id, room_id: 'general', from: { user_id: 'guest_1' }, body: { text: id } });

	it('never marks a first load, or a reconnect that history fully recovers', async () => {
		await latest().greet(['history', 'rooms'], { room: general });
		expect(snapshot.showReconnectDivider).toBe(false);
		await latest().reply('history', { messages: [entry('11'), entry('12')], more: false, latest_log_id: '12', history_log_id: '10' });
		expect(snapshot.rooms[0].recovering).toBe(false);
		expect(snapshot.showReconnectDivider).toBe(false);
		// A thread's first load is not a reconnect either.
		latest().receive({ method: 'room_update', params: { joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Side', latest_log_id: '21', history_log_id: '20' }] } });
		const load = client.loadRoom('20');
		await latest().reply('history', { messages: [{ ...entry('21'), room_id: '20' }], more: false, latest_log_id: '21', history_log_id: '20' });
		await load;
		expect(snapshot.showReconnectDivider).toBe(false);

		latest().drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet(['history', 'rooms'], { room: general });
		// The kept room resumed right behind auth, from its checkpoint; one empty page settles it.
		expect(latest().sent.filter((frame) => frame.method === 'history').map((frame) => bounds(frame.params))).toEqual([{ room_id: 'general', after: '13' }]);
		await latest().reply('history', { more: false, latest_log_id: '12', history_log_id: '10' });
		expect(snapshot.rooms.find((candidate) => candidate.id === 'general')?.timeline.order).toEqual(['11', '12']);
		expect(snapshot.rooms.find((candidate) => candidate.id === 'general')?.recovering).toBe(false);
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.showReconnectDivider).toBe(false);
	});

	it('resumes a room from its checkpoint after a reconnect instead of paging all history', async () => {
		await latest().greet(['history', 'rooms'], { room: general });
		await latest().reply('history', { messages: [entry('11'), entry('12')], more: false, latest_log_id: '12', history_log_id: '10' });
		latest().drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet(['history', 'rooms'], { room: { ...general, latest_log_id: '14' } });
		// Sent before the listing named a head: it pages to the end of the log, whose head the page reports.
		expect(bounds(latest().request('history').params)).toEqual({ room_id: 'general', after: '13' });
		await latest().reply('history', { messages: [entry('13')], first_log_id: '13', last_log_id: '13', more: true, latest_log_id: '14', history_log_id: '10' });
		expect(bounds(latest().request('history').params)).toEqual({ room_id: 'general', after: '14', before: '14' });
		await latest().reply('history', { messages: [entry('14')], first_log_id: '14', last_log_id: '14', more: false, latest_log_id: '14', history_log_id: '10' });
		expect(snapshot.rooms.find((candidate) => candidate.id === 'general')?.timeline.order).toEqual(['11', '12', '13', '14']);
		expect(snapshot.showReconnectDivider).toBe(false);
	});

	it('rebuilds a kept room when retention has passed its checkpoint', async () => {
		await latest().greet(['history', 'rooms'], { room: general });
		await latest().reply('history', { messages: [entry('11'), entry('12')], more: false, latest_log_id: '12', history_log_id: '10' });
		latest().drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet(['history', 'rooms'], { room: { ...general, latest_log_id: '30', history_log_id: '20' } });
		expect(latest().request('history').params).toMatchObject({ room_id: 'general', after: '20', before: '30' });
		await latest().reply('history', { messages: [entry('25')], more: false, latest_log_id: '30', history_log_id: '20' });
		expect(snapshot.rooms.find((candidate) => candidate.id === 'general')?.timeline.order).toEqual(['25']);
	});

	it('catches a kept thread up from its checkpoint when it is loaded again', async () => {
		await latest().greet(['history', 'rooms'], { room: general });
		await latest().reply('history', { messages: [entry('11'), entry('12')], more: false, latest_log_id: '12', history_log_id: '10' });
		const thread = { room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Side', latest_log_id: '21', history_log_id: '20' };
		latest().receive({ method: 'room_update', params: { joined: [thread] } });
		const load = client.loadRoom('20');
		await latest().reply('history', { messages: [{ ...entry('21'), room_id: '20' }], more: false, latest_log_id: '21', history_log_id: '20' });
		await load;
		latest().drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet(['history', 'rooms'], { room: general });
		latest().receive({ method: 'room_update', params: { joined: [{ ...thread, latest_log_id: '23' }] } });
		// Kept, but the gap since its checkpoint is not loaded yet.
		expect(snapshot.rooms.find((candidate) => candidate.id === '20')?.loaded).toBe(false);
		const again = client.loadRoom('20');
		expect(latest().request('history').params).toMatchObject({ room_id: '20', after: '22', before: '23' });
		await latest().reply('history', { messages: [{ ...entry('23'), room_id: '20' }], more: false, latest_log_id: '23', history_log_id: '20' });
		await again;
		const side = snapshot.rooms.find((candidate) => candidate.id === '20');
		expect(side?.loaded).toBe(true);
		expect(side?.timeline.order).toEqual(['21', '23']);
	});

	it('lists again in full when a token resume signs in someone else', async () => {
		latest().open();
		latest().receive({ method: 'server', params: { apron: 9, auth: ['guest', 'token'], capabilities: ['history', 'rooms'] } });
		await latest().reply('auth', { you: { user_id: 'ada', name: 'Ada' }, token: 'secret' });
		await latest().reply('room_list', { joined: [general], users: [] });
		await latest().reply('history', { messages: [entry('11'), entry('12')], more: false, latest_log_id: '12', history_log_id: '10' });
		latest().drop();
		vi.advanceTimersByTime(5_000);
		socket = latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest', 'token'], capabilities: ['history', 'rooms'] } });
		expect(socket.request('room_list').params).toMatchObject({ latest_log_id: '12' });
		// The token now signs in someone else: the changes since belong to another identity, so list again in full.
		await socket.reply('auth', { you: { user_id: 'bob', name: 'Bob' } });
		const delta = socket.request('room_list');
		await socket.reply('room_list', { joined: [], left: [], users: [] });
		const full = socket.request('room_list');
		expect(full.id).not.toBe(delta.id);
		expect(full.params).toEqual({ filter: 'joined', members: true });
		// A result without left is a full listing: general is not Bob's.
		await socket.reply('room_list', { joined: [{ room_id: 'ops', log_id: '30', title: 'Ops', latest_log_id: '30', history_log_id: '30' }], users: [] });
		expect(snapshot.rooms.map((candidate) => candidate.id)).toEqual(['ops']);
	});

	it('marks a reconnect to a server without history, whose earlier messages are gone', async () => {
		await latest().greet();
		latest().receive({ method: 'message', params: { ...entry('11'), room_id: 'lobby' } });
		expect(snapshot.showReconnectDivider).toBe(false);
		latest().drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet();
		expect(snapshot.authenticated).toBe(true);
		expect(snapshot.showReconnectDivider).toBe(true);
	});

	it('shows a logged ~server notice and resumes the room right behind auth', async () => {
		await socket.greet(['history', 'rooms', 'activity', 'embed:upload'], { room: { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '10', history_log_id: '10' } });
		await socket.reply('history', { more: false, latest_log_id: '10', history_log_id: '10' });
		// A notice takes a log_id past the room's logged head.
		socket.receive({ method: 'message', params: { message_id: '15', log_id: '15', room_id: 'general', from: { user_id: '~server', name: 'Server' }, body: { text: 'Typing updates are limited', format: 'plain' } } });
		const general = () => snapshot.rooms.find((room) => room.id === 'general')!;
		expect(general().timeline.order).toContain('15');
		socket.drop();
		client.retryNow();
		socket = FakeSocket.latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['history', 'rooms', 'activity'] } });
		// auth, the listing, and the kept room's recovery go out together, before any reply (§3.2).
		expect(socket.sent.map((frame) => frame.method)).toEqual(['auth', 'room_list', 'history']);
		expect(socket.request('room_list').params).toEqual({ filter: 'joined', members: true });
		// Without a head yet, it pages from the checkpoint to the end of the log.
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'general', after: '11' });
		await socket.reply('auth', { you: { user_id: 'guest_2', name: 'Guest' } });
		await socket.reply('room_list', { joined: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '15', history_log_id: '10', members: [{ user_id: 'guest_2' }] }], users: [] });
		await socket.reply('history', { messages: [{ message_id: '12', log_id: '12', room_id: 'general', from: { user_id: 'bob', name: 'Bob' }, body: { text: 'hi' } }], first_log_id: '12', last_log_id: '15', more: false, latest_log_id: '15', history_log_id: '10' });
		// One page settles it.
		expect(socket.sent.filter((frame) => frame.method === 'history')).toHaveLength(1);
		expect(general().timeline.order).toEqual(['12', '15']);
		expect(general().members?.map((member) => member.user_id)).toEqual(['guest_2']);
		expect(general().recovering).toBe(false);
	});
});
