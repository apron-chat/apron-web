import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bioOf, userIn, type ChatClient, type ClientSnapshot } from './client';
import { FakeSocket, settle, startClient } from '$lib/test/client';

/**
 * Users (§3.3): one kept object per `user_id`, merged from current objects.
 * The shared fixtures `users.json` and `ext-merge.json` (wire-session.test.ts)
 * cover the merge rules and how senders render; these cover the recorded
 * objects, `user_id` changes, your own object and roles.
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

/** Joined to `general`, its history recovered. */
async function connect(): Promise<void> {
	await socket.greet(['history', 'rooms', 'activity', 'embed:upload'], { room: { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '10', history_log_id: '10' } });
	await socket.reply('history', { more: false, latest_log_id: '10', history_log_id: '10' });
}

describe('kept and recorded users', () => {
	it('keeps the latest recorded object apart from the kept one, by log_id', async () => {
		await connect();
		// A from is a recorded object: it never merges into the kept one (§3.3).
		socket.receive({ method: 'message', params: { message_id: '20', log_id: '20', room_id: 'general', from: { user_id: 'bob', name: 'Bob' }, body: { text: 'hi' } } });
		expect(snapshot.users.bob).toBeUndefined();
		expect(snapshot.recordedUsers.bob).toEqual({ user_id: 'bob', name: 'Bob' });
		socket.receive({ method: 'message', params: { message_id: '21', log_id: '21', room_id: 'general', from: { user_id: 'bob', name: 'Robert' }, body: { text: 'hi' } } });
		expect(snapshot.recordedUsers.bob).toEqual({ user_id: 'bob', name: 'Robert' });
		// A record at a lower log_id, such as one from history, does not replace it; the latest does, an edit too.
		socket.receive({ method: 'message', params: { message_id: '19', log_id: '19', room_id: 'general', from: { user_id: 'bob', name: 'Bobby' }, body: { text: 'older' } } });
		expect(snapshot.recordedUsers.bob).toEqual({ user_id: 'bob', name: 'Robert' });
		socket.receive({ method: 'message', params: { message_id: '20', log_id: '22', room_id: 'general', from: { user_id: 'bob', name: 'Bob' }, body: { text: 'edited' } } });
		expect(snapshot.recordedUsers.bob).toEqual({ user_id: 'bob', name: 'Bob' });
		expect(snapshot.users.bob).toBeUndefined();
	});

	it('keeps an alias one step from the current user_id, and only a user notification with new and old makes one', async () => {
		await connect();
		socket.receive({ method: 'user', params: { new: { user_id: 'bob', name: 'Bob' } } });
		// A user_id change aliases the old ID to the new identity; `old` itself is not merged.
		socket.receive({ method: 'user', params: { new: { user_id: 'ada', name: 'Ada' }, old: { user_id: 'guest_9', name: 'Guest 9' } } });
		expect(userIn(snapshot, { user_id: 'guest_9' })).toEqual({ user_id: 'ada', name: 'Ada' });
		expect(snapshot.users.guest_9).toBeUndefined();
		// Aliases stay one step from the current ID through further changes, and an ID changed back to is no alias.
		socket.receive({ method: 'user', params: { new: { user_id: 'ada_l', name: 'Ada' }, old: { user_id: 'ada', name: 'Ada' } } });
		expect(snapshot.userAliases).toMatchObject({ guest_9: 'ada_l', ada: 'ada_l' });
		socket.receive({ method: 'user', params: { new: { user_id: 'ada', name: 'Ada' }, old: { user_id: 'ada_l', name: 'Ada' } } });
		expect(snapshot.userAliases).toMatchObject({ guest_9: 'ada', ada_l: 'ada' });
		expect(snapshot.userAliases.ada).toBeUndefined();
		expect(userIn(snapshot, { user_id: 'guest_9' })).toEqual({ user_id: 'ada', name: 'Ada' });
		// `old` alone, or `user` with a room_id, is not an identity change (§3.3).
		socket.receive({ method: 'user', params: { old: { user_id: 'bob' } } });
		socket.receive({ method: 'user', params: { room_id: 'general', old: { user_id: 'bob' } } });
		expect(snapshot.users.bob).toEqual({ user_id: 'bob', name: 'Bob' });
		expect(snapshot.userAliases.bob).toBeUndefined();
	});

	it('changes nothing for "ext": {}, keeps null as an ordinary value, and keeps a cleared field cleared', async () => {
		await connect();
		socket.receive({ method: 'user', params: { new: { user_id: 'bob', name: 'Bob', avatar: 'https://example.com/b.png', roles: ['bot'], ext: { irc: { network: 'libera' } } } } });
		const kept = snapshot.users.bob;
		socket.receive({ method: 'user', params: { new: { user_id: 'bob', ext: {} } } });
		expect(snapshot.users.bob).toBe(kept);
		socket.receive({ method: 'user', params: { new: { user_id: 'bob', name: null, roles: [], avatar: '' } } });
		expect(snapshot.users.bob).toEqual({ user_id: 'bob', name: null, avatar: '', roles: [], ext: { irc: { network: 'libera' } } });
		// Cleared stays cleared: a stale recorded `from` doesn't bring the avatar back (§3.3).
		expect(userIn(snapshot, { user_id: 'bob', avatar: 'https://example.com/old.png' }).avatar).toBe('');
	});

	it('ignores users in a history page and applies its memberships', async () => {
		await socket.greet(['history', 'rooms'], { room: { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '13', history_log_id: '10' } });
		await socket.reply('history', {
			messages: [{ message_id: '11', log_id: '11', room_id: 'general', from: { user_id: 'bob', name: 'Bob then' }, body: { text: 'a' } }],
			memberships: [{ log_id: '12', room_id: 'general', members: [{ user: { user_id: 'bob', name: 'Bob then' }, joined: true }, { user: { user_id: 'carol' }, joined: false }] }],
			users: [{ user_id: 'bob', name: 'Bob now' }],
			first_log_id: '11', last_log_id: '13', more: false, latest_log_id: '13', history_log_id: '10'
		});
		expect(snapshot.users.bob).toBeUndefined();
		expect(snapshot.recordedUsers.bob).toEqual({ user_id: 'bob', name: 'Bob then' });
		expect(snapshot.rooms[0].members?.map((member) => member.user_id)).toEqual(['bob']);
		// The timeline keeps the record at its log_id for join and leave lines, and a live one after it.
		expect(snapshot.rooms[0].timeline.memberships).toEqual([
			{ log_id: '12', entries: [{ user: { user_id: 'bob', name: 'Bob then' }, joined: true }, { user: { user_id: 'carol' }, joined: false }] }
		]);
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '14', room_id: 'general', members: [{ user: { user_id: 'bob' }, joined: false }] }] } });
		expect(snapshot.rooms[0].timeline.memberships.map((record) => record.log_id)).toEqual(['12', '14']);
		expect(snapshot.rooms[0].members).toEqual([]);
	});
});

describe('your own user', () => {
	it('merges a you into this connection\'s identity, takes your status only from you, and adopts a me result whole', async () => {
		await connect();
		// `you` merges into this connection's identity.
		socket.receive({ method: 'user', params: { you: { user_id: 'guest_1', avatar: 'https://example.com/me.png' } } });
		expect(snapshot.you).toEqual({ user_id: 'guest_1', name: 'Guest', avatar: 'https://example.com/me.png' });
		expect(snapshot.users.guest_1).toBe(snapshot.you);
		// Your own status comes only from `you`, never from your users entry (§4.5).
		socket.receive({ method: 'user', params: { you: { user_id: 'guest_1', status: 'dnd' } } });
		const listing = client.listMembers('general', 0);
		await socket.reply('room_list', { joined: [], not_joined: [], users: [{ user_id: 'guest_1', name: 'Guest', status: 'offline' }] });
		await listing;
		expect(snapshot.you).toEqual({ user_id: 'guest_1', name: 'Guest', status: 'dnd' });
		// The `you` of a `me` result is complete: it replaces the kept object.
		const profile = client.updateProfile({ avatar: 'https://example.com/me2.png' });
		expect(socket.request('me').params).toEqual({ avatar: 'https://example.com/me2.png' });
		await socket.reply('me', { you: { user_id: 'guest_1', name: 'Guest', avatar: 'https://example.com/me2.png' } });
		await expect(profile).resolves.toEqual({ user_id: 'guest_1', name: 'Guest', avatar: 'https://example.com/me2.png' });
		expect(snapshot.you).toEqual({ user_id: 'guest_1', name: 'Guest', avatar: 'https://example.com/me2.png' });
		expect(snapshot.users.guest_1).toBe(snapshot.you);
		// Clearing a field sends it empty, and what the server kept is adopted.
		const cleared = client.updateProfile({ avatar: '' });
		expect(socket.request('me').params).toEqual({ avatar: '' });
		await socket.reply('me', { you: { user_id: 'guest_1', name: 'Guest' } });
		await expect(cleared).resolves.toEqual({ user_id: 'guest_1', name: 'Guest' });
		expect(snapshot.you).toEqual({ user_id: 'guest_1', name: 'Guest' });
	});

	it('takes your permissions only from you, so a listing that names you keeps them (ext:permissions)', async () => {
		const you = { user_id: 'ada', name: 'Ada', roles: ['admin'], ext: { bio: 'hi', permissions: { move_any: true, add_members: true } } };
		await socket.greet(['rooms', 'ext', 'ext:permissions'], { you });
		expect(snapshot.you).toEqual(you);
		// Your rooms' listing and a joined room carry you as others see you: without permissions.
		const listing = client.listMembers('general', 0);
		await socket.reply('room_list', { joined: [], not_joined: [], users: [{ user_id: 'ada', name: 'Ada', roles: ['admin'], ext: { bio: 'hello' } }] });
		await listing;
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '20', title: 'Ops', members: [{ user_id: 'ada' }] }], users: [{ user_id: 'ada', name: 'Ada', roles: ['admin'] }] } });
		expect(snapshot.you).toEqual({ user_id: 'ada', name: 'Ada', roles: ['admin'], ext: { permissions: { move_any: true, add_members: true } } });
		// A you that changes them still does: a role taken away clears move_any.
		socket.receive({ method: 'user', params: { you: { user_id: 'ada', ext: { permissions: { add_members: true } } } } });
		expect(snapshot.you?.ext).toEqual({ permissions: { add_members: true } });
	});

	it('keeps the server frame\'s title, description and avatar as strings (§3.1)', async () => {
		await socket.greet(['rooms'], { you: { user_id: 'guest_1' } });
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: [], title: 'Work', description: 'The **team**', avatar: 'https://chat.example/icon.png' } });
		expect(snapshot.server).toMatchObject({ title: 'Work', description: 'The **team**', avatar: 'https://chat.example/icon.png' });
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: [], title: 7 } });
		expect(snapshot.server).not.toHaveProperty('title');
		expect(snapshot.server).not.toHaveProperty('avatar');
	});

	it('keeps what users write as sent, bidi embeddings and overrides too: only display drops them (§3.5.2)', async () => {
		await socket.greet(['rooms'], { you: { user_id: 'guest_1', name: 'Guest' } });
		socket.receive({ method: 'user', params: { new: { user_id: 'mal\u202Elory', name: 'Mal\u202Elory\u202C', ext: { bio: 'evil\u202Egnp.exe', key: 'k\u202Ay' } } } });
		expect(snapshot.users['mal\u202Elory']).toEqual({ user_id: 'mal\u202Elory', name: 'Mal\u202Elory\u202C', ext: { bio: 'evil\u202Egnp.exe', key: 'k\u202Ay' } });
		// The bio as shown is cleaned (`ext:bio`).
		expect(bioOf(snapshot.users['mal\u202Elory'])).toBe('evilgnp.exe');
	});

	it('merges roles like any profile field, and an empty list clears them', async () => {
		await socket.greet(['rooms'], { you: { user_id: 'guest_1', roles: ['admin'] } });
		expect(snapshot.you?.roles).toEqual(['admin']);
		socket.receive({ method: 'user', params: { new: { user_id: 'bot_1', name: 'Deploy', roles: ['bot'] } } });
		expect(snapshot.users.bot_1.roles).toEqual(['bot']);
		socket.receive({ method: 'user', params: { new: { user_id: 'bot_1', roles: [] } } });
		expect(snapshot.users.bot_1).toEqual({ user_id: 'bot_1', name: 'Deploy', roles: [] });
		// Cleared stays cleared: a message's recorded `from` with the old roles doesn't bring them back.
		expect(userIn(snapshot, { user_id: 'bot_1', roles: ['bot'] }).roles).toEqual([]);
		socket.receive({ method: 'user', params: { you: { user_id: 'guest_1' } } });
		await settle();
		expect(snapshot.you?.roles).toEqual(['admin']);
	});
});

/**
 * Signing in to an existing account (§3.3): servers announce the previous
 * identity's departure, never an `old` change, which means only the same
 * account under a new `user_id`.
 */
describe('a guest that signs in to an existing account, as others see it', () => {
	it('shows the guest leaving and the account arriving as two people, without an alias', async () => {
		socket.open();
		socket.receive({ method: 'server', params: { apron: 9, auth: ['guest'], capabilities: ['rooms', 'status'] } });
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
