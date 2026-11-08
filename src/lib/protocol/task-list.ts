/**
 * A task list item's marker on a source line, after whatever opens its blocks (`>`, list markers, indentation):
 * the `[ ]` or `[x]` a paragraph in a list item starts with.
 */
/** What `withoutBidiOverrides` drops before rendering. */
const BIDI_OVERRIDE = /[\u202A-\u202E]/;

const TASK_LINE = /^((?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*)\[([ xX])\]/;

/**
 * Markdown with the task on `line` (a checkbox's `data-task-line`) checked or not, or undefined when that line
 * holds no task marker, or it is already as asked. Only that marker changes; the rest stays as written.
 */
export function toggleTask(source: string, line: number, checked: boolean): string | undefined {
	// Lines as Markdown counts them (any of `\r\n`, `\r`, `\n` ends one), each kept with its own ending.
	const parts = source.split(/(\r\n|\r|\n)/);
	const text = parts[line * 2];
	if (text === undefined) return undefined;
	// The line as it rendered: without bidi embeddings and overrides (`withoutBidiOverrides`), each character's
	// place in the line as written kept, so only the one between the brackets changes.
	const kept: number[] = [];
	let shown = '';
	for (let at = 0; at < text.length; at += 1) {
		if (BIDI_OVERRIDE.test(text[at])) continue;
		kept.push(at);
		shown += text[at];
	}
	const marker = TASK_LINE.exec(shown);
	if (!marker || (marker[2] !== ' ') === checked) return undefined;
	const at = kept[marker[1].length + 1];
	parts[line * 2] = `${text.slice(0, at)}${checked ? 'x' : ' '}${text.slice(at + 1)}`;
	return parts.join('');
}
