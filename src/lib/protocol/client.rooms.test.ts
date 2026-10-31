import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { childRooms, DEFAULT_ROOM_ID, topLevelRooms, type ChatClient, type ClientSnapshot } from './client';
import { FakeSocket, quiet, settle, startClient, type ClientHarness } from '$lib/test/client';
import { bounds } from '$lib/test/client-history';

/**
 * Rooms, membership and threads (§3.4, §4.2): the joined set, member lists,
 * threads read without joining, room records, and the default room of a
 * server without capability `rooms`. The shared fixtures `auth-barrier.json`,
 * `membership.json`, `rooms.json` and `core-session.json`
 * (wire-session.test.ts) cover the wire exchanges; these cover what the
 * snapshot shows.
 */
let harness: ClientHarness;
let client: ChatClient;
let socket: FakeSocket;
let snapshot: ClientSnapshot;

beforeEach(() => {
	vi.useFakeTimers();
	harness = startClient({ onSnapshot: (next) => (snapshot = next) });
	({ client, socket } = harness);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const ids = () => snapshot.rooms.map((room) => room.id);
const room = (id: string) => snapshot.rooms.find((candidate) => candidate.id === id);

async function authenticate(caps: string[]): Promise<void> {
	socket.open();
	socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: caps } });
	await socket.reply('auth', { you: { user_id: 'guest_1', name: 'Guest' } });
}

/** The connection drops, and the next one opens a moment later. */
function reconnect(): void {
	socket = harness.reconnect();
}

describe('the joined set (cap rooms)', () => {
	it('lists the joined rooms with their members right behind auth, threads included, then follows room_update', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		// Auth is a barrier (§3.2): the listing goes out before its result.
		expect(socket.sent.map((frame) => frame.method)).toEqual(['auth', 'room_list']);
		expect(socket.request('room_list').params).toEqual({ filter: 'joined', members: true });
		await socket.reply('auth', { you: { user_id: 'guest_1', name: 'Guest' } });
		expect(snapshot.rooms).toEqual([]);
		await socket.reply('room_list', {
			joined: [
				{ room_id: 't1', log_id: '12', parent_room_id: 'general', title: 'Deploy', members: [{ user_id: 'bob' }, { user_id: 'guest_1' }] },
				{ room_id: 'general', log_id: '10', title: 'General', members: [{ user_id: 'guest_1' }] }
			],
			users: [{ user_id: 'bob', name: 'Bob' }, { user_id: 'guest_1', name: 'Guest' }]
		});
		expect(ids()).toEqual(['t1', 'general']);
		expect(snapshot.rooms.every((entry) => entry.joined)).toBe(true);
		// The first top-level room opens; a thread never does on its own.
		expect(snapshot.activeRoom).toBe('general');
		expect(room('t1')?.members).toEqual([{ user_id: 'bob' }, { user_id: 'guest_1' }]);
		expect(snapshot.users.bob).toEqual({ user_id: 'bob', name: 'Bob' });

		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '20', title: 'Ops', members: [{ user_id: 'dana' }, { user_id: 'guest_1' }] }], users: [{ user_id: 'dana', name: 'Dana' }] } });
		expect(room('ops')?.members?.map((member) => member.user_id)).toEqual(['dana', 'guest_1']);
		expect(snapshot.users.dana).toEqual({ user_id: 'dana', name: 'Dana' });
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '21', title: 'General (ops)' }] } });
		expect(ids()).toEqual(['t1', 'general', 'ops']);
		expect(room('general')?.title).toBe('General (ops)');
		// A new thread in a joined room, not joined itself: listed to join, not visible.
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 't2', log_id: '22', parent_room_id: 'general', title: 'Incident' }] } });
		expect(ids()).not.toContain('t2');
		expect(snapshot.threadDirectory.general?.map((listing) => [listing.id, listing.title, listing.joined])).toEqual([['t2', 'Incident', false]]);
		socket.receive({ method: 'room_update', params: { left: [{ room_id: 'general' }] } });
		expect(ids()).toEqual(['t1', 'ops']);
		expect(snapshot.activeRoom).toBe('ops');
	});

	it('takes the joined set anew on each connection', async () => {
		await authenticate(['rooms']);
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }, { room_id: 'ops', title: 'Ops' }] });
		socket.drop();
		vi.advanceTimersByTime(5_000);
		socket = FakeSocket.latest();
		await authenticate(['rooms']);
		expect(snapshot.rooms).toEqual([]);
		await socket.reply('room_list', { joined: [{ room_id: 'ops', title: 'Ops' }] });
		expect(ids()).toEqual(['ops']);
	});
	it('treats room IDs starting with @ as ordinary rooms and has no Server room', async () => {
		await authenticate(['rooms']);
		await socket.reply('room_list', { joined: [{ room_id: '@ops', title: 'At ops' }, { room_id: 'general', title: 'General' }] });
		expect(snapshot.rooms.map((entry) => [entry.id, entry.title])).toEqual([['@ops', 'At ops'], ['general', 'General']]);
		expect(snapshot.activeRoom).toBe('@ops');
		// A server-wide notice names a room like any message; a room not joined is not shown for it.
		socket.receive({ method: 'message', params: { message_id: '40', log_id: '40', room_id: 'general', from: { user_id: '~server', name: 'Server' }, body: { text: 'Maintenance at 17:00' } } });
		expect(room('general')?.timeline.order).toEqual(['40']);
		expect(room('general')?.notices).toEqual([]);
		expect(room('~server')).toBeUndefined();
		// A message in a room not joined is stored, not shown.
		socket.receive({ method: 'message', params: { message_id: '41', log_id: '41', room_id: 'elsewhere', from: { user_id: 'bob' }, body: { text: 'x' } } });
		expect(room('elsewhere')).toBeUndefined();
		expect(client.message('41')?.room_id).toBe('elsewhere');
	});

	it('keeps member lists from listings and memberships, whichever order they arrive in', async () => {
		await authenticate(['rooms', 'history']);
		// A guest's own join may arrive before anything is listed (the Go server logs it at auth).
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '11', room_id: 'general', members: [{ user: { user_id: 'guest_1', name: 'Guest' }, joined: true }] }] } });
		await socket.reply('room_list', { joined: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '11', history_log_id: '10', members: [{ user_id: 'bob' }, { user_id: 'guest_1' }] }], users: [] });
		await socket.reply('history', { memberships: [{ log_id: '11', room_id: 'general', members: [{ user: { user_id: 'guest_1' }, joined: true }] }], first_log_id: '11', last_log_id: '11', more: false, latest_log_id: '11', history_log_id: '10' });
		expect(room('general')?.members?.map((member) => member.user_id)).toEqual(['bob', 'guest_1']);
		// Joining: one room_update with the room, its members, and the membership, then the result (§4.2.2).
		const joined = client.joinRoom('ops');
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '20', title: 'Ops', latest_log_id: '21', history_log_id: '20', members: [{ user_id: 'dana' }, { user_id: 'guest_1' }] }], memberships: [{ log_id: '21', room_id: 'ops', members: [{ user: { user_id: 'guest_1', name: 'Guest' }, joined: true }] }], users: [{ user_id: 'dana', name: 'Dana' }, { user_id: 'guest_1', name: 'Guest' }] } });
		expect(ids()).toEqual(['general', 'ops']);
		await socket.reply('room_join', {});
		await expect(joined.promise).resolves.toEqual({});
		// Creating: the room with its members and the creator's membership at its head, then the result.
		const created = client.createRoom({ parentRoomId: 'general', title: 'Deploy' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '30', log_id: '30', parent_room_id: 'general', title: 'Deploy', latest_log_id: '31', history_log_id: '30', members: [{ user_id: 'guest_1' }] }], memberships: [{ log_id: '31', room_id: '30', members: [{ user: { user_id: 'guest_1', name: 'Guest' }, joined: true }] }] } });
		expect(room('30')?.members).toEqual([{ user_id: 'guest_1' }]);
		expect(room('30')?.latestLogId).toBe('31');
		await socket.reply('room_set', { room_id: '30' });
		await expect(created.promise).resolves.toEqual({ room_id: '30' });
		// Someone else leaves: the other members get the membership alone, and the lists follow.
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '32', room_id: 'ops', members: [{ user: { user_id: 'dana', name: 'Dana' }, joined: false }] }] } });
		expect(room('ops')?.members?.map((member) => member.user_id)).toEqual(['guest_1']);
		expect(room('ops')?.latestLogId).toBe('32');
		// A record may carry several members (§4.2.2).
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '33', room_id: 'ops', members: [{ user: { user_id: 'erin' }, joined: true }, { user: { user_id: 'finn' }, joined: true }] }] } });
		expect(room('ops')?.members?.map((member) => member.user_id)).toEqual(['guest_1', 'erin', 'finn']);
		// Your own leave: the room goes, with the membership in the same room_update.
		socket.receive({ method: 'room_update', params: { left: [{ room_id: 'ops' }], memberships: [{ log_id: '34', room_id: 'ops', members: [{ user: { user_id: 'guest_1' }, joined: false }] }] } });
		expect(ids()).toEqual(['general', '30']);
		await settle();
	});

	it('keeps a failed auth\'s word and shows no rooms, whether the listing behind it is denied or answered', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		socket.receive({ id: socket.request('auth').id, error: { code: -32001, message: 'Guests are not accepted right now' } });
		await settle();
		// Denied, as the requests behind a failed auth are (§3.2): the listing's own error is not reported.
		socket.receive({ id: socket.request('room_list').id, error: { code: -32001, message: 'Denied' } });
		await settle();
		expect(snapshot.error).toBe('Guests are not accepted right now');
		expect(snapshot.authenticated).toBe(false);
		expect(snapshot.rooms).toEqual([]);
		// A failed auth leaves the connection's authentication as it was (§3.2), so a server may answer the listing
		// anyway: it is dropped, as the connection is signed in as no one.
		socket.drop();
		client.retryNow();
		socket = FakeSocket.latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		socket.receive({ id: socket.request('auth').id, error: { code: -32001, message: 'Guests are not accepted right now' } });
		await settle();
		socket.receive({ id: socket.request('room_list').id, result: { joined: [{ room_id: 'general', title: 'General' }] } });
		await settle();
		expect(snapshot.error).toBe('Guests are not accepted right now');
		expect(snapshot.rooms).toEqual([]);
	});

	it('lists the joined rooms again when the connection becomes another user', async () => {
		await socket.greet([], { room: { room_id: 'general', title: 'General' } });
		socket.receive({ method: 'user', params: { you: { user_id: 'guest_1', name: 'Renamed' } } });
		expect(socket.sent.filter((frame) => frame.method === 'room_list')).toHaveLength(1);
		socket.receive({ method: 'user', params: { you: { user_id: 'ada', name: 'Ada' } } });
		expect(socket.sent.filter((frame) => frame.method === 'room_list')).toHaveLength(2);
		await socket.reply('room_list', { joined: [{ room_id: 'ops', title: 'Ops' }] });
		expect(ids()).toEqual(['ops']);
	});

	it('exposes room records and the parent relationship, and titles them by the naming rule', async () => {
		await socket.greet(['edit', 'rooms', 'reactions'], { room: { room_id: 'general', log_id: '10', title: 'General' } });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'thread', log_id: '20', parent_room_id: 'general', title: 'Side', description: 'Why *side*' }] } });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops' }, { room_id: 'blank', title: '  ' }, { room_id: 't2', parent_room_id: 'general', title: ' ' }] } });
		expect(snapshot.activeRoom).toBe('general');
		expect(topLevelRooms(snapshot.rooms).map((entry) => entry.id)).toEqual(['general', 'ops', 'blank']);
		expect(childRooms(snapshot.rooms, 'general').map((entry) => [entry.id, entry.title, entry.description])).toEqual([['thread', 'Side', 'Why *side*'], ['t2', 'Untitled', undefined]]);
		// A room without a title (a blank one counts as none) is its room_id; a thread is Untitled, and says so (`naming.ts`).
		expect(snapshot.rooms.map((entry) => [entry.id, entry.title, entry.untitled])).toEqual([
			['general', 'General', undefined], ['thread', 'Side', undefined], ['ops', 'ops', undefined], ['blank', 'blank', undefined], ['t2', 'Untitled', true]
		]);
		expect(room('ops')?.description).toBeUndefined();
		expect(room('ops')?.private).toBeUndefined();
		socket.receive({ method: 'room_update', params: { left: [{ room_id: 'general' }] } });
		expect(snapshot.activeRoom).toBe('ops');
	});
});

describe('transient notices', () => {
	it('shows transient notices in their room for the session and never stores them', async () => {
		await authenticate(['rooms']);
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General', latest_log_id: '30' }] });
		socket.receive({ method: 'message', params: { message_id: '31', log_id: '31', room_id: 'general', from: { user_id: 'bob' }, body: { text: 'hi' } } });
		socket.receive({ method: 'message', params: { room_id: 'general', from: { user_id: '~private', name: 'Only you' }, body: { text: 'Welcome', format: 'markdown' } } });
		// Without room_id it shows where you are.
		socket.receive({ method: 'message', params: { from: { user_id: '~private', name: 'Only you' }, body: { text: 'Unknown command /x; try /help' } } });
		client.notify('general', 'Only moderators can kick');
		const general = room('general')!;
		expect(general.timeline.order).toEqual(['31']);
		expect(general.notices.map((notice) => [notice.from.user_id, notice.body?.text, notice.after])).toEqual([
			['~private', 'Welcome', '31'],
			['~private', 'Unknown command /x; try /help', '31'],
			['~private', 'Only moderators can kick', '31']
		]);
		expect(snapshot.users['~private']).toBeUndefined();
		// Kept through a reconnect, for the session.
		socket.drop();
		vi.advanceTimersByTime(5_000);
		socket = FakeSocket.latest();
		await authenticate(['rooms']);
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }] });
		expect(room('general')?.notices).toHaveLength(3);
	});

	it('shows a welcome sent before auth in the first room, and lets the next connection\'s welcome replace it', async () => {
		const welcome = (text: string) => ({ method: 'message', params: { from: { user_id: '~private', name: 'Only you' }, body: { text } } });
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		// Notifications may come before auth (§3.2); with no room yet, it waits for one (Appendix B).
		socket.receive(welcome('Guests can read along.'));
		await socket.reply('auth', { you: { user_id: 'guest_1', name: 'Guest' } });
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General', latest_log_id: '30' }] });
		socket.receive({ method: 'message', params: { room_id: 'general', from: { user_id: '~private' }, body: { text: 'A command reply' } } });
		const texts = () => room('general')?.notices.map((notice) => notice.body?.text);
		expect(texts()).toEqual(['Guests can read along.', 'A command reply']);
		// The server sends its welcome on every connection: the new one replaces the old.
		socket.drop();
		vi.advanceTimersByTime(5_000);
		socket = FakeSocket.latest();
		socket.open();
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		socket.receive(welcome('Guests can read along, again.'));
		await socket.reply('auth', { you: { user_id: 'guest_1', name: 'Guest' } });
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }] });
		expect(texts()).toEqual(['A command reply', 'Guests can read along, again.']);
	});
});

describe('threads read without joining', () => {
	it('opens a thread without joining it: history only, until joined', async () => {
		await authenticate(['rooms', 'history']);
		await socket.reply('room_list', { joined: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '12', history_log_id: '10', members: [{ user_id: 'guest_1' }] }], users: [] });
		await socket.reply('history', { more: false, latest_log_id: '12', history_log_id: '10' });
		const threads = client.listRooms('general');
		await socket.reply('room_list', { not_joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Deploy', latest_log_id: '24', history_log_id: '20' }] });
		await threads;
		expect(client.viewRoom('20')).toBe(true);
		expect(room('20')).toMatchObject({ joined: false, loaded: false, parentRoomId: 'general' });
		expect(snapshot.threadDirectory.general[0].joined).toBe(false);
		expect(socket.sent.some((frame) => frame.method === 'room_join')).toBe(false);
		const load = client.loadRoom('20');
		expect(bounds(socket.request('history').params)).toEqual({ room_id: '20', before: '24' });
		await socket.reply('history', { messages: [{ message_id: '21', log_id: '21', room_id: '20', from: { user_id: 'bob' }, body: { text: 'first' } }], first_log_id: '21', last_log_id: '24', more: false, latest_log_id: '24', history_log_id: '20' });
		await load;
		expect(room('20')).toMatchObject({ joined: false, loaded: true });
		expect(room('20')?.timeline.order).toEqual(['21']);
		// Nothing about it arrives live: a later listing of the parent's threads moves its head, and it loads again.
		const relisted = client.listRooms('general', 0);
		await socket.reply('room_list', { not_joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Deploy', latest_log_id: '26', history_log_id: '20' }] });
		await relisted;
		expect(room('20')?.loaded).toBe(false);
		const again = client.loadRoom('20');
		expect(bounds(socket.request('history').params)).toEqual({ room_id: '20', after: '25', before: '26' });
		await socket.reply('history', { messages: [{ message_id: '26', log_id: '26', room_id: '20', from: { user_id: 'bob' }, body: { text: 'second' } }], first_log_id: '26', last_log_id: '26', more: false, latest_log_id: '26', history_log_id: '20' });
		await again;
		expect(room('20')?.timeline.order).toEqual(['21', '26']);
		// Joining makes it live; what it missed since its last load is caught up on the next load.
		quiet(client.joinRoom('20'));
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Deploy', latest_log_id: '28', history_log_id: '20', members: [{ user_id: 'bob' }, { user_id: 'guest_1' }] }], memberships: [{ log_id: '28', room_id: '20', members: [{ user: { user_id: 'guest_1' }, joined: true }] }], users: [] } });
		expect(room('20')).toMatchObject({ joined: true, loaded: false });
		const caught = client.loadRoom('20');
		expect(bounds(socket.request('history').params)).toEqual({ room_id: '20', after: '27', before: '28' });
		await socket.reply('history', { messages: [{ message_id: '27', log_id: '27', room_id: '20', from: { user_id: 'bob' }, body: { text: 'third' } }], memberships: [{ log_id: '28', room_id: '20', members: [{ user: { user_id: 'guest_1' }, joined: true }] }], first_log_id: '27', last_log_id: '28', more: false, latest_log_id: '28', history_log_id: '20' });
		await caught;
		expect(room('20')).toMatchObject({ joined: true, loaded: true });
		expect(room('20')?.timeline.order).toEqual(['21', '26', '27']);
		socket.receive({ method: 'message', params: { message_id: '29', log_id: '29', room_id: '20', from: { user_id: 'bob' }, body: { text: 'live' } } });
		expect(room('20')?.timeline.order).toEqual(['21', '26', '27', '29']);
		expect(room('20')?.loaded).toBe(true);
	});

	it('counts a thread joined with nothing new since its last load as loaded, without asking again', async () => {
		await authenticate(['rooms', 'history']);
		await socket.reply('room_list', { joined: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '12', history_log_id: '10', members: [{ user_id: 'guest_1' }] }], users: [] });
		await socket.reply('history', { more: false, latest_log_id: '12', history_log_id: '10' });
		const threads = client.listRooms('general');
		await socket.reply('room_list', { not_joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Deploy', latest_log_id: '24', history_log_id: '20' }] });
		await threads;
		expect(client.viewRoom('20')).toBe(true);
		const load = client.loadRoom('20');
		await socket.reply('history', { messages: [{ message_id: '21', log_id: '21', room_id: '20', from: { user_id: 'bob' }, body: { text: 'first' } }], first_log_id: '21', last_log_id: '24', more: false, latest_log_id: '24', history_log_id: '20' });
		await load;
		// A join whose record says the head hasn't moved (no membership logged): there is nothing to catch up on.
		quiet(client.joinRoom('20'));
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Deploy', latest_log_id: '24', history_log_id: '20', members: [{ user_id: 'bob' }, { user_id: 'guest_1' }] }], users: [] } });
		const historyRequests = () => socket.sent.filter((frame) => frame.method === 'history').length;
		const before = historyRequests();
		await client.loadRoom('20');
		expect(historyRequests()).toBe(before);
		expect(room('20')).toMatchObject({ joined: true, loaded: true, loading: false });
	});
});

describe('the default room (no cap rooms)', () => {
	it('posts without room_id until a broadcast names the room, and titles the rooms by room_id', async () => {
		await socket.greet(['edit'], { rooms: false });
		expect(socket.sent.some((frame) => frame.method === 'room_list')).toBe(false);
		expect(snapshot.rooms.map((room) => [room.id, room.title])).toEqual([[DEFAULT_ROOM_ID, 'Default room']]);
		expect(snapshot.activeRoom).toBe(DEFAULT_ROOM_ID);
		quiet(client.send(DEFAULT_ROOM_ID, 'hello', 'plain'));
		expect(socket.request('message').params).toEqual({ body: { text: 'hello', format: 'plain' } });
		await socket.reply('message', { message_id: '10' });
		socket.receive({ method: 'message', params: { message_id: '10', log_id: '10', room_id: 'lobby', from: { user_id: 'guest_1' }, body: { text: 'hello', format: 'plain' } } });
		expect(snapshot.rooms.map((room) => [room.id, room.title])).toEqual([['lobby', 'lobby']]);
		expect(snapshot.activeRoom).toBe('lobby');
		// Another room a message arrives in shows too.
		socket.receive({ method: 'message', params: { message_id: '11', log_id: '11', room_id: 'side', from: { user_id: 'bob' }, body: { text: 'x' } } });
		expect(snapshot.rooms.map((room) => room.id)).toEqual(['lobby', 'side']);
		await settle();
	});
});

describe('listing rooms to join', () => {
	beforeEach(async () => {
		await socket.greet(['history', 'rooms', 'activity', 'embed:upload'], { room: { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '10', history_log_id: '10' } });
		await socket.reply('history', { more: false, latest_log_id: '10', history_log_id: '10' });
	});

	it('finds one member of a room for a user link, keeping their user object but not the room’s members', async () => {
		const found = client.findMember('general', 'ada');
		expect(socket.request('room_list').params).toEqual({ room_id: 'general', members: true, user_id: 'ada' });
		await socket.reply('room_list', {
			joined: [{ room_id: 'general', log_id: '10', title: 'General', members: [{ user_id: 'ada' }] }],
			users: [{ user_id: 'ada', name: 'Ada' }]
		});
		expect(await found).toBe(true);
		expect(snapshot.users.ada.name).toBe('Ada');
		expect(room('general')?.members).toBeUndefined();
		// Not a member, or a server that ignores the filter and leaves them out.
		const missing = client.findMember('general', 'zed');
		await socket.reply('room_list', { joined: [{ room_id: 'general', log_id: '10', members: [{ user_id: 'ada' }] }], users: [{ user_id: 'ada', name: 'Ada' }] });
		expect(await missing).toBe(false);
	});

	it('lists rooms and threads to join, and one room with its members', async () => {
		const listing = client.listRooms();
		expect(socket.request('room_list').params).toEqual({ filter: 'not_joined', members: true });
		await socket.reply('room_list', {
			not_joined: [
				{ room_id: 'ops', log_id: '11', latest_log_id: '11', members: [{ user_id: 'bob' }, { user_id: 'carol' }, { user_id: 'dana' }] },
				{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '12', members: [] }
			],
			users: [{ user_id: 'bob', name: 'Bob' }, { user_id: 'carol', name: 'Carol' }, { user_id: 'dana', name: 'Dana' }]
		});
		const rooms = await listing;
		expect(rooms.map((room) => [room.id, room.title, room.joined, room.members.length])).toEqual([['ops', 'ops', false, 3], ['general', 'General', true, 0]]);
		expect(snapshot.directory?.map((room) => room.id)).toEqual(['ops', 'general']);
		expect(snapshot.users.carol).toEqual({ user_id: 'carol', name: 'Carol' });
		quiet(client.listRooms('general'));
		expect(socket.request('room_list').params).toEqual({ parent_room_id: 'general', filter: 'not_joined' });
		await socket.reply('room_list', { not_joined: [{ room_id: 't1', log_id: '13', parent_room_id: 'general', title: 'Thread' }] });
		expect(snapshot.threadDirectory.general.map((room) => room.id)).toEqual(['t1']);
		// Members come bare, with the complete objects in the result's users.
		quiet(client.listMembers('general'));
		expect(socket.request('room_list').params).toEqual({ room_id: 'general', members: true });
		await socket.reply('room_list', {
			joined: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '12', members: [{ user_id: 'bob' }, { user_id: 'guest_1' }] }],
			users: [{ user_id: 'bob', name: 'Bob', avatar: 'https://example.com/b.png' }, { user_id: 'guest_1', name: 'Guest' }]
		});
		const general = () => snapshot.rooms.find((room) => room.id === 'general')!;
		expect(general().members?.map((member) => member.user_id)).toEqual(['bob', 'guest_1']);
		expect(snapshot.users.bob.avatar).toBe('https://example.com/b.png');
		// Memberships keep the members current (§4.2.2), and draw nothing.
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '13', room_id: 'general', members: [{ user: { user_id: 'carol', name: 'Carol' }, joined: true }] }] } });
		expect(general().members?.map((member) => member.user_id)).toEqual(['bob', 'guest_1', 'carol']);
		expect(general().latestLogId).toBe('13');
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '14', room_id: 'general', members: [{ user: { user_id: 'bob' }, joined: false }] }] } });
		expect(general().members?.map((member) => member.user_id)).toEqual(['guest_1', 'carol']);
		// A membership at or below the listing's head is already in it; an older one for a user loses to a newer one.
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '12', room_id: 'general', members: [{ user: { user_id: 'guest_1' }, joined: false }] }] } });
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '13', room_id: 'general', members: [{ user: { user_id: 'bob' }, joined: true }] }] } });
		expect(general().members?.map((member) => member.user_id)).toEqual(['guest_1', 'carol']);
		// Recorded users never merge into the kept ones.
		expect(snapshot.users.bob.name).toBe('Bob');
		expect(general().timeline.order).toEqual([]);
		// A guest that becomes an account (a user_id change, §3.3) is one member under the new ID, until the room
		// is listed again: its old membership shows as the new identity, and only once beside the new one's own.
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '15', room_id: 'general', members: [{ user: { user_id: 'guest_7', name: 'Guest 7' }, joined: true }] }] } });
		socket.receive({ method: 'user', params: { new: { user_id: 'dana', name: 'Dana' }, old: { user_id: 'guest_7', name: 'Guest 7' } } });
		expect(general().members?.map((member) => member.user_id)).toEqual(['guest_1', 'carol', 'dana']);
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '16', room_id: 'general', members: [{ user: { user_id: 'dana', name: 'Dana' }, joined: true }] }] } });
		expect(general().members).toEqual([{ user_id: 'guest_1' }, { user_id: 'carol', name: 'Carol' }, { user_id: 'dana', name: 'Dana' }]);
	});

	it('shares a room_list in flight and reuses a recent one', async () => {
		const listings = () => socket.sent.filter((frame) => frame.method === 'room_list').length;
		const before = listings();
		const first = client.listRooms();
		const second = client.listRooms();
		expect(listings() - before).toBe(1);
		await socket.reply('room_list', { not_joined: [{ room_id: 'ops', log_id: '11' }] });
		expect((await first).map((room) => room.id)).toEqual(['ops']);
		expect((await second).map((room) => room.id)).toEqual(['ops']);
		quiet(client.listRooms());
		expect(listings() - before).toBe(1);
		// A caller that wants fresher, or any caller once it is stale, lists again.
		vi.advanceTimersByTime(5_000);
		quiet(client.listRooms(undefined, 1_000));
		expect(listings() - before).toBe(2);
		await socket.reply('room_list', { not_joined: [] });
		vi.advanceTimersByTime(10_000);
		quiet(client.listRooms());
		expect(listings() - before).toBe(3);
		await socket.reply('room_list', { not_joined: [{ room_id: 'ops', log_id: '11' }] });
		// An update to a room already joined changes nothing; joining one makes it stale.
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '10', title: 'General' }] } });
		quiet(client.listRooms());
		expect(listings() - before).toBe(3);
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '11', title: 'Ops' }] } });
		quiet(client.listRooms());
		expect(listings() - before).toBe(4);
		await socket.reply('room_list', { not_joined: [] });
		// So does leaving one.
		socket.receive({ method: 'room_update', params: { left: [{ room_id: 'ops' }] } });
		quiet(client.listRooms());
		expect(listings() - before).toBe(5);
	});

	it('shows a server-wide notice for a room not joined where you are', async () => {
		socket.receive({ method: 'message', params: { message_id: '16', log_id: '16', room_id: 'elsewhere', from: { user_id: '~server', name: 'Server' }, body: { text: 'Maintenance at 17:00' } } });
		expect(snapshot.rooms.map((room) => room.id)).toEqual(['general']);
		expect(snapshot.rooms[0].notices.map((notice) => notice.body?.text)).toEqual(['Maintenance at 17:00']);
		expect(client.message('16')?.room_id).toBe('elsewhere');
	});
});

describe('room records and membership', () => {
	beforeEach(async () => {
		await socket.greet(['rooms'], { room: { room_id: 'general', log_id: '10', title: 'General', description: 'Ops *chatter*', members: [{ user_id: 'guest_1' }] } });
	});

	it('shows a room description and updates it by room_set, as /topic does', async () => {
		expect(room('general')?.description).toBe('Ops *chatter*');
		quiet(client.updateRoom('general', { description: 'Deploys only' }));
		expect(socket.request('room_set').params).toEqual({ room_id: 'general', title: 'General', description: 'Deploys only' });
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '11', title: 'General', description: 'Deploys only' }] } });
		expect(room('general')?.description).toBe('Deploys only');
		// An empty description is none.
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '12', title: 'General', description: '' }] } });
		expect(room('general')).not.toHaveProperty('description');
	});

	it('asks for a private room and reports whether the server kept it private', async () => {
		quiet(client.createRoom({ title: 'Secret', private: true, description: 'Just us' }));
		expect(socket.request('room_set').params).toEqual({ private: true, title: 'Secret', description: 'Just us' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 's1', log_id: '20', private: true, title: 'Secret', description: 'Just us' }] } });
		expect(room('s1')?.private).toBe(true);
		// A server that ignored the flag leaves it off the record.
		quiet(client.createRoom({ title: 'Oops', private: true }));
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 's2', log_id: '21', title: 'Oops' }] } });
		expect(room('s2')?.private).toBeUndefined();
		// Updates never send `private`: omitted, it is kept (§4.2.4).
		quiet(client.updateRoom('s1', { title: 'Secret 2' }));
		expect(socket.request('room_set').params).toEqual({ room_id: 's1', title: 'Secret 2', description: 'Just us' });
		// A thread is created without it, and takes its parent's.
		quiet(client.createRoom({ parentRoomId: 's1', title: 'Plans' }));
		expect(socket.request('room_set').params).toEqual({ parent_room_id: 's1', title: 'Plans' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 's3', log_id: '22', parent_room_id: 's1', private: true, title: 'Plans' }] } });
		expect(room('s3')?.private).toBe(true);
	});

	it('names an untitled private room after its other members, whatever its room_id, and only a top-level one', async () => {
		socket.receive({ method: 'room_update', params: {
			joined: [{ room_id: 'private_1724803950000', log_id: '40', private: true, members: [{ user_id: 'guest_1' }] }],
			users: [{ user_id: 'guest_1', name: 'Guest' }]
		} });
		// Alone in it: "You", never the opaque room_id (§2.4).
		expect(room('private_1724803950000')).toMatchObject({ title: 'You', namedForMembers: true, private: true });
		// Someone added: named for them, by the name kept for them, and for each person after, sorted.
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '41', room_id: 'private_1724803950000', members: [{ user: { user_id: 'mira', name: 'Mira' }, joined: true }] }] } });
		expect(room('private_1724803950000')?.title).toBe('Mira');
		socket.receive({ method: 'user', params: { new: { user_id: 'dev', name: 'Dev' } } });
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '42', room_id: 'private_1724803950000', members: [{ user: { user_id: 'dev' }, joined: true }] }] } });
		expect(room('private_1724803950000')?.title).toBe('Dev, Mira');
		// A titled one keeps its title; an untitled thread of it is "Untitled", as any thread is; an ordinary room its room_id.
		socket.receive({ method: 'room_update', params: { joined: [
			{ room_id: 'p2', log_id: '43', private: true, title: 'Launch', members: [{ user_id: 'guest_1' }, { user_id: 'dev' }] },
			{ room_id: 'p3', log_id: '44', private: true, parent_room_id: 'private_1724803950000', members: [{ user_id: 'guest_1' }] },
			{ room_id: 'r1', log_id: '45', members: [{ user_id: 'guest_1' }, { user_id: 'dev' }] }
		] } });
		expect([room('p2'), room('p3'), room('r1')].map((entry) => [entry?.title, entry?.namedForMembers])).toEqual([['Launch', undefined], ['Untitled', undefined], ['r1', undefined]]);
	});

	it('keeps member_count for a truncated member list until a complete one replaces it, and through an update without members', async () => {
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'big', log_id: '30', title: 'Big', latest_log_id: '30', members: [{ user_id: 'guest_1' }, { user_id: 'bob' }], member_count: 5000 }] } });
		expect(room('big')?.memberCount).toBe(5000);
		expect(room('big')?.members?.map((member) => member.user_id)).toEqual(['guest_1', 'bob']);
		expect(room('general')?.memberCount).toBeUndefined();
		const listed = client.listRooms();
		await socket.reply('room_list', { not_joined: [{ room_id: 'huge', title: 'Huge', members: [{ user_id: 'carol' }], member_count: 90 }] });
		expect((await listed)[0].memberCount).toBe(90);
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'big', log_id: '30', title: 'Big', latest_log_id: '31', members: [{ user_id: 'guest_1' }] }] } });
		expect(room('big')?.memberCount).toBeUndefined();
		// An update to a listed room's record that carries no members leaves its count and members.
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'huge', log_id: '61', title: 'Huge', description: 'Everyone' }] } });
		expect(snapshot.directory?.find((listing) => listing.id === 'huge')).toMatchObject({ memberCount: 90, members: [{ user_id: 'carol' }] });
		expect(snapshot.directory?.find((listing) => listing.id === 'huge')?.record.description).toBe('Everyone');
	});

	it('adds and removes other members with user_id, and stops offering it once unsupported', async () => {
		const added = client.joinRoom('general', 'bob');
		expect(socket.request('room_join').params).toEqual({ room_id: 'general', user_id: 'bob' });
		await socket.reply('room_join', {});
		await added.promise;
		const removed = client.leaveRoom('general', 'bob');
		expect(socket.request('room_leave').params).toEqual({ room_id: 'general', user_id: 'bob' });
		socket.receive({ id: socket.request('room_leave').id, error: { code: -32601, message: 'Removing others is not supported' } });
		await expect(removed.promise).rejects.toThrow('not supported');
		await settle();
		expect(snapshot.memberChangesUnsupported).toBe(true);
		// Your own join and leave are unaffected, and a new server frame tries again.
		quiet(client.leaveRoom('general'));
		expect(socket.request('room_leave').params).toEqual({ room_id: 'general' });
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms'] } });
		expect(snapshot.memberChangesUnsupported).toBeUndefined();
	});

	it('never installs a ~private message, even one carrying a message_id or in a history page', async () => {
		socket.receive({ method: 'message', params: { message_id: '50', log_id: '50', room_id: 'general', from: { user_id: '~private' }, body: { text: 'Just you' } } });
		expect(client.message('50')).toBeUndefined();
		expect(room('general')?.notices.map((notice) => notice.body?.text)).toEqual(['Just you']);
		// Nor one in a history page.
		socket.receive({ method: 'server', params: { apron: 10, auth: ['guest'], capabilities: ['rooms', 'history'] } });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '80', title: 'Ops', latest_log_id: '82', history_log_id: '80' }] } });
		const request = socket.request('history');
		socket.receive({ id: request.id, result: { messages: [
			{ message_id: '81', log_id: '81', room_id: 'ops', from: { user_id: '~private' }, body: { text: 'secret' } },
			{ message_id: '82', log_id: '82', room_id: 'ops', from: { user_id: 'bob' }, body: { text: 'hi' } }
		], first_log_id: '81', last_log_id: '82', more: false, latest_log_id: '82', history_log_id: '80' } });
		await settle();
		expect(client.message('81')).toBeUndefined();
		expect(client.message('82')?.body).toEqual({ text: 'hi' });
	});

	it('keeps where a thread was created as its record changes', async () => {
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'opaque', log_id: '70', parent_room_id: 'general', title: 'T' }] } });
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'opaque', log_id: '75', parent_room_id: 'general', title: 'T', description: 'Now summarized' }] } });
		expect(room('opaque')).toMatchObject({ firstRecordLogId: '70', description: 'Now summarized' });
	});
});
