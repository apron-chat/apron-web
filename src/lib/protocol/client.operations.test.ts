import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findMessage, type ChatClient, type ClientSnapshot } from './client';
import { FakeSocket, quiet, settle, startClient } from '$lib/test/client';

/**
 * Operations (§4.1, §4.4, §4.7, §4.8, §4.12): posts, commands, saves and
 * their `ext`, embeds, moves, reactions and uploads, and the intents pending
 * between a request, its broadcast and its result. The shared fixtures
 * `message-saves.json`, `ext-merge.json`, `ext-without-capability.json`,
 * `reactions.json`, `commands.json` and `request-errors.json`
 * (wire-session.test.ts) cover the plain exchanges.
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

const alice = { user_id: 'alice', name: 'Alice' };

function message(id: string, fields: Record<string, unknown> = {}, log = id): Record<string, unknown> {
	return { message_id: id, log_id: log, room_id: 'general', from: alice, body: { text: `m${id}` }, ...fields };
}

const room = (id: string) => snapshot.rooms.find((entry) => entry.id === id)!;

/** Joined to `general` and its thread `thread`. */
async function connect(caps = ['edit', 'rooms', 'reactions']): Promise<void> {
	await socket.greet(caps, { room: { room_id: 'general', log_id: '10', title: 'General' } });
	socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'thread', log_id: '20', parent_room_id: 'general', title: 'Side', description: 'Why *side*' }] } });
}

describe('posts and commands', () => {
	it('authenticates as a guest and sends plain messages with bare cross-room replies', async () => {
		await connect();
		expect(socket.request('auth').params).toMatchObject({ scheme: 'guest' });
		quiet(client.send('thread', 'hello', undefined, { replyTo: '100' }));
		expect(socket.request('message').params).toEqual({ room_id: 'thread', body: { text: 'hello', format: 'plain' }, reply_to: { message_id: '100' } });
		expect(snapshot.pending.map((entry) => entry.room)).toEqual(['thread']);
	});

	it('sends commands with the params of a message, and never an empty message', async () => {
		await socket.greet(['rooms', 'command', 'embed:upload'], { room: { room_id: 'general', title: 'General' } });
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

	it('takes what a request caused before its result (§1): posts, uploads, saves, and new rooms', async () => {
		await connect(['edit', 'rooms', 'reactions', 'embed:upload']);
		const writes: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (url: string) => {
			writes.push(url);
			return new Response(null, { status: 201 });
		}));
		// The broadcast of a post, then its result.
		const sent = client.send('general', 'hi');
		socket.receive({ method: 'message', params: message('100', { from: { user_id: 'guest_1' } }) });
		expect(room('general').timeline.order).toEqual(['100']);
		expect(snapshot.pending).toHaveLength(1);
		await socket.reply('message', { message_id: '100' });
		await expect(sent.promise).resolves.toEqual({ message_id: '100' });
		expect(snapshot.pending).toEqual([]);
		// An upload's pending snapshot, then the result with its write URL.
		const { uploaded } = client.sendFiles('general', '', [new File(['x'], 'x.txt')]);
		socket.receive({ method: 'message', params: message('101', { from: { user_id: 'guest_1' }, body: { text: '', embeds: [{ embed_id: 'e1', kind: 'upload', title: 'x.txt' }] } }) });
		expect(room('general').timeline.events['101'].body?.embeds).toEqual([{ embed_id: 'e1', kind: 'upload', title: 'x.txt' }]);
		await socket.reply('message', { message_id: '101', embeds: [{ embed_id: 'e1', kind: 'upload', write_url: 'http://fake.test/w/e1' }] });
		await uploaded;
		expect(writes).toEqual(['http://fake.test/w/e1']);
		// An edit's snapshot, then its result: the save is settled, and the next one builds on the store.
		const edit = client.editMessage('100', 'edited');
		socket.receive({ method: 'message', params: message('100', { from: { user_id: 'guest_1' }, body: { text: 'edited' } }, '102') });
		await socket.reply('message', { message_id: '100' });
		await edit.promise;
		socket.receive({ method: 'message', params: message('100', { from: { user_id: 'guest_1' }, body: { text: 'by a moderator' } }, '103') });
		quiet(client.setMessageReply('100', '101'));
		expect(socket.request('message').params).toEqual({ message_id: '100', room_id: 'general', body: { text: 'by a moderator' }, reply_to: { message_id: '101' } });
		// A new room is there by the time its result names it.
		const created = client.createRoom({ title: 'Ops' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'ops', log_id: '104', title: 'Ops', members: [{ user_id: 'guest_1' }] }] } });
		socket.receive({ method: 'room_update', params: { memberships: [{ log_id: '104', room_id: 'ops', members: [{ user: { user_id: 'guest_1' }, joined: true }] }] } });
		let visible = false;
		const opened = created.promise.then((result) => (visible = snapshot.rooms.some((entry) => entry.id === result.room_id)));
		await socket.reply('room_set', { room_id: 'ops' });
		await opened;
		expect(visible).toBe(true);
	});
});

describe('saves', () => {
	it('resubmits reply_to bare and the rest of the body on edits, but never ext, which the server merges', async () => {
		await connect();
		const ext = JSON.parse('{"example.org": {"nested": null}, "__proto__": {"opaque": true}}');
		socket.receive({ method: 'message', params: message('100', {
			body: { text: 'old', format: 'markdown', embeds: [{ kind: 'future' }] },
			reply_to: { message_id: '50', log_id: '50', room_id: 'elsewhere', from: alice, body: { text: 'target' } },
			ext
		}) });
		expect(client.message('50')?.room_id).toBe('elsewhere');
		quiet(client.editMessage('100', 'new'));
		const params = socket.request('message').params;
		expect(params).toEqual({
			message_id: '100', room_id: 'general', body: { text: 'new', format: 'markdown', embeds: [{ kind: 'future' }] },
			reply_to: { message_id: '50' }
		});
		// Later saves build on the unconfirmed ones: the edited body is kept.
		quiet(client.setMessageReply('100', null));
		const unreplied = socket.request('message').params;
		expect(unreplied).not.toHaveProperty('reply_to');
		expect(unreplied.body).toEqual({ text: 'new', format: 'markdown', embeds: [{ kind: 'future' }] });
		quiet(client.deleteMessage('100'));
		const deleted = socket.request('message').params;
		expect(deleted).not.toHaveProperty('body');
		expect(deleted).not.toHaveProperty('reply_to');
		expect(deleted).toMatchObject({ message_id: '100', room_id: 'general', deleted: true });
	});

	it('sends only the ext keys a save changes, an empty value clearing one, and settles on a record whatever its ext', async () => {
		await connect(['edit', 'rooms', 'reactions', 'ext']);
		socket.receive({ method: 'message', params: message('100', { body: { text: 'old' }, ext: { irc: { nick: 'ada_' }, git: 'abc' } }) });
		// Remove `git` and change `irc`; the rest of ext is the server's to keep (§4.12).
		quiet(client.saveMessage('100', { ext: { git: '', irc: { nick: 'ada' } } }));
		expect(socket.request('message').params).toEqual({ message_id: '100', room_id: 'general', body: { text: 'old' }, ext: { git: '', irc: { nick: 'ada' } } });
		// The merged record settles the save: the next one builds on the store, and sends no ext.
		socket.receive({ method: 'message', params: message('100', { body: { text: 'old' }, ext: { irc: { nick: 'ada' }, other: 1 } }, '101') });
		socket.receive({ method: 'message', params: message('100', { body: { text: 'new', format: 'markdown' }, ext: { other: 1 } }, '102') });
		quiet(client.editMessage('100', 'later'));
		expect(socket.request('message').params).toEqual({ message_id: '100', room_id: 'general', body: { text: 'later', format: 'markdown' } });
		// A delete sends no ext: a tombstone carries none (§4.4).
		quiet(client.saveMessage('100', { deleted: true, ext: { git: 'x' } }));
		expect(socket.request('message').params).toEqual({ message_id: '100', room_id: 'general', deleted: true });
	});

	it('removes one embed by embed_id, or by value for servers that store embeds as given', async () => {
		await connect();
		const link = { kind: 'link', url: 'https://github.com/a/b/pull/1', og: { title: 'PR' } };
		socket.receive({ method: 'message', params: message('100', {
			body: { text: 'see', format: 'markdown', embeds: [{ embed_id: 'e1', kind: 'upload', title: 'a.png' }, link, { embed_id: 'e2', kind: 'upload', title: 'b.png' }] }
		}) });
		quiet(client.removeEmbed('100', { embed_id: 'e1', kind: 'upload' }));
		expect(socket.request('message').params.body).toEqual({ text: 'see', format: 'markdown', embeds: [link, { embed_id: 'e2', kind: 'upload', title: 'b.png' }] });
		// Later removals build on the unconfirmed save.
		quiet(client.removeEmbed('100', { og: { title: 'PR' }, url: 'https://github.com/a/b/pull/1', kind: 'link' }));
		expect(socket.request('message').params.body).toEqual({ text: 'see', format: 'markdown', embeds: [{ embed_id: 'e2', kind: 'upload', title: 'b.png' }] });
		quiet(client.removeEmbed('100', { embed_id: 'e2', kind: 'upload' }));
		expect(socket.request('message').params.body).toEqual({ text: 'see', format: 'markdown' });
		const missing = client.removeEmbed('100', { embed_id: 'e2', kind: 'upload' });
		await expect(missing.promise).rejects.toThrow('no longer in the message');
	});

	it('edits the text and the embeds in one save: removed ones left out, renamed ones retitled, the rest kept', async () => {
		await connect();
		const photo = { embed_id: 'e1', kind: 'upload', title: 'image.png', url: 'https://chat.test/f/1', og: { title: 'image.png', image: { url: 'https://chat.test/f/1/thumb' } } };
		const link = { kind: 'link', url: 'https://github.com/a/b/pull/1', og: { title: 'PR' } };
		const notes = { embed_id: 'e2', kind: 'upload', title: 'notes.txt', url: 'https://chat.test/f/2' };
		socket.receive({ method: 'message', params: message('100', { body: { text: 'see', format: 'markdown', embeds: [photo, link, notes, { kind: 'future' }] } }) });
		quiet(client.editMessage('100', 'see these', undefined, {
			removed: [{ og: { title: 'PR' }, url: 'https://github.com/a/b/pull/1', kind: 'link' }],
			renamed: [{ embed: { embed_id: 'e1', kind: 'upload' }, title: 'sunset.jpg' }, { embed: { embed_id: 'e2', kind: 'upload' }, title: 'notes.md' }]
		}));
		expect(socket.request('message').params.body).toEqual({ text: 'see these', format: 'markdown', embeds: [
			// og.title showed the old name, so it follows; the server restores its own og anyway (§4.8.2).
			{ ...photo, title: 'sunset.jpg', og: { ...photo.og, title: 'sunset.jpg' } },
			{ ...notes, title: 'notes.md' },
			{ kind: 'future' }
		] });
		// Builds on the unconfirmed save; an embed already gone is skipped; removing the last one drops `embeds`.
		quiet(client.editMessage('100', 'bare', undefined, { removed: [{ embed_id: 'e1', kind: 'upload' }, { embed_id: 'e2', kind: 'upload' }, { kind: 'future' }], renamed: [{ embed: { embed_id: 'gone', kind: 'upload' }, title: 'x' }] }));
		expect(socket.request('message').params.body).toEqual({ text: 'bare', format: 'markdown' });
	});

	it('rejects saves of messages that are not loaded without sending anything', async () => {
		await connect();
		const handle = client.editMessage('404', 'nope');
		await expect(handle.promise).rejects.toThrow('Message has not been loaded');
		expect(socket.sent.some((frame) => frame.method === 'message')).toBe(false);
	});

	it('creates threads and updates rooms from the latest record', async () => {
		await connect(['edit', 'rooms', 'reactions', 'ext']);
		quiet(client.createRoom({ parentRoomId: 'general', title: 'Deploy', description: 'Deploy?' }));
		expect(socket.request('room_set').params).toEqual({ parent_room_id: 'general', title: 'Deploy', description: 'Deploy?' });
		socket.receive({ method: 'room_update', params: { joined: [{ room_id: 'thread', log_id: '21', parent_room_id: 'general', title: 'Side', description: 'Deploy?', ext: { x: { y: 1 } } }] } });
		quiet(client.updateRoom('thread', { title: 'Renamed' }));
		// `ext` merges (§4.12): an update never resubmits it.
		expect(socket.request('room_set').params).toEqual({ room_id: 'thread', title: 'Renamed', description: 'Deploy?' });
		// A second update before the first is confirmed builds on it; an empty ext value removes that key.
		quiet(client.updateRoom('thread', { description: null, ext: { x: {} } }));
		expect(socket.request('room_set').params).toEqual({ room_id: 'thread', title: 'Renamed', ext: { x: {} } });
		// The matching record confirms it; later updates build on the store again.
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'thread', log_id: '22', parent_room_id: 'general', title: 'Renamed', ext: { w: 1 } }] } });
		socket.receive({ method: 'room_update', params: { updated: [{ room_id: 'thread', log_id: '23', parent_room_id: 'general', title: 'Elsewhere' }] } });
		quiet(client.updateRoom('thread', { ext: { z: 1 } }));
		expect(socket.request('room_set').params).toEqual({ room_id: 'thread', title: 'Elsewhere', ext: { z: 1 } });
	});

	it('writes ext only to a server with capability ext (§4.12), and still reads what it sends', async () => {
		await connect();
		socket.receive({ method: 'message', params: message('100', { ext: { irc: { nick: 'ada_' } } }) });
		expect(client.message('100')?.ext).toEqual({ irc: { nick: 'ada_' } });
		quiet(client.send('general', 'hi', 'plain', { ext: { irc: { msgid: 'a1' } } }));
		expect(socket.request('message').params).toEqual({ room_id: 'general', body: { text: 'hi', format: 'plain' } });
		quiet(client.saveMessage('100', { ext: { irc: '' } }));
		expect(socket.request('message').params).toEqual({ message_id: '100', room_id: 'general', body: { text: 'm100' } });
		quiet(client.createRoom({ title: 'Ops', ext: { bot: { on: true } } }));
		expect(socket.request('room_set').params).toEqual({ title: 'Ops' });
		quiet(client.updateRoom('thread', { ext: { bot: { on: true } } }));
		expect(socket.request('room_set').params).toEqual({ room_id: 'thread', title: 'Side', description: 'Why *side*' });
		void client.updateProfile({ name: 'Ada', ext: { tz: 'Europe/Oslo' } }).catch(() => undefined);
		expect(socket.request('me').params).toEqual({ name: 'Ada' });
	});

	it('sends a bio to a server with ext:bio, and no other ext key', async () => {
		await connect(['ext:bio']);
		void client.updateProfile({ ext: { bio: 'Counts things.' } }).catch(() => undefined);
		expect(socket.request('me').params).toEqual({ ext: { bio: 'Counts things.' } });
		void client.updateProfile({ name: 'Ada', ext: { bio: '', tz: 'Europe/Oslo' } }).catch(() => undefined);
		expect(socket.request('me').params).toEqual({ name: 'Ada' });
	});

	it('builds an edit then a move on the submitted state until a matching snapshot arrives', async () => {
		await connect();
		socket.receive({ method: 'message', params: message('100') });
		const edit = client.editMessage('100', 'edited');
		quiet(client.moveMessage('100', 'thread'));
		expect(socket.request('message').params).toEqual({ message_id: '100', room_id: 'thread', body: { text: 'edited' } });
		// The edit's result arrives before its snapshot: still pending.
		socket.receive({ id: socket.sent.filter((frame) => frame.method === 'message')[0].id, result: { message_id: '100' } });
		await edit.promise;
		// A failed save is dropped: the next save builds on the store.
		const move = socket.request('message');
		socket.receive({ id: move.id, error: { code: -32001, message: 'denied' } });
		await settle();
		const reply = client.setMessageReply('100', '99');
		expect(socket.request('message').params).toEqual({ message_id: '100', room_id: 'general', body: { text: 'm100' }, reply_to: { message_id: '99' } });
		// After its result, the next newer snapshot settles the save even if the server normalized it.
		await socket.reply('message', { message_id: '100' });
		await reply.promise;
		socket.receive({ method: 'message', params: message('100', { body: { text: 'normalized' } }, '101') });
		quiet(client.editMessage('100', 'again'));
		expect(socket.request('message').params).toEqual({ message_id: '100', room_id: 'general', body: { text: 'again' } });
	});
});

describe('moves and reactions', () => {
	it('re-homes a moved message and its reactions into the destination room, a moved tombstone still deleted', async () => {
		await connect();
		socket.receive({ method: 'message', params: message('100') });
		socket.receive({ method: 'reactions', params: { log_id: '101', message_id: '100', room_id: 'general', reactions: [{ from: { user_id: 'bob' }, emojis: ['👍'] }] } });
		expect(room('general').timeline.reactions['100']?.[0]).toMatchObject({ emoji: '👍', count: 1, user_ids: ['bob'], mine: false });
		quiet(client.moveMessage('100', 'thread'));
		expect(socket.request('message').params).toEqual({ message_id: '100', room_id: 'thread', body: { text: 'm100' } });
		socket.receive({ method: 'message', params: message('100', { room_id: 'thread' }, '102') });
		expect(room('general').timeline.order).toEqual([]);
		expect(room('thread').timeline.order).toEqual(['100']);
		expect(room('thread').timeline.reactions['100']?.[0].user_ids).toEqual(['bob']);
		expect(findMessage(snapshot.rooms, '100')?.room_id).toBe('thread');
		// A tombstone stays deleted when it is moved.
		socket.receive({ method: 'message', params: { message_id: '200', log_id: '205', room_id: 'general', from: alice, deleted: true } });
		quiet(client.moveMessage('200', 'thread'));
		expect(socket.request('message').params).toEqual({ message_id: '200', room_id: 'thread', deleted: true });
	});

	it('sets, toggles, and clears your own reactions and hides them on tombstones', async () => {
		await connect();
		socket.receive({ method: 'message', params: message('100') });
		quiet(client.toggleReaction('100', '👍'));
		expect(socket.request('reactions').params).toEqual({ message_id: '100', emojis: ['👍'] });
		// A second toggle before the broadcast builds on the pending set.
		quiet(client.toggleReaction('100', '🎉'));
		expect(socket.request('reactions').params).toEqual({ message_id: '100', emojis: ['👍', '🎉'] });
		socket.receive({ method: 'reactions', params: { log_id: '101', message_id: '100', room_id: 'general', reactions: [{ from: { user_id: 'guest_1' }, emojis: ['👍', '🎉'] }] } });
		await socket.reply('reactions', {});
		expect(client.ownReactions('100')).toEqual(['👍', '🎉']);
		expect(room('general').timeline.reactions['100']?.map((entry) => [entry.emoji, entry.mine])).toEqual([['🎉', true], ['👍', true]]);
		quiet(client.toggleReaction('100', '👍'));
		expect(socket.request('reactions').params).toEqual({ message_id: '100', emojis: ['🎉'] });
		socket.receive({ method: 'message', params: { ...message('100', { deleted: true }, '103'), body: undefined } });
		expect(room('general').timeline.reactions['100']).toBeUndefined();
		expect(client.reactions('100')).toBeUndefined();
	});

	it('keeps a pending reaction intent through the broadcast of an earlier set, or a result before its broadcast', async () => {
		await connect();
		socket.receive({ method: 'message', params: message('100') });
		quiet(client.toggleReaction('100', 'A'));
		quiet(client.toggleReaction('100', 'B'));
		socket.receive({ method: 'reactions', params: { log_id: '101', message_id: '100', room_id: 'general', reactions: [{ from: { user_id: 'guest_1' }, emojis: ['A'] }] } });
		expect(client.ownReactions('100')).toEqual(['A', 'B']);
		quiet(client.toggleReaction('100', 'C'));
		expect(socket.request('reactions').params).toEqual({ message_id: '100', emojis: ['A', 'B', 'C'] });
		socket.receive({ method: 'reactions', params: { log_id: '102', message_id: '100', room_id: 'general', reactions: [{ from: { user_id: 'guest_1' }, emojis: ['C', 'B', 'A'] }] } });
		expect(client.ownReactions('100')).toEqual(['C', 'B', 'A']);
		// Its result before the broadcast keeps it too.
		socket.receive({ method: 'message', params: message('110') });
		quiet(client.toggleReaction('110', 'A'));
		await socket.reply('reactions', {});
		expect(client.ownReactions('110')).toEqual(['A']);
		// A no-op request (the store already matches) settles on its result.
		quiet(client.react('110', []));
		await socket.reply('reactions', {});
		expect(client.ownReactions('110')).toEqual([]);
		// An error drops the intent.
		quiet(client.toggleReaction('110', 'B'));
		socket.receive({ id: socket.request('reactions').id, error: { code: -32602, message: 'bad' } });
		await settle();
		expect(client.ownReactions('110')).toEqual([]);
	});
});

describe('uploads', () => {
	beforeEach(async () => {
		await socket.greet(['history', 'rooms', 'embed:upload', 'command'], { room: { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '10', history_log_id: '10' } });
		await socket.reply('history', { more: false, latest_log_id: '10', history_log_id: '10' });
	});

	it('sends files as upload embeds and writes each to its write_url', async () => {
		const writes: Array<{ url: string; body: unknown }> = [];
		vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
			writes.push({ url, body: init.body });
			return new Response(null, { status: 201 });
		}));
		const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
		const { sent, uploaded } = client.sendFiles('general', 'see attached', [file]);
		expect(socket.request('message').params).toEqual({ room_id: 'general', body: { text: 'see attached', format: 'plain', embeds: [{ kind: 'upload', title: 'notes.txt' }] } });
		await socket.reply('message', { message_id: '50', embeds: [{ embed_id: 'embed_1', kind: 'upload', write_url: 'http://fake.test/write/abc' }] });
		await expect(sent).resolves.toMatchObject({ message_id: '50' });
		await uploaded;
		expect(writes).toEqual([{ url: 'http://fake.test/write/abc', body: file }]);
		expect(snapshot.uploads).toEqual({});
	});

	it('keeps a failed write visible until dismissed', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 413 })));
		const { uploaded } = client.sendFiles('general', '', [new File(['x'], 'big.bin')]);
		await socket.reply('message', { message_id: '51', embeds: [{ embed_id: 'embed_2', kind: 'upload', write_url: 'http://fake.test/write/x' }] });
		await expect(uploaded).rejects.toThrow(/larger than this server accepts/);
		expect(snapshot.uploads.embed_2).toMatchObject({ name: 'big.bin', failed: expect.stringMatching(/larger/) });
		client.dismissUpload('embed_2');
		expect(snapshot.uploads).toEqual({});
	});

	it('reads a refused write by its standard HTTP meaning only', async () => {
		// What a 409 means beyond "conflict" is the server's own: it is only a refusal here.
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 409 })));
		const reused = client.sendFiles('general', '', [new File(['png'], 'me.png', { type: 'image/png' })]);
		await socket.reply('message', { message_id: '52', embeds: [{ embed_id: 'embed_3', kind: 'upload', write_url: 'http://fake.test/write/y' }] });
		await expect(reused.uploaded).rejects.toThrow('The server refused the upload (409)');
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 415 })));
		const voice = client.sendFiles('general', '', [{ file: new File(['ogg'], 'voice-message.ogg', { type: 'audio/ogg' }), title: 'standup notes' }]);
		// A file renamed before sending goes out under its new name.
		expect((socket.request('message').params.body as { embeds: unknown }).embeds).toEqual([{ kind: 'upload', title: 'standup notes' }]);
		await socket.reply('message', { message_id: '53', embeds: [{ embed_id: 'embed_4', kind: 'upload', write_url: 'http://fake.test/write/z' }] });
		await expect(voice.uploaded).rejects.toThrow(/does not accept this type/);
	});

	it('uploads an avatar with a /avatar command carrying one upload embed', async () => {
		const writes: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (url: string) => {
			writes.push(url);
			return new Response(null, { status: 201 });
		}));
		const done = client.uploadAvatar(new File(['png'], 'me.png', { type: 'image/png' }));
		expect(socket.request('command').params).toEqual({ body: { text: '/avatar', embeds: [{ kind: 'upload', title: 'me.png' }] } });
		expect(socket.sent.some((frame) => frame.method === 'message')).toBe(false);
		await socket.reply('command', { embeds: [{ embed_id: 'embed_3', kind: 'upload', write_url: 'http://fake.test/write/av' }] });
		await done;
		expect(writes).toEqual(['http://fake.test/write/av']);
		// The server then sends `user`, which carries the avatar.
		socket.receive({ method: 'user', params: { you: { user_id: 'guest_1', avatar: 'https://fake.test/f/av' } } });
		expect(snapshot.you?.avatar).toBe('https://fake.test/f/av');
	});
});

describe('uploads that fail, on a server with edit', () => {
	const you = { user_id: 'guest_1', name: 'Guest' };
	/** A message you sent with these upload embeds, as the server broadcasts it while they are pending (§4.8.3). */
	const posted = (id: string, text: string, ids: string[]) => ({
		method: 'message', params: { message_id: id, log_id: id, room_id: 'general', from: you, body: { text, format: 'plain', embeds: ids.map((embed_id) => ({ embed_id, kind: 'upload', title: `${embed_id}.png` })) } }
	});
	const result = (id: string, ids: string[]) => ({ message_id: id, embeds: ids.map((embed_id) => ({ embed_id, kind: 'upload', write_url: `http://fake.test/write/${embed_id}` })) });

	beforeEach(async () => {
		await socket.greet(['history', 'rooms', 'edit', 'embed:upload'], { room: { room_id: 'general', log_id: '10', title: 'General', latest_log_id: '10', history_log_id: '10' } });
		await socket.reply('history', { more: false, latest_log_id: '10', history_log_id: '10' });
	});

	it('takes the failed ones off the message in one save, so no one is left watching them pend (§4.8.2)', async () => {
		// The second write is refused; the first lands.
		vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(null, { status: url.endsWith('/e2') ? 413 : 201 })));
		const { uploaded } = client.sendFiles('general', 'two shots', [new File(['a'], 'a.png'), new File(['b'], 'b.png')]);
		socket.receive(posted('60', 'two shots', ['e1', 'e2']));
		await socket.reply('message', result('60', ['e1', 'e2']));
		await expect(uploaded).rejects.toThrow(/larger than this server accepts/);
		expect(socket.request('message').params).toEqual({ message_id: '60', room_id: 'general', body: { text: 'two shots', format: 'plain', embeds: [{ embed_id: 'e1', kind: 'upload', title: 'e1.png' }] } });
		// Until the save lands, the sender still sees why; then there is nothing left to show it on.
		expect(snapshot.uploads.e2).toMatchObject({ failed: expect.stringMatching(/larger/) });
		await socket.reply('message', { message_id: '60' });
		expect(snapshot.uploads).toEqual({});
	});

	it('deletes a message that had nothing else in it', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 413 })));
		const { uploaded } = client.sendFiles('general', '', [new File(['x'], 'huge.png')]);
		socket.receive(posted('61', '', ['e3']));
		await socket.reply('message', result('61', ['e3']));
		await expect(uploaded).rejects.toThrow();
		expect(socket.request('message').params).toEqual({ message_id: '61', room_id: 'general', deleted: true });
	});

	it('leaves alone a message the server already took the upload off', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 413 })));
		const { uploaded } = client.sendFiles('general', 'see', [new File(['x'], 'huge.png')]);
		socket.receive(posted('62', 'see', ['e4']));
		// The server drops the failed write before the client gets to it.
		socket.receive({ method: 'message', params: { message_id: '62', log_id: '63', room_id: 'general', from: you, body: { text: 'see', format: 'plain' } } });
		await socket.reply('message', result('62', ['e4']));
		await expect(uploaded).rejects.toThrow();
		const saves = socket.sent.filter((frame) => frame.method === 'message' && (frame.params as Record<string, unknown>).message_id === '62');
		expect(saves).toEqual([]);
	});
});
