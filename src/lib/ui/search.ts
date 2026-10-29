/**
 * Searching messages on this device: what this server's history keeps here
 * (`HistoryKeeper.searchKept`) and what the page holds, by the words of a
 * query. A message matches when its text has every word, in any case and
 * with or without accents, anywhere in it. `user:` and `room:` narrow it to
 * whoever sent it and where it is (`parseQuery`). Results go newest first.
 */
import { compareLogIds } from '$lib/protocol/reducer';
import type { Identity, MessageRecord } from '$lib/protocol/types';

/** The most results a search shows: past them, a narrower query finds the rest. */
export const SEARCH_LIMIT = 100;

/** Text as a search compares it: lowercase, without accents (`é` is `e`). */
export function folded(text: string): string {
	return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** A query's words, folded, each once. None for a query of only spaces. */
export function searchTerms(query: string): string[] {
	return [...new Set(folded(query).split(/\s+/).filter(Boolean))];
}

/**
 * A query: its words, and its filters, each folded. `user:@ada` (or `user:ada`, or `user:"Ada Lovelace"` by name)
 * keeps what someone sent; `room:#general` (or `room:general`, or a room's title) keeps what is in a room and its
 * threads. Several of one filter keep what matches any of them.
 */
export interface SearchQuery {
	terms: string[];
	users: string[];
	rooms: string[];
}

/** The filters a query takes, as written before the colon. */
const FILTERS = { user: 'users', room: 'rooms' } as const;

/** Reads a query: `key:value` and `key:"a value"` for the filters, every other run of non-spaces a word. */
export function parseQuery(query: string): SearchQuery {
	const parsed: SearchQuery = { terms: [], users: [], rooms: [] };
	for (const [, key, quoted, bare, word] of query.matchAll(/(?:^|\s)(\w+):(?:"([^"]*)"?|(\S*))|(\S+)/g)) {
		const filter = key === undefined ? undefined : FILTERS[key.toLowerCase() as keyof typeof FILTERS];
		if (key !== undefined && !filter) {
			// Not a filter, such as a time like 14:30: words.
			parsed.terms.push(...searchTerms(`${key}:${quoted ?? bare ?? ''}`));
			continue;
		}
		if (filter) {
			const value = folded((quoted ?? bare ?? '').trim()).replace(filter === 'users' ? /^@/ : /^#/, '');
			if (value && !parsed[filter].includes(value)) parsed[filter].push(value);
			continue;
		}
		parsed.terms.push(...searchTerms(word!));
	}
	parsed.terms = [...new Set(parsed.terms)];
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
	if (!query.terms.length && !query.users.length && !query.rooms.length) return undefined;
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
		return !query.terms.length || matchesTerms(message, query.terms);
	};
}

/** Whether `message` has text holding every one of `terms`; a deleted message has none. */
export function matchesTerms(message: MessageRecord, terms: readonly string[]): boolean {
	if (!terms.length || message.deleted) return false;
	const text = message.body?.text;
	if (typeof text !== 'string' || !text) return false;
	const haystack = folded(text);
	return terms.every((term) => haystack.includes(term));
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
 * About `width` characters of `text` from a little before the first of `terms` it holds, on one line, with each of
 * the terms marked where they occur in it: "…the deploy failed at 4pm…".
 */
export function snippet(text: string, terms: readonly string[], width = 140): SnippetPart[] {
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
	for (const term of terms) {
		for (let at = fold.indexOf(term); at >= 0; at = fold.indexOf(term, at + term.length)) {
			const end = at + term.length;
			ranges.push([from[at], end < from.length ? from[end] : line.length]);
		}
	}
	ranges.sort((a, b) => a[0] - b[0]);
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
