/**
 * Searching messages on this device: what this server's history keeps here
 * (`HistoryKeeper.searchKept`) and what the page holds, by the text of a
 * query. A message matches when its text holds what was typed, as typed, in
 * any case and with or without accents, any run of spaces as one. `user:` and
 * `room:` narrow it to whoever sent it and where it is (`parseQuery`). Results
 * go newest first.
 */
import { compareLogIds } from '$lib/protocol/reducer';
import type { Identity, MessageRecord } from '$lib/protocol/types';

/** The most results a search shows: past them, a narrower query finds the rest. */
export const SEARCH_LIMIT = 100;

/** Text as a search compares it: lowercase, without accents (`é` is `e`). */
export function folded(text: string): string {
	return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Text as a search compares it: folded, each run of spaces one space, trimmed. */
function searchable(text: string): string {
	return folded(text).replace(/\s+/g, ' ').trim();
}

/**
 * A query: the text to find, and its filters, each folded. `user:@ada` (or `user:ada`, or `user:"Ada Lovelace"` by
 * name) keeps what someone sent; `room:#general` (or `room:general`, or a room's title) keeps what is in a room and
 * its threads. Several of one filter keep what matches any of them.
 */
export interface SearchQuery {
	/** What a message's text must hold, as one run (`searchable`); empty with only filters. */
	text: string;
	users: string[];
	rooms: string[];
}

/** A filter: `user:` or `room:` after a space or at the start, and its value, `"quoted"` or up to the next space. */
const FILTER = /(^|\s)(user|room):(?:"([^"]*)"?|(\S*))/gi;

/**
 * Reads a query: its `user:` and `room:` filters, and the rest as the text to find, quotes around all of it
 * dropped. Anything else with a colon, such as a time like 14:30, is text.
 */
export function parseQuery(query: string): SearchQuery {
	const parsed: SearchQuery = { text: '', users: [], rooms: [] };
	const rest = query.replace(FILTER, (_filter, space: string, key: string, quoted: string | undefined, bare: string | undefined) => {
		const filter = key.toLowerCase() === 'user' ? 'users' : 'rooms';
		const value = folded((quoted ?? bare ?? '').trim()).replace(filter === 'users' ? /^@/ : /^#/, '');
		if (value && !parsed[filter].includes(value)) parsed[filter].push(value);
		return `${space} `;
	});
	const text = searchable(rest);
	parsed.text = /^"[^"]*"$/.test(text) ? text.slice(1, -1).trim() : text;
	return parsed;
}

/** What a search knows to resolve its filters by: the users it has met, and the rooms shown. */
export interface SearchContext {
	users: readonly Identity[];
	rooms: ReadonlyArray<{ id: string; title: string; parentRoomId?: string }>;
	/** The room a thread that isn't shown is in, from its kept record (`parent_room_id`, §3.4). */
	parentOf?: (roomId: string) => string | undefined;
}

/**
 * Whether a message matches `query`, or undefined for a query that asks for nothing. A filter's value is an id or a
 * name, resolved against `context`; one that names no one known still matches a sender's or room's own id, and a
 * sender's name as the message carries it.
 */
export function queryMatcher(query: SearchQuery, context: SearchContext): ((message: MessageRecord) => boolean) | undefined {
	if (!query.text && !query.users.length && !query.rooms.length) return undefined;
	const userIds = new Set(context.users.filter((user) => query.users.some((value) => folded(user.user_id) === value || (user.name !== undefined && folded(user.name) === value))).map((user) => user.user_id));
	const roomIds = new Set(context.rooms.filter((room) => query.rooms.some((value) => folded(room.id) === value || folded(room.title) === value)).map((room) => room.id));
	for (const room of context.rooms) if (room.parentRoomId !== undefined && roomIds.has(room.parentRoomId)) roomIds.add(room.id);
	const byUser = (message: MessageRecord) => userIds.has(message.from.user_id) || query.users.some((value) => folded(message.from.user_id) === value || (typeof message.from.name === 'string' && folded(message.from.name) === value));
	const inRoom = (roomId: string) => roomIds.has(roomId) || query.rooms.includes(folded(roomId));
	const byRoom = (message: MessageRecord) => {
		if (inRoom(message.room_id)) return true;
		const parent = context.parentOf?.(message.room_id);
		return parent !== undefined && inRoom(parent);
	};
	return (message) => {
		if (message.deleted) return false;
		if (query.users.length && !byUser(message)) return false;
		if (query.rooms.length && !byRoom(message)) return false;
		return !query.text || matchesText(message, query.text);
	};
}

/** Whether `message` has text holding `text` (`searchable`); a deleted message has none. */
export function matchesText(message: MessageRecord, text: string): boolean {
	if (!text || message.deleted) return false;
	const body = message.body?.text;
	return typeof body === 'string' && searchable(body).includes(text);
}

/**
 * The newest `limit` of the messages that match, each once (its latest snapshot), from any number of sources,
 * newest first by when each was posted; `more` when others matched too.
 */
export function newestMatches(sources: Iterable<readonly MessageRecord[]>, limit = SEARCH_LIMIT): { messages: MessageRecord[]; more: boolean } {
	const latest = new Map<string, MessageRecord>();
	for (const source of sources) {
		for (const message of source) {
			const kept = latest.get(message.message_id);
			if (!kept || compareLogIds(message.log_id, kept.log_id) > 0) latest.set(message.message_id, message);
		}
	}
	const messages = [...latest.values()].sort((a, b) => compareLogIds(b.message_id, a.message_id));
	return { messages: messages.slice(0, limit), more: messages.length > limit };
}

/** A run of a snippet's text, and whether it is one of the words searched for. */
export interface SnippetPart {
	text: string;
	match: boolean;
}

/**
 * About `width` characters of `text` from a little before where it first holds `found` (`searchable`), on one line,
 * with each place it does marked: "…the deploy failed at 4pm…".
 */
export function snippet(text: string, found: string, width = 140): SnippetPart[] {
	const line = text.replace(/\s+/g, ' ').trim();
	// Where each character of the folded text came from, so a match found there marks the text as written.
	let fold = '';
	const from: number[] = [];
	for (let i = 0; i < line.length; ) {
		const char = String.fromCodePoint(line.codePointAt(i)!);
		for (const unit of folded(char)) {
			fold += unit;
			from.push(i);
		}
		i += char.length;
	}
	const ranges: Array<[number, number]> = [];
	for (let at = found ? fold.indexOf(found) : -1; at >= 0; at = fold.indexOf(found, at + found.length)) {
		const end = at + found.length;
		ranges.push([from[at], end < from.length ? from[end] : line.length]);
	}
	const first = ranges[0]?.[0] ?? 0;
	// A little before it, so the match shows even where only two narrow lines of it do.
	let start = Math.max(0, first - Math.min(30, Math.floor(width / 3)));
	let end = Math.min(line.length, start + width);
	start = Math.max(0, end - width);
	// Whole words at the ends, where it was cut.
	const space = start > 0 ? line.indexOf(' ', start) : -1;
	if (space >= 0 && space < first) start = space + 1;
	if (end < line.length) end = line.lastIndexOf(' ', end) > start ? line.lastIndexOf(' ', end) : end;
	const parts: SnippetPart[] = [];
	const push = (text: string, match: boolean) => {
		if (!text) return;
		const last = parts.at(-1);
		if (last && last.match === match) last.text += text;
		else parts.push({ text, match });
	};
	if (start > 0) push('…', false);
	let at = start;
	for (const [from, to] of ranges) {
		if (to <= at || from >= end) continue;
		push(line.slice(at, Math.max(at, from)), false);
		push(line.slice(Math.max(at, from), Math.min(to, end)), true);
		at = Math.min(to, end);
	}
	push(line.slice(at, end), false);
	if (end < line.length) push('…', false);
	return parts;
}

/** A filter's value being typed, at the caret: whose (`users`) or which rooms', where it starts and ends, and what is typed. */
export interface FilterAtCaret {
	kind: 'users' | 'rooms';
	/** Where its value starts, after `user:` or `room:`, and where it ends: at the next space, or the end. */
	start: number;
	end: number;
	/** What is typed of it before the caret, without its `@` or `#`. */
	typed: string;
}

/** The `user:` or `room:` value the caret is in, for suggesting one, or undefined anywhere else. */
export function filterAtCaret(query: string, caret: number): FilterAtCaret | undefined {
	const found = /(?:^|\s)(user|room):([@#]?)([^\s"]*)$/i.exec(query.slice(0, caret));
	if (!found) return undefined;
	let end = caret;
	while (end < query.length && !/\s/.test(query[end])) end++;
	return { kind: found[1].toLowerCase() === 'user' ? 'users' : 'rooms', start: caret - found[2].length - found[3].length, end, typed: found[3] };
}

/**
 * `query` with the filter value at `at` replaced by `value` and a space after it, and where the caret goes: after
 * that space, ready for the next word.
 */
export function withFilterValue(query: string, at: FilterAtCaret, value: string): { query: string; caret: number } {
	const rest = query.slice(at.end);
	const spaced = rest.startsWith(' ') ? rest : ` ${rest}`;
	return { query: query.slice(0, at.start) + value + spaced, caret: at.start + value.length + 1 };
}

/** Of `people`, those whose name or `user_id` starts with `typed` (any case, with or without accents), one it names exactly first, then those holding it, at most `limit`. */
export function searchPeople<T extends { id: string; name?: string }>(people: readonly T[], typed: string, limit = 8): T[] {
	const wanted = folded(typed.trim());
	return people
		.map((person) => {
			const name = folded(person.name?.trim() ?? '');
			const id = folded(person.id);
			const rank = !wanted ? 1 : name === wanted || id === wanted ? 0 : name.startsWith(wanted) || id.startsWith(wanted) ? 1 : name.includes(wanted) || id.includes(wanted) ? 2 : -1;
			return rank < 0 ? undefined : { person, rank };
		})
		.filter((entry) => entry !== undefined)
		.sort((a, b) => a.rank - b.rank || (a.person.name ?? a.person.id).localeCompare(b.person.name ?? b.person.id, undefined, { sensitivity: 'base' }))
		.slice(0, limit)
		.map(({ person }) => person);
}
