import { childRooms, timelineMessages, type Notice, type RoomListing, type RoomRename, type RoomSnapshot } from '$lib/protocol/client';
import { compareLogIds, type MembershipRecord } from '$lib/protocol/reducer';
import { isLogId, type Identity, type MessageRecord } from '$lib/protocol/types';
import { markdownText } from '$lib/protocol/markdown';
import { withoutBidiOverrides } from '$lib/protocol/plain-text';
import { isBaseline, MembershipRun } from './membership';
import { embedsOf, isOwn, senderName, textOf } from './messages';
import { dayKey, dayKeyOf, dayLabel, dayLabelOf, isGrouped } from './time';

/** Longest title a thread started from a message gets, in characters. */
const THREAD_TITLE_MAX = 60;
/** Longest quote of its message a thread started from one begins its description with, in characters. */
const THREAD_DESCRIPTION_MAX = 500;

/**
 * A thread as the sidebar and the room feed see it: a room with a
 * `parent_room_id` (PROTOCOL.md §3.4), plus what its loaded messages add.
 */
export interface ThreadEntry {
	/** The thread's own `room_id`. */
	id: string;
	parentRoomId: string;
	/** Its title, "Untitled" without one (`untitled`). */
	title: string;
	/** It has no title: the design system calls it "Untitled" itself, with its `room_id` on hover (`designTitle`). */
	untitled?: true;
	/** The thread's `description` (§3.4): Markdown, what it's about or what started it. */
	description?: string;
	/** Visible only to its members (§4.2.4). */
	private?: boolean;
	/** Messages in the thread; only known once its history has loaded. */
	count?: number;
	loaded: boolean;
	participants: Identity[];
	/** The log ID of its newest message, for when it was last active; absent when nothing is known. */
	lastReplyId?: string;
	/**
	 * The log ID of its latest activity, for the sidebar's order: its newest
	 * message, else the newest `log_id` the server has said its log holds,
	 * else its creation (`anchor`).
	 */
	activeId?: string;
	latestMessage?: MessageRecord;
	/**
	 * Where the card sits in the parent room's feed: the thread's creation,
	 * its `room_id` when that is a log ID, as both example servers mint it,
	 * else the earliest of its records seen, which edits (a bot keeping the
	 * description current) don't move.
	 */
	anchor?: string;
	/**
	 * The viewer has joined the thread (§4.2.2). A thread not joined is known
	 * from `room_list` or a `room_update`, or open without joining: it still
	 * gets a card, opening it reads its history, and only joining makes it live.
	 */
	joined: boolean;
}

export type TimelineItem =
	| { kind: 'date'; key: string; label: string }
	| { kind: 'message'; key: string; event: MessageRecord; grouped: boolean }
	| { kind: 'thread'; key: string; entry: ThreadEntry }
	| { kind: 'renamed'; key: string; logId: string; title: string }
	| { kind: 'notice'; key: string; notice: Notice }
	/** Consecutive memberships netted out (see `MembershipRun`); `logId` is the last one's. */
	| { kind: 'members'; key: string; logId: string; joined: Identity[]; left: Identity[] };

/**
 * The rooms the sidebar lists at the top level: joined rooms without a
 * parent, and joined threads whose parent is not visible (so they stay
 * reachable). A room opened without joining shows only while it is open.
 */
export function sidebarRooms(rooms: readonly RoomSnapshot[]): RoomSnapshot[] {
	const visible = new Set(rooms.map((room) => room.id));
	return rooms.filter((room) => room.joined && (room.parentRoomId === undefined || !visible.has(room.parentRoomId)));
}

/**
 * The sidebar's two lists of `sidebarRooms`: Rooms, and Private, the
 * top-level private rooms (§4.2.4: `private: true` and no `parent_room_id`),
 * people's conversations and titled private rooms alike. A thread stays
 * under its parent, in whichever list that is.
 */
export function sidebarSections(rooms: readonly RoomSnapshot[]): { rooms: RoomSnapshot[]; private: RoomSnapshot[] } {
	const listed = sidebarRooms(rooms);
	const isPrivate = (room: RoomSnapshot) => room.private === true && room.parentRoomId === undefined;
	return { rooms: listed.filter((room) => !isPrivate(room)), private: listed.filter(isPrivate) };
}

/**
 * The title to hand a design component that names a thread: none for an untitled one, so the component falls back to
 * "Untitled" itself and puts the `room_id` on hover.
 */
export function designTitle(thread: { title: string; untitled?: true }): string | undefined {
	return thread.untitled ? undefined : thread.title;
}

/** One thread room as a card and sidebar row. */
export function threadEntry(room: RoomSnapshot): ThreadEntry {
	const messages = timelineMessages(room);
	let participants: Identity[] = [];
	for (const event of messages) {
		if (!event.from?.user_id || event.deleted) continue;
		participants = [event.from, ...participants.filter((sender) => sender.user_id !== event.from.user_id)].slice(0, 4);
	}
	const latest = messages[messages.length - 1];
	const anchor = isLogId(room.id) ? room.id : room.firstRecordLogId ?? room.record?.log_id;
	const activeId = (latest && isLogId(latest.message_id) ? latest.message_id : undefined) ?? room.latestLogId ?? anchor;
	return {
		id: room.id,
		parentRoomId: room.parentRoomId ?? '',
		title: room.title,
		...(room.untitled ? { untitled: true as const } : {}),
		...(room.description ? { description: room.description } : {}),
		...(room.private ? { private: true } : {}),
		...(room.loaded ? { count: messages.length } : {}),
		loaded: room.loaded,
		participants,
		...(latest ? { lastReplyId: latest.message_id, latestMessage: latest } : {}),
		...(anchor !== undefined ? { anchor } : {}),
		...(activeId !== undefined ? { activeId } : {}),
		joined: room.joined
	};
}

/** A thread the viewer has not joined, from a listing: a card without a count, since its history isn't loaded. */
function unjoinedThreadEntry(listing: RoomListing): ThreadEntry {
	const anchor = isLogId(listing.id) ? listing.id : listing.firstRecordLogId ?? listing.record.log_id;
	const description = listing.record.description;
	const activeId = listing.latestLogId ?? anchor;
	return {
		id: listing.id,
		parentRoomId: listing.parentRoomId ?? '',
		title: listing.title,
		...(listing.untitled ? { untitled: true as const } : {}),
		...(typeof description === 'string' && description ? { description } : {}),
		...(listing.record.private === true ? { private: true } : {}),
		loaded: false,
		participants: [],
		...(listing.latestLogId !== undefined ? { lastReplyId: listing.latestLogId } : {}),
		...(anchor !== undefined ? { anchor } : {}),
		...(activeId !== undefined ? { activeId } : {}),
		joined: false
	};
}

/**
 * Most recently active first (`activeId`), ones with nothing known last;
 * ties by `room_id`, so the order holds still between renders.
 */
export function byActivity(a: ThreadEntry, b: ThreadEntry): number {
	if (a.activeId !== b.activeId) {
		if (a.activeId === undefined) return 1;
		if (b.activeId === undefined) return -1;
		const order = compareLogIds(b.activeId, a.activeId);
		if (order) return order;
	}
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The threads of a room: the ones the client has, joined or open without
 * joining, most recently active first (`byActivity`), then the others listed
 * as not joined (`unjoined`, from `room_list` with `parent_room_id`), in the
 * server's order, which is most recently active first too (§4.2.1).
 */
export function threadEntries(
	rooms: readonly RoomSnapshot[], parentRoomId: string | undefined, unjoined: readonly RoomListing[] = []
): ThreadEntry[] {
	if (parentRoomId === undefined) return [];
	const joined = childRooms(rooms, parentRoomId).map(threadEntry).sort(byActivity);
	const known = new Set(joined.map((entry) => entry.id));
	return [...joined, ...unjoined.filter((listing) => !known.has(listing.id)).map(unjoinedThreadEntry)];
}

/**
 * `entries` in the order `held` lists them, for a list that holds still
 * while the pointer is on it: any not in `held` (new since) lead, in their
 * own order, and any gone from `entries` drop out.
 */
export function inHeldOrder<T extends { id: string }>(entries: readonly T[], held: readonly string[]): T[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const kept = held.flatMap((id) => byId.get(id) ?? []);
	const known = new Set(held);
	return [...entries.filter((entry) => !known.has(entry.id)), ...kept];
}

/**
 * A room's joined threads with news, for the sidebar under a room that isn't
 * open: unread replies or unread mentions. Quiet ones wait until the room is
 * opened, so the sidebar grows only by what needs attention.
 */
export function threadsWithNews(
	rooms: readonly RoomSnapshot[], parentRoomId: string, unread: Record<string, number>, mentions: Record<string, number>
): ThreadEntry[] {
	return threadEntries(rooms, parentRoomId).filter((entry) => entry.joined && ((unread[entry.id] ?? 0) > 0 || (mentions[entry.id] ?? 0) > 0));
}

/** A thread's `description` (§3.4) as text, for a preview; empty without one. */
export function threadDescriptionText(entry: Pick<ThreadEntry, 'description'>): string {
	return entry.description ? markdownText(entry.description).trim() : '';
}

/** A thread's newest loaded message as a preview line (ThreadLines, in the sidebar and on its card): its sender, and its text on one line. */
export function threadLatest(entry: Pick<ThreadEntry, 'latestMessage'>): { sender: string; text: string } | undefined {
	const event = entry.latestMessage;
	if (!event) return undefined;
	if (event.deleted) return { sender: '', text: 'Message deleted' };
	const text = withoutBidiOverrides(textOf(event)).replace(/\s+/g, ' ').trim();
	return { sender: senderName(event), text: text || (embedsOf(event).length ? 'Attachment' : 'Empty message') };
}

/** A title for a thread started from a message: its first non-empty line, shortened, else "Thread". */
export function threadTitleFor(event: MessageRecord | undefined): string {
	const line = (event && !event.deleted ? textOf(event) : '').split('\n').find((part) => part.trim())?.replace(/\s+/g, ' ').trim() ?? '';
	return shorten(line, THREAD_TITLE_MAX) || 'Thread';
}

/**
 * The description a thread started from a message begins with (its `description`,
 * §3.4): the message's text as a Markdown `>` quote, shortened on a line or
 * word boundary with any code fence it leaves open closed. A Markdown message
 * is kept as written; a plain one (§3.5: `format` absent or `plain`) is
 * escaped, since a description is Markdown. The message stays in the parent
 * room; the thread's first reply points back at it with `reply_to`.
 * Undefined when the message has no text.
 */
export function threadDescriptionFor(event: MessageRecord | undefined): string | undefined {
	const text = event && !event.deleted ? textOf(event).trim() : '';
	if (!text) return undefined;
	const markdown = event?.body?.format === 'markdown';
	return quoteMarkdown(shortenMarkdown(markdown ? text : escapeMarkdown(text), THREAD_DESCRIPTION_MAX));
}

/** Markdown as a block quote of itself: every line behind `> `, a blank one behind `>`. */
export function quoteMarkdown(text: string): string {
	return text.split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

/**
 * Plain text as Markdown that renders as the same text: every character
 * Markdown could read as syntax is backslash-escaped (setext `=` underlines
 * and `&` entities included), and a line's leading spaces and tabs become
 * entities, so an indent is never a code block.
 */
export function escapeMarkdown(text: string): string {
	return text.split('\n').map((line) => line
		.replace(/[\\`*_{}[\]()#+\-.!|>~<=&]/g, (character) => `\\${character}`)
		.replace(/^[ \t]+/, (indent) => indent.replace(/ /g, '&#32;').replace(/\t/g, '&#9;'))).join('\n');
}

/**
 * Markdown cut to at most about `max` characters: at the last line break (or
 * else space) before the limit, never mid-word, with a code fence the cut
 * leaves open closed, and an ellipsis after it.
 */
function shortenMarkdown(text: string, max: number): string {
	const chars = [...text];
	if (chars.length <= max) return text;
	let cut = chars.slice(0, max - 1).join('');
	const line = cut.lastIndexOf('\n');
	const space = cut.lastIndexOf(' ');
	if (line > max / 2) cut = cut.slice(0, line);
	else if (space > max / 2) cut = cut.slice(0, space);
	cut = cut.trimEnd();
	// A fence closes with a run of its own character at least as long as the one that opened it.
	let open: string | undefined;
	for (const row of cut.split('\n')) {
		const run = /^ {0,3}(`{3,}|~{3,})/.exec(row)?.[1];
		if (!run) continue;
		if (open === undefined) open = run;
		else if (run[0] === open[0] && run.length >= open.length && /^ {0,3}(`+|~+)\s*$/.test(row)) open = undefined;
	}
	return open !== undefined ? `${cut}\n${open}\n\n…` : `${cut}…`;
}

/**
 * Whether a thread just created in a private room came out visible to
 * others: a thread created without `private` takes its parent's (§4.2.4),
 * so this client never sends it, and a thread of a private room without
 * `private: true` means the server didn't keep it private. False while
 * either record is unknown.
 */
export function threadLostPrivacy(rooms: readonly Pick<RoomSnapshot, 'id' | 'private'>[], parentRoomId: string, threadId: string): boolean {
	const parent = rooms.find((room) => room.id === parentRoomId);
	const thread = rooms.find((room) => room.id === threadId);
	return parent?.private === true && thread !== undefined && thread.private !== true;
}

/**
 * A thread of the room already started from a message, by the convention
 * this client follows: its first message replies to it. Only a thread loaded
 * from its start counts, since a later reply may quote the message too.
 */
export function threadStartedFrom(rooms: readonly RoomSnapshot[], parentRoomId: string, messageId: string): string | undefined {
	return childRooms(rooms, parentRoomId)
		.find((room) => room.loaded && !room.olderAvailable && timelineMessages(room)[0]?.reply_to?.message_id === messageId)?.id;
}

/** At most `max` characters (code points), ending with "…" when cut. */
function shorten(text: string, max: number): string {
	const chars = [...text];
	return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

export interface RoomTimelineInput {
	/** The room's own messages, in timeline order. */
	messages: MessageRecord[];
	/** The room's threads: none for a thread, which has none of its own. */
	threads?: ThreadEntry[];
	/** The room's title changes, ascending. */
	renames?: readonly RoomRename[];
	/** Transient notices shown in the room (§3.5), in arrival order. */
	notices?: readonly Notice[];
	/** The room's membership records (§4.2.2), ascending by `log_id`. */
	memberships?: readonly MembershipRecord[];
	now?: Date;
}

/**
 * Hands out a room's notices in timeline order: each goes after the messages
 * whose `message_id` is at most its position, the newest the room had when it
 * arrived.
 */
function noticeQueue(notices: readonly Notice[]): (before?: string) => Notice[] {
	const queue = [...notices].sort((a, b) => compareLogIds(a.after, b.after) || a.at - b.at);
	let next = 0;
	return (before) => {
		const start = next;
		while (next < queue.length && (before === undefined || compareLogIds(queue[next].after, before) < 0)) next++;
		return queue.slice(start, next);
	};
}

/**
 * A room or thread view: its messages in order, with each thread's card where
 * the thread was started (its anchor), and a "renamed" line where each title
 * change was logged. Date dividers split days. A thread's description shows
 * above them, pinned under the header, not as an item.
 *
 * Join and leave lines sit at their records' `log_id`s among the messages
 * and cards. Records with nothing else between them (a date divider counts)
 * make one line, netted out: a run that nets to nothing leaves no line and
 * does not break a sender's group. Baseline records are skipped (`isBaseline`).
 */
export function buildRoomTimeline({ messages, threads = [], renames = [], notices = [], memberships = [], now = new Date() }: RoomTimelineInput): TimelineItem[] {
	// Cards merge in by anchor; one without an anchor goes last.
	const floating = [...threads];
	floating.sort((a, b) => (a.anchor === undefined ? 1 : b.anchor === undefined ? -1 : compareLogIds(a.anchor, b.anchor)));

	const items: TimelineItem[] = [];
	let lastDay = '';
	let previous: MessageRecord | undefined;
	/** The membership run being collected, and the day it is on; it becomes a line when anything else comes. */
	let run: MembershipRun | undefined;
	let runDay = '';
	const closeRun = () => {
		if (!run) return;
		const { joined, left } = run.net();
		const logId = run.lastLogId, key = `members:${run.firstLogId}`;
		run = undefined;
		if (!joined.length && !left.length) return;
		pushDate(runDay, () => dayLabelOf(logId, now));
		items.push({ kind: 'members', key, logId, joined, left });
		previous = undefined;
	};
	const pushDate = (day: string, label: () => string) => {
		if (day && day !== lastDay) {
			closeRun();
			items.push({ kind: 'date', key: `date:${day}`, label: label() });
			lastDay = day;
			previous = undefined;
		}
	};
	const pushCard = (entry: ThreadEntry) => {
		closeRun();
		if (entry.anchor !== undefined) pushDate(dayKeyOf(entry.anchor), () => dayLabelOf(entry.anchor!, now));
		items.push({ kind: 'thread', key: `thread:${entry.id}`, entry });
		previous = undefined;
	};
	const pushMembership = (record: MembershipRecord) => {
		if (isBaseline(record)) return;
		const day = dayKeyOf(record.log_id);
		// A date divider breaks a run: the day's first line comes after it.
		if (run && day !== runDay) closeRun();
		if (run) run.add(record);
		else {
			run = new MembershipRun(record);
			runDay = day;
		}
	};
	const pushRename = (rename: RoomRename) => {
		closeRun();
		pushDate(dayKeyOf(rename.log_id), () => dayLabelOf(rename.log_id, now));
		items.push({ kind: 'renamed', key: `renamed:${rename.log_id}`, logId: rename.log_id, title: withoutBidiOverrides(rename.title) });
		previous = undefined;
	};
	const pending = noticeQueue(notices);
	// A notice is a system line: it never groups with the messages around it.
	const pushNotice = (notice: Notice) => {
		closeRun();
		items.push({ kind: 'notice', key: notice.key, notice });
		previous = undefined;
	};
	let next = 0;
	let nextMembership = 0;
	let nextRename = 0;
	/**
	 * Everything before `before` (all when undefined) that is not a message:
	 * cards, membership records and renames merged by log position, then the
	 * notices that followed the last message. A notice and a record in the
	 * same gap go by time, since a record's `log_id` is its commit time.
	 */
	const pushGap = (before?: string) => {
		const due = (position: string) => before === undefined || compareLogIds(position, before) < 0;
		const gapNotices = pending(before);
		let notice = 0;
		const noticesBefore = (logId: string) => {
			while (notice < gapNotices.length && gapNotices[notice].at < Number(logId)) pushNotice(gapNotices[notice++]);
		};
		for (;;) {
			const card = next < floating.length && (floating[next].anchor === undefined ? before === undefined : due(floating[next].anchor!)) ? floating[next] : undefined;
			const record = nextMembership < memberships.length && due(memberships[nextMembership].log_id) ? memberships[nextMembership] : undefined;
			const rename = nextRename < renames.length && due(renames[nextRename].log_id) ? renames[nextRename] : undefined;
			if (!card && !record && !rename) break;
			// A card without an anchor goes after everything else.
			const earlier = (logId: string, other: string | undefined) => other === undefined || compareLogIds(logId, other) < 0;
			if (record && earlier(record.log_id, rename?.log_id) && (!card || earlier(record.log_id, card.anchor))) {
				noticesBefore(record.log_id);
				pushMembership(record);
				nextMembership++;
			} else if (rename && (!card || earlier(rename.log_id, card.anchor))) {
				noticesBefore(rename.log_id);
				pushRename(rename);
				nextRename++;
			} else {
				pushCard(card!);
				next++;
			}
		}
		while (notice < gapNotices.length) pushNotice(gapNotices[notice++]);
	};
	for (const event of messages) {
		pushGap(event.message_id);
		closeRun();
		pushDate(dayKey(event), () => dayLabel(event, now));
		items.push({ kind: 'message', key: event.message_id, event, grouped: isGrouped(previous, event) });
		previous = event;
	}
	pushGap();
	closeRun();
	return items;
}

/** The same keys holding the same values, and lists the same items in order: two items or entries that show the same. */
function sameShallow(a: object, b: object): boolean {
	if (a === b) return true;
	const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => {
		const x = left[key], y = right[key];
		if (x === y) return true;
		if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((item, index) => item === y[index]);
		// A thread card's entry, worked out afresh with each snapshot.
		return key === 'entry' && typeof x === 'object' && typeof y === 'object' && x !== null && y !== null && sameShallow(x, y);
	});
}

/**
 * `next`, worked out afresh, with each entry or item that says the same as the one with its id or key in `last`
 * replaced by that one, and `last` itself while all of them do. Thread entries and timeline items are made anew from
 * each snapshot, the client's for any room: kept, a message in another room (or a read) doesn't hand every row on
 * screen a new item to draw again, only those that changed.
 */
export function steady<T extends ThreadEntry | TimelineItem>(last: readonly T[], next: T[]): T[] {
	const keyOf = (value: T): string => ('key' in value ? value.key : value.id);
	const before = new Map(last.map((value) => [keyOf(value), value]));
	const kept = next.map((value) => {
		const old = before.get(keyOf(value));
		return old && sameShallow(old, value) ? old : value;
	});
	return kept.length === last.length && kept.every((value, index) => value === last[index]) ? (last as T[]) : kept;
}

/**
 * The message the New divider goes above: the first after your read
 * position `after`, unless you wrote it. None while nothing at or before
 * `after` is loaded and older messages remain (`olderAvailable`): what is
 * unread starts further back, and the divider would only sit on the oldest
 * loaded message, then move up as older pages load.
 */
export function newDividerBefore(items: readonly TimelineItem[], after: string, you: Identity | undefined, olderAvailable: boolean): string | undefined {
	let reached = false;
	for (const item of items) {
		if (item.kind !== 'message') continue;
		if (compareLogIds(item.event.message_id, after) <= 0) {
			reached = true;
			continue;
		}
		if (!reached && olderAvailable) return undefined;
		return isOwn(item.event, you) ? undefined : item.event.message_id;
	}
	return undefined;
}
