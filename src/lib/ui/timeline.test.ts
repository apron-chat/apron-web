import { describe, expect, it } from 'vitest';
import { ProtocolStore, applyRecords, createTimeline, decodeHistoryRecords, timelineEvents, type MembershipRecord, type TimelineState } from '$lib/protocol/reducer';
import type { RoomSnapshot } from '$lib/protocol/client';
import { markdownText } from '$lib/protocol/markdown';
import type { MessageRecord } from '$lib/protocol/types';
import { escapeMarkdown, buildRoomTimeline, buildThreadTimeline, sidebarRooms, threadEntries, threadEntry, threadDescriptionFor, threadPreview, threadLostPrivacy, threadStartedFrom, threadTitleFor, type TimelineItem } from './timeline';
import { isGrouped, dayLabel, GROUP_WINDOW_MS } from './time';
import { peopleIn, rangeBetween, replySnippet, spanOf } from './messages';

const DAY = 24 * 60 * 60 * 1000;
const base = Date.UTC(2026, 8, 14, 12, 0, 0);

const message = (offset: number, from: string, fields: Partial<MessageRecord> = {}): MessageRecord => ({
	message_id: String(base + offset),
	log_id: String(base + offset),
	room_id: 'general',
	from: { user_id: from, name: from[0].toUpperCase() + from.slice(1) },
	body: { text: `${from} says ${offset}` },
	...fields
});

function timeline(roomId: string, messages: MessageRecord[]): TimelineState {
	const state = createTimeline(roomId);
	return { ...state, events: Object.fromEntries(messages.map((event) => [event.message_id, event])), order: messages.map((event) => event.message_id) };
}

function room(id: string, messages: MessageRecord[] = [], fields: Partial<RoomSnapshot> = {}): RoomSnapshot {
	return { id, title: id, joined: true, timeline: timeline(id, messages), recovering: false, loaded: true, loading: false, notices: [], ...fields };
}

const kinds = (items: TimelineItem[]) => items.map((item) => item.kind);

describe('grouping', () => {
	it('groups a sender’s consecutive messages inside the window', () => {
		expect(isGrouped(message(0, 'alice'), message(1000, 'alice'))).toBe(true);
		expect(isGrouped(message(0, 'alice'), message(GROUP_WINDOW_MS, 'alice'))).toBe(false);
		expect(isGrouped(message(0, 'alice'), message(1000, 'bob'))).toBe(false);
		expect(isGrouped(undefined, message(0, 'alice'))).toBe(false);
	});

	it('labels days relative to now', () => {
		const now = new Date(base + 6 * 60 * 60 * 1000);
		expect(dayLabel(message(0, 'alice'), now)).toBe('Today');
		expect(dayLabel(message(-DAY, 'alice'), now)).toBe('Yesterday');
		expect(dayLabel(message(-3 * DAY, 'alice'), now)).not.toMatch(/Today|Yesterday/);
		expect(dayLabel(message(0, 'alice', { message_id: 'opaque' }), now)).toBe('');
		// Another year spells the year out.
		expect(dayLabel(message(-400 * DAY, 'alice'), now)).toMatch(/\d{4}/);
		expect(dayLabel(message(-3 * DAY, 'alice'), now)).not.toMatch(/\d{4}/);
	});
});

describe('thread grouping', () => {
	const general = room('general');
	const ops = room('ops');
	const deploy = room('t1', [], { parentRoomId: 'general', title: 'Deploy' });
	const orphan = room('t2', [], { parentRoomId: 'gone', title: 'Orphan' });

	it('lists top-level rooms, keeps threads under their parent, and keeps orphaned threads reachable', () => {
		const rooms = [general, deploy, ops, orphan];
		expect(sidebarRooms(rooms).map((entry) => entry.id)).toEqual(['general', 'ops', 't2']);
		expect(threadEntries(rooms, 'general').map((entry) => entry.id)).toEqual(['t1']);
		expect(threadEntries(rooms, 'ops')).toEqual([]);
		expect(threadEntries(rooms, undefined)).toEqual([]);
	});

	it('counts a thread’s messages only once its history has loaded, and shows its newest faces', () => {
		const first = message(1000, 'bob', { room_id: 't1' });
		const second = message(2000, 'dana', { room_id: 't1' });
		const third = message(3000, 'bob', { room_id: 't1', deleted: true, body: undefined });
		const loaded = threadEntry(room('t1', [first, second, third], { parentRoomId: 'general', title: 'Deploy' }));
		expect(loaded).toMatchObject({ id: 't1', parentRoomId: 'general', title: 'Deploy', count: 3, loaded: true, latestMessage: third });
		expect(loaded.participants.map((person) => person.user_id)).toEqual(['dana', 'bob']);
		const partial = threadEntry(room('t1', [first], { parentRoomId: 'general', loaded: false }));
		expect(partial.count).toBeUndefined();
		expect(partial.latestMessage).toBe(first);
	});

	it('finds a thread started from a message by its first reply', () => {
		const parent = room('general', [message(0, 'alice')]);
		const started = room('t9', [message(1000, 'bob', { room_id: 't9', reply_to: { message_id: String(base) } })], { parentRoomId: 'general' });
		expect(threadStartedFrom([parent, started], 'general', String(base))).toBe('t9');
		expect(threadStartedFrom([parent, started], 'general', String(base + 1))).toBeUndefined();
		// Only its newest page loaded: the first loaded reply may just quote the message.
		expect(threadStartedFrom([parent, { ...started, olderAvailable: true }], 'general', String(base))).toBeUndefined();
		expect(threadStartedFrom([parent, { ...started, loaded: false }], 'general', String(base))).toBeUndefined();
	});

	it('tells when a new thread of a private room came out visible to others', () => {
		const secret = { id: 'ops', private: true };
		// Created without `private`, a thread takes its parent's (§4.3.4).
		expect(threadLostPrivacy([secret, { id: 't1', private: true }], 'ops', 't1')).toBe(false);
		expect(threadLostPrivacy([secret, { id: 't1' }], 'ops', 't1')).toBe(true);
		expect(threadLostPrivacy([{ id: 'general' }, { id: 't1' }], 'general', 't1')).toBe(false);
		// Not known yet: nothing to say.
		expect(threadLostPrivacy([secret], 'ops', 't1')).toBe(false);
	});

	it('anchors a card at the thread’s creation', () => {
		// Opaque room IDs: the first record seen, which later edits don't move.
		expect(threadEntry(room('opaque', [], { parentRoomId: 'general', firstRecordLogId: '40', record: { room_id: 'opaque', log_id: '90' } })).anchor).toBe('40');
		expect(threadEntry(room(String(base + 5000), [], { parentRoomId: 'general' })).anchor).toBe(String(base + 5000));
		expect(threadEntry(room('opaque', [], { parentRoomId: 'general', record: { room_id: 'opaque', log_id: '42' } })).anchor).toBe('42');
	});

	it('previews the description as text, else the latest message on one line', () => {
		const latest = message(1000, 'bob', { room_id: 't1', body: { text: 'latest\n  words' } });
		const entry = threadEntry(room('t1', [latest], { parentRoomId: 'general', description: 'Line **one**\nLine two\n\n- Line three' }));
		expect(threadPreview(entry)).toEqual({ label: '', text: 'Line one\nLine two\nLine three', summary: true });
		expect(threadPreview({ ...entry, description: undefined })).toEqual({ label: 'Bob', text: 'latest words', summary: false });
		expect(threadPreview({ ...entry, description: undefined, latestMessage: { ...latest, deleted: true } })).toEqual({ label: '', text: 'Message deleted', summary: false });
		expect(threadPreview({ ...entry, description: undefined, latestMessage: message(1, 'bob', { body: { embeds: [{ kind: 'image' }] } }) })).toMatchObject({ text: 'Attachment' });
		expect(threadPreview({ ...entry, description: undefined, latestMessage: undefined })).toBeUndefined();
	});

	it('titles a new thread after its message’s first line', () => {
		expect(threadTitleFor(message(0, 'alice', { body: { text: '\n  Deploy   the thing \nmore' } }))).toBe('Deploy the thing');
		expect([...threadTitleFor(message(0, 'alice', { body: { text: 'x'.repeat(80) } }))]).toHaveLength(60);
		expect(threadTitleFor(message(0, 'alice', { body: { embeds: [{ kind: 'image' }] } }))).toBe('Thread');
		expect(threadTitleFor(undefined)).toBe('Thread');
	});

	it('describes a thread started from a message with its text, shortened', () => {
		expect(threadDescriptionFor(message(0, 'alice', { body: { text: '  Why did the **4pm** deploy fail?\nThe runner looked fine.\n', format: 'markdown' } }))).toBe('Why did the **4pm** deploy fail?\nThe runner looked fine.');
		expect([...threadDescriptionFor(message(0, 'alice', { body: { text: 'x'.repeat(600), format: 'markdown' } }))!]).toHaveLength(500);
		expect(threadDescriptionFor(message(0, 'alice', { body: { embeds: [{ kind: 'image' }] } }))).toBeUndefined();
		expect(threadDescriptionFor(message(0, 'alice', { deleted: true }))).toBeUndefined();
		// Plain text stays the same text once read as Markdown.
		expect(threadDescriptionFor(message(0, 'alice', { body: { text: '1. not a list\n*not bold* # nor a heading' } }))).toBe('1\\. not a list\n\\*not bold\\* \\# nor a heading');
		// A long one is cut on a line boundary, closing the code fence it leaves open.
		const fenced = `Look:\n${'word '.repeat(60)}\n\`\`\`\n${'const x = 1;\n'.repeat(40)}\`\`\``;
		const cut = threadDescriptionFor(message(0, 'alice', { body: { text: fenced, format: 'markdown' } }))!;
		expect(cut.split('\n').filter((row) => row.startsWith('```'))).toHaveLength(2);
		expect(cut.endsWith('…')).toBe(true);
		expect(cut.split('\n').filter((row) => row.startsWith('const')).every((row) => row === 'const x = 1;')).toBe(true);
		// Setext underlines, entities, and indents stay text too.
		expect(markdownText(escapeMarkdown('Title\n===\na &lt; b\n    not code'))).toBe('Title\n===\na &lt; b\n    not code');
		// A four-backtick fence closes with four.
		const long = threadDescriptionFor(message(0, 'alice', { body: { text: `Code:\n\`\`\`\`\n${'x = 1\n'.repeat(120)}\`\`\`\``, format: 'markdown' } }))!;
		expect(long).toMatch(/\n````\n\n…$/);
		// A short one-liner is all title.
		expect(threadDescriptionFor(message(0, 'alice', { body: { text: 'Deploy?' } }))).toBeUndefined();
	});
});

describe('room view', () => {
	const now = new Date(base + 2 * DAY);
	const first = message(0, 'alice');
	const plain = message(1000, 'bob');
	const later = message(2 * DAY, 'alice');
	// A thread started from the first message a moment later: the message stays, the card follows it.
	const started = threadEntry(room(String(base + 500), [], { parentRoomId: 'general', title: 'Deploy', description: 'Deploy?' }));
	const moved = threadEntry(room(String(base + 1500), [], { parentRoomId: 'general', title: 'Moved' }));
	const bare = threadEntry(room(String(base + DAY), [], { parentRoomId: 'general', title: 'Bare' }));

	it('keeps every message and puts each card where its thread was started, with date dividers', () => {
		const items = buildRoomTimeline({ messages: [first, plain, later], threads: [bare, moved, started], now });
		expect(kinds(items)).toEqual(['date', 'message', 'thread', 'message', 'thread', 'date', 'thread', 'date', 'message']);
		expect(items[1]).toMatchObject({ event: first });
		expect(items[2]).toMatchObject({ key: `thread:${base + 500}` });
		expect(items[3]).toMatchObject({ event: plain, grouped: false });
		expect(items[4]).toMatchObject({ key: `thread:${base + 1500}` });
		expect(items[6]).toMatchObject({ key: `thread:${base + DAY}` });
		expect(items[7]).toMatchObject({ label: 'Today' });
	});

	it('is just the messages without threads', () => {
		const items = buildRoomTimeline({ messages: [first, message(1000, 'alice')], threads: [], now });
		expect(kinds(items)).toEqual(['date', 'message', 'message']);
		expect(items[2]).toMatchObject({ grouped: true });
		expect(buildRoomTimeline({ messages: [], threads: [bare], now }).map((item) => item.kind)).toEqual(['date', 'thread']);
	});
});

describe('thread view', () => {
	it('places each rename by its log position and breaks grouping around it', () => {
		const first = message(1000, 'bob', { room_id: 't1' });
		const second = message(3000, 'bob', { room_id: 't1' });
		const renames = [{ log_id: String(base + 2000), title: 'Deploy', previous: '' }, { log_id: String(base + 4000), title: 'Deploy v2', previous: 'Deploy' }];
		const items = buildThreadTimeline({ messages: [first, second], renames });
		expect(kinds(items)).toEqual(['date', 'message', 'renamed', 'message', 'renamed']);
		expect(items[2]).toMatchObject({ title: 'Deploy' });
		expect(items[3]).toMatchObject({ grouped: false });
		expect(items[4]).toMatchObject({ title: 'Deploy v2' });
	});

	it('is just its messages with date dividers', () => {
		const items = buildThreadTimeline({ messages: [message(1000, 'bob'), message(2000, 'bob')] });
		expect(kinds(items)).toEqual(['date', 'message', 'message']);
	});
});

describe('message helpers', () => {
	it('quotes the first non-empty line, shortened', () => {
		expect(replySnippet(message(0, 'alice', { body: { text: '\n\n  first line  \nsecond' } }))).toBe('first line');
		expect(replySnippet(message(0, 'alice', { body: { text: 'x'.repeat(130) } }))).toHaveLength(120);
		expect(replySnippet(message(0, 'alice', { body: { embeds: [{ kind: 'image' }] } }))).toBe('Attachment');
		expect(replySnippet(message(0, 'alice', { body: {} }))).toBe('Empty message');
	});

	it('lists the people a room has seen, newest first, with the viewer always present', () => {
		const me = { user_id: 'sam', name: 'Sam' };
		const people = peopleIn([message(0, 'alice'), message(1, 'bob'), message(2, 'alice')], me);
		expect(people.map((p) => [p.id, p.me ?? false])).toEqual([['alice', false], ['bob', false], ['sam', true]]);
		expect(peopleIn([message(0, 'sam')], me)).toEqual([{ id: 'sam', name: 'Sam', me: true }]);
	});

	it('offers only the listed members when the room has a members list', () => {
		const me = { user_id: 'sam', name: 'Sam' };
		const messages = [message(0, 'alice'), message(1, 'bob'), message(2, 'carol')];
		// Bob has left; Dana has joined but has not spoken.
		const people = peopleIn(messages, me, [{ user_id: 'alice' }, { user_id: 'carol' }, { user_id: 'dana' }]);
		expect(people.map((p) => p.id)).toEqual(['carol', 'alice', 'dana', 'sam']);
		expect(peopleIn(messages, me, []).map((p) => p.id)).toEqual(['sam']);
		// Memberships keep the list current: posting without joining does not make a member.
		expect(peopleIn(messages, me, [{ user_id: 'alice' }]).map((p) => p.id)).toEqual(['alice', 'sam']);
	});

	it('fills ranges along the timeline order', () => {
		const order = ['a', 'b', 'c', 'd', 'e'];
		expect(rangeBetween(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
		expect(rangeBetween(order, 'a', 'zz')).toEqual(['a', 'zz']);
		expect(spanOf(order, ['e', 'b'])).toEqual(['b', 'c', 'd', 'e']);
		expect(spanOf(order, ['c'])).toEqual(['c']);
	});
});

describe('transient notices and threads not joined', () => {
	const notice = (key: string, after: string) => ({
		key, room_id: 'general', from: { user_id: '~private', name: 'Only you' }, body: { text: key }, after, at: base
	});

	it('places each notice after the messages it followed, and never groups across it', () => {
		const first = message(0, 'alice');
		const second = message(1000, 'alice');
		const third = message(2000, 'alice');
		const items = buildRoomTimeline({
			messages: [first, second, third],
			threads: [],
			notices: [notice('late', String(base + 5000)), notice('between', first.message_id)]
		});
		expect(items.filter((item) => item.kind !== 'date').map((item) => item.kind === 'notice' ? item.notice.key : item.kind === 'message' ? `${item.event.message_id === first.message_id ? 'first' : item.event.message_id === second.message_id ? 'second' : 'third'}${item.grouped ? '+' : ''}` : item.kind))
			.toEqual(['first', 'between', 'second', 'third+', 'late']);
		const thread = buildThreadTimeline({ messages: [first, second], notices: [notice('reply', second.message_id)] });
		expect(kinds(thread)).toEqual(['date', 'message', 'message', 'notice']);
	});

	it('lists a thread open without joining as a card, but never as a room of its own', () => {
		const viewed = room('t3', [message(5, 'bob', { room_id: 't3' })], { parentRoomId: 'general', title: 'Read only', joined: false });
		const orphan = room('t4', [], { parentRoomId: 'gone', title: 'Orphan', joined: false });
		expect(sidebarRooms([room('general'), viewed, orphan]).map((entry) => entry.id)).toEqual(['general']);
		const [entry] = threadEntries([room('general'), viewed], 'general');
		expect(entry).toMatchObject({ id: 't3', joined: false, loaded: true, count: 1 });
	});

	it('gives a listed thread not joined a card with its description, anchored at its creation', () => {
		const first = message(0, 'alice');
		const joined = room('t1', [], { parentRoomId: 'general', title: 'Deploy' });
		const listing = {
			id: 't2', title: 'Incident', parentRoomId: 'general', latestLogId: String(base + 60_000), members: [], joined: false,
			record: { room_id: 't2', log_id: String(base + 1), parent_room_id: 'general', private: true, title: 'Incident', description: 'Pager went *off*' }
		};
		const entries = threadEntries([room('general', [first]), joined], 'general', [listing, { ...listing, id: 't1' }]);
		expect(entries.map((entry) => [entry.id, entry.joined])).toEqual([['t1', true], ['t2', false]]);
		const card = entries[1];
		expect(card).toMatchObject({ title: 'Incident', description: 'Pager went *off*', private: true, anchor: String(base + 1), loaded: false, participants: [] });
		expect(card.count).toBeUndefined();
		expect(threadPreview(card)).toMatchObject({ text: 'Pager went off', summary: true });
		expect(kinds(buildRoomTimeline({ messages: [first], threads: entries }))).toEqual(['date', 'message', 'thread', 'thread']);
	});
});

describe('join and leave lines', () => {
	const now = new Date(base + 2 * DAY);
	const joins = (offset: number, ...entries: [string, boolean][]): MembershipRecord => ({
		log_id: String(base + offset),
		entries: entries.map(([id, joined]) => ({ user: { user_id: id, name: id[0].toUpperCase() + id.slice(1) }, joined }))
	});
	/** Each item as a short label: a message by sender (`+` when grouped), a line by who joined and left. */
	const shape = (items: TimelineItem[]) => items.map((item) => {
		if (item.kind === 'message') return `${item.event.from.user_id}${item.grouped ? '+' : ''}`;
		if (item.kind === 'members') return `+${item.joined.map((user) => user.user_id).join(',')}/-${item.left.map((user) => user.user_id).join(',')}`;
		return item.kind;
	});

	it('places each record at its log_id among the messages, and a message after a line starts a new group', () => {
		const items = buildRoomTimeline({
			messages: [message(0, 'alice'), message(2000, 'alice'), message(4000, 'alice')],
			threads: [],
			memberships: [joins(1000, ['bob', true]), joins(5000, ['carol', false])],
			now
		});
		expect(shape(items)).toEqual(['date', 'alice', '+bob/-', 'alice', 'alice+', '+/-carol']);
		expect(items[2]).toMatchObject({ key: `members:${base + 1000}`, logId: String(base + 1000) });
	});

	it('merges consecutive records into one line, keyed by the first and timed by the last', () => {
		const items = buildRoomTimeline({
			messages: [message(0, 'alice'), message(9000, 'alice')],
			threads: [],
			memberships: [joins(1000, ['bob', true]), joins(2000, ['carol', true]), joins(3000, ['dave', false])],
			now
		});
		expect(shape(items)).toEqual(['date', 'alice', '+bob,carol/-dave', 'alice']);
		expect(items[2]).toMatchObject({ key: `members:${base + 1000}`, logId: String(base + 3000) });
	});

	it('leaves no line for a run that nets to nothing, and does not break the group around it', () => {
		const items = buildRoomTimeline({
			messages: [message(0, 'alice'), message(3000, 'alice')],
			threads: [],
			memberships: [joins(1000, ['guest_1', true]), joins(2000, ['guest_1', false])],
			now
		});
		expect(shape(items)).toEqual(['date', 'alice', 'alice+']);
	});

	it('breaks a run at a message, a thread card, a notice, and a date divider', () => {
		const card = threadEntry(room(String(base + 1500), [], { parentRoomId: 'general', title: 'Card' }));
		const items = buildRoomTimeline({
			messages: [message(0, 'alice'), message(4000, 'alice')],
			threads: [card],
			notices: [{ key: 'n', room_id: 'general', from: { user_id: '~private' }, body: { text: 'n' }, after: String(base + 4000), at: base }],
			memberships: [
				joins(1000, ['bob', true]), joins(2000, ['bob', false]), joins(3000, ['carol', true]),
				joins(5000, ['dave', true]), joins(DAY, ['erin', true]), joins(DAY + 1000, ['erin', false])
			],
			now
		});
		// bob joined before the card and left after it: two lines. The next day's churn nets to nothing, and gets no divider.
		expect(shape(items)).toEqual(['date', 'alice', '+bob/-', 'thread', '+carol/-bob', 'alice', 'notice', '+dave/-']);
	});

	it('orders a notice and a line in the same gap by time', () => {
		const notice = (at: number) => ({ key: 'n', room_id: 'general', from: { user_id: '~private' }, body: { text: 'n' }, after: String(base), at });
		const input = { messages: [message(0, 'alice')], threads: [], memberships: [joins(1000, ['bob', true])], now };
		expect(shape(buildRoomTimeline({ ...input, notices: [notice(base + 500)] }))).toEqual(['date', 'alice', 'notice', '+bob/-']);
		expect(shape(buildRoomTimeline({ ...input, notices: [notice(base + 1500)] }))).toEqual(['date', 'alice', '+bob/-', 'notice']);
	});

	it('gives a line on a new day its date divider', () => {
		const items = buildRoomTimeline({ messages: [message(0, 'alice')], threads: [], memberships: [joins(1000, ['bob', true]), joins(DAY, ['carol', true])], now });
		expect(shape(items)).toEqual(['date', 'alice', '+bob/-', 'date', '+carol/-']);
		expect(items[3]).toMatchObject({ label: 'Yesterday' });
	});

	it('shows a compacted record’s entries as one line, and skips a baseline without breaking the run', () => {
		const baseline = joins(2000, ...Array.from({ length: 25 }, (_, index): [string, boolean] => [`member${index}`, true]));
		const items = buildRoomTimeline({
			messages: [message(0, 'alice')],
			threads: [],
			memberships: [joins(1000, ['bob', true], ['carol', true], ['dave', false]), baseline, joins(3000, ['erin', true])],
			now
		});
		expect(shape(items)).toEqual(['date', 'alice', '+bob,carol,erin/-dave']);
		expect(shape(buildRoomTimeline({ messages: [message(0, 'alice')], threads: [], memberships: [baseline], now }))).toEqual(['date', 'alice']);
	});

	it('orders memberships that history delivered out of order by log_id', () => {
		const store = new ProtocolStore();
		const membership = (offset: number, id: string, joined: boolean) => ({ log_id: String(base + offset), room_id: 'general', members: [{ user: { user_id: id, name: id }, joined }] });
		// The newest page first, then an older one, with a live record repeated in history.
		store.putMembership({ log_id: String(base + 5000), room_id: 'general', user: { user_id: 'dave', name: 'dave' }, joined: true });
		applyRecords(store, decodeHistoryRecords({
			messages: [message(2000, 'alice'), message(4000, 'alice')],
			memberships: [membership(5000, 'dave', true), membership(3000, 'carol', true)]
		}));
		applyRecords(store, decodeHistoryRecords({
			messages: [message(0, 'alice')],
			memberships: [membership(1000, 'bob', true), { log_id: String(base + 500), room_id: 'general', members: [{ user: { user_id: 'bob' }, joined: false }, { user: { user_id: 'erin' }, joined: true }] }]
		}));
		const state = store.timeline('general');
		expect(state.memberships.map((record) => [record.log_id, record.entries.length])).toEqual([
			[String(base + 500), 2], [String(base + 1000), 1], [String(base + 3000), 1], [String(base + 5000), 1]
		]);
		// The member list keeps only the latest per user; the log keeps every record.
		expect(store.members('general')?.map((user) => user.user_id)).toEqual(['dave', 'carol', 'bob', 'erin']);
		const items = buildRoomTimeline({ messages: timelineEvents(state), threads: [], memberships: state.memberships, now });
		// bob left and came back with nothing between: of that run, only erin's join shows.
		expect(shape(items)).toEqual(['date', 'alice', '+erin/-', 'alice', '+carol/-', 'alice', '+dave/-']);
		// The log is published as the same array until it changes.
		expect(store.timeline('general').memberships).toBe(state.memberships);
		store.putMembership({ log_id: String(base + 6000), room_id: 'general', user: { user_id: 'carol' }, joined: false });
		expect(store.timeline('general').memberships).not.toBe(state.memberships);
		// Retention drops the records below the bound with the messages.
		store.evictBefore('general', String(base + 3000));
		expect(store.timeline('general').memberships.map((record) => record.log_id)).toEqual([String(base + 3000), String(base + 5000), String(base + 6000)]);
	});
});
