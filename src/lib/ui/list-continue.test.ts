import { describe, expect, it } from 'vitest';
import { continueList, expandTask } from './list-continue';

/** The text with `|` for the caret, and the change at it, the same way. */
function enter(marked: string): string | undefined {
	const at = marked.indexOf('|');
	const changed = continueList({ text: marked.replace('|', ''), start: at, end: at });
	return changed && `${changed.text.slice(0, changed.start)}|${changed.text.slice(changed.start)}`;
}

describe('continueList', () => {
	it('starts the next task unticked, whether this one is ticked or not', () => {
		expect(enter('- [ ] Foo|')).toBe('- [ ] Foo\n- [ ] |');
		expect(enter('- [x] Foo|')).toBe('- [x] Foo\n- [ ] |');
		expect(enter('* [X] Foo|')).toBe('* [X] Foo\n* [ ] |');
	});

	it('carries bullets and numbers on, a number one up', () => {
		expect(enter('- Foo|')).toBe('- Foo\n- |');
		expect(enter('9. Foo|')).toBe('9. Foo\n10. |');
		expect(enter('1) [ ] Foo|')).toBe('1) [ ] Foo\n2) [ ] |');
	});

	it('keeps the indentation and quotes it is under', () => {
		expect(enter('- a\n  - [ ] b|')).toBe('- a\n  - [ ] b\n  - [ ] |');
		expect(enter('> - [ ] quoted|')).toBe('> - [ ] quoted\n> - [ ] |');
	});

	it('splits an item at the caret, the rest going to the new one', () => {
		expect(enter('- [ ] Foo| bar')).toBe('- [ ] Foo\n- [ ] | bar');
	});

	it('ends the list on an empty item, with a blank line after it (in its quote), so what follows is not more of it', () => {
		expect(enter('- [ ] Foo\n- [ ] |')).toBe('- [ ] Foo\n\n|');
		expect(enter('- Foo\n- |\nafter')).toBe('- Foo\n\n|\nafter');
		expect(enter('> - [ ] a\n> - [ ] |')).toBe('> - [ ] a\n>\n> |');
		expect(enter('- a\n  - |')).toBe('- a\n\n|');
	});

	it('leaves a list in a code block alone', () => {
		expect(enter('```\n- name: web|')).toBeUndefined();
		expect(enter('```\nx\n```\n- out|')).toBe('```\nx\n```\n- out\n- |');
	});

	it('leaves a plain line break elsewhere', () => {
		expect(enter('Foo|')).toBeUndefined();
		expect(enter('-Foo|')).toBeUndefined();
		expect(enter('- [ |] Foo')).toBeUndefined();
		expect(continueList({ text: '- Foo', start: 2, end: 5 })).toBeUndefined();
	});
});

describe('expandTask', () => {
	const typed = (marked: string): string | undefined => {
		const at = marked.indexOf('|');
		const changed = expandTask({ text: marked.replace('|', ''), start: at, end: at });
		return changed && `${changed.text.slice(0, changed.start)}|${changed.text.slice(changed.start)}`;
	};

	it('writes a checklist item typed short at a line’s start out in full', () => {
		for (const short of ['[] ', '[ ] ', '-[] ', '-[ ] ', '- [] ', '* [] ']) expect(typed(`${short}|`), short).toBe('- [ ] |');
		expect(typed('Plan:\n-[] |')).toBe('Plan:\n- [ ] |');
		expect(typed('  > [] |rest')).toBe('  > - [ ] |rest');
	});

	it('leaves `- [ ] ` itself, a ticked box, and brackets anywhere but a line’s start', () => {
		expect(typed('- [ ] |')).toBeUndefined();
		expect(typed('[x] |')).toBeUndefined();
		expect(typed('see [] |')).toBeUndefined();
		expect(typed('[]|')).toBeUndefined();
		expect(typed('```\n[] |')).toBeUndefined();
	});
});
