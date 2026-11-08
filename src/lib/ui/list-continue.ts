import type { TextEdit } from './text-edit';

/**
 * A list item's start on a line: what opens its blocks (indentation, `>`), its marker (`-`, `*`, `+`, or a number and
 * `.` or `)`), the space after, and a task's `[ ]` or `[x]`.
 */
const ITEM = /^([ \t]*(?:>[ \t]?)*[ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;

/**
 * A new line typed at the end of a list item carries the list on: the same marker after the same indentation and
 * quotes, a number one up, and a task unticked (`- [ ] `), ready to type. On an item with nothing in it yet the list
 * ends instead: its marker goes, and a blank line follows, for plain text after the list. Undefined, for a plain line break, anywhere else:
 * a selection, a line that isn't a list item, or a caret inside the marker.
 */
export function continueList(edit: TextEdit): TextEdit | undefined {
	const { text, start, end } = edit;
	if (start !== end) return undefined;
	const from = text.lastIndexOf('\n', start - 1) + 1;
	const lineEnd = text.indexOf('\n', start);
	const line = text.slice(from, lineEnd < 0 ? text.length : lineEnd);
	const item = ITEM.exec(line);
	if (!item || start - from < item[0].length) return undefined;
	const [marker, opens, bullet, number, close, space, task] = item;
	if (!line.slice(marker.length).trim()) {
		// Nothing in it: the list ends here. A blank line (in its quote, if it was in one) sets it apart from what comes
		// next, which would otherwise read as more of the last item.
		const quote = opens.replace(/[ \t]+/g, '');
		const ended = `${quote}\n${quote ? `${quote} ` : ''}`;
		const after = from + ended.length;
		return { text: text.slice(0, from) + ended + text.slice(from + line.length), start: after, end: after };
	}
	const next = `${opens}${bullet ?? `${Number(number) + 1}${close}`}${space}${task ? '[ ] ' : ''}`;
	const caret = start + 1 + next.length;
	return { text: `${text.slice(0, start)}\n${next}${text.slice(start)}`, start: caret, end: caret };
}
