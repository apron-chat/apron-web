/**
 * Markdown formatting for the full-panel composer's toolbar. Each is a pure change to the draft's text and selection
 * (`TextEdit`), which `DraftField.apply` makes in the field; each turns its format off again when pressed a second
 * time, which stands in for Undo. Loaded on demand, with the toolbar (`on-demand.ts`).
 */
import type { TextEdit } from './text-edit';

export type { TextEdit } from './text-edit';

const lineStart = (text: string, at: number): number => text.lastIndexOf('\n', at - 1) + 1;
const lineEnd = (text: string, at: number): number => {
	const end = text.indexOf('\n', at);
	return end < 0 ? text.length : end;
};

/** The whole lines a selection touches. A selection ending right after a line break leaves the next line alone. */
function touchedLines(edit: TextEdit): { from: number; to: number } {
	const last = edit.end > edit.start && edit.text[edit.end - 1] === '\n' ? edit.end - 1 : edit.end;
	return { from: lineStart(edit.text, edit.start), to: lineEnd(edit.text, Math.max(edit.start, last)) };
}

/**
 * Bold (`**`), italic (`_`), strikethrough (`~~`) or inline code (`` ` ``) around the selection, leaving out the spaces
 * at its ends; off again when the selection already has it, inside or just outside. A bare caret gets the pair with the
 * caret between them, to type into.
 */
export function wrap(edit: TextEdit, marker: string): TextEdit {
	const { text } = edit;
	let { start, end } = edit;
	while (start < end && /\s/.test(text[start])) start++;
	while (end > start && /\s/.test(text[end - 1])) end--;
	const size = marker.length;
	if (text.slice(start - size, start) === marker && text.slice(end, end + size) === marker) {
		return { text: text.slice(0, start - size) + text.slice(start, end) + text.slice(end + size), start: start - size, end: end - size };
	}
	const inner = text.slice(start, end);
	if (inner.length >= 2 * size && inner.startsWith(marker) && inner.endsWith(marker)) {
		return { text: text.slice(0, start) + inner.slice(size, -size) + text.slice(end), start, end: end - 2 * size };
	}
	return { text: text.slice(0, start) + marker + inner + marker + text.slice(end), start: start + size, end: end + size };
}

/** A link: `[selection](url)`, with `url` selected to type over. With nothing selected, the label is `link`. */
export function link(edit: TextEdit): TextEdit {
	const label = edit.text.slice(edit.start, edit.end) || 'link';
	const head = `${edit.text.slice(0, edit.start)}[${label}](`;
	return { text: `${head}url)${edit.text.slice(edit.end)}`, start: head.length, end: head.length + 3 };
}

export type LinePrefix = 'quote' | 'bullet' | 'number';

/** Each prefix as written at a line's start. */
const PREFIXES: Record<LinePrefix, RegExp> = {
	quote: /^> ?/,
	bullet: /^[-*+] /,
	number: /^\d+[.)] /
};
/** A list item's prefix, which the other kind of list replaces. */
const LIST = /^(?:[-*+] |\d+[.)] )/;

/**
 * A quote or list for every line the selection touches; off again when every one of them has it already. A quote takes
 * in the blank lines between, as `>`, so it stays one quote, and quotes inside it nest; a list leaves them out. The
 * other kind of list gives way to the new one, and numbers count from 1. The lines stay selected, so a second press
 * undoes the first; a bare caret keeps its place in the text.
 */
export function prefixLines(edit: TextEdit, kind: LinePrefix): TextEdit {
	const { from, to } = touchedLines(edit);
	const lines = edit.text.slice(from, to).split('\n');
	const prefix = PREFIXES[kind];
	const off = lines.every((line) => prefix.test(line) || (kind === 'quote' && line === ''));
	let count = 0;
	const out = lines.map((line) => {
		if (off) return line.replace(prefix, '');
		if (kind === 'quote') return line ? `> ${line}` : '>';
		if (!line.trim()) return line;
		return (kind === 'bullet' ? '- ' : `${++count}. `) + line.replace(LIST, '');
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

/** A fenced code block around the lines the selection touches, them selected inside it; an empty one at a bare caret's line. */
export function codeBlock(edit: TextEdit): TextEdit {
	const { from, to } = touchedLines(edit);
	const body = edit.text.slice(from, to);
	const open = '```\n';
	const text = `${edit.text.slice(0, from)}${open}${body}\n\`\`\`${edit.text.slice(to)}`;
	return { text, start: from + open.length, end: from + open.length + body.length };
}
