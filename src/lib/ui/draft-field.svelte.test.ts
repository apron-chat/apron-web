// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DraftField } from './draft-field.svelte';

/** A field for `@` mentions of Alan, whose picker shows only while `shown` says so (its code loads on demand). */
function field(shown: { value: boolean }) {
	let value = $state('');
	let mentions = $state<string[]>([]);
	const submit = vi.fn();
	let draft!: DraftField;
	const stop = $effect.root(() => {
		draft = new DraftField({
			get value() { return value; },
			set value(text) { value = text; },
			get mentions() { return mentions; },
			set mentions(ids) { mentions = ids; },
			people: [{ id: 'alan', name: 'Alan Turing' }],
			rooms: [],
			disabled: false,
			submit,
			get pickerShown() { return shown.value; }
		}, 'test-suggestions');
	});
	const element = document.createElement('div');
	element.contentEditable = 'true';
	element.tabIndex = 0;
	document.body.append(element);
	draft.element = element;
	flushSync();
	// It reads a query only while it has the keyboard.
	element.focus();
	/** Types `text` at the end, the caret after it. */
	const type = (text: string) => {
		element.append(text);
		const range = document.createRange();
		range.setStart(element, element.childNodes.length);
		document.getSelection()!.removeAllRanges();
		document.getSelection()!.addRange(range);
		draft.input(new InputEvent('input', { bubbles: true }));
		flushSync();
	};
	const enter = () => {
		draft.keydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
		flushSync();
	};
	/** The browser's own lines, as Chrome writes them into a `contenteditable` (one `<div>` per line after the first), read in. */
	const lines = (html: string) => {
		element.innerHTML = html;
		draft.input(new InputEvent('input', { bubbles: true }));
		flushSync();
	};
	return { draft, submit, type, enter, lines, value: () => value, mentions: () => mentions, done: () => { stop(); element.remove(); } };
}

describe('DraftField', () => {
	it('takes no keys for a picker that isn’t drawn yet: Enter sends, and the field names no picker', () => {
		const shown = $state({ value: false });
		const f = field(shown);
		f.type('hi @al');
		expect(f.draft.pickerOpen).toBe(true);
		expect(f.draft.aria['aria-controls']).toBeUndefined();
		f.enter();
		expect(f.submit).toHaveBeenCalledOnce();
		expect(f.mentions()).toEqual([]);
		f.done();
	});

	it('keeps a blank line typed between lines, as Chrome draws it (`<div><br></div>`)', () => {
		const f = field({ value: false });
		f.lines('one<div>two</div><div><br></div><div>three</div>');
		expect(f.value()).toBe('one\ntwo\n\nthree');
		f.lines('one<div><br></div><div><br></div><div>two</div>');
		expect(f.value()).toBe('one\n\n\ntwo');
		f.lines('<div><br></div><div>one</div>');
		expect(f.value()).toBe('\none');
		// Ending the field, an empty line is where the caret sits: the line break before it, kept once.
		f.lines('one<div><br></div>');
		expect(f.value()).toBe('one\n');
		f.lines('one<div>two</div>');
		expect(f.value()).toBe('one\ntwo');
		f.done();
	});

	it('once the picker is drawn, Enter picks from it rather than sending', () => {
		const shown = $state({ value: false });
		const f = field(shown);
		f.type('hi @al');
		shown.value = true;
		flushSync();
		expect(f.draft.aria['aria-controls']).toBe('test-suggestions');
		f.enter();
		expect(f.submit).not.toHaveBeenCalled();
		expect(f.mentions()).toEqual(['alan']);
		f.done();
	});
});
