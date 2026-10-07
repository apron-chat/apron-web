import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatClient, DEFAULT_ROOM_ID, IDLE_RETRY_MS, type ClientSnapshot } from './client';
import { FakeSocket, settle } from './fake-socket';
import { REQUEST_TIMEOUT_MS } from './client-internals';

/** Operations whose outcome a test does not await still settle when the client stops. */
function quiet(value: { promise: Promise<unknown> } | undefined): void {
	value?.promise.catch(() => undefined);
}

describe('rooms by request (cap rooms)', () => {
	let client: ChatClient;
	let snapshot: ClientSnapshot;
	let socket: FakeSocket;

	beforeEach(() => {
		vi.useFakeTimers();
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		client = new ChatClient('ws://fake.test/');
		client.subscribe((next) => (snapshot = next));
		client.start();
		socket = FakeSocket.latest();
	});

	afterEach(() => {
		client.stop();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	const ids = () => snapshot.rooms.map((room) => room.id);
	const room = (id: string) => snapshot.rooms.find((candidate) => candidate.id === id);

	async function authenticate(caps: string[]): Promise<void> {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: caps } });
		await socket.reply('auth', { you: { user_id: 'guest_1', name: 'Guest' } });
	}

	it('lists the joined rooms with their members right behind auth, threads included, then follows room_update', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms'] } });
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
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms'] } });
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
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms'] } });
		socket.receive(welcome('Guests can read along, again.'));
		await socket.reply('auth', { you: { user_id: 'guest_1', name: 'Guest' } });
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }] });
		expect(texts()).toEqual(['A command reply', 'Guests can read along, again.']);
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

	it('sends commands with the params of a message, and never an empty message', async () => {
		await authenticate(['rooms', 'command', 'embed:upload']);
		await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }] });
		quiet(client.command('general', '/kick @bob spamming', { mentions: ['bob', 'bob'], replyTo: '31' }));
		expect(socket.request('command').params).toEqual({ room_id: 'general', body: { text: '/kick @bob spamming', mentions: ['bob'] }, reply_to: { message_id: '31' } });
		const failed = client.command('general', '/nope');
		socket.receive({ id: socket.request('command').id, error: { code: -32602, message: 'Unknown command /nope; try /help' } });
		await expect(failed.promise).rejects.toThrow('Unknown command /nope; try /help');
		// A command takes attached files as upload embeds, and its result lists their write URLs.
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })));
		const { uploaded } = client.sendFiles('general', '/avatar', [new File(['png'], 'me.png')], 'markdown', {}, true);
		expect(socket.request('command').params).toEqual({ room_id: 'general', body: { text: '/avatar', embeds: [{ kind: 'upload', title: 'me.png' }] } });
		await socket.reply('command', { embeds: [{ embed_id: 'e1', kind: 'upload', write_url: 'http://fake.test/w/1' }] });
		await uploaded;
		// Mentions go in body.mentions.
		quiet(client.send('general', '@bob look', 'plain', { mentions: ['bob'] }));
		expect(socket.request('message').params).toEqual({ room_id: 'general', body: { text: '@bob look', format: 'plain', mentions: ['bob'] } });
		const before = socket.sent.length;
		await expect(client.send('general', '', 'plain').promise).rejects.toThrow('Nothing to send');
		expect(socket.sent).toHaveLength(before);
	});

	it('keeps member lists from listings and memberships, whichever order they arrive in', async () => {
		await authenticate(['rooms', 'history']);
		// A guest's own join may arrive before anything is listed (the Go server logs it at auth).
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '11', room_id: 'general', members: [{ user: { user_id: 'guest_1', name: 'Guest' }, joined: true }] }] } });
		await socket.reply('room_list', { joined: [{ room_id: 'general', log_id: '10', title: 'General', latest_log_id: '11', history_log_id: '10', members: [{ user_id: 'bob' }, { user_id: 'guest_1' }] }], users: [] });
		await socket.reply('history', { memberships: [{ log_id: '11', room_id: 'general', members: [{ user: { user_id: 'guest_1' }, joined: true }] }], first_log_id: '11', last_log_id: '11', more: false, latest_log_id: '11', history_log_id: '10' });
		expect(room('general')?.members?.map((member) => member.user_id)).toEqual(['bob', 'guest_1']);
		// Joining: one room_update with the room, its members, and the membership, then the result (§4.3.2).
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
		// A record may carry several members (§4.3.2).
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '33', room_id: 'ops', members: [{ user: { user_id: 'erin' }, joined: true }, { user: { user_id: 'finn' }, joined: true }] }] } });
		expect(room('ops')?.members?.map((member) => member.user_id)).toEqual(['guest_1', 'erin', 'finn']);
		// Your own leave: the room goes, with the membership in the same room_update.
		socket.receive({ method: 'room_update', params: { left: [{ room_id: 'ops' }], memberships: [{ log_id: '34', room_id: 'ops', members: [{ user: { user_id: 'guest_1' }, joined: false }] }] } });
		expect(ids()).toEqual(['general', '30']);
		await settle();
	});

	it('does not report a listing denied behind a failed auth', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms'] } });
		const auth = socket.request('auth');
		const listing = socket.request('room_list');
		socket.receive({ id: auth.id, error: { code: -32001, message: 'Guests are not accepted right now' } });
		await settle();
		socket.receive({ id: listing.id, error: { code: -32001, message: 'Denied' } });
		await settle();
		expect(snapshot.error).toBe('Guests are not accepted right now');
		expect(snapshot.authenticated).toBe(false);
		expect(snapshot.rooms).toEqual([]);
	});

	it('drops a listing a server answered behind a failed auth, as the connection was: signed in as no one', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms'] } });
		const auth = socket.request('auth');
		const listing = socket.request('room_list');
		socket.receive({ id: auth.id, error: { code: -32001, message: 'Guests are not accepted right now' } });
		await settle();
		// A failed auth leaves the connection's authentication as it was (§3.2); later requests aren't denied wholesale.
		socket.receive({ id: listing.id, result: { joined: [{ room_id: 'general', title: 'General' }] } });
		await settle();
		expect(snapshot.error).toBe('Guests are not accepted right now');
		expect(snapshot.rooms).toEqual([]);
	});

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
		expect(socket.request('history').params).toEqual({ room_id: '20', before: '24', limit: 50 });
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
		expect(socket.request('history').params).toEqual({ room_id: '20', after: '25', before: '26', limit: 200 });
		await socket.reply('history', { messages: [{ message_id: '26', log_id: '26', room_id: '20', from: { user_id: 'bob' }, body: { text: 'second' } }], first_log_id: '26', last_log_id: '26', more: false, latest_log_id: '26', history_log_id: '20' });
		await again;
		expect(room('20')?.timeline.order).toEqual(['21', '26']);
		// Joining makes it live; what it missed since its last load is caught up on the next load.
		quiet(client.joinRoom('20'));
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: '20', log_id: '20', parent_room_id: 'general', title: 'Deploy', latest_log_id: '28', history_log_id: '20', members: [{ user_id: 'bob' }, { user_id: 'guest_1' }] }], memberships: [{ log_id: '28', room_id: '20', members: [{ user: { user_id: 'guest_1' }, joined: true }] }], users: [] } });
		expect(room('20')).toMatchObject({ joined: true, loaded: false });
		const caught = client.loadRoom('20');
		expect(socket.request('history').params).toEqual({ room_id: '20', after: '27', before: '28', limit: 200 });
		await socket.reply('history', { messages: [{ message_id: '27', log_id: '27', room_id: '20', from: { user_id: 'bob' }, body: { text: 'third' } }], memberships: [{ log_id: '28', room_id: '20', members: [{ user: { user_id: 'guest_1' }, joined: true }] }], first_log_id: '27', last_log_id: '28', more: false, latest_log_id: '28', history_log_id: '20' });
		await caught;
		expect(room('20')).toMatchObject({ joined: true, loaded: true });
		expect(room('20')?.timeline.order).toEqual(['21', '26', '27']);
		socket.receive({ method: 'message', params: { message_id: '29', log_id: '29', room_id: '20', from: { user_id: 'bob' }, body: { text: 'live' } } });
		expect(room('20')?.timeline.order).toEqual(['21', '26', '27', '29']);
		expect(room('20')?.loaded).toBe(true);
	});

	describe('status', () => {
		const statuses = () => socket.sent.filter((frame) => frame.method === 'status').map((frame) => frame.params as Record<string, unknown>);
		async function greet(caps: string[] = ['rooms', 'status'], you: Record<string, unknown> = { user_id: 'guest_1', name: 'Guest' }, auth = ['guest']): Promise<void> {
			socket.open();
			socket.receive({ method: 'server', params: { apron: 8, auth, capabilities: caps } });
			await socket.reply('auth', { you });
			if (caps.includes('rooms')) await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }] });
		}
		function reconnect(): void {
			socket.drop();
			vi.advanceTimersByTime(5_000);
			socket = FakeSocket.latest();
		}

		/** Answers the latest `status` request: `{}` (§4.5), or an error. */
		async function answer(error?: Record<string, unknown>): Promise<void> {
			const { id } = socket.request('status');
			socket.receive(error ? { id, error } : { id, result: {} });
			await settle();
		}
		const tooMany = (seconds: number) => ({ code: -32002, message: 'Too Many Requests', data: { retry_after: seconds } });

		it('sends status as a request with an id, and nothing before the auth result', async () => {
			client.setIdle(true);
			socket.open();
			socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['status'] } });
			// Not signed in yet (§3.2): no status, even for a page already idle.
			expect(socket.sent.map((frame) => frame.method)).toEqual(['auth']);
			await socket.reply('auth', { you: { user_id: 'guest_1' } });
			// After the result, an idle page reports it at once.
			const request = socket.request('status');
			expect(request).toEqual({ method: 'status', id: expect.any(String), params: { idle: true } });
			expect(socket.sent.map((frame) => frame.method)).toEqual(['auth', 'status']);
		});

		it('sends nothing for a connection that starts attended', async () => {
			await greet();
			client.setIdle(false);
			vi.advanceTimersByTime(60_000);
			expect(statuses()).toEqual([]);
			// A replacing server frame says nothing either.
			socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms', 'status'] } });
			expect(statuses()).toEqual([]);
		});

		it('reports idle and attended as the page says, at once, and only changes', async () => {
			await greet();
			client.setIdle(true);
			expect(statuses()).toEqual([{ idle: true }]);
			await answer();
			client.setIdle(true);
			expect(statuses()).toEqual([{ idle: true }]);
			client.setIdle(false);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }]);
			await answer();
			client.setIdle(false);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }]);
		});

		it('stays idle after a message: only idle: false ends it', async () => {
			await greet();
			client.setIdle(true);
			await answer();
			client.sendTyping('general', true);
			client.markRead('general', '1724803200001');
			client.send('general', 'hi').promise.catch(() => undefined);
			expect(statuses()).toEqual([{ idle: true }]);
			client.setIdle(false);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }]);
			// `activity` never carries attendance.
			expect(socket.sent.filter((frame) => frame.method === 'activity' && 'idle' in (frame.params as object))).toEqual([]);
		});

		it('reports idle at once on a reconnect while idle, and nothing while attended', async () => {
			await greet();
			client.setIdle(true);
			await answer();
			reconnect();
			await greet();
			expect(statuses()).toEqual([{ idle: true }]);
			await answer();
			// Back, then a reconnect: the new connection starts attended, so it says nothing.
			client.setIdle(false);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }]);
			reconnect();
			await greet();
			expect(statuses()).toEqual([]);
		});

		it('sends one idle at a time, and the latest state after the reply', async () => {
			await greet();
			client.setIdle(true);
			// Back and idle again while the first is unanswered: nothing more goes yet.
			client.setIdle(false);
			expect(statuses()).toEqual([{ idle: true }]);
			await answer();
			expect(statuses()).toEqual([{ idle: true }, { idle: false }]);
			client.setIdle(true);
			client.setIdle(false);
			await answer();
			// What the server has is what the page says: nothing more goes.
			expect(statuses()).toEqual([{ idle: true }, { idle: false }]);
		});

		it('resends the current idle state, not the refused one, after retry_after', async () => {
			await greet();
			client.setIdle(true);
			// Back meanwhile: the refused idle: true is not what goes again.
			client.setIdle(false);
			await answer(tooMany(5));
			expect(statuses()).toEqual([{ idle: true }]);
			vi.advanceTimersByTime(4_999);
			expect(statuses()).toEqual([{ idle: true }]);
			// Nothing changed on the server (§4.5), and the page is attended, as the connection started: nothing to send.
			vi.advanceTimersByTime(1);
			expect(statuses()).toEqual([{ idle: true }]);
			// Refused again while still idle: after the delay, the same state goes with a new id.
			client.setIdle(true);
			const first = socket.request('status').id;
			await answer(tooMany(2));
			vi.advanceTimersByTime(2_000);
			expect(statuses()).toEqual([{ idle: true }, { idle: true }, { idle: true }]);
			expect(socket.request('status').id).not.toBe(first);
			await answer();
			// Attended after a refused idle: false goes again once the delay is over.
			client.setIdle(false);
			await answer(tooMany(1));
			expect(statuses()).toEqual([{ idle: true }, { idle: true }, { idle: true }, { idle: false }]);
			vi.advanceTimersByTime(1_000);
			expect(statuses()).toEqual([{ idle: true }, { idle: true }, { idle: true }, { idle: false }, { idle: false }]);
			await answer();
		});

		it('tries again after another error, backing off, so a page in use is not left idle', async () => {
			await greet();
			client.setIdle(true);
			await answer();
			client.setIdle(false);
			await answer({ code: -32603, message: 'Internal error' });
			expect(statuses()).toEqual([{ idle: true }, { idle: false }]);
			vi.advanceTimersByTime(IDLE_RETRY_MS - 1);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }]);
			vi.advanceTimersByTime(1);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }, { idle: false }]);
			// Failing again doubles the wait.
			await answer({ code: -32603, message: 'Internal error' });
			vi.advanceTimersByTime(IDLE_RETRY_MS * 2 - 1);
			expect(statuses()).toHaveLength(3);
			vi.advanceTimersByTime(1);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }, { idle: false }, { idle: false }]);
			await answer();
			// Applied: nothing more goes, and the next failure starts from the first wait.
			vi.advanceTimersByTime(60_000);
			expect(statuses()).toHaveLength(4);
			client.setIdle(true);
			await answer({ code: -32603, message: 'Internal error' });
			vi.advanceTimersByTime(IDLE_RETRY_MS);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }, { idle: false }, { idle: false }, { idle: true }, { idle: true }]);
			// Back meanwhile: the current state is what goes.
			client.setIdle(false);
			await answer({ code: -32603, message: 'Internal error' });
			vi.advanceTimersByTime(IDLE_RETRY_MS * 2);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }, { idle: false }, { idle: false }, { idle: true }, { idle: true }]);
		});

		it('sends the current idle state after a request that timed out, which the server may have applied', async () => {
			await greet();
			client.setIdle(true);
			expect(statuses()).toEqual([{ idle: true }]);
			// No answer: the server may take the connection as idle, or not. Back meanwhile.
			client.setIdle(false);
			await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
			expect(statuses()).toEqual([{ idle: true }]);
			// After the backoff, attended goes, though the connection started attended.
			vi.advanceTimersByTime(IDLE_RETRY_MS);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }]);
			await answer();
			// Answered: the server has it, and nothing more goes.
			client.setIdle(false);
			expect(statuses()).toEqual([{ idle: true }, { idle: false }]);
		});

		it('keeps a room\'s mute from the server\'s status for it (§4.5), joined or not', async () => {
			socket.open();
			socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms', 'status'] } });
			await socket.reply('auth', { you: { user_id: 'guest_1' } });
			await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }, { room_id: 'random', title: 'Random' }, { room_id: 'ops', title: 'Ops' }] });
			const muted = () => Object.fromEntries(snapshot.rooms.map((room) => [room.id, room.mutedUntil]));
			socket.receive({ method: 'status', params: { room_id: 'general', mute: true } });
			socket.receive({ method: 'status', params: { room_id: 'random', mute: 60 } });
			// A room not listed here yet keeps its mute for when it is.
			socket.receive({ method: 'status', params: { room_id: 'elsewhere', mute: true } });
			expect(muted()).toEqual({ general: true, random: Date.now() + 60_000, ops: undefined });
			// Room records no longer carry it: a record without `mute`, or with one, changes nothing.
			socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'general', log_id: '20', title: 'General!' }, { room_id: 'ops', log_id: '21', title: 'Ops', mute: true }] } });
			socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'general', log_id: '24', title: 'General!' }] } });
			expect(muted()).toEqual({ general: true, random: Date.now() + 60_000, ops: undefined });
			// `false` ends it, and so does `0`.
			socket.receive({ method: 'status', params: { room_id: 'random', mute: false } });
			socket.receive({ method: 'status', params: { room_id: 'general', mute: 0 } });
			expect(muted()).toEqual({ general: undefined, random: undefined, ops: undefined });
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

		it('sends no status to a server without the capability, push or not', async () => {
			socket.open();
			socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['activity'], push: { webpush: { key: 'BNcR' } } } });
			await socket.reply('auth', { you: { user_id: 'guest_1' } });
			client.setIdle(true);
			client.setMute(true);
			expect(statuses()).toEqual([]);
			// A replacing server frame with the capability hears the current state.
			socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['status'] } });
			expect(statuses()).toEqual([{ idle: true }]);
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
			// `you` no longer says anything about mutes (§4.5): a `mute` in it is ignored.
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

		it('drops the kept mutes at each sign-in and applies the status frames after its result (§3.2, §4.5)', async () => {
			await greet(['rooms', 'status'], { user_id: 'guest_1' }, ['token', 'guest']);
			client.useToken('apron_token');
			vi.advanceTimersByTime(0);
			socket = FakeSocket.latest();
			await greet(['rooms', 'status'], { user_id: 'ada', name: 'Ada' }, ['token', 'guest']);
			socket.receive({ method: 'status', params: { mute: true } });
			socket.receive({ method: 'status', params: { room_id: 'general', mute: true } });
			socket.receive({ method: 'status', params: { room_id: 'random', mute: 600 } });
			const roomMute = (id: string) => snapshot.rooms.find((room) => room.id === id)?.mutedUntil;
			expect([snapshot.mutedUntil, roomMute('general')]).toEqual([true, true]);
			// Reconnected: the server lost the global mute and shortened the room's while this client was away.
			reconnect();
			socket.open();
			socket.receive({ method: 'server', params: { apron: 8, auth: ['token', 'guest'], capabilities: ['rooms', 'status'] } });
			// Until the new auth, the kept mutes still apply.
			expect(snapshot.mutedUntil).toBe(true);
			// The sign-in drops every kept mute at its result; every notification it causes comes after (§3.2).
			await socket.reply('auth', { you: { user_id: 'ada', name: 'Ada' } });
			await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }, { room_id: 'random', title: 'Random' }] });
			expect([snapshot.mutedUntil, roomMute('general'), roomMute('random')]).toEqual([undefined, undefined, undefined]);
			// Each mute in effect applies as it arrives; any scope not sent stays unmuted.
			socket.receive({ method: 'status', params: { room_id: 'general', mute: 1800 } });
			expect(snapshot.mutedUntil).toBeUndefined();
			expect(roomMute('general')).toBe(Date.now() + 1_800_000);
			expect(roomMute('random')).toBeUndefined();
		});

		it('applies a sign-in\'s statuses and mutes in whatever order they come after its result', async () => {
			await greet(['rooms', 'status'], { user_id: 'guest_1' }, ['token', 'guest']);
			client.useToken('apron_token');
			vi.advanceTimersByTime(0);
			socket = FakeSocket.latest();
			await greet(['rooms', 'status'], { user_id: 'ada', name: 'Ada' }, ['token', 'guest']);
			socket.receive({ method: 'status', params: { mute: true } });
			socket.receive({ method: 'user', params: { new: { user_id: 'bo', name: 'Bo', status: 'idle' } } });
			socket.receive({ method: 'user', params: { new: { user_id: 'cy', name: 'Cy', status: 'dnd' } } });
			reconnect();
			socket.open();
			socket.receive({ method: 'server', params: { apron: 8, auth: ['token', 'guest'], capabilities: ['rooms', 'status'] } });
			// A lost connection keeps them until the next sign-in.
			expect([snapshot.mutedUntil, snapshot.users.bo.status]).toEqual([true, 'idle']);
			await socket.reply('auth', { you: { user_id: 'ada', name: 'Ada', status: 'online' } });
			expect([snapshot.mutedUntil, snapshot.users.bo.status, snapshot.users.cy.status]).toEqual([undefined, undefined, undefined]);
			expect(snapshot.users.bo.name).toBe('Bo');
			// The room the sign-in joined, others' statuses and the mutes, among other frames.
			socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'general', title: 'General', members: [{ user_id: 'ada' }, { user_id: 'bo' }] }], memberships: [{ log_id: '91', room_id: 'general', members: [{ user: { user_id: 'ada', name: 'Ada' }, joined: true }] }] } });
			socket.receive({ method: 'user', params: { new: { user_id: 'bo', status: 'online' } } });
			socket.receive({ method: 'status', params: { mute: 600 } });
			socket.receive({ method: 'pong' });
			socket.receive({ method: 'status', params: { room_id: 'general', mute: true } });
			expect(snapshot.rooms.find((room) => room.id === 'general')?.mutedUntil).toBe(true);
			expect(snapshot.mutedUntil).toBe(Date.now() + 600_000);
			expect([snapshot.users.bo.status, snapshot.users.cy.status, snapshot.you?.status]).toEqual(['online', undefined, 'online']);
			await socket.reply('room_list', { joined: [{ room_id: 'general', title: 'General' }] });
			expect(snapshot.rooms.find((room) => room.id === 'general')?.mutedUntil).toBe(true);
			expect(snapshot.mutedUntil).toBe(Date.now() + 600_000);
		});

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

	describe('push', () => {
		const webpush = { kind: 'webpush', url: 'https://push.example/a', push_id: 'a1', keys: { p256dh: 'BPk', auth: 'c2Vj' } };
		const sent = (method: string) => socket.sent.filter((frame) => frame.method === method).map((frame) => frame.params);
		async function greet(push?: Record<string, unknown>, you = 'ada'): Promise<void> {
			socket.open();
			socket.receive({ method: 'server', params: { apron: 8, auth: ['token', 'guest'], capabilities: [], ...(push ? { push } : {}) } });
			// Nothing is registered before auth.
			expect(sent('push_register')).toEqual([]);
			await socket.reply('auth', { you: { user_id: you, name: you } });
		}
		function reconnect(): void {
			socket.drop();
			vi.advanceTimersByTime(5_000);
			socket = FakeSocket.latest();
		}
		async function signIn(push: Record<string, unknown> = { webpush: { key: 'BNcR' } }, you = 'ada'): Promise<void> {
			client.useToken('apron_token');
			vi.advanceTimersByTime(0);
			socket = FakeSocket.latest();
			await greet(push, you);
		}

		it('registers on each connection while the server offers the kind, and unregisters a replaced one', async () => {
			client.setPushRegistration(webpush, 'ada');
			// A guest has no one to push to: nothing is registered.
			await greet({ webpush: { key: 'BNcR' } });
			expect(sent('push_register')).toEqual([]);
			// Signed in to the account, it registers.
			await signIn();
			expect(sent('push_register')).toEqual([webpush]);
			// The same registration again sends nothing.
			client.setPushRegistration({ ...webpush, keys: { auth: 'c2Vj', p256dh: 'BPk' }, push_id: 'a1' }, 'ada');
			expect(sent('push_register')).toHaveLength(1);
			await socket.reply('push_register', {});
			// A new subscription (another key) unregisters the old endpoint.
			const renewed = { ...webpush, url: 'https://push.example/b' };
			client.setPushRegistration(renewed, 'ada');
			expect(sent('push_unregister')).toEqual([{ url: webpush.url }]);
			expect(sent('push_register')).toEqual([webpush, renewed]);
			await socket.reply('push_unregister', {});
			// Each connection registers again.
			reconnect();
			await greet({ webpush: { key: 'BNcR' } });
			expect(sent('push_register')).toEqual([renewed]);
			await socket.reply('push_register', {});
			// Turning push off unregisters.
			client.setPushRegistration(undefined);
			expect(sent('push_unregister')).toEqual([{ url: renewed.url }]);
			// A server without the kind is never asked, until a replacing server frame offers it.
			client.setPushRegistration(renewed, 'ada');
			reconnect();
			await greet({ relay: {} });
			expect(sent('push_register')).toEqual([]);
			socket.receive({ method: 'server', params: { apron: 8, auth: ['token', 'guest'], capabilities: [], push: { webpush: { key: 'BNcR' } } } });
			expect(sent('push_register')).toEqual([renewed]);
		});

		it('registers again, on the same url, when the wake scopes change, once the last registration is answered', async () => {
			client.setPushRegistration({ ...webpush, wake: ['mentions', 'replies'] }, 'ada');
			await signIn({ webpush: { key: 'BNcR' }, wake: ['mentions', 'replies', 'private'] });
			client.setPushRegistration({ ...webpush, wake: ['private'] }, 'ada');
			// One request for a url at a time (§1): the new scopes go after the reply.
			expect(sent('push_register')).toEqual([{ ...webpush, wake: ['mentions', 'replies'] }]);
			await socket.reply('push_register', {});
			expect(sent('push_register')).toEqual([{ ...webpush, wake: ['mentions', 'replies'] }, { ...webpush, wake: ['private'] }]);
			// The same url: nothing to unregister.
			expect(sent('push_unregister')).toEqual([]);
		});

		it('registers only for the account it was made for', async () => {
			client.setPushRegistration(webpush, 'ada');
			await signIn(undefined, 'bob');
			expect(sent('push_register')).toEqual([]);
			client.setPushRegistration({ ...webpush, push_id: 'b2' }, 'bob');
			expect(sent('push_register')).toEqual([{ ...webpush, push_id: 'b2' }]);
		});

		it('unregisters a replaced registration after the next auth when it couldn\'t at once', async () => {
			client.setPushRegistration(webpush, 'ada');
			await signIn();
			socket.drop();
			const renewed = { ...webpush, url: 'https://push.example/b' };
			client.setPushRegistration(renewed, 'ada');
			vi.advanceTimersByTime(5_000);
			socket = FakeSocket.latest();
			await greet({ webpush: { key: 'BNcR' } });
			expect(socket.sent.filter((frame) => frame.method === 'push_unregister' || frame.method === 'push_register').map((frame) => [frame.method, frame.params]))
				.toEqual([['push_unregister', { url: webpush.url }], ['push_register', renewed]]);
			await socket.reply('push_unregister', {});
			// One lost with its connection goes again; one the server answered doesn't.
			client.setPushRegistration(undefined);
			reconnect();
			await greet({ webpush: { key: 'BNcR' } });
			expect(sent('push_unregister')).toEqual([{ url: renewed.url }]);
			await socket.reply('push_unregister', {});
			reconnect();
			await greet({ webpush: { key: 'BNcR' } });
			expect(sent('push_unregister')).toEqual([]);
		});

		it('turns push off then on in order: the register waits for the unregister\'s reply', async () => {
			client.setPushRegistration(webpush, 'ada');
			await signIn();
			await socket.reply('push_register', {});
			const order = () => socket.sent.filter((frame) => frame.method === 'push_unregister' || frame.method === 'push_register').map((frame) => frame.method);
			client.setPushRegistration(undefined);
			client.setPushRegistration(webpush, 'ada');
			expect(order()).toEqual(['push_register', 'push_unregister']);
			await socket.reply('push_unregister', {});
			expect(order()).toEqual(['push_register', 'push_unregister', 'push_register']);
			// Other urls don't wait.
			client.setPushOff('https://push.example/old');
			expect(sent('push_unregister')).toEqual([{ url: webpush.url }, { url: 'https://push.example/old' }]);
		});

		it('sends a queued unregister only as the account it belongs to', async () => {
			client.setPushRegistration(webpush, 'ada');
			await signIn();
			socket.drop();
			// Turned off while offline: ada's registration is to go after the next auth as ada.
			client.setPushRegistration(undefined);
			vi.advanceTimersByTime(5_000);
			socket = FakeSocket.latest();
			// Bob signs in instead: unregistering would remove Bob's registration of that url, if any.
			await greet({ webpush: { key: 'BNcR' } }, 'bob');
			expect(sent('push_unregister')).toEqual([]);
			reconnect();
			await greet({ webpush: { key: 'BNcR' } }, 'ada');
			expect(sent('push_unregister')).toEqual([{ url: webpush.url }]);
		});

		it('shows a refused registration, until one succeeds', async () => {
			client.setPushRegistration(webpush, 'ada');
			await signIn();
			socket.receive({ id: socket.request('push_register').id, error: { code: -32001, message: 'Push is for members only' } });
			await settle();
			expect(snapshot.pushError).toBe('Push is for members only');
			reconnect();
			await greet({ webpush: { key: 'BNcR' } });
			await socket.reply('push_register', {});
			expect(snapshot.pushError).toBeUndefined();
		});

		it('unregisters this browser\'s endpoint after each auth while push is off for the account', async () => {
			client.setPushOff('https://push.example/old');
			await signIn();
			expect(sent('push_unregister')).toEqual([{ url: 'https://push.example/old' }]);
			reconnect();
			await greet({ webpush: { key: 'BNcR' } });
			expect(sent('push_unregister')).toEqual([{ url: 'https://push.example/old' }]);
			// Not for the endpoint it registers.
			client.setPushOff(undefined);
			client.setPushRegistration({ ...webpush, url: 'https://push.example/old' }, 'ada');
			reconnect();
			await greet({ webpush: { key: 'BNcR' } });
			expect(sent('push_unregister')).toEqual([]);
		});

		it('unregisters on sign-out, without waiting for a registration in flight', async () => {
			client.setPushRegistration(webpush, 'ada');
			await signIn();
			expect(sent('push_register')).toEqual([webpush]);
			const signedOut = socket;
			await client.signOut();
			expect(signedOut.sent.filter((frame) => frame.method === 'push_unregister').map((frame) => frame.params)).toEqual([{ url: webpush.url }]);
			// Forgotten: the next account isn't registered with it.
			vi.advanceTimersByTime(0);
			socket = FakeSocket.latest();
			await signIn();
			expect(sent('push_register')).toEqual([]);
		});

		it('sends a sign-out\'s unanswered unregister again when that account signs in, and only then', async () => {
			client.setPushRegistration(webpush, 'ada');
			await signIn();
			await socket.reply('push_register', {});
			const signedOut = socket;
			await client.signOut();
			// The connection is replaced as a guest before the answer comes: it is lost.
			expect(signedOut.sent.filter((frame) => frame.method === 'push_unregister').map((frame) => frame.params)).toEqual([{ url: webpush.url }]);
			vi.advanceTimersByTime(0);
			socket = FakeSocket.latest();
			await greet({ webpush: { key: 'BNcR' } }, 'guest_1');
			expect(sent('push_unregister')).toEqual([]);
			// Another account isn't asked: it would drop that account's registration of the url.
			await signIn(undefined, 'bob');
			expect(sent('push_unregister')).toEqual([]);
			// The same account signs in again: the unregister goes, and push stays off.
			await signIn();
			expect(sent('push_unregister')).toEqual([{ url: webpush.url }]);
			expect(sent('push_register')).toEqual([]);
			await socket.reply('push_unregister', {});
			// Answered, it is done.
			const answered = socket;
			socket.drop();
			vi.advanceTimersByTime(60_000);
			socket = FakeSocket.latest();
			expect(socket).not.toBe(answered);
			await greet({ webpush: { key: 'BNcR' } });
			expect(sent('push_unregister')).toEqual([]);
		});
	});
});

describe('the default room (no cap rooms)', () => {
	let client: ChatClient;
	let snapshot: ClientSnapshot;
	let socket: FakeSocket;

	beforeEach(() => {
		vi.useFakeTimers();
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		client = new ChatClient('ws://fake.test/');
		client.subscribe((next) => (snapshot = next));
		client.start();
		socket = FakeSocket.latest();
	});

	afterEach(() => {
		client.stop();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('posts without room_id until a broadcast names the room, and titles rooms by room_id', async () => {
		await socket.greet(['edit'], { rooms: false });
		expect(socket.sent.some((frame) => frame.method === 'room_list')).toBe(false);
		expect(snapshot.rooms.map((room) => room.id)).toEqual([DEFAULT_ROOM_ID]);
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

describe('identity changes', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('lists the joined rooms again when the connection becomes another user', async () => {
		vi.useFakeTimers();
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		const client = new ChatClient('ws://fake.test/');
		let snapshot: ClientSnapshot | undefined;
		client.subscribe((next) => (snapshot = next));
		client.start();
		const socket = FakeSocket.latest();
		await socket.greet([], { room: { room_id: 'general', title: 'General' } });
		socket.receive({ method: 'user', params: { you: { user_id: 'guest_1', name: 'Renamed' } } });
		expect(socket.sent.filter((frame) => frame.method === 'room_list')).toHaveLength(1);
		socket.receive({ method: 'user', params: { you: { user_id: 'ada', name: 'Ada' } } });
		expect(socket.sent.filter((frame) => frame.method === 'room_list')).toHaveLength(2);
		await socket.reply('room_list', { joined: [{ room_id: 'ops', title: 'Ops' }] });
		expect(snapshot?.rooms.map((room) => room.id)).toEqual(['ops']);
		client.stop();
	});
});

describe('room records and membership', () => {
	let client: ChatClient;
	let snapshot: ClientSnapshot;
	let socket: FakeSocket;

	beforeEach(async () => {
		vi.useFakeTimers();
		FakeSocket.instances = [];
		vi.stubGlobal('WebSocket', FakeSocket);
		client = new ChatClient('ws://fake.test/');
		client.subscribe((next) => (snapshot = next));
		client.start();
		socket = FakeSocket.latest();
		await socket.greet(['rooms'], { room: { room_id: 'general', log_id: '10', title: 'General', description: 'Ops *chatter*', members: [{ user_id: 'guest_1' }] } });
	});

	afterEach(() => {
		client.stop();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	const room = (id: string) => snapshot.rooms.find((candidate) => candidate.id === id);

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
		// Updates never send `private`: omitted, it is kept (§4.3.4).
		quiet(client.updateRoom('s1', { title: 'Secret 2' }));
		expect(socket.request('room_set').params).toEqual({ room_id: 's1', title: 'Secret 2', description: 'Just us' });
		// A thread is created without it, and takes its parent's.
		quiet(client.createRoom({ parentRoomId: 's1', title: 'Plans' }));
		expect(socket.request('room_set').params).toEqual({ parent_room_id: 's1', title: 'Plans' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 's3', log_id: '22', parent_room_id: 's1', private: true, title: 'Plans' }] } });
		expect(room('s3')?.private).toBe(true);
	});

	it('keeps member_count for a truncated member list until a complete one replaces it', async () => {
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'big', log_id: '30', title: 'Big', latest_log_id: '30', members: [{ user_id: 'guest_1' }, { user_id: 'bob' }], member_count: 5000 }] } });
		expect(room('big')?.memberCount).toBe(5000);
		expect(room('big')?.members?.map((member) => member.user_id)).toEqual(['guest_1', 'bob']);
		expect(room('general')?.memberCount).toBeUndefined();
		const listed = client.listRooms();
		await socket.reply('room_list', { not_joined: [{ room_id: 'huge', title: 'Huge', members: [{ user_id: 'carol' }], member_count: 90 }] });
		expect((await listed)[0].memberCount).toBe(90);
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'big', log_id: '30', title: 'Big', latest_log_id: '31', members: [{ user_id: 'guest_1' }] }] } });
		expect(room('big')?.memberCount).toBeUndefined();
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
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms'] } });
		expect(snapshot.memberChangesUnsupported).toBeUndefined();
	});

	it('never installs a ~private message, even one carrying a message_id', async () => {
		socket.receive({ method: 'message', params: { message_id: '50', log_id: '50', room_id: 'general', from: { user_id: '~private' }, body: { text: 'Just you' } } });
		expect(client.message('50')).toBeUndefined();
		expect(room('general')?.notices.map((notice) => notice.body?.text)).toEqual(['Just you']);
	});

	it('never installs a ~private message from a history page', async () => {
		socket.receive({ method: 'server', params: { apron: 8, auth: ['guest'], capabilities: ['rooms', 'history'] } });
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

	it('keeps a listed room’s member_count when an update to its record carries no members', async () => {
		const listed = client.listRooms();
		await socket.reply('room_list', { not_joined: [{ room_id: 'huge', log_id: '60', title: 'Huge', members: [{ user_id: 'carol' }], member_count: 90 }] });
		await listed;
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'huge', log_id: '61', title: 'Huge', description: 'Everyone' }] } });
		expect(snapshot.directory?.find((listing) => listing.id === 'huge')).toMatchObject({ memberCount: 90, members: [{ user_id: 'carol' }] });
		expect(snapshot.directory?.find((listing) => listing.id === 'huge')?.record.description).toBe('Everyone');
	});

	it('keeps where a thread was created as its record changes', async () => {
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'opaque', log_id: '70', parent_room_id: 'general', title: 'T' }] } });
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'opaque', log_id: '75', parent_room_id: 'general', title: 'T', description: 'Now summarized' }] } });
		expect(room('opaque')).toMatchObject({ firstRecordLogId: '70', description: 'Now summarized' });
	});
});
