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

	it('tells italic from bold by the run of stars, so each comes off bold italic alone', () => {
		expect(marked(wrap(draft('a [word] b'), '*'))).toBe('a *[word]* b');
		expect(marked(wrap(draft('a *[word]* b'), '*'))).toBe('a [word] b');
		// Italic on bold adds to it, rather than taking a star off.
		expect(marked(wrap(draft('a **[word]** b'), '*'))).toBe('a ***[word]*** b');
		expect(marked(wrap(draft('a ***[word]*** b'), '*'))).toBe('a **[word]** b');
		expect(marked(wrap(draft('a ***[word]*** b'), '**'))).toBe('a *[word]* b');
		expect(marked(wrap(draft('a [*word*] b'), '*'))).toBe('a [word] b');
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

	it('takes a link off with its URL selected, as a new link leaves it, or its label', () => {
		const made = link({ text: 'see the docs here', start: 4, end: 12 });
		expect(link(made)).toEqual({ text: 'see the docs here', start: 4, end: 12 });
		const label = 'see [the docs](https://x.test) here';
		expect(link({ text: label, start: 5, end: 13 })).toEqual({ text: 'see the docs here', start: 4, end: 12 });
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

	it('starts a list on the empty line a bare caret is on, the caret after its marker', () => {
		const caret = (text: string, at: number): TextEdit => ({ text, start: at, end: at });
		expect(prefixLines(caret('Plan:\n\n', 7), 'task')).toEqual({ text: 'Plan:\n\n- [ ] ', start: 13, end: 13 });
		expect(prefixLines(caret('', 0), 'bullet')).toEqual({ text: '- ', start: 2, end: 2 });
		expect(prefixLines(caret('', 0), 'number')).toEqual({ text: '1. ', start: 3, end: 3 });
	});

	it('makes a checklist, replacing another list’s markers, and takes it off again', () => {
		expect(marked(prefixLines(draft('[- a\n1. b\nc]'), 'task'))).toBe('[- [ ] a\n- [ ] b\n- [ ] c]');
		const whole = (text: string): TextEdit => ({ text, start: 0, end: text.length });
		expect(prefixLines(whole('- [ ] a\n- [x] b'), 'task').text).toBe('a\nb');
		// A bulleted list over a checklist swaps the boxes for bullets, rather than taking the `- ` off.
		expect(prefixLines(whole('- [ ] a\n- [x] b'), 'bullet').text).toBe('- a\n- b');
	});

	it('takes a list off with blank lines between its items', () => {
		const whole = (text: string): TextEdit => ({ text, start: 0, end: text.length });
		expect(prefixLines(whole('- a\n\n- b'), 'bullet').text).toBe('a\n\nb');
		expect(prefixLines(whole('1. a\n\n2. b'), 'number').text).toBe('a\n\nb');
		// Only blank lines: nothing to take off, so it is put on (none of them takes it).
		expect(prefixLines(whole('\n'), 'bullet').text).toBe('\n');
		// A draft starting with a blank line, the caret at its very start.
		expect(marked(prefixLines(draft('|\nnext'), 'quote'))).toBe('>|\nnext');
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

	it('takes a block off again, with its lines selected inside it or with its fences', () => {
		const made = codeBlock(draft('run:\n[npm test]\ndone'));
		expect(marked(codeBlock(made))).toBe('run:\n[npm test]\ndone');
		expect(marked(codeBlock(draft('run:\n[```\nnpm test\n```]\ndone')))).toBe('run:\n[npm test]\ndone');
		expect(marked(codeBlock(codeBlock(draft('run:\n|'))))).toBe('run:\n|');
	});

	it('opens an empty block at a bare caret on an empty line', () => {
		expect(marked(codeBlock(draft('run:\n|')))).toBe('run:\n```\n|\n```');
	});
});
