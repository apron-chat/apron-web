import { describe, expect, it } from 'vitest';
import { codeBlock, link, prefixLines, wrap, type TextEdit } from './markdown-format';

/** A draft with its selection marked: `[` and `]` around it, or `|` for a bare caret. */
function draft(marked: string): TextEdit {
	const caret = marked.indexOf('|');
	if (caret >= 0) return { text: marked.replace('|', ''), start: caret, end: caret };
	const start = marked.indexOf('[');
	const end = marked.indexOf(']') - 1;
	return { text: marked.replace('[', '').replace(']', ''), start, end };
}

/** The same marking for a result, to compare as one string. */
function marked(edit: TextEdit | undefined): string | undefined {
	if (!edit) return undefined;
	const { text, start, end } = edit;
	if (start === end) return `${text.slice(0, start)}|${text.slice(start)}`;
	return `${text.slice(0, start)}[${text.slice(start, end)}]${text.slice(end)}`;
}

describe('wrap', () => {
	it('wraps the selection, and the selection stays on the text', () => {
		expect(marked(wrap(draft('a [bold] word'), '**'))).toBe('a **[bold]** word');
	});

	it('leaves the spaces at the selection’s ends outside', () => {
		expect(marked(wrap(draft('a[ bold ]word'), '**'))).toBe('a **[bold]** word');
	});

	it('unwraps a selection that has it just outside, or inside', () => {
		expect(marked(wrap(draft('a **[bold]** word'), '**'))).toBe('a [bold] word');
		expect(marked(wrap(draft('a [**bold**] word'), '**'))).toBe('a [bold] word');
	});

	it('puts the caret between the pair at a bare caret', () => {
		expect(marked(wrap(draft('say |'), '`'))).toBe('say `|`');
	});
});

describe('link', () => {
	it('makes the selection a link’s label and selects the URL to type over', () => {
		const text = 'see the docs here';
		const result = link({ text, start: 4, end: 12 });
		expect(result.text).toBe('see [the docs](url) here');
		expect(result.text.slice(result.start, result.end)).toBe('url');
	});

	it('labels a link at a bare caret “link”', () => {
		const result = link(draft('see |'));
		expect(result.text).toBe('see [link](url)');
		expect(result.text.slice(result.start, result.end)).toBe('url');
	});
});

describe('prefixLines', () => {
	it('quotes every line the selection touches, blank lines too, and keeps them selected', () => {
		expect(marked(prefixLines(draft('intro\nfi[rst\n\nlas]t\nafter'), 'quote'))).toBe('intro\n[> first\n>\n> last]\nafter');
	});

	it('unquotes when every line is quoted already, so a second press undoes the first', () => {
		const once = prefixLines(draft('[one\n\ntwo]'), 'quote');
		expect(marked(once)).toBe('[> one\n>\n> two]');
		expect(marked(prefixLines(once, 'quote'))).toBe('[one\n\ntwo]');
	});

	it('nests a quote inside one when only some lines are quoted', () => {
		expect(marked(prefixLines(draft('[> said\nreply]'), 'quote'))).toBe('[> > said\n> reply]');
	});

	it('leaves the line after a selection that ends at its start alone', () => {
		expect(marked(prefixLines(draft('[one\n]two'), 'quote'))).toBe('[> one]\ntwo');
	});

	it('numbers from 1, skipping blank lines, and replaces another list’s markers', () => {
		expect(marked(prefixLines(draft('[- a\n\n- b\nc]'), 'number'))).toBe('[1. a\n\n2. b\n3. c]');
	});

	it('keeps a bare caret’s place in its line', () => {
		expect(marked(prefixLines(draft('one\ntw|o'), 'number'))).toBe('one\n1. tw|o');
		expect(marked(prefixLines(draft('> tw|o'), 'quote'))).toBe('tw|o');
		expect(marked(prefixLines(draft('|two'), 'bullet'))).toBe('- |two');
	});
});

describe('codeBlock', () => {
	it('fences the selected lines and keeps them selected', () => {
		expect(marked(codeBlock(draft('run:\n[npm test\nnpm run check]\ndone')))).toBe('run:\n```\n[npm test\nnpm run check]\n```\ndone');
	});

	it('opens an empty block at a bare caret on an empty line', () => {
		expect(marked(codeBlock(draft('run:\n|')))).toBe('run:\n```\n|\n```');
	});
});
