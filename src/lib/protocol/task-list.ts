/**
 * A task list item's marker on a source line, after whatever opens its blocks (`>`, list markers, indentation):
 * the `[ ]` or `[x]` a paragraph in a list item starts with.
 */
const TASK_LINE = /^((?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*)\[([ xX])\]/;

/**
 * Markdown with the task on `line` (a checkbox's `data-task-line`) checked or not, or undefined when that line
 * holds no task marker, or it is already as asked. Only that marker changes; the rest stays as written.
 */
export function toggleTask(source: string, line: number, checked: boolean): string | undefined {
	// Lines as Markdown counts them (any of `\r\n`, `\r`, `\n` ends one), each kept with its own ending.
	const parts = source.split(/(\r\n|\r|\n)/);
	const text = parts[line * 2];
	const marker = text === undefined ? null : TASK_LINE.exec(text);
	if (!marker || (marker[2] !== ' ') === checked) return undefined;
	parts[line * 2] = `${marker[1]}[${checked ? 'x' : ' '}]${text.slice(marker[0].length)}`;
	return parts.join('');
}
