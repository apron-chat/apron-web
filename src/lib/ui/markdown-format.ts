/**
 * Markdown formatting for the full-panel composer: its toolbar's buttons and keys. Each is a pure change to the draft's
 * text and selection (`TextEdit`), which `DraftField.apply` makes in the field. Loaded on demand, with the toolbar
 * (`on-demand.ts`): the compact composer doesn't need it.
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

export type LinePrefix = 'quote' | 'bullet' | 'number' | 'task' | 'heading';

/** Each prefix as written at a line's start; a bullet isn't a task's `- [ ]`. */
const PREFIXES: Record<LinePrefix, RegExp> = {
	quote: /^> ?/,
	bullet: /^[-*+] (?!\[[ xX]\] )/,
	number: /^\d+[.)] /,
	task: /^[-*+] \[[ xX]\] /,
	heading: /^#{1,6} /
};
/** A list item's or heading's prefix, which another of them replaces. */
const BLOCK = /^(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |#{1,6} )/;

/**
 * A quote, list, checklist or heading for every line the selection touches; off again when every one of them has it
 * already. A quote takes in the blank lines between, as `>`, so it stays one quote, and quotes inside it nest; a list
 * leaves them out. Another list's or a heading's prefix gives way to the new one, and numbers count from 1. The lines
 * stay selected, so a second press undoes the first; a bare caret keeps its place in the text.
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
		const bare = line.replace(BLOCK, '');
		return (kind === 'bullet' ? '- ' : kind === 'number' ? `${++count}. ` : kind === 'task' ? '- [ ] ' : '### ') + bare;
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

/** A list item or quote line's start: its indent, then its marker, and a list's number to count on from. */
const CONTINUED = /^(\s*)(>\s?|[-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) )/;

/**
 * Enter at a bare caret in a list item or a quote: the next line carries it on (the next number, an unticked box).
 * In an item with nothing written, Enter ends the list or quote instead, as in most editors. Undefined anywhere else,
 * where Enter is a plain line break.
 */
export function continueBlock(edit: TextEdit): TextEdit | undefined {
	if (edit.start !== edit.end) return undefined;
	const from = lineStart(edit.text, edit.start);
	const match = CONTINUED.exec(edit.text.slice(from, lineEnd(edit.text, edit.start)));
	if (!match || edit.start < from + match[0].length) return undefined;
	if (edit.text.slice(from, lineEnd(edit.text, edit.start)).trim() === match[0].trim()) {
		const text = edit.text.slice(0, from) + edit.text.slice(lineEnd(edit.text, edit.start));
		return { text, start: from, end: from };
	}
	const marker = match[3] ? `${Number(match[3]) + 1}${match[4]} ` : match[2].replace(/\[[xX]\]/, '[ ]');
	const insert = `\n${match[1]}${marker}`;
	const text = edit.text.slice(0, edit.start) + insert + edit.text.slice(edit.end);
	return { text, start: edit.start + insert.length, end: edit.start + insert.length };
}

/** Whether every line the selection touches is a list item: where Tab indents rather than moving on. */
export function inList(edit: TextEdit): boolean {
	const { from, to } = touchedLines(edit);
	return edit.text.slice(from, to).split('\n').every((line) => /^\s*(?:[-*+] |\d+[.)] )/.test(line));
}

/** Tab and Shift+Tab: the lines the selection touches in or out by two spaces, the selection moving with its text. */
export function indent(edit: TextEdit, out = false): TextEdit {
	const { from, to } = touchedLines(edit);
	const lines = edit.text.slice(from, to).split('\n');
	const shifts = lines.map((line) => (out ? -(/^ {1,2}/.exec(line)?.[0].length ?? 0) : 2));
	const joined = lines.map((line, index) => (shifts[index] < 0 ? line.slice(-shifts[index]) : out ? line : `  ${line}`)).join('\n');
	const text = edit.text.slice(0, from) + joined + edit.text.slice(to);
	const total = shifts.reduce((sum, shift) => sum + shift, 0);
	const start = Math.max(from, edit.start + shifts[0]);
	return { text, start, end: Math.max(start, edit.end + total) };
}

/**
 * The full panel's keys, for the field's key handler: Enter carries a list or quote on, Tab and Shift+Tab indent list
 * items, and Ctrl+B / Ctrl+I (⌘ on a Mac) make bold and italic. `apply` makes a change in the field (`DraftField.apply`);
 * true when the key was taken. Anything else is left to the field: Shift+Enter is always a plain line break.
 */
export function markdownKey(event: KeyboardEvent, apply: (change: (edit: TextEdit) => TextEdit | undefined) => boolean): boolean {
	const mod = event.ctrlKey || event.metaKey;
	if (event.altKey) return false;
	if (mod && !event.shiftKey) {
		const key = event.key.toLowerCase();
		if (key === 'b') return apply((edit) => wrap(edit, '**'));
		if (key === 'i') return apply((edit) => wrap(edit, '_'));
		return false;
	}
	if (mod) return false;
	if (event.key === 'Enter' && !event.shiftKey) return apply(continueBlock);
	if (event.key === 'Tab') return apply((edit) => (inList(edit) ? indent(edit, event.shiftKey) : undefined));
	return false;
}
