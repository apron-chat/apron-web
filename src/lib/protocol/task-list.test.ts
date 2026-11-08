import { describe, expect, it } from 'vitest';
import { hasTasks, toggleTask } from './task-list';

describe('toggleTask', () => {
	it('checks and unchecks the marker on a line, leaving the rest as written', () => {
		const source = '- [ ] Foo\n- [x] Bar';
		expect(toggleTask(source, 0, true)).toBe('- [x] Foo\n- [x] Bar');
		expect(toggleTask(source, 1, false)).toBe('- [ ] Foo\n- [ ] Bar');
	});

	it('finds the marker after quotes, numbers and indentation', () => {
		expect(toggleTask('intro\r\n\r\n> 1. a\r\n>    - [X] deep', 3, false)).toBe('intro\r\n\r\n> 1. a\r\n>    - [ ] deep');
		expect(toggleTask('* \t[ ] tab', 0, true)).toBe('* \t[x] tab');
	});

	it('finds the marker past bidi embeddings and overrides, as the line rendered, and keeps them', () => {
		expect(toggleTask('- \u202A[ ] milk\u202C', 0, true)).toBe('- \u202A[x] milk\u202C');
		expect(toggleTask('-\u202E [\u202D ] x', 0, true)).toBe('-\u202E [\u202Dx] x');
	});

	it('saves nothing for a line without a marker, or one already as asked', () => {
		expect(toggleTask('- [ ] Foo', 1, true)).toBeUndefined();
		expect(toggleTask('- Foo [ ]', 0, true)).toBeUndefined();
		expect(toggleTask('- [x] Foo', 0, true)).toBeUndefined();
	});
});

describe('hasTasks', () => {
	it('finds a task list item, in a list, after quotes and numbers', () => {
		expect(hasTasks('Lunch:\n- [ ] soup')).toBe(true);
		expect(hasTasks('> 1. [x] done')).toBe(true);
		expect(hasTasks('* [X]')).toBe(true);
		expect(hasTasks('- \u202A[ ] milk')).toBe(true);
	});

	it('finds none outside a list item, or without a space after the marker', () => {
		expect(hasTasks('[ ] not in a list')).toBe(false);
		expect(hasTasks('- [ ]x')).toBe(false);
		expect(hasTasks('- Foo [ ]')).toBe(false);
		expect(hasTasks('plain text')).toBe(false);
	});
});
