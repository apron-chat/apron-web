import { describe, expect, it } from 'vitest';
import { codeBlock, continueBlock, indent, inList, link, markdownKey, prefixLines, wrap, type TextEdit } from './markdown-format';

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

	it('tells a checklist from a bulleted list', () => {
		const whole = (text: string): TextEdit => ({ text, start: 0, end: text.length });
		expect(prefixLines(whole('- [ ] a'), 'bullet').text).toBe('- a');
		expect(prefixLines(whole('- a'), 'task').text).toBe('- [ ] a');
		expect(prefixLines(whole('- [x] a'), 'task').text).toBe('a');
	});

	it('keeps a bare caret’s place in its line', () => {
		expect(marked(prefixLines(draft('one\ntw|o'), 'heading'))).toBe('one\n### tw|o');
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

describe('continueBlock', () => {
	it('carries a list on, counting up and unticking boxes', () => {
		expect(marked(continueBlock(draft('- a|')))).toBe('- a\n- |');
		expect(marked(continueBlock(draft('  9. a|')))).toBe('  9. a\n  10. |');
		expect(marked(continueBlock(draft('- [x] done|')))).toBe('- [x] done\n- [ ] |');
		expect(marked(continueBlock(draft('> said|')))).toBe('> said\n> |');
	});

	it('ends the list on an empty item', () => {
		expect(marked(continueBlock(draft('- a\n- |')))).toBe('- a\n|');
		expect(marked(continueBlock(draft('> a\n> |')))).toBe('> a\n|');
	});

	it('breaks splitting an item in two', () => {
		expect(marked(continueBlock(draft('- ab|cd')))).toBe('- ab\n- |cd');
	});

	it('leaves Enter alone outside a list, before an item’s text, and over a selection', () => {
		expect(continueBlock(draft('plain|'))).toBeUndefined();
		expect(continueBlock(draft('-| a'))).toBeUndefined();
		expect(continueBlock(draft('- [a]'))).toBeUndefined();
	});
});

describe('indent', () => {
	it('indents and outdents the lines, the selection moving with its text', () => {
		expect(marked(indent(draft('- a\n- [b\n- c]')))).toBe('- a\n  - [b\n  - c]');
		expect(marked(indent(draft('  - [b\n- c]'), true))).toBe('- [b\n- c]');
	});

	it('tells a list from other lines', () => {
		expect(inList(draft('- a\n1. [b'))).toBe(true);
		expect(inList(draft('- [a\nb]'))).toBe(false);
	});
});

describe('markdownKey', () => {
	function press(init: KeyboardEventInit, start: TextEdit): { taken: boolean; result?: TextEdit } {
		let result: TextEdit | undefined;
		const event = { key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init } as KeyboardEvent;
		const taken = markdownKey(event, (change) => {
			result = change(start);
			return result !== undefined;
		});
		return { taken, result };
	}

	it('makes bold and italic with Ctrl or ⌘', () => {
		expect(marked(press({ key: 'b', ctrlKey: true }, draft('[x]')).result)).toBe('**[x]**');
		expect(marked(press({ key: 'i', metaKey: true }, draft('[x]')).result)).toBe('_[x]_');
	});

	it('carries a list on with Enter, but leaves Shift+Enter and Ctrl+Enter to the field', () => {
		expect(press({ key: 'Enter' }, draft('- a|')).taken).toBe(true);
		expect(press({ key: 'Enter', shiftKey: true }, draft('- a|')).taken).toBe(false);
		expect(press({ key: 'Enter', ctrlKey: true }, draft('- a|')).taken).toBe(false);
		expect(press({ key: 'Enter' }, draft('plain|')).taken).toBe(false);
	});

	it('takes Tab only in a list, so it moves focus elsewhere', () => {
		expect(press({ key: 'Tab' }, draft('- a|')).taken).toBe(true);
		expect(press({ key: 'Tab' }, draft('plain|')).taken).toBe(false);
	});
});
