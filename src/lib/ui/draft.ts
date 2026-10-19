import { textId, type MentionPerson } from '$lib/protocol/markdown';

/**
 * A composer draft: text and mention chips. A chip shows a person's name, or
 * with `room` a room's or thread's title, but is sent as `@user_id`
 * (Appendix A.3) or `#room_id`, so the wire text is what a reader's client
 * resolves, whatever it is called by then.
 */
export type DraftChip = { id: string; room?: true };
export type DraftPart = string | DraftChip;

/** A chip as sent: `@user_id` or `#room_id`, one character longer than its ID. */
export function chipText(chip: DraftChip): string {
	return `${chip.room ? '#' : '@'}${chip.id}`;
}

/**
 * The draft as sent: every chip becomes its `@user_id` or `#room_id`. A space
 * goes between a chip and what touches it where readers would otherwise not
 * see the chip's ID (Appendix A.3): after it, text that would make the ID
 * longer (`@ada` then `+1`, or another chip); before it, a letter or digit.
 * So the sent text is longer than the draft where that happens.
 */
export function draftText(parts: DraftPart[]): string {
	let out = '';
	// The ID of the chip the text so far ends with.
	let open: string | undefined;
	for (const part of parts) {
		const text = typeof part === 'string' ? part : chipText(part);
		if (open !== undefined && (textId(open + text)?.length ?? 0) > open.length) out += ' ';
		else if (typeof part !== 'string' && BEFORE_ID.test(out.slice(-1))) out += ' ';
		out += text;
		if (typeof part !== 'string') open = part.id;
		else if (text) open = undefined;
	}
	return out;
}

/** The draft's length in caret positions: a chip counts as its `@user_id` or `#room_id`, with no added space. */
export function draftLength(parts: DraftPart[]): number {
	return parts.reduce((sum, part) => sum + (typeof part === 'string' ? part.length : part.id.length + 1), 0);
}

/**
 * The users a draft mentions (§3.5): one `user_id` per chip, in order. A
 * chip deleted from the text takes its mention with it.
 */
export function draftMentions(parts: DraftPart[]): string[] {
	return [...new Set(parts.filter((part): part is DraftChip => typeof part !== 'string' && !part.room).map((part) => part.id))];
}

/** Merges adjacent text and drops empty text, so equal drafts compare equal. */
export function normalizeDraft(parts: DraftPart[]): DraftPart[] {
	const out: DraftPart[] = [];
	for (const part of parts) {
		if (typeof part !== 'string') out.push(part);
		else if (part && typeof out[out.length - 1] === 'string') out[out.length - 1] += part;
		else if (part) out.push(part);
	}
	return out;
}

export interface CollapseOptions {
	/** Caret position in the draft text; a mention being typed there is left alone. */
	caret: number;
	/** Sending: a mention may end the draft, and nothing is still being typed. */
	final?: boolean;
	/** Whether an ID names a user this client knows, beyond `people`. */
	isUser?: (id: string) => boolean;
	/** The rooms and threads a typed `#room_id` can name. */
	rooms?: string[];
}

export interface Collapsed {
	parts: DraftPart[];
	caret: number;
	changed: boolean;
}

const WORD = /[A-Za-z0-9_]/;
/** An `@` or `#` right after one of these is text (Appendix A.3). */
const BEFORE_ID = /[A-Za-z0-9]/;

/**
 * Turns a typed `@user_id` or `@name` into a chip once it is finished: an
 * exact ID (case-sensitive), or a name (case-insensitive, spaces allowed)
 * that exactly one person in `people` has, followed by a character that
 * cannot continue it. The longest match wins, an ID over a name of the same
 * length. A typed `#room_id` naming one of `rooms` becomes a room chip the
 * same way. While typing, a match the caret sits in, or whose text up to the
 * caret could still grow into a longer name or ID, waits.
 * Mentions inside code spans stay text.
 */
export function collapseMentions(parts: DraftPart[], people: MentionPerson[], options: CollapseOptions): Collapsed {
	const { caret, final = false } = options;
	const isUser = (id: string) => people.some((person) => person.id === id) || (options.isUser?.(id) ?? false);
	const rooms = options.rooms ?? [];
	const out: DraftPart[] = [];
	let changed = false;
	let newCaret = caret;
	let offset = 0;
	let fence = 0;
	parts.forEach((part, index) => {
		if (typeof part !== 'string') {
			out.push(part);
			offset += part.id.length + 1;
			return;
		}
		const followed = index < parts.length - 1;
		const previous = index > 0 ? parts[index - 1] : undefined;
		let last = 0;
		let at = 0;
		while (at < part.length) {
			const char = part[at];
			if (char === '`') {
				let run = 1;
				while (part[at + run] === '`') run += 1;
				fence = fence === 0 ? run : fence === run ? 0 : fence;
				at += run;
				continue;
			}
			// A chip right before sends as `@id`, which ends in an ID character: readers would see this as text.
			const before = at > 0 ? part[at - 1] : typeof previous === 'string' ? previous[previous.length - 1] : previous ? 'x' : undefined;
			const room = char === '#';
			if ((char !== '@' && !room) || fence !== 0 || (before !== undefined && BEFORE_ID.test(before))) {
				at += 1;
				continue;
			}
			const typing = { final, followed, caret: caret - (offset + at + 1) };
			const hit = room ? roomAt(part.slice(at + 1), rooms, typing) : mentionAt(part.slice(at + 1), people, isUser, typing);
			if (!hit) {
				at += 1;
				continue;
			}
			if (at > last) out.push(part.slice(last, at));
			out.push(room ? { id: hit.id, room: true } : { id: hit.id });
			const end = at + 1 + hit.length;
			if (caret >= offset + end) newCaret += hit.id.length - hit.length;
			else if (caret > offset + at) newCaret = newCaret - (caret - (offset + at)) + hit.id.length + 1;
			changed = true;
			last = at = end;
		}
		if (last < part.length) out.push(part.slice(last));
		offset += part.length;
	});
	return { parts: normalizeDraft(out), caret: newCaret, changed };
}

/**
 * The person `rest` (the text after an `@`) starts with, if the mention is
 * finished. `caret` is relative to `rest`.
 */
function mentionAt(
	rest: string,
	people: MentionPerson[],
	isUser: (id: string) => boolean,
	{ final, followed, caret }: { final: boolean; followed: boolean; caret: number }
): { id: string; length: number } | undefined {
	if (rest.startsWith('@')) return undefined;
	const candidates: Array<{ id: string; length: number; exact: boolean }> = [];
	const run = textId(rest);
	if (run && isUser(run)) candidates.push({ id: run, length: run.length, exact: true });
	const lower = rest.toLowerCase();
	for (const person of people) {
		const name = person.name?.trim().toLowerCase();
		if (!name || !lower.startsWith(name)) continue;
		if (name.length < rest.length && WORD.test(rest[name.length])) continue;
		// Sent as `@user_id`, what follows the name must not read as more of the ID ("@Ada.x" is not `@ada` then ".x").
		if ((textId(person.id + rest.slice(name.length))?.length ?? 0) > person.id.length) continue;
		candidates.push({ id: person.id, length: name.length, exact: false });
	}
	if (candidates.length === 0) return undefined;
	const longest = Math.max(...candidates.map((candidate) => candidate.length));
	const best = candidates.filter((candidate) => candidate.length === longest);
	const winner = best.find((candidate) => candidate.exact) ?? best[0];
	if (!winner.exact && best.some((candidate) => candidate.id !== winner.id)) return undefined;
	if (final) return winner;
	// Finished means something follows it, and the caret is past it.
	if (winner.length === rest.length && !followed) return undefined;
	if (caret >= 0 && caret <= winner.length) return undefined;
	// "@Ada Lo" while "Ada Lovelace" is here: still being typed.
	if (caret > winner.length) {
		const typed = lower.slice(0, caret);
		if (!typed.includes('\n') && people.some((person) => {
			const name = person.name?.trim().toLowerCase() ?? '';
			const id = person.id.toLowerCase();
			return (name.length > typed.length && name.startsWith(typed)) || (id.length > typed.length && id.startsWith(typed));
		})) return undefined;
	}
	return winner;
}

/** The room `rest` (the text after a `#`) names, if the `#room_id` is finished; as `mentionAt`, for IDs only. */
function roomAt(
	rest: string,
	rooms: string[],
	{ final, followed, caret }: { final: boolean; followed: boolean; caret: number }
): { id: string; length: number } | undefined {
	const run = textId(rest);
	if (!run || !rooms.includes(run)) return undefined;
	if (final) return { id: run, length: run.length };
	if (run.length === rest.length && !followed) return undefined;
	if (caret >= 0 && caret <= run.length) return undefined;
	const typed = rest.slice(0, caret);
	if (caret > run.length && rooms.some((id) => id.length > typed.length && id.startsWith(typed))) return undefined;
	return { id: run, length: run.length };
}

/** The `@…` being typed at the caret, for the picker: its text and where its `@` is. */
export function mentionQuery(parts: DraftPart[], caret: number): { query: string; start: number } | undefined {
	let offset = 0;
	for (const part of parts) {
		const length = typeof part === 'string' ? part.length : part.id.length + 1;
		if (typeof part === 'string' && caret >= offset && caret <= offset + length) {
			const match = /(?:^|\s)@([^\s@][^@\n]{0,63}|)$/.exec(part.slice(0, caret - offset));
			if (match) return { query: match[1], start: caret - match[1].length - 1 };
		}
		offset += length;
	}
	return undefined;
}

/** A `trigger`-prefixed token at the caret: what's typed after the trigger, and the draft span the whole token covers. */
export interface CaretToken {
	query: string;
	start: number;
	end: number;
}

/**
 * The token the caret sits in: `trigger` then a run of characters matching
 * `char`, starting the draft or following whitespace (a chip right before it
 * doesn't count), and at least `minLength` long. `end` takes in the rest of
 * the token after the caret, so picking a suggestion replaces all of it.
 */
export function tokenAtCaret(parts: DraftPart[], caret: number, trigger: string, char: RegExp, minLength = 0): CaretToken | undefined {
	let offset = 0;
	for (const [index, part] of parts.entries()) {
		const length = typeof part === 'string' ? part.length : part.id.length + 1;
		if (typeof part === 'string' && caret >= offset && caret <= offset + length) {
			const local = caret - offset;
			let from = local;
			while (from > 0 && char.test(part[from - 1])) from--;
			const at = from - 1;
			if (part[at] !== trigger || local - from < minLength) return undefined;
			const before = at > 0 ? part[at - 1] : parts[index - 1];
			if (before !== undefined && (typeof before !== 'string' || !/\s$/.test(before))) return undefined;
			let end = local;
			while (end < part.length && char.test(part[end])) end++;
			return { query: part.slice(from, local), start: offset + at, end: offset + end };
		}
		offset += length;
	}
	return undefined;
}

/** Replaces the draft text from `start` to `end` with a chip for `id` (a room's with `room`) and a space; the caret goes after the space. */
export function insertMention(parts: DraftPart[], start: number, end: number, id: string, room = false): { parts: DraftPart[]; caret: number } {
	const chip: DraftChip = room ? { id, room: true } : { id };
	const out: DraftPart[] = [];
	let offset = 0;
	let placed = false;
	for (const part of parts) {
		const length = typeof part === 'string' ? part.length : part.id.length + 1;
		if (typeof part === 'string' && !placed && start >= offset && end <= offset + length) {
			const after = part.slice(end - offset);
			out.push(part.slice(0, start - offset), chip, after.startsWith(' ') ? after : ` ${after}`);
			placed = true;
		} else {
			out.push(part);
		}
		offset += length;
	}
	if (!placed) out.push(chip, ' ');
	return { parts: normalizeDraft(out), caret: (placed ? start : offset) + id.length + 2 };
}

/**
 * Replaces the draft text from `start` to `end` (a selection, either way
 * round) with `text`, as typing it would, and puts the caret after it. A
 * chip the selection cuts into goes whole; a bare caret inside a chip lands
 * after it. Positions are clamped to the draft.
 */
export function insertText(parts: DraftPart[], start: number, end: number, text: string): { parts: DraftPart[]; caret: number } {
	const length = (part: DraftPart) => (typeof part === 'string' ? part.length : part.id.length + 1);
	const total = parts.reduce((sum, part) => sum + length(part), 0);
	let from = Math.max(0, Math.min(start, end, total));
	let to = Math.max(0, Math.min(Math.max(start, end), total));
	let offset = 0;
	for (const part of parts) {
		const partEnd = offset + length(part);
		if (typeof part !== 'string') {
			if (from === to && from > offset && from < partEnd) from = to = partEnd;
			else {
				if (from > offset && from < partEnd) from = offset;
				if (to > offset && to < partEnd) to = partEnd;
			}
		}
		offset = partEnd;
	}
	const out: DraftPart[] = [];
	let placed = false;
	offset = 0;
	for (const part of parts) {
		const partStart = offset;
		const partEnd = offset + length(part);
		offset = partEnd;
		if (!placed && from <= partStart) {
			out.push(text);
			placed = true;
		}
		if (typeof part !== 'string') {
			// Chips outside the selection stay.
			if (partEnd <= from || partStart >= to) out.push(part);
			continue;
		}
		const before = part.slice(0, Math.max(0, Math.min(from - partStart, part.length)));
		const after = part.slice(Math.max(0, Math.min(to - partStart, part.length)));
		if (!placed && from < partEnd) {
			out.push(before, text, after);
			placed = true;
		} else {
			out.push(before + after);
		}
	}
	if (!placed) out.push(text);
	return { parts: normalizeDraft(out), caret: from + text.length };
}

/**
 * Backspace right after a chip: the chip turns back into editable text, its
 * `label` (what it showed, as `@Ada Lovelace` or `#Deploy checklist`), with
 * the caret after it. Undefined when no chip ends at the caret.
 */
export function unchip(parts: DraftPart[], caret: number, label: (chip: DraftChip) => string): { parts: DraftPart[]; caret: number } | undefined {
	let offset = 0;
	for (const [index, part] of parts.entries()) {
		const length = typeof part === 'string' ? part.length : part.id.length + 1;
		offset += length;
		if (offset < caret) continue;
		if (offset > caret || typeof part === 'string') return undefined;
		const text = label(part);
		return { parts: normalizeDraft([...parts.slice(0, index), text, ...parts.slice(index + 1)]), caret: offset - length + text.length };
	}
	return undefined;
}
