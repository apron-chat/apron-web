/**
 * Markdown formatting for the full-panel composer's toolbar. Each is a pure change to the draft's text and selection
 * (`TextEdit`), which `DraftField.apply` makes in the field; each turns its format off again when pressed a second
 * time, which stands in for Undo. Loaded on demand, with the toolbar (`on-demand.ts`).
 */
import type { TextEdit } from './text-edit';

export type { TextEdit } from './text-edit';

// At 0, `lastIndexOf` with -1 would still look at index 0, a line break there being the next line's.
const lineStart = (text: string, at: number): number => (at <= 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1);
const lineEnd = (text: string, at: number): number => {
	const end = text.indexOf('\n', at);
	return end < 0 ? text.length : end;
};

/** The whole lines a selection touches. A selection ending right after a line break leaves the next line alone. */
function touchedLines(edit: TextEdit): { from: number; to: number } {
	const last = edit.end > edit.start && edit.text[edit.end - 1] === '\n' ? edit.end - 1 : edit.end;
	return { from: lineStart(edit.text, edit.start), to: lineEnd(edit.text, Math.max(edit.start, last)) };
}

/** How many of `char` run back from `at` (`back`) or on from it. */
function run(text: string, at: number, char: string, back: boolean): number {
	let count = 0;
	if (back) while (at - count > 0 && text[at - count - 1] === char) count++;
	else while (at + count < text.length && text[at + count] === char) count++;
	return count;
}

/**
 * Bold (`**`), italic (`*`), strikethrough (`~~`) or inline code (`` ` ``) around the selection, leaving out the spaces
 * at its ends; off again when the selection already has it, inside or just outside. A marker is there when the run of
 * its character holds it, so italic and bold each come off `***both***` alone, and italic doesn't take one star off
 * bold. A bare caret gets the pair with the caret between them, to type into.
 */
export function wrap(edit: TextEdit, marker: string): TextEdit {
	const { text } = edit;
	let { start, end } = edit;
	while (start < end && /\s/.test(text[start])) start++;
	while (end > start && /\s/.test(text[end - 1])) end--;
	const size = marker.length;
	const char = marker[0];
	// A run of 1 holds `*`, of 2 `**`, of 3 both: the run's length has the marker's length as one of its bits.
	const holds = (count: number) => (count & size) !== 0;
	if (holds(run(text, start, char, true)) && holds(run(text, end, char, false))) {
		return { text: text.slice(0, start - size) + text.slice(start, end) + text.slice(end + size), start: start - size, end: end - size };
	}
	const inner = text.slice(start, end);
	if (inner.length >= 2 * size && holds(run(inner, 0, char, false)) && holds(run(inner, inner.length, char, true))) {
		return { text: text.slice(0, start) + inner.slice(size, -size) + text.slice(end), start, end: end - 2 * size };
	}
	return { text: text.slice(0, start) + marker + inner + marker + text.slice(end), start: start + size, end: end + size };
}

/**
 * A link: `[selection](url)`, with `url` selected to type over; with nothing selected, the label is `link`. Off again
 * with its label or its URL selected (as a new link leaves it): the link gives way to its label.
 */
export function link(edit: TextEdit): TextEdit {
	const { text, start, end } = edit;
	const tail = /^\]\([^)\s]*\)/.exec(text.slice(end));
	if (text[start - 1] === '[' && tail) {
		return { text: text.slice(0, start - 1) + text.slice(start, end) + text.slice(end + tail[0].length), start: start - 1, end: end - 1 };
	}
	const head = /\[([^\]\n]*)\]\($/.exec(text.slice(0, start));
	if (head && text[end] === ')' && !/[)\s]/.test(text.slice(start, end))) {
		const from = start - head[0].length;
		return { text: text.slice(0, from) + head[1] + text.slice(end + 1), start: from, end: from + head[1].length };
	}
	const label = text.slice(start, end) || 'link';
	const before = `${text.slice(0, start)}[${label}](`;
	return { text: `${before}url)${text.slice(end)}`, start: before.length, end: before.length + 3 };
}

export type LinePrefix = 'quote' | 'bullet' | 'number' | 'task';

/** Each prefix as written at a line's start. A bullet isn't a task's, which has its own. */
const PREFIXES: Record<LinePrefix, RegExp> = {
	quote: /^> ?/,
	bullet: /^[-*+] (?!\[[ xX]\] )/,
	number: /^\d+[.)] /,
	task: /^[-*+] \[[ xX]\] /
};
/** A list item's prefix, a task's with its box, which the other kind of list replaces. */
const LIST = /^(?:[-*+] (?:\[[ xX]\] )?|\d+[.)] )/;

/**
 * A quote or list for every line the selection touches; off again when every one of them but blank lines has it. A quote takes
 * in the blank lines between, as `>`, so it stays one quote, and quotes inside it nest; a list leaves them out. The
 * other kind of list gives way to the new one, and numbers count from 1. The lines stay selected, so a second press
 * undoes the first; a bare caret keeps its place in the text, and on an empty line starts the list there.
 */
export function prefixLines(edit: TextEdit, kind: LinePrefix): TextEdit {
	const { from, to } = touchedLines(edit);
	const lines = edit.text.slice(from, to).split('\n');
	const prefix = PREFIXES[kind];
	// Off when it is there already, blank lines between aside.
	const off = lines.some((line) => prefix.test(line)) && lines.every((line) => prefix.test(line) || !line.trim());
	let count = 0;
	// A bare caret on an empty line starts the list there, to type its first item.
	const starting = edit.start === edit.end && lines.length === 1;
	const out = lines.map((line) => {
		if (off) return line.replace(prefix, '');
		if (kind === 'quote') return line ? `> ${line}` : '>';
		if (!line.trim() && !starting) return line;
		return (kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${++count}. `) + line.replace(LIST, '');
	});
	const joined = out.join('\n');
	const text = edit.text.slice(0, from) + joined + edit.text.slice(to);
	if (edit.start !== edit.end) return { text, start: from, end: from + joined.length };
	// A bare caret is on one line: it keeps its place in that line's text, after the prefix, which changed in front of it.
	const [before, after] = [lines[0], out[0]];
	let body = 0;
	while (body < before.length && body < after.length && before[before.length - 1 - body] === after[after.length - 1 - body]) body++;
	const [oldPrefix, newPrefix] = [before.length - body, after.length - body];
	const caret = from + Math.max(newPrefix, edit.start - from - oldPrefix + newPrefix);
	return { text, start: caret, end: caret };
}

/**
 * A fenced code block around the lines the selection touches, them selected inside it; an empty one at a bare caret's
 * line. Off again with the lines inside a block selected (as a new block leaves them), or the block with its fences.
 */
export function codeBlock(edit: TextEdit): TextEdit {
	const { text } = edit;
	const { from, to } = touchedLines(edit);
	const lines = text.slice(from, to).split('\n');
	if (lines.length >= 2 && lines[0].startsWith('```') && lines[lines.length - 1] === '```') {
		const body = lines.slice(1, -1).join('\n');
		return { text: text.slice(0, from) + body + text.slice(to), start: from, end: from + body.length };
	}
	if (from > 0 && text[to] === '\n') {
		const opens = lineStart(text, from - 1);
		const closes = lineEnd(text, to + 1);
		if (text.slice(opens, from - 1).startsWith('```') && text.slice(to + 1, closes) === '```') {
			const body = text.slice(from, to);
			return { text: text.slice(0, opens) + body + text.slice(closes), start: opens, end: opens + body.length };
		}
	}
	const body = text.slice(from, to);
	const open = '```\n';
	return { text: `${text.slice(0, from)}${open}${body}\n\`\`\`${text.slice(to)}`, start: from + open.length, end: from + open.length + body.length };
}
