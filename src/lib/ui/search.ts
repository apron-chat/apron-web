/**
 * Searching messages on this device: what this server's history keeps here
 * (`HistoryKeeper.searchKept`) and what the page holds, by the words of a
 * query. A message matches when its text has every word, in any case and
 * with or without accents, anywhere in it. Results go newest first.
 */
import { compareLogIds } from '$lib/protocol/reducer';
import type { MessageRecord } from '$lib/protocol/types';

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
