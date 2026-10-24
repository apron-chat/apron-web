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
		// No checkpoint yet: only the newest page, up to the head (§4.3.5).
		expect(socket.request('history').params).toEqual({ room_id: 'general', before: '12', limit: 50 });
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

	it('opens a room on its newest page, loads older pages backward on demand, and resumes forward from there', async () => {
		await socket.reply('history', { messages: [message('11')], more: false, latest_log_id: '12', history_log_id: '10' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '30', title: 'Ops', latest_log_id: '90', history_log_id: '30' }] } });
		const ops = (id: string) => message(id, { room_id: 'ops' });
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'ops', before: '90' });
		// Live records meanwhile are kept, as in any recovery.
		socket.receive({ method: 'message', params: ops('91') });
		await socket.reply('history', { messages: [ops('80'), ops('90')], first_log_id: '80', last_log_id: '90', more: true, latest_log_id: '91', history_log_id: '30' });
		expect(room('ops')).toMatchObject({ recovering: false, loaded: true, olderAvailable: true });
		expect(room('ops').timeline.order).toEqual(['80', '90', '91']);
		// One request opened it, however long its log.
		expect(socket.sent.filter((frame) => frame.method === 'history' && (frame.params as { room_id: string }).room_id === 'ops')).toHaveLength(1);
		const older = client.loadOlder('ops');
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'ops', before: '79' });
		await socket.reply('history', { rooms: [{ room_id: 'ops', log_id: '30', title: 'Ops' }], messages: [ops('40')], first_log_id: '30', last_log_id: '40', more: false, latest_log_id: '91', history_log_id: '30' });
		await older;
		expect(room('ops').timeline.order).toEqual(['40', '80', '90', '91']);
		expect(room('ops').olderAvailable).toBeUndefined();
		// Its checkpoint is the head it opened at: a newer head resumes forward from there.
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'ops', log_id: '30', title: 'Ops', latest_log_id: '93', history_log_id: '30' }] } });
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'ops', after: '91', before: '93' });
	});

	it('opens a room with no lower bound known on its newest page too, and skips one whose history is all gone', async () => {
		await socket.reply('history', { messages: [], more: false, latest_log_id: '12', history_log_id: '10' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'nobound', log_id: '30', latest_log_id: '40' }] } });
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'nobound', before: '40' });
		const sent = socket.sent.length;
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'gone', log_id: '30', latest_log_id: '40', history_log_id: null }] } });
		expect(room('gone')).toMatchObject({ recovering: false, loaded: true });
		expect(socket.sent.slice(sent).filter((frame) => frame.method === 'history')).toEqual([]);
	});

	it('keeps the newest page it asked for when retention moves meanwhile, without what fell below the bound', async () => {
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '12', history_log_id: '11' }] } });
		expect(socket.sent.filter((frame) => frame.method === 'history')).toHaveLength(1);
		await socket.reply('history', { messages: [message('10'), message('11'), message('12')], first_log_id: '10', last_log_id: '12', more: false, latest_log_id: '12', history_log_id: '11' });
		expect(room('general')).toMatchObject({ recovering: false, loaded: true });
		expect(room('general').timeline.order).toEqual(['11', '12']);
	});

	it('retries a failed top-level recovery through loadRoom', async () => {
		socket.receive({ id: socket.request('history').id, error: { code: -32603, message: 'Busy' } });
		await settle();
		expect(room('general').recoveryError).toBe('Busy');
		const retried = client.loadRoom('general');
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'general', before: '12' });
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
		// Then they go one at a time, the open room's first.
		const sent = () => socket.sent.filter((frame) => frame.method === 'history').map((frame) => bounds(frame.params));
		expect(sent()).toEqual([{ room_id: 'general', before: '12' }, { room_id: 'general', before: '12' }]);
		expect(snapshot.limits).toBeUndefined();
		expect(room('general').limited).toBeUndefined();
		await socket.reply('history', { messages: [message('11')], more: false, latest_log_id: '12', history_log_id: '10' });
		await retried;
		expect(sent().at(-1)).toEqual({ room_id: 'ops', before: '31' });
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

	it('sends the next history request only once the server answers one taken back', async () => {
		const general = socket.request('history');
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '30', title: 'Ops', latest_log_id: '31', history_log_id: '30' }] } });
		// Left while its page is out: the page is for nothing, but the server is still working on it.
		socket.receive({ method: 'room_update', params: { left: [{ room_id: 'general' }] } });
		await settle();
		const history = () => socket.sent.filter((frame) => frame.method === 'history').map((frame) => bounds(frame.params));
		expect(history()).toEqual([{ room_id: 'general', before: '12' }]);
		socket.receive({ id: general.id, result: { messages: [message('11')], more: false, latest_log_id: '12', history_log_id: '10' } });
		await settle();
		expect(history()).toEqual([{ room_id: 'general', before: '12' }, { room_id: 'ops', before: '31' }]);
		expect(snapshot.limits).toBeUndefined();
	});

	it('sends the next history request after one that timed out once its late answer comes', async () => {
		const general = socket.request('history');
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '30', title: 'Ops', latest_log_id: '31', history_log_id: '30' }] } });
		await vi.advanceTimersByTimeAsync(20_000);
		expect(room('general').recoveryError).toBe('history request timed out');
		const history = () => socket.sent.filter((frame) => frame.method === 'history').map((frame) => bounds(frame.params));
		expect(history()).toEqual([{ room_id: 'general', before: '12' }]);
		socket.receive({ id: general.id, result: { more: false, latest_log_id: '12', history_log_id: '10' } });
		await settle();
		expect(history()).toEqual([{ room_id: 'general', before: '12' }, { room_id: 'ops', before: '31' }]);
	});

	it('drops an older page held for a wait when its room is rebuilt, so it goes first once the wait is over', async () => {
		await socket.reply('history', { messages: [message('11'), message('12')], first_log_id: '11', last_log_id: '12', more: true, latest_log_id: '12', history_log_id: '10' });
		expect(room('general').olderAvailable).toBe(true);
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '30', title: 'Ops', latest_log_id: '31', history_log_id: '30' }] } });
		socket.receive({ id: socket.request('history').id, error: { code: -32002, message: 'History request limit reached', data: { retry_after: 20 } } });
		await settle();
		const older = client.loadOlder('general').catch((cause: Error) => cause.message);
		// Retention passes the checkpoint: rebuilt, so the page before what it had is for nothing.
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '20', history_log_id: '15' }] } });
		expect(await older).toBe('History recovery superseded');
		await vi.advanceTimersByTimeAsync(20_000);
		const history = () => socket.sent.filter((frame) => frame.method === 'history').map((frame) => bounds(frame.params));
		expect(history().slice(2)).toEqual([{ room_id: 'general', before: '20' }]);
	});

	it('sends a thread\'s page again after a refusal whose wait is already over', async () => {
		await socket.reply('history', { messages: [], more: false, latest_log_id: '12', history_log_id: '10' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Side', latest_log_id: '22', history_log_id: '20' }] } });
		const loaded = client.loadRoom('20');
		socket.receive({ id: socket.request('history').id, error: { code: -32002, message: 'History request limit reached', data: { retry_after: 0 } } });
		await vi.advanceTimersByTimeAsync(0);
		expect(room('20').recoveryError).toBeUndefined();
		expect(socket.sent.filter((frame) => frame.method === 'history' && (frame.params as { room_id: string }).room_id === '20')).toHaveLength(2);
		await socket.reply('history', { messages: [message('21', { room_id: '20' })], more: false, latest_log_id: '22', history_log_id: '20' });
		await loaded;
		expect(room('20')).toMatchObject({ loading: false, loaded: true });
	});

	it('goes on from where a recovery refused for the history wait stopped, keeping what it had, once the wait is over', async () => {
		await socket.reply('history', { messages: [message('11'), message('12')], first_log_id: '11', last_log_id: '12', more: true, latest_log_id: '12', history_log_id: '10' });
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '20', history_log_id: '10' }] } });
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'general', after: '13', before: '20' });
		await socket.reply('history', { messages: [message('13'), message('15')], first_log_id: '13', last_log_id: '15', more: true, latest_log_id: '20', history_log_id: '10' });
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'general', after: '16', before: '20' });
		socket.receive({ id: socket.request('history').id, error: { code: -32002, message: 'History request limit reached', data: { retry_after: 20 } } });
		await settle();
		// Live meanwhile: what arrives while the rest waits stays.
		socket.receive({ method: 'message', params: message('21') });
		await vi.advanceTimersByTimeAsync(20_000);
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'general', after: '16', before: '21' });
		await socket.reply('history', { messages: [message('18')], first_log_id: '16', last_log_id: '21', more: false, latest_log_id: '21', history_log_id: '10' });
		expect(room('general')).toMatchObject({ recovering: false, loaded: true, olderAvailable: true });
		expect(room('general').timeline.order).toEqual(['11', '12', '13', '15', '18', '21']);
	});

	it('keeps showing what a room had while its rebuild waits out a history wait', async () => {
		await socket.reply('history', { messages: [message('11'), message('12')], more: false, latest_log_id: '12', history_log_id: '10' });
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '14', history_log_id: '10' }] } });
		socket.receive({ id: socket.request('history').id, error: { code: -32002, message: 'Daily history limit reached', data: { retry_after: 3_600 } } });
		await settle();
		// The next room frame rebuilds the room (history-recovery-failure.json), but its page waits for hours.
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '15', history_log_id: '10' }] } });
		socket.receive({ method: 'message', params: message('16') });
		expect(room('general')).toMatchObject({ recovering: true, limited: true });
		expect(room('general').timeline.order).toEqual(['11', '12']);
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'general', before: '15' });
		await socket.reply('history', { messages: [message('14'), message('15')], first_log_id: '14', last_log_id: '15', more: true, latest_log_id: '16', history_log_id: '10' });
		// Then replaced by what the rebuild found, with what arrived live meanwhile.
		expect(room('general').timeline.order).toEqual(['14', '15', '16']);
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
		expect(bounds(socket.request('history').params)).toEqual({ room_id: 'lobby', before: '20' });
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

	it('sends history one request at a time, and none for a kept room the listing shows has nothing new', async () => {
		await latest().greet(['history', 'rooms'], { room: general });
		await latest().reply('history', { messages: [entry('11'), entry('12')], more: false, latest_log_id: '12', history_log_id: '10' });
		const ops = { room_id: 'ops', log_id: '20', title: 'Ops', latest_log_id: '21', history_log_id: '20' };
		const quiet = { room_id: 'quiet', log_id: '30', title: 'Quiet', latest_log_id: '31', history_log_id: '30' };
		latest().receive({ method: 'room_update', params: { joined: [ops, quiet] } });
		const history = () => latest().sent.filter((frame) => frame.method === 'history').map((frame) => bounds(frame.params));
		// Each recovers in turn: the next goes once the last is answered.
		expect(history().slice(1)).toEqual([{ room_id: 'ops', before: '21' }]);
		await latest().reply('history', { more: false, latest_log_id: '21', history_log_id: '20' });
		expect(history().slice(1)).toEqual([{ room_id: 'ops', before: '21' }, { room_id: 'quiet', before: '31' }]);
		await latest().reply('history', { more: false, latest_log_id: '31', history_log_id: '30' });
		latest().drop();
		vi.advanceTimersByTime(5_000);
		const again = latest();
		again.open();
		again.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['history', 'rooms'] } });
		// The first kept room resumes right behind auth; the others wait their turn.
		expect(history()).toEqual([{ room_id: 'general', after: '13' }]);
		await again.reply('auth', { you: { user_id: 'guest_1', name: 'Guest' } });
		// The listing says ops has nothing new and quiet has: ops's resume never goes, quiet's pages only to its head.
		await again.reply('room_list', { joined: [general, ops, { ...quiet, latest_log_id: '35' }] });
		expect(snapshot.rooms.find((candidate) => candidate.id === 'ops')).toMatchObject({ recovering: false, loaded: true });
		await again.reply('history', { more: false, latest_log_id: '12', history_log_id: '10' });
		expect(history()).toEqual([{ room_id: 'general', after: '13' }, { room_id: 'quiet', after: '32', before: '35' }]);
	});

	it('rebuilds a kept room when retention has passed its checkpoint', async () => {
		await latest().greet(['history', 'rooms'], { room: general });
		await latest().reply('history', { messages: [entry('11'), entry('12')], more: false, latest_log_id: '12', history_log_id: '10' });
		latest().drop();
		vi.advanceTimersByTime(5_000);
		await latest().greet(['history', 'rooms'], { room: { ...general, latest_log_id: '30', history_log_id: '20' } });
		// The resume sent behind auth is for nothing now, but out: the rebuild goes once it is answered.
		expect(bounds(latest().request('history').params)).toEqual({ room_id: 'general', after: '13' });
		await latest().reply('history', { more: false, latest_log_id: '30', history_log_id: '20' });
		// Rebuilt as a first visit is: the newest page.
		expect(bounds(latest().request('history').params)).toEqual({ room_id: 'general', before: '30' });
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
		// One at a time: after the room's resume, which went right behind auth.
		expect(bounds(latest().request('history').params)).toEqual({ room_id: 'general', after: '13' });
		await latest().reply('history', { more: false, latest_log_id: '12', history_log_id: '10' });
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
