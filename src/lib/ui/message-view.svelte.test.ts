// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot, Notice, UploadState } from '$lib/protocol/client';
import type { Identity, MessageRecord } from '$lib/protocol/types';
import { messageRecord, roomSnapshot } from '$lib/test/builders';
import { directory } from './directory.svelte';
import type { ApronLink } from './apron-link';
import { messageView, noticeView, type LinkedRoom, type MessageCaps, type MessageContext, type MessageRow } from './message-view';
import { avatarHue } from './messages';
import { idWhen } from './time';
import { blankSnapshot } from './session.svelte';

const you: Identity = { user_id: 'you', name: 'You' };
const ada: Identity = { user_id: 'ada', name: 'Ada', roles: ['admin', '', 'admin', 7 as unknown as string], avatar: 'data:image/png;base64,iVBORw0KGgo=' };
const NONE: MessageCaps = { reply: false, edit: false, startThread: false, select: false, removeReply: false, react: false, link: false };

function know(users: Record<string, Identity>, fields: Partial<ClientSnapshot> = {}): void {
	directory.apply({ ...blankSnapshot(), authenticated: true, you, users: { you, ...users }, recordedUsers: {}, userAliases: {}, rooms: [roomSnapshot('ops')], ...fields }, 'https://chat.example');
}

function row(fields: Partial<MessageRow> = {}): MessageRow {
	return { grouped: false, reactions: [], mention: false, pinged: false, highlighted: false, selecting: false, selected: false, editing: false, caps: NONE, ...fields };
}

const SERVER = 'wss://chat.example/ws';

/** A page on SERVER that has `records` and `rooms` loaded, and resolves a link only to them, on SERVER. */
function context(records: MessageRecord[] = [], uploads: Record<string, UploadState> = {}, rooms: LinkedRoom[] = []): MessageContext {
	const resolve = (id: string) => records.find((record) => record.message_id === id);
	const here = (link: ApronLink) => link.server === undefined || link.server === SERVER;
	return {
		resolve,
		linked: (link) => (here(link) ? resolve(link.message!) : undefined),
		linkedRoom: (link) => (here(link) ? rooms.find((room) => room.id === link.room) : undefined),
		server: SERVER,
		uploads
	};
}

beforeEach(() => know({ ada }));
afterEach(() => directory.forget());

describe('messageView', () => {
	it('shows the sender as the directory keeps them: name, current user_id, the roles there are, a loadable avatar and a hue', () => {
		const view = messageView(messageRecord(1710000000000, 'ops', { from: { user_id: 'ada', name: 'Old' } }), row(), context());
		expect(view.sender).toEqual({ user_id: 'ada', name: 'Ada', roles: ['admin'], avatar: ada.avatar, hue: avatarHue('ada') });
		expect([view.id, view.timestamp, view.time]).toEqual(['1710000000000', 1710000000000, new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(1710000000000)]);
	});

	it('gives the handle only where another user shows under the same name', () => {
		expect(messageView(messageRecord(1), row(), context()).sender.handle).toBeUndefined();
		know({ ada, ada2: { user_id: 'ada2', name: 'Ada' } });
		expect(messageView(messageRecord(2), row(), context()).sender.handle).toBe('ada');
	});

	it('renders the body once, as Markdown only when it says so, and marks code blocks', () => {
		const plain = messageView(messageRecord(1, 'ops', { body: { text: '**hi** <b>' } }), row(), context());
		expect(plain.body).toEqual({ html: '**hi** &lt;b&gt;', markdown: false, code: false });
		const markdown = messageView(messageRecord(2, 'ops', { body: { text: '**hi**\n\n```\nx\n```', format: 'markdown' } }), row(), context());
		expect(markdown.body?.markdown).toBe(true);
		expect(markdown.body?.html).toContain('<strong>hi</strong>');
		expect(markdown.body?.code).toBe(true);
	});

	it('leaves out the body of a message with no text and of a tombstone, but not of a system line', () => {
		expect(messageView(messageRecord(1, 'ops', { body: { text: '' } }), row(), context()).body).toBeUndefined();
		const tomb = messageView(messageRecord(2, 'ops', { deleted: true, body: undefined }), row({ reactions: [{ emoji: '👍', count: 1, mine: false, title: '', label: '', reactors: [] }] }), context());
		expect([tomb.deleted, tomb.body, tomb.reactions]).toEqual([true, undefined, undefined]);
		expect(messageView(messageRecord(3, 'ops', { from: { user_id: '~room' }, body: { text: '' } }), row(), context()).body).toEqual({ html: '', markdown: false, code: false });
	});

	it('shows a system message as a line, scoped ones titled as the server names their sender, and either as a message in select mode', () => {
		const line = messageView(messageRecord(1, 'ops', { from: { user_id: '~server', name: 'Server' } }), row(), context());
		expect([line.system, line.scope, line.sender.name]).toEqual([true, 'server', 'Server (~server)']);
		const selecting = messageView(messageRecord(2, 'ops', { from: { user_id: '~server', name: 'Server' } }), row({ selecting: true }), context());
		expect([selecting.system, selecting.selecting]).toEqual([undefined, true]);
	});

	it('quotes the message a reply names, with its mentions picked out, or says it is unavailable', () => {
		const quoted = messageRecord(5, 'other', { from: { user_id: 'ada' }, body: { text: 'ping @you in #ops\nmore' } });
		const reply = messageView(messageRecord(6, 'ops', { from: you, reply_to: { message_id: '5' } }), row(), context([quoted])).reply;
		expect(reply).toEqual({ id: '5', name: 'Ada', avatar: ada.avatar, hue: avatarHue('ada'), snippet: ['ping ', { user_id: 'you', name: 'You', me: true }, ' in ', { roomId: 'ops', name: 'ops', thread: undefined, hash: true }] });
		expect(messageView(messageRecord(7, 'ops', { reply_to: { message_id: '5' } }), row(), context([{ ...quoted, deleted: true }])).reply).toEqual({ id: '5', name: 'Ada', avatar: ada.avatar, hue: avatarHue('ada'), deleted: true });
		expect(messageView(messageRecord(8, 'ops', { reply_to: { message_id: '404' } }), row(), context()).reply).toEqual({});
		expect(messageView(messageRecord(9, 'ops', { reply_to: { message_id: '5' }, deleted: true }), row(), context([quoted])).reply).toBeUndefined();
	});

	it('shows a card for each link to a message, room or thread, in order, at most three: its path and kind always, then what is loaded here', () => {
		know({ ada }, { rooms: [roomSnapshot('ops'), roomSnapshot('t1', [], { title: '', untitled: true, parentRoomId: 'ops' })] });
		const linkedOps = messageRecord(1710000000000, 'ops', { from: { user_id: 'ada' }, body: { text: 'ship it @you\n\n\nnow\nthen\nlater' } });
		const linkedThread = messageRecord(1710000000001, 't1', { from: { user_id: 'ada' }, deleted: true, body: undefined });
		const text = [
			'see https://link.apron.chat/#server=wss://chat.example/ws&room=ops&message=1710000000000.',
			'and apron:?room=t1&message=1710000000001,',
			'not loaded apron:?room=ops&message=404',
			'elsewhere https://link.apron.chat/#server=wss://other.example/&room=ops&message=1710000000000'
		].join('\n');
		const https = (keys: string, server = 'wss://chat.example/ws') => `https://link.apron.chat/#server=${server}&${keys}`;
		const sender = { name: 'Ada', avatar: ada.avatar, hue: avatarHue('ada') };
		expect(messageView(messageRecord(7, 'ops', { from: you, body: { text } }), row(), context([linkedOps, linkedThread])).linkCards).toEqual([
			{
				kind: 'message', href: https('room=ops&message=1710000000000'), server: 'chat.example', in: { id: 'ops', title: 'ops' }, sender,
				timestamp: 1710000000000, time: idWhen('1710000000000'), snippet: ['ship it ', { user_id: 'you', name: 'You', me: true }, '\nnow\nthen']
			},
			{ kind: 'message', href: https('room=t1&message=1710000000001'), server: 'chat.example', in: { id: 't1', thread: true }, sender, timestamp: 1710000000001, time: idWhen('1710000000001'), deleted: true },
			// Not loaded: where it is, as far as that's known.
			{ kind: 'message', href: https('room=ops&message=404'), server: 'chat.example', in: { id: 'ops', title: 'ops' } }
		]);
		// Another server's: its host and IDs, nothing looked up.
		const other = messageView(messageRecord(8, 'ops', { body: { text: 'https://link.apron.chat/#server=wss://other.example/&room=ops&message=1710000000000' } }), row(), context([linkedOps])).linkCards;
		expect(other).toEqual([{ kind: 'message', href: https('room=ops&message=1710000000000', 'wss://other.example/'), server: 'other.example', in: { id: 'ops', unknown: true } }]);
		// A link to the message itself, one in code, a tombstone's, and a system line's show none.
		expect(messageView(messageRecord(9, 'ops', { body: { text: 'apron:?room=ops&message=9' } }), row(), context()).linkCards).toBeUndefined();
		expect(messageView(messageRecord(10, 'ops', { body: { text: '`apron:?room=ops&message=1`', format: 'markdown' } }), row(), context()).linkCards).toBeUndefined();
		expect(messageView(messageRecord(11, 'ops', { deleted: true, body: { text: 'apron:?room=ops&message=1' } }), row(), context()).linkCards).toBeUndefined();
		expect(messageView(messageRecord(12, 'ops', { from: { user_id: '~server' }, body: { text: 'apron:?room=ops&message=1' } }), row(), context()).linkCards).toBeUndefined();
	});

	it('shows a room or thread that is joined or listed with its name, the room a thread is in, its size and its description as text', () => {
		know({ ada }, { rooms: [roomSnapshot('ops', [], { title: 'Ops' }), roomSnapshot('t1', [], { title: 'Deploy', parentRoomId: 'ops' })] });
		const rooms: LinkedRoom[] = [{ id: 'ops', description: 'All things **ops**.\n\nSee the [runbook](https://example.com).', members: 12, private: true }, { id: 't1', parentRoomId: 'ops' }];
		const https = (room: string) => `https://link.apron.chat/#server=wss://chat.example/ws&room=${room}`;
		const text = 'apron:?room=ops and apron:?room=t1 and apron:?room=gone and apron:?room=ops&user=ada';
		expect(messageView(messageRecord(7, 'ops', { body: { text } }), row(), context([], {}, rooms)).linkCards).toEqual([
			{ kind: 'room', href: https('ops'), server: 'chat.example', room: { id: 'ops', title: 'Ops' }, description: 'All things ops.\nSee the runbook.', members: 12, private: true },
			{ kind: 'thread', href: https('t1'), server: 'chat.example', room: { id: 't1', title: 'Deploy', thread: true }, in: { id: 'ops', title: 'Ops' } },
			{ kind: 'room', href: https('gone'), server: 'chat.example', room: { id: 'gone', unknown: true } }
		]);
	});

	it('fills a card in once its message is loaded, and hands back the same view until then', () => {
		const records: MessageRecord[] = [];
		const event = messageRecord(7, 'ops', { body: { text: 'apron:?room=ops&message=5' } });
		const before = messageView(event, row(), context(records));
		expect(before.linkCards?.[0].sender).toBeUndefined();
		expect(messageView(event, row(), context(records))).toBe(before);
		records.push(messageRecord(5, 'ops', { body: { text: 'here' } }));
		expect(messageView(event, row(), context(records)).linkCards?.[0]).toMatchObject({ sender: { name: 'Ada' }, snippet: ['here'] });
	});

	it('lists embeds with their uploads, and lets your own go unless it is the last thing in the message or still being written', () => {
		const embeds = [{ kind: 'upload', embed_id: 'e1', title: 'a' }, { kind: 'upload', embed_id: 'e2', title: 'b' }, { kind: 'link' }];
		const uploads = { e1: { name: 'a', progress: 0.5 }, e2: { name: 'b', failed: 'no' } };
		const own = row({ caps: { ...NONE, edit: true } });
		const view = messageView(messageRecord(1710000000000, 'ops', { body: { text: '', embeds } }), own, context([], uploads));
		expect(view.embeds?.map((item) => [item.key, item.upload?.progress, item.removable])).toEqual([['e1', 0.5, undefined], ['e2', undefined, true], ['2', undefined, true]]);
		expect(view.embeds?.[0].embed).toBe(embeds[0]);
		expect(view.embeds?.[0].detail).toBe(`Ada · ${view.time}`);
		// The only embed of a message without text, anyone else's, or in select mode: no (x).
		expect(messageView(messageRecord(2, 'ops', { body: { text: '', embeds: [embeds[2]] } }), own, context()).embeds?.[0].removable).toBeUndefined();
		expect(messageView(messageRecord(3, 'ops', { body: { text: 'x', embeds } }), row(), context([], uploads)).embeds?.[2].removable).toBeUndefined();
		expect(messageView(messageRecord(4, 'ops', { body: { text: 'x', embeds } }), row({ selecting: true, caps: { ...NONE, edit: true } }), context([], uploads)).embeds?.[2].removable).toBeUndefined();
	});

	it('reads the uploads only for a message with embeds', () => {
		const uploads = vi.fn(() => ({}));
		const reading: MessageContext = { resolve: () => undefined, linked: () => undefined, linkedRoom: () => undefined, server: SERVER, get uploads() { return uploads(); } };
		messageView(messageRecord(1), row(), reading);
		expect(uploads).not.toHaveBeenCalled();
		messageView(messageRecord(2, 'ops', { body: { text: '', embeds: [{ kind: 'link' }] } }), row(), reading);
		expect(uploads).toHaveBeenCalledOnce();
	});

	it('carries where the row sits and what the viewer may do', () => {
		const caps = { ...NONE, reply: true };
		const reactions = [{ emoji: '👍', count: 1, mine: true, title: 'You', label: '👍', reactors: [you] }];
		expect(messageView(messageRecord(1), row({ grouped: true, mention: true, pinged: true, highlighted: true, selecting: true, selected: true, editing: true, caps, reactions }), context()))
			.toMatchObject({ grouped: true, mention: true, pinged: true, highlighted: true, selecting: true, selected: true, editing: true, caps, reactions });
	});

	it('hands back the same view while nothing it shows changed, and a new one when something did', () => {
		const event = messageRecord(1);
		const first = messageView(event, row({ caps: { ...NONE } }), context());
		expect(messageView(event, row({ caps: { ...NONE }, reactions: [] }), context())).toBe(first);
		const highlighted = messageView(event, row({ highlighted: true }), context());
		expect(highlighted).not.toBe(first);
		expect(highlighted.highlighted).toBe(true);
		expect(messageView(event, row({ highlighted: true, caps: { ...NONE, reply: true } }), context()).caps?.reply).toBe(true);
		const chip = { emoji: '👍', count: 1, mine: false, title: 'Ada', label: '👍 1 reaction. Add yours', reactors: [] };
		const reacted = messageView(event, row({ reactions: [chip] }), context());
		expect(messageView(event, row({ reactions: [{ ...chip }] }), context())).toBe(reacted);
		expect(messageView(event, row({ reactions: [{ ...chip, count: 2 }] }), context()).reactions?.[0].count).toBe(2);
	});

	it('follows a rename, read where it is tracked', () => {
		const event = messageRecord(1, 'ops', { body: { text: 'hi @ada' } });
		const cleanup = $effect.root(() => {
			const view = $derived(messageView(event, row(), context()));
			const seen: string[] = [];
			$effect(() => {
				seen.push(`${view.sender.name}|${view.body?.html}`);
			});
			flushSync();
			know({ ada: { ...ada, name: 'Ada L' } });
			flushSync();
			expect(seen).toHaveLength(2);
			expect(seen[1]).toContain('Ada L|');
			expect(seen[1]).toContain('@Ada L');
		});
		cleanup();
	});
});

describe('noticeView', () => {
	it('titles a notice by its sender as the server names it, for only you unless its sender says otherwise', () => {
		const notice: Notice = { key: 'n', room_id: 'ops', from: { user_id: 'bot', name: 'Bot' }, body: { text: 'done' }, after: '1', at: 1710000000000 };
		expect(noticeView(notice)).toEqual({ sender: { user_id: 'bot', name: 'Bot (bot)' }, timestamp: 1710000000000, body: { html: 'done', markdown: false, code: false }, system: true, scope: 'private' });
		expect(noticeView({ ...notice, from: { user_id: '~server' } })).toMatchObject({ sender: { name: '~server' }, scope: 'server' });
	});
});
